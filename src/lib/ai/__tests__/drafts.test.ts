import { readFileSync } from 'fs'
import { join } from 'path'
import { buildDraft, canGenerateDraft, DRAFT_TYPES, DRAFT_DISCLAIMER } from '../drafts'
import type { DraftData, DraftType } from '../types'
import type { Role } from '@/types/database'

const AT = '2026-07-01T09:30:00.000Z'

const fullData: DraftData = {
  patient: { fullName: 'Dr Test Patient', patientNumber: 'P-001', dateOfBirth: '1990-01-01', gender: 'F', allergies: 'Pénicilline', bloodType: 'O+' },
  activeMedications: ['Paracétamol 500mg', 'Amoxicilline'],
  recentConsultationCount: 3,
  lastConsultationDate: '2026-06-20',
  pendingLabCount: 2,
  clinicName: 'Hôpital Test',
  doctorName: 'Oumy Diouf',
  diagnosis: undefined,
  appointmentReason: 'Fièvre',
}

const emptyData: DraftData = {
  activeMedications: [],
  recentConsultationCount: 0,
  pendingLabCount: 0,
}

describe('draft builders', () => {
  it('every draft type builds with the mandatory disclaimer + draft badge + timestamp', () => {
    for (const type of DRAFT_TYPES) {
      const d = buildDraft(type, fullData, AT)
      expect(d.type).toBe(type)
      expect(d.disclaimer).toBe(DRAFT_DISCLAIMER)
      expect(d.disclaimer).toMatch(/requires clinician review/i)
      expect(d.isDraft).toBe(true)
      expect(d.generatedAt).toBe(AT)
      expect(d.sections.length).toBeGreaterThan(0)
      expect(d.title).toBeTruthy()
    }
  })

  it('renders sources (citations) from the data used', () => {
    const d = buildDraft('consultation', fullData, AT)
    const entities = d.citations.map((c) => c.entity)
    expect(entities).toContain('patients')
    expect(entities).toContain('prescriptions')
    expect(d.citations.length).toBeGreaterThan(0)
  })

  it('surfaces allergies as a critical warning', () => {
    const d = buildDraft('prescription', fullData, AT)
    expect(d.warnings.some((w) => w.level === 'critical' && /pénicilline/i.test(w.message))).toBe(true)
  })

  it('consultation draft generates NO diagnosis (assessment is a placeholder)', () => {
    const d = buildDraft('consultation', fullData, AT)
    const assessment = d.sections.find((s) => s.key === 'assessment')!
    expect(assessment.content).toMatch(/compléter/i)
    expect(assessment.content).toMatch(/aucun diagnostic/i)
  })

  it('prescription draft never auto-selects a medication', () => {
    const d = buildDraft('prescription', fullData, AT)
    const meds = d.sections.find((s) => s.key === 'medications')!
    expect(meds.content).toMatch(/à sélectionner|compléter/i)
    // active meds appear only as safety CONTEXT, not as the prescription itself
    const safety = d.sections.find((s) => s.key === 'safety')!
    expect(safety.content).toMatch(/Amoxicilline/)
  })

  it('referral & certificate embed patient identity + clinic into a template', () => {
    const ref = buildDraft('referral', fullData, AT)
    expect(ref.sections[0].content).toMatch(/Dr Test Patient/)
    expect(ref.sections[0].content).toMatch(/Hôpital Test/)
    const cert = buildDraft('certificate', fullData, AT)
    expect(cert.sections[0].content).toMatch(/Oumy Diouf/)
  })

  it('confidence reflects available data', () => {
    expect(buildDraft('consultation', fullData, AT).confidence.level).toBe('high')
    expect(buildDraft('consultation', emptyData, AT).confidence.level).toBe('low')
  })

  it('is deterministic (same data + timestamp → same draft)', () => {
    expect(buildDraft('consultation', fullData, AT)).toEqual(buildDraft('consultation', fullData, AT))
  })
})

describe('draft role gating', () => {
  it('allows only doctor and admin', () => {
    expect(canGenerateDraft('doctor')).toBe(true)
    expect(canGenerateDraft('admin')).toBe(true)
  })

  it('blocks everyone else (incl. nurse, super_admin)', () => {
    for (const role of ['nurse', 'receptionist', 'pharmacist', 'cashier', 'lab_technician', 'super_admin'] as Role[]) {
      expect(canGenerateDraft(role)).toBe(false)
    }
  })
})

describe('draft path performs NO writes (until the clinician saves)', () => {
  const files = [
    join(__dirname, '..', 'drafts.ts'),
    join(__dirname, '..', 'context.ts'),
    join(__dirname, '..', '..', '..', 'app', 'api', 'ai', 'draft', 'route.ts'),
  ]
  it('the draft route contains no insert/update/delete/upsert', () => {
    const route = readFileSync(files[2], 'utf8')
    for (const write of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(route.includes(write)).toBe(false)
    }
  })
  it('drafts.ts is pure (no supabase, no writes)', () => {
    const src = readFileSync(files[0], 'utf8')
    expect(src).not.toMatch(/supabase|\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  })
})

// Exhaustiveness: keep the type list and builder map in sync.
it('DRAFT_TYPES covers all five draft targets', () => {
  const expected: DraftType[] = ['consultation', 'prescription', 'follow_up', 'referral', 'certificate']
  expect([...DRAFT_TYPES].sort()).toEqual([...expected].sort())
})
