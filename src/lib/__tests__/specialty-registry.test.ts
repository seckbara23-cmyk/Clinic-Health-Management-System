import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SPECIALTY_TAXONOMY,
  getClinicalSpecialty,
  isRegisteredClinicalSpecialty,
  subSpecialtiesOf,
  parentOfSubSpecialty,
  specialtiesByCategory,
} from '../specialties/taxonomy'
import {
  allowedSpecialtiesForProfession,
  isSpecialtyAllowedForProfession,
  validateSpecialtySelection,
  normalizeSelection,
  resolveSpecialtySelection,
  EMPTY_SELECTION,
} from '../specialties/selection'
import { PROFESSIONS } from '../professions'
import { fallbackProfile, normalizeProfile, parseStringArray } from '../professional-profile'

// ── Registry integrity ──────────────────────────────────────────────
describe('Specialty Registry — integrity', () => {
  it('contains the full required West-Africa starter taxonomy', () => {
    const ids = SPECIALTY_TAXONOMY.map(s => s.id)
    const required = [
      'general_practice', 'family_medicine', 'pediatrics', 'obgyn', 'cardiology',
      'dermatology', 'neurology', 'psychiatry', 'general_surgery', 'orthopedics',
      'ent', 'ophthalmology', 'emergency_medicine', 'internal_medicine', 'radiology',
      'laboratory_medicine', 'anesthesiology', 'oncology', 'urology', 'nephrology',
      'dentistry', 'nutrition', 'physiotherapy', 'pharmacy',
    ]
    for (const id of required) expect(ids).toContain(id)
    expect(ids.length).toBeGreaterThanOrEqual(24)
  })

  it('has unique specialty ids (duplicate prevention)', () => {
    const ids = SPECIALTY_TAXONOMY.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has globally unique sub-specialty ids (duplicate prevention)', () => {
    const subs = SPECIALTY_TAXONOMY.flatMap(s => s.subSpecialties.map(x => x.id))
    expect(new Set(subs).size).toBe(subs.length)
    expect(subs.length).toBeGreaterThan(20)
  })

  it('usesSubspecialties is consistent with the sub list', () => {
    for (const s of SPECIALTY_TAXONOMY) {
      expect(s.usesSubspecialties).toBe(s.subSpecialties.length > 0)
    }
  })

  it('every entry is active, versioned, and DECOUPLED from packs (futurePackIds empty)', () => {
    for (const s of SPECIALTY_TAXONOMY) {
      expect(s.status).toBe('active')
      expect(s.version).toBeGreaterThanOrEqual(1)
      expect(s.futurePackIds).toEqual([])   // Specialty ≠ Copilot Pack
    }
  })

  it('every defaultProfession is a registered profession', () => {
    const known = new Set(PROFESSIONS.map(p => p.id))
    for (const s of SPECIALTY_TAXONOMY) {
      expect(s.defaultProfessions.length).toBeGreaterThan(0)
      for (const p of s.defaultProfessions) expect(known.has(p)).toBe(true)
    }
  })

  it('lookups never throw and fall back to null/[]', () => {
    expect(getClinicalSpecialty('cardiology')?.id).toBe('cardiology')
    expect(getClinicalSpecialty('bogus')).toBeNull()
    expect(getClinicalSpecialty(null)).toBeNull()
    expect(isRegisteredClinicalSpecialty('obgyn')).toBe(true)
    expect(isRegisteredClinicalSpecialty('')).toBe(false)
    expect(subSpecialtiesOf('nope')).toEqual([])
    expect(parentOfSubSpecialty('neonatology')?.id).toBe('pediatrics')
    expect(parentOfSubSpecialty('bogus')).toBeNull()
    expect(specialtiesByCategory('maternal_child').map(s => s.id)).toEqual(
      expect.arrayContaining(['pediatrics', 'obgyn', 'midwifery']),
    )
  })
})

// ── Localization (French first, English included) ───────────────────
describe('Specialty Registry — localization completeness', () => {
  const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('every label/desc/sub key exists in BOTH fr and en', () => {
    for (const s of SPECIALTY_TAXONOMY) {
      expect(fr.specialties[s.labelKey]).toBeTruthy()
      expect(en.specialties[s.labelKey]).toBeTruthy()
      expect(fr.specialties[s.descKey]).toBeTruthy()
      expect(en.specialties[s.descKey]).toBeTruthy()
      for (const x of s.subSpecialties) {
        expect(fr.specialties[x.labelKey]).toBeTruthy()
        expect(en.specialties[x.labelKey]).toBeTruthy()
      }
    }
  })

  it('fr and en key sets are identical (parity)', () => {
    expect(Object.keys(fr.specialties).sort()).toEqual(Object.keys(en.specialties).sort())
  })
})

// ── Profession compatibility (data, never permissions) ──────────────
describe('profession compatibility', () => {
  it('doctor → all doctor-practicable specialties (incl. every required medical one)', () => {
    const ids = allowedSpecialtiesForProfession('doctor').map(s => s.id)
    for (const id of ['general_practice', 'cardiology', 'obgyn', 'general_surgery', 'radiology', 'laboratory_medicine', 'dentistry']) {
      expect(ids).toContain(id)
    }
    expect(ids).not.toContain('pharmacy')   // pharmacy is the pharmacist's domain
    expect(ids).not.toContain('nursing')
  })

  it('pharmacist → Pharmacy (with Clinical Pharmacy sub-specialty)', () => {
    const ids = allowedSpecialtiesForProfession('pharmacist').map(s => s.id)
    expect(ids).toEqual(['pharmacy'])
    expect(subSpecialtiesOf('pharmacy').map(x => x.id)).toContain('clinical_pharmacy')
  })

  it('nurse → nursing specialties; midwife → midwifery + nursing', () => {
    expect(allowedSpecialtiesForProfession('nurse').map(s => s.id).sort()).toEqual(['nursing', 'nutrition'])
    expect(allowedSpecialtiesForProfession('midwife').map(s => s.id).sort()).toEqual(['midwifery', 'nursing'])
  })

  it('lab technologist → laboratory medicine; radiographer → radiology', () => {
    expect(allowedSpecialtiesForProfession('lab_technologist').map(s => s.id)).toEqual(['laboratory_medicine'])
    expect(allowedSpecialtiesForProfession('radiographer').map(s => s.id)).toEqual(['radiology'])
  })

  it('non-clinical professions → no specialties', () => {
    for (const p of ['receptionist', 'cashier', 'administrator']) {
      expect(allowedSpecialtiesForProfession(p)).toEqual([])
    }
    expect(allowedSpecialtiesForProfession(null)).toEqual([])
  })

  it('usesSpecialties flag agrees with the taxonomy for EVERY profession', () => {
    for (const p of PROFESSIONS) {
      expect(p.usesSpecialties).toBe(allowedSpecialtiesForProfession(p.id).length > 0)
    }
  })
})

// ── Selection validation ────────────────────────────────────────────
describe('validateSpecialtySelection', () => {
  it('accepts a valid doctor selection (1 primary + unlimited secondaries + subs)', () => {
    expect(validateSpecialtySelection('doctor', {
      primary: 'general_practice',
      secondaries: ['cardiology', 'internal_medicine', 'pediatrics', 'nephrology', 'oncology'],
      subs: ['echocardiography', 'diabetology', 'neonatology'],
    })).toEqual({})
  })

  it('accepts an empty selection (profile not yet completed)', () => {
    expect(validateSpecialtySelection('doctor', EMPTY_SELECTION)).toEqual({})
  })

  it('requires a primary as soon as anything else is selected', () => {
    expect(validateSpecialtySelection('doctor', { primary: null, secondaries: ['cardiology'], subs: [] }).primary)
      .toBe('primary_required')
  })

  it('rejects an unregistered or profession-incompatible primary', () => {
    expect(validateSpecialtySelection('doctor', { primary: 'wizardry', secondaries: [], subs: [] }).primary)
      .toBe('primary_not_registered')
    expect(validateSpecialtySelection('nurse', { primary: 'cardiology', secondaries: [], subs: [] }).primary)
      .toBe('primary_not_allowed')
  })

  it('rejects duplicate secondaries and secondary === primary', () => {
    expect(validateSpecialtySelection('doctor', { primary: 'general_practice', secondaries: ['cardiology', 'cardiology'], subs: [] }).secondaries)
      .toBe('duplicate_secondary')
    expect(validateSpecialtySelection('doctor', { primary: 'cardiology', secondaries: ['cardiology'], subs: [] }).secondaries)
      .toBe('secondary_equals_primary')
  })

  it('rejects a sub whose parent specialty is not selected', () => {
    expect(validateSpecialtySelection('doctor', { primary: 'general_practice', secondaries: [], subs: ['echocardiography'] }).subs)
      .toBe('sub_parent_missing')
    // …but accepts it when the parent is a secondary
    expect(validateSpecialtySelection('doctor', { primary: 'general_practice', secondaries: ['cardiology'], subs: ['echocardiography'] }))
      .toEqual({})
  })

  it('rejects unknown and duplicate subs', () => {
    expect(validateSpecialtySelection('doctor', { primary: 'cardiology', secondaries: [], subs: ['bogus'] }).subs)
      .toBe('sub_not_registered')
    expect(validateSpecialtySelection('doctor', { primary: 'cardiology', secondaries: [], subs: ['echocardiography', 'echocardiography'] }).subs)
      .toBe('duplicate_sub')
  })

  it('a profession without specialties must keep an empty selection (no RBAC change)', () => {
    expect(validateSpecialtySelection('receptionist', { primary: 'cardiology', secondaries: [], subs: [] }).profession)
      .toBe('profession_no_specialties')
    expect(validateSpecialtySelection('receptionist', EMPTY_SELECTION)).toEqual({})
  })

  it('pharmacist may select pharmacy + clinical_pharmacy', () => {
    expect(validateSpecialtySelection('pharmacist', { primary: 'pharmacy', secondaries: [], subs: ['clinical_pharmacy'] }))
      .toEqual({})
    expect(validateSpecialtySelection('pharmacist', { primary: 'cardiology', secondaries: [], subs: [] }).primary)
      .toBe('primary_not_allowed')
  })
})

// ── Normalisation + resolution (tolerant read side) ────────────────
describe('normalizeSelection / resolveSpecialtySelection', () => {
  it('drops unknowns, duplicates and orphaned subs instead of failing', () => {
    expect(normalizeSelection('doctor', {
      primary: 'cardiology',
      secondaries: ['cardiology', 'bogus', 'internal_medicine', 'internal_medicine'],
      subs: ['echocardiography', 'neonatology', 'nope'],   // neonatology's parent not selected
    })).toEqual({
      primary: 'cardiology',
      secondaries: ['internal_medicine'],
      subs: ['echocardiography'],
    })
  })

  it('forces an empty selection for a profession without specialties', () => {
    expect(normalizeSelection('cashier', { primary: 'cardiology', secondaries: ['obgyn'], subs: [] }))
      .toEqual(EMPTY_SELECTION)
  })

  it('resolves the identity chain and silently drops unknown ids', () => {
    const r = resolveSpecialtySelection({
      primarySpecialty: 'obgyn',
      secondarySpecialties: ['cardiology', 'ghost'],
      subSpecialties: ['obstetric_ultrasound', 'ghost_sub'],
    })
    expect(r.primary?.id).toBe('obgyn')
    expect(r.secondaries.map(s => s.id)).toEqual(['cardiology'])
    expect(r.subs).toHaveLength(1)
    expect(r.subs[0].def.id).toBe('obstetric_ultrasound')
    expect(r.subs[0].parent.id).toBe('obgyn')
  })

  it('null profile → fully empty resolution (missing migration/profile fallback)', () => {
    expect(resolveSpecialtySelection(null)).toEqual({ primary: null, secondaries: [], subs: [] })
    expect(resolveSpecialtySelection(undefined)).toEqual({ primary: null, secondaries: [], subs: [] })
  })
})

// ── Migration tolerance through the profile mapper ──────────────────
describe('profile mapper tolerance (un-applied 038/039)', () => {
  it('fallback profile carries an empty specialty selection', () => {
    const p = fallbackProfile('u1', 'c1')
    expect(p.primarySpecialty).toBeNull()
    expect(p.secondarySpecialties).toEqual([])
    expect(p.subSpecialties).toEqual([])
  })

  it('a row missing the 039 column / 038 arrays normalises to empty, not an error', () => {
    const p = normalizeProfile({ user_id: 'u1', clinic_id: 'c1', profession: 'doctor' }, 'u1', 'c1')
    expect(p.primarySpecialty).toBeNull()
    expect(p.secondarySpecialties).toEqual([])
    expect(p.subSpecialties).toEqual([])
  })

  it('reads well-formed selections and tolerates malformed JSONB', () => {
    const good = normalizeProfile({
      user_id: 'u1', clinic_id: 'c1',
      primary_specialty: 'cardiology',
      secondary_specialties: ['internal_medicine'],
      sub_specialties: '["echocardiography"]',   // JSON string form
    }, 'u1', 'c1')
    expect(good.primarySpecialty).toBe('cardiology')
    expect(good.secondarySpecialties).toEqual(['internal_medicine'])
    expect(good.subSpecialties).toEqual(['echocardiography'])

    const bad = normalizeProfile({
      user_id: 'u1', clinic_id: 'c1',
      secondary_specialties: 'not-json{', sub_specialties: 42,
    } as never, 'u1', 'c1')
    expect(bad.secondarySpecialties).toEqual([])
    expect(bad.subSpecialties).toEqual([])
  })

  it('parseStringArray drops non-strings', () => {
    expect(parseStringArray(['a', 1, null, 'b'])).toEqual(['a', 'b'])
    expect(parseStringArray(null)).toEqual([])
  })
})

// ── Decoupling gate (Specialty ≠ Copilot Pack) ──────────────────────
describe('security & decoupling invariants', () => {
  it('taxonomy + selection import no pack/workspace/AI/renderer/Supabase code', () => {
    for (const file of ['taxonomy.ts', 'selection.ts']) {
      const src = readFileSync(join(__dirname, '..', 'specialties', file), 'utf8')
      expect(src).not.toMatch(/from '@\/lib\/(workspace|widgets|templates|actions|ai|packs|pathways)/)
      expect(src).not.toMatch(/from '@\/lib\/specialties\/index/)   // 14.1 workspace defs stay separate
      expect(src).not.toMatch(/createClient|service_role|supabase/i)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })

  it('isSpecialtyAllowedForProfession is pure data — no role/RBAC mutation surface', () => {
    // Compatibility answers a QUESTION; it cannot grant anything.
    expect(isSpecialtyAllowedForProfession('nurse', 'nursing')).toBe(true)
    expect(isSpecialtyAllowedForProfession('nurse', 'cardiology')).toBe(false)
  })
})
