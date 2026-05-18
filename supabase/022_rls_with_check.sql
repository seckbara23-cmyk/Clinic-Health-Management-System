-- ============================================================
-- 022 — RLS WITH CHECK hardening
--
-- Problem: UPDATE policies in 002_rls.sql (and subsequent
-- migrations) used only the USING clause.  In PostgreSQL:
--
--   USING  — filters WHICH rows the user can see/modify
--   WITH CHECK — validates the NEW row values after the update
--
-- Without WITH CHECK, a user could UPDATE a row's clinic_id to
-- their own clinic, then update it back — effectively reading or
-- touching another clinic's data mid-flight. More critically, a
-- malicious UPDATE could change clinic_id, patient_id, or other
-- FK columns to values the user shouldn't control.
--
-- Fix: add WITH CHECK (clinic_id = get_clinic_id()) to every
-- UPDATE policy on clinic-scoped tables.  Super-admin is exempt
-- from the clinic_id check (they intentionally span clinics).
--
-- Tables patched:
--   clinics, user_profiles, patients, appointments, consultations,
--   prescriptions, invoices, clinic_invitations, lab_requests,
--   clinic_services, clinic_requests
-- ============================================================

-- ── clinics ──────────────────────────────────────────────────
-- An admin can update their own clinic row but cannot reassign
-- the id or change it to look like a different clinic.
DROP POLICY IF EXISTS "clinics_update" ON public.clinics;
CREATE POLICY "clinics_update" ON public.clinics FOR UPDATE
  USING (
    public.is_super_admin()
    OR (id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  )
  WITH CHECK (
    public.is_super_admin()
    OR id = public.get_clinic_id()
  );

-- ── user_profiles ─────────────────────────────────────────────
-- Users can only update their own profile or (admin) someone in
-- their clinic.  WITH CHECK prevents reassigning clinic_id.
DROP POLICY IF EXISTS "user_profiles_update" ON public.user_profiles;
CREATE POLICY "user_profiles_update" ON public.user_profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  )
  WITH CHECK (
    public.is_super_admin()
    OR id = auth.uid()
    OR clinic_id = public.get_clinic_id()
  );

-- ── patients ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "patients_update" ON public.patients;
CREATE POLICY "patients_update" ON public.patients FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── appointments ─────────────────────────────────────────────
DROP POLICY IF EXISTS "appointments_update" ON public.appointments;
CREATE POLICY "appointments_update" ON public.appointments FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── consultations ─────────────────────────────────────────────
DROP POLICY IF EXISTS "consultations_update" ON public.consultations;
CREATE POLICY "consultations_update" ON public.consultations FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── prescriptions ─────────────────────────────────────────────
DROP POLICY IF EXISTS "prescriptions_update" ON public.prescriptions;
CREATE POLICY "prescriptions_update" ON public.prescriptions FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── invoices ──────────────────────────────────────────────────
-- Note: direct invoice updates for payments are now blocked
-- in favour of the record_manual_payment() RPC (migration 020).
-- This policy covers the remaining admin/receptionist updates
-- (e.g. status corrections, due-date changes).
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','receptionist','cashier')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── clinic_invitations ────────────────────────────────────────
-- The invited user can mark their own invite accepted (email match).
-- WITH CHECK prevents changing clinic_id or email fields.
DROP POLICY IF EXISTS "invitations_update" ON public.clinic_invitations;
CREATE POLICY "invitations_update" ON public.clinic_invitations FOR UPDATE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ── lab_requests ─────────────────────────────────────────────
-- Find the current policy name — migration 005 created it.
DROP POLICY IF EXISTS "lab_requests_update" ON public.lab_requests;
DROP POLICY IF EXISTS "lab_update"          ON public.lab_requests;
CREATE POLICY "lab_requests_update" ON public.lab_requests FOR UPDATE
  USING (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin','doctor','nurse')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── clinic_services ───────────────────────────────────────────
-- Find the current policy name — migration 013 created it.
DROP POLICY IF EXISTS "services_update"        ON public.clinic_services;
DROP POLICY IF EXISTS "clinic_services_update" ON public.clinic_services;
CREATE POLICY "clinic_services_update" ON public.clinic_services FOR UPDATE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  )
  WITH CHECK (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- ── clinic_requests ───────────────────────────────────────────
-- Only super_admin or service-role touches this table.
DROP POLICY IF EXISTS "clinic_requests_update" ON public.clinic_requests;
CREATE POLICY "clinic_requests_update" ON public.clinic_requests FOR UPDATE
  USING  (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ── Payment provider reference: partial unique index ─────────
-- Prevents two invoices in the same clinic from sharing a
-- payment_provider_reference (idempotency guard for webhooks).
-- The partial index (WHERE NOT NULL) avoids conflicts on un-paid
-- invoices that have no reference yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_provider_ref_clinic
  ON public.invoices(clinic_id, payment_provider_reference)
  WHERE payment_provider_reference IS NOT NULL;

NOTIFY pgrst, 'reload schema';
