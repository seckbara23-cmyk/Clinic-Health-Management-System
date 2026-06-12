-- ════════════════════════════════════════════════════════════════
-- 026 — Compliance & Medical Record Protection (Phase 3, additive)
-- ════════════════════════════════════════════════════════════════
--
-- This migration is ADDITIVE and NON-BREAKING. It adds:
--   A. Soft-delete columns (deleted_at / deleted_by / deletion_reason)
--   B. Patient consent columns
--   C. audit_events  — clinic-scoped, immutable audit trail
--   D. log_record_view() RPC      — detail-view logging
--   E. soft_delete_record() / restore_record() RPCs (admin-only, cascade)
--   F. Audit triggers (updated / soft_deleted / restored)
--   G. get_platform_billing_summary() — aggregate-only super-admin oversight
--
-- The breaking RLS changes (remove super_admin from medical/billing tables,
-- hide soft-deleted rows, block hard deletes) live in 027 and must be applied
-- AFTER the app no longer relies on the old behavior.
--
-- Senegal runs on UTC+0 (Africa/Dakar, no DST). admin_audit_log (019) is left
-- untouched — it remains the platform/super-admin forensic log; audit_events
-- is the new clinic-scoped clinical/billing log.

-- ── A. Soft-delete columns ────────────────────────────────────────
-- Added to every in-scope medical/billing table plus the child tables that
-- cascade from a patient (so nothing is left orphan-visible after a delete).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','appointments','consultations','prescriptions','invoices',
    'lab_requests','consultation_vitals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deleted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS deletion_reason TEXT', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (clinic_id) WHERE deleted_at IS NULL',
      t || '_not_deleted', t);
  END LOOP;
END $$;

-- ── B. Patient consent (CDP Law 2008-12) ──────────────────────────
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS consent_given       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_date        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_method      TEXT CHECK (consent_method IN ('verbal','written','electronic')),
  ADD COLUMN IF NOT EXISTS consent_notes       TEXT,
  ADD COLUMN IF NOT EXISTS consent_recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── C. audit_events — clinic-scoped immutable trail ──────────────
CREATE TABLE IF NOT EXISTS public.audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = system / service-role
  entity_type TEXT NOT NULL,  -- patient | appointment | consultation | prescription | invoice | export
  entity_id   UUID,
  action      TEXT NOT NULL CHECK (action IN ('viewed','updated','soft_deleted','restored','exported')),
  metadata    JSONB NOT NULL DEFAULT '{}',   -- includes ip_address / user_agent where available
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_clinic_idx ON public.audit_events (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON public.audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_events_user_idx   ON public.audit_events (user_id);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Readable by clinic ADMINS within their own clinic only. NOT super_admin
-- (metadata may contain PII). Writes happen only via the SECURITY DEFINER
-- functions below, so there is intentionally no INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS "audit_events_select" ON public.audit_events;
CREATE POLICY "audit_events_select" ON public.audit_events FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin');

-- ── D. log_record_view — detail-view logging ─────────────────────
-- Called by the /api/audit/view route using the caller's session, so auth.uid()
-- and get_clinic_id() resolve to the real user/clinic. ip / ua are passed from
-- the request headers (not available inside the DB otherwise).
CREATE OR REPLACE FUNCTION public.log_record_view(
  p_entity TEXT,
  p_id     UUID,
  p_ip     TEXT DEFAULT NULL,
  p_ua     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_clinic UUID;
BEGIN
  v_clinic := public.get_clinic_id();
  IF v_clinic IS NULL THEN RETURN; END IF;  -- no clinic context (e.g. super_admin): skip
  IF p_entity NOT IN ('patient','appointment','consultation','prescription','invoice') THEN
    RAISE EXCEPTION 'Invalid entity_type: %', p_entity USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_events (clinic_id, user_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_clinic, auth.uid(), p_entity, p_id, 'viewed',
    jsonb_strip_nulls(jsonb_build_object('ip_address', p_ip, 'user_agent', p_ua))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_record_view(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_record_view(TEXT, UUID, TEXT, TEXT) TO authenticated;

-- ── F. Audit trigger (declared before E so the RPCs' UPDATEs are logged) ──
-- TG_ARGV[0] = entity_type label; TG_ARGV[1] = 'true' to log generic updates.
-- ip / ua are read from transaction-local GUCs set by the soft-delete RPCs.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_meta   JSONB;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_action := 'soft_deleted';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    v_action := 'restored';
  ELSE
    v_action := 'updated';
    IF COALESCE(TG_ARGV[1], 'false') <> 'true' THEN
      RETURN NEW;  -- this table does not log generic updates (e.g. appointments)
    END IF;
  END IF;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'ip_address', NULLIF(current_setting('app.audit_ip', true), ''),
    'user_agent', NULLIF(current_setting('app.audit_ua', true), '')
  ));

  INSERT INTO public.audit_events (clinic_id, user_id, entity_type, entity_id, action, metadata)
  VALUES (NEW.clinic_id, auth.uid(), TG_ARGV[0], NEW.id, v_action, v_meta);
  RETURN NEW;
END;
$$;

-- Generic-update logging ON for the four required tables, OFF for the rest
-- (appointments / lab_requests / vitals only log soft_deleted & restored).
DROP TRIGGER IF EXISTS audit_patients      ON public.patients;
DROP TRIGGER IF EXISTS audit_consultations ON public.consultations;
DROP TRIGGER IF EXISTS audit_prescriptions ON public.prescriptions;
DROP TRIGGER IF EXISTS audit_invoices      ON public.invoices;
DROP TRIGGER IF EXISTS audit_appointments  ON public.appointments;
DROP TRIGGER IF EXISTS audit_lab_requests  ON public.lab_requests;
DROP TRIGGER IF EXISTS audit_vitals        ON public.consultation_vitals;

CREATE TRIGGER audit_patients      AFTER UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('patient', 'true');
CREATE TRIGGER audit_consultations AFTER UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('consultation', 'true');
CREATE TRIGGER audit_prescriptions AFTER UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('prescription', 'true');
CREATE TRIGGER audit_invoices      AFTER UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('invoice', 'true');
CREATE TRIGGER audit_appointments  AFTER UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('appointment', 'false');
CREATE TRIGGER audit_lab_requests  AFTER UPDATE ON public.lab_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('lab_request', 'false');
CREATE TRIGGER audit_vitals        AFTER UPDATE ON public.consultation_vitals
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('consultation_vital', 'false');

-- ── E. soft_delete_record / restore_record (admin-only, clinic-scoped) ──
-- All deletions are soft and reversible. Deleting a patient cascades a soft
-- delete to their child records (tagged so a later restore can reverse exactly
-- that cascade). The audit triggers above record every affected row.
CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_entity TEXT,
  p_id     UUID,
  p_reason TEXT DEFAULT NULL,
  p_ip     TEXT DEFAULT NULL,
  p_ua     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic UUID := public.get_clinic_id();
  v_tag    TEXT := 'cascade:patient:' || p_id;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only clinic admins may delete records' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.audit_ip', COALESCE(p_ip, ''), true);
  PERFORM set_config('app.audit_ua', COALESCE(p_ua, ''), true);

  IF p_entity = 'patient' THEN
    UPDATE public.patients SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    -- Cascade soft-delete to all child records.
    UPDATE public.appointments       SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.consultations      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.prescriptions      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.invoices           SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_requests       SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.consultation_vitals SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'appointment' THEN
    UPDATE public.appointments  SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'consultation' THEN
    UPDATE public.consultations SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'prescription' THEN
    UPDATE public.prescriptions SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'invoice' THEN
    UPDATE public.invoices      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Invalid entity: %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_record(
  p_entity TEXT,
  p_id     UUID,
  p_ip     TEXT DEFAULT NULL,
  p_ua     TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic UUID := public.get_clinic_id();
  v_tag    TEXT := 'cascade:patient:' || p_id;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only clinic admins may restore records' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.audit_ip', COALESCE(p_ip, ''), true);
  PERFORM set_config('app.audit_ua', COALESCE(p_ua, ''), true);

  IF p_entity = 'patient' THEN
    UPDATE public.patients SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
    -- Restore exactly the children that were cascaded by this patient's delete.
    UPDATE public.appointments        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.consultations       SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.prescriptions       SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.invoices            SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_requests        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.consultation_vitals SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
  ELSIF p_entity = 'appointment' THEN
    UPDATE public.appointments  SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSIF p_entity = 'consultation' THEN
    UPDATE public.consultations SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSIF p_entity = 'prescription' THEN
    UPDATE public.prescriptions SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSIF p_entity = 'invoice' THEN
    UPDATE public.invoices      SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'Invalid entity: %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.soft_delete_record(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.soft_delete_record(TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_record(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_record(TEXT, UUID, TEXT, TEXT) TO authenticated;

-- ── G. Aggregate-only super-admin billing oversight ──────────────
-- Replaces the admin/billing page's direct invoice read. Returns per-clinic
-- AGGREGATES only — no patient names, no invoice rows, no PII. Excludes
-- soft-deleted invoices.
CREATE OR REPLACE FUNCTION public.get_platform_billing_summary()
RETURNS TABLE (
  clinic_id       UUID,
  clinic_name     TEXT,
  invoice_count   BIGINT,
  total_invoiced  NUMERIC,
  total_collected NUMERIC,
  pending_count   BIGINT,
  online_count    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'super_admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.name,
           COUNT(i.id),
           COALESCE(SUM(i.total_amount), 0),
           COALESCE(SUM(i.amount_paid), 0),
           COUNT(i.id) FILTER (WHERE i.status IN ('draft','sent','partial','overdue')),
           COUNT(i.id) FILTER (WHERE i.payment_method IN ('wave','orange_money'))
    FROM public.clinics c
    LEFT JOIN public.invoices i
      ON i.clinic_id = c.id AND i.deleted_at IS NULL
    GROUP BY c.id, c.name
    ORDER BY c.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_billing_summary() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_billing_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
