-- ════════════════════════════════════════════════════════════════
-- 058_oncology_events.sql — Phase 30: Oncology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic oncology operational-event log for
-- CANCER-CARE WORKFLOW & CONTINUITY: oncology consultation, chemotherapy /
-- immunotherapy cycles, radiotherapy sessions, tumor-board (MDT) review,
-- pathology & biopsy follow-up, survivorship visits, palliative-support review,
-- nutrition consultation, plus pathology / biopsy / imaging (PET / CT / MRI /
-- ultrasound / bone scan) and laboratory-readiness tracking. It lets the Copilot
-- surface WORKFLOW status and follow-up REMINDERS ("pathology review pending",
-- "chemotherapy follow-up due"). Factual clinician data entry only — the Copilot
-- never writes it automatically, never diagnoses cancer, never interprets
-- pathology / biopsy / imaging, never stages / grades / assigns TNM, and never
-- recommends chemotherapy / radiotherapy / a treatment / a medication, nor
-- predicts survival / recurrence / prognosis. Safe on a live database.
--
-- Mirrors 057_nephrology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.oncology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: oncology_consultation|chemotherapy_cycle|immunotherapy_cycle|radiotherapy_session|
  --          tumor_board_review|pathology_review|biopsy_followup|survivorship_visit|
  --          palliative_support_review|nutrition_consultation
  -- tests:   pathology|biopsy|pet|ct|mri|ultrasound|bone_scan|laboratory_readiness
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

CREATE INDEX IF NOT EXISTS oncology_events_patient_idx ON public.oncology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS oncology_events_clinic_idx  ON public.oncology_events (clinic_id);

ALTER TABLE public.oncology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "oncology_events_select" ON public.oncology_events;
CREATE POLICY "oncology_events_select" ON public.oncology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "oncology_events_insert" ON public.oncology_events;
CREATE POLICY "oncology_events_insert" ON public.oncology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "oncology_events_update" ON public.oncology_events;
CREATE POLICY "oncology_events_update" ON public.oncology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "oncology_events_delete" ON public.oncology_events;
CREATE POLICY "oncology_events_delete" ON public.oncology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS oncology_events_set_updated_at ON public.oncology_events;
CREATE TRIGGER oncology_events_set_updated_at
  BEFORE UPDATE ON public.oncology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
