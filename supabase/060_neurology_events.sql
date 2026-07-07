-- ════════════════════════════════════════════════════════════════
-- 060_neurology_events.sql — Phase 32: Neurology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic neurology operational-event log for
-- NEUROLOGY WORKFLOW & CONTINUITY: neurology consultation, stroke / epilepsy /
-- headache clinic follow-up, neurodegenerative review, EEG & EMG/NCS ordering and
-- review, lumbar-puncture follow-up, rehabilitation referral & follow-up,
-- neuropsychology referral & review, hospital-discharge follow-up, plus
-- investigation (brain CT / brain MRI / spine MRI / EEG / EMG / nerve conduction
-- study / lumbar puncture / neuropsychology assessment) and laboratory-readiness
-- tracking. It lets the Copilot surface WORKFLOW status and follow-up REMINDERS
-- ("EEG review awaiting clinician", "brain MRI review pending", "rehabilitation
-- follow-up due"). Factual clinician data entry only — the Copilot never writes it
-- automatically, never diagnoses, never classifies stroke / seizure / headache,
-- never interprets EEG / EMG / MRI / CT / lumbar puncture, never recommends
-- thrombolysis / thrombectomy / surgery / a medication / admission / discharge /
-- rehabilitation, never predicts recovery / disability / mortality, and never
-- calculates NIHSS / Modified Rankin / Glasgow Coma Scale / seizure risk. Safe on
-- a live database.
--
-- Mirrors 059_surgery_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.neurology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: neurology_consultation|stroke_clinic_followup|epilepsy_clinic_followup|
  --          headache_clinic_followup|neurodegenerative_review|eeg_ordered|eeg_review|
  --          emg_ncs_ordered|emg_ncs_review|lumbar_puncture_followup|rehabilitation_referral|
  --          rehabilitation_followup|neuropsychology_referral|neuropsychology_review|
  --          hospital_discharge_followup
  -- tests:   brain_ct|brain_mri|spine_mri|eeg|emg|nerve_conduction|lumbar_puncture|
  --          neuropsychology_assessment|laboratory_readiness
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

CREATE INDEX IF NOT EXISTS neurology_events_patient_idx ON public.neurology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS neurology_events_clinic_idx  ON public.neurology_events (clinic_id);

ALTER TABLE public.neurology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "neurology_events_select" ON public.neurology_events;
CREATE POLICY "neurology_events_select" ON public.neurology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "neurology_events_insert" ON public.neurology_events;
CREATE POLICY "neurology_events_insert" ON public.neurology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "neurology_events_update" ON public.neurology_events;
CREATE POLICY "neurology_events_update" ON public.neurology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "neurology_events_delete" ON public.neurology_events;
CREATE POLICY "neurology_events_delete" ON public.neurology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS neurology_events_set_updated_at ON public.neurology_events;
CREATE TRIGGER neurology_events_set_updated_at
  BEFORE UPDATE ON public.neurology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
