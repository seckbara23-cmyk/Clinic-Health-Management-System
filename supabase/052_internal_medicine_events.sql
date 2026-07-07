-- ════════════════════════════════════════════════════════════════
-- 052_internal_medicine_events.sql — Phase 24: Internal Medicine Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic internal-medicine operational-event
-- log for CHRONIC-DISEASE WORKFLOW: chronic-care reviews (diabetes, hypertension,
-- CKD, asthma/COPD, dyslipidemia, thyroid, anemia), hospital-discharge follow-up,
-- medication / polypharmacy review. It lets the Copilot surface WORKFLOW status
-- and follow-up REMINDERS ("chronic-care review overdue", "discharge follow-up
-- due"). Factual clinician data entry only — the Copilot never writes it
-- automatically, never interprets a lab value, never classifies disease
-- severity, and never diagnoses or recommends a treatment / medication. Safe on
-- a live database.
--
-- Mirrors 051_emergency_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.internal_medicine_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- chronic: diabetes|hypertension|ckd|asthma_copd|dyslipidemia|thyroid|anemia
  -- other:   discharge_followup|medication_review|polypharmacy_review
  event_type       TEXT NOT NULL,
  -- due|overdue|completed|awaiting_review|scheduled|cancelled
  status           TEXT NOT NULL DEFAULT 'due',
  scheduled_at     DATE,
  completed_at     DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS internal_medicine_events_patient_idx ON public.internal_medicine_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS internal_medicine_events_clinic_idx  ON public.internal_medicine_events (clinic_id);

ALTER TABLE public.internal_medicine_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "internal_medicine_events_select" ON public.internal_medicine_events;
CREATE POLICY "internal_medicine_events_select" ON public.internal_medicine_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "internal_medicine_events_insert" ON public.internal_medicine_events;
CREATE POLICY "internal_medicine_events_insert" ON public.internal_medicine_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "internal_medicine_events_update" ON public.internal_medicine_events;
CREATE POLICY "internal_medicine_events_update" ON public.internal_medicine_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "internal_medicine_events_delete" ON public.internal_medicine_events;
CREATE POLICY "internal_medicine_events_delete" ON public.internal_medicine_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS internal_medicine_events_set_updated_at ON public.internal_medicine_events;
CREATE TRIGGER internal_medicine_events_set_updated_at
  BEFORE UPDATE ON public.internal_medicine_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
