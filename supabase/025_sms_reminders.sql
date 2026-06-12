-- ════════════════════════════════════════════════════════════════
-- 025 — SMS appointment reminders (Phase 1: schema + queue + RPC)
-- ════════════════════════════════════════════════════════════════
--
-- Adds the data layer for SMS appointment reminders:
--   A. patients     — SMS opt-in / opt-out preference
--   B. clinics      — per-clinic reminder settings
--   C. appointments — last_reminder_sent_at (reporting)
--   D. sms_messages       — outbox / queue with lifecycle + cost tracking
--   E. sms_delivery_events — immutable per-attempt / per-receipt ledger
--   F. RLS (clinic-scoped, write only via service-role API/cron)
--   G. claim_sms_batch()  — concurrency-safe dispatch claim
--
-- All additive and backward compatible. Reminders stay dormant until a
-- clinic sets sms_reminders_enabled = true AND the SMS_ENABLED /
-- ORANGE_SMS_ENABLED env flags are on. No provider is called by this
-- migration. Senegal runs on UTC+0 (Africa/Dakar, no DST), so all
-- TIMESTAMPTZ window comparisons are correct in UTC.

-- ── A. patients — opt-in (default true: transactional reminders) ──
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS sms_opt_in     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ;

-- ── B. clinics — reminder settings (off by default; opt-in per clinic) ──
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS sms_reminders_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_24h_enabled      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_same_day_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_sender_id             TEXT;  -- alphanumeric sender / short code

-- ── C. appointments — reporting field ────────────────────────────
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;

-- ── D. sms_messages — queue / outbox (current state) ─────────────
CREATE TABLE IF NOT EXISTS public.sms_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id           UUID NOT NULL REFERENCES public.clinics(id)      ON DELETE CASCADE,
  patient_id          UUID          REFERENCES public.patients(id)     ON DELETE SET NULL,
  appointment_id      UUID          REFERENCES public.appointments(id) ON DELETE CASCADE,
  reminder_type       TEXT NOT NULL CHECK (reminder_type IN
                        ('appointment_24h','appointment_same_day','manual')),
  to_phone            TEXT NOT NULL,                 -- E.164 snapshot at enqueue time
  body                TEXT NOT NULL,                 -- rendered message snapshot
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                        ('queued','sending','sent','delivered','failed','cancelled','skipped')),
  provider            TEXT CHECK (provider IN ('orange_sms','twilio')),
  provider_message_id TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  max_attempts        INT NOT NULL DEFAULT 3,
  -- Cost tracking (populated from provider response on send)
  segments            INT,
  cost_amount         NUMERIC(10,4),
  cost_currency       TEXT DEFAULT 'XOF',
  -- Scheduling / retry
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- earliest send time
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- retry gate
  -- Audit timestamps
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  last_error          TEXT,
  created_by          UUID REFERENCES auth.users(id),       -- NULL = system / cron
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: at most one AUTOMATIC reminder per (appointment, type).
-- Manual resends are exempt so staff can re-send as often as needed.
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_dedupe
  ON public.sms_messages (appointment_id, reminder_type)
  WHERE appointment_id IS NOT NULL AND reminder_type <> 'manual';

-- Dispatch worker hot path: due queued rows ordered by retry gate.
CREATE INDEX IF NOT EXISTS sms_messages_due
  ON public.sms_messages (next_attempt_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS sms_messages_clinic
  ON public.sms_messages (clinic_id, created_at DESC);

-- ── E. sms_delivery_events — immutable ledger (mirrors payment_events) ──
CREATE TABLE IF NOT EXISTS public.sms_delivery_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id      UUID NOT NULL REFERENCES public.clinics(id)       ON DELETE CASCADE,
  sms_message_id UUID NOT NULL REFERENCES public.sms_messages(id)  ON DELETE CASCADE,
  provider       TEXT,
  event_type     TEXT NOT NULL,   -- queued | dispatch_attempt | accepted | delivery_receipt | failed
  provider_ref   TEXT,            -- provider-side message id
  status         TEXT,            -- raw status from provider
  payload        JSONB,           -- full provider response (audit: "provider response")
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_delivery_events_message
  ON public.sms_delivery_events (sms_message_id);

CREATE INDEX IF NOT EXISTS sms_delivery_events_clinic
  ON public.sms_delivery_events (clinic_id, received_at DESC);

-- ── F. RLS ───────────────────────────────────────────────────────
-- Read: clinic-scoped (staff see their clinic; super_admin sees all).
-- Write: NO policies for clinic users — every insert/update flows through
-- service-role API routes (cron + manual resend), so status transitions
-- cannot be forged and the ledger stays immutable. service_role bypasses RLS.

ALTER TABLE public.sms_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_delivery_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms_messages_select" ON public.sms_messages;
CREATE POLICY "sms_messages_select" ON public.sms_messages FOR SELECT
  USING (public.is_super_admin() OR clinic_id = public.get_clinic_id());

DROP POLICY IF EXISTS "sms_delivery_events_select" ON public.sms_delivery_events;
CREATE POLICY "sms_delivery_events_select" ON public.sms_delivery_events FOR SELECT
  USING (public.is_super_admin() OR clinic_id = public.get_clinic_id());

-- ── G. claim_sms_batch — concurrency-safe dispatch claim ─────────
-- Atomically flips up to p_limit due 'queued' rows to 'sending' and
-- returns them. FOR UPDATE SKIP LOCKED guarantees two overlapping cron
-- ticks never claim the same row, so a message is never double-sent.
CREATE OR REPLACE FUNCTION public.claim_sms_batch(p_limit INT DEFAULT 50)
RETURNS SETOF public.sms_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.sms_messages m
  SET    status = 'sending', updated_at = NOW()
  WHERE  m.id IN (
    SELECT s.id
    FROM   public.sms_messages s
    WHERE  s.status = 'queued'
      AND  s.scheduled_for   <= NOW()
      AND  s.next_attempt_at <= NOW()
    ORDER BY s.next_attempt_at
    FOR UPDATE SKIP LOCKED
    LIMIT  p_limit
  )
  RETURNING m.*;
END;
$$;

-- Only the service role (cron / API) may claim. Never the public/anon role.
REVOKE EXECUTE ON FUNCTION public.claim_sms_batch(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_sms_batch(INT) TO service_role;

NOTIFY pgrst, 'reload schema';
