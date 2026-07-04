import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useClinic } from '@/context/ClinicContext'
import {
  useProfessionalProfile,
  useSaveProfessionalProfile,
} from '@/hooks/useProfessionalProfile'
import {
  resolveProfession,
  selectableProfessions,
  professionalMediaPath,
  assertOwnMediaPath,
  licenseNumbersFrom,
} from '@/lib/professional-identity'
import { PROFESSIONAL_MEDIA_BUCKET, credentialReminders } from '@/lib/professional-profile'
import type { Credential, ProfessionalMediaKind } from '@/lib/professions/types'

// ── Professional Identity API (Phase 14.2.2) ───────────────────────
//
// The canonical, reusable surface for every healthcare professional's identity.
// Future phases MUST consume these hooks and NEVER query professional_profiles
// directly. Everything here is tolerant: a missing table/row/media degrades to a
// safe fallback and never blocks login, the dashboard, or navigation.
//
// P0 guard: all reads hit a SINGLE table by its own columns — no `clinics` embed,
// no relationship traversal — so nothing here can reproduce the PGRST201 lockout.

/**
 * The authoritative identity for the current (user, clinic): the resolved
 * profession (RBAC role → profession → profile), the profile itself, the
 * professions the user may self-select, and a save mutation.
 */
export function useProfessionalIdentity() {
  const { profile: account } = useClinic()
  const query = useProfessionalProfile()
  const save = useSaveProfessionalProfile()

  const role = account?.role ?? null
  const profile = query.data ?? null
  const profession = useMemo(() => resolveProfession(profile, role), [profile, role])
  const options = useMemo(() => selectableProfessions(role), [role])

  return {
    profile,
    role,
    profession,               // resolved ProfessionDefinition (never null)
    selectableProfessions: options,
    isLoading: query.isLoading,
    isFallback: profile?.isFallback ?? true,
    save,                     // useSaveProfessionalProfile mutation
    refetch: query.refetch,
  }
}

/**
 * Credentials + operational expiry reminders for the current professional, with a
 * clinic-scoped duplicate-license signal (best-effort: admins see clinic rows,
 * others see only their own under RLS).
 */
export function useProfessionalCredentials(withinDays = 60) {
  const query = useProfessionalProfile()
  const clinicLicenses = useClinicLicenseNumbers()
  const rawCreds = query.data?.credentials
  const credentials = useMemo<Credential[]>(() => rawCreds ?? [], [rawCreds])
  const reminders = useMemo(
    () => credentialReminders(credentials, new Date(), withinDays),
    [credentials, withinDays],
  )
  return {
    credentials,
    reminders,
    /** License numbers already present elsewhere in the clinic (for conflict checks). */
    clinicLicenseNumbers: clinicLicenses.data ?? [],
    isLoading: query.isLoading,
  }
}

/** Clinic-visible medical-license numbers (RLS-scoped). Tolerant → []. */
function useClinicLicenseNumbers() {
  const { clinic } = useClinic()
  const supabase = createClient()
  return useQuery({
    queryKey: ['professional_clinic_licenses', clinic?.id],
    enabled: !!clinic?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('professional_profiles')
          .select('credentials')
          .eq('clinic_id', clinic!.id)
        if (error) return []
        return licenseNumbersFrom((data ?? []) as { credentials?: Credential[] }[])
      } catch {
        return []
      }
    },
  })
}

// ── Media — private bucket, signed URLs, safe replace/delete ───────
export function useProfessionalMedia(expiresIn = 300) {
  const qc = useQueryClient()
  const { profile: account, clinic } = useClinic()
  const supabase = createClient()
  const { data: profile } = useProfessionalProfile()
  const save = useSaveProfessionalProfile()

  const userId = account?.id
  const clinicId = clinic?.id
  const photoPath = profile?.photoPath ?? null
  const signaturePath = profile?.signaturePath ?? null

  const photo = useSignedUrl(photoPath, expiresIn)
  const signature = useSignedUrl(signaturePath, expiresIn)

  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: ProfessionalMediaKind; file: File }): Promise<string> => {
      if (!userId || !clinicId) throw new Error('No active session/clinic')
      const path = professionalMediaPath(clinicId, userId, kind)
      if (!assertOwnMediaPath(path, clinicId, userId)) throw new Error('Invalid media path')
      // Stable path + upsert → safe replacement (overwrites in place, no orphan).
      const { error } = await supabase.storage
        .from(PROFESSIONAL_MEDIA_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined, cacheControl: '3600' })
      if (error) throw error
      await save.mutateAsync(kind === 'photo' ? { photoPath: path } : { signaturePath: path })
      return path
    },
    onSuccess: () => invalidate(qc, account?.id, clinic?.id),
  })

  const remove = useMutation({
    mutationFn: async (kind: ProfessionalMediaKind): Promise<void> => {
      if (!userId || !clinicId) throw new Error('No active session/clinic')
      const current = kind === 'photo' ? photoPath : signaturePath
      // Best-effort object delete; the authoritative change is clearing the column.
      if (current && assertOwnMediaPath(current, clinicId, userId)) {
        try { await supabase.storage.from(PROFESSIONAL_MEDIA_BUCKET).remove([current]) } catch { /* tolerant */ }
      }
      await save.mutateAsync(kind === 'photo' ? { photoPath: null } : { signaturePath: null })
    },
    onSuccess: () => invalidate(qc, account?.id, clinic?.id),
  })

  return {
    photoUrl: photo.data ?? null,        // null → component shows the fallback avatar
    signatureUrl: signature.data ?? null,
    hasPhoto: !!photoPath,
    hasSignature: !!signaturePath,
    upload,
    remove,
    isBusy: upload.isPending || remove.isPending,
  }
}

function useSignedUrl(path: string | null, expiresIn: number) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['professional_media_url', path],
    enabled: !!path,
    staleTime: Math.max(0, expiresIn - 30) * 1000,
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

function invalidate(qc: ReturnType<typeof useQueryClient>, userId?: string, clinicId?: string) {
  qc.invalidateQueries({ queryKey: ['professional_profile', userId, clinicId] })
  qc.invalidateQueries({ queryKey: ['professional_media_url'] })
}
