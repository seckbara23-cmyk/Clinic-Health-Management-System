import { readFileSync } from 'fs'
import { join } from 'path'
import {
  COPILOT_PACKS, PLATFORM_VERSION, getCopilotPack, isRegisteredPack, packsByCategory, activePacks,
} from '../copilot-packs/registry'
import {
  CAPABILITY_LEVELS, getCapabilityLevel, isCapabilityLevel, isSingleLadder, ladderOf,
} from '../copilot-packs/capability-levels'
import {
  compareVersions, satisfiesMinVersion, duplicatePackIds, missingDependencies,
  versionConflicts, optionalExtensionsOf, resolveDependencies, detectCircularDependencies,
} from '../copilot-packs/dependencies'
import {
  validatePackCompatibility, packsForContext,
} from '../copilot-packs/compatibility'
import type { CopilotPackManifest } from '../copilot-packs/types'
import { PROFESSIONS } from '../professions'
import { isRegisteredClinicalSpecialty } from '../specialties/taxonomy'

const REQUIRED_PACKS = [
  'general_practice.core', 'pediatrics.core', 'obstetrics.core', 'cardiology.core',
  'ent.core', 'radiology.core', 'pharmacy.core', 'laboratory.core', 'emergency.core',
  'internal_medicine.core', 'orthopedics.core', 'ophthalmology.core', 'psychiatry.core',
  'pulmonology.core', 'nephrology.core', 'oncology.core', 'surgery.core', 'neurology.core', 'endocrinology.core', 'dermatology.core', 'urology.core', 'dentistry.core', 'nursing.core', 'midwifery.core',
]

const FUTURE_LISTS: (keyof CopilotPackManifest)[] = [
  'futureAiToolIds', 'futureWidgetIds', 'futureTemplateIds', 'futureReportIds',
  'futureQuickActionIds', 'futureTimelineEventTypes', 'futureDocHelperIds',
  'futurePrintFormIds', 'futurePathwayIds',
]

// Fixtures for the dependency engine (kept out of the shipped registry).
const P = (id: string, deps: { id: string; minVersion?: string }[] = [], version = '1.0.0'): CopilotPackManifest => ({
  ...COPILOT_PACKS[0], id, code: id.toUpperCase(), labelKey: 'x', descKey: 'x',
  version, dependsOn: deps, optionalDependsOn: [],
})

// ── Registry integrity ──────────────────────────────────────────────
describe('Copilot Pack Registry — integrity', () => {
  it('contains all 24 required core packs', () => {
    const ids = COPILOT_PACKS.map(p => p.id)
    for (const id of REQUIRED_PACKS) expect(ids).toContain(id)
    expect(COPILOT_PACKS.length).toBe(24)
  })

  it('has unique pack ids and unique codes (duplicate detection)', () => {
    expect(duplicatePackIds()).toEqual([])
    const codes = COPILOT_PACKS.map(p => p.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('placeholder cores are METADATA ONLY (empty future*); the shipped copilots are populated', () => {
    // Phases 16-35 populated GP / pediatrics / obstetrics / ENT / cardiology / emergency /
    // internal-medicine / orthopedics / ophthalmology / psychiatry / pulmonology / nephrology / oncology / general-surgery / neurology / endocrinology / dermatology / urology.
    const REAL = new Set(['general_practice.core', 'pediatrics.core', 'obstetrics.core', 'ent.core', 'cardiology.core', 'emergency.core', 'internal_medicine.core', 'orthopedics.core', 'ophthalmology.core', 'psychiatry.core', 'pulmonology.core', 'nephrology.core', 'oncology.core', 'surgery.core', 'neurology.core', 'endocrinology.core', 'dermatology.core', 'urology.core'])
    for (const p of COPILOT_PACKS) {
      if (REAL.has(p.id)) continue
      for (const key of FUTURE_LISTS) expect(p[key]).toEqual([])
    }
    for (const id of REAL) {
      const pack = getCopilotPack(id)!
      expect(pack.futureTemplateIds.length).toBeGreaterThan(0)
      expect(pack.futureAiToolIds.length).toBeGreaterThan(0)
    }
  })

  it('every pack is active, versioned and platform-negotiable', () => {
    for (const p of COPILOT_PACKS) {
      expect(p.status).toBe('active')
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(satisfiesMinVersion(PLATFORM_VERSION, p.minPlatformVersion)).toBe(true)
      expect(p.schemaVersion).toBeGreaterThanOrEqual(1)
      expect(p.publisher).toBe('chms')
    }
  })

  it('every requiredProfession references a REAL profession (referential integrity)', () => {
    const known = new Set(PROFESSIONS.map(p => p.id))
    for (const p of COPILOT_PACKS) {
      expect(p.requiredProfessions.length).toBeGreaterThan(0)
      for (const prof of p.requiredProfessions) expect(known.has(prof)).toBe(true)
    }
  })

  it('every supportedSpecialty references a REAL specialty (referential integrity)', () => {
    for (const p of COPILOT_PACKS) {
      expect(p.supportedSpecialties.length).toBeGreaterThan(0)
      for (const sp of p.supportedSpecialties) expect(isRegisteredClinicalSpecialty(sp)).toBe(true)
    }
  })

  it('every pack offers capability levels from a SINGLE ladder', () => {
    for (const p of COPILOT_PACKS) {
      expect(p.capabilityLevels.length).toBeGreaterThan(0)
      for (const l of p.capabilityLevels) expect(isCapabilityLevel(l)).toBe(true)
      expect(isSingleLadder(p.capabilityLevels)).toBe(true)
    }
  })

  it('lookups never throw', () => {
    expect(getCopilotPack('cardiology.core')?.code).toBe('CARDIO-CORE')
    expect(getCopilotPack('nope')).toBeNull()
    expect(getCopilotPack(null)).toBeNull()
    expect(isRegisteredPack('pharmacy.core')).toBe(true)
    expect(isRegisteredPack('')).toBe(false)
    expect(packsByCategory('diagnostic').map(p => p.id).sort()).toEqual(['laboratory.core', 'radiology.core'])
    expect(activePacks().length).toBe(24)
  })
})

// ── Capability levels ───────────────────────────────────────────────
describe('Capability Levels', () => {
  it('registers the 7 required levels across two ladders', () => {
    expect(CAPABILITY_LEVELS.map(l => l.id)).toEqual(
      ['basic', 'advanced', 'expert', 'observer', 'operator', 'reviewer', 'trainer'],
    )
    expect(ladderOf('basic')).toBe('proficiency')
    expect(ladderOf('operator')).toBe('workflow')
    expect(getCapabilityLevel('bogus')).toBeNull()
  })
  it('isSingleLadder rejects a mixed ladder', () => {
    expect(isSingleLadder(['basic', 'advanced'])).toBe(true)
    expect(isSingleLadder(['basic', 'operator'])).toBe(false)
  })
})

// ── semver ──────────────────────────────────────────────────────────
describe('version comparison', () => {
  it('compares dotted numeric versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
  it('satisfiesMinVersion', () => {
    expect(satisfiesMinVersion('14.2.4', '14.2.0')).toBe(true)
    expect(satisfiesMinVersion('14.1.0', '14.2.0')).toBe(false)
    expect(satisfiesMinVersion('1.0.0')).toBe(true) // no min → always ok
  })
})

// ── Dependency engine (deterministic) ───────────────────────────────
describe('dependency engine', () => {
  it('the shipped registry has NO missing or circular dependencies', () => {
    expect(detectCircularDependencies()).toEqual([])
    for (const p of COPILOT_PACKS) {
      expect(missingDependencies(p)).toEqual([])
      expect(versionConflicts(p)).toEqual([])
    }
  })

  it('resolves a linear chain in dependency order (deps before dependants)', () => {
    const reg = [P('a'), P('b', [{ id: 'a' }]), P('c', [{ id: 'b' }])]
    const r = resolveDependencies('c', reg)
    expect(r.ok).toBe(true)
    expect(r.order).toEqual(['a', 'b', 'c'])
    // Deterministic: same inputs → same output.
    expect(resolveDependencies('c', reg).order).toEqual(['a', 'b', 'c'])
  })

  it('detects a MISSING dependency', () => {
    const reg = [P('a', [{ id: 'ghost' }])]
    const r = resolveDependencies('a', reg)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('ghost')
  })

  it('detects a CIRCULAR dependency', () => {
    const reg = [P('a', [{ id: 'b' }]), P('b', [{ id: 'a' }])]
    const r = resolveDependencies('a', reg)
    expect(r.ok).toBe(false)
    expect(r.circular.sort()).toEqual(['a', 'b'])
    expect(detectCircularDependencies(reg).sort()).toEqual(['a', 'b'])
  })

  it('detects a VERSION conflict (available < required min)', () => {
    const reg = [P('a', [], '1.0.0'), P('b', [{ id: 'a', minVersion: '2.0.0' }])]
    const r = resolveDependencies('b', reg)
    expect(r.ok).toBe(false)
    expect(r.versionConflicts).toEqual([{ dependency: 'a', required: '2.0.0', available: '1.0.0' }])
    expect(versionConflicts(reg[1], reg)).toHaveLength(1)
  })

  it('finds optional extensions of a pack (C optionally extends A)', () => {
    const c = { ...P('c'), optionalDependsOn: [{ id: 'a' }] }
    expect(optionalExtensionsOf('a', [P('a'), c])).toEqual(['c'])
  })
})

// ── Compatibility engine (validation only) ─────────────────────────
describe('compatibility engine', () => {
  const cardio = getCopilotPack('cardiology.core')!
  const radiology = getCopilotPack('radiology.core')!
  const pharmacy = getCopilotPack('pharmacy.core')!

  it('a cardiologist doctor is fully compatible with Cardiology Core', () => {
    const r = validatePackCompatibility(cardio, {
      professionId: 'doctor', primarySpecialty: 'cardiology', capabilityLevel: 'advanced',
    })
    expect(r.compatible).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('flags profession incompatibility', () => {
    const r = validatePackCompatibility(cardio, { professionId: 'nurse', primarySpecialty: 'cardiology' })
    expect(r.professionCompatible).toBe(false)
    expect(r.errors).toContain('profession_incompatible')
  })

  it('accepts a specialty match via a SECONDARY specialty', () => {
    const r = validatePackCompatibility(cardio, {
      professionId: 'doctor', primarySpecialty: 'general_practice', secondarySpecialties: ['cardiology'],
    })
    expect(r.primarySpecialtyCompatible).toBe(false)
    expect(r.secondarySpecialtyCompatible).toBe(true)
    expect(r.errors).not.toContain('specialty_incompatible')
  })

  it('flags specialty incompatibility when neither primary nor secondary match', () => {
    const r = validatePackCompatibility(cardio, {
      professionId: 'doctor', primarySpecialty: 'dermatology', secondarySpecialties: ['ent'],
    })
    expect(r.errors).toEqual(expect.arrayContaining(['specialty_incompatible', 'primary_specialty_incompatible', 'secondary_specialty_incompatible']))
  })

  it('flags an unsupported capability level (workflow level on a proficiency pack)', () => {
    const r = validatePackCompatibility(cardio, { professionId: 'doctor', primarySpecialty: 'cardiology', capabilityLevel: 'operator' })
    expect(r.capabilityLevelCompatible).toBe(false)
    expect(r.errors).toContain('capability_level_unsupported')
  })

  it('radiology core accepts the workflow ladder (operator)', () => {
    const r = validatePackCompatibility(radiology, { professionId: 'radiographer', primarySpecialty: 'radiology', capabilityLevel: 'operator' })
    expect(r.compatible).toBe(true)
  })

  it('flags platform too old', () => {
    const r = validatePackCompatibility(cardio, { professionId: 'doctor', primarySpecialty: 'cardiology', platformVersion: '14.1.0' })
    expect(r.errors).toContain('platform_too_old')
  })

  it('flags clinic installation + dependency-not-installed', () => {
    const notInstalled = validatePackCompatibility(pharmacy, { professionId: 'pharmacist', primarySpecialty: 'pharmacy', installedPackIds: [] })
    expect(notInstalled.installed).toBe(false)
    expect(notInstalled.errors).toContain('not_installed')

    const withDep = { ...pharmacy, dependsOn: [{ id: 'general_practice.core' }] }
    const depMissing = validatePackCompatibility(withDep, { professionId: 'pharmacist', primarySpecialty: 'pharmacy', installedPackIds: ['pharmacy.core'] })
    expect(depMissing.errors).toContain('dependency_not_installed')
  })

  it('packsForContext returns only profession+specialty-compatible packs', () => {
    const ids = packsForContext({ professionId: 'pharmacist', primarySpecialty: 'pharmacy' }).map(p => p.id)
    expect(ids).toEqual(['pharmacy.core'])
    const docIds = packsForContext({ professionId: 'doctor', primarySpecialty: 'cardiology' }).map(p => p.id)
    expect(docIds).toContain('cardiology.core')
    expect(docIds).not.toContain('pharmacy.core')
  })
})

// ── Localization completeness ───────────────────────────────────────
describe('localization', () => {
  const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))

  it('every pack name/description exists in BOTH fr and en', () => {
    for (const p of COPILOT_PACKS) {
      expect(fr.copilotPacks[p.labelKey]).toBeTruthy()
      expect(en.copilotPacks[p.labelKey]).toBeTruthy()
      expect(fr.copilotPacks[p.descKey]).toBeTruthy()
      expect(en.copilotPacks[p.descKey]).toBeTruthy()
    }
  })

  it('every capability level label exists in BOTH fr and en', () => {
    for (const l of CAPABILITY_LEVELS) {
      expect(fr.copilotPacks[l.labelKey]).toBeTruthy()
      expect(en.copilotPacks[l.labelKey]).toBeTruthy()
    }
  })

  it('fr and en copilotPacks key sets are identical (parity)', () => {
    expect(Object.keys(fr.copilotPacks).sort()).toEqual(Object.keys(en.copilotPacks).sort())
  })
})

// ── Decoupling gate (frozen boundaries) ─────────────────────────────
describe('decoupling invariants', () => {
  const DIR = join(__dirname, '..', 'copilot-packs')
  const files = ['types.ts', 'registry.ts', 'capability-levels.ts', 'dependencies.ts', 'compatibility.ts']

  it('the registry imports NO renderer / widget / template / AI / pathway / specialty / profession module', () => {
    for (const f of files) {
      const src = readFileSync(join(DIR, f), 'utf8')
      expect(src).not.toMatch(/from '@\/lib\/(workspace|widgets|templates|actions|ai|pathways|specialties|professions)/)
      expect(src).not.toMatch(/createClient|service_role|supabase/i)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })

  it('the migration creates a single-FK, surrogate-PK table (no PostgREST junction)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '040_copilot_packs.sql'), 'utf8')
    expect(sql).toMatch(/id\s+UUID PRIMARY KEY/)              // surrogate PK
    expect(sql).toMatch(/UNIQUE \(clinic_id, pack_id\)/)      // uniqueness, not a composite PK
    // pack_id is TEXT, not a FK — exactly one REFERENCES to a real table besides users.
    expect(sql).not.toMatch(/PRIMARY KEY \(clinic_id/)        // never a composite-FK PK
  })
})
