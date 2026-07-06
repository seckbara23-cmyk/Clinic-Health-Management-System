-- ════════════════════════════════════════════════════════════════
-- 050_cardiology_events.sql — Phase 22: Cardiology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic cardiology operational-event log
-- (ECG / Echo / stress test / Holter / cardiac CT/MRI / cath lab, plus cardiac
-- PROCEDURES: PCI / CABG / pacemaker / ICD / valve surgery / catheterization,
-- plus admissions / medication changes / reviews) so the Copilot can surface
-- WORKFLOW status and follow-up REMINDERS ("ECG awaiting review", "procedure
-- follow-up due"). Factual clinician data entry only — the Copilot never writes
-- it automatically, never interprets an ECG / Echo / any result, and never
-- diagnoses or recommends a treatment / procedure. Safe on a live database.
--
-- Mirrors 046_orl_events.sql exactly (same shape, RLS, trigger). Surrogate PK;
-- FK COLUMNS (clinic, patient, optional consultation). No composite-FK PK → no
-- PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.cardiology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tests: ecg|echo|stress_test|holter|cardiac_ct|cardiac_mri|cath_lab
  -- procedures: pci|cabg|pacemaker|icd|valve_surgery|cardiac_catheterization
  -- other: admission|medication_change|review
  event_type       TEXT NOT NULL,
  -- ordered|scheduled|planned|completed|awaiting_review|reviewed|follow_up|due|cancelled
  status           TEXT NOT NULL DEFAULT 'ordered',
  event_date       DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cardiology_events_patient_idx ON public.cardiology_events (patient_id, event_date DESC);
CREATE INDEX IF NOT EXISTS cardiology_events_clinic_idx  ON public.cardiology_events (clinic_id);

ALTER TABLE public.cardiology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "cardiology_events_select" ON public.cardiology_events;
CREATE POLICY "cardiology_events_select" ON public.cardiology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "cardiology_events_insert" ON public.cardiology_events;
CREATE POLICY "cardiology_events_insert" ON public.cardiology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "cardiology_events_update" ON public.cardiology_events;
CREATE POLICY "cardiology_events_update" ON public.cardiology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "cardiology_events_delete" ON public.cardiology_events;
CREATE POLICY "cardiology_events_delete" ON public.cardiology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS cardiology_events_set_updated_at ON public.cardiology_events;
CREATE TRIGGER cardiology_events_set_updated_at
  BEFORE UPDATE ON public.cardiology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
