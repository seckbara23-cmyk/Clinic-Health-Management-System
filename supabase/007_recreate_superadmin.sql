-- ============================================================
-- Recreate super_admin user from scratch
-- Run in Supabase SQL Editor (postgres superuser, bypasses RLS)
-- ============================================================

DO $$
DECLARE
  v_email     TEXT := 'seckbara23@gmail.com';
  v_pass      TEXT := '<CHANGE_ME>';   -- never commit real passwords
  v_name      TEXT := 'Bara Seck';
  v_user_id   UUID := gen_random_uuid();
  v_existing  UUID;
BEGIN

  -- Check if user already exists
  SELECT id INTO v_existing FROM auth.users WHERE email = v_email;

  IF v_existing IS NOT NULL THEN
    v_user_id := v_existing;
    RAISE NOTICE 'Existing auth.users row found: %', v_user_id;

    -- Update password and confirm email
    UPDATE auth.users
    SET encrypted_password  = crypt(v_pass, gen_salt('bf')),
        email_confirmed_at  = COALESCE(email_confirmed_at, NOW()),
        confirmation_token  = '',
        recovery_token      = '',
        email_change_token_new     = '',
        email_change_token_current = '',
        reauthentication_token     = '',
        phone_change_token  = '',
        updated_at          = NOW()
    WHERE id = v_user_id;
    RAISE NOTICE 'Updated auth.users row for %', v_email;

  ELSE
    -- Create fresh auth.users row
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change_token_new, email_change_token_current,
      reauthentication_token, phone_change_token,
      aud, role, created_at, updated_at
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(v_pass, gen_salt('bf')),
      NOW(),
      jsonb_build_object('full_name', v_name, 'role', 'super_admin'),
      '', '', '', '', '', '',
      'authenticated', 'authenticated',
      NOW(), NOW()
    );
    RAISE NOTICE 'Created auth.users row: %', v_user_id;
  END IF;

  -- Ensure auth.identities row exists (required for email/password sign-in)
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id::text,
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
    SET identity_data = EXCLUDED.identity_data,
        updated_at    = NOW();

  RAISE NOTICE 'auth.identities row upserted for %', v_email;

  -- Ensure user_profiles has super_admin role
  INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
  VALUES (v_user_id, v_email, v_name, 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET role      = 'super_admin',
        is_active = true,
        email     = v_email,
        full_name = v_name;

  RAISE NOTICE 'user_profiles.role = super_admin confirmed for %', v_email;

END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
