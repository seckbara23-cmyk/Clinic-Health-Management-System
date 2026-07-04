-- ════════════════════════════════════════════════════════════════
-- 037_user_preferences.sql — Phase 14.1: Specialty Workspace Framework
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE. Adds per-user workspace personalization + queryable specialty
-- identity. Touches NO existing table's data or RLS; every object guarded with
-- IF NOT EXISTS. Nothing consumes these yet (14.1 is foundations only), so the
-- app runs identically before and after this runs. Safe on a live database.
--
--   A. user_profiles += primary_specialty / sub_specialty / department (nullable)
--   B. user_preferences — one JSONB row per (user, clinic)

-- ── A. Queryable specialty identity (Layer 2) ─────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS primary_specialty TEXT,
  ADD COLUMN IF NOT EXISTS sub_specialty     TEXT,
  ADD COLUMN IF NOT EXISTS department        TEXT;

-- ── B. Personal preferences (Layer 4) ─────────────────────────────
-- Keyed by (user, clinic) so a doctor working at two clinics can differ.
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  clinic_id   UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,   -- widget order, favorites, note style, onboarding flags
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, clinic_id)
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- A user may only see and manage their OWN preferences, within their clinic.
-- (auth.uid() maps to user_profiles.id in this schema.)
DROP POLICY IF EXISTS "user_preferences_select" ON public.user_preferences;
CREATE POLICY "user_preferences_select" ON public.user_preferences FOR SELECT
  USING (user_id = auth.uid() AND clinic_id = public.get_clinic_id());

DROP POLICY IF EXISTS "user_preferences_insert" ON public.user_preferences;
CREATE POLICY "user_preferences_insert" ON public.user_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid() AND clinic_id = public.get_clinic_id());

DROP POLICY IF EXISTS "user_preferences_update" ON public.user_preferences;
CREATE POLICY "user_preferences_update" ON public.user_preferences FOR UPDATE
  USING (user_id = auth.uid() AND clinic_id = public.get_clinic_id())
  WITH CHECK (user_id = auth.uid() AND clinic_id = public.get_clinic_id());

DROP POLICY IF EXISTS "user_preferences_delete" ON public.user_preferences;
CREATE POLICY "user_preferences_delete" ON public.user_preferences FOR DELETE USING (false);
