-- ============================================================
-- 015 — Temporary password enforcement
-- must_change_password gates dashboard access until the user
-- has set their own password after a super-admin-generated temp.
-- ============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Back-fill: existing active users do not need to change password.
-- (Only newly created admins, or those whose password was reset, get true.)
UPDATE public.user_profiles
  SET must_change_password = false
  WHERE must_change_password IS NULL;

-- Index: fast lookup in the dashboard layout server check
CREATE INDEX IF NOT EXISTS idx_user_profiles_must_change
  ON public.user_profiles(id)
  WHERE must_change_password = true;

NOTIFY pgrst, 'reload schema';
