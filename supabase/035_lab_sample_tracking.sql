-- ════════════════════════════════════════════════════════════════
-- 035_lab_sample_tracking.sql — Phase 11: Laboratory Intelligence
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE sample-tracking fields on lab_orders. Every column is nullable
-- and guarded with IF NOT EXISTS; no column dropped/renamed, no RLS touched,
-- nothing destructive. Existing orders stay valid. The lab status enum, the
-- existing timestamps (sample_collected_at / completed_at / reviewed_at /
-- reviewed_by), and all lab RPCs/policies are untouched.
--
-- These enable barcode sample tracking and the guided lab workspace:
--   sample_id            — human-readable / lab-assigned sample identifier
--   sample_barcode       — scannable code on the physical sample
--   collected_by         — who collected the sample
--   received_at/by       — sample intake at the lab bench
--   processing_started_at— when analysis began

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS sample_id             TEXT,
  ADD COLUMN IF NOT EXISTS sample_barcode        TEXT,
  ADD COLUMN IF NOT EXISTS collected_by          UUID REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS received_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by           UUID REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Fast lookup when a technician scans a sample barcode (partial: only rows
-- that carry one). Clinic scoping is still enforced by the existing RLS.
CREATE INDEX IF NOT EXISTS lab_orders_sample_barcode_idx
  ON public.lab_orders (sample_barcode)
  WHERE sample_barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS lab_orders_sample_id_idx
  ON public.lab_orders (sample_id)
  WHERE sample_id IS NOT NULL;
