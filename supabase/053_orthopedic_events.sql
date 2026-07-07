-- ════════════════════════════════════════════════════════════════
-- 053_orthopedic_events.sql — Phase 25: Orthopedics Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic orthopedics operational-event log
-- for MUSCULOSKELETAL WORKFLOW: fracture follow-up, cast/splint application &
-- review, wound review, post-operative review, physiotherapy referral, implant
-- follow-up, joint-injection follow-up, and orthopedic imaging (X-ray / CT / MRI).
-- It lets the Copilot surface WORKFLOW status and follow-up REMINDERS ("cast
-- review due", "X-ray awaiting review"). Factual clinician data entry only — the
-- Copilot never writes it automatically, never interprets an image, never
-- classifies a fracture, and never diagnoses or recommends a treatment / surgery
-- / medication. Safe on a live database.
--
-- Mirrors 052_internal_medicine_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.orthopedic_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: fracture_followup|cast_applied|cast_review|splint_review|wound_review|
  --          post_op_review|physiotherapy_referral|implant_followup|joint_injection_followup
  -- imaging: xray|ct|mri
  event_type       TEXT NOT NULL,
  -- planned|active|completed|awaiting_review|follow_up_due|ordered|cancelled
  status           TEXT NOT NULL DEFAULT 'planned',
  scheduled_at     DATE,
  completed_at     DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orthopedic_events_patient_idx ON public.orthopedic_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS orthopedic_events_clinic_idx  ON public.orthopedic_events (clinic_id);

ALTER TABLE public.orthopedic_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "orthopedic_events_select" ON public.orthopedic_events;
CREATE POLICY "orthopedic_events_select" ON public.orthopedic_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "orthopedic_events_insert" ON public.orthopedic_events;
CREATE POLICY "orthopedic_events_insert" ON public.orthopedic_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "orthopedic_events_update" ON public.orthopedic_events;
CREATE POLICY "orthopedic_events_update" ON public.orthopedic_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "orthopedic_events_delete" ON public.orthopedic_events;
CREATE POLICY "orthopedic_events_delete" ON public.orthopedic_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS orthopedic_events_set_updated_at ON public.orthopedic_events;
CREATE TRIGGER orthopedic_events_set_updated_at
  BEFORE UPDATE ON public.orthopedic_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
