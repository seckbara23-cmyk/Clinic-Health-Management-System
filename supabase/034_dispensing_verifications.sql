-- ════════════════════════════════════════════════════════════════
-- 034_dispensing_verifications.sql — Phase 10B: Smart Dispensing audit
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE. Adds an APPEND-ONLY audit trail of barcode verifications
-- performed during dispensing. It does NOT touch the existing dispensing RPC,
-- the medication_dispensings table, stock_movements, or any RLS on them — the
-- existing audit stays exactly as-is. No column dropped/renamed, no policy
-- weakened. Safe to run on a live database.

CREATE TABLE IF NOT EXISTS public.dispensing_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- Nullable: a verification can be recorded even if the dispense itself was
  -- not saved (e.g. wrong medication caught before dispensing).
  dispensing_id       UUID REFERENCES public.medication_dispensings(id) ON DELETE SET NULL,
  prescription_id     UUID REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  line_index          INTEGER,
  medication_name     TEXT,
  scanned_name        TEXT,
  verified            BOOLEAN NOT NULL,
  -- 'camera' | 'manual' | 'none'. USB / Bluetooth wedge scanners type into the
  -- manual input, so they are recorded as 'manual' (same code path).
  verification_method TEXT NOT NULL DEFAULT 'none',
  mismatches          TEXT[] NOT NULL DEFAULT '{}',
  verified_by         UUID REFERENCES public.user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dispensing_verifications_clinic_idx
  ON public.dispensing_verifications (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dispensing_verifications_dispensing_idx
  ON public.dispensing_verifications (dispensing_id);

ALTER TABLE public.dispensing_verifications ENABLE ROW LEVEL SECURITY;

-- Same posture as the pharmacy tables: clinic-scoped, pharmacist + admin.
-- Immutable audit — insert + select only, never update/delete.
DROP POLICY IF EXISTS "disp_verif_select" ON public.dispensing_verifications;
CREATE POLICY "disp_verif_select" ON public.dispensing_verifications FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() IN ('admin','pharmacist'));

DROP POLICY IF EXISTS "disp_verif_insert" ON public.dispensing_verifications;
CREATE POLICY "disp_verif_insert" ON public.dispensing_verifications FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id()
              AND public.get_user_role() IN ('admin','pharmacist'));

DROP POLICY IF EXISTS "disp_verif_update" ON public.dispensing_verifications;
CREATE POLICY "disp_verif_update" ON public.dispensing_verifications FOR UPDATE USING (false);

DROP POLICY IF EXISTS "disp_verif_delete" ON public.dispensing_verifications;
CREATE POLICY "disp_verif_delete" ON public.dispensing_verifications FOR DELETE USING (false);
