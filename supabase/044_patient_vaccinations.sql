-- ════════════════════════════════════════════════════════════════
-- 044_patient_vaccinations.sql — Phase 17: Pediatrics Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Records which vaccine doses a child has
-- RECEIVED — the one piece of data the vaccination tracker genuinely needs
-- (the schedule itself is a code registry; growth reuses consultation_vitals;
-- milestones/percentiles are placeholders). Safe on a live database.
--
-- This is factual clinical data entry (a clinician marking a dose given), NOT a
-- recommendation — the Copilot never writes it automatically. `vaccine_code`
-- references the code registry (src/lib/pediatrics/schedule.ts), NOT a table, so
-- there is no second FK / junction and no PostgREST ambiguity (the P0 rule).
--
-- Surrogate PK + UNIQUE(patient_id, vaccine_code); two FK COLUMNS (clinic,
-- patient) + administered_by — the proven-safe clinic_settings_history shape.

CREATE TABLE IF NOT EXISTS public.patient_vaccinations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)   ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  vaccine_code     TEXT NOT NULL,                                 -- references the code registry
  dose_label       TEXT,
  administered_at  DATE,
  administered_by  UUID REFERENCES public.user_profiles(id),
  batch_number     TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patient_vaccinations_patient_vaccine_key UNIQUE (patient_id, vaccine_code)
);

CREATE INDEX IF NOT EXISTS patient_vaccinations_patient_idx
  ON public.patient_vaccinations (patient_id, administered_at DESC);
CREATE INDEX IF NOT EXISTS patient_vaccinations_clinic_idx
  ON public.patient_vaccinations (clinic_id);

ALTER TABLE public.patient_vaccinations ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, like other
-- patient-linked tables). RLS keeps it tenant-isolated.
DROP POLICY IF EXISTS "patient_vaccinations_select" ON public.patient_vaccinations;
CREATE POLICY "patient_vaccinations_select" ON public.patient_vaccinations FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "patient_vaccinations_insert" ON public.patient_vaccinations;
CREATE POLICY "patient_vaccinations_insert" ON public.patient_vaccinations FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "patient_vaccinations_update" ON public.patient_vaccinations;
CREATE POLICY "patient_vaccinations_update" ON public.patient_vaccinations FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "patient_vaccinations_delete" ON public.patient_vaccinations;
CREATE POLICY "patient_vaccinations_delete" ON public.patient_vaccinations FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS patient_vaccinations_set_updated_at ON public.patient_vaccinations;
CREATE TRIGGER patient_vaccinations_set_updated_at
  BEFORE UPDATE ON public.patient_vaccinations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
