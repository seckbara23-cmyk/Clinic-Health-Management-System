-- ════════════════════════════════════════════════════════════════
-- 062_dermatology_events.sql — Phase 34: Dermatology Copilot
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. A generic dermatology operational-event log for
-- DERMATOLOGY WORKFLOW & CONTINUITY: dermatology consultation, skin-lesion & mole
-- follow-up, skin-biopsy follow-up, histopathology review, cryotherapy & procedure
-- follow-up, wound / dressing review, suture removal, patch testing, phototherapy
-- review, skin-photography review, dermatologic-surgery follow-up, hospital-
-- discharge follow-up, plus investigation (skin biopsy / histopathology /
-- dermoscopy / skin photography / patch test / fungal microscopy / culture)
-- tracking. It lets the Copilot surface WORKFLOW status and follow-up REMINDERS
-- ("histopathology review awaiting clinician", "biopsy follow-up due", "dressing
-- review pending"). Factual clinician data entry only — the Copilot never writes it
-- automatically, never diagnoses skin disease, never classifies melanoma / eczema /
-- psoriasis / dermatitis, never interprets dermoscopy / pathology / biopsy, never
-- recommends a biopsy / surgery / a medication / a topical / an antibiotic / an
-- antifungal, and never predicts malignancy / recurrence. Safe on a live database.
--
-- Mirrors 061_endocrinology_events.sql exactly (same shape, RLS, trigger).
-- Surrogate PK; FK COLUMNS (clinic, patient, optional consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.dermatology_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),  -- optional
  -- tracker: dermatology_consultation|skin_lesion_followup|mole_followup|skin_biopsy_followup|
  --          histopathology_review|cryotherapy_followup|dermatologic_procedure_followup|
  --          wound_review|dressing_review|suture_removal|patch_testing|phototherapy_review|
  --          skin_photography_review|dermatologic_surgery_followup|hospital_discharge_followup
  -- tests:   skin_biopsy|histopathology|dermoscopy|skin_photography|patch_test|fungal_microscopy|culture
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

CREATE INDEX IF NOT EXISTS dermatology_events_patient_idx ON public.dermatology_events (patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS dermatology_events_clinic_idx  ON public.dermatology_events (clinic_id);

ALTER TABLE public.dermatology_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "dermatology_events_select" ON public.dermatology_events;
CREATE POLICY "dermatology_events_select" ON public.dermatology_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: clinical roles only (doctor / nurse / admin), within their own clinic.
DROP POLICY IF EXISTS "dermatology_events_insert" ON public.dermatology_events;
CREATE POLICY "dermatology_events_insert" ON public.dermatology_events FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "dermatology_events_update" ON public.dermatology_events;
CREATE POLICY "dermatology_events_update" ON public.dermatology_events FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "dermatology_events_delete" ON public.dermatology_events;
CREATE POLICY "dermatology_events_delete" ON public.dermatology_events FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS dermatology_events_set_updated_at ON public.dermatology_events;
CREATE TRIGGER dermatology_events_set_updated_at
  BEFORE UPDATE ON public.dermatology_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
