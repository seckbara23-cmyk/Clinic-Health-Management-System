import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DOCUMENT_DEFINITIONS, getDocument, canAccessDocument, availableDocuments,
} from '../documents/registry'
import { resolvePrefill, buildInitialValues, missingRequired } from '../documents/prefill'
import type { DocumentContext } from '../documents/types'
import type { Role } from '@/types/database'

const NOW = new Date('2026-07-06T12:00:00Z')

const CTX: DocumentContext = {
  patient: { full_name: 'Awa Sy', patient_number: 'P-001', date_of_birth: '1990-01-01', gender: 'female', address: 'Dakar', phone: '+221770000000', cni: '1234567890123' },
  consultation: { chief_complaint: 'Cough', symptoms: 'Dry cough 3 days', diagnosis: 'URTI (clinician-recorded)', treatment_plan: 'Symptomatic', notes: '', follow_up_date: '2026-07-20' },
  profile: { full_name: 'Dr. Diallo', professionalTitle: 'MD' },
  clinic: { name: 'Clinique Étoile', location: 'Dakar', phone: '+221338210000' },
  now: NOW,
}

// ── Registry integrity ──────────────────────────────────────────────
describe('document registry — integrity', () => {
  it('defines the required documents (9 initial + 4 cardiology + 3 emergency + 4 internal medicine + 4 orthopedics + 4 ophthalmology + 4 mental health + 4 pulmonology)', () => {
    const ids = DOCUMENT_DEFINITIONS.map(d => d.id)
    for (const id of [
      'gp_referral_letter', 'gp_medical_certificate', 'gp_sick_leave',
      'peds_school_certificate', 'peds_vaccination_certificate',
      'obgyn_anc_summary', 'obgyn_pregnancy_summary',
      'orl_audiology_referral', 'orl_ent_followup_summary',
      'cardiology_referral', 'procedure_clearance', 'cardiac_followup_summary', 'cardiac_rehab_referral',
      'emergency_summary', 'transfer_summary', 'observation_summary',
      'internal_medicine_referral', 'chronic_disease_followup_summary', 'hospital_discharge_followup_note', 'medication_review_summary',
      'orthopedic_referral', 'ortho_physiotherapy_referral', 'cast_review_summary', 'post_op_orthopedic_summary',
      'ophthalmology_referral', 'eye_examination_summary', 'visual_acuity_certificate', 'post_op_ophthalmology_summary',
      'mental_health_referral', 'therapy_followup_summary', 'crisis_followup_summary', 'return_to_care_reminder',
      'pulmonology_referral', 'respiratory_followup_summary', 'pulmonary_rehab_referral', 'pulmonary_function_summary',
    ]) expect(ids).toContain(id)
    expect(DOCUMENT_DEFINITIONS.length).toBe(36)
  })
  it('has unique ids and every field/section is coherent', () => {
    const ids = DOCUMENT_DEFINITIONS.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of DOCUMENT_DEFINITIONS) {
      expect(d.allowedRoles.length).toBeGreaterThan(0)
      expect(d.fields.length).toBeGreaterThan(0)
      const keys = new Set(d.fields.map(f => f.key))
      for (const s of d.sections) for (const k of s.fieldKeys) expect(keys.has(k)).toBe(true)
      expect(['certificate', 'referral', 'summary', 'report', 'note']).toContain(d.category)
      expect(d.outputType).toBe('print')
    }
  })
  it('every field/title/category label key exists in BOTH fr and en', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
    for (const d of DOCUMENT_DEFINITIONS) {
      expect(fr.documents[d.titleKey]).toBeTruthy()
      expect(en.documents[d.titleKey]).toBeTruthy()
      for (const f of d.fields) {
        expect(en.documents[f.labelKey]).toBeTruthy()
        for (const o of f.options ?? []) expect(en.documents[o.labelKey]).toBeTruthy()
      }
      expect(en.documents[`cat_${d.category}`]).toBeTruthy()
    }
  })
})

// ── Role & specialty access ─────────────────────────────────────────
describe('access control', () => {
  it('canAccessDocument respects allowedRoles', () => {
    const cert = getDocument('gp_medical_certificate')!
    expect(canAccessDocument(cert, 'doctor')).toBe(true)
    expect(canAccessDocument(cert, 'receptionist')).toBe(false)
    expect(canAccessDocument(cert, null)).toBe(false)
  })
  it('a doctor sees shared + their specialty documents; a GP/unspecialised doctor sees shared only', () => {
    const gp = availableDocuments('doctor', 'general_practice').map(d => d.id)
    expect(gp).toContain('gp_medical_certificate')
    expect(gp).not.toContain('peds_school_certificate')
    const peds = availableDocuments('doctor', 'pediatrics').map(d => d.id)
    expect(peds).toContain('gp_referral_letter')       // shared
    expect(peds).toContain('peds_school_certificate')  // specialty
    expect(peds).not.toContain('obgyn_anc_summary')    // other specialty
  })
  it('a nurse sees only nurse-permitted documents (vaccination cert, ANC summary)', () => {
    const nurse = availableDocuments('nurse', 'pediatrics').map(d => d.id)
    expect(nurse).toContain('peds_vaccination_certificate')
    expect(nurse).not.toContain('gp_medical_certificate') // doctor-only shared doc
  })
  it('a receptionist/cashier sees no clinical documents', () => {
    for (const r of ['receptionist', 'cashier', 'lab_technician', 'pharmacist'] as Role[]) {
      expect(availableDocuments(r, 'general_practice')).toEqual([])
    }
  })
})

// ── Prefill (existing data only — never generates findings) ────────
describe('prefill', () => {
  it('resolves identity / clinic / doctor / date sources', () => {
    expect(resolvePrefill('patient.full_name', CTX)).toBe('Awa Sy')
    expect(resolvePrefill('patient.age', CTX)).toBe('36')
    expect(resolvePrefill('clinic.name', CTX)).toBe('Clinique Étoile')
    expect(resolvePrefill('profile.full_name', CTX)).toBe('Dr. Diallo')
    expect(resolvePrefill('today', CTX)).toBe('2026-07-06')
  })
  it('copies the clinician\'s OWN recorded consultation text (not generated)', () => {
    expect(resolvePrefill('consultation.chief_complaint', CTX)).toBe('Cough')
    expect(resolvePrefill('consultation.diagnosis', CTX)).toBe('URTI (clinician-recorded)')
    expect(resolvePrefill('consultation.follow_up_date', CTX)).toBe('2026-07-20')
  })
  it('missing data / no source → empty string, never throws', () => {
    expect(resolvePrefill(undefined, CTX)).toBe('')
    expect(resolvePrefill('patient.address', { ...CTX, patient: null })).toBe('')
    expect(resolvePrefill('patient.age', { ...CTX, patient: { date_of_birth: 'bad' } })).toBe('')
  })
  it('buildInitialValues prefills a referral from context and leaves un-prefilled fields blank', () => {
    const def = getDocument('gp_referral_letter')!
    const v = buildInitialValues(def, CTX)
    expect(v.reason).toBe('Cough')                       // prefilled from chief_complaint
    expect(v.clinical_summary).toBe('URTI (clinician-recorded)')
    expect(v.recipient).toBe('')                          // no prefill → blank (clinician fills)
    expect(v.request).toBe('')
  })
  it('a certificate never prefills its statement (no generated content)', () => {
    const v = buildInitialValues(getDocument('gp_medical_certificate')!, CTX)
    expect(v.statement).toBe('')
  })
  it('missingRequired flags empty required fields', () => {
    const def = getDocument('gp_medical_certificate')!
    expect(missingRequired(def, { statement: '' })).toContain('statement')
    expect(missingRequired(def, { statement: 'On examination…' })).toEqual([])
  })
})

// ── Safety / privacy / tenant invariants ────────────────────────────
describe('safety & security invariants', () => {
  const BANNED = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('no documents i18n string contains diagnosis/treatment wording', () => {
    for (const [k, v] of Object.entries(en.documents as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
  it('the framework libs import no AI, no DB client, and perform no writes', () => {
    for (const f of ['registry.ts', 'prefill.ts', 'types.ts']) {
      const src = readFileSync(join(__dirname, '..', 'documents', f), 'utf8')
      expect(src).not.toMatch(/from '@\/lib\/ai/)
      expect(src).not.toMatch(/createClient|service_role|supabase/i)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })
  it('the audit hook is best-effort, uses no service_role, no clinics embed', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'hooks', 'useDocuments.ts'), 'utf8')
    expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE/)
    expect(src).not.toMatch(/clinics\(/)
  })
  it('the migration stores METADATA ONLY (no content column) with surrogate PK + RLS', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '047_document_generations.sql'), 'utf8')
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(patient_id/)
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/get_clinic_id\(\)/)
    // No document body/content is persisted — audit metadata only.
    expect(code).not.toMatch(/\bcontent\b|\bbody\b|field_values|payload/)
  })
})
