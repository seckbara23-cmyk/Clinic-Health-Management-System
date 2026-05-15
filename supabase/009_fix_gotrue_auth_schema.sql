-- ============================================================
-- 009 — Fix GoTrue auth schema compatibility
--
-- Root causes identified from Supabase Auth logs:
--
-- 1. auth.users token columns are NULL but GoTrue v2.189.0
--    scans them as non-nullable Go strings → crash on every
--    user lookup ("Scan error on column index 3,
--    name confirmation_token: converting NULL to string
--    is unsupported").
--
-- 2. handle_new_user trigger references user_profiles without
--    schema prefix. GoTrue connects with search_path=auth, so
--    Postgres looks for auth.user_profiles (does not exist)
--    instead of public.user_profiles → every signup fails
--    ("relation user_profiles does not exist").
-- ============================================================

-- ── A. Normalize NULL token columns → empty string ───────────
-- Only updates columns that exist and contain NULL values.

UPDATE auth.users
SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  reauthentication_token     = COALESCE(reauthentication_token, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  updated_at                 = NOW()
WHERE
  confirmation_token         IS NULL
  OR recovery_token          IS NULL
  OR email_change_token_new  IS NULL
  OR email_change_token_current IS NULL
  OR reauthentication_token  IS NULL
  OR phone_change_token      IS NULL;

-- ── B. Fix handle_new_user — explicit schema + search_path ───
-- SET search_path = public ensures the function always resolves
-- unqualified table names against the public schema, regardless
-- of the caller's search_path (GoTrue uses search_path=auth).
-- EXCEPTION block ensures a profile-insert failure never blocks
-- GoTrue from completing the auth.users insert.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'receptionist')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── C. Reload PostgREST schema cache ─────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── D. Verify ────────────────────────────────────────────────
SELECT
  email,
  (confirmation_token         IS NOT NULL) AS conf_token_ok,
  (recovery_token             IS NOT NULL) AS recovery_ok,
  (email_change_token_new     IS NOT NULL) AS change_new_ok,
  (email_change_token_current IS NOT NULL) AS change_cur_ok,
  (reauthentication_token     IS NOT NULL) AS reauth_ok,
  (phone_change_token         IS NOT NULL) AS phone_ok
FROM auth.users
WHERE email = 'seckbara23@gmail.com';
