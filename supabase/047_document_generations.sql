-- ════════════════════════════════════════════════════════════════
-- 047_document_generations.sql — Phase 20: Clinical Documents & Forms
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. An AUDIT log of clinical-document
-- generation / printing / export — METADATA ONLY. No document CONTENT is
-- stored here (documents are printed from the browser); this table records who
-- generated which document type for which patient, and when. Safe on a live db.
--
-- Surrogate PK; FK COLUMNS (clinic, optional patient/consultation). No
-- composite-FK PK → no PostgREST junction ambiguity (the P0 rule).

CREATE TABLE IF NOT EXISTS public.document_generations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),      -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id       UUID          REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id  UUID          REFERENCES public.consultations(id),
  document_id      TEXT NOT NULL,   -- registry id (references code, not a table)
  action           TEXT NOT NULL DEFAULT 'generated',  -- generated|printed|exported
  generated_by     UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_generations_clinic_idx  ON public.document_generations (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_generations_patient_idx ON public.document_generations (patient_id, created_at DESC);

ALTER TABLE public.document_generations ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (clinic-scoped, RLS-isolated).
DROP POLICY IF EXISTS "document_generations_select" ON public.document_generations;
CREATE POLICY "document_generations_select" ON public.document_generations FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write (append): clinical roles within their own clinic. Append-only audit.
DROP POLICY IF EXISTS "document_generations_insert" ON public.document_generations;
CREATE POLICY "document_generations_insert" ON public.document_generations FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));

DROP POLICY IF EXISTS "document_generations_update" ON public.document_generations;
CREATE POLICY "document_generations_update" ON public.document_generations FOR UPDATE USING (false);
DROP POLICY IF EXISTS "document_generations_delete" ON public.document_generations;
CREATE POLICY "document_generations_delete" ON public.document_generations FOR DELETE USING (false);
