-- ============================================================
-- 019 — Production Hardening Phase 1
--
-- A. Fix role escalation in handle_new_user trigger.
--    raw_user_meta_data is caller-supplied (set by the browser in
--    supabase.auth.signUp). Any user could pass role:'super_admin'
--    in metadata and the old trigger would honour it.
--    Fix: always default to 'receptionist'. Trusted server-side
--    flows (create-clinic, approve-clinic-request) use the
--    service-role client to upsert the correct role immediately
--    after auth.users creation — the trigger default is
--    overwritten server-side and never reaches the client.
--
-- B. Create admin_audit_log table.
--    Immutable, append-only audit trail for privileged actions.
--    INSERT: service-role client only (bypasses RLS).
--    SELECT: super_admin only.
--    UPDATE / DELETE: denied for all roles (explicit policies).
-- ============================================================

-- ── A. Fix handle_new_user — remove caller-supplied role ─────
--
-- SECURITY: do not read raw_user_meta_data->>'role'.
-- Any authenticated or anonymous caller can set this field via
-- supabase.auth.signUp({ options: { data: { role: '...' } } }).
-- The only safe default is the lowest-privilege role.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'receptionist'  -- never trust raw_user_meta_data->>'role'; role is set by trusted server-side flows
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── B. Admin audit log ────────────────────────────────────────
--
-- Stores one row per privileged super-admin action.
-- actor_id is nullable so the record is preserved if a
-- super_admin account is later deleted. The actor's email is
-- always written into metadata for forensic continuity.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- action  examples: 'clinic.create', 'clinic.suspend',
  --                   'clinic_request.approve', 'user.password_reset'
  action      TEXT        NOT NULL,
  target_type TEXT        NOT NULL,   -- 'clinic' | 'user' | 'clinic_request'
  target_id   UUID,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Super admins have read-only access (forensic queries)
CREATE POLICY "audit_log_select"
  ON public.admin_audit_log
  FOR SELECT
  USING (public.is_super_admin());

-- Direct INSERT via anon/authenticated roles is blocked.
-- API routes use the service-role client which bypasses RLS.
CREATE POLICY "audit_log_insert_deny"
  ON public.admin_audit_log
  FOR INSERT
  WITH CHECK (false);

-- Audit records are immutable — no updates or deletes
CREATE POLICY "audit_log_update_deny"
  ON public.admin_audit_log
  FOR UPDATE
  USING (false);

CREATE POLICY "audit_log_delete_deny"
  ON public.admin_audit_log
  FOR DELETE
  USING (false);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx   ON public.admin_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx  ON public.admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);

NOTIFY pgrst, 'reload schema';
