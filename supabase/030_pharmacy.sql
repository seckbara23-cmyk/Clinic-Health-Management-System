-- ════════════════════════════════════════════════════════════════
-- 030 — Pharmacy Inventory + Dispensing (Phase 5B)
-- ════════════════════════════════════════════════════════════════
--
--   A. Role: add 'pharmacist'
--   B. clinic_medication_inventory  — per-clinic stock + pricing for a drug
--   C. medication_batches           — FEFO lots (authoritative for stock)
--   D. stock_movements              — immutable movement ledger
--   E. medication_dispensings       — per-event dispensing records
--   F. Stock recompute trigger (stock_quantity = sum batch quantity_remaining)
--   G. RLS for the new tables + pharmacist lockout from non-pharmacy data
--   H. RPCs: receive_stock / adjust_stock / dispense_medication /
--      generate_dispensing_invoice (+ recompute_prescription_status)
--   I. Soft-delete cascade + audit + prescriptions 'partially_dispensed'
--
-- Conventions (Phase 3/4): every protected table excludes is_super_admin(),
-- hides soft-deleted from non-admins, blocks hard DELETE. Stock changes flow
-- only through SECURITY DEFINER RPCs so the ledger + batch totals stay
-- consistent. service_role bypasses RLS. Senegal = UTC+0.

-- ── A. Role: pharmacist ───────────────────────────────────────────
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin','admin','doctor','receptionist','nurse','cashier','lab_technician','pharmacist'));

ALTER TABLE public.clinic_invitations DROP CONSTRAINT IF EXISTS clinic_invitations_role_check;
ALTER TABLE public.clinic_invitations
  ADD CONSTRAINT clinic_invitations_role_check
  CHECK (role IN ('admin','doctor','receptionist','nurse','cashier','lab_technician','pharmacist'));

-- ── L (early). prescriptions: add 'partially_dispensed' status ────
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_status_check;
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_status_check
  CHECK (status IN ('active','partially_dispensed','dispensed','expired','cancelled'));

-- ── B. clinic_medication_inventory ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinic_medication_inventory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES public.clinics(id)     ON DELETE CASCADE,
  medication_id   UUID NOT NULL REFERENCES public.medications(id),
  stock_quantity  INT NOT NULL DEFAULT 0,        -- maintained = sum(batch quantity_remaining)
  reorder_level   INT NOT NULL DEFAULT 0,
  selling_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  supplier        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, medication_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_clinic   ON public.clinic_medication_inventory(clinic_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON public.clinic_medication_inventory(clinic_id) WHERE deleted_at IS NULL AND is_active;
CREATE OR REPLACE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.clinic_medication_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── C. medication_batches (FEFO, authoritative for stock) ─────────
CREATE TABLE IF NOT EXISTS public.medication_batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          UUID NOT NULL REFERENCES public.clinics(id)                       ON DELETE CASCADE,
  inventory_id       UUID NOT NULL REFERENCES public.clinic_medication_inventory(id)   ON DELETE CASCADE,
  batch_number       TEXT,
  expiry_date        DATE,
  quantity_received  INT NOT NULL DEFAULT 0,
  quantity_remaining INT NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0),
  purchase_price     NUMERIC(12,2),
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_inventory ON public.medication_batches(inventory_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_batches_expiry    ON public.medication_batches(clinic_id, expiry_date) WHERE deleted_at IS NULL AND quantity_remaining > 0;
CREATE OR REPLACE TRIGGER trg_batches_updated_at
  BEFORE UPDATE ON public.medication_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── D. stock_movements (immutable ledger) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  inventory_id    UUID REFERENCES public.clinic_medication_inventory(id) ON DELETE SET NULL,
  batch_id        UUID REFERENCES public.medication_batches(id) ON DELETE SET NULL,
  medication_id   UUID REFERENCES public.medications(id),
  movement_type   TEXT NOT NULL CHECK (movement_type IN
                    ('received','dispensed','adjustment','expired','damaged','returned')),
  quantity_change INT NOT NULL,                 -- signed: + inflow, - outflow
  reference_type  TEXT,                         -- e.g. 'dispensing'
  reference_id    UUID,
  notes           TEXT,
  performed_by    UUID REFERENCES public.user_profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movements_clinic    ON public.stock_movements(clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_inventory ON public.stock_movements(inventory_id);

-- ── E. medication_dispensings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medication_dispensings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  prescription_id         UUID NOT NULL REFERENCES public.prescriptions(id)  ON DELETE CASCADE,
  patient_id              UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  prescription_line_index INT NOT NULL,
  medication_id           UUID REFERENCES public.medications(id),
  inventory_id            UUID REFERENCES public.clinic_medication_inventory(id),
  medication_name         TEXT NOT NULL,                     -- snapshot
  quantity_prescribed     INT NOT NULL DEFAULT 0,
  quantity_dispensed      INT NOT NULL DEFAULT 0,
  unit_selling_price      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- snapshot
  status                  TEXT NOT NULL CHECK (status IN ('dispensed','partial','unavailable')),
  substitution_notes      TEXT,
  unavailable_reason      TEXT,
  dispensed_by            UUID REFERENCES public.user_profiles(id),
  dispensed_at            TIMESTAMPTZ,
  invoice_id              UUID REFERENCES public.invoices(id),
  deleted_at              TIMESTAMPTZ,
  deleted_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispensings_clinic       ON public.medication_dispensings(clinic_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dispensings_prescription ON public.medication_dispensings(prescription_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dispensings_patient      ON public.medication_dispensings(patient_id) WHERE deleted_at IS NULL;
CREATE OR REPLACE TRIGGER trg_dispensings_updated_at
  BEFORE UPDATE ON public.medication_dispensings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── F. Stock recompute trigger (batches are authoritative) ────────
CREATE OR REPLACE FUNCTION public.recompute_inventory_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inventory UUID := COALESCE(NEW.inventory_id, OLD.inventory_id);
BEGIN
  UPDATE public.clinic_medication_inventory i
  SET stock_quantity = COALESCE((
        SELECT SUM(b.quantity_remaining) FROM public.medication_batches b
        WHERE b.inventory_id = v_inventory AND b.deleted_at IS NULL
      ), 0),
      updated_at = NOW()
  WHERE i.id = v_inventory;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_recompute_stock ON public.medication_batches;
CREATE TRIGGER trg_recompute_stock
  AFTER INSERT OR UPDATE OF quantity_remaining, deleted_at OR DELETE ON public.medication_batches
  FOR EACH ROW EXECUTE FUNCTION public.recompute_inventory_stock();

-- ── G. RLS for the new tables ─────────────────────────────────────
ALTER TABLE public.clinic_medication_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_batches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_dispensings      ENABLE ROW LEVEL SECURITY;

-- Inventory: read by pharmacy/clinical roles; managed by pharmacist + admin.
CREATE POLICY "inventory_select" ON public.clinic_medication_inventory FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() IN ('admin','doctor','pharmacist')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
CREATE POLICY "inventory_insert" ON public.clinic_medication_inventory FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','pharmacist'));
CREATE POLICY "inventory_update" ON public.clinic_medication_inventory FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','pharmacist'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','pharmacist'));
CREATE POLICY "inventory_delete" ON public.clinic_medication_inventory FOR DELETE USING (false);

-- Batches: read only; all writes via RPCs (definer).
CREATE POLICY "batches_select" ON public.medication_batches FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() IN ('admin','doctor','pharmacist')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
CREATE POLICY "batches_delete" ON public.medication_batches FOR DELETE USING (false);

-- Stock movements: read-only ledger.
CREATE POLICY "movements_select" ON public.stock_movements FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','doctor','pharmacist'));
CREATE POLICY "movements_delete" ON public.stock_movements FOR DELETE USING (false);

-- Dispensings: read by pharmacy/clinical roles; writes via RPC only.
CREATE POLICY "dispensings_select" ON public.medication_dispensings FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() IN ('admin','doctor','pharmacist')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
CREATE POLICY "dispensings_delete" ON public.medication_dispensings FOR DELETE USING (false);

-- ── H. Pharmacist lockout from non-pharmacy data ──────────────────
-- Pharmacist may see patient identity + allergies (patients_select keeps them),
-- prescriptions and medications. NOT consultation notes, vitals, lab results,
-- invoices, or SMS. (audit_events is already admin-only.)
DROP POLICY IF EXISTS "consultations_select" ON public.consultations;
CREATE POLICY "consultations_select" ON public.consultations FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() NOT IN ('lab_technician','pharmacist')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));

DROP POLICY IF EXISTS "vitals_select" ON public.consultation_vitals;
CREATE POLICY "vitals_select" ON public.consultation_vitals FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() NOT IN ('lab_technician','pharmacist')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() NOT IN ('lab_technician','pharmacist')
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));

DROP POLICY IF EXISTS "lab_orders_select" ON public.lab_orders;
CREATE POLICY "lab_orders_select" ON public.lab_orders FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() <> 'pharmacist'
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));

DROP POLICY IF EXISTS "lab_order_items_select" ON public.lab_order_items;
CREATE POLICY "lab_order_items_select" ON public.lab_order_items FOR SELECT
  USING (clinic_id = public.get_clinic_id()
         AND public.get_user_role() <> 'pharmacist'
         AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));

DROP POLICY IF EXISTS "sms_messages_select" ON public.sms_messages;
CREATE POLICY "sms_messages_select" ON public.sms_messages FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() <> 'pharmacist');

DROP POLICY IF EXISTS "sms_delivery_events_select" ON public.sms_delivery_events;
CREATE POLICY "sms_delivery_events_select" ON public.sms_delivery_events FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() <> 'pharmacist');

-- ── I1. Internal helper: write a stock movement ───────────────────
CREATE OR REPLACE FUNCTION public.write_stock_movement(
  p_clinic UUID, p_inventory UUID, p_batch UUID, p_medication UUID,
  p_type TEXT, p_qty INT, p_ref_type TEXT, p_ref UUID, p_notes TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.stock_movements
    (clinic_id, inventory_id, batch_id, medication_id, movement_type, quantity_change,
     reference_type, reference_id, notes, performed_by)
  VALUES (p_clinic, p_inventory, p_batch, p_medication, p_type, p_qty, p_ref_type, p_ref, p_notes, auth.uid());
END;
$$;

-- ── I2. receive_stock ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_stock(
  p_inventory_id UUID, p_batch_number TEXT, p_expiry_date DATE,
  p_quantity INT, p_purchase_price NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic UUID := public.get_clinic_id(); v_med UUID; v_batch UUID;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() NOT IN ('admin','pharmacist') THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Quantité invalide' USING ERRCODE = 'P0001'; END IF;

  SELECT medication_id INTO v_med FROM public.clinic_medication_inventory
  WHERE id = p_inventory_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  IF v_med IS NULL THEN RAISE EXCEPTION 'Article introuvable' USING ERRCODE = 'P0003'; END IF;

  INSERT INTO public.medication_batches
    (clinic_id, inventory_id, batch_number, expiry_date, quantity_received, quantity_remaining, purchase_price)
  VALUES (v_clinic, p_inventory_id, p_batch_number, p_expiry_date, p_quantity, p_quantity, p_purchase_price)
  RETURNING id INTO v_batch;

  PERFORM public.write_stock_movement(v_clinic, p_inventory_id, v_batch, v_med, 'received', p_quantity, 'batch', v_batch, p_batch_number);
  RETURN v_batch;
END;
$$;

-- ── I3. adjust_stock (adjustment / expired / damaged / returned) ──
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_batch_id UUID, p_movement_type TEXT, p_quantity_change INT, p_notes TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic UUID := public.get_clinic_id(); v_batch medication_batches%ROWTYPE; v_med UUID; v_new INT;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() NOT IN ('admin','pharmacist') THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  IF p_movement_type NOT IN ('adjustment','expired','damaged','returned') THEN
    RAISE EXCEPTION 'Type de mouvement invalide' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_batch FROM public.medication_batches
  WHERE id = p_batch_id AND clinic_id = v_clinic AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable' USING ERRCODE = 'P0003'; END IF;

  v_new := v_batch.quantity_remaining + p_quantity_change;
  IF v_new < 0 THEN RAISE EXCEPTION 'Stock insuffisant pour cet ajustement' USING ERRCODE = 'P0004'; END IF;

  UPDATE public.medication_batches SET quantity_remaining = v_new WHERE id = p_batch_id;
  SELECT medication_id INTO v_med FROM public.clinic_medication_inventory WHERE id = v_batch.inventory_id;
  PERFORM public.write_stock_movement(v_clinic, v_batch.inventory_id, p_batch_id, v_med, p_movement_type, p_quantity_change, 'batch', p_batch_id, p_notes);
END;
$$;

-- ── I4. recompute_prescription_status (helper) ────────────────────
CREATE OR REPLACE FUNCTION public.recompute_prescription_status(p_prescription_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT; v_resolved INT; v_touched INT;
BEGIN
  SELECT COALESCE(jsonb_array_length(medications), 0) INTO v_n
  FROM public.prescriptions WHERE id = p_prescription_id;
  IF v_n = 0 THEN RETURN; END IF;

  WITH agg AS (
    SELECT prescription_line_index AS li,
           bool_or(status = 'unavailable')            AS any_unavail,
           SUM(quantity_dispensed)                    AS disp,
           MAX(quantity_prescribed)                   AS presc
    FROM public.medication_dispensings
    WHERE prescription_id = p_prescription_id AND deleted_at IS NULL
    GROUP BY prescription_line_index
  )
  SELECT COUNT(*) FILTER (WHERE any_unavail OR disp >= presc), COUNT(*)
  INTO v_resolved, v_touched FROM agg;

  UPDATE public.prescriptions
  SET status = CASE WHEN v_resolved >= v_n THEN 'dispensed'
                    WHEN v_touched > 0     THEN 'partially_dispensed'
                    ELSE status END,
      updated_at = NOW()
  WHERE id = p_prescription_id AND status NOT IN ('cancelled','expired');
END;
$$;

-- ── I5. dispense_medication (FEFO, partial, unavailable) ──────────
CREATE OR REPLACE FUNCTION public.dispense_medication(
  p_prescription_id UUID, p_line_index INT, p_medication_id UUID, p_inventory_id UUID,
  p_medication_name TEXT, p_quantity_prescribed INT, p_quantity_dispensed INT,
  p_substitution_notes TEXT DEFAULT NULL, p_unavailable_reason TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic UUID := public.get_clinic_id();
  v_patient UUID; v_price NUMERIC := 0; v_status TEXT; v_dispensing UUID;
  v_remaining INT; v_available INT; v_deduct INT; b RECORD;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() NOT IN ('admin','pharmacist') THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;

  SELECT patient_id INTO v_patient FROM public.prescriptions
  WHERE id = p_prescription_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Ordonnance introuvable' USING ERRCODE = 'P0003'; END IF;

  -- Unavailable: record only, no stock movement.
  IF COALESCE(p_quantity_dispensed, 0) <= 0 THEN
    v_status := 'unavailable';
  ELSE
    v_status := CASE WHEN p_quantity_dispensed >= p_quantity_prescribed THEN 'dispensed' ELSE 'partial' END;
    IF p_inventory_id IS NOT NULL THEN
      -- Lock the inventory line, then verify sufficient stock before deducting.
      SELECT selling_price INTO v_price FROM public.clinic_medication_inventory
      WHERE id = p_inventory_id AND clinic_id = v_clinic AND deleted_at IS NULL FOR UPDATE;
      IF v_price IS NULL THEN RAISE EXCEPTION 'Article introuvable' USING ERRCODE = 'P0003'; END IF;
      SELECT COALESCE(SUM(quantity_remaining), 0) INTO v_available
      FROM public.medication_batches
      WHERE inventory_id = p_inventory_id AND deleted_at IS NULL;
      IF v_available < p_quantity_dispensed THEN
        RAISE EXCEPTION 'Stock insuffisant (disponible: %)', v_available USING ERRCODE = 'P0004';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.medication_dispensings
    (clinic_id, prescription_id, patient_id, prescription_line_index, medication_id, inventory_id,
     medication_name, quantity_prescribed, quantity_dispensed, unit_selling_price, status,
     substitution_notes, unavailable_reason, dispensed_by, dispensed_at)
  VALUES (v_clinic, p_prescription_id, v_patient, p_line_index, p_medication_id, p_inventory_id,
     p_medication_name, COALESCE(p_quantity_prescribed,0), COALESCE(p_quantity_dispensed,0), COALESCE(v_price,0), v_status,
     p_substitution_notes, p_unavailable_reason, auth.uid(), NOW())
  RETURNING id INTO v_dispensing;

  -- FEFO deduction across batches (earliest expiry first).
  IF v_status <> 'unavailable' AND p_inventory_id IS NOT NULL THEN
    v_remaining := p_quantity_dispensed;
    FOR b IN
      SELECT id, quantity_remaining FROM public.medication_batches
      WHERE inventory_id = p_inventory_id AND deleted_at IS NULL AND quantity_remaining > 0
      ORDER BY expiry_date NULLS LAST, created_at FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_deduct := LEAST(v_remaining, b.quantity_remaining);
      UPDATE public.medication_batches SET quantity_remaining = quantity_remaining - v_deduct WHERE id = b.id;
      PERFORM public.write_stock_movement(v_clinic, p_inventory_id, b.id, p_medication_id, 'dispensed', -v_deduct, 'dispensing', v_dispensing, NULL);
      v_remaining := v_remaining - v_deduct;
    END LOOP;
  END IF;

  PERFORM public.recompute_prescription_status(p_prescription_id);
  RETURN v_dispensing;
END;
$$;

-- ── I6. generate_dispensing_invoice (RPC-only billing) ────────────
-- Builds a draft invoice from a prescription's dispensed lines, prefilling the
-- payer split from the patient's insurance. Pharmacist may call without any
-- invoices RLS access. Guards against double-billing.
CREATE OR REPLACE FUNCTION public.generate_dispensing_invoice(p_prescription_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic UUID := public.get_clinic_id();
  v_patient UUID; v_items JSONB; v_subtotal NUMERIC := 0;
  v_payer_type TEXT; v_provider TEXT; v_coverage NUMERIC := 0; v_share NUMERIC := 0;
  v_invoice UUID;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() NOT IN ('admin','pharmacist','cashier','receptionist') THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;

  SELECT patient_id INTO v_patient FROM public.prescriptions
  WHERE id = p_prescription_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Ordonnance introuvable' USING ERRCODE = 'P0003'; END IF;

  -- Aggregate dispensed (billable) lines not yet invoiced.
  SELECT jsonb_agg(jsonb_build_object(
           'description', medication_name, 'quantity', quantity_dispensed,
           'unit_price', unit_selling_price, 'total', quantity_dispensed * unit_selling_price)),
         COALESCE(SUM(quantity_dispensed * unit_selling_price), 0)
  INTO v_items, v_subtotal
  FROM public.medication_dispensings
  WHERE prescription_id = p_prescription_id AND clinic_id = v_clinic
    AND deleted_at IS NULL AND status IN ('dispensed','partial')
    AND quantity_dispensed > 0 AND invoice_id IS NULL;

  IF v_items IS NULL THEN RAISE EXCEPTION 'Rien à facturer' USING ERRCODE = 'P0005'; END IF;

  SELECT insurance_payer_type, insurance_provider, COALESCE(insurance_coverage_percent,0)
  INTO v_payer_type, v_provider, v_coverage FROM public.patients WHERE id = v_patient;
  IF v_payer_type IS NOT NULL THEN
    v_share := LEAST(ROUND(v_subtotal * v_coverage / 100), v_subtotal);
  END IF;

  INSERT INTO public.invoices
    (clinic_id, patient_id, line_items, subtotal, tax_amount, discount_amount, total_amount,
     amount_paid, insurance_share, payer_type, payer_name, currency, status, created_by)
  VALUES (v_clinic, v_patient, v_items, v_subtotal, 0, 0, v_subtotal,
     0, v_share, CASE WHEN v_share > 0 THEN v_payer_type END, CASE WHEN v_share > 0 THEN v_provider END,
     'XOF', 'draft', auth.uid())
  RETURNING id INTO v_invoice;

  UPDATE public.medication_dispensings SET invoice_id = v_invoice
  WHERE prescription_id = p_prescription_id AND clinic_id = v_clinic
    AND deleted_at IS NULL AND status IN ('dispensed','partial') AND invoice_id IS NULL;

  RETURN v_invoice;
END;
$$;

-- Grants: clinic users call via PostgREST; functions self-check role/clinic.
REVOKE EXECUTE ON FUNCTION public.receive_stock(UUID, TEXT, DATE, INT, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.receive_stock(UUID, TEXT, DATE, INT, NUMERIC) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.adjust_stock(UUID, TEXT, INT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.adjust_stock(UUID, TEXT, INT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dispense_medication(UUID, INT, UUID, UUID, TEXT, INT, INT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.dispense_medication(UUID, INT, UUID, UUID, TEXT, INT, INT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_dispensing_invoice(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_dispensing_invoice(UUID) TO authenticated;

-- ── audit + soft-delete cascade for dispensings ──────────────────
DROP TRIGGER IF EXISTS audit_dispensings ON public.medication_dispensings;
CREATE TRIGGER audit_dispensings AFTER UPDATE ON public.medication_dispensings
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('medication_dispensing', 'false');

-- Extend the patient soft-delete cascade to dispensings (definer; bypasses RLS).
CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_entity TEXT, p_id UUID, p_reason TEXT DEFAULT NULL, p_ip TEXT DEFAULT NULL, p_ua TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic UUID := public.get_clinic_id(); v_tag TEXT := 'cascade:patient:' || p_id;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only clinic admins may delete records' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.audit_ip', COALESCE(p_ip, ''), true);
  PERFORM set_config('app.audit_ua', COALESCE(p_ua, ''), true);

  IF p_entity = 'patient' THEN
    UPDATE public.patients SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.appointments        SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.consultations       SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.prescriptions       SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.invoices            SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_requests        SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.consultation_vitals SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_orders          SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_order_items     SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.medication_dispensings SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'lab_order' THEN
    UPDATE public.lab_orders      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_order_items SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = 'cascade:lab_order:' || p_id WHERE lab_order_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'appointment' THEN
    UPDATE public.appointments  SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'consultation' THEN
    UPDATE public.consultations SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'prescription' THEN
    UPDATE public.prescriptions SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'invoice' THEN
    UPDATE public.invoices      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSE
    RAISE EXCEPTION 'Invalid entity: %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_record(
  p_entity TEXT, p_id UUID, p_ip TEXT DEFAULT NULL, p_ua TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic UUID := public.get_clinic_id(); v_tag TEXT := 'cascade:patient:' || p_id;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only clinic admins may restore records' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.audit_ip', COALESCE(p_ip, ''), true);
  PERFORM set_config('app.audit_ua', COALESCE(p_ua, ''), true);

  IF p_entity = 'patient' THEN
    UPDATE public.patients SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
    UPDATE public.appointments        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.consultations       SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.prescriptions       SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.invoices            SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_requests        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.consultation_vitals SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_orders          SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_order_items     SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.medication_dispensings SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
  ELSIF p_entity = 'lab_order' THEN
    UPDATE public.lab_orders      SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
    UPDATE public.lab_order_items SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE lab_order_id = p_id AND clinic_id = v_clinic AND deletion_reason = 'cascade:lab_order:' || p_id;
  ELSIF p_entity = 'appointment' THEN
    UPDATE public.appointments  SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSIF p_entity = 'consultation' THEN
    UPDATE public.consultations SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSIF p_entity = 'prescription' THEN
    UPDATE public.prescriptions SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSIF p_entity = 'invoice' THEN
    UPDATE public.invoices      SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
  ELSE
    RAISE EXCEPTION 'Invalid entity: %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ── Realtime ──────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.clinic_medication_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE public.medication_dispensings;

NOTIFY pgrst, 'reload schema';
