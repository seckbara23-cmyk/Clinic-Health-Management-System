-- ════════════════════════════════════════════════════════════════
-- 059_surgery_events.sql — Phase 31: General Surgery Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic surgery operational-event log for
-- SURGICAL WORKFLOW & CONTINUITY: surgical consultation, pre-operative assessment
-- & checklist, operating-room scheduling, surgery scheduled / completed,
-- post-operative / wound / drain review, suture removal, pathology specimen sent
-- & review, ICU / ward / discharge follow-up, plus investigation (CT / MRI /
-- ultrasound / X-ray / endoscopy / colonoscopy / gastroscopy / pathology) and
-- laboratory-readiness tracking. It lets the Copilot surface WORKFLOW status and
-- follow-up REMINDERS ("wound review pending", "pathology review awaiting
-- clinician", "surgery follow-up due"). Factual clinician data entry only — the
-- Copilot never writes it automatically, never diagnoses, never recommends
-- surgery / conservative management / a medication / admission / discharge / ICU
-- / an operative technique / anaesthesia / transfusion, never interprets
-- pathology / CT / MRI / X-ray / endoscopy, and never predicts complications /
-- mortality / surgical success. Safe on a live database.
--
-- Mirrors 058_oncology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.surgery_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: surgical_consultation|preop_assessment|preop_checklist|or_scheduling|
  --          surgery_scheduled|surgery_completed|postop_review|wound_review|drain_review|
  --          suture_removal|pathology_specimen_sent|pathology_review|icu_followup|
  --          ward_followup|discharge_followup
  -- tests:   ct|mri|ultrasound|xray|endoscopy|colonoscopy|gastroscopy|pathology|laboratory_readiness
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

CREATE INDEX IF NOT EXISTS surgery_events_patient_idx ON public.surgery_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS surgery_events_clinic_idx  ON public.surgery_events (clinic_id);

ALTER TABLE public.surgery_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "surgery_events_select" ON public.surgery_events;
CREATE POLICY "surgery_events_select" ON public.surgery_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "surgery_events_insert" ON public.surgery_events;
CREATE POLICY "surgery_events_insert" ON public.surgery_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "surgery_events_update" ON public.surgery_events;
CREATE POLICY "surgery_events_update" ON public.surgery_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "surgery_events_delete" ON public.surgery_events;
CREATE POLICY "surgery_events_delete" ON public.surgery_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS surgery_events_set_updated_at ON public.surgery_events;
CREATE TRIGGER surgery_events_set_updated_at
  BEFORE UPDATE ON public.surgery_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
