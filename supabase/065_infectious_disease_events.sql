-- ════════════════════════════════════════════════════════════════
-- 065_infectious_disease_events.sql — Phase 37: Infectious Diseases Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic infectious-diseases operational-event
-- log for INFECTIOUS-DISEASES & TROPICAL-MEDICINE WORKFLOW & CONTINUITY: ID
-- consultation, fever / malaria follow-up, tuberculosis / HIV clinic follow-up,
-- hepatitis follow-up, culture & microbiology review, isolation review, travel-
-- medicine review, vaccination follow-up, hospital-discharge follow-up, contact &
-- public-health follow-up, nutrition review, plus investigation (blood / urine /
-- stool / sputum culture, PCR, rapid diagnostic test, AFB smear, GeneXpert, HIV
-- test, hepatitis panel, malaria smear / rapid test, chest X-ray, CT, MRI,
-- laboratory panel) tracking. It lets the Copilot surface WORKFLOW status and
-- follow-up REMINDERS ("blood culture awaiting review", "PCR awaiting clinician",
-- "tuberculosis clinic follow-up due"). Factual clinician data entry only — the
-- Copilot never writes it automatically, never diagnoses, never interprets
-- laboratory / culture / PCR / rapid-test / imaging results, never recommends
-- antibiotics / antivirals / antifungals / antiparasitics / admission / isolation /
-- discharge / vaccination / public-health reporting, and never predicts outbreaks
-- or calculates severity scores. Safe on a live database.
--
-- Mirrors 064_gastroenterology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.infectious_disease_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: id_consultation|fever_followup|malaria_followup|tuberculosis_clinic_followup|
  --          hiv_clinic_followup|hepatitis_followup|culture_review|microbiology_review|
  --          isolation_review|travel_medicine_review|vaccination_followup|
  --          hospital_discharge_followup|contact_followup|public_health_followup|nutrition_review
  -- tests:   blood_culture|urine_culture|stool_culture|sputum_culture|pcr|rapid_diagnostic_test|
  --          afb_smear|genexpert|hiv_test|hepatitis_panel|malaria_smear|malaria_rapid_test|
  --          chest_xray|ct|mri|laboratory_panel
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

CREATE INDEX IF NOT EXISTS infectious_disease_events_patient_idx ON public.infectious_disease_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS infectious_disease_events_clinic_idx  ON public.infectious_disease_events (clinic_id);

ALTER TABLE public.infectious_disease_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "infectious_disease_events_select" ON public.infectious_disease_events;
CREATE POLICY "infectious_disease_events_select" ON public.infectious_disease_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "infectious_disease_events_insert" ON public.infectious_disease_events;
CREATE POLICY "infectious_disease_events_insert" ON public.infectious_disease_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "infectious_disease_events_update" ON public.infectious_disease_events;
CREATE POLICY "infectious_disease_events_update" ON public.infectious_disease_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "infectious_disease_events_delete" ON public.infectious_disease_events;
CREATE POLICY "infectious_disease_events_delete" ON public.infectious_disease_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS infectious_disease_events_set_updated_at ON public.infectious_disease_events;
CREATE TRIGGER infectious_disease_events_set_updated_at
  BEFORE UPDATE ON public.infectious_disease_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
