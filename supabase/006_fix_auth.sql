-- ============================================================
-- Fix: auth.identities missing row + schema cache reload
-- Run in Supabase SQL Editor (postgres superuser, bypasses RLS)
-- ============================================================

DO $$
DECLARE
  v_user_id   UUID;
  v_email     TEXT := 'seckbara23@gmail.com';
  v_pass      TEXT := '<CHANGE_ME>';   -- never commit real passwords
BEGIN

  -- 1. Confirm auth.users row exists
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth.users row not found for %. Run 005_setup_superadmin.sql first.', v_email;
  END IF;
  RAISE NOTICE 'Found auth.users row: %', v_user_id;

  -- 2. Ensure email is confirmed
  UPDATE auth.users
  SET    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
         updated_at         = NOW()
  WHERE  id = v_user_id;

  -- 3. Ensure password is set (re-hash to be safe)
  UPDATE auth.users
  SET    encrypted_password = crypt(v_pass, gen_salt('bf')),
         updated_at         = NOW()
  WHERE  id = v_user_id;

  -- 4. Create auth.identities row (required for email/password sign-in)
  --    GoTrue uses this to look up the auth provider for a user.
  --    Direct SQL inserts into auth.users skip this step.
  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id::text,            -- provider_id for email = user UUID as string
    v_user_id,
    jsonb_build_object(
      'sub',            v_user_id::text,
      'email',          v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    NOW(), NOW(), NOW()
  )
  ON CONFLICT (provider, provider_id) DO UPDATE
    SET identity_data  = EXCLUDED.identity_data,
        updated_at     = NOW();

  RAISE NOTICE 'auth.identities row created/updated for %', v_email;

  -- 5. Ensure user_profiles has super_admin role
  INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
  VALUES (v_user_id, v_email, 'Bara Seck', 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET role      = 'super_admin',
        is_active = true,
        email     = v_email;

  RAISE NOTICE 'user_profiles.role = super_admin confirmed for %', v_email;

END;
$$;

-- 6. Reload PostgREST schema cache so embedded queries work (clinic:clinics(*) etc.)
NOTIFY pgrst, 'reload schema';
