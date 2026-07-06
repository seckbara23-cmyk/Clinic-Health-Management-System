-- ════════════════════════════════════════════════════════════════
-- 045_pregnancies.sql — Phase 18: Obstetrics & Gynecology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Records a pregnancy episode (LMP, EDD,
-- status, gravida/para) so the ANC tracker can compute gestational age / due
-- date and surface follow-up REMINDERS. This is factual clinical data entry (a
-- clinician records LMP), NOT a recommendation — the Copilot never writes it
-- automatically, never classifies risk, and never interprets. Safe on a live db.
--
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation) — the
-- proven-safe shape. No composite-FK PK → no PostgREST junction ambiguity.

CREATE TABLE IF NOT EXISTS public.pregnancies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- surrogate PK (NOT composite)
  clinic_id           UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id     UUID          REFERENCES public.consultations(id),  -- optional
  lmp_date            DATE,
  estimated_due_date  DATE,
  pregnancy_status    TEXT NOT NULL DEFAULT 'ongoing',  -- ongoing|postpartum|completed|ended
  gravida             INTEGER,
  para                INTEGER,
  notes               TEXT,
  created_by          UUID REFERENCES public.user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pregnancies_patient_idx ON public.pregnancies (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pregnancies_clinic_idx  ON public.pregnancies (clinic_id);

ALTER TABLE public.pregnancies ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "pregnancies_select" ON public.pregnancies;
CREATE POLICY "pregnancies_select" ON public.pregnancies FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse[=midwife] / admin), own clinic.
DROP POLICY IF EXISTS "pregnancies_insert" ON public.pregnancies;
CREATE POLICY "pregnancies_insert" ON public.pregnancies FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "pregnancies_update" ON public.pregnancies;
CREATE POLICY "pregnancies_update" ON public.pregnancies FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "pregnancies_delete" ON public.pregnancies;
CREATE POLICY "pregnancies_delete" ON public.pregnancies FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS pregnancies_set_updated_at ON public.pregnancies;
CREATE TRIGGER pregnancies_set_updated_at
  BEFORE UPDATE ON public.pregnancies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
