-- ════════════════════════════════════════════════════════════════
-- 033_smart_pharmacy.sql — Phase 10A: Smart Pharmacy (zero-hardware)
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE. Existing rows stay valid; every column is nullable and every
-- object is guarded with IF NOT EXISTS. No column is dropped or renamed, no RLS
-- is weakened. Safe to run on a live database.
--
--   A. medications          — optional barcode / manufacturer / brand / ATC
--   B. clinic_medication_inventory — optional shelf/bin location
--   C. medication_cycle_counts     — new table for mobile cycle counting
-- ════════════════════════════════════════════════════════════════

-- ── A. Medication catalog: barcode + metadata (global formulary) ───
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS barcode      TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS brand_name   TEXT,
  ADD COLUMN IF NOT EXISTS atc_code     TEXT;

-- Fast exact lookup by scanned barcode (partial: only rows that carry one).
CREATE INDEX IF NOT EXISTS medications_barcode_idx
  ON public.medications (barcode)
  WHERE barcode IS NOT NULL;

-- ── B. Inventory: physical shelf / bin location ───────────────────
ALTER TABLE public.clinic_medication_inventory
  ADD COLUMN IF NOT EXISTS location_cabinet TEXT,
  ADD COLUMN IF NOT EXISTS location_shelf   TEXT,
  ADD COLUMN IF NOT EXISTS location_row     TEXT,
  ADD COLUMN IF NOT EXISTS location_bin     TEXT;

-- ── C. Mobile cycle counting ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medication_cycle_counts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES public.clinic_medication_inventory(id) ON DELETE CASCADE,
  expected_qty INTEGER NOT NULL,
  counted_qty  INTEGER NOT NULL,
  variance     INTEGER NOT NULL,   -- counted_qty - expected_qty (snapshot)
  notes        TEXT,
  counted_by   UUID REFERENCES public.user_profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cycle_counts_clinic_idx
  ON public.medication_cycle_counts (clinic_id, created_at DESC);

ALTER TABLE public.medication_cycle_counts ENABLE ROW LEVEL SECURITY;

-- Same posture as the other pharmacy tables: clinic-scoped, pharmacist + admin.
-- A cycle count is an immutable stock-audit record — no UPDATE / DELETE.
DROP POLICY IF EXISTS "cycle_counts_select" ON public.medication_cycle_counts;
CREATE POLICY "cycle_counts_select" ON public.medication_cycle_counts FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() IN ('admin','pharmacist'));

DROP POLICY IF EXISTS "cycle_counts_insert" ON public.medication_cycle_counts;
CREATE POLICY "cycle_counts_insert" ON public.medication_cycle_counts FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id()
              AND public.get_user_role() IN ('admin','pharmacist'));

DROP POLICY IF EXISTS "cycle_counts_update" ON public.medication_cycle_counts;
CREATE POLICY "cycle_counts_update" ON public.medication_cycle_counts FOR UPDATE USING (false);

DROP POLICY IF EXISTS "cycle_counts_delete" ON public.medication_cycle_counts;
CREATE POLICY "cycle_counts_delete" ON public.medication_cycle_counts FOR DELETE USING (false);
