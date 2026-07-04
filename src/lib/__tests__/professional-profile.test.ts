import {
  fallbackProfile,
  normalizeProfile,
  parseCredentials,
  displayNameFor,
  credentialReminders,
  mediaPath,
  isMediaPathOwnedBy,
  PROFESSIONAL_MEDIA_BUCKET,
} from '../professional-profile'
import {
  PROFESSIONS,
  DEFAULT_PROFESSION,
  getProfession,
  isRegisteredProfession,
  professionForRole,
} from '../professions'
import type { ProfessionalProfileRow, Credential } from '../professions/types'
import type { Role } from '@/types/database'

const U = 'user-1'
const C = 'clinic-1'
const NOW = new Date('2026-07-04T00:00:00Z')

// ── Fallback / missing-profile & missing-migration behaviour ───────
describe('fallbackProfile — no row / missing table never blocks', () => {
  it('returns a safe, empty profile flagged isFallback', () => {
    const p = fallbackProfile(U, C)
    expect(p).toMatchObject({
      userId: U, clinicId: C, profession: null, displayName: null,
      credentials: [], languages: [], onboardingCompleted: false, isFallback: true,
    })
    expect(p.photoPath).toBeNull()
    expect(p.signaturePath).toBeNull()
  })

  it('derives a sensible profession + display name from the auth role when given', () => {
    const p = fallbackProfile(U, C, { role: 'pharmacist', displayName: 'Awa Sy' })
    expect(p.profession).toBe('pharmacist')
    expect(p.displayName).toBe('Awa Sy')
    expect(p.isFallback).toBe(true)
  })
})

describe('normalizeProfile — tolerant of partial / legacy / missing-migration rows', () => {
  it('null row → fallback (simulates missing table / no row)', () => {
    expect(normalizeProfile(null, U, C).isFallback).toBe(true)
    expect(normalizeProfile(undefined, U, C).isFallback).toBe(true)
  })

  it('maps a complete row into the domain model', () => {
    const row: ProfessionalProfileRow = {
      user_id: U, clinic_id: C, profession: 'doctor',
      display_name: 'Dr. Diallo', professional_title: 'MD', department: 'Cardiology',
      position: 'Consultant', years_experience: 12, languages: ['fr', 'wo'],
      photo_path: `${C}/${U}/photo-a.jpg`, signature_path: `${C}/${U}/signature-s.png`,
      credentials: [{ kind: 'medical_license', identifier: 'SN-123' }],
      onboarding_completed: true,
    }
    const p = normalizeProfile(row, U, C)
    expect(p.isFallback).toBe(false)
    expect(p.profession).toBe('doctor')
    expect(p.displayName).toBe('Dr. Diallo')
    expect(p.yearsExperience).toBe(12)
    expect(p.languages).toEqual(['fr', 'wo'])
    expect(p.credentials).toHaveLength(1)
    expect(p.onboardingCompleted).toBe(true)
  })

  it('degrades gracefully on nulls / wrong types / unknown profession', () => {
    const row = {
      user_id: U, clinic_id: C, profession: 'wizard',
      display_name: '   ', years_experience: 'twelve', languages: 'fr' as unknown,
      credentials: 'not-json{', onboarding_completed: null,
    } as unknown as ProfessionalProfileRow
    const p = normalizeProfile(row, U, C, { role: 'nurse', displayName: 'N. Fall' })
    expect(p.profession).toBe('nurse')          // unknown profession → role-derived
    expect(p.displayName).toBe('N. Fall')       // blank display name → fallback name
    expect(p.yearsExperience).toBeNull()        // non-number → null
    expect(p.languages).toEqual([])             // non-array → []
    expect(p.credentials).toEqual([])           // malformed JSON → []
    expect(p.onboardingCompleted).toBe(false)
    expect(p.isFallback).toBe(false)            // a real row existed, just messy
  })
})

describe('parseCredentials — tolerant', () => {
  it('accepts an array of credential objects', () => {
    expect(parseCredentials([{ kind: 'cme' }, { kind: 'fellowship' }])).toHaveLength(2)
  })
  it('accepts a JSON string', () => {
    expect(parseCredentials('[{"kind":"diploma"}]')).toHaveLength(1)
  })
  it('drops non-objects / objects without a kind / bad JSON', () => {
    expect(parseCredentials(['x', 42, {}, { kind: 5 }])).toEqual([])
    expect(parseCredentials('nope')).toEqual([])
    expect(parseCredentials(null)).toEqual([])
    expect(parseCredentials(undefined)).toEqual([])
  })
})

describe('displayNameFor', () => {
  it('prefers profile display name, then full name, then placeholder', () => {
    expect(displayNameFor({ displayName: 'A' }, 'B')).toBe('A')
    expect(displayNameFor({ displayName: '  ' }, 'B')).toBe('B')
    expect(displayNameFor(null, null)).toBe('—')
  })
})

// ── Credential expiry reminders (operational only, deterministic) ──
describe('credentialReminders', () => {
  const creds: Credential[] = [
    { kind: 'medical_license', title: 'License', expiresAt: '2026-06-01' }, // expired ~33d
    { kind: 'cme', title: 'CME', expiresAt: '2026-07-20' },                 // in 16d
    { kind: 'fellowship', title: 'Fellowship', expiresAt: '2027-01-01' },   // far off
    { kind: 'diploma', title: 'Diploma' },                                  // no expiry
  ]

  it('flags expired + soon, ignores far-off & no-expiry, most-urgent first', () => {
    const r = credentialReminders(creds, NOW, 60)
    expect(r.map(x => x.kind)).toEqual(['medical_license', 'cme'])
    expect(r[0].severity).toBe('expired')
    expect(r[0].daysUntilExpiry).toBeLessThan(0)
    expect(r[1].severity).toBe('expiring_soon')
    expect(r[1].daysUntilExpiry).toBeGreaterThan(0)
  })

  it('is deterministic given the same now/window', () => {
    expect(credentialReminders(creds, NOW, 60)).toEqual(credentialReminders(creds, NOW, 60))
  })

  it('empty / invalid input → []', () => {
    expect(credentialReminders([], NOW)).toEqual([])
    expect(credentialReminders(null, NOW)).toEqual([])
    expect(credentialReminders([{ kind: 'cme', expiresAt: 'not-a-date' }], NOW)).toEqual([])
  })

  it('a narrower window hides a not-yet-due credential', () => {
    expect(credentialReminders(creds, NOW, 10).map(x => x.kind)).toEqual(['medical_license'])
  })
})

// ── Media path convention + tenant scoping ─────────────────────────
describe('media paths mirror RLS scoping (clinic/user)', () => {
  it('bucket is the private professional-media bucket', () => {
    expect(PROFESSIONAL_MEDIA_BUCKET).toBe('professional-media')
  })

  it('builds {clinic}/{user}/{kind}-{safeName}', () => {
    const p = mediaPath(C, U, 'photo', 'My Photo!.PNG')
    expect(p).toBe(`${C}/${U}/photo-my-photo-.png`)
    expect(isMediaPathOwnedBy(p, C, U)).toBe(true)
  })

  it('rejects cross-tenant / cross-user paths', () => {
    const mine = mediaPath(C, U, 'signature', 'sig.png')
    expect(isMediaPathOwnedBy(mine, 'other-clinic', U)).toBe(false)
    expect(isMediaPathOwnedBy(mine, C, 'other-user')).toBe(false)
    expect(isMediaPathOwnedBy('badpath', C, U)).toBe(false)
  })
})

// ── Professional Registry integrity & genericity ───────────────────
describe('Professional Registry', () => {
  it('registers the 9 foundation professions with unique ids', () => {
    const ids = PROFESSIONS.map(p => p.id)
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
    expect(ids).toEqual(expect.arrayContaining([
      'doctor', 'nurse', 'midwife', 'pharmacist', 'lab_technologist',
      'radiographer', 'receptionist', 'cashier', 'administrator',
    ]))
  })

  it('every profession maps to an EXISTING RBAC role (no invented roles/RLS)', () => {
    const VALID: Role[] = ['super_admin', 'admin', 'doctor', 'receptionist', 'nurse', 'cashier', 'lab_technician', 'pharmacist']
    for (const p of PROFESSIONS) expect(VALID).toContain(p.role)
  })

  it('stays generic — no coupling to any specialty or Copilot Pack (basePacks empty)', () => {
    for (const p of PROFESSIONS) expect(p.basePacks).toEqual([])
  })

  it('usesSpecialties is true exactly for specialty-practising professions', () => {
    // Since 14.2.3 the taxonomy gives pharmacist (Pharmacy), lab_technologist
    // (Laboratory Medicine) and radiographer (Radiology) their specialty space.
    const clinical = PROFESSIONS.filter(p => p.usesSpecialties).map(p => p.id).sort()
    expect(clinical).toEqual(['doctor', 'lab_technologist', 'midwife', 'nurse', 'pharmacist', 'radiographer'])
  })

  it('getProfession / professionForRole never throw and fall back to doctor', () => {
    expect(getProfession('doctor').id).toBe('doctor')
    expect(getProfession('nope').id).toBe(DEFAULT_PROFESSION)
    expect(getProfession(null).id).toBe(DEFAULT_PROFESSION)
    expect(professionForRole('pharmacist').id).toBe('pharmacist')
    expect(professionForRole('unknown').id).toBe(DEFAULT_PROFESSION)
    expect(isRegisteredProfession('midwife')).toBe(true)
    expect(isRegisteredProfession('xyz')).toBe(false)
  })
})
