import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import { parseUserPreferences } from '@/lib/workspace/spec'
import type { UserWorkspacePrefs } from '@/lib/workspace/types'

// ── useUserPreferences (Phase 14.2.6) ──────────────────────────────
//
// Tolerant read of the per-(user, clinic) workspace preferences row (migration
// 037, Phase 14.1 — additive; NOTHING has consumed it until now). Missing
// table/row/malformed JSONB all degrade to an empty preferences object, which
// resolveWorkspace already treats as "no personalization" (today's behaviour).
// Never throws; never blocks login or the dashboard.
//
// P0 guard: single flat table, own-row select by (user_id, clinic_id) — no
// `clinics` embed, no relationship traversal.
export function useUserPreferences() {
  const { profile: account, clinic } = useClinic()
  const supabase = createClient()
  const userId = account?.id
  const clinicId = clinic?.id

  return useQuery({
    queryKey: ['user_preferences', userId, clinicId],
    enabled: !!userId && !!clinicId,
    staleTime: 60_000,
    queryFn: async (): Promise<Partial<UserWorkspacePrefs>> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('user_preferences')
          .select('preferences')
          .eq('user_id', userId!)
          .eq('clinic_id', clinicId!)
          .maybeSingle()
        if (error) return {}
        return parseUserPreferences(data?.preferences)
      } catch {
        return {}
      }
    },
  })
}
