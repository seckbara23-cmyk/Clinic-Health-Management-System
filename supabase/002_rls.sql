-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Multi-tenant isolation: users can ONLY access their clinic's data
--
-- NOTE: Helper functions live in the PUBLIC schema, not auth.
-- Supabase blocks CREATE FUNCTION in the auth schema from the
-- SQL editor. The functions below are equivalent and work fine
-- inside RLS USING / WITH CHECK expressions.
-- ============================================================

-- ─── Helper: current user's clinic_id ───────────────────────
CREATE OR REPLACE FUNCTION public.get_clinic_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid();
$$;

-- ─── Helper: is the current user a super_admin? ─────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- ─── Helper: current user's role ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- CLINICS TABLE
-- ============================================================
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

-- Super admins see all clinics; regular users see only their own
CREATE POLICY "clinics_select" ON public.clinics FOR SELECT
  USING (
    public.is_super_admin()
    OR id = public.get_clinic_id()
  );

-- Only super_admin can create clinics directly
-- (regular signup goes through the signup flow which uses service role)
CREATE POLICY "clinics_insert" ON public.clinics FOR INSERT
  WITH CHECK (public.is_super_admin());

-- Admins can update their own clinic; super_admin updates any
CREATE POLICY "clinics_update" ON public.clinics FOR UPDATE
  USING (
    public.is_super_admin()
    OR (id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- Only super_admin can delete clinics
CREATE POLICY "clinics_delete" ON public.clinics FOR DELETE
  USING (public.is_super_admin());

-- ============================================================
-- USER PROFILES TABLE
-- ============================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users see profiles in their clinic; super_admin sees all; each user sees themselves
CREATE POLICY "user_profiles_select" ON public.user_profiles FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
    OR id = auth.uid()
  );

-- Profile is created by the handle_new_user() trigger (SECURITY DEFINER)
-- so the inserting session is the trigger, not the user themselves.
-- We still allow the user to insert their own row (edge case for manual setup).
CREATE POLICY "user_profiles_insert" ON public.user_profiles FOR INSERT
  WITH CHECK (id = auth.uid() OR public.is_super_admin());

-- Users update their own profile; admins update anyone in their clinic
CREATE POLICY "user_profiles_update" ON public.user_profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- Admins can deactivate members; cannot delete themselves
CREATE POLICY "user_profiles_delete" ON public.user_profiles FOR DELETE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() = 'admin'
      AND id != auth.uid()
    )
  );

-- ============================================================
-- PATIENTS TABLE
-- ============================================================
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients_select" ON public.patients FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

CREATE POLICY "patients_insert" ON public.patients FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
    )
  );

CREATE POLICY "patients_update" ON public.patients FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
    )
  );

-- Only admins can hard-delete patients
CREATE POLICY "patients_delete" ON public.patients FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ============================================================
-- APPOINTMENTS TABLE
-- ============================================================
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments_select" ON public.appointments FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

CREATE POLICY "appointments_insert" ON public.appointments FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
    )
  );

CREATE POLICY "appointments_update" ON public.appointments FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
    )
  );

CREATE POLICY "appointments_delete" ON public.appointments FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ============================================================
-- CONSULTATIONS TABLE
-- ============================================================
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultations_select" ON public.consultations FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

CREATE POLICY "consultations_insert" ON public.consultations FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','nurse')
    )
  );

CREATE POLICY "consultations_update" ON public.consultations FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor')
    )
  );

CREATE POLICY "consultations_delete" ON public.consultations FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ============================================================
-- PRESCRIPTIONS TABLE
-- ============================================================
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prescriptions_select" ON public.prescriptions FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

CREATE POLICY "prescriptions_insert" ON public.prescriptions FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor')
    )
  );

CREATE POLICY "prescriptions_update" ON public.prescriptions FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor')
    )
  );

CREATE POLICY "prescriptions_delete" ON public.prescriptions FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ============================================================
-- INVOICES TABLE
-- ============================================================
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select" ON public.invoices FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','receptionist','doctor')
    )
  );

CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','receptionist')
    )
  );

CREATE POLICY "invoices_delete" ON public.invoices FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ============================================================
-- CLINIC INVITATIONS TABLE
-- ============================================================
ALTER TABLE public.clinic_invitations ENABLE ROW LEVEL SECURITY;

-- Admins see invitations for their clinic; invited user can see their own invite
CREATE POLICY "invitations_select" ON public.clinic_invitations FOR SELECT
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "invitations_insert" ON public.clinic_invitations FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- Allow the invited user to mark their own invite accepted
CREATE POLICY "invitations_update" ON public.clinic_invitations FOR UPDATE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "invitations_delete" ON public.clinic_invitations FOR DELETE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

-- ============================================================
-- REALTIME: live queue updates for appointments and consultations
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.consultations;
