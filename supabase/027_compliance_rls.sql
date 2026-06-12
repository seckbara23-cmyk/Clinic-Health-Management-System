-- ════════════════════════════════════════════════════════════════
-- 027 — Compliance RLS rewrite (BREAKING — apply LAST)
-- ════════════════════════════════════════════════════════════════
--
-- Apply this ONLY after the app no longer relies on the old behavior
-- (i.e. after 026 + the app changes are deployed). It:
--
--   1. Removes super_admin access to protected medical/billing tables,
--      matching the documented control (SUPER_ADMIN_GUIDE: super_admin
--      "cannot read patient records / consultations / prescriptions /
--      billing"). Super-admin oversight is provided by the aggregate-only
--      get_platform_billing_summary() RPC from 026 instead.
--   2. Hides soft-deleted rows from non-admins (defense in depth); clinic
--      admins can still see them.
--   3. Blocks hard DELETE on all protected tables (USING(false)) — deletion
--      is soft-only via soft_delete_record().
--
-- service_role (cron, payment webhooks, record_manual_payment, exports,
-- audit functions) BYPASSES RLS and is unaffected.
--
-- Tables covered: patients, appointments, consultations, prescriptions,
-- invoices, lab_requests, consultation_vitals, payment_events,
-- sms_messages, sms_delivery_events.

-- ── Helper predicate reused below ─────────────────────────────────
-- A row is visible to a clinic member when it belongs to their clinic AND
-- (it is not soft-deleted OR the member is an admin).

-- ============================================================
-- PATIENTS
-- ============================================================
DROP POLICY IF EXISTS "patients_select" ON public.patients;
CREATE POLICY "patients_select" ON public.patients FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "patients_insert" ON public.patients;
CREATE POLICY "patients_insert" ON public.patients FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
  );

DROP POLICY IF EXISTS "patients_update" ON public.patients;
CREATE POLICY "patients_update" ON public.patients FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
  );

DROP POLICY IF EXISTS "patients_delete" ON public.patients;
CREATE POLICY "patients_delete" ON public.patients FOR DELETE USING (false);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
DROP POLICY IF EXISTS "appointments_select" ON public.appointments;
CREATE POLICY "appointments_select" ON public.appointments FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "appointments_insert" ON public.appointments;
CREATE POLICY "appointments_insert" ON public.appointments FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
  );

DROP POLICY IF EXISTS "appointments_update" ON public.appointments;
CREATE POLICY "appointments_update" ON public.appointments FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','receptionist','nurse')
  );

DROP POLICY IF EXISTS "appointments_delete" ON public.appointments;
CREATE POLICY "appointments_delete" ON public.appointments FOR DELETE USING (false);

-- ============================================================
-- CONSULTATIONS
-- ============================================================
DROP POLICY IF EXISTS "consultations_select" ON public.consultations;
CREATE POLICY "consultations_select" ON public.consultations FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "consultations_insert" ON public.consultations;
CREATE POLICY "consultations_insert" ON public.consultations FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  );

DROP POLICY IF EXISTS "consultations_update" ON public.consultations;
CREATE POLICY "consultations_update" ON public.consultations FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor')
  );

DROP POLICY IF EXISTS "consultations_delete" ON public.consultations;
CREATE POLICY "consultations_delete" ON public.consultations FOR DELETE USING (false);

-- ============================================================
-- PRESCRIPTIONS
-- ============================================================
DROP POLICY IF EXISTS "prescriptions_select" ON public.prescriptions;
CREATE POLICY "prescriptions_select" ON public.prescriptions FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "prescriptions_insert" ON public.prescriptions;
CREATE POLICY "prescriptions_insert" ON public.prescriptions FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor')
  );

DROP POLICY IF EXISTS "prescriptions_update" ON public.prescriptions;
CREATE POLICY "prescriptions_update" ON public.prescriptions FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor')
  );

DROP POLICY IF EXISTS "prescriptions_delete" ON public.prescriptions;
CREATE POLICY "prescriptions_delete" ON public.prescriptions FOR DELETE USING (false);

-- ============================================================
-- INVOICES
-- ============================================================
DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','receptionist','doctor','cashier')
  );

DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','receptionist','cashier')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','receptionist','cashier')
  );

DROP POLICY IF EXISTS "invoices_delete" ON public.invoices;
CREATE POLICY "invoices_delete" ON public.invoices FOR DELETE USING (false);

-- ============================================================
-- LAB REQUESTS
-- ============================================================
DROP POLICY IF EXISTS "lab_requests_select" ON public.lab_requests;
CREATE POLICY "lab_requests_select" ON public.lab_requests FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "lab_requests_insert" ON public.lab_requests;
CREATE POLICY "lab_requests_insert" ON public.lab_requests FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  );

DROP POLICY IF EXISTS "lab_requests_update" ON public.lab_requests;
DROP POLICY IF EXISTS "lab_update"          ON public.lab_requests;
CREATE POLICY "lab_requests_update" ON public.lab_requests FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  );

DROP POLICY IF EXISTS "lab_requests_delete" ON public.lab_requests;
CREATE POLICY "lab_requests_delete" ON public.lab_requests FOR DELETE USING (false);

-- ============================================================
-- CONSULTATION VITALS (policy names from migration 017)
-- ============================================================
DROP POLICY IF EXISTS "vitals_select" ON public.consultation_vitals;
CREATE POLICY "vitals_select" ON public.consultation_vitals FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "vitals_insert" ON public.consultation_vitals;
CREATE POLICY "vitals_insert" ON public.consultation_vitals FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse','receptionist')
  );

-- Was super_admin-only UPDATE; super_admin no longer touches medical data.
-- (Soft-delete/restore run via SECURITY DEFINER RPC and bypass RLS regardless.)
DROP POLICY IF EXISTS "vitals_update_superadmin" ON public.consultation_vitals;
DROP POLICY IF EXISTS "vitals_update" ON public.consultation_vitals;
CREATE POLICY "vitals_update" ON public.consultation_vitals FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  );

DROP POLICY IF EXISTS "vitals_delete" ON public.consultation_vitals;
CREATE POLICY "vitals_delete" ON public.consultation_vitals FOR DELETE USING (false);

-- ============================================================
-- PAYMENT EVENTS (ledger — read clinic-scoped, never deletable)
-- ============================================================
DROP POLICY IF EXISTS "payment_events_select" ON public.payment_events;
CREATE POLICY "payment_events_select" ON public.payment_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

DROP POLICY IF EXISTS "payment_events_delete" ON public.payment_events;
CREATE POLICY "payment_events_delete" ON public.payment_events FOR DELETE USING (false);

-- ============================================================
-- SMS MESSAGES + DELIVERY EVENTS (carry phone/PII)
-- ============================================================
DROP POLICY IF EXISTS "sms_messages_select" ON public.sms_messages;
CREATE POLICY "sms_messages_select" ON public.sms_messages FOR SELECT
  USING (clinic_id = public.get_clinic_id());

DROP POLICY IF EXISTS "sms_delivery_events_select" ON public.sms_delivery_events;
CREATE POLICY "sms_delivery_events_select" ON public.sms_delivery_events FOR SELECT
  USING (clinic_id = public.get_clinic_id());

NOTIFY pgrst, 'reload schema';
