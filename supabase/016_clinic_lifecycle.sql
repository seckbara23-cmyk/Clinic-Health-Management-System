-- ============================================================
-- 016 — Clinic lifecycle hardening
--
-- A. Extend clinics.status to support full lifecycle:
--    inactive (temporarily closed), archived (soft-deleted)
-- B. Extend clinic_requests audit trail:
--    created_user_id — auth.users id created on approval
--    review_notes    — general notes from super admin (not just rejection)
-- ============================================================

-- ── A. Clinic status lifecycle ──────────────────────────────

-- DROP + ADD because PostgreSQL cannot ALTER CHECK inline
ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_status_check;

ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_status_check
  CHECK (status IN ('pending', 'active', 'rejected', 'suspended', 'inactive', 'archived'));

-- ── B. Clinic request audit trail ──────────────────────────

ALTER TABLE public.clinic_requests
  ADD COLUMN IF NOT EXISTS created_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_notes TEXT;   -- general super admin notes on any review action

-- Index to look up requests by the created user (join to user_profiles)
CREATE INDEX IF NOT EXISTS idx_clinic_requests_user
  ON public.clinic_requests(created_user_id)
  WHERE created_user_id IS NOT NULL;

-- ── C. Ensure archived clinics are excluded from realtime
--       subscriptions for regular users (RLS handles this, but
--       make it explicit that archived ≠ active).
--   No schema change needed — RLS on clinics already enforces
--   clinic_id = get_clinic_id() for non-super_admin users.
--   An archived clinic's users will have is_active = false set
--   by the archive API route.

NOTIFY pgrst, 'reload schema';
