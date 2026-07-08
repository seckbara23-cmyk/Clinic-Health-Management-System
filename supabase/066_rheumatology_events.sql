-- ════════════════════════════════════════════════════════════════
-- 066_rheumatology_events.sql — Phase 38: Rheumatology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic rheumatology operational-event log for
-- RHEUMATOLOGY WORKFLOW & CONTINUITY: rheumatology consultation, joint follow-up,
-- autoimmune-clinic follow-up, infusion follow-up, medication-monitoring visit,
-- joint-aspiration & injection follow-up, physiotherapy & occupational-rehab
-- referral, bone-health review, hospital-discharge follow-up, plus investigation
-- (ANA, anti-CCP, rheumatoid factor, ESR, CRP, HLA-B27, joint aspiration, synovial
-- fluid analysis, musculoskeletal ultrasound, joint X-ray, MRI joints, bone density
-- / DEXA) tracking. It lets the Copilot surface WORKFLOW status and follow-up
-- REMINDERS ("ANA awaiting review", "infusion follow-up due", "joint aspiration
-- follow-up pending"). Factual clinician data entry only — the Copilot never writes
-- it automatically, never diagnoses, never classifies rheumatologic conditions,
-- never interprets laboratory / joint aspiration / X-ray / ultrasound / MRI, never
-- recommends DMARDs / biologics / steroids / NSAIDs / surgery / injections /
-- admission / discharge, never predicts disability / progression, and never
-- calculates DAS28 / SLEDAI / BASDAI / CDAI. Safe on a live database.
--
-- Mirrors 065_infectious_disease_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.rheumatology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: rheumatology_consultation|joint_followup|autoimmune_clinic_followup|infusion_followup|
  --          medication_monitoring_visit|joint_aspiration_followup|injection_followup|
  --          physiotherapy_referral|occupational_therapy_referral|bone_health_review|
  --          hospital_discharge_followup
  -- tests:   ana|anti_ccp|rheumatoid_factor|esr|crp|hla_b27|joint_aspiration|synovial_fluid_analysis|
  --          msk_ultrasound|joint_xray|mri_joints|bone_density
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

CREATE INDEX IF NOT EXISTS rheumatology_events_patient_idx ON public.rheumatology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS rheumatology_events_clinic_idx  ON public.rheumatology_events (clinic_id);

ALTER TABLE public.rheumatology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "rheumatology_events_select" ON public.rheumatology_events;
CREATE POLICY "rheumatology_events_select" ON public.rheumatology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "rheumatology_events_insert" ON public.rheumatology_events;
CREATE POLICY "rheumatology_events_insert" ON public.rheumatology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "rheumatology_events_update" ON public.rheumatology_events;
CREATE POLICY "rheumatology_events_update" ON public.rheumatology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "rheumatology_events_delete" ON public.rheumatology_events;
CREATE POLICY "rheumatology_events_delete" ON public.rheumatology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS rheumatology_events_set_updated_at ON public.rheumatology_events;
CREATE TRIGGER rheumatology_events_set_updated_at
  BEFORE UPDATE ON public.rheumatology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
