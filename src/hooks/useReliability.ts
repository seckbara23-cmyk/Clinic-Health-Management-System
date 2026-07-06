import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  parseReliabilityEvent, computeHealthScore, sortIncidents,
  type ReliabilityEvent, type HealthScore,
} from '@/lib/reliability'
import type { DateRange } from '@/lib/platform-activity'

// ── Platform Reliability hooks (Phase 15.0B) ───────────────────────
//
// Super_admin-only reads via the aggregate/incident RPCs from migration 043
// (each re-checks is_super_admin() server-side). Tolerant: a missing migration
// or any error degrades to an empty/zero state — the console never breaks.
// Uses only the anon/authenticated client (no privileged key), reads no clinical
// table, and performs no cross-table relationship embed.

export interface ReliabilityOverview {
  eventCount: number
  distinctCount: number
  openCount: number
  criticalOpen: number
  affectedClinics: number
  bySeverity: Record<string, number>
  byModule: Record<string, number>
  byType: Record<string, number>
}

const EMPTY_OVERVIEW: ReliabilityOverview = {
  eventCount: 0, distinctCount: 0, openCount: 0, criticalOpen: 0,
  affectedClinics: 0, bySeverity: {}, byModule: {}, byType: {},
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}
function countMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = num(val)
  return out
}

export function usePlatformReliabilityOverview(range: DateRange, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['reliability-overview', range.from, range.to],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ReliabilityOverview> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_platform_reliability_overview', { p_from: range.from, p_to: range.to })
        if (error || !data) return EMPTY_OVERVIEW
        const r = data as Record<string, unknown>
        return {
          eventCount: num(r.event_count), distinctCount: num(r.distinct_count),
          openCount: num(r.open_count), criticalOpen: num(r.critical_open),
          affectedClinics: num(r.affected_clinics),
          bySeverity: countMap(r.by_severity), byModule: countMap(r.by_module), byType: countMap(r.by_type),
        }
      } catch {
        return EMPTY_OVERVIEW
      }
    },
  })
}

export interface TenantHealthRow {
  clinicId: string
  clinicName: string
  clinicStatus: string
  criticalCount: number
  errorCount: number
  warningCount: number
  eventCount: number
  smsFailedCount: number
  lastActivityAt: string | null
  health: HealthScore
}

export function useTenantHealth(range: DateRange, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['tenant-health', range.from, range.to],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TenantHealthRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_tenant_health_inputs', { p_from: range.from, p_to: range.to })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => {
          const inputs = {
            criticalCount: num(r.critical_count), errorCount: num(r.error_count),
            warningCount: num(r.warning_count), smsFailedCount: num(r.sms_failed_count),
          }
          return {
            clinicId: String(r.clinic_id ?? ''), clinicName: String(r.clinic_name ?? ''),
            clinicStatus: String(r.clinic_status ?? ''),
            ...inputs, eventCount: num(r.event_count),
            lastActivityAt: (r.last_activity_at as string | null) ?? null,
            health: computeHealthScore(inputs),
          }
        })
      } catch {
        return []
      }
    },
  })
}

export function usePlatformIncidents(range: DateRange, openOnly: boolean, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['platform-incidents', range.from, range.to, openOnly],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<ReliabilityEvent[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_platform_incidents', { p_from: range.from, p_to: range.to, p_open_only: openOnly })
        if (error) return []
        const events = ((data ?? []) as Record<string, unknown>[])
          .map(parseReliabilityEvent)
          .filter((e): e is ReliabilityEvent => !!e)
        return sortIncidents(events)
      } catch {
        return []
      }
    },
  })
}

export function useResolveIncident() {
  const qc = useQueryClient()
  const supabase = createClient()
  return useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('resolve_reliability_event', { p_id: id, p_resolved: resolved })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-incidents'] })
      qc.invalidateQueries({ queryKey: ['reliability-overview'] })
      qc.invalidateQueries({ queryKey: ['tenant-health'] })
    },
  })
}

/** Health-level → count, in the fixed order used by the dashboard. */
export function healthLevelCounts(rows: TenantHealthRow[]): Record<string, number> {
  const out: Record<string, number> = { green: 0, yellow: 0, orange: 0, red: 0 }
  for (const r of rows) out[r.health.level] = (out[r.health.level] ?? 0) + 1
  return out
}
