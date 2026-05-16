-- ============================================================
-- 018 — Security hardening
--
-- Addresses Supabase Security Advisor warnings across three areas:
--
-- A. SET search_path = public on all functions that were missing
--    it. Without a fixed search_path a schema-injection attack
--    could shadow public tables with a rogue schema.
--    Affected: get_clinic_id, is_super_admin, get_user_role,
--              update_updated_at, generate_patient_number,
--              generate_invoice_number.
--
-- B. Tighten EXECUTE grants. PostgreSQL grants EXECUTE to PUBLIC
--    by default. We revoke that and selectively re-grant:
--      - RLS helpers → authenticated role only
--      - Auth trigger (handle_new_user) → no direct EXECUTE
--        (triggers fire via system, not user invocation)
--      - All other trigger functions → no direct EXECUTE
--
-- C. Fix clinic_requests INSERT policy (WITH CHECK (true)).
--    The /api/signup route uses the SERVICE ROLE which bypasses
--    RLS entirely, so changing to WITH CHECK (false) blocks direct
--    anon/authenticated inserts without breaking the API route.
-- ============================================================

-- ── A. Harden RLS helper functions ──────────────────────────

CREATE OR REPLACE FUNCTION public.get_clinic_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- ── A. Harden trigger functions (search_path only, not SECURITY DEFINER) ──

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_patient_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count  INT;
  v_prefix TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM   public.patients
  WHERE  clinic_id = NEW.clinic_id;

  v_prefix          := 'PAT-' || TO_CHAR(NOW(), 'YYYY');
  NEW.patient_number := v_prefix || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM   public.invoices
  WHERE  clinic_id = NEW.clinic_id;

  NEW.invoice_number := 'INV-'
    || TO_CHAR(NOW(), 'YYYYMM')
    || '-'
    || LPAD((v_count + 1)::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

-- ── B. Tighten EXECUTE permissions ──────────────────────────

-- 1. RLS helper functions: revoke from PUBLIC, grant to authenticated only.
--    PostgREST evaluates RLS policies as the authenticated role.
--    The anon role must NOT be able to invoke these.

REVOKE EXECUTE ON FUNCTION public.get_clinic_id()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_role()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_is_active() FROM PUBLIC;

GRANT  EXECUTE ON FUNCTION public.get_clinic_id()    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_super_admin()   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_user_role()    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_my_is_active() TO authenticated;

-- 2. Auth trigger: revoke all direct EXECUTE.
--    PostgreSQL fires trigger functions internally without checking
--    the caller's EXECUTE privilege — triggers work regardless.
--    Revoking from PUBLIC removes the default grant that would
--    allow anyone to call handle_new_user() directly.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- 3. Internal-only trigger functions: revoke public EXECUTE.
--    These are never called directly; only by triggers.

REVOKE EXECUTE ON FUNCTION public.update_updated_at()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_patient_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_queue_number()     FROM PUBLIC;

-- ── C. Fix overly-permissive INSERT policy on clinic_requests ──
--
-- Old: WITH CHECK (true) — any anon/authenticated user could INSERT
--      directly via the Supabase client, bypassing our API route.
-- New: WITH CHECK (false) — no RLS-enforced role may INSERT.
--      The /api/signup route uses SERVICE ROLE which bypasses RLS,
--      so it continues to work exactly as before.
--      super_admin can still insert via the service-role API route.

DROP POLICY IF EXISTS "clinic_requests_insert" ON public.clinic_requests;

CREATE POLICY "clinic_requests_insert" ON public.clinic_requests
  FOR INSERT WITH CHECK (false);

-- ── Reload PostgREST schema cache ───────────────────────────
NOTIFY pgrst, 'reload schema';
