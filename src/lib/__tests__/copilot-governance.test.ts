import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseClinicPackRecords, parsePackEnablement, clampCapabilityLevel,
  resolveEffectivePacks, effectivelyEnabledPacks, canProfessionalToggle,
  type ClinicPackRecord, type PackEnablement,
} from '../copilot-packs/governance'
import {
  detectVersionState, isUpgradeAvailable, pendingUpgrades, packsNeedingAttention, migrationPathFor,
} from '../copilot-packs/lifecycle'
import { COPILOT_PACKS, getCopilotPack, PLATFORM_VERSION } from '../copilot-packs/registry'
import type { PackContext } from '../copilot-packs/compatibility'

// Reusable context: a cardiologist doctor.
const CARDIO_CTX: PackContext = { professionId: 'doctor', primarySpecialty: 'cardiology' }
const CARDIO = getCopilotPack('cardiology.core')!

function record(over: Partial<ClinicPackRecord> = {}): ClinicPackRecord {
  return {
    packId: 'cardiology.core', status: 'installed', lifecycleStage: 'stable',
    currentVersion: '1.0.0', previousVersion: null, requirement: 'optional',
    hidden: false, locked: false, minCapabilityLevel: null, maxCapabilityLevel: null,
    capabilityLevel: null, installedBy: null, installedAt: null, ...over,
  }
}

// ── Tolerant parsers (migration tolerance) ──────────────────────────
describe('parsers — tolerant of un-applied migrations / bad data', () => {
  it('parseClinicPackRecords maps rows and defaults missing columns', () => {
    const recs = parseClinicPackRecords([
      { pack_id: 'cardiology.core', status: 'installed' },
      { pack_id: 'pharmacy.core', requirement: 'mandatory', hidden: true, locked: true, min_capability_level: 'basic', max_capability_level: 'expert' },
      { nope: 1 }, // dropped (no pack_id)
    ])
    expect(recs).toHaveLength(2)
    expect(recs[0].lifecycleStage).toBe('stable')          // default
    expect(recs[0].requirement).toBe('optional')            // default
    expect(recs[1].requirement).toBe('mandatory')
    expect(recs[1].hidden).toBe(true)
    expect(recs[1].minCapabilityLevel).toBe('basic')
  })

  it('parseClinicPackRecords → [] for non-arrays', () => {
    expect(parseClinicPackRecords(null)).toEqual([])
    expect(parseClinicPackRecords('x')).toEqual([])
  })

  it('parsePackEnablement handles object, JSON string, and garbage', () => {
    expect(parsePackEnablement({ 'a.core': { enabled: true, pinned: true } })).toEqual({ 'a.core': { enabled: true, preferred: false, pinned: true, favorite: false, level: null } })
    expect(parsePackEnablement('{"b.core":{"enabled":true}}')['b.core'].enabled).toBe(true)
    expect(parsePackEnablement('not-json')).toEqual({})
    expect(parsePackEnablement(null)).toEqual({})
    expect(parsePackEnablement(['x'])).toEqual({})
    expect(parsePackEnablement({ 'c.core': { level: 'wizard' } })['c.core'].level).toBeNull() // bad level → null
  })
})

// ── Capability-level clamping ───────────────────────────────────────
describe('clampCapabilityLevel', () => {
  it('clamps into the clinic [min,max] window within the pack ladder', () => {
    // cardiology.core offers basic/advanced/expert.
    expect(clampCapabilityLevel('expert', CARDIO, 'basic', 'advanced')).toBe('advanced') // above max → max
    expect(clampCapabilityLevel('basic', CARDIO, 'advanced', 'expert')).toBe('advanced')  // below min → min
    expect(clampCapabilityLevel('advanced', CARDIO, 'basic', 'expert')).toBe('advanced')  // in range → itself
  })
  it('returns null when nothing is desired and no constraint', () => {
    expect(clampCapabilityLevel(null, CARDIO, null, null)).toBeNull()
  })
  it('ignores a level from the wrong ladder by snapping into offered', () => {
    // 'operator' (workflow) isn't offered by a proficiency pack → snaps to lowest allowed.
    expect(clampCapabilityLevel('operator', CARDIO, null, null)).toBe('basic')
  })
})

// ── Governance resolution engine ────────────────────────────────────
describe('resolveEffectivePacks — precedence & gates', () => {
  const base = { catalog: [CARDIO], context: CARDIO_CTX, enablement: {} as Record<string, PackEnablement> }

  it('not installed → unavailable', () => {
    const [s] = resolveEffectivePacks({ ...base, clinicRecords: [] })
    expect(s.available).toBe(false)
    expect(s.reasons).toContain('not_installed')
    expect(s.effectivelyEnabled).toBe(false)
  })

  it('clinic-disabled → unavailable', () => {
    const [s] = resolveEffectivePacks({ ...base, clinicRecords: [record({ status: 'disabled' })] })
    expect(s.reasons).toContain('clinic_disabled')
    expect(s.available).toBe(false)
  })

  it('incompatible profession/specialty → unavailable', () => {
    const [s] = resolveEffectivePacks({ ...base, context: { professionId: 'nurse', primarySpecialty: 'nursing' }, clinicRecords: [record()] })
    expect(s.reasons).toContain('incompatible')
    expect(s.available).toBe(false)
  })

  it('MANDATORY → enabled, cannot toggle', () => {
    const [s] = resolveEffectivePacks({ ...base, clinicRecords: [record({ requirement: 'mandatory' })] })
    expect(s.available).toBe(true)
    expect(s.effectivelyEnabled).toBe(true)
    expect(s.canToggle).toBe(false)
    expect(s.source).toBe('mandatory')
  })

  it('LOCKED → cannot toggle; effective follows stored enablement', () => {
    const on = resolveEffectivePacks({ ...base, clinicRecords: [record({ locked: true })], enablement: { 'cardiology.core': { enabled: true } } })[0]
    expect(on.canToggle).toBe(false)
    expect(on.effectivelyEnabled).toBe(true)
    expect(on.source).toBe('locked')
    const off = resolveEffectivePacks({ ...base, clinicRecords: [record({ locked: true })], enablement: {} })[0]
    expect(off.effectivelyEnabled).toBe(false)
  })

  it('OPTIONAL → professional opt-in decides, can toggle', () => {
    const optIn = resolveEffectivePacks({ ...base, clinicRecords: [record()], enablement: { 'cardiology.core': { enabled: true, pinned: true, favorite: true } } })[0]
    expect(optIn.effectivelyEnabled).toBe(true)
    expect(optIn.canToggle).toBe(true)
    expect(optIn.source).toBe('professional')
    expect(optIn.pinned).toBe(true)
    expect(optIn.favorite).toBe(true)
    expect(optIn.reasons).toContain('professional_opt_in')

    const optOut = resolveEffectivePacks({ ...base, clinicRecords: [record()], enablement: {} })[0]
    expect(optOut.effectivelyEnabled).toBe(false)
    expect(optOut.reasons).toContain('professional_opt_out')
  })

  it('applies capability-level clamp to the effective level', () => {
    const [s] = resolveEffectivePacks({
      ...base,
      clinicRecords: [record({ minCapabilityLevel: 'advanced', maxCapabilityLevel: 'expert' })],
      enablement: { 'cardiology.core': { enabled: true, level: 'basic' } },
    })
    expect(s.effectiveLevel).toBe('advanced') // basic clamped up to clinic min
  })

  it('effectivelyEnabledPacks returns only the ON packs', () => {
    const input = {
      catalog: [CARDIO, getCopilotPack('pharmacy.core')!],
      context: CARDIO_CTX,
      clinicRecords: [record({ requirement: 'mandatory' }), record({ packId: 'pharmacy.core' })],
      enablement: {},
    }
    const on = effectivelyEnabledPacks(input).map(p => p.packId)
    expect(on).toEqual(['cardiology.core']) // pharmacy incompatible for a cardiologist + opt-out
  })

  it('is deterministic', () => {
    const input = { ...base, clinicRecords: [record()] }
    expect(resolveEffectivePacks(input)).toEqual(resolveEffectivePacks(input))
  })
})

describe('canProfessionalToggle', () => {
  it('false for mandatory / locked / not-installed', () => {
    expect(canProfessionalToggle(record())).toBe(true)
    expect(canProfessionalToggle(record({ requirement: 'mandatory' }))).toBe(false)
    expect(canProfessionalToggle(record({ locked: true }))).toBe(false)
    expect(canProfessionalToggle(record({ status: 'disabled' }))).toBe(false)
    expect(canProfessionalToggle(null)).toBe(false)
  })
})

// ── Version / lifecycle management ──────────────────────────────────
describe('version management', () => {
  it('detects up_to_date / upgrade_available / ahead', () => {
    expect(detectVersionState(record({ currentVersion: '1.0.0' }), CARDIO).state).toBe('up_to_date')
    expect(detectVersionState(record({ currentVersion: '0.9.0' }), CARDIO).state).toBe('upgrade_available')
    expect(detectVersionState(record({ currentVersion: '0.9.0' }), CARDIO).upgradeAvailable).toBe(true)
    expect(detectVersionState(record({ currentVersion: '2.0.0' }), CARDIO).state).toBe('ahead')
  })

  it('detects deprecation (manifest, record status, or retired stage)', () => {
    expect(detectVersionState(record({ status: 'deprecated' }), CARDIO).deprecated).toBe(true)
    expect(detectVersionState(record({ lifecycleStage: 'retired' }), CARDIO).state).toBe('deprecated')
    expect(detectVersionState(record(), { ...CARDIO, status: 'deprecated' }).state).toBe('deprecated')
  })

  it('detects incompatibility (pack needs a newer platform)', () => {
    const info = detectVersionState(record(), { ...CARDIO, minPlatformVersion: '99.0.0' })
    expect(info.incompatible).toBe(true)
    expect(info.state).toBe('incompatible')
  })

  it('a missing manifest → unknown + deprecated (retired/removed)', () => {
    const info = detectVersionState(record(), null)
    expect(info.state).toBe('unknown')
    expect(info.deprecated).toBe(true)
  })

  it('pendingUpgrades / packsNeedingAttention scan the clinic', () => {
    const recs = [record({ currentVersion: '0.9.0' }), record({ packId: 'pharmacy.core', status: 'deprecated', currentVersion: '1.0.0' })]
    expect(pendingUpgrades(recs, COPILOT_PACKS).map(v => v.packId)).toEqual(['cardiology.core'])
    expect(packsNeedingAttention(recs, COPILOT_PACKS).map(v => v.packId)).toEqual(['pharmacy.core'])
    expect(isUpgradeAvailable(record({ currentVersion: '0.1.0' }), CARDIO)).toBe(true)
  })

  it('migrationPathFor describes a transition but implements no migration', () => {
    const path = migrationPathFor(record({ currentVersion: '0.9.0' }), CARDIO)
    expect(path).toEqual({ packId: 'cardiology.core', from: '0.9.0', to: CARDIO.version, hasMigration: false })
    expect(migrationPathFor(record({ currentVersion: '1.0.0' }), CARDIO)).toBeNull() // no upgrade → no path
  })

  it('uses the shipped platform version by default', () => {
    expect(detectVersionState(record(), CARDIO, PLATFORM_VERSION).incompatible).toBe(false)
  })
})

// ── Decoupling & migration-shape gates ──────────────────────────────
describe('governance decoupling & migration safety', () => {
  const DIR = join(__dirname, '..', 'copilot-packs')
  it('governance/lifecycle import NO renderer / widget / AI / pathway / specialty / profession module', () => {
    for (const f of ['governance.ts', 'lifecycle.ts']) {
      const src = readFileSync(join(DIR, f), 'utf8')
      expect(src).not.toMatch(/from '@\/(lib|hooks)\/(workspace|widgets|templates|actions|ai|pathways|specialties|professions)/)
      expect(src).not.toMatch(/createClient|service_role|supabase/i)
      expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
    }
  })

  it('migration 041 is column-only: NO new table, NO new FK, NO policy change', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '041_pack_governance.sql'), 'utf8')
    expect(sql).not.toMatch(/CREATE TABLE/)
    expect(sql).not.toMatch(/REFERENCES/)          // no new foreign key
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/)
    expect(sql).toMatch(/pack_enablement JSONB/)
  })
})
