-- ════════════════════════════════════════════════════════════════
-- 028 — Laboratory Module (Phase 4)
-- ════════════════════════════════════════════════════════════════
--
-- Normalized lab model:  lab_tests (catalog) → lab_orders → lab_order_items.
--
--   A. Role: add 'lab_technician'
--   B. lab_tests        — per-clinic catalog (price / sample type / range / unit)
--   C. lab_orders       — requisition header + workflow status + review
--   D. lab_order_items  — one row per test, holds the structured result
--   E. Snapshot triggers (patient identity on order, test fields on item)
--   F. RLS (super_admin excluded, soft-delete hiding, hard-delete blocked,
--      lab_technician lab-scoped)
--   G. lab_technician lockout from non-lab medical data
--   H. Audit triggers + soft-delete cascade extension + identity RPC
--   I. Data migration from legacy lab_requests (kept read-only)
--   J. Realtime
--
-- Conventions follow Phase 3 (026/027): every protected table excludes
-- is_super_admin(), hides soft-deleted rows from non-admins, blocks hard
-- DELETE. service_role bypasses RLS and is unaffected. Senegal = UTC+0.

-- ── A. Role: lab_technician ───────────────────────────────────────
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin','admin','doctor','receptionist','nurse','cashier','lab_technician'));

ALTER TABLE public.clinic_invitations DROP CONSTRAINT IF EXISTS clinic_invitations_role_check;
ALTER TABLE public.clinic_invitations
  ADD CONSTRAINT clinic_invitations_role_check
  CHECK (role IN ('admin','doctor','receptionist','nurse','cashier','lab_technician'));

-- ── B. lab_tests (catalog) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_tests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT,
  sample_type       TEXT,                          -- e.g. blood, urine, swab
  unit              TEXT,                          -- e.g. mg/dL, g/L
  normal_range_low  NUMERIC,
  normal_range_high NUMERIC,
  normal_range_text TEXT,                          -- qualitative ref, e.g. "Négatif"
  price             NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'XOF',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INT NOT NULL DEFAULT 0,
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_tests_clinic ON public.lab_tests(clinic_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lab_tests_active ON public.lab_tests(clinic_id, is_active) WHERE deleted_at IS NULL;
CREATE OR REPLACE TRIGGER trg_lab_tests_updated_at
  BEFORE UPDATE ON public.lab_tests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── C. lab_orders (requisition header) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES public.clinics(id)        ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id)       ON DELETE CASCADE,
  consultation_id     UUID          REFERENCES public.consultations(id),
  ordered_by          UUID NOT NULL REFERENCES public.user_profiles(id), -- doctor
  -- Patient identity snapshot so lab_technician (no patients access) can work.
  patient_name        TEXT,
  patient_number      TEXT,
  status              TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN
                        ('ordered','sample_collected','sample_rejected','in_progress','completed','reviewed','cancelled')),
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','emergency')),
  clinical_notes      TEXT,
  sample_collected_at TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES public.user_profiles(id),
  reviewed_at         TIMESTAMPTZ,
  interpretation      TEXT,
  invoice_id          UUID REFERENCES public.invoices(id),               -- set when billed
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_orders_clinic  ON public.lab_orders(clinic_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON public.lab_orders(patient_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lab_orders_status  ON public.lab_orders(clinic_id, status) WHERE deleted_at IS NULL;
CREATE OR REPLACE TRIGGER trg_lab_orders_updated_at
  BEFORE UPDATE ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── D. lab_order_items (per-test result) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES public.clinics(id)     ON DELETE CASCADE,
  lab_order_id      UUID NOT NULL REFERENCES public.lab_orders(id)  ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES public.patients(id)    ON DELETE CASCADE,  -- denormalized for cascade/queries
  lab_test_id       UUID REFERENCES public.lab_tests(id),                               -- nullable: ad-hoc tests allowed
  -- Snapshot of the catalog test at order time (keeps history stable).
  test_name         TEXT NOT NULL,
  unit              TEXT,
  normal_range_low  NUMERIC,
  normal_range_high NUMERIC,
  normal_range_text TEXT,
  price             NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Result
  result_value      TEXT,
  result_numeric    NUMERIC,
  flag              TEXT NOT NULL DEFAULT 'normal' CHECK (flag IN ('normal','abnormal','high','low','critical')),
  result_notes      TEXT,
  resulted_by       UUID REFERENCES public.user_profiles(id),
  resulted_at       TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deletion_reason   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_items_order   ON public.lab_order_items(lab_order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lab_items_patient ON public.lab_order_items(patient_id) WHERE deleted_at IS NULL;
CREATE OR REPLACE TRIGGER trg_lab_order_items_updated_at
  BEFORE UPDATE ON public.lab_order_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── E. Snapshot triggers ──────────────────────────────────────────
-- Fill the patient identity snapshot on a new order from the patients table
-- (authoritative; SECURITY DEFINER so it works regardless of caller RLS).
CREATE OR REPLACE FUNCTION public.set_lab_order_patient_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.patient_name IS NULL OR NEW.patient_number IS NULL THEN
    SELECT full_name, patient_number INTO NEW.patient_name, NEW.patient_number
    FROM public.patients WHERE id = NEW.patient_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lab_order_snapshot ON public.lab_orders;
CREATE TRIGGER trg_lab_order_snapshot BEFORE INSERT ON public.lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_lab_order_patient_snapshot();

-- Fill item snapshot (test name/unit/range/price + patient_id) from the catalog
-- test and parent order when not explicitly provided.
CREATE OR REPLACE FUNCTION public.set_lab_order_item_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic UUID; v_patient UUID;
BEGIN
  SELECT clinic_id, patient_id INTO v_clinic, v_patient FROM public.lab_orders WHERE id = NEW.lab_order_id;
  NEW.clinic_id  := COALESCE(NEW.clinic_id, v_clinic);
  NEW.patient_id := COALESCE(NEW.patient_id, v_patient);
  IF NEW.lab_test_id IS NOT NULL AND (NEW.test_name IS NULL OR NEW.test_name = '') THEN
    SELECT name, unit, normal_range_low, normal_range_high, normal_range_text, price
    INTO   NEW.test_name, NEW.unit, NEW.normal_range_low, NEW.normal_range_high, NEW.normal_range_text, NEW.price
    FROM public.lab_tests WHERE id = NEW.lab_test_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lab_item_snapshot ON public.lab_order_items;
CREATE TRIGGER trg_lab_item_snapshot BEFORE INSERT ON public.lab_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_lab_order_item_snapshot();

-- ── F. RLS for the lab tables ─────────────────────────────────────
ALTER TABLE public.lab_tests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_order_items ENABLE ROW LEVEL SECURITY;

-- lab_tests: all clinic members read (incl. lab_technician); admin manages.
CREATE POLICY "lab_tests_select" ON public.lab_tests FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
CREATE POLICY "lab_tests_insert" ON public.lab_tests FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin');
CREATE POLICY "lab_tests_update" ON public.lab_tests FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin')
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() = 'admin');
CREATE POLICY "lab_tests_delete" ON public.lab_tests FOR DELETE USING (false);

-- lab_orders: clinic members read (incl. lab_technician); doctor/nurse/admin
-- create; results entry incl. lab_technician; review only doctor/admin.
CREATE POLICY "lab_orders_select" ON public.lab_orders FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
CREATE POLICY "lab_orders_insert" ON public.lab_orders FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  );
CREATE POLICY "lab_orders_update" ON public.lab_orders FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse','lab_technician')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse','lab_technician')
  );
CREATE POLICY "lab_orders_delete" ON public.lab_orders FOR DELETE USING (false);
-- NOTE: the 'reviewed' transition (reviewed_by / interpretation) is restricted
-- to doctor/admin in the application + review RPC; RLS allows the broader set
-- to update status/results, while review is gated server-side.

-- lab_order_items
CREATE POLICY "lab_order_items_select" ON public.lab_order_items FOR SELECT
  USING (clinic_id = public.get_clinic_id() AND (deleted_at IS NULL OR public.get_user_role() = 'admin'));
CREATE POLICY "lab_order_items_insert" ON public.lab_order_items FOR INSERT
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse')
  );
CREATE POLICY "lab_order_items_update" ON public.lab_order_items FOR UPDATE
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse','lab_technician')
  )
  WITH CHECK (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() IN ('admin','doctor','nurse','lab_technician')
  );
CREATE POLICY "lab_order_items_delete" ON public.lab_order_items FOR DELETE USING (false);

-- ── G. lab_technician lockout from non-lab medical data ───────────
-- The technician sees patient IDENTITY (via the order snapshot + identity RPC),
-- lab orders and results — nothing else. Re-create the 027 SELECT policies with
-- an explicit lab_technician exclusion.
DROP POLICY IF EXISTS "patients_select" ON public.patients;
CREATE POLICY "patients_select" ON public.patients FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() <> 'lab_technician'
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "consultations_select" ON public.consultations;
CREATE POLICY "consultations_select" ON public.consultations FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() <> 'lab_technician'
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "prescriptions_select" ON public.prescriptions;
CREATE POLICY "prescriptions_select" ON public.prescriptions FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() <> 'lab_technician'
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() <> 'lab_technician'
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

DROP POLICY IF EXISTS "vitals_select" ON public.consultation_vitals;
CREATE POLICY "vitals_select" ON public.consultation_vitals FOR SELECT
  USING (
    clinic_id = public.get_clinic_id()
    AND public.get_user_role() <> 'lab_technician'
    AND (deleted_at IS NULL OR public.get_user_role() = 'admin')
  );

-- ── H1. Audit triggers (reuse audit_row_change from 026) ──────────
DROP TRIGGER IF EXISTS audit_lab_orders ON public.lab_orders;
CREATE TRIGGER audit_lab_orders AFTER UPDATE ON public.lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('lab_order', 'true');
DROP TRIGGER IF EXISTS audit_lab_order_items ON public.lab_order_items;
CREATE TRIGGER audit_lab_order_items AFTER UPDATE ON public.lab_order_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('lab_order_item', 'false');

-- ── H1b. Allow 'lab_order' as a view-logged entity ───────────────
CREATE OR REPLACE FUNCTION public.log_record_view(
  p_entity TEXT, p_id UUID, p_ip TEXT DEFAULT NULL, p_ua TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic UUID;
BEGIN
  v_clinic := public.get_clinic_id();
  IF v_clinic IS NULL THEN RETURN; END IF;
  IF p_entity NOT IN ('patient','appointment','consultation','prescription','invoice','lab_order') THEN
    RAISE EXCEPTION 'Invalid entity_type: %', p_entity USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_events (clinic_id, user_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_clinic, auth.uid(), p_entity, p_id, 'viewed',
    jsonb_strip_nulls(jsonb_build_object('ip_address', p_ip, 'user_agent', p_ua))
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_record_view(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_record_view(TEXT, UUID, TEXT, TEXT) TO authenticated;

-- ── H2. Identity RPC for the lab module (identity-only, no medical data) ──
CREATE OR REPLACE FUNCTION public.get_lab_order_patient_identity(p_order_id UUID)
RETURNS TABLE (full_name TEXT, patient_number TEXT, cni TEXT, date_of_birth DATE, gender TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT pt.full_name, pt.patient_number, pt.cni, pt.date_of_birth, pt.gender
    FROM public.lab_orders o
    JOIN public.patients pt ON pt.id = o.patient_id
    WHERE o.id = p_order_id AND o.clinic_id = public.get_clinic_id();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_lab_order_patient_identity(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_lab_order_patient_identity(UUID) TO authenticated;

-- ── H3. Extend soft-delete cascade + add 'lab_order' entity ───────
CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_entity TEXT, p_id UUID, p_reason TEXT DEFAULT NULL, p_ip TEXT DEFAULT NULL, p_ua TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic UUID := public.get_clinic_id();
  v_tag    TEXT := 'cascade:patient:' || p_id;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only clinic admins may delete records' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.audit_ip', COALESCE(p_ip, ''), true);
  PERFORM set_config('app.audit_ua', COALESCE(p_ua, ''), true);

  IF p_entity = 'patient' THEN
    UPDATE public.patients SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.appointments       SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.consultations      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.prescriptions      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.invoices           SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_requests       SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.consultation_vitals SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_orders         SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_order_items    SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = v_tag WHERE patient_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
  ELSIF p_entity = 'lab_order' THEN
    UPDATE public.lab_orders      SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = p_reason
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
    UPDATE public.lab_order_items SET deleted_at = NOW(), deleted_by = auth.uid(), deletion_reason = 'cascade:lab_order:' || p_id
      WHERE lab_order_id = p_id AND clinic_id = v_clinic AND deleted_at IS NULL;
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
DECLARE
  v_clinic UUID := public.get_clinic_id();
  v_tag    TEXT := 'cascade:patient:' || p_id;
BEGIN
  IF v_clinic IS NULL OR public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only clinic admins may restore records' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.audit_ip', COALESCE(p_ip, ''), true);
  PERFORM set_config('app.audit_ua', COALESCE(p_ua, ''), true);

  IF p_entity = 'patient' THEN
    UPDATE public.patients SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
    UPDATE public.appointments        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.consultations       SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.prescriptions       SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.invoices            SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_requests        SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.consultation_vitals SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_orders          SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
    UPDATE public.lab_order_items     SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE patient_id = p_id AND clinic_id = v_clinic AND deletion_reason = v_tag;
  ELSIF p_entity = 'lab_order' THEN
    UPDATE public.lab_orders      SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE id = p_id AND clinic_id = v_clinic AND deleted_at IS NOT NULL;
    UPDATE public.lab_order_items SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL
      WHERE lab_order_id = p_id AND clinic_id = v_clinic AND deletion_reason = 'cascade:lab_order:' || p_id;
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

-- ── I. Data migration: legacy lab_requests → new model ────────────
-- Each lab_request becomes one order + one item. Status remapped. Idempotent
-- via the source id mapping (skip rows already migrated).
INSERT INTO public.lab_orders (
  id, clinic_id, patient_id, consultation_id, ordered_by, patient_name, patient_number,
  status, priority, clinical_notes, completed_at, deleted_at, deleted_by, deletion_reason, created_at
)
SELECT
  lr.id, lr.clinic_id, lr.patient_id, lr.consultation_id, lr.doctor_id,
  p.full_name, p.patient_number,
  CASE lr.status
    WHEN 'collected'  THEN 'sample_collected'
    WHEN 'processing' THEN 'in_progress'
    WHEN 'resulted'   THEN 'completed'
    ELSE lr.status          -- ordered / cancelled
  END,
  lr.priority, lr.clinical_notes,
  lr.resulted_at,
  lr.deleted_at, lr.deleted_by, lr.deletion_reason, lr.ordered_at
FROM public.lab_requests lr
LEFT JOIN public.patients p ON p.id = lr.patient_id
WHERE NOT EXISTS (SELECT 1 FROM public.lab_orders o WHERE o.id = lr.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lab_order_items (
  clinic_id, lab_order_id, patient_id, test_name, result_value, result_notes,
  resulted_at, deleted_at, deleted_by, deletion_reason, created_at
)
SELECT
  lr.clinic_id, lr.id, lr.patient_id, lr.test_name,
  lr.result_notes, lr.result_notes, lr.resulted_at,
  lr.deleted_at, lr.deleted_by, lr.deletion_reason, lr.ordered_at
FROM public.lab_requests lr
WHERE EXISTS (SELECT 1 FROM public.lab_orders o WHERE o.id = lr.id)
  AND NOT EXISTS (SELECT 1 FROM public.lab_order_items i WHERE i.lab_order_id = lr.id);

-- Make legacy lab_requests READ-ONLY (kept for historical reference).
DROP POLICY IF EXISTS "lab_requests_insert" ON public.lab_requests;
CREATE POLICY "lab_requests_insert" ON public.lab_requests FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "lab_requests_update" ON public.lab_requests;
DROP POLICY IF EXISTS "lab_update"          ON public.lab_requests;
CREATE POLICY "lab_requests_update" ON public.lab_requests FOR UPDATE USING (false);

-- ── J. Realtime ───────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_order_items;

NOTIFY pgrst, 'reload schema';
