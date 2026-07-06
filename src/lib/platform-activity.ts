// ── Platform Activity Center — pure logic (Phase 15.0) ─────────────
//
// Deterministic, framework-free helpers for the Super Admin Platform Activity
// Center. No React, no Supabase, no I/O — every branch is unit-testable.
//
// CORE PRINCIPLE: this module is PLATFORM OPERATIONS only. Every type here
// models COUNTS and METADATA (clinic names, plans, statuses, timestamps) —
// never a patient name, diagnosis, prescription, lab value, or medical
// document. It is architecturally independent of the Clinical Copilot,
// Workspace Renderer, Specialty Registry, Care Pathways, and Medical AI —
// this file imports NONE of those modules.

export type DateRangeFilter = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

export interface DateRange {
  from: string   // ISO timestamp
  to: string     // ISO timestamp
}

/**
 * Resolve a filter into a concrete [from, to) UTC range, given `now`. Pure and
 * deterministic — callers pass `now` explicitly (e.g. `new Date()` at the call
 * site) so this is fully testable without mocking the clock.
 *
 * "Today"/"Yesterday" are UTC calendar-day boundaries — a platform spans many
 * clinics/timezones, so a single, documented, deterministic boundary is used
 * rather than any one clinic's local time.
 */
export function resolveDateRange(
  filter: DateRangeFilter,
  now: Date,
  custom?: Partial<DateRange>,
): DateRange {
  const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const nowIso = now.toISOString()

  switch (filter) {
    case 'today': {
      return { from: startOfUtcDay(now).toISOString(), to: nowIso }
    }
    case 'yesterday': {
      const startToday = startOfUtcDay(now)
      const startYesterday = new Date(startToday.getTime() - 86_400_000)
      return { from: startYesterday.toISOString(), to: startToday.toISOString() }
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: nowIso }
    case '30d':
      return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: nowIso }
    case 'custom': {
      const from = isValidIso(custom?.from) ? custom!.from! : new Date(now.getTime() - 30 * 86_400_000).toISOString()
      const to = isValidIso(custom?.to) ? custom!.to! : nowIso
      // Never let an inverted custom range silently return everything backwards.
      return from <= to ? { from, to } : { from: to, to: from }
    }
    default:
      return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: nowIso }
  }
}

function isValidIso(v?: string | null): v is string {
  if (!v) return false
  const d = new Date(v)
  return !Number.isNaN(d.getTime())
}

// ── Platform overview (tolerant parser for get_platform_overview()) ─
export interface PlatformOverview {
  clinicsTotal: number
  clinicsByStatus: Record<string, number>
  clinicsByPlan: Record<string, number>
  clinicsNew7d: number
  clinicsNew30d: number
  usersTotal: number
  usersActive: number
  usersByRole: Record<string, number>
}

export const EMPTY_OVERVIEW: PlatformOverview = {
  clinicsTotal: 0, clinicsByStatus: {}, clinicsByPlan: {}, clinicsNew7d: 0, clinicsNew30d: 0,
  usersTotal: 0, usersActive: 0, usersByRole: {},
}

/** Tolerant normaliser for the get_platform_overview() JSONB payload — never
 *  throws; a missing/malformed field degrades to a safe zero/empty default. */
export function parsePlatformOverview(raw: unknown): PlatformOverview {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_OVERVIEW }
  const r = raw as Record<string, unknown>
  return {
    clinicsTotal: asNumber(r.clinics_total),
    clinicsByStatus: asCountMap(r.clinics_by_status),
    clinicsByPlan: asCountMap(r.clinics_by_plan),
    clinicsNew7d: asNumber(r.clinics_new_7d),
    clinicsNew30d: asNumber(r.clinics_new_30d),
    usersTotal: asNumber(r.users_total),
    usersActive: asNumber(r.users_active),
    usersByRole: asCountMap(r.users_by_role),
  }
}

function asNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function asCountMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = asNumber(val)
  return out
}

// ── Clinic activity rows (get_clinic_activity_summary) ──────────────
export interface ClinicActivityRow {
  clinicId: string
  clinicName: string
  subscriptionPlan: string
  subscriptionStatus: string
  clinicStatus: string
  userCount: number
  activeUserCount: number
  appointmentsCount: number
  consultationsCount: number
  invoicesCount: number
  labOrdersCount: number
  dispensingCount: number
  lastActivityAt: string | null
}

/** Total operational actions counted for one clinic row (for sort/summary). */
export function activityTotal(row: Pick<ClinicActivityRow,
  'appointmentsCount' | 'consultationsCount' | 'invoicesCount' | 'labOrdersCount' | 'dispensingCount'>): number {
  return row.appointmentsCount + row.consultationsCount + row.invoicesCount + row.labOrdersCount + row.dispensingCount
}

/** Case/diacritic-insensitive substring search over clinic name. Pure. */
export function filterClinicRows<T extends { clinicName: string }>(rows: T[], query: string): T[] {
  const q = normalizeSearch(query)
  if (!q) return rows
  return rows.filter(r => normalizeSearch(r.clinicName).includes(q))
}

function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** Sum a numeric field across every row — used for platform-wide summary tiles. */
export function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((acc, r) => acc + pick(r), 0)
}

// ── Masking (Audit Center — never a raw identifier in the UI) ──────
/** Mask a UUID/id down to a short, non-reversible-looking prefix for display —
 *  enough to correlate across a session's screen, never a lookup key. */
export function maskId(id: string | null | undefined): string {
  if (!id) return '—'
  const s = String(id).replace(/-/g, '')
  return s.length <= 8 ? `${s}…` : `${s.slice(0, 8)}…`
}

// ── Display ordering (stable, predictable breakdown rendering) ─────
export const CLINIC_STATUS_ORDER = ['active', 'pending', 'suspended', 'inactive', 'rejected', 'archived'] as const
export const SUBSCRIPTION_PLAN_ORDER = ['free', 'basic', 'pro', 'enterprise'] as const
export const STAFF_ROLE_ORDER = ['admin', 'doctor', 'nurse', 'receptionist', 'cashier', 'lab_technician', 'pharmacist'] as const

/** Order a count map's entries by a preferred key order, unknown keys last. */
export function orderedEntries(map: Record<string, number>, order: readonly string[]): [string, number][] {
  const known = order.filter(k => k in map).map(k => [k, map[k]] as [string, number])
  const unknown = Object.entries(map).filter(([k]) => !order.includes(k))
  return [...known, ...unknown]
}
