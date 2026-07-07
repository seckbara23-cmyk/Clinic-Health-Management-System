-- ════════════════════════════════════════════════════════════════
-- 056_pulmonology_events.sql — Phase 28: Pulmonology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic pulmonology operational-event log
-- for RESPIRATORY WORKFLOW: pulmonary consultation, spirometry / pulmonary
-- function tests, chest imaging (X-ray / CT), bronchoscopy, sleep study, oxygen
-- assessment, pulmonary-rehabilitation referral, smoking-cessation and
-- post-discharge review. It lets the Copilot surface WORKFLOW status and
-- follow-up REMINDERS ("PFT awaiting review", "bronchoscopy follow-up due").
-- Factual clinician data entry only — the Copilot never writes it automatically,
-- never interprets an investigation, never classifies COPD / asthma / fibrosis /
-- pneumonia, and never diagnoses or recommends a treatment / medication. Safe on
-- a live database.
--
-- Mirrors 054_ophthalmology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.pulmonology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: pulmonary_consultation|oxygen_assessment|pulmonary_rehab_referral|
  --          smoking_cessation|post_discharge_review
  -- tests:   chest_xray|chest_ct|pulmonary_function_test|spirometry|bronchoscopy|sleep_study
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

CREATE INDEX IF NOT EXISTS pulmonology_events_patient_idx ON public.pulmonology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS pulmonology_events_clinic_idx  ON public.pulmonology_events (clinic_id);

ALTER TABLE public.pulmonology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "pulmonology_events_select" ON public.pulmonology_events;
CREATE POLICY "pulmonology_events_select" ON public.pulmonology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "pulmonology_events_insert" ON public.pulmonology_events;
CREATE POLICY "pulmonology_events_insert" ON public.pulmonology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "pulmonology_events_update" ON public.pulmonology_events;
CREATE POLICY "pulmonology_events_update" ON public.pulmonology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "pulmonology_events_delete" ON public.pulmonology_events;
CREATE POLICY "pulmonology_events_delete" ON public.pulmonology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS pulmonology_events_set_updated_at ON public.pulmonology_events;
CREATE TRIGGER pulmonology_events_set_updated_at
  BEFORE UPDATE ON public.pulmonology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
