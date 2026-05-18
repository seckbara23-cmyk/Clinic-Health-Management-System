-- ============================================================
-- 020 — Data Integrity Phase 2
--
-- A. Fix patient_number / invoice_number race conditions.
--    Old approach: COUNT(*) — two concurrent inserts read the
--    same count before either commits → same number assigned,
--    one INSERT fails with UNIQUE violation.
--    Fix: pg_advisory_xact_lock serialises number generation
--    per clinic. Lock is released at transaction end, so
--    concurrent inserts for different clinics are not affected.
--
-- B. Appointment status transition validation.
--    BEFORE UPDATE trigger rejects:
--      - Any transition out of terminal states
--        (completed, cancelled, no_show).
--      - Backward / nonsensical transitions.
--    Both legacy (in_queue, in_progress) and current queue
--    statuses (waiting, called, in_consultation) are covered
--    for backward compatibility.
--
-- C. record_manual_payment RPC function.
--    Atomic, server-validated payment recording:
--      1. Locks the invoice row (prevents double-payment).
--      2. Validates amount, payment method, and invoice status.
--      3. Updates invoice (amount_paid, status, paid_at).
--      4. Appends immutable payment_events audit row.
--    Replaces direct .update() on invoices from the billing page,
--    ensuring no invoice can be marked paid without an audit trail.
-- ============================================================

-- ── A. Fix race conditions ────────────────────────────────────

-- patient_number: use advisory lock to serialise inserts per clinic.
-- Namespace key 1 = patient numbers; hashtext(clinic_id) avoids
-- holding the lock across unrelated clinics.

CREATE OR REPLACE FUNCTION public.generate_patient_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count  INT;
  v_prefix TEXT;
BEGIN
  -- Serialise concurrent inserts for the same clinic.
  -- Different clinics hash to different values and are not blocked.
  PERFORM pg_advisory_xact_lock(1, hashtext(NEW.clinic_id::text));

  SELECT COUNT(*) INTO v_count
  FROM public.patients
  WHERE clinic_id = NEW.clinic_id;

  v_prefix          := 'PAT-' || TO_CHAR(NOW(), 'YYYY');
  NEW.patient_number := v_prefix || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

-- invoice_number: same lock strategy, namespace key 2 = invoice numbers.
-- Using a different namespace so patient and invoice generation for the
-- same clinic never block each other unnecessarily.

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Serialise concurrent inserts for the same clinic.
  PERFORM pg_advisory_xact_lock(2, hashtext(NEW.clinic_id::text));

  SELECT COUNT(*) INTO v_count
  FROM public.invoices
  WHERE clinic_id = NEW.clinic_id;

  NEW.invoice_number := 'INV-'
    || TO_CHAR(NOW(), 'YYYYMM')
    || '-'
    || LPAD((v_count + 1)::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

-- ── B. Appointment status transition validation ───────────────

CREATE OR REPLACE FUNCTION public.validate_appointment_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Terminal states: cannot transition out under any circumstance.
  -- This prevents reopening a completed/cancelled appointment.
  IF OLD.status IN ('completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION
      'Cannot change appointment status: % is a terminal state',
      OLD.status
    USING ERRCODE = 'P0001';
  END IF;

  -- Validate the specific transition.
  -- Covers both current queue statuses and legacy values so
  -- existing data and code paths continue to work.
  IF NOT (
    -- Scheduled: can move to any active or terminal state.
    -- 'completed' is allowed for direct consultation flows that bypass the queue.
    (OLD.status = 'scheduled'        AND NEW.status IN (
        'waiting','called','in_queue','in_consultation','in_progress',
        'completed','cancelled','no_show'))
    OR
    -- Waiting room → called/active/terminal
    (OLD.status = 'waiting'          AND NEW.status IN (
        'called','in_consultation','in_progress','completed','cancelled','no_show'))
    OR
    -- Called → active/terminal (cannot go back to waiting)
    (OLD.status = 'called'           AND NEW.status IN (
        'in_consultation','in_progress','completed','cancelled','no_show'))
    OR
    -- In consultation → only completed or cancelled
    (OLD.status = 'in_consultation'  AND NEW.status IN ('completed','cancelled'))
    OR
    -- Legacy: in_queue → any active or terminal
    (OLD.status = 'in_queue'         AND NEW.status IN (
        'waiting','called','in_consultation','in_progress',
        'completed','cancelled','no_show'))
    OR
    -- Legacy: in_progress → only completed or cancelled
    (OLD.status = 'in_progress'      AND NEW.status IN ('completed','cancelled'))
  ) THEN
    RAISE EXCEPTION
      'Invalid appointment status transition: % → %',
      OLD.status, NEW.status
    USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$;

-- Fire only when status actually changes (avoids overhead on every UPDATE)
DROP TRIGGER IF EXISTS trg_appointment_status_transition ON public.appointments;
CREATE TRIGGER trg_appointment_status_transition
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.validate_appointment_status_transition();

-- Revoke public EXECUTE (trigger fires internally, never called directly)
REVOKE EXECUTE ON FUNCTION public.validate_appointment_status_transition() FROM PUBLIC;

-- ── C. record_manual_payment RPC ─────────────────────────────
--
-- Called by the billing page via supabase.rpc().
-- SECURITY DEFINER lets it write to payment_events (which has
-- an INSERT policy requiring super_admin / service-role) while
-- still scoping access by the calling user's clinic via
-- get_clinic_id().

CREATE OR REPLACE FUNCTION public.record_manual_payment(
  p_invoice_id     UUID,
  p_amount         NUMERIC,
  p_payment_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice          invoices%ROWTYPE;
  v_caller_clinic_id UUID;
  v_new_paid         NUMERIC;
  v_new_status       TEXT;
BEGIN
  -- Identify the calling user's clinic. Callers without a clinic
  -- (unauthenticated, super_admin without clinic_id) are rejected.
  v_caller_clinic_id := public.get_clinic_id();
  IF v_caller_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied: no associated clinic'
      USING ERRCODE = '42501';
  END IF;

  -- Server-side input validation (mirrors client-side Zod schema)
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être supérieur à zéro'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_payment_method NOT IN ('cash','card','mobile_money','insurance','other') THEN
    RAISE EXCEPTION 'Mode de paiement invalide: %', p_payment_method
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the invoice row for the duration of this transaction.
  -- FOR UPDATE prevents a concurrent call from double-crediting the invoice.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
    AND clinic_id = v_caller_clinic_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable ou accès refusé'
      USING ERRCODE = 'P0003';
  END IF;

  -- Reject payments on terminal invoices
  IF v_invoice.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'La facture est déjà % et ne peut pas recevoir de paiement',
      v_invoice.status
      USING ERRCODE = 'P0004';
  END IF;

  -- Cap at total to prevent overpayment
  v_new_paid := LEAST(v_invoice.amount_paid + p_amount, v_invoice.total_amount);

  v_new_status := CASE
    WHEN v_new_paid >= v_invoice.total_amount THEN 'paid'
    ELSE 'partial'
  END;

  -- Atomically update the invoice
  UPDATE public.invoices SET
    amount_paid    = v_new_paid,
    status         = v_new_status,
    payment_method = p_payment_method,
    paid_at        = CASE WHEN v_new_status = 'paid' THEN NOW() ELSE paid_at END,
    updated_at     = NOW()
  WHERE id = p_invoice_id;

  -- Append immutable audit row.
  -- This INSERT runs as the function owner (postgres) so it bypasses the
  -- payment_events INSERT policy that requires super_admin.
  INSERT INTO public.payment_events (
    clinic_id,   invoice_id,  provider,
    event_type,  provider_ref, amount,
    currency,    status,       payload,
    received_at
  ) VALUES (
    v_invoice.clinic_id,
    v_invoice.id,
    'manual',
    'payment.manual',
    NULL,
    p_amount,
    COALESCE(v_invoice.currency, 'XOF'),
    'completed',
    jsonb_build_object(
      'payment_method',        p_payment_method,
      'recorded_by',           auth.uid(),
      'previous_amount_paid',  v_invoice.amount_paid,
      'new_amount_paid',       v_new_paid,
      'invoice_status',        v_new_status
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'invoice_id',  p_invoice_id,
    'amount_paid', v_new_paid,
    'status',      v_new_status
  );
END;
$$;

-- Allow authenticated clinic users to call this function.
-- Revoke first to clear any accidental public grant.
REVOKE EXECUTE ON FUNCTION public.record_manual_payment(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_manual_payment(UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
