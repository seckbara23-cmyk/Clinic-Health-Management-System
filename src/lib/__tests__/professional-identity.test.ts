import {
  resolveProfession,
  selectableProfessions,
  validateIdentity,
  normalizeLanguage,
  validateCredential,
  validateCredentials,
  duplicateLicenseNumbers,
  licenseConflictsInClinic,
  licenseNumbersFrom,
  normalizeLicenseNumber,
  professionalMediaPath,
  assertOwnMediaPath,
  initialsOf,
  CREDENTIAL_KINDS,
} from '../professional-identity'
import type { Credential } from '../professions/types'

const C = 'clinic-1'
const U = 'user-1'

// ── Role → Profession resolution (Role Integration) ────────────────
describe('resolveProfession / selectableProfessions', () => {
  it('stored profession wins when valid', () => {
    expect(resolveProfession({ profession: 'midwife' }, 'nurse').id).toBe('midwife')
  })
  it('falls back to a role-derived profession when unset/unknown', () => {
    expect(resolveProfession({ profession: null }, 'pharmacist').id).toBe('pharmacist')
    expect(resolveProfession({ profession: 'wizard' } as never, 'nurse').id).toBe('nurse')
    expect(resolveProfession(null, 'doctor').id).toBe('doctor')
  })
  it('offers only professions mapping to the user\'s existing role', () => {
    expect(selectableProfessions('nurse').map(p => p.id).sort()).toEqual(['midwife', 'nurse'])
    expect(selectableProfessions('doctor').map(p => p.id)).toEqual(['doctor'])
    expect(selectableProfessions('admin').map(p => p.id)).toEqual(['administrator'])
    expect(selectableProfessions('super_admin')).toEqual([]) // no clinical profession
  })
})

// ── Identity field validation ──────────────────────────────────────
describe('validateIdentity', () => {
  it('accepts valid input (incl. empty optionals)', () => {
    expect(validateIdentity({})).toEqual({})
    expect(validateIdentity({ displayName: 'Dr. Fall', yearsExperience: 12, languages: ['fr', 'en', 'wo'] })).toEqual({})
    expect(validateIdentity({ yearsExperience: '' })).toEqual({}) // blank string ok
  })
  it('flags a too-short / too-long display name', () => {
    expect(validateIdentity({ displayName: 'A' }).displayName).toBe('invalid_display_name')
    expect(validateIdentity({ displayName: 'x'.repeat(81) }).displayName).toBe('invalid_display_name')
  })
  it('flags invalid years of experience', () => {
    expect(validateIdentity({ yearsExperience: -1 }).yearsExperience).toBe('invalid_years')
    expect(validateIdentity({ yearsExperience: 71 }).yearsExperience).toBe('invalid_years')
    expect(validateIdentity({ yearsExperience: 3.5 }).yearsExperience).toBe('invalid_years')
    expect(validateIdentity({ yearsExperience: 'abc' }).yearsExperience).toBe('invalid_years')
  })
  it('validates language codes, duplicates and count', () => {
    expect(validateIdentity({ languages: ['french'] }).languages).toBe('invalid_language')
    expect(validateIdentity({ languages: ['fr', 'FR'] }).languages).toBe('duplicate_language')
    expect(validateIdentity({ languages: Array(13).fill('fr') }).languages).toBe('too_many_languages')
    expect(validateIdentity({ languages: ['fr-FR', 'wo'] })).toEqual({}) // region subtag ok
  })
})

describe('normalizeLanguage', () => {
  it('lowercases valid tags, rejects invalid', () => {
    expect(normalizeLanguage('FR')).toBe('fr')
    expect(normalizeLanguage('  En ')).toBe('en')
    expect(normalizeLanguage('fr-FR')).toBe('fr-fr')
    expect(normalizeLanguage('français')).toBe('')
    expect(normalizeLanguage('x')).toBe('')
  })
})

// ── Credential validation ──────────────────────────────────────────
describe('validateCredential', () => {
  it('accepts a well-formed credential', () => {
    expect(validateCredential({ kind: 'medical_license', identifier: 'SN-123', issuedAt: '2020-01-01', expiresAt: '2027-01-01' })).toEqual({})
    expect(validateCredential({ kind: 'diploma' })).toEqual({})
  })
  it('rejects an invalid kind', () => {
    expect(validateCredential({ kind: 'bogus' } as never).kind).toBe('invalid_kind')
    expect(validateCredential(null).kind).toBe('invalid_kind')
  })
  it('requires an identifier for a medical license', () => {
    expect(validateCredential({ kind: 'medical_license' }).identifier).toBe('identifier_required')
    expect(validateCredential({ kind: 'medical_license', identifier: '  ' }).identifier).toBe('identifier_required')
  })
  it('validates dates and ordering', () => {
    expect(validateCredential({ kind: 'diploma', issuedAt: 'not-a-date' }).issuedAt).toBe('invalid_date')
    expect(validateCredential({ kind: 'diploma', issuedAt: '2025-01-01', expiresAt: '2020-01-01' }).expiresAt).toBe('expiry_before_issue')
  })
  it('validates CME credits', () => {
    expect(validateCredential({ kind: 'cme', cmeCredits: -5 }).cmeCredits).toBe('invalid_credits')
    expect(validateCredential({ kind: 'cme', cmeCredits: 20 })).toEqual({})
  })
  it('validateCredentials maps only the invalid rows by index', () => {
    const list: Credential[] = [
      { kind: 'diploma' },                       // valid
      { kind: 'medical_license' },               // missing identifier
      { kind: 'cme', cmeCredits: -1 },           // bad credits
    ]
    const res = validateCredentials(list)
    expect(res[0]).toBeUndefined()
    expect(res[1].identifier).toBe('identifier_required')
    expect(res[2].cmeCredits).toBe('invalid_credits')
  })
})

// ── Duplicate / clinic-conflicting licenses ────────────────────────
describe('license duplicate detection', () => {
  it('normalizes license numbers (case/space/hyphen insensitive)', () => {
    expect(normalizeLicenseNumber('  sn 123 ')).toBe('SN123')
    expect(normalizeLicenseNumber('SN-42')).toBe('SN42')
  })
  it('finds duplicates within one profile', () => {
    const creds: Credential[] = [
      { kind: 'medical_license', identifier: 'SN-1' },
      { kind: 'medical_license', identifier: 'sn 1' }, // same after normalise (hyphen/space cosmetic)
      { kind: 'medical_license', identifier: 'SN-2' },
      { kind: 'diploma', identifier: 'SN-1' },         // different kind — ignored
    ]
    expect(duplicateLicenseNumbers(creds)).toEqual(['SN1'])
  })
  it('detects a clinic-wide conflict (cross-tenant safety)', () => {
    const others = ['SN-9', 'SN-42']
    expect(licenseConflictsInClinic('sn 42', others)).toBe(true)
    expect(licenseConflictsInClinic('SN-100', others)).toBe(false)
    expect(licenseConflictsInClinic('', others)).toBe(false)
  })
  it('extracts license numbers from profiles', () => {
    expect(licenseNumbersFrom([
      { credentials: [{ kind: 'medical_license', identifier: 'A-1' }, { kind: 'diploma', identifier: 'x' }] },
      { credentials: [{ kind: 'medical_license', identifier: 'b 2' }] },
    ])).toEqual(['A1', 'B2'])
  })
})

// ── Media path (safe replace + tenant scoping) ─────────────────────
describe('professionalMediaPath — stable & tenant-scoped', () => {
  it('is stable per (clinic,user,kind) → replacement overwrites in place', () => {
    const a = professionalMediaPath(C, U, 'photo')
    const b = professionalMediaPath(C, U, 'photo')
    expect(a).toBe(`${C}/${U}/photo`)
    expect(a).toBe(b) // no filename dependence → safe replace, no orphans
    expect(professionalMediaPath(C, U, 'signature')).toBe(`${C}/${U}/signature`)
  })
  it('is owned by its (clinic,user) and rejects cross-tenant/user', () => {
    const p = professionalMediaPath(C, U, 'photo')
    expect(assertOwnMediaPath(p, C, U)).toBe(true)
    expect(assertOwnMediaPath(p, 'other', U)).toBe(false)
    expect(assertOwnMediaPath(p, C, 'other')).toBe(false)
  })
})

describe('initialsOf', () => {
  it('derives up to two initials', () => {
    expect(initialsOf('Awa Ndiaye Sy')).toBe('AS')
    expect(initialsOf('Moussa')).toBe('M')
    expect(initialsOf('   ')).toBe('—')
  })
})

describe('registry surface', () => {
  it('exposes all 8 credential kinds', () => {
    expect(CREDENTIAL_KINDS).toHaveLength(8)
    expect(CREDENTIAL_KINDS).toContain('hospital_privilege')
  })
})
