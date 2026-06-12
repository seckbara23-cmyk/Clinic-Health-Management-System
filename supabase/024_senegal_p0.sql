-- ════════════════════════════════════════════════════════════════
-- 024 — Senegal P0 market-readiness fields
-- ════════════════════════════════════════════════════════════════
--
-- A. patients  — CNI (carte nationale d'identité) + insurance/mutuelle
-- B. clinics   — NINEA + RC (registre du commerce) business registration
-- C. invoices  — third-party payer split (insurance share vs patient share)
--
-- All columns are nullable or defaulted so existing rows remain valid.
-- No RLS changes required: every policy is row-scoped on clinic_id and
-- column additions are automatically covered by the existing policies.

-- ── A. patients ───────────────────────────────────────────────

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS cni                        TEXT,
  ADD COLUMN IF NOT EXISTS insurance_payer_type       TEXT
    CHECK (insurance_payer_type IN ('ipm','mutuelle','cnss','ipres','private','other')),
  ADD COLUMN IF NOT EXISTS insurance_provider         TEXT,
  ADD COLUMN IF NOT EXISTS insurance_policy_number    TEXT,
  ADD COLUMN IF NOT EXISTS insurance_coverage_percent NUMERIC(5,2)
    CHECK (insurance_coverage_percent >= 0 AND insurance_coverage_percent <= 100);

-- One CNI maps to at most one patient per clinic (NULLs exempt so
-- existing rows and patients without a CNI are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_cni_unique
  ON public.patients (clinic_id, cni)
  WHERE cni IS NOT NULL;

-- ── B. clinics ────────────────────────────────────────────────

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS ninea     TEXT,
  ADD COLUMN IF NOT EXISTS rc_number TEXT;

-- ── C. invoices — third-party payer split ─────────────────────
--
-- insurance_share: portion of total_amount billed to the third-party
--   payer (IPM / mutuelle / CNSS / IPRES / private insurer).
-- patient_share: derived, always total_amount - insurance_share, kept
--   as a stored generated column so it can never drift.
-- payer_type / payer_name: snapshot of the payer at invoice time
--   (copied from the patient record, but stored on the invoice so the
--   document stays correct if the patient later changes mutuelle).
--
-- Payment semantics are unchanged: amount_paid keeps tracking ALL money
-- received (patient + payer reimbursement) and record_manual_payment
-- still marks the invoice paid when amount_paid reaches total_amount.
-- Existing invoices get insurance_share = 0 → patient_share = total.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS insurance_share NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (insurance_share >= 0),
  ADD COLUMN IF NOT EXISTS payer_type TEXT
    CHECK (payer_type IN ('ipm','mutuelle','cnss','ipres','private','other')),
  ADD COLUMN IF NOT EXISTS payer_name TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS patient_share NUMERIC(12,2)
    GENERATED ALWAYS AS (total_amount - insurance_share) STORED;

-- The payer can never owe more than the invoice total.
-- NOT VALID: enforced on new/updated rows only, so the migration can
-- never fail on legacy rows regardless of their totals.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_insurance_share_lte_total;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_insurance_share_lte_total
  CHECK (insurance_share <= total_amount) NOT VALID;

NOTIFY pgrst, 'reload schema';
