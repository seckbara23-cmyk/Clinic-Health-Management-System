-- ════════════════════════════════════════════════════════════════
-- 069_identity.sql — Phase 42: Enterprise Identity Model
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Lets a pending email INVITATION carry the
-- new identity metadata (department + primary specialty) so it is applied to the
-- profile when the invite is accepted — matching the temp-password onboarding
-- path, which sets these directly on user_profiles.
--
-- The identity columns on user_profiles (department / primary_specialty /
-- sub_specialty) already exist since migration 037 — this migration does NOT
-- re-add or alter them.
--
-- NO destructive change: no DROP, no column type change, no RLS/policy change,
-- no auth.users reference, no permission change. Existing invitation rows get
-- NULL for the new columns and are unaffected. Safe on a live database.

ALTER TABLE public.clinic_invitations
  ADD COLUMN IF NOT EXISTS department        TEXT,
  ADD COLUMN IF NOT EXISTS primary_specialty TEXT;

-- ════════════════════════════════════════════════════════════════
-- End 069_identity.sql — additive; no existing object modified.
-- ════════════════════════════════════════════════════════════════
