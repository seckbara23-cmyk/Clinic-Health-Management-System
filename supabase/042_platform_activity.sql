-- ════════════════════════════════════════════════════════════════
-- 042_platform_activity.sql — Phase 15.0: Super Admin Platform Activity Center
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Adds AGGREGATE-ONLY, SECURITY DEFINER RPCs
-- for platform operations oversight — the exact precedent already established
-- by get_platform_billing_summary() (migration 026). Safe on a live database.
--
-- CORE PRINCIPLE (unchanged from 026/027): super_admin manages the PLATFORM;
-- clinics own the MEDICAL DATA. Every function here:
--   • is gated by `IF NOT public.is_super_admin() THEN RAISE EXCEPTION`
--   • returns COUNTS / AGGREGATES ONLY — never a patient name, diagnosis,
--     prescription, lab value, SMS body/phone, or AI message content
--   • excludes soft-deleted rows (deleted_at IS NULL) exactly like 026
--   • touches NO existing table, column, RLS policy, or trigger
--
-- This migration does NOT weaken the 027 lockout: super_admin still cannot
-- SELECT patients/appointments/consultations/prescriptions/invoices/lab_orders/
-- medication_dispensings/sms_messages/ai_conversations/ai_messages directly.
-- These functions are the ONLY sanctioned window, and only ever return sums.
--
--   A. get_platform_overview()                       — platform-wide snapshot (JSONB)
--   B. get_clinic_activity_summary(from, to)          — per-clinic operational counts
--   C. get_platform_sms_summary(from, to)             — per-clinic SMS status counts
--   D. get_platform_ai_summary(from, to)              — per-clinic AI usage counts

-- ── A. Platform overview snapshot ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_platform_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'super_admin only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'clinics_total',      (SELECT count(*) FROM public.clinics),
    'clinics_by_status',  (SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
                              FROM (SELECT status, count(*) cnt FROM public.clinics GROUP BY status) s),
    'clinics_by_plan',    (SELECT coalesce(jsonb_object_agg(subscription_plan, cnt), '{}'::jsonb)
                              FROM (SELECT subscription_plan, count(*) cnt FROM public.clinics GROUP BY subscription_plan) s),
    'clinics_new_7d',      (SELECT count(*) FROM public.clinics WHERE created_at >= NOW() - INTERVAL '7 days'),
    'clinics_new_30d',     (SELECT count(*) FROM public.clinics WHERE created_at >= NOW() - INTERVAL '30 days'),
    'users_total',         (SELECT count(*) FROM public.user_profiles WHERE role <> 'super_admin'),
    'users_active',        (SELECT count(*) FROM public.user_profiles WHERE role <> 'super_admin' AND is_active = true),
    'users_by_role',       (SELECT coalesce(jsonb_object_agg(role, cnt), '{}'::jsonb)
                              FROM (SELECT role, count(*) cnt FROM public.user_profiles WHERE role <> 'super_admin' GROUP BY role) s)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_overview() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_overview() TO authenticated;

-- ── B. Per-clinic operational activity (counts only, date-windowed) ──
CREATE OR REPLACE FUNCTION public.get_clinic_activity_summary(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  clinic_id           UUID,
  clinic_name         TEXT,
  subscription_plan   TEXT,
  subscription_status TEXT,
  clinic_status       TEXT,
  user_count          BIGINT,
  active_user_count   BIGINT,
  appointments_count  BIGINT,
  consultations_count BIGINT,
  invoices_count      BIGINT,
  lab_orders_count    BIGINT,
  dispensing_count    BIGINT,
  last_activity_at    TIMESTAMPTZ
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
    SELECT
      c.id, c.name, c.subscription_plan::text, c.subscription_status::text, c.status::text,
      (SELECT count(*) FROM public.user_profiles up WHERE up.clinic_id = c.id),
      (SELECT count(*) FROM public.user_profiles up WHERE up.clinic_id = c.id AND up.is_active),
      (SELECT count(*) FROM public.appointments a  WHERE a.clinic_id = c.id AND a.deleted_at IS NULL AND a.created_at BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.consultations k WHERE k.clinic_id = c.id AND k.deleted_at IS NULL AND k.created_at BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.invoices i       WHERE i.clinic_id = c.id AND i.deleted_at IS NULL AND i.created_at BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.lab_orders l     WHERE l.clinic_id = c.id AND l.deleted_at IS NULL AND l.created_at BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.medication_dispensings d WHERE d.clinic_id = c.id AND d.deleted_at IS NULL AND d.created_at BETWEEN p_from AND p_to),
      GREATEST(
        (SELECT max(a.created_at) FROM public.appointments a  WHERE a.clinic_id = c.id AND a.deleted_at IS NULL),
        (SELECT max(k.created_at) FROM public.consultations k WHERE k.clinic_id = c.id AND k.deleted_at IS NULL),
        (SELECT max(i.created_at) FROM public.invoices i       WHERE i.clinic_id = c.id AND i.deleted_at IS NULL),
        (SELECT max(l.created_at) FROM public.lab_orders l     WHERE l.clinic_id = c.id AND l.deleted_at IS NULL),
        (SELECT max(d.created_at) FROM public.medication_dispensings d WHERE d.clinic_id = c.id AND d.deleted_at IS NULL)
      )
    FROM public.clinics c
    ORDER BY c.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_clinic_activity_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_clinic_activity_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ── C. Platform SMS queue summary (status counts only — no phone/body) ──
CREATE OR REPLACE FUNCTION public.get_platform_sms_summary(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  clinic_id   UUID,
  clinic_name TEXT,
  queued      BIGINT,
  sending     BIGINT,
  sent        BIGINT,
  delivered   BIGINT,
  failed      BIGINT,
  cancelled   BIGINT,
  skipped     BIGINT,
  total       BIGINT
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
    SELECT
      c.id, c.name,
      COUNT(*) FILTER (WHERE m.status = 'queued'),
      COUNT(*) FILTER (WHERE m.status = 'sending'),
      COUNT(*) FILTER (WHERE m.status = 'sent'),
      COUNT(*) FILTER (WHERE m.status = 'delivered'),
      COUNT(*) FILTER (WHERE m.status = 'failed'),
      COUNT(*) FILTER (WHERE m.status = 'cancelled'),
      COUNT(*) FILTER (WHERE m.status = 'skipped'),
      COUNT(m.id)
    FROM public.clinics c
    LEFT JOIN public.sms_messages m ON m.clinic_id = c.id AND m.created_at BETWEEN p_from AND p_to
    GROUP BY c.id, c.name
    ORDER BY c.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_sms_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_sms_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ── D. Platform AI usage summary (interaction counts only — no content) ──
CREATE OR REPLACE FUNCTION public.get_platform_ai_summary(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  clinic_id          UUID,
  clinic_name        TEXT,
  conversation_count BIGINT,
  message_count      BIGINT
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
    SELECT
      c.id, c.name,
      (SELECT count(*) FROM public.ai_conversations v WHERE v.clinic_id = c.id AND v.deleted_at IS NULL AND v.created_at BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.ai_messages msg     WHERE msg.clinic_id = c.id AND msg.deleted_at IS NULL AND msg.created_at BETWEEN p_from AND p_to)
    FROM public.clinics c
    ORDER BY c.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_ai_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_ai_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
