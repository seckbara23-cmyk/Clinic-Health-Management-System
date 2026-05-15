-- ============================================================
-- 009c — Normalize ALL nullable text columns in auth.users
--
-- Pattern: GoTrue v2.189.0 scans auth.users columns into
-- non-nullable Go strings. Any NULL text column causes:
--   "Scan error on column index N, name X:
--    converting NULL to string is unsupported"
--
-- Fix: set every nullable text/varchar column to '' where NULL.
-- Safe to run multiple times (COALESCE is idempotent).
-- ============================================================

-- Step 1: Show all nullable text columns in auth.users
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth'
  AND table_name   = 'users'
  AND data_type IN ('text', 'character varying')
ORDER BY ordinal_position;

-- Step 2: Normalize ALL nullable string columns to '' where NULL
UPDATE auth.users
SET
  -- token fields (covered in 009b, repeated here for safety)
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  reauthentication_token     = COALESCE(reauthentication_token, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),

  -- identity / contact change fields
  email_change               = COALESCE(email_change, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone                      = COALESCE(phone, ''),

  updated_at = NOW();

-- Step 3: Verify zero NULLs remain in the known GoTrue string columns
SELECT
  COUNT(*) FILTER (WHERE confirmation_token         IS NULL) AS conf_token_nulls,
  COUNT(*) FILTER (WHERE recovery_token             IS NULL) AS recovery_nulls,
  COUNT(*) FILTER (WHERE email_change_token_new     IS NULL) AS chg_new_nulls,
  COUNT(*) FILTER (WHERE email_change_token_current IS NULL) AS chg_cur_nulls,
  COUNT(*) FILTER (WHERE reauthentication_token     IS NULL) AS reauth_nulls,
  COUNT(*) FILTER (WHERE phone_change_token         IS NULL) AS phone_token_nulls,
  COUNT(*) FILTER (WHERE email_change               IS NULL) AS email_change_nulls,
  COUNT(*) FILTER (WHERE phone_change               IS NULL) AS phone_change_nulls,
  COUNT(*) FILTER (WHERE phone                      IS NULL) AS phone_nulls
FROM auth.users;

-- All values must be 0. Restart Supabase project, then test login.
