-- ════════════════════════════════════════════════════════════════
-- 054_ophthalmology_events.sql — Phase 26: Ophthalmology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic ophthalmology operational-event log
-- for EYE-CARE WORKFLOW: visual-acuity / refraction checks, cataract & glaucoma
-- follow-up, diabetic-eye screening, eye imaging (fundus / OCT / visual field /
-- eye ultrasound), eye-procedure follow-up and post-operative review. It lets
-- the Copilot surface WORKFLOW status and follow-up REMINDERS ("OCT awaiting
-- review", "diabetic eye screening due"). Factual clinician data entry only — the
-- Copilot never writes it automatically, never interprets an image / OCT / visual
-- field, never classifies glaucoma / cataract / retinopathy, and never diagnoses
-- or recommends a treatment / surgery / medication. Safe on a live database.
--
-- Mirrors 053_orthopedic_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.ophthalmology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: visual_acuity|refraction|cataract_review|glaucoma_followup|
  --          diabetic_eye_screening|eye_procedure_followup|post_op_review
  -- imaging: fundus_imaging|oct_imaging|visual_field|eye_ultrasound
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

CREATE INDEX IF NOT EXISTS ophthalmology_events_patient_idx ON public.ophthalmology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS ophthalmology_events_clinic_idx  ON public.ophthalmology_events (clinic_id);

ALTER TABLE public.ophthalmology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "ophthalmology_events_select" ON public.ophthalmology_events;
CREATE POLICY "ophthalmology_events_select" ON public.ophthalmology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "ophthalmology_events_insert" ON public.ophthalmology_events;
CREATE POLICY "ophthalmology_events_insert" ON public.ophthalmology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "ophthalmology_events_update" ON public.ophthalmology_events;
CREATE POLICY "ophthalmology_events_update" ON public.ophthalmology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "ophthalmology_events_delete" ON public.ophthalmology_events;
CREATE POLICY "ophthalmology_events_delete" ON public.ophthalmology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS ophthalmology_events_set_updated_at ON public.ophthalmology_events;
CREATE TRIGGER ophthalmology_events_set_updated_at
  BEFORE UPDATE ON public.ophthalmology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
