-- ============================================================
-- Phase 2 Onboarding: Clinic approval workflow
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add onboarding status to clinics.
--    Separate from subscription_status (billing) — this tracks approval lifecycle.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'rejected', 'suspended'));

-- Back-fill existing clinics as active.
UPDATE public.clinics SET status = 'active' WHERE status IS NULL;

-- 2. Clinic signup requests table (public/unauthenticated submissions).
CREATE TABLE IF NOT EXISTS public.clinic_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_name      TEXT NOT NULL,
  location         TEXT NOT NULL,
  phone            TEXT,
  admin_full_name  TEXT NOT NULL,
  admin_email      TEXT NOT NULL,
  message          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by      UUID REFERENCES auth.users(id),
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  clinic_id        UUID REFERENCES public.clinics(id),  -- filled when approved
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_requests_status ON public.clinic_requests(status);
CREATE INDEX IF NOT EXISTS idx_clinic_requests_email  ON public.clinic_requests(admin_email);

CREATE OR REPLACE TRIGGER trg_clinic_requests_updated_at
  BEFORE UPDATE ON public.clinic_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. RLS for clinic_requests.
--    Public INSERT (unauthenticated signup form) goes through a service-role
--    API route — RLS on INSERT is permissive here because the route enforces
--    its own validation and rate-limiting.  Only super_admin can read/manage.
ALTER TABLE public.clinic_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_requests_select" ON public.clinic_requests FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "clinic_requests_insert" ON public.clinic_requests FOR INSERT
  WITH CHECK (true);   -- API route uses service role; keeps open for service key inserts

CREATE POLICY "clinic_requests_update" ON public.clinic_requests FOR UPDATE
  USING (public.is_super_admin());

CREATE POLICY "clinic_requests_delete" ON public.clinic_requests FOR DELETE
  USING (public.is_super_admin());

-- 4. Helper: check whether the calling user's account is currently active.
--    Used in server-side layout guards.
CREATE OR REPLACE FUNCTION public.get_my_is_active()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_active FROM public.user_profiles WHERE id = auth.uid();
$$;

-- 5. Update clinics_select policy so pending/rejected clinics are visible
--    to super_admin (already true — is_super_admin() sees all rows).
--    Regular clinic admins should NOT see a pending clinic they belong to
--    until it is approved; the is_active = false on their user_profile blocks
--    them from reaching the dashboard at all.

-- 6. Realtime for requests (super admin UI live updates).
ALTER PUBLICATION supabase_realtime ADD TABLE public.clinic_requests;

NOTIFY pgrst, 'reload schema';
