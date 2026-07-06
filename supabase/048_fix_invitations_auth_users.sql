-- ════════════════════════════════════════════════════════════════
-- 048_fix_invitations_auth_users.sql — P0 fix: invite "permission denied for table users"
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE. Replaces ONLY the two clinic_invitations policies that read
-- auth.users directly. No table, no data, no other policy is touched. Safe on a
-- live database; idempotent (DROP IF EXISTS + CREATE).
--
-- ROOT CAUSE (production bug): the invitations_select (002_rls.sql) and
-- invitations_update (022_rls_with_check.sql) policies contained
--   OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
-- Because auth.uid() is STABLE, that uncorrelated scalar subquery is hoisted to
-- an InitPlan and evaluated ONCE per statement — regardless of the OR short-
-- circuit on the earlier super_admin / clinic-admin branches. The `authenticated`
-- role has no SELECT grant on auth.users, so evaluating these policies raised
-- `ERROR: permission denied for table users` (auth.users). Inviting a user runs
-- `.insert(...).select()` (INSERT ... RETURNING), which forces the SELECT policy
-- to evaluate on the returned row → the error surfaced on invite. Any invitation
-- read/accept was affected too.
--
-- FIX: source the caller's email from the verified JWT claim
-- (auth.jwt() ->> 'email') instead of auth.users. Same predicate, no table
-- access, no permission dependency.
--
-- NO RLS WEAKENING: the super_admin and clinic-admin branches and every clinic_id
-- scoping are unchanged — only the "invited user matches their own email" branch
-- changes its SOURCE (auth.users → verified JWT claim). Access is logically
-- identical and does not widen. The INSERT and DELETE policies are untouched
-- (they never referenced auth.users).

-- ── SELECT: admins see their clinic's invites; the invited user sees their own ──
DROP POLICY IF EXISTS "invitations_select" ON public.clinic_invitations;
CREATE POLICY "invitations_select" ON public.clinic_invitations FOR SELECT
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
    OR email = (auth.jwt() ->> 'email')
  );

-- ── UPDATE: admins manage their clinic's invites; the invited user may accept ──
DROP POLICY IF EXISTS "invitations_update" ON public.clinic_invitations;
CREATE POLICY "invitations_update" ON public.clinic_invitations FOR UPDATE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
    OR email = (auth.jwt() ->> 'email')
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
    OR email = (auth.jwt() ->> 'email')
  );
