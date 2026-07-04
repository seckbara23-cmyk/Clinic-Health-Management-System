-- ════════════════════════════════════════════════════════════════
-- 038_professional_profiles.sql — Phase 14.2.1: Professional Profile Foundation
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Establishes the authoritative professional
-- profile model — one row per (user, clinic) — plus private Storage for profile
-- photo & digital signature. Touches NO existing table, column, FK, RPC or
-- policy. Every object is guarded (IF NOT EXISTS / ON CONFLICT / DROP-then-CREATE
-- for policies). The app is byte-identical before and after this runs: nothing
-- consumes these objects unless a profile row exists, and the hooks fall back
-- cleanly when the table, a row, or media are absent. Safe on a live database.
--
--   A. professional_profiles   — surrogate PK + UNIQUE(user_id, clinic_id)
--   B. RLS                     — clinic-scoped + user-scoped (admin may read)
--   C. updated_at trigger      — reuses public.update_updated_at()
--   D. Storage bucket + RLS    — private 'professional-media', signed-URL only
--
-- ── P0 REGRESSION GUARD ───────────────────────────────────────────
-- The key (user_id, clinic_id) is a UNIQUE CONSTRAINT, NOT the primary key.
-- The PK is a standalone surrogate `id`. This is deliberate: a composite PK made
-- of two foreign keys is exactly what made PostgREST infer a junction
-- relationship between user_profiles and clinics in migration 037, producing
-- PGRST201 and the P0 login lockout. A surrogate PK cannot be read as a junction,
-- so this table can never reintroduce that ambiguity.

-- ── A. Professional profile store ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.professional_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- surrogate PK (NOT composite)
  user_id               UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  clinic_id             UUID NOT NULL REFERENCES public.clinics(id)      ON DELETE CASCADE,

  -- Root classifier (Professional Registry). Nullable → tolerant of un-onboarded users.
  profession            TEXT,

  -- Professional identity
  display_name          TEXT,
  professional_title    TEXT,
  department            TEXT,
  position              TEXT,
  years_experience      INTEGER,
  languages             TEXT[] NOT NULL DEFAULT '{}',

  -- Media — Storage PATHS only (never URLs). Signed URLs are minted client-side.
  photo_path            TEXT,
  signature_path        TEXT,

  -- Credentials — metadata only, array of objects (no external verification).
  credentials           JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Forward-declared, additive slots for later 14.2 steps (unused in this phase).
  secondary_specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
  sub_specialties       JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled_packs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  pack_levels           JSONB NOT NULL DEFAULT '{}'::jsonb,

  onboarding_completed  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One profile per person per clinic — a UNIQUE CONSTRAINT, never the PK.
  CONSTRAINT professional_profiles_user_clinic_key UNIQUE (user_id, clinic_id)
);

-- Admin listing within a clinic; the UNIQUE constraint already indexes lookups.
CREATE INDEX IF NOT EXISTS professional_profiles_clinic_idx
  ON public.professional_profiles (clinic_id);

-- ── B. Row-Level Security ─────────────────────────────────────────
ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;

-- Read: your OWN profile within your clinic; clinic admins may read clinic rows.
DROP POLICY IF EXISTS "professional_profiles_select" ON public.professional_profiles;
CREATE POLICY "professional_profiles_select" ON public.professional_profiles FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (user_id = auth.uid() OR public.get_user_role() IN ('admin', 'super_admin'))
  );

-- Insert: only your OWN profile, only within your clinic.
DROP POLICY IF EXISTS "professional_profiles_insert" ON public.professional_profiles;
CREATE POLICY "professional_profiles_insert" ON public.professional_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid() AND clinic_id = public.get_clinic_id());

-- Update: only your OWN profile, only within your clinic.
DROP POLICY IF EXISTS "professional_profiles_update" ON public.professional_profiles;
CREATE POLICY "professional_profiles_update" ON public.professional_profiles FOR UPDATE
  USING (user_id = auth.uid() AND clinic_id = public.get_clinic_id())
  WITH CHECK (user_id = auth.uid() AND clinic_id = public.get_clinic_id());

-- Delete: never via the client (profiles are additive; cascades handle teardown).
DROP POLICY IF EXISTS "professional_profiles_delete" ON public.professional_profiles;
CREATE POLICY "professional_profiles_delete" ON public.professional_profiles FOR DELETE USING (false);

-- ── C. updated_at maintenance (reuses the hardened trigger fn) ────
DROP TRIGGER IF EXISTS professional_profiles_set_updated_at ON public.professional_profiles;
CREATE TRIGGER professional_profiles_set_updated_at
  BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── D. Private Storage for profile media (photo + signature) ──────
-- Path convention:  professional-media/{clinic_id}/{user_id}/{kind}-{filename}
--   folder[1] = clinic_id   folder[2] = user_id
-- The bucket is PRIVATE (public=false). Access is only ever via a short-lived
-- signed URL minted by the authenticated client — the SELECT policy below is
-- what authorises that mint. No public bucket, no service_role.
--
-- Wrapped in an exception-guarded block: on hosts where the SQL role cannot
-- manage storage.* (rare), the table above still lands and the app stays
-- tolerant (media simply resolves to null). Storage can then be provisioned
-- from the dashboard using the same policy predicates.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('professional-media', 'professional-media', false)
  ON CONFLICT (id) DO NOTHING;

  -- Read: own media within your clinic; clinic admins may read clinic media.
  EXECUTE 'DROP POLICY IF EXISTS "professional_media_select" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "professional_media_select" ON storage.objects FOR SELECT
      USING (
        bucket_id = 'professional-media'
        AND (storage.foldername(name))[1] = public.get_clinic_id()::text
        AND (
          (storage.foldername(name))[2] = auth.uid()::text
          OR public.get_user_role() IN ('admin', 'super_admin')
        )
      )
  $pol$;

  -- Write (insert/update/delete): only your OWN media, only within your clinic.
  EXECUTE 'DROP POLICY IF EXISTS "professional_media_insert" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "professional_media_insert" ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'professional-media'
        AND (storage.foldername(name))[1] = public.get_clinic_id()::text
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS "professional_media_update" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "professional_media_update" ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'professional-media'
        AND (storage.foldername(name))[1] = public.get_clinic_id()::text
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS "professional_media_delete" ON storage.objects';
  EXECUTE $pol$
    CREATE POLICY "professional_media_delete" ON storage.objects FOR DELETE
      USING (
        bucket_id = 'professional-media'
        AND (storage.foldername(name))[1] = public.get_clinic_id()::text
        AND (storage.foldername(name))[2] = auth.uid()::text
      )
  $pol$;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'professional-media storage provisioning skipped (%). Provision from the dashboard with the same predicates; the app stays tolerant until then.', SQLERRM;
END $$;
