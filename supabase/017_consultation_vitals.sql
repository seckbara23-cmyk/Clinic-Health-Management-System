-- ============================================================
-- 017 — Consultation Vitals
--
-- Structured vital signs table linked to clinic, patient, and
-- consultation. Replaces the legacy vital_signs JSONB on the
-- consultations table (JSONB column kept for backward compat;
-- new UI writes here exclusively).
--
-- Design: append-only for clinic users. Each save creates a
-- new row. Latest record = current vitals. History preserved
-- for trend analysis across consultations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.consultation_vitals (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id        UUID        NOT NULL REFERENCES public.clinics(id)       ON DELETE CASCADE,
  patient_id       UUID        NOT NULL REFERENCES public.patients(id)      ON DELETE CASCADE,
  consultation_id  UUID        NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,

  -- Cardiovascular
  systolic_bp      SMALLINT    CHECK (systolic_bp  BETWEEN 40 AND 300),
  diastolic_bp     SMALLINT    CHECK (diastolic_bp BETWEEN 20 AND 200),
  heart_rate       SMALLINT    CHECK (heart_rate   BETWEEN 20 AND 300),

  -- Respiratory
  respiratory_rate SMALLINT    CHECK (respiratory_rate BETWEEN 4 AND 80),
  spo2             SMALLINT    CHECK (spo2 BETWEEN 0 AND 100),

  -- Anthropometrics
  weight_kg        NUMERIC(5,1) CHECK (weight_kg > 0 AND weight_kg < 700),
  height_cm        NUMERIC(5,1) CHECK (height_cm > 0 AND height_cm < 300),
  bmi              NUMERIC(4,1),   -- stored, computed from weight/height by API

  -- Temperature
  temperature_c    NUMERIC(4,1) CHECK (temperature_c BETWEEN 25 AND 45),

  -- Metabolic
  blood_glucose    NUMERIC(5,1) CHECK (blood_glucose > 0),  -- mmol/L

  -- Subjective
  pain_scale       SMALLINT    CHECK (pain_scale BETWEEN 0 AND 10),
  notes            TEXT,

  -- Audit (immutable)
  recorded_by      UUID        NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at — records are immutable for clinic users.
  -- To correct: create a new record; query latest by created_at DESC.
);

-- ── Indexes ─────────────────────────────────────────────────
-- Consultation → vitals (primary query in consultation detail)
CREATE INDEX IF NOT EXISTS idx_vitals_consultation
  ON public.consultation_vitals(consultation_id, created_at DESC);

-- Patient → all vitals over time (trends, patient profile)
CREATE INDEX IF NOT EXISTS idx_vitals_patient
  ON public.consultation_vitals(patient_id, created_at DESC);

-- Clinic-scoped queries (RLS coverage + super admin)
CREATE INDEX IF NOT EXISTS idx_vitals_clinic
  ON public.consultation_vitals(clinic_id, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.consultation_vitals ENABLE ROW LEVEL SECURITY;

-- All clinic members can read vitals scoped to their clinic
CREATE POLICY "vitals_select" ON public.consultation_vitals
  FOR SELECT USING (
    public.is_super_admin()
    OR clinic_id = public.get_clinic_id()
  );

-- Doctors, nurses, admins, and receptionists can record vitals
CREATE POLICY "vitals_insert" ON public.consultation_vitals
  FOR INSERT WITH CHECK (
    public.is_super_admin()
    OR (
      clinic_id = public.get_clinic_id()
      AND public.get_user_role() IN ('admin', 'doctor', 'nurse', 'receptionist')
    )
  );

-- UPDATE restricted to super_admin only (data correction)
CREATE POLICY "vitals_update_superadmin" ON public.consultation_vitals
  FOR UPDATE USING (public.is_super_admin());

-- No DELETE for anyone — vitals are permanent audit records

-- ── Realtime ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.consultation_vitals;

NOTIFY pgrst, 'reload schema';
