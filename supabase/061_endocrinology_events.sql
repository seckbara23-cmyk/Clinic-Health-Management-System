-- ════════════════════════════════════════════════════════════════
-- 061_endocrinology_events.sql — Phase 33: Endocrinology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic endocrinology operational-event log
-- for ENDOCRINOLOGY WORKFLOW & CONTINUITY: endocrinology consultation, diabetes /
-- thyroid / pituitary / adrenal clinic follow-up, osteoporosis & obesity review,
-- nutrition & diabetes-education referral, laboratory / imaging / hormone review,
-- foot-examination & eye-screening follow-up, hospital-discharge follow-up, plus
-- laboratory & imaging (HbA1c / TSH / free T4 / free T3 / cortisol / ACTH /
-- prolactin / IGF-1 / LH / FSH / estradiol / testosterone / vitamin D / calcium /
-- DEXA / thyroid ultrasound / pituitary MRI) tracking. It lets the Copilot surface
-- WORKFLOW status and follow-up REMINDERS ("HbA1c review awaiting clinician",
-- "thyroid ultrasound review pending", "diabetes clinic follow-up due"). Factual
-- clinician data entry only — the Copilot never writes it automatically, never
-- diagnoses, never classifies diabetes / thyroid / pituitary / adrenal disease,
-- never interprets HbA1c / thyroid hormones / cortisol / pituitary hormones / MRI /
-- ultrasound, never recommends insulin / a medication / a dosage / surgery /
-- admission / discharge, never predicts complications / mortality / cardiovascular
-- risk, and never calculates diabetes or fracture-risk scores. Safe on a live
-- database.
--
-- Mirrors 060_neurology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.endocrinology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: endocrinology_consultation|diabetes_clinic_followup|thyroid_clinic_followup|
  --          pituitary_clinic_followup|adrenal_clinic_followup|osteoporosis_review|
  --          obesity_clinic_review|nutrition_referral|diabetes_education_referral|
  --          laboratory_followup|imaging_followup|hormone_review|foot_examination_followup|
  --          eye_screening_followup|hospital_discharge_followup
  -- tests:   hba1c|tsh|free_t4|free_t3|cortisol|acth|prolactin|igf1|lh|fsh|estradiol|
  --          testosterone|vitamin_d|calcium|dexa|thyroid_ultrasound|pituitary_mri
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

CREATE INDEX IF NOT EXISTS endocrinology_events_patient_idx ON public.endocrinology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS endocrinology_events_clinic_idx  ON public.endocrinology_events (clinic_id);

ALTER TABLE public.endocrinology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "endocrinology_events_select" ON public.endocrinology_events;
CREATE POLICY "endocrinology_events_select" ON public.endocrinology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "endocrinology_events_insert" ON public.endocrinology_events;
CREATE POLICY "endocrinology_events_insert" ON public.endocrinology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "endocrinology_events_update" ON public.endocrinology_events;
CREATE POLICY "endocrinology_events_update" ON public.endocrinology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "endocrinology_events_delete" ON public.endocrinology_events;
CREATE POLICY "endocrinology_events_delete" ON public.endocrinology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS endocrinology_events_set_updated_at ON public.endocrinology_events;
CREATE TRIGGER endocrinology_events_set_updated_at
  BEFORE UPDATE ON public.endocrinology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
