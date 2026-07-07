-- ════════════════════════════════════════════════════════════════
-- 063_urology_events.sql — Phase 35: Urology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic urology operational-event log for
-- UROLOGY WORKFLOW & CONTINUITY: urology consultation, kidney-stone & hematuria
-- follow-up, catheter review & removal, cystoscopy follow-up, prostate & bladder
-- review, biopsy & post-operative review, hospital-discharge follow-up, urinary-
-- retention review, stent / nephrostomy / continence review, plus investigation
-- (urinalysis / urine culture / PSA / kidney & bladder ultrasound / CT KUB / CT
-- urogram / MRI prostate / cystoscopy / urodynamics / biopsy) tracking. It lets the
-- Copilot surface WORKFLOW status and follow-up REMINDERS ("catheter review due",
-- "cystoscopy awaiting review", "PSA review awaiting clinician"). Factual clinician
-- data entry only — the Copilot never writes it automatically, never diagnoses,
-- never interprets laboratory / ultrasound / CT / MRI / cystoscopy, never
-- classifies kidney stones / prostate / bladder disease / urinary infections, never
-- recommends a medication / antibiotic / surgery / procedure / catheterization /
-- admission / discharge / dialysis, and never predicts renal outcome / cancer /
-- risk scores. Safe on a live database.
--
-- Mirrors 062_dermatology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.urology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: urology_consultation|kidney_stone_followup|hematuria_followup|catheter_review|
  --          catheter_removal|cystoscopy_followup|prostate_review|bladder_review|biopsy_followup|
  --          postoperative_review|hospital_discharge_followup|urinary_retention_review|stent_review|
  --          nephrostomy_review|continence_review
  -- tests:   urinalysis|urine_culture|psa|kidney_ultrasound|bladder_ultrasound|ct_kub|ct_urogram|
  --          mri_prostate|cystoscopy|urodynamics|biopsy
  event_type       TEXT NOT NULL,
  -- planned|scheduled|active|completed|awaiting_review|follow_up_due|ordered|reviewed|cancelled
  status           TEXT NOT NULL DEFAULT 'planned',
  scheduled_at     DATE,
  completed_at     DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS urology_events_patient_idx ON public.urology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS urology_events_clinic_idx  ON public.urology_events (clinic_id);

ALTER TABLE public.urology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "urology_events_select" ON public.urology_events;
CREATE POLICY "urology_events_select" ON public.urology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "urology_events_insert" ON public.urology_events;
CREATE POLICY "urology_events_insert" ON public.urology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "urology_events_update" ON public.urology_events;
CREATE POLICY "urology_events_update" ON public.urology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "urology_events_delete" ON public.urology_events;
CREATE POLICY "urology_events_delete" ON public.urology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS urology_events_set_updated_at ON public.urology_events;
CREATE TRIGGER urology_events_set_updated_at
  BEFORE UPDATE ON public.urology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
