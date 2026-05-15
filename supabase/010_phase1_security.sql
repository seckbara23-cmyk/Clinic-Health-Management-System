-- ============================================================
-- 010 — Phase 1 security hardening
--
-- A. user_profiles UPDATE: prevent self-role/clinic escalation
-- B. queue_number auto-assignment with advisory lock
-- ============================================================

-- ── A. Fix user_profiles UPDATE policy ───────────────────────
--
-- Old policy allowed any user to UPDATE their own row with no
-- column restrictions — a user could promote their own role or
-- change their clinic_id via the API.
--
-- New approach: two separate policies.
--   1. user_profiles_update_self  — authenticated user may only
--      change full_name, phone, avatar_url on their own row.
--      role, clinic_id, is_active are frozen via WITH CHECK.
--   2. user_profiles_update_admin — clinic admins and super_admin
--      may update any column on any row within their scope.

DROP POLICY IF EXISTS "user_profiles_update" ON public.user_profiles;

-- Helper: read the current (DB) is_active for auth.uid().
-- SECURITY DEFINER bypasses RLS, preventing recursion.
CREATE OR REPLACE FUNCTION public.get_my_is_active()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT is_active FROM public.user_profiles WHERE id = auth.uid();
$$;

-- Policy 1: self-update — safe fields only
CREATE POLICY "user_profiles_update_self" ON public.user_profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- role must not change
    AND role = public.get_user_role()
    -- clinic_id must not change (IS NOT DISTINCT handles NULL)
    AND (clinic_id IS NOT DISTINCT FROM public.get_clinic_id())
    -- is_active must not change (prevents self-reactivation)
    AND is_active = public.get_my_is_active()
  );

-- Policy 2: admin/super_admin — full update scope
CREATE POLICY "user_profiles_update_admin" ON public.user_profiles
  FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() = 'admin'
    )
  );

-- ── B. queue_number auto-assignment ──────────────────────────
--
-- Assigns an incrementing queue_number per clinic per day.
-- pg_advisory_xact_lock serialises concurrent inserts for the
-- same clinic+day without a separate sequence table.
-- The lock is released automatically at transaction end.

CREATE OR REPLACE FUNCTION public.assign_queue_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day  DATE := CURRENT_DATE;
  v_next INT;
BEGIN
  -- Serialize per clinic per day to prevent duplicate numbers
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(NEW.clinic_id::text || v_day::text), 1, 16))::bit(64)::bigint
  );

  SELECT COALESCE(MAX(queue_number), 0) + 1
  INTO   v_next
  FROM   public.appointments
  WHERE  clinic_id   = NEW.clinic_id
    AND  DATE(scheduled_at) = v_day;

  NEW.queue_number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_number ON public.appointments;

CREATE TRIGGER trg_queue_number
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  WHEN (NEW.queue_number IS NULL)
  EXECUTE FUNCTION public.assign_queue_number();

-- ── Verify ───────────────────────────────────────────────────
-- Should show two policies on user_profiles for UPDATE:
SELECT policyname, cmd, qual
FROM   pg_policies
WHERE  tablename = 'user_profiles' AND cmd = 'UPDATE'
ORDER  BY policyname;
