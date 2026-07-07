-- ════════════════════════════════════════════════════════════════
-- 057_nephrology_events.sql — Phase 29: Nephrology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic nephrology operational-event log
-- for KIDNEY-CARE WORKFLOW: nephrology consultation, dialysis session & review,
-- kidney biopsy, transplant review, nutrition referral, CKD-clinic and
-- hypertension follow-up, post-discharge review, plus renal laboratory
-- monitoring (creatinine / eGFR / urinalysis / urine protein / albumin /
-- electrolytes) and imaging (renal ultrasound / kidney CT / MRI). It lets the
-- Copilot surface WORKFLOW status and follow-up REMINDERS ("renal laboratory
-- review pending", "dialysis review due"). Factual clinician data entry only —
-- the Copilot never writes it automatically, never interprets a laboratory
-- value, never classifies CKD / AKI / nephrotic syndrome, and never diagnoses or
-- recommends dialysis / a treatment / a medication. Safe on a live database.
--
-- Mirrors 056_pulmonology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.nephrology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: nephrology_consultation|dialysis_session|dialysis_review|transplant_review|
  --          nutrition_referral|ckd_clinic_followup|hypertension_review|post_discharge_review
  -- tests:   creatinine|egfr|urinalysis|urine_protein|albumin|electrolytes|
  --          renal_ultrasound|kidney_ct|kidney_mri|kidney_biopsy
  event_type       TEXT NOT NULL,
  -- planned|active|completed|awaiting_review|follow_up_due|ordered|reviewed|cancelled
  status           TEXT NOT NULL DEFAULT 'planned',
  scheduled_at     DATE,
  completed_at     DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nephrology_events_patient_idx ON public.nephrology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS nephrology_events_clinic_idx  ON public.nephrology_events (clinic_id);

ALTER TABLE public.nephrology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "nephrology_events_select" ON public.nephrology_events;
CREATE POLICY "nephrology_events_select" ON public.nephrology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "nephrology_events_insert" ON public.nephrology_events;
CREATE POLICY "nephrology_events_insert" ON public.nephrology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "nephrology_events_update" ON public.nephrology_events;
CREATE POLICY "nephrology_events_update" ON public.nephrology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "nephrology_events_delete" ON public.nephrology_events;
CREATE POLICY "nephrology_events_delete" ON public.nephrology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS nephrology_events_set_updated_at ON public.nephrology_events;
CREATE TRIGGER nephrology_events_set_updated_at
  BEFORE UPDATE ON public.nephrology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
