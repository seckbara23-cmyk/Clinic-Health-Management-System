-- ============================================================
-- CHMS Multi-Tenant Schema for Senegal
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. CLINICS (top-level tenant)
-- ============================================================
CREATE TABLE IF NOT EXISTS clinics (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  location      TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  logo_url      TEXT,
  subscription_plan TEXT NOT NULL DEFAULT 'free' CHECK (subscription_plan IN ('free', 'basic', 'pro', 'enterprise')),
  subscription_status TEXT NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'suspended', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. USER PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id     UUID REFERENCES clinics(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'receptionist' CHECK (role IN ('super_admin', 'admin', 'doctor', 'receptionist', 'nurse')),
  phone         TEXT,
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. PATIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS patients (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_number    TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  date_of_birth     DATE,
  gender            TEXT CHECK (gender IN ('male', 'female', 'other')),
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  emergency_contact TEXT,
  emergency_phone   TEXT,
  blood_type        TEXT CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  allergies         TEXT[],
  notes             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, patient_number)
);

-- ============================================================
-- 4. APPOINTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id       UUID REFERENCES auth.users(id),
  title           TEXT NOT NULL DEFAULT 'Consultation',
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_min    INT NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_queue','in_progress','completed','cancelled','no_show')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','emergency')),
  queue_number    INT,
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. CONSULTATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS consultations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id      UUID REFERENCES appointments(id),
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id           UUID NOT NULL REFERENCES auth.users(id),
  chief_complaint     TEXT,
  symptoms            TEXT,
  diagnosis           TEXT,
  treatment_plan      TEXT,
  notes               TEXT,
  vital_signs         JSONB DEFAULT '{}',
  follow_up_date      DATE,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. PRESCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS prescriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  consultation_id   UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id         UUID NOT NULL REFERENCES auth.users(id),
  medications       JSONB NOT NULL DEFAULT '[]',
  instructions      TEXT,
  valid_until       DATE,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dispensed','expired','cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consultation_id   UUID REFERENCES consultations(id),
  invoice_number    TEXT NOT NULL,
  line_items        JSONB NOT NULL DEFAULT '[]',
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'XOF',
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','partial','overdue','cancelled')),
  payment_method    TEXT CHECK (payment_method IN ('cash','card','mobile_money','insurance','other')),
  due_date          DATE,
  paid_at           TIMESTAMPTZ,
  notes             TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, invoice_number)
);

-- ============================================================
-- 8. CLINIC INVITATIONS (for onboarding)
-- ============================================================
CREATE TABLE IF NOT EXISTS clinic_invitations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'receptionist' CHECK (role IN ('admin','doctor','receptionist','nurse')),
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by    UUID REFERENCES auth.users(id),
  accepted_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES (performance on clinic_id)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_clinic    ON user_profiles(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_clinic         ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_name           ON patients(clinic_id, full_name);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic     ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date       ON appointments(clinic_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient    ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status     ON appointments(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_consultations_clinic    ON consultations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient   ON consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic    ON prescriptions(clinic_id);
CREATE INDEX IF NOT EXISTS idx_invoices_clinic         ON invoices(clinic_id);
CREATE INDEX IF NOT EXISTS idx_invoices_patient        ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status         ON invoices(clinic_id, status);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_consultations_updated_at
  BEFORE UPDATE ON consultations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_prescriptions_updated_at
  BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTO-GENERATE patient numbers per clinic
-- ============================================================
CREATE OR REPLACE FUNCTION generate_patient_number()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
  v_prefix TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM patients WHERE clinic_id = NEW.clinic_id;
  v_prefix := 'PAT-' || TO_CHAR(NOW(), 'YYYY');
  NEW.patient_number := v_prefix || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_patient_number
  BEFORE INSERT ON patients FOR EACH ROW
  WHEN (NEW.patient_number IS NULL OR NEW.patient_number = '')
  EXECUTE FUNCTION generate_patient_number();

-- ============================================================
-- AUTO-GENERATE invoice numbers per clinic
-- ============================================================
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM invoices WHERE clinic_id = NEW.clinic_id;
  NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_invoice_number
  BEFORE INSERT ON invoices FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
  EXECUTE FUNCTION generate_invoice_number();

-- ============================================================
-- AUTO-CREATE user profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'receptionist')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
