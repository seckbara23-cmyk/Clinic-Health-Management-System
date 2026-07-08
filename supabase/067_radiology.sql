-- ════════════════════════════════════════════════════════════════
-- 067_radiology.sql — Phase 39: Radiora Integration (Radiology reporting)
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Three tables for the radiology reporting
-- workspace: radiology_orders (imaging worklist), radiology_reports (the CURRENT
-- report per order) and radiology_report_versions (an APPEND-ONLY snapshot audit).
--
-- CHMS owns the patient / consultation / order / timeline / access / billing.
-- Radiora owns the radiology reporting workspace. The radiologist remains fully
-- responsible: the system NEVER interprets images, NEVER generates findings not
-- dictated / typed by the radiologist, NEVER signs automatically, and NEVER
-- delivers an unsigned report as final. Structuring is deterministic (text only).
--
-- Signed reports are IMMUTABLE (a DB trigger blocks silent overwrite); any change
-- to a signed report must go through a versioned amendment. The versions table has
-- NO update/delete policy → an immutable audit trail. Surrogate PKs; FK COLUMNS
-- only (no composite-FK PK → no PostgREST junction ambiguity, the P0 rule).
-- Clinic-scoped RLS via get_clinic_id(); clinical-role writes via get_user_role().
-- No auth.users reads. No policy changes elsewhere.

-- ── Imaging orders (the radiology worklist) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.radiology_orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- surrogate PK (NOT composite)
  clinic_id                UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id               UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id          UUID          REFERENCES public.consultations(id),  -- optional
  ordered_by               UUID          REFERENCES public.user_profiles(id),  -- ordering doctor
  assigned_radiologist_id  UUID          REFERENCES public.user_profiles(id),  -- optional
  modality                 TEXT NOT NULL,   -- ct|mri|ultrasound|xray|mammography|...
  exam_type                TEXT NOT NULL,   -- ct_brain|mri_brain|ultrasound_abdomen|xray_chest|...
  clinical_indication      TEXT,
  priority                 TEXT NOT NULL DEFAULT 'routine',  -- routine|urgent|stat
  -- requested|scheduled|in_progress|dictated|draft|pending_review|signed|delivered|cancelled
  status                   TEXT NOT NULL DEFAULT 'requested',
  requested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at             DATE,
  completed_at             DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_orders_patient_idx ON public.radiology_orders (patient_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS radiology_orders_clinic_idx  ON public.radiology_orders (clinic_id, status);

ALTER TABLE public.radiology_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radiology_orders_select" ON public.radiology_orders;
CREATE POLICY "radiology_orders_select" ON public.radiology_orders FOR SELECT
  USING (clinic_id = public.get_clinic_id());
DROP POLICY IF EXISTS "radiology_orders_insert" ON public.radiology_orders;
CREATE POLICY "radiology_orders_insert" ON public.radiology_orders FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));
DROP POLICY IF EXISTS "radiology_orders_update" ON public.radiology_orders;
CREATE POLICY "radiology_orders_update" ON public.radiology_orders FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'nurse', 'admin', 'super_admin'));
DROP POLICY IF EXISTS "radiology_orders_delete" ON public.radiology_orders;
CREATE POLICY "radiology_orders_delete" ON public.radiology_orders FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

DROP TRIGGER IF EXISTS radiology_orders_set_updated_at ON public.radiology_orders;
CREATE TRIGGER radiology_orders_set_updated_at
  BEFORE UPDATE ON public.radiology_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── Reports (CURRENT report per order) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.radiology_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)            ON DELETE CASCADE,
  order_id         UUID NOT NULL REFERENCES public.radiology_orders(id)   ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)           ON DELETE CASCADE,
  radiologist_id   UUID          REFERENCES public.user_profiles(id),
  report_status    TEXT NOT NULL DEFAULT 'draft',   -- draft|review|signed|amended
  modality         TEXT,
  exam_type        TEXT,
  technique        TEXT,   -- radiologist-dictated / typed content only
  findings         TEXT,   -- radiologist-dictated / typed content only
  conclusion       TEXT,   -- radiologist-dictated / typed content only
  recommendations  TEXT,   -- optional, radiologist-dictated / typed content only
  signed_at        TIMESTAMPTZ,
  signature_path   TEXT,
  version          INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_reports_order_idx   ON public.radiology_reports (order_id);
CREATE INDEX IF NOT EXISTS radiology_reports_patient_idx ON public.radiology_reports (patient_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS radiology_reports_clinic_idx  ON public.radiology_reports (clinic_id, report_status);

ALTER TABLE public.radiology_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radiology_reports_select" ON public.radiology_reports;
CREATE POLICY "radiology_reports_select" ON public.radiology_reports FOR SELECT
  USING (clinic_id = public.get_clinic_id());
DROP POLICY IF EXISTS "radiology_reports_insert" ON public.radiology_reports;
CREATE POLICY "radiology_reports_insert" ON public.radiology_reports FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'admin', 'super_admin'));
DROP POLICY IF EXISTS "radiology_reports_update" ON public.radiology_reports;
CREATE POLICY "radiology_reports_update" ON public.radiology_reports FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'admin', 'super_admin'));

DROP TRIGGER IF EXISTS radiology_reports_set_updated_at ON public.radiology_reports;
CREATE TRIGGER radiology_reports_set_updated_at
  BEFORE UPDATE ON public.radiology_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Signed-report immutability: a signed report cannot be silently overwritten.
-- The ONLY way to change signed content is a versioned amendment
-- (report_status → 'amended' with an incremented version + a new snapshot).
CREATE OR REPLACE FUNCTION public.guard_radiology_report_immutability()
RETURNS trigger AS $$
BEGIN
  -- Once a report is signed (or amended), its clinical content is immutable. The
  -- ONLY permitted change is a controlled, versioned amendment: report_status set
  -- to 'amended' AND version strictly incremented. Any other content change on a
  -- signed/amended report is a silent overwrite and is rejected.
  IF OLD.report_status IN ('signed', 'amended')
     AND ( NEW.findings        IS DISTINCT FROM OLD.findings
        OR NEW.conclusion      IS DISTINCT FROM OLD.conclusion
        OR NEW.technique       IS DISTINCT FROM OLD.technique
        OR NEW.recommendations IS DISTINCT FROM OLD.recommendations )
     AND NOT ( NEW.report_status = 'amended' AND NEW.version > OLD.version ) THEN
    RAISE EXCEPTION 'Signed radiology reports are immutable; create a versioned amendment (report %).', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS radiology_reports_guard_immutability ON public.radiology_reports;
CREATE TRIGGER radiology_reports_guard_immutability
  BEFORE UPDATE ON public.radiology_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_radiology_report_immutability();

-- ── Version history (APPEND-ONLY audit — no update/delete policy) ───
CREATE TABLE IF NOT EXISTS public.radiology_report_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id)              ON DELETE CASCADE,
  report_id        UUID NOT NULL REFERENCES public.radiology_reports(id)    ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)             ON DELETE CASCADE,
  version          INT NOT NULL,
  report_status    TEXT NOT NULL,
  technique        TEXT,
  findings         TEXT,
  conclusion       TEXT,
  recommendations  TEXT,
  radiologist_id   UUID REFERENCES public.user_profiles(id),
  signed_at        TIMESTAMPTZ,
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radiology_report_versions_report_idx ON public.radiology_report_versions (report_id, version DESC);

ALTER TABLE public.radiology_report_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radiology_report_versions_select" ON public.radiology_report_versions;
CREATE POLICY "radiology_report_versions_select" ON public.radiology_report_versions FOR SELECT
  USING (clinic_id = public.get_clinic_id());
DROP POLICY IF EXISTS "radiology_report_versions_insert" ON public.radiology_report_versions;
CREATE POLICY "radiology_report_versions_insert" ON public.radiology_report_versions FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('doctor', 'admin', 'super_admin'));
-- NO update / delete policies → snapshots are an immutable audit trail.
