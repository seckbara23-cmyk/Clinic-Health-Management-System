-- ════════════════════════════════════════════════════════════════
-- 046_orl_events.sql — Phase 19: ORL / ENT Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic ORL operational-event log
-- (audiometry, endoscopy, imaging, biopsy/pathology, post-op) so the Copilot
-- can surface follow-up REMINDERS ("result awaiting review", "post-op due").
-- Factual clinical data entry (a clinician records that an event was
-- ordered/completed) — the Copilot never writes it automatically, never
-- interprets a result, and never diagnoses. Safe on a live database.
--
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.orl_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  event_type       TEXT NOT NULL,   -- audiometry|hearing_aid|nasal_endoscopy|laryngoscopy|ct_sinus|mri_neck|ct_neck|biopsy|pathology|post_op_visit|wound_review|packing_removal
  status           TEXT NOT NULL DEFAULT 'ordered',  -- ordered|completed|awaiting_review|reviewed|due|done|cancelled
  event_date       DATE,
  notes            TEXT,
  created_by       UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orl_events_patient_idx ON public.orl_events (patient_id, event_date DESC);
CREATE INDEX IF NOT EXISTS orl_events_clinic_idx  ON public.orl_events (clinic_id);

ALTER TABLE public.orl_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "orl_events_select" ON public.orl_events;
CREATE POLICY "orl_events_select" ON public.orl_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "orl_events_insert" ON public.orl_events;
CREATE POLICY "orl_events_insert" ON public.orl_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "orl_events_update" ON public.orl_events;
CREATE POLICY "orl_events_update" ON public.orl_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "orl_events_delete" ON public.orl_events;
CREATE POLICY "orl_events_delete" ON public.orl_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS orl_events_set_updated_at ON public.orl_events;
CREATE TRIGGER orl_events_set_updated_at
  BEFORE UPDATE ON public.orl_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
