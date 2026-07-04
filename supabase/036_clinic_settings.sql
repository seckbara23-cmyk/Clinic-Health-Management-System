-- ════════════════════════════════════════════════════════════════
-- 036_clinic_settings.sql — Phase 12: Administration & Settings Hub
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE. Adds a per-tenant key/value settings store and an append-only
-- change history. Touches NO existing table, column, RPC or policy — existing
-- clinic data / settings (clinics.*, SMS flags, etc.) stay exactly as-is. Every
-- object is guarded with IF NOT EXISTS. Safe to run on a live database.
--
--   A. clinic_settings          — one JSONB row per (clinic, section)
--   B. clinic_settings_history  — immutable audit of configuration changes
--
-- Multi-tenant isolation is enforced by RLS: a row is only visible/writable
-- within the caller's own clinic. Only admin / super_admin may write.

-- ── A. Settings store ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinic_settings (
  clinic_id   UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  section_id  TEXT NOT NULL,
  values      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  UUID REFERENCES public.user_profiles(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, section_id)
);

ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (settings drive their UI).
DROP POLICY IF EXISTS "clinic_settings_select" ON public.clinic_settings;
CREATE POLICY "clinic_settings_select" ON public.clinic_settings FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: admin + super_admin only.
DROP POLICY IF EXISTS "clinic_settings_insert" ON public.clinic_settings;
CREATE POLICY "clinic_settings_insert" ON public.clinic_settings FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'));

DROP POLICY IF EXISTS "clinic_settings_update" ON public.clinic_settings;
CREATE POLICY "clinic_settings_update" ON public.clinic_settings FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'));

DROP POLICY IF EXISTS "clinic_settings_delete" ON public.clinic_settings;
CREATE POLICY "clinic_settings_delete" ON public.clinic_settings FOR DELETE USING (false);

-- ── B. Change history (save history + audit) ──────────────────────
CREATE TABLE IF NOT EXISTS public.clinic_settings_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  section_id  TEXT NOT NULL,
  values      JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_keys TEXT[] NOT NULL DEFAULT '{}',
  changed_by  UUID REFERENCES public.user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clinic_settings_history_idx
  ON public.clinic_settings_history (clinic_id, created_at DESC);

ALTER TABLE public.clinic_settings_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_settings_history_select" ON public.clinic_settings_history;
CREATE POLICY "clinic_settings_history_select" ON public.clinic_settings_history FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'));

DROP POLICY IF EXISTS "clinic_settings_history_insert" ON public.clinic_settings_history;
CREATE POLICY "clinic_settings_history_insert" ON public.clinic_settings_history FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'));

DROP POLICY IF EXISTS "clinic_settings_history_update" ON public.clinic_settings_history;
CREATE POLICY "clinic_settings_history_update" ON public.clinic_settings_history FOR UPDATE USING (false);

DROP POLICY IF EXISTS "clinic_settings_history_delete" ON public.clinic_settings_history;
CREATE POLICY "clinic_settings_history_delete" ON public.clinic_settings_history FOR DELETE USING (false);
