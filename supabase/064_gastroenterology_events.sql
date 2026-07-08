-- ════════════════════════════════════════════════════════════════
-- 064_gastroenterology_events.sql — Phase 36: Gastroenterology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic gastroenterology operational-event
-- log for GI WORKFLOW & CONTINUITY: GI consultation, endoscopy / colonoscopy /
-- gastroscopy follow-up, biopsy follow-up, pathology review, liver-clinic follow-up,
-- IBD follow-up, nutrition referral, post-operative & discharge follow-up, plus
-- investigation (endoscopy / colonoscopy / gastroscopy / abdominal ultrasound / CT /
-- MRI / liver panel / stool test / biopsy / pathology) tracking. It lets the Copilot
-- surface WORKFLOW status and follow-up REMINDERS ("pathology review awaiting
-- clinician", "colonoscopy follow-up due", "abdominal imaging follow-up pending").
-- Factual clinician data entry only — the Copilot never writes it automatically,
-- never diagnoses, never interprets endoscopy / colonoscopy / gastroscopy /
-- pathology / biopsy, never classifies liver disease or IBD, never recommends a
-- treatment / medication / surgery, and never predicts cancer / risk / prognosis.
-- Safe on a live database.
--
-- Mirrors 063_urology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.gastroenterology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: gi_consultation|endoscopy_followup|colonoscopy_followup|gastroscopy_followup|
  --          biopsy_followup|pathology_review|liver_clinic_followup|ibd_followup|
  --          nutrition_referral|postoperative_followup|discharge_followup
  -- tests:   endoscopy|colonoscopy|gastroscopy|abdominal_ultrasound|abdominal_ct|abdominal_mri|
  --          liver_panel|stool_test|biopsy|pathology
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

CREATE INDEX IF NOT EXISTS gastroenterology_events_patient_idx ON public.gastroenterology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS gastroenterology_events_clinic_idx  ON public.gastroenterology_events (clinic_id);

ALTER TABLE public.gastroenterology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "gastroenterology_events_select" ON public.gastroenterology_events;
CREATE POLICY "gastroenterology_events_select" ON public.gastroenterology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "gastroenterology_events_insert" ON public.gastroenterology_events;
CREATE POLICY "gastroenterology_events_insert" ON public.gastroenterology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "gastroenterology_events_update" ON public.gastroenterology_events;
CREATE POLICY "gastroenterology_events_update" ON public.gastroenterology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "gastroenterology_events_delete" ON public.gastroenterology_events;
CREATE POLICY "gastroenterology_events_delete" ON public.gastroenterology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS gastroenterology_events_set_updated_at ON public.gastroenterology_events;
CREATE TRIGGER gastroenterology_events_set_updated_at
  BEFORE UPDATE ON public.gastroenterology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
