-- ════════════════════════════════════════════════════════════════
-- 051_emergency_events.sql — Phase 23: Emergency Medicine Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic emergency operational-event log
-- (arrival / pending results: lab, imaging, ECG, ultrasound, CT, MRI, consult;
-- observation started/ongoing/completed; disposition: admission, discharge,
-- transfer, referral request; and ED procedures: suturing, casting, I&D, chest
-- tube, central line, intubation, CPR, wound care) so the Copilot can surface
-- WORKFLOW status and follow-up REMINDERS ("labs awaiting review", "observation
-- review due"). Factual clinician data entry only — the Copilot never writes it
-- automatically, never interprets a result, never determines triage, and never
-- diagnoses or recommends a treatment / disposition / procedure. Safe on a live
-- database.
--
-- Mirrors 050_cardiology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.emergency_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- results: lab|imaging|ecg|ultrasound|ct|mri|consult
  -- procedures: suturing|casting|incision_drainage|chest_tube|central_line|intubation|cpr|wound_care
  -- observation: observation ; disposition: admission|discharge|transfer|referral_request
  -- flow: arrival|consultation_started|medication_dispensed
  event_type       TEXT NOT NULL,
  -- ordered|completed|awaiting_review|reviewed|planned|performed|follow_up|started|ongoing|done|cancelled
  status           TEXT NOT NULL DEFAULT 'ordered',
  event_date       DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS emergency_events_patient_idx ON public.emergency_events (patient_id, event_date DESC);
CREATE INDEX IF NOT EXISTS emergency_events_clinic_idx  ON public.emergency_events (clinic_id);

ALTER TABLE public.emergency_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "emergency_events_select" ON public.emergency_events;
CREATE POLICY "emergency_events_select" ON public.emergency_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "emergency_events_insert" ON public.emergency_events;
CREATE POLICY "emergency_events_insert" ON public.emergency_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "emergency_events_update" ON public.emergency_events;
CREATE POLICY "emergency_events_update" ON public.emergency_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "emergency_events_delete" ON public.emergency_events;
CREATE POLICY "emergency_events_delete" ON public.emergency_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS emergency_events_set_updated_at ON public.emergency_events;
CREATE TRIGGER emergency_events_set_updated_at
  BEFORE UPDATE ON public.emergency_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
