-- ============================================================
-- 013 — Clinic Services/Pricing + Onboarding Tracking
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Clinic services catalog (per-tenant pricing)
CREATE TABLE IF NOT EXISTS public.clinic_services (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id    UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price        NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'XOF',
  duration_min INT,
  category     TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_services_clinic
  ON public.clinic_services(clinic_id);

CREATE INDEX IF NOT EXISTS idx_clinic_services_active
  ON public.clinic_services(clinic_id, is_active);

CREATE OR REPLACE TRIGGER trg_clinic_services_updated_at
  BEFORE UPDATE ON public.clinic_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. RLS for clinic_services
ALTER TABLE public.clinic_services ENABLE ROW LEVEL SECURITY;

-- All clinic members can read the service catalog (needed for billing)
CREATE POLICY "services_select" ON public.clinic_services FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- Only admin can manage services
CREATE POLICY "services_insert" ON public.clinic_services FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() = 'admin'
    )
  );

CREATE POLICY "services_update" ON public.clinic_services FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() = 'admin'
    )
  );

CREATE POLICY "services_delete" ON public.clinic_services FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- 3. Onboarding tracking columns on clinics
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_step          SMALLINT NOT NULL DEFAULT 1;

-- Back-fill: clinics that existed before this migration are already set up.
-- Mark them as onboarding complete so the wizard doesn't appear for them.
UPDATE public.clinics
  SET onboarding_completed_at = NOW(),
      onboarding_step          = 4
  WHERE onboarding_completed_at IS NULL
    AND status = 'active';

-- 4. Realtime for live service picker in billing
ALTER PUBLICATION supabase_realtime ADD TABLE public.clinic_services;

NOTIFY pgrst, 'reload schema';
