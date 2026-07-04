import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import {
  fallbackProfile,
  normalizeProfile,
  credentialReminders,
  mediaPath,
  isMediaPathOwnedBy,
  PROFESSIONAL_MEDIA_BUCKET,
} from '@/lib/professional-profile'
import type {
  ProfessionalProfile,
  ProfessionalProfileRow,
  ProfessionalMediaKind,
  Credential,
} from '@/lib/professions/types'

// ── useProfessionalProfile — the authoritative profile, tolerantly ─
//
// Reads the (user, clinic) row from professional_profiles (migration 038). This
// hook is deliberately unbreakable:
//   • the table isn't in the generated types and may not exist yet → cast + catch;
//   • no row, a query error, or a missing table → a safe FALLBACK profile;
//   • it NEVER throws, so it can never block login, the dashboard, or cause a
//     lockout. It is purely additive metadata.
//
// P0 guard: this query hits ONE table by its own columns — there is NO `clinics`
// embed and NO relationship traversal, so it cannot reproduce the PGRST201
// ambiguity that caused the incident.
export function useProfessionalProfile() {
  const { profile, clinic } = useClinic()
  const supabase = createClient()
  const userId = profile?.id
  const clinicId = clinic?.id

  return useQuery({
    queryKey: ['professional_profile', userId, clinicId],
    enabled: !!userId && !!clinicId,
    staleTime: 60_000,
    queryFn: async (): Promise<ProfessionalProfile> => {
      const opts = { role: profile?.role ?? null, displayName: profile?.full_name ?? null }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('professional_profiles')
          .select(
            'id, user_id, clinic_id, profession, display_name, professional_title, department, position, years_experience, languages, photo_path, signature_path, credentials, onboarding_completed',
          )
          .eq('user_id', userId!)
          .eq('clinic_id', clinicId!)
          .maybeSingle()
        if (error) return fallbackProfile(userId!, clinicId!, opts)
        return normalizeProfile(data as ProfessionalProfileRow | null, userId!, clinicId!, opts)
      } catch {
        return fallbackProfile(userId!, clinicId!, opts)
      }
    },
  })
}

// Input for saving — all fields optional; only provided keys are written.
export interface SaveProfileInput {
  profession?: string | null
  displayName?: string | null
  professionalTitle?: string | null
  department?: string | null
  position?: string | null
  yearsExperience?: number | null
  languages?: string[]
  photoPath?: string | null
  signaturePath?: string | null
  credentials?: Credential[]
  onboardingCompleted?: boolean
}

/** Upsert the caller's OWN profile row. RLS guarantees user + clinic scoping. */
export function useSaveProfessionalProfile() {
  const qc = useQueryClient()
  const { profile, clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (input: SaveProfileInput) => {
      const userId = profile?.id
      const clinicId = clinic?.id
      if (!userId || !clinicId) throw new Error('No active session/clinic')
      const patch: Record<string, unknown> = {
        user_id: userId,
        clinic_id: clinicId,
        updated_at: new Date().toISOString(),
      }
      if (input.profession !== undefined) patch.profession = input.profession
      if (input.displayName !== undefined) patch.display_name = input.displayName
      if (input.professionalTitle !== undefined) patch.professional_title = input.professionalTitle
      if (input.department !== undefined) patch.department = input.department
      if (input.position !== undefined) patch.position = input.position
      if (input.yearsExperience !== undefined) patch.years_experience = input.yearsExperience
      if (input.languages !== undefined) patch.languages = input.languages
      if (input.photoPath !== undefined) patch.photo_path = input.photoPath
      if (input.signaturePath !== undefined) patch.signature_path = input.signaturePath
      if (input.credentials !== undefined) patch.credentials = input.credentials
      if (input.onboardingCompleted !== undefined) patch.onboarding_completed = input.onboardingCompleted
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('professional_profiles')
        .upsert(patch, { onConflict: 'user_id,clinic_id' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professional_profile', profile?.id, clinic?.id] })
    },
  })
}

/** Derived credential expiry reminders (operational only). Safe/empty by default. */
export function useCredentialReminders(withinDays = 60) {
  const { data: profile } = useProfessionalProfile()
  // new Date() (not Date.now()) keeps react-hooks/purity happy; reminders re-derive
  // on each render, which is cheap and deterministic given the same inputs.
  return credentialReminders(profile?.credentials ?? [], new Date(), withinDays)
}

// ── Media — private bucket, signed URLs only ───────────────────────

/** Mint a short-lived signed URL for a stored media path. Tolerant → null. */
export function useProfessionalMediaUrl(path: string | null | undefined, expiresIn = 300) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['professional_media_url', path],
    enabled: !!path,
    staleTime: (expiresIn - 30) * 1000,
    queryFn: async (): Promise<string | null> => {
      try {
        const { data, error } = await supabase.storage
          .from(PROFESSIONAL_MEDIA_BUCKET)
          .createSignedUrl(path!, expiresIn)
        if (error) return null
        return data?.signedUrl ?? null
      } catch {
        return null
      }
    },
  })
}

export interface UploadMediaInput {
  kind: ProfessionalMediaKind
  file: File
}

/** Upload profile media to the caller's own scoped path; returns the stored path.
 *  RLS on storage.objects enforces the same (clinic, user) scoping the path encodes. */
export function useUploadProfessionalMedia() {
  const qc = useQueryClient()
  const { profile, clinic } = useClinic()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ kind, file }: UploadMediaInput): Promise<string> => {
      const userId = profile?.id
      const clinicId = clinic?.id
      if (!userId || !clinicId) throw new Error('No active session/clinic')
      const path = mediaPath(clinicId, userId, kind, file.name)
      // Defence-in-depth: never proceed with a path that isn't the caller's own.
      if (!isMediaPathOwnedBy(path, clinicId, userId)) throw new Error('Invalid media path')
      const { error } = await supabase.storage
        .from(PROFESSIONAL_MEDIA_BUCKET)
        .upload(path, file, { upsert: true, cacheControl: '3600' })
      if (error) throw error
      return path
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professional_media_url'] })
    },
  })
}
