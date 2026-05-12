-- ============================================================
-- Phase 2: Lab Requests table + RLS + Realtime
-- Run this in Supabase SQL editor BEFORE deploying Phase 2
-- ============================================================

CREATE TABLE IF NOT EXISTS lab_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  consultation_id UUID REFERENCES consultations(id),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id       UUID NOT NULL REFERENCES auth.users(id),
  test_name       TEXT NOT NULL,
  test_type       TEXT NOT NULL DEFAULT 'other'
    CHECK (test_type IN ('blood','urine','imaging','biopsy','microbiology','other')),
  priority        TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal','urgent','emergency')),
  status          TEXT NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered','collected','processing','resulted','cancelled')),
  clinical_notes  TEXT,
  result_notes    TEXT,
  ordered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resulted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_requests_clinic   ON lab_requests(clinic_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_patient  ON lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_status   ON lab_requests(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_requests_consult  ON lab_requests(consultation_id);

CREATE OR REPLACE TRIGGER trg_lab_requests_updated_at
  BEFORE UPDATE ON lab_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_requests_select" ON public.lab_requests FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

CREATE POLICY "lab_requests_insert" ON public.lab_requests FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','nurse')
    )
  );

CREATE POLICY "lab_requests_update" ON public.lab_requests FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','nurse')
    )
  );

CREATE POLICY "lab_requests_delete" ON public.lab_requests FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ── Realtime ─────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
