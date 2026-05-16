-- ============================================================
-- Phase 2: Queue Workflow + Consultation Flow
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Extend appointments.status to include the full queue lifecycle.
--    The original CHECK lists: scheduled, in_queue, in_progress, completed, cancelled, no_show
--    We keep all existing values for backward compat and add three new ones.

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    'scheduled',       -- booked, not yet arrived
    'waiting',         -- patient has physically arrived (was: in_queue)
    'called',          -- receptionist has called the patient's name (new)
    'in_consultation', -- actively in the doctor's room (was: in_progress)
    'completed',       -- consultation finished
    'cancelled',       -- appointment cancelled
    'no_show',         -- patient did not arrive
    -- legacy values kept so existing rows and code continue to work
    'in_queue',
    'in_progress'
  ));

-- 2. Track when each stage happens.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS arrived_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS called_at   TIMESTAMPTZ;

-- 3. Prevent duplicate active consultations for the same appointment.
--    A partial unique index covers only rows where appointment_id is not NULL
--    so that unlinked (direct-create) consultations are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS consultations_appointment_unique_idx
  ON public.consultations(appointment_id)
  WHERE appointment_id IS NOT NULL;

-- 4. Index the new timing columns for queue ordering queries.
CREATE INDEX IF NOT EXISTS idx_appointments_arrived
  ON public.appointments(clinic_id, arrived_at)
  WHERE arrived_at IS NOT NULL;

-- 5. Update the dashboard stats helper query to recognise the new statuses.
--    The pending count should include both legacy and new "active" statuses.
--    (No stored function to change here; the hook query is updated in TypeScript.)

-- 6. Realtime — ensure new columns are published.
--    appointments table is already in supabase_realtime publication from prior migrations.
--    Nothing extra needed.

NOTIFY pgrst, 'reload schema';
