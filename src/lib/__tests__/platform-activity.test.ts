import { readFileSync } from 'fs'
import { join } from 'path'
import {
  resolveDateRange, parsePlatformOverview, EMPTY_OVERVIEW, activityTotal,
  filterClinicRows, sumBy, maskId, orderedEntries,
  CLINIC_STATUS_ORDER, SUBSCRIPTION_PLAN_ORDER, STAFF_ROLE_ORDER,
} from '../platform-activity'

const NOW = new Date('2026-07-06T15:30:00.000Z') // Monday

// ── Date range resolution (deterministic, given `now`) ──────────────
describe('resolveDateRange', () => {
  it('today = UTC start-of-day through now', () => {
    const r = resolveDateRange('today', NOW)
    expect(r.from).toBe('2026-07-06T00:00:00.000Z')
    expect(r.to).toBe(NOW.toISOString())
  })
  it('yesterday = the previous UTC calendar day, exclusive of today', () => {
    const r = resolveDateRange('yesterday', NOW)
    expect(r.from).toBe('2026-07-05T00:00:00.000Z')
    expect(r.to).toBe('2026-07-06T00:00:00.000Z')
  })
  it('7d = exactly 7*24h back from now', () => {
    const r = resolveDateRange('7d', NOW)
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(7 * 86_400_000)
    expect(r.to).toBe(NOW.toISOString())
  })
  it('30d = exactly 30*24h back from now', () => {
    const r = resolveDateRange('30d', NOW)
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(30 * 86_400_000)
  })
  it('custom uses the provided from/to', () => {
    const r = resolveDateRange('custom', NOW, { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' })
    expect(r).toEqual({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' })
  })
  it('custom with an inverted range is corrected, never silently wrong', () => {
    const r = resolveDateRange('custom', NOW, { from: '2026-02-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' })
    expect(r.from < r.to).toBe(true)
  })
  it('custom with missing/invalid dates falls back to a safe 30-day window', () => {
    const r1 = resolveDateRange('custom', NOW, {})
    expect(new Date(r1.to).getTime() - new Date(r1.from).getTime()).toBe(30 * 86_400_000)
    const r2 = resolveDateRange('custom', NOW, { from: 'not-a-date', to: 'also-not' })
    expect(new Date(r2.to).getTime() - new Date(r2.from).getTime()).toBe(30 * 86_400_000)
  })
  it('never throws on an unrecognised filter', () => {
    // @ts-expect-error deliberately invalid input
    expect(() => resolveDateRange('bogus', NOW)).not.toThrow()
  })
})

// ── Tolerant overview parser ─────────────────────────────────────────
describe('parsePlatformOverview', () => {
  it('parses a well-formed payload', () => {
    const parsed = parsePlatformOverview({
      clinics_total: 12, clinics_by_status: { active: 10, pending: 2 },
      clinics_by_plan: { free: 5, pro: 7 }, clinics_new_7d: 1, clinics_new_30d: 3,
      users_total: 40, users_active: 38, users_by_role: { doctor: 20, nurse: 10 },
    })
    expect(parsed.clinicsTotal).toBe(12)
    expect(parsed.clinicsByStatus).toEqual({ active: 10, pending: 2 })
    expect(parsed.usersByRole).toEqual({ doctor: 20, nurse: 10 })
  })
  it('null/undefined/non-object → the empty overview (never throws)', () => {
    expect(parsePlatformOverview(null)).toEqual(EMPTY_OVERVIEW)
    expect(parsePlatformOverview(undefined)).toEqual(EMPTY_OVERVIEW)
    expect(parsePlatformOverview('a string')).toEqual(EMPTY_OVERVIEW)
    expect(parsePlatformOverview(42)).toEqual(EMPTY_OVERVIEW)
  })
  it('malformed sub-fields degrade individually to safe defaults', () => {
    const parsed = parsePlatformOverview({
      clinics_total: 'not-a-number', clinics_by_status: 'not-an-object', clinics_by_plan: ['array'],
      users_by_role: null,
    })
    expect(parsed.clinicsTotal).toBe(0)
    expect(parsed.clinicsByStatus).toEqual({})
    expect(parsed.clinicsByPlan).toEqual({})
    expect(parsed.usersByRole).toEqual({})
  })
})

// ── Activity aggregation helpers ──────────────────────────────────────
describe('activityTotal / sumBy', () => {
  it('sums all five operational counters', () => {
    expect(activityTotal({
      appointmentsCount: 5, consultationsCount: 3, invoicesCount: 2, labOrdersCount: 1, dispensingCount: 4,
    })).toBe(15)
  })
  it('sumBy reduces a numeric field across rows', () => {
    expect(sumBy([{ n: 1 }, { n: 2 }, { n: 3 }], r => r.n)).toBe(6)
    expect(sumBy([], (r: { n: number }) => r.n)).toBe(0)
  })
})

describe('filterClinicRows', () => {
  const rows = [{ clinicName: 'Clinique Étoile' }, { clinicName: 'Cabinet Médical Dakar' }, { clinicName: 'Polyclinique Nord' }]
  it('is case-insensitive', () => {
    expect(filterClinicRows(rows, 'DAKAR')).toHaveLength(1)
  })
  it('is diacritic-insensitive (Étoile matches "etoile")', () => {
    expect(filterClinicRows(rows, 'etoile')).toHaveLength(1)
  })
  it('an empty/blank query returns everything unfiltered', () => {
    expect(filterClinicRows(rows, '')).toEqual(rows)
    expect(filterClinicRows(rows, '   ')).toEqual(rows)
  })
  it('no match → []', () => {
    expect(filterClinicRows(rows, 'zzz-no-match')).toEqual([])
  })
})

// ── Masking (privacy: never a raw identifier in the UI) ─────────────
describe('maskId', () => {
  it('shows only a short, non-reversible-looking prefix', () => {
    expect(maskId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4…')
    expect(maskId(null)).toBe('—')
    expect(maskId(undefined)).toBe('—')
    expect(maskId('')).toBe('—')
  })
  it('never reveals the full id', () => {
    const full = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(maskId(full)).not.toContain(full.replace(/-/g, ''))
  })
})

// ── Ordered breakdown entries ────────────────────────────────────────
describe('orderedEntries', () => {
  it('orders known keys first, per the given order, then appends unknowns', () => {
    const map = { pending: 2, active: 10, mystery_status: 1 }
    expect(orderedEntries(map, CLINIC_STATUS_ORDER)).toEqual([
      ['active', 10], ['pending', 2], ['mystery_status', 1],
    ])
  })
  it('omits order entries absent from the map', () => {
    expect(orderedEntries({ pro: 3 }, SUBSCRIPTION_PLAN_ORDER)).toEqual([['pro', 3]])
  })
  it('empty map → []', () => {
    expect(orderedEntries({}, STAFF_ROLE_ORDER)).toEqual([])
  })
})

// ── Architectural independence (frozen requirement) ──────────────────
describe('architectural independence from clinical/Healthcare-OS modules', () => {
  it('platform-activity.ts imports NOTHING from Clinical Copilot / Workspace / Specialty / Pathway / AI modules', () => {
    const src = readFileSync(join(__dirname, '..', 'platform-activity.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/(lib|hooks)\/(copilot-packs|workspace|specialties|professions|pathways|ai)/)
    expect(src).not.toMatch(/import[^\n]*supabase/i)
    expect(src).not.toMatch(/createClient|service_role/)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/)
  })
})

// ── Privacy & security invariants over the hook + migration ──────────
describe('privacy invariants — no clinical data path', () => {
  const HOOK_SRC = readFileSync(join(__dirname, '..', '..', 'hooks', 'usePlatformActivity.ts'), 'utf8')
  const SQL_SRC = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '042_platform_activity.sql'), 'utf8')

  it('the hook never selects a clinical/PII table directly — only RPCs, admin_audit_log, or user_profiles', () => {
    const forbidden = [
      "from('patients')", "from('prescriptions')", "from('consultations')", "from('invoices')",
      "from('lab_orders')", "from('lab_requests')", "from('medication_dispensings')",
      "from('sms_messages')", "from('ai_conversations')", "from('ai_messages')",
    ]
    for (const f of forbidden) expect(HOOK_SRC).not.toContain(f)
  })

  it('the hook performs no writes and calls no service-role client', () => {
    expect(HOOK_SRC).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    expect(HOOK_SRC).not.toMatch(/service_role|createServiceClient/)
  })

  it('the hook never embeds `clinics(` (no PostgREST relationship ambiguity)', () => {
    expect(HOOK_SRC).not.toMatch(/clinics\(/)
  })

  it('every platform RPC is gated by is_super_admin() and returns no raw clinical column', () => {
    // Strip SQL comments first — the file's own PROSE (describing what is
    // deliberately excluded) legitimately contains words like "content"/"body";
    // only the executable SQL below matters for this check.
    const codeOnly = SQL_SRC.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    const forbiddenColumns = [
      'patient_name', 'patient_number', 'diagnosis', 'clinical_notes', 'interpretation',
      'to_phone', '\\bbody\\b', '\\bcontent\\b', 'medication_name', 'substitution_notes',
    ]
    for (const c of forbiddenColumns) expect(codeOnly).not.toMatch(new RegExp(c))
    // Every function must check is_super_admin() before returning anything
    // (counted in executable code only — the header prose also mentions the
    // pattern descriptively and must not inflate the count).
    const fnCount = (codeOnly.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length
    const gateCount = (codeOnly.match(/IF NOT public\.is_super_admin\(\) THEN/g) ?? []).length
    expect(fnCount).toBe(4)
    expect(gateCount).toBe(4)
  })

  it('the migration creates no new table, no new FK, no policy change (RPC-only, additive)', () => {
    expect(SQL_SRC).not.toMatch(/CREATE TABLE/)
    expect(SQL_SRC).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER TABLE.*ENABLE ROW LEVEL SECURITY/)
  })
})

describe('page independence & no-write invariant', () => {
  it('the activity page never selects a clinical table row-set directly', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'admin', 'activity', 'page.tsx'), 'utf8')
    const forbidden = ["from('patients')", "from('prescriptions')", "from('consultations')", "from('sms_messages')", "from('ai_messages')"]
    for (const f of forbidden) expect(src).not.toContain(f)
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    expect(src).not.toMatch(/from '@\/(lib|hooks)\/(copilot-packs|workspace|specialties|pathways)/)
  })
})
