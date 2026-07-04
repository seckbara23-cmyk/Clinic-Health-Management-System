import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { toast } from 'sonner'
import type { SectionValues } from '@/lib/settings/registry'

/**
 * All persisted settings for the clinic, keyed by section id. Isolated + tolerant:
 * the clinic_settings table (migration 036) isn't in the generated types, and may
 * not exist yet — on any failure we return an empty map so the hub falls back to
 * registry defaults and nothing regresses. RLS scopes rows to the clinic.
 */
export function useClinicSettings() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['clinic_settings', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, SectionValues>> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('clinic_settings')
          .select('section_id, values')
          .eq('clinic_id', clinic!.id)
        if (error) return {}
        const map: Record<string, SectionValues> = {}
        for (const row of (data ?? []) as { section_id: string; values: SectionValues }[]) {
          map[row.section_id] = row.values ?? {}
        }
        return map
      } catch {
        return {}
      }
    },
  })
}

interface SaveInput {
  sectionId: string
  values: SectionValues
  changedKeys: string[]
}

/** Upsert one section's values and append an immutable history row (audit). */
export function useSaveClinicSettings() {
  const qc = useQueryClient()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  return useMutation({
    mutationFn: async (input: SaveInput) => {
      const now = new Date().toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      const { error } = await db.from('clinic_settings').upsert({
        clinic_id: clinic!.id,
        section_id: input.sectionId,
        values: input.values,
        updated_by: profile?.id ?? null,
        updated_at: now,
      }, { onConflict: 'clinic_id,section_id' })
      if (error) throw error
      // Best-effort history/audit — never blocks the save.
      try {
        await db.from('clinic_settings_history').insert({
          clinic_id: clinic!.id,
          section_id: input.sectionId,
          values: input.values,
          changed_keys: input.changedKeys,
          changed_by: profile?.id ?? null,
        })
      } catch { /* history is additive; ignore */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic_settings', clinic?.id] })
      qc.invalidateQueries({ queryKey: ['clinic_settings_history', clinic?.id] })
      toast.success('Paramètres enregistrés')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export interface SettingsHistoryRow {
  id: string
  section_id: string
  changed_keys: string[]
  created_at: string
  changed_by: string | null
}

/** Recent configuration changes (save history). Tolerant → [] if unavailable. */
export function useSettingsHistory(limit = 8) {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['clinic_settings_history', clinic?.id, limit],
    enabled: !!clinic?.id,
    queryFn: async (): Promise<SettingsHistoryRow[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('clinic_settings_history')
          .select('id, section_id, changed_keys, created_at, changed_by')
          .eq('clinic_id', clinic!.id)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return []
        return (data ?? []) as SettingsHistoryRow[]
      } catch {
        return []
      }
    },
  })
}

export interface SettingsOverview {
  users: number
  activeDoctors: number
  pendingInvitations: number
  recentChanges: number
}

/** Executive overview counts for the hub header. All reads are RLS-scoped. */
export function useSettingsOverview() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['settings_overview', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<SettingsOverview> => {
      const clinicId = clinic!.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      const [users, doctors, invites, history] = await Promise.all([
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('role', 'doctor').eq('is_active', true),
        supabase.from('clinic_invitations').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).is('accepted_at', null),
        db.from('clinic_settings_history').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).then(
          (r: { count: number | null }) => r, () => ({ count: 0 }),
        ),
      ])
      return {
        users: users.count ?? 0,
        activeDoctors: doctors.count ?? 0,
        pendingInvitations: invites.count ?? 0,
        recentChanges: history?.count ?? 0,
      }
    },
  })
}
