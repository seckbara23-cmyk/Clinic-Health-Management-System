-- ════════════════════════════════════════════════════════════════
-- 043_reliability_events.sql — Phase 15.0B: Platform Reliability & Bug Monitoring
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Safe on a live database.
--
-- Captures OPERATIONAL failures (crashes, failed API calls, failed jobs, SMS/AI
-- failures, PostgREST/storage errors) so super_admin can monitor platform
-- reliability across tenants — WITHOUT ever seeing clinical data.
--
-- PRIVACY BY DESIGN:
--   • Rows hold only an error's TYPE, LOCATION (sanitized route), a
--     PII-sanitized message, a stack HASH (never the stack), counts and
--     timestamps. The write path (api/reliability/report) never captures
--     request/response bodies, form values, or DB rows.
--   • Writes happen ONLY via the service-role server route (no client INSERT
--     policy) — mirrors admin_audit_log (019). `clinic_id` is derived from the
--     caller's session server-side, so a tenant can never forge another
--     tenant's events.
--   • RLS: super_admin sees all (platform ops); a clinic ADMIN sees ONLY their
--     own clinic's events; everyone else sees nothing.
--
--   A. reliability_events table + RLS
--   B. resolve_reliability_event(id)          — super_admin-gated resolve
--   C. get_platform_reliability_overview(f,t)  — platform snapshot (JSONB)
--   D. get_tenant_health_inputs(f,t)           — per-clinic failure counts
--   E. get_platform_incidents(f,t,open_only)   — incident list w/ clinic name

-- ── A. Event store ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reliability_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: platform-level errors (cron/deploy) have no clinic.
  clinic_id        UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  fingerprint      TEXT NOT NULL,                 -- dedup/grouping hash
  module           TEXT,
  route            TEXT,                           -- sanitized (no ids/query)
  error_type       TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'error',  -- info|warning|error|critical
  message          TEXT,                           -- PII-sanitized, truncated
  stack_hash       TEXT,                           -- hash only, never the stack
  affected_role    TEXT,
  client_info      TEXT,                           -- coarse browser/OS family
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved         BOOLEAN NOT NULL DEFAULT false,
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One open fingerprint per clinic (dedup). NULL clinic rows dedup in the route.
  CONSTRAINT reliability_events_clinic_fingerprint_key UNIQUE (clinic_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS reliability_events_clinic_idx     ON public.reliability_events (clinic_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS reliability_events_severity_idx   ON public.reliability_events (severity, last_seen DESC);
CREATE INDEX IF NOT EXISTS reliability_events_open_idx       ON public.reliability_events (last_seen DESC) WHERE resolved = false;

ALTER TABLE public.reliability_events ENABLE ROW LEVEL SECURITY;

-- Read: super_admin sees all; a clinic ADMIN sees only their own clinic.
DROP POLICY IF EXISTS "reliability_events_select" ON public.reliability_events;
CREATE POLICY "reliability_events_select" ON public.reliability_events FOR SELECT
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'))
  );

-- Writes: NEVER from the client. Only the service-role server route inserts,
-- and resolve happens via the SECURITY DEFINER function below.
DROP POLICY IF EXISTS "reliability_events_insert" ON public.reliability_events;
CREATE POLICY "reliability_events_insert" ON public.reliability_events FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "reliability_events_update" ON public.reliability_events;
CREATE POLICY "reliability_events_update" ON public.reliability_events FOR UPDATE USING (false);
DROP POLICY IF EXISTS "reliability_events_delete" ON public.reliability_events;
CREATE POLICY "reliability_events_delete" ON public.reliability_events FOR DELETE USING (false);

-- ── B. Resolve an incident (super_admin only) ──────────────────────
CREATE OR REPLACE FUNCTION public.resolve_reliability_event(p_id UUID, p_resolved BOOLEAN DEFAULT true)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'super_admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.reliability_events
     SET resolved    = p_resolved,
         resolved_at = CASE WHEN p_resolved THEN NOW() ELSE NULL END,
         resolved_by = CASE WHEN p_resolved THEN auth.uid() ELSE NULL END
   WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_reliability_event(UUID, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_reliability_event(UUID, BOOLEAN) TO authenticated;

-- ── C. Platform reliability overview (aggregate snapshot) ──────────
CREATE OR REPLACE FUNCTION public.get_platform_reliability_overview(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'super_admin only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'event_count',        (SELECT coalesce(sum(occurrence_count), 0) FROM public.reliability_events WHERE last_seen BETWEEN p_from AND p_to),
    'distinct_count',     (SELECT count(*) FROM public.reliability_events WHERE last_seen BETWEEN p_from AND p_to),
    'open_count',         (SELECT count(*) FROM public.reliability_events WHERE resolved = false AND last_seen BETWEEN p_from AND p_to),
    'critical_open',      (SELECT count(*) FROM public.reliability_events WHERE resolved = false AND severity = 'critical' AND last_seen BETWEEN p_from AND p_to),
    'affected_clinics',   (SELECT count(DISTINCT clinic_id) FROM public.reliability_events WHERE clinic_id IS NOT NULL AND last_seen BETWEEN p_from AND p_to),
    'by_severity',        (SELECT coalesce(jsonb_object_agg(severity, cnt), '{}'::jsonb) FROM (SELECT severity, count(*) cnt FROM public.reliability_events WHERE last_seen BETWEEN p_from AND p_to GROUP BY severity) s),
    'by_module',          (SELECT coalesce(jsonb_object_agg(coalesce(module, 'unknown'), cnt), '{}'::jsonb) FROM (SELECT module, count(*) cnt FROM public.reliability_events WHERE last_seen BETWEEN p_from AND p_to GROUP BY module) s),
    'by_type',            (SELECT coalesce(jsonb_object_agg(error_type, cnt), '{}'::jsonb) FROM (SELECT error_type, count(*) cnt FROM public.reliability_events WHERE last_seen BETWEEN p_from AND p_to GROUP BY error_type) s)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_platform_reliability_overview(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_reliability_overview(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ── D. Per-clinic health inputs (failure counts — NO clinical data) ─
CREATE OR REPLACE FUNCTION public.get_tenant_health_inputs(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  clinic_id           UUID,
  clinic_name         TEXT,
  clinic_status       TEXT,
  critical_count      BIGINT,
  error_count         BIGINT,
  warning_count       BIGINT,
  event_count         BIGINT,
  sms_failed_count    BIGINT,
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
      c.id, c.name, c.status::text,
      (SELECT count(*) FROM public.reliability_events e WHERE e.clinic_id = c.id AND e.resolved = false AND e.severity = 'critical' AND e.last_seen BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.reliability_events e WHERE e.clinic_id = c.id AND e.resolved = false AND e.severity = 'error'    AND e.last_seen BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.reliability_events e WHERE e.clinic_id = c.id AND e.resolved = false AND e.severity = 'warning'  AND e.last_seen BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.reliability_events e WHERE e.clinic_id = c.id AND e.last_seen BETWEEN p_from AND p_to),
      (SELECT count(*) FROM public.sms_messages m       WHERE m.clinic_id = c.id AND m.status = 'failed' AND m.created_at BETWEEN p_from AND p_to),
      (SELECT max(e.last_seen) FROM public.reliability_events e WHERE e.clinic_id = c.id)
    FROM public.clinics c
    ORDER BY c.name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_tenant_health_inputs(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_tenant_health_inputs(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ── E. Incident list (with clinic name; sanitized fields only) ─────
CREATE OR REPLACE FUNCTION public.get_platform_incidents(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_open_only BOOLEAN DEFAULT true)
RETURNS TABLE (
  id               UUID,
  clinic_id        UUID,
  clinic_name      TEXT,
  module           TEXT,
  route            TEXT,
  error_type       TEXT,
  severity         TEXT,
  message          TEXT,
  affected_role    TEXT,
  client_info      TEXT,
  occurrence_count INTEGER,
  first_seen       TIMESTAMPTZ,
  last_seen        TIMESTAMPTZ,
  resolved         BOOLEAN
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
      e.id, e.clinic_id, c.name, e.module, e.route, e.error_type, e.severity,
      e.message, e.affected_role, e.client_info, e.occurrence_count,
      e.first_seen, e.last_seen, e.resolved
    FROM public.reliability_events e
    LEFT JOIN public.clinics c ON c.id = e.clinic_id
    WHERE e.last_seen BETWEEN p_from AND p_to
      AND (NOT p_open_only OR e.resolved = false)
    ORDER BY
      e.resolved ASC,
      CASE e.severity WHEN 'critical' THEN 0 WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END ASC,
      e.last_seen DESC
    LIMIT 200;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_platform_incidents(TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_platform_incidents(TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO authenticated;
