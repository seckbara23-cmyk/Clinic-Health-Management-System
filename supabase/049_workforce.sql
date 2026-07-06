-- ════════════════════════════════════════════════════════════════
-- 049_workforce.sql — Phase 21: Enterprise Identity & Workforce Management
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Establishes the enterprise WORKFORCE tier:
-- the employment/HR record for a clinic's professionals and employees, their
-- credentials, an append-only employment-lifecycle timeline, and training
-- records. Touches NO existing table, column, FK, RPC, policy or grant. Every
-- object is guarded (IF NOT EXISTS / DROP-then-CREATE for policies). Safe on a
-- live database; nothing consumes these objects unless the app writes rows.
--
-- ── SEPARATION OF CONCERNS (why NEW tables, not ALTERs) ────────────
--   • user_profiles       → identity + ROLE (the ONLY source of permissions)
--   • professional_profiles (038) → self-declared clinical identity, USER-owned
--       (its UPDATE policy is user_id = auth.uid() — an admin cannot write it)
--   • employee_profiles   (here) → the HR/employment record, ADMIN-managed
-- The workforce tier JOINS to the first two for name/role/photo/specialty; it
-- never copies or alters them, and it never grants permissions. Department and
-- employment status are ORGANISATIONAL ONLY — RLS reads roles from
-- user_profiles via public.get_user_role(), never from this tier. An employment
-- event or department change therefore can NEVER affect clinical permissions.
--
-- ── P0 REGRESSION GUARD (the anti-junction rule) ───────────────────
-- Every table has a standalone surrogate `id` PK. NO composite-FK primary key,
-- so PostgREST can never infer a junction relationship (the migration-037 P0).
-- FK columns are plain columns; embeds must be FK-hinted by callers.
--
-- ── CREDENTIAL VERIFICATION IS NEVER AUTOMATED ─────────────────────
-- employee_credentials.verification_status defaults to 'unverified' and is only
-- ever changed by an explicit human UPDATE. There is NO trigger, default, or
-- function here that sets it to 'verified'. Reminders (90/60/30/expired) are
-- computed in the app from expiry_date — they never verify anything.

-- ── A. Employee (workforce/HR) profile ────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- surrogate PK (NOT composite)
  user_id               UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  clinic_id             UUID NOT NULL REFERENCES public.clinics(id)      ON DELETE CASCADE,

  -- HR identifiers
  matricule             TEXT,   -- employee number
  national_id           TEXT,   -- CNI / passport
  medical_license_number TEXT,
  council_registration  TEXT,

  -- Organisational placement (ORGANISATIONAL ONLY — never affects permissions)
  department            TEXT,   -- code from the department registry (code, not a table)
  position              TEXT,

  -- Employment terms
  employment_type       TEXT CHECK (employment_type IN
                          ('permanent','contract','intern','resident','consultant','volunteer')),
  employment_status     TEXT NOT NULL DEFAULT 'active' CHECK (employment_status IN
                          ('active','on_leave','suspended','retired','terminated')),
  hire_date             DATE,
  contract_end_date     DATE,

  -- Primary + additional clinic assignment (future-ready; organisational only)
  primary_clinic_id     UUID REFERENCES public.clinics(id),
  additional_clinic_ids UUID[] NOT NULL DEFAULT '{}',

  biography             TEXT,
  emergency_contact     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { name, phone, relation }

  created_by            UUID REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One employment record per person per clinic — a UNIQUE CONSTRAINT, never the PK.
  CONSTRAINT employee_profiles_user_clinic_key UNIQUE (user_id, clinic_id)
);
CREATE INDEX IF NOT EXISTS employee_profiles_clinic_idx ON public.employee_profiles (clinic_id);
CREATE INDEX IF NOT EXISTS employee_profiles_user_idx   ON public.employee_profiles (user_id);

-- ── B. Employee credentials (unlimited; human-verified only) ───────
CREATE TABLE IF NOT EXISTS public.employee_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES public.clinics(id)           ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,

  credential_type       TEXT NOT NULL,   -- license|board_certification|diploma|training|council_registration|other
  number                TEXT,
  issuing_authority     TEXT,
  issue_date            DATE,
  expiry_date           DATE,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','expired','revoked','pending')),
  attachment_path       TEXT,   -- Storage path placeholder (no auto-upload this phase)

  -- NEVER auto-set. Only an explicit human UPDATE moves this off 'unverified'.
  verification_status   TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (verification_status IN ('unverified','verified','rejected')),
  verified_by           UUID REFERENCES public.user_profiles(id),
  verified_at           TIMESTAMPTZ,

  notes                 TEXT,
  created_by            UUID REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS employee_credentials_employee_idx ON public.employee_credentials (employee_id);
CREATE INDEX IF NOT EXISTS employee_credentials_expiry_idx   ON public.employee_credentials (clinic_id, expiry_date);

-- ── C. Employment-lifecycle timeline (append-only; No delete) ──────
CREATE TABLE IF NOT EXISTS public.employee_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES public.clinics(id)           ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,

  -- hired|activated|leave_started|suspended|returned|retired|terminated|
  -- role_changed|department_changed|specialty_changed|credential_added|
  -- credential_renewed|password_reset|profile_updated|training_completed|note
  event_type            TEXT NOT NULL,
  from_value            TEXT,
  to_value              TEXT,
  note                  TEXT,
  effective_date        DATE,
  created_by            UUID REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS employee_events_employee_idx ON public.employee_events (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS employee_events_clinic_idx   ON public.employee_events (clinic_id, created_at DESC);

-- ── D. Training records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID NOT NULL REFERENCES public.clinics(id)           ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,

  title                 TEXT NOT NULL,
  provider              TEXT,
  completed_date        DATE,
  expiry_date           DATE,
  certificate_path      TEXT,   -- Storage path placeholder
  notes                 TEXT,
  created_by            UUID REFERENCES public.user_profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS training_records_employee_idx ON public.training_records (employee_id);
CREATE INDEX IF NOT EXISTS training_records_clinic_idx   ON public.training_records (clinic_id);

-- ── E. Row-Level Security (ADMIN-scoped, clinic-isolated) ──────────
-- Roles come from user_profiles via public.get_user_role() — NEVER from this
-- tier. Only clinic admins (and platform super_admins) manage workforce data;
-- an employee reads their OWN employment record. Cross-clinic access is only
-- ever via super_admin. No policy weakens tenant isolation.
ALTER TABLE public.employee_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_records     ENABLE ROW LEVEL SECURITY;

-- employee_profiles: admin manages the clinic's records; a member reads their own.
DROP POLICY IF EXISTS "employee_profiles_select" ON public.employee_profiles;
CREATE POLICY "employee_profiles_select" ON public.employee_profiles FOR SELECT
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
    OR (clinic_id = public.get_clinic_id() AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "employee_profiles_insert" ON public.employee_profiles;
CREATE POLICY "employee_profiles_insert" ON public.employee_profiles FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "employee_profiles_update" ON public.employee_profiles;
CREATE POLICY "employee_profiles_update" ON public.employee_profiles FOR UPDATE
  USING (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  )
  WITH CHECK (
    public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "employee_profiles_delete" ON public.employee_profiles;
CREATE POLICY "employee_profiles_delete" ON public.employee_profiles FOR DELETE USING (false);

-- employee_credentials / training_records: admin-managed, clinic-scoped.
-- (macro pattern applied per table)
DROP POLICY IF EXISTS "employee_credentials_select" ON public.employee_credentials;
CREATE POLICY "employee_credentials_select" ON public.employee_credentials FOR SELECT
  USING (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "employee_credentials_insert" ON public.employee_credentials;
CREATE POLICY "employee_credentials_insert" ON public.employee_credentials FOR INSERT
  WITH CHECK (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "employee_credentials_update" ON public.employee_credentials;
CREATE POLICY "employee_credentials_update" ON public.employee_credentials FOR UPDATE
  USING (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'))
  WITH CHECK (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "employee_credentials_delete" ON public.employee_credentials;
CREATE POLICY "employee_credentials_delete" ON public.employee_credentials FOR DELETE USING (false);

DROP POLICY IF EXISTS "training_records_select" ON public.training_records;
CREATE POLICY "training_records_select" ON public.training_records FOR SELECT
  USING (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "training_records_insert" ON public.training_records;
CREATE POLICY "training_records_insert" ON public.training_records FOR INSERT
  WITH CHECK (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "training_records_update" ON public.training_records;
CREATE POLICY "training_records_update" ON public.training_records FOR UPDATE
  USING (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'))
  WITH CHECK (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "training_records_delete" ON public.training_records;
CREATE POLICY "training_records_delete" ON public.training_records FOR DELETE USING (false);

-- employee_events: append-only lifecycle log. Admin reads + inserts; NEVER
-- updated or deleted from the client ("No delete" / immutable history).
DROP POLICY IF EXISTS "employee_events_select" ON public.employee_events;
CREATE POLICY "employee_events_select" ON public.employee_events FOR SELECT
  USING (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "employee_events_insert" ON public.employee_events;
CREATE POLICY "employee_events_insert" ON public.employee_events FOR INSERT
  WITH CHECK (public.is_super_admin()
    OR (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin'));
DROP POLICY IF EXISTS "employee_events_update" ON public.employee_events;
CREATE POLICY "employee_events_update" ON public.employee_events FOR UPDATE USING (false);
DROP POLICY IF EXISTS "employee_events_delete" ON public.employee_events;
CREATE POLICY "employee_events_delete" ON public.employee_events FOR DELETE USING (false);

-- ── F. updated_at maintenance (reuses the hardened trigger fn) ─────
DROP TRIGGER IF EXISTS employee_profiles_set_updated_at ON public.employee_profiles;
CREATE TRIGGER employee_profiles_set_updated_at
  BEFORE UPDATE ON public.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS employee_credentials_set_updated_at ON public.employee_credentials;
CREATE TRIGGER employee_credentials_set_updated_at
  BEFORE UPDATE ON public.employee_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS training_records_set_updated_at ON public.training_records;
CREATE TRIGGER training_records_set_updated_at
  BEFORE UPDATE ON public.training_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
