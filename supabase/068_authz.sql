-- ════════════════════════════════════════════════════════════════
-- 068_authz.sql — Phase 40: Enterprise Authorization & Department Access Control
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Adds three NEW tables backing the Enterprise
-- Authorization framework (src/lib/authz). This migration does NOT touch any
-- existing table, policy, function, or grant — RLS remains the enforcement
-- boundary and is UNCHANGED. The authorization engine is a UI/AI least-privilege
-- layer on top of RLS; these tables persist custom grants, an authorization audit
-- trail, and (design-only) break-glass sessions.
--
--   1. authz_custom_grants — extra permission ids per user or custom role
--                            (prepares the custom-role architecture).
--   2. authz_audit         — append-only authorization audit trail
--                            (denied / sensitive-field / export / print /
--                             signature / financial-approval / break-glass).
--   3. authz_break_glass   — DESIGN-ONLY emergency-access sessions
--                            (reason required, time-boxed, audited). No
--                            production flow consumes these in v1.0.
--
-- Conventions (match the rest of the schema): surrogate UUID PK (never a
-- composite-FK PK → no PostgREST junction ambiguity), FK to public.user_profiles
-- (NOT auth.users), clinic-scoped RLS via public.get_clinic_id(), role-gated
-- writes via public.get_user_role(). Safe on a live database.

-- ── 1. authz_custom_grants — custom-role / per-user extra permissions ──
CREATE TABLE IF NOT EXISTS public.authz_custom_grants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES public.clinics(id)       ON DELETE CASCADE,
  -- Target: a specific user, OR a named custom role template (user_id NULL).
  user_id      UUID          REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role_key     TEXT,                                   -- custom-role name when user_id IS NULL
  permission   TEXT NOT NULL,                          -- '<module>.<action>' or 'field.<name>'
  granted_by   UUID          REFERENCES public.user_profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT authz_custom_grants_target_ck CHECK (user_id IS NOT NULL OR role_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS authz_custom_grants_clinic_idx ON public.authz_custom_grants (clinic_id);
CREATE INDEX IF NOT EXISTS authz_custom_grants_user_idx   ON public.authz_custom_grants (user_id);

ALTER TABLE public.authz_custom_grants ENABLE ROW LEVEL SECURITY;

-- Read: admins within their own clinic (and the user may read their own grants).
DROP POLICY IF EXISTS "authz_custom_grants_select" ON public.authz_custom_grants;
CREATE POLICY "authz_custom_grants_select" ON public.authz_custom_grants FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (public.get_user_role() IN ('admin', 'super_admin') OR user_id = auth.uid())
  );

-- Write: clinic/platform admins only, within their own clinic.
DROP POLICY IF EXISTS "authz_custom_grants_insert" ON public.authz_custom_grants;
CREATE POLICY "authz_custom_grants_insert" ON public.authz_custom_grants FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "authz_custom_grants_update" ON public.authz_custom_grants;
CREATE POLICY "authz_custom_grants_update" ON public.authz_custom_grants FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "authz_custom_grants_delete" ON public.authz_custom_grants;
CREATE POLICY "authz_custom_grants_delete" ON public.authz_custom_grants FOR DELETE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

-- ── 2. authz_audit — append-only authorization audit trail ──────────
CREATE TABLE IF NOT EXISTS public.authz_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES public.clinics(id)       ON DELETE CASCADE,
  user_id      UUID          REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  audit_type   TEXT NOT NULL CHECK (audit_type IN (
                 'access_denied','sensitive_field_access','export','print',
                 'signature','financial_approval','break_glass')),
  permission   TEXT,
  decision     TEXT NOT NULL DEFAULT 'deny' CHECK (decision IN ('allow','deny')),
  sensitive    BOOLEAN NOT NULL DEFAULT TRUE,
  entity_type  TEXT,
  entity_id    UUID,
  reason       TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authz_audit_clinic_idx ON public.authz_audit (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS authz_audit_type_idx   ON public.authz_audit (audit_type);
CREATE INDEX IF NOT EXISTS authz_audit_user_idx   ON public.authz_audit (user_id);

ALTER TABLE public.authz_audit ENABLE ROW LEVEL SECURITY;

-- Read: clinic admins within their own clinic only (metadata may reference PII).
-- Deliberately NOT super_admin — mirrors audit_events.
DROP POLICY IF EXISTS "authz_audit_select" ON public.authz_audit;
CREATE POLICY "authz_audit_select" ON public.authz_audit FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin');

-- Write: any authenticated member may append their OWN events for their OWN clinic.
-- APPEND-ONLY — there is intentionally no UPDATE or DELETE policy (immutable trail).
DROP POLICY IF EXISTS "authz_audit_insert" ON public.authz_audit;
CREATE POLICY "authz_audit_insert" ON public.authz_audit FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND user_id = auth.uid());

-- ── 3. authz_break_glass — DESIGN-ONLY emergency-access sessions ────
-- Future-ready record of temporary elevated access. In v1.0 NOTHING grants access
-- from these rows; they exist so break-glass can be enabled later WITH a mandatory
-- reason, an enforced expiry, and a full audit trail. NOT auto-consumed anywhere.
CREATE TABLE IF NOT EXISTS public.authz_break_glass (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES public.clinics(id)       ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL CHECK (btrim(reason) <> ''),        -- reason REQUIRED
  grants       TEXT[] NOT NULL DEFAULT '{}',
  expires_at   TIMESTAMPTZ NOT NULL,                             -- time-boxed
  created_by   UUID          REFERENCES public.user_profiles(id),
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authz_break_glass_clinic_idx ON public.authz_break_glass (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS authz_break_glass_user_idx   ON public.authz_break_glass (user_id);

ALTER TABLE public.authz_break_glass ENABLE ROW LEVEL SECURITY;

-- Read/write: clinic admins within their own clinic only.
DROP POLICY IF EXISTS "authz_break_glass_select" ON public.authz_break_glass;
CREATE POLICY "authz_break_glass_select" ON public.authz_break_glass FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "authz_break_glass_insert" ON public.authz_break_glass;
CREATE POLICY "authz_break_glass_insert" ON public.authz_break_glass FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "authz_break_glass_update" ON public.authz_break_glass;
CREATE POLICY "authz_break_glass_update" ON public.authz_break_glass FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin', 'super_admin'));

-- ════════════════════════════════════════════════════════════════
-- End 068_authz.sql — additive; no existing object modified.
-- ════════════════════════════════════════════════════════════════
