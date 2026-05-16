-- ============================================================
-- 014 — Payment Providers: Wave + Orange Money readiness
-- Payments are NOT active during the pilot.
-- This migration extends the schema so the architecture is
-- ready to activate when NEXT_PUBLIC_PAYMENTS_ENABLED=true.
-- ============================================================

-- 1. Extend payment_method CHECK to include Wave and Orange Money.
--    PostgreSQL doesn't support ALTER CONSTRAINT, so we DROP + ADD.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_payment_method_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'mobile_money', 'insurance', 'other',
    'wave', 'orange_money'         -- online providers (pilot-gated)
  ));

-- 2. Online payment transaction tracking columns.
--    Separate from invoices.status (invoice lifecycle) —
--    these track the provider-side payment attempt.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT
    CHECK (payment_status IN ('pending','paid','failed','cancelled','refunded')),
  ADD COLUMN IF NOT EXISTS provider_payload JSONB,
  ADD COLUMN IF NOT EXISTS webhook_received_at TIMESTAMPTZ;

-- Index for webhook idempotency lookups (provider_reference must be unique per clinic)
CREATE INDEX IF NOT EXISTS idx_invoices_provider_ref
  ON public.invoices(payment_provider_reference)
  WHERE payment_provider_reference IS NOT NULL;

-- 3. Payment events audit log (immutable append-only ledger).
--    Every webhook hit or status transition is recorded here.
CREATE TABLE IF NOT EXISTS public.payment_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id     UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('wave','orange_money','manual')),
  event_type    TEXT NOT NULL,          -- e.g. 'checkout.created', 'payment.completed'
  provider_ref  TEXT,                   -- provider-side transaction/checkout ID
  amount        NUMERIC(12,2),
  currency      TEXT DEFAULT 'XOF',
  status        TEXT,                   -- raw status from provider
  payload       JSONB,                  -- full webhook/response payload (redacted of secrets)
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_clinic
  ON public.payment_events(clinic_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_invoice
  ON public.payment_events(invoice_id);

-- 4. RLS for payment_events.
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_events_select" ON public.payment_events FOR SELECT
  USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- Inserts go through service-role API routes only; regular users cannot insert.
CREATE POLICY "payment_events_insert" ON public.payment_events FOR INSERT
  WITH CHECK (public.is_super_admin());

-- Events are immutable — no UPDATE or DELETE for clinic users.
CREATE POLICY "payment_events_delete" ON public.payment_events FOR DELETE
  USING (public.is_super_admin());

-- 5. Realtime for payment status updates (billing page live refresh).
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_events;

NOTIFY pgrst, 'reload schema';
