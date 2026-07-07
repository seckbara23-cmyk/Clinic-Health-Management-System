-- ════════════════════════════════════════════════════════════════
-- 055_mental_health_events.sql — Phase 27: Psychiatry / Mental Health Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic mental-health operational-event log
-- for WORKFLOW & CONTINUITY: initial assessment, sessions, medication review,
-- crisis follow-up, safety-plan review, family/support meeting, referral / social
-- support review, return visit. It lets the Copilot surface WORKFLOW status and
-- follow-up REMINDERS ("mental-health follow-up due", "safety-plan documentation
-- missing"). Factual clinician data entry only — the Copilot never writes it
-- automatically, never diagnoses, never predicts risk / self-harm / suicide,
-- never classifies a psychiatric condition, and never recommends treatment /
-- medication / involuntary admission. Safe on a live database.
--
-- ── CONFIDENTIALITY HARDENING (Phase 27, deliberately TIGHTER RLS) ─
-- Unlike the other specialty event logs (which allow ANY clinic member to SELECT
-- and include super_admin in the write role list), mental-health workflow is
-- restricted to the CARE TEAM within the clinic (doctor / nurse / admin) and
-- EXCLUDES super_admin entirely — the platform operator must never gain access
-- to mental-health content. Non-clinical clinic roles (receptionist, cashier,
-- lab, pharmacist) cannot read it either. This STRENGTHENS tenant isolation; it
-- changes no existing policy. Sensitive clinical CONTENT itself continues to live
-- in the already-RLS-protected consultation record — this table stores only
-- workflow events (type / status / dates), flagged is_sensitive by default.
--
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.mental_health_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- initial_assessment|therapy_session|medication_review|crisis_followup|
  -- safety_plan_review|family_meeting|referral_followup|social_support_review|return_visit
  event_type       TEXT NOT NULL,
  -- planned|active|completed|awaiting_review|follow_up_due|cancelled
  status           TEXT NOT NULL DEFAULT 'planned',
  scheduled_at     DATE,
  completed_at     DATE,
  notes            TEXT,
  -- Marks these rows as confidential by default (documentation of intent).
  is_sensitive     BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mental_health_events_patient_idx ON public.mental_health_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS mental_health_events_clinic_idx  ON public.mental_health_events (clinic_id);

ALTER TABLE public.mental_health_events ENABLE ROW LEVEL SECURITY;

-- Read: CARE TEAM within the clinic only (doctor / nurse / admin). NO super_admin,
-- NO non-clinical clinic roles — confidentiality hardening.
DROP POLICY IF EXISTS "mental_health_events_select" ON public.mental_health_events;
CREATE POLICY "mental_health_events_select" ON public.mental_health_events FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin'));

-- Write: care team within their own clinic (doctor / nurse / admin). NO super_admin.
DROP POLICY IF EXISTS "mental_health_events_insert" ON public.mental_health_events;
CREATE POLICY "mental_health_events_insert" ON public.mental_health_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin'));

DROP POLICY IF EXISTS "mental_health_events_update" ON public.mental_health_events;
CREATE POLICY "mental_health_events_update" ON public.mental_health_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin'));

DROP POLICY IF EXISTS "mental_health_events_delete" ON public.mental_health_events;
CREATE POLICY "mental_health_events_delete" ON public.mental_health_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin'));

DROP TRIGGER IF EXISTS mental_health_events_set_updated_at ON public.mental_health_events;
CREATE TRIGGER mental_health_events_set_updated_at
  BEFORE UPDATE ON public.mental_health_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
