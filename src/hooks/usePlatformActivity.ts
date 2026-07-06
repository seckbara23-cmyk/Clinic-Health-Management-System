import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  parsePlatformOverview, type PlatformOverview, EMPTY_OVERVIEW,
  type ClinicActivityRow, type DateRange,
} from '@/lib/platform-activity'

// ── Platform Activity Center hooks (Phase 15.0) ────────────────────
//
// Every read here is either (a) a call to a SECURITY DEFINER, aggregate-only
// RPC (migration 042 — mirrors get_platform_billing_summary from 026) gated
// server-side by is_super_admin(), or (b) a direct read of admin_audit_log /
// user_profiles, both already super_admin-readable by existing RLS (027 never
// touched them). NOTHING here reads patients/appointments/consultations/
// prescriptions/invoices/lab_orders/medication_dispensings/sms_messages/
// ai_conversations/ai_messages directly — only through the RPCs' aggregates.
//
// Tolerant by construction: an RPC that doesn't exist yet (042 not applied) or
// any query error degrades to a safe empty default — the console renders an
// empty/zero state rather than breaking. `enabled` must be passed by the
// caller (gated on `profile.role === 'super_admin'`), mirroring
// usePlatformBillingSummary's existing convention.

export function usePlatformOverview(enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['platform-overview'],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<PlatformOverview> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_platform_overview')
        if (error) return { ...EMPTY_OVERVIEW }
        return parsePlatformOverview(data)
      } catch {
        return { ...EMPTY_OVERVIEW }
      }
    },
  })
}

function mapActivityRow(r: Record<string, unknown>): ClinicActivityRow {
  return {
    clinicId: String(r.clinic_id ?? ''),
    clinicName: String(r.clinic_name ?? ''),
    subscriptionPlan: String(r.subscription_plan ?? ''),
    subscriptionStatus: String(r.subscription_status ?? ''),
    clinicStatus: String(r.clinic_status ?? ''),
    userCount: Number(r.user_count ?? 0),
    activeUserCount: Number(r.active_user_count ?? 0),
    appointmentsCount: Number(r.appointments_count ?? 0),
    consultationsCount: Number(r.consultations_count ?? 0),
    invoicesCount: Number(r.invoices_count ?? 0),
    labOrdersCount: Number(r.lab_orders_count ?? 0),
    dispensingCount: Number(r.dispensing_count ?? 0),
    lastActivityAt: (r.last_activity_at as string | null) ?? null,
  }
}

export function useClinicActivitySummary(range: DateRange, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clinic-activity-summary', range.from, range.to],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ClinicActivityRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_activity_summary', { p_from: range.from, p_to: range.to })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(mapActivityRow)
      } catch {
        return []
      }
    },
  })
}

export interface ClinicSmsSummaryRow {
  clinicId: string; clinicName: string
  queued: number; sending: number; sent: number; delivered: number
  failed: number; cancelled: number; skipped: number; total: number
}

export function usePlatformSmsSummary(range: DateRange, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['platform-sms-summary', range.from, range.to],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ClinicSmsSummaryRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_platform_sms_summary', { p_from: range.from, p_to: range.to })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          clinicId: String(r.clinic_id ?? ''), clinicName: String(r.clinic_name ?? ''),
          queued: Number(r.queued ?? 0), sending: Number(r.sending ?? 0), sent: Number(r.sent ?? 0),
          delivered: Number(r.delivered ?? 0), failed: Number(r.failed ?? 0),
          cancelled: Number(r.cancelled ?? 0), skipped: Number(r.skipped ?? 0), total: Number(r.total ?? 0),
        }))
      } catch {
        return []
      }
    },
  })
}

export interface ClinicAiSummaryRow {
  clinicId: string; clinicName: string
  conversationCount: number; messageCount: number
}

export function usePlatformAiSummary(range: DateRange, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['platform-ai-summary', range.from, range.to],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ClinicAiSummaryRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_platform_ai_summary', { p_from: range.from, p_to: range.to })
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          clinicId: String(r.clinic_id ?? ''), clinicName: String(r.clinic_name ?? ''),
          conversationCount: Number(r.conversation_count ?? 0), messageCount: Number(r.message_count ?? 0),
        }))
      } catch {
        return []
      }
    },
  })
}

// ── Platform Actions feed (admin_audit_log — already super_admin-readable) ──
export interface PlatformActionRow {
  id: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string | null
  createdAt: string
}

function mapActionRow(r: Record<string, unknown>): PlatformActionRow {
  return {
    id: String(r.id ?? ''),
    actorId: (r.actor_id as string | null) ?? null,
    action: String(r.action ?? ''),
    targetType: String(r.target_type ?? ''),
    targetId: (r.target_id as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }
}

/** Recent platform-wide privileged actions (clinic lifecycle, invites,
 *  password resets). RLS already scopes admin_audit_log SELECT to
 *  is_super_admin() — no RPC needed, this is a direct table read. */
export function useRecentPlatformActions(limit: number, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['platform-actions', limit],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<PlatformActionRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('admin_audit_log')
          .select('id, actor_id, action, target_type, target_id, created_at')
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(mapActionRow)
      } catch {
        return []
      }
    },
  })
}

/** Privileged actions targeting ONE clinic (the drilldown Audit tab). */
export function useClinicAuditActions(clinicId: string | null, limit: number, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clinic-audit-actions', clinicId, limit],
    enabled: enabled && !!clinicId,
    staleTime: 15_000,
    queryFn: async (): Promise<PlatformActionRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('admin_audit_log')
          .select('id, actor_id, action, target_type, target_id, created_at')
          .eq('target_type', 'clinic')
          .eq('target_id', clinicId!)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return []
        return ((data ?? []) as Record<string, unknown>[]).map(mapActionRow)
      } catch {
        return []
      }
    },
  })
}

export interface ClinicStaffRow {
  id: string; fullName: string; email: string; role: string; isActive: boolean
}

/** Staff directory for the drilldown Users tab — name/email/role/active only,
 *  NEVER patient data. user_profiles is blanket-readable by super_admin (RLS
 *  unchanged by 027 — it protects clinical/billing tables, not staff org data). */
export function useClinicStaff(clinicId: string | null, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clinic-staff', clinicId],
    enabled: enabled && !!clinicId,
    staleTime: 30_000,
    queryFn: async (): Promise<ClinicStaffRow[]> => {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('id, full_name, email, role, is_active')
          .eq('clinic_id', clinicId!)
          .order('full_name')
        if (error) return []
        return (data ?? []).map(r => ({
          id: r.id, fullName: r.full_name, email: r.email, role: r.role, isActive: r.is_active,
        }))
      } catch {
        return []
      }
    },
  })
}
