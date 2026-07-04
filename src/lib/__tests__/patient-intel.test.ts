import {
  computeHealthScore,
  buildPatientBrief,
  composeBriefEnglish,
  buildPatientAlerts,
  mergePatientTimeline,
  patientCapabilities,
} from '../patient-intel'
import fr from '../../../messages/fr.json'
import en from '../../../messages/en.json'
import type { Patient } from '@/types/database'

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'p1', clinic_id: 'c1', patient_number: 'P-001', full_name: 'Awa Diop',
    date_of_birth: '1990-01-01', gender: 'female', phone: '+221 77 123 45 67',
    email: null, address: 'Dakar', emergency_contact: 'Mamadou', emergency_phone: '+221 76 000 00 00',
    blood_type: 'O+', allergies: ['Pénicilline'], cni: null,
    insurance_payer_type: 'ipm', insurance_provider: 'IPM', insurance_policy_number: null,
    insurance_coverage_percent: 80, sms_opt_in: true, sms_opt_out_at: null,
    consent_given: true, consent_date: null,
    // remaining fields the type may require are not read by the module
    ...( {} as Partial<Patient> ),
    ...overrides,
  } as Patient
}

describe('computeHealthScore', () => {
  it('is 100% for a fully populated patient', () => {
    const { score, missing } = computeHealthScore(patient())
    expect(score).toBe(100)
    expect(missing).toEqual([])
  })

  it('drops proportionally and lists missing factors', () => {
    const { score, missing } = computeHealthScore(patient({
      blood_type: null, consent_given: false, allergies: [],
    }))
    // 3 of 8 factors missing → 5/8 = 62.5 → 63
    expect(score).toBe(63)
    expect(missing.sort()).toEqual(['allergies', 'bloodGroup', 'consent'])
  })

  it('is deterministic', () => {
    const p = patient({ phone: null })
    expect(computeHealthScore(p)).toEqual(computeHealthScore(p))
  })
})

describe('buildPatientBrief', () => {
  const loaded = { prescriptions: true, labs: true, invoices: true }

  it('reports no issues when everything is zero', () => {
    const b = buildPatientBrief({ activePrescriptions: 0, pendingLabReviews: 0, outstandingBalance: 0, loaded })
    expect(b.hasIssues).toBe(false)
    expect(composeBriefEnglish(b)).toBe('No operational issues detected.')
  })

  it('summarizes active prescriptions and pending reviews', () => {
    const b = buildPatientBrief({ activePrescriptions: 1, pendingLabReviews: 0, outstandingBalance: 0, loaded })
    expect(b.hasIssues).toBe(true)
    expect(composeBriefEnglish(b)).toBe(
      'This patient currently has 1 active prescription and no outstanding laboratory reviews.',
    )
    const b2 = buildPatientBrief({ activePrescriptions: 0, pendingLabReviews: 2, outstandingBalance: 0, loaded })
    expect(composeBriefEnglish(b2)).toContain('2 laboratory results requiring review')
  })

  it('derives confidence and sources from what loaded', () => {
    const b = buildPatientBrief({ activePrescriptions: 0, pendingLabReviews: 0, outstandingBalance: 0, loaded })
    expect(b.confidence).toBe('high')
    expect(b.sources).toEqual(['prescriptions', 'laboratory', 'invoices'])
    const partial = buildPatientBrief({
      activePrescriptions: 0, pendingLabReviews: 0, outstandingBalance: 0,
      loaded: { prescriptions: true, labs: false, invoices: false },
    })
    expect(partial.confidence).toBe('medium')
  })

  // No diagnosis / treatment wording anywhere in the brief output — asserted on
  // the canonical English and the shipped fr/en message templates.
  it('never contains diagnostic or treatment wording', () => {
    const FORBIDDEN = /\b(diagnos|treat|prescribe you|disease|illness|cure|therapy|remedy)\b/i
    const samples = [
      composeBriefEnglish(buildPatientBrief({ activePrescriptions: 0, pendingLabReviews: 0, outstandingBalance: 0, loaded })),
      composeBriefEnglish(buildPatientBrief({ activePrescriptions: 3, pendingLabReviews: 4, outstandingBalance: 100, loaded })),
    ]
    for (const s of samples) expect(s).not.toMatch(FORBIDDEN)

    const briefKeys = ['brief_none', 'brief_sentence', 'brief_rx', 'brief_labs']
    for (const dict of [fr.patientProfile, en.patientProfile] as Record<string, string>[]) {
      for (const k of briefKeys) {
        expect(dict[k]).toBeDefined()
        expect(dict[k]).not.toMatch(FORBIDDEN)
      }
    }
  })
})

describe('buildPatientAlerts', () => {
  const base = {
    allergies: null, outstandingBalance: 0, missedFollowUp: false,
    abnormalPendingLabCount: 0, criticalPendingLab: false, stockIssueCount: 0,
  }

  it('is empty when nothing is wrong (strip hidden)', () => {
    expect(buildPatientAlerts(base)).toEqual([])
  })

  it('flags a recorded allergy as critical', () => {
    const a = buildPatientAlerts({ ...base, allergies: ['Pénicilline'] })
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ code: 'critical_allergy', severity: 'critical' })
  })

  it('escalates abnormal lab review to critical when a critical result is pending', () => {
    const warn = buildPatientAlerts({ ...base, abnormalPendingLabCount: 2, criticalPendingLab: false })
    expect(warn[0].severity).toBe('warning')
    const crit = buildPatientAlerts({ ...base, abnormalPendingLabCount: 1, criticalPendingLab: true })
    expect(crit[0].severity).toBe('critical')
  })

  it('surfaces balance, stock and missed follow-up', () => {
    const a = buildPatientAlerts({
      ...base, outstandingBalance: 5000, stockIssueCount: 1, missedFollowUp: true,
    })
    expect(a.map(x => x.code).sort()).toEqual(['missed_follow_up', 'outstanding_balance', 'stock_issue'])
  })
})

describe('mergePatientTimeline', () => {
  it('merges all six sources newest-first, including dispensings', () => {
    const merged = mergePatientTimeline({
      consultations: [{ id: 'c', created_at: '2026-01-01', ended_at: null } as never],
      appointments: [{ id: 'a', scheduled_at: '2026-03-01', status: 'scheduled' } as never],
      prescriptions: [{ id: 'p', created_at: '2026-02-01', status: 'active' } as never],
      labOrders: [{ id: 'l', created_at: '2026-05-01', status: 'completed' } as never],
      invoices: [{ id: 'i', created_at: '2026-04-01', status: 'paid' } as never],
      dispensings: [{ id: 'd', dispensed_at: '2026-06-01', created_at: '2026-06-01', status: 'dispensed' } as never],
    })
    expect(merged.map(m => m.type)).toEqual(['dispensing', 'lab', 'invoice', 'appointment', 'prescription', 'consultation'])
    expect(merged.some(m => m.type === 'dispensing')).toBe(true)
  })

  it('returns an empty array for no sources', () => {
    expect(mergePatientTimeline({})).toEqual([])
  })
})

describe('patientCapabilities (role-aware)', () => {
  it('gives doctor and admin everything', () => {
    for (const r of ['doctor', 'admin'] as const) {
      const c = patientCapabilities(r)
      expect(c.medical && c.financial && c.labs && c.medications).toBe(true)
      expect(c.quickActions).toContain('consultation')
    }
  })
  it('hides billing from nurse, lab tech and pharmacist', () => {
    for (const r of ['nurse', 'lab_technician', 'pharmacist'] as const) {
      expect(patientCapabilities(r).financial).toBe(false)
    }
  })
  it('gives receptionist demographics/appointments/insurance but no medical', () => {
    const c = patientCapabilities('receptionist')
    expect(c.medical).toBe(false)
    expect(c.appointments).toBe(true)
    expect(c.insurance).toBe(true)
    expect(c.quickActions).toEqual(['appointment'])
  })
  it('gives cashier financial but no medical', () => {
    const c = patientCapabilities('cashier')
    expect(c.financial).toBe(true)
    expect(c.medical).toBe(false)
  })
  it('locks super_admin out of all patient medical detail', () => {
    const c = patientCapabilities('super_admin')
    expect(c.restricted).toBe(true)
    expect(c.medical || c.financial || c.labs || c.medications).toBe(false)
  })
})
