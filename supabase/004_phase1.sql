-- ============================================================
-- Phase 1 Migration: cashier role + RLS updates
-- ============================================================

-- Add cashier to user_profiles role check
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'doctor', 'receptionist', 'nurse', 'cashier'));

-- Add cashier to clinic_invitations role check
ALTER TABLE public.clinic_invitations
  DROP CONSTRAINT IF EXISTS clinic_invitations_role_check;

ALTER TABLE public.clinic_invitations
  ADD CONSTRAINT clinic_invitations_role_check
  CHECK (role IN ('admin', 'doctor', 'receptionist', 'nurse', 'cashier'));

-- Update invoices INSERT: cashier can create invoices
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin', 'receptionist', 'doctor', 'cashier')
    )
  );

-- Update invoices UPDATE: cashier can update invoices (record payments)
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin', 'receptionist', 'cashier')
    )
  );

-- Cashier needs read access to patients (for billing)
-- Existing patients_select policy already allows all clinic members via role check,
-- but update it explicitly to be clear and include cashier
DROP POLICY IF EXISTS "patients_select" ON public.patients;
CREATE POLICY "patients_select" ON public.patients FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- Cashier needs read access to appointments (for billing lookup)
DROP POLICY IF EXISTS "appointments_select" ON public.appointments;
CREATE POLICY "appointments_select" ON public.appointments FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );
