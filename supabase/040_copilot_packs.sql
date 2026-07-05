-- ════════════════════════════════════════════════════════════════
-- 040_copilot_packs.sql — Phase 14.2.4: Clinical Copilot Pack Registry
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Safe on a live database.
--
-- DESIGN (frozen Phase 14.2 architecture, §7 / §17.2):
--   • The Copilot Pack CATALOG is a controlled CODE registry
--     (src/lib/copilot-packs/registry.ts) — capabilities are declared in code,
--     versioned, i18n'd, extended by appending an entry. It is deliberately NOT
--     a database table: there is no packs lookup table and nothing FKs to one.
--   • The ONLY thing that persists is a clinic's INSTALLATION record — metadata,
--     no capabilities, no workflow. `pack_id` is TEXT that references the code
--     registry by id (NOT a foreign key), so this table has exactly ONE foreign
--     key (→ clinics). A single FK + surrogate PK cannot be read as a junction,
--     so this migration CANNOT introduce PostgREST relationship ambiguity — the
--     permanent rule from the P0 incident.
--
-- Touches NO existing table, column, FK, RPC or policy. Nothing writes this table
-- yet (marketplace/governance is a later phase); the read hook is tolerant, so
-- the app is byte-identical before and after this runs.

CREATE TABLE IF NOT EXISTS public.copilot_pack_installations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),          -- surrogate PK (NOT composite)
  clinic_id        UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  pack_id          TEXT NOT NULL,                                       -- references the CODE registry (no FK)
  status           TEXT NOT NULL DEFAULT 'installed',                   -- installed | disabled
  capability_level TEXT,                                               -- optional clinic-wide default cap
  installed_by     UUID REFERENCES public.user_profiles(id),
  installed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One installation row per (clinic, pack) — a UNIQUE CONSTRAINT, never the PK.
  CONSTRAINT copilot_pack_installations_clinic_pack_key UNIQUE (clinic_id, pack_id)
);

CREATE INDEX IF NOT EXISTS copilot_pack_installations_clinic_idx
  ON public.copilot_pack_installations (clinic_id);

ALTER TABLE public.copilot_pack_installations ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member of the clinic (installed packs shape their UI later).
DROP POLICY IF EXISTS "copilot_pack_installations_select" ON public.copilot_pack_installations;
CREATE POLICY "copilot_pack_installations_select" ON public.copilot_pack_installations FOR SELECT
  USING (clinic_id = public.get_clinic_id());

-- Write: admin + super_admin only (installing/governing packs is an admin action).
DROP POLICY IF EXISTS "copilot_pack_installations_insert" ON public.copilot_pack_installations;
CREATE POLICY "copilot_pack_installations_insert" ON public.copilot_pack_installations FOR INSERT
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'));

DROP POLICY IF EXISTS "copilot_pack_installations_update" ON public.copilot_pack_installations;
CREATE POLICY "copilot_pack_installations_update" ON public.copilot_pack_installations FOR UPDATE
  USING (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'))
  WITH CHECK (clinic_id = public.get_clinic_id() AND public.get_user_role() IN ('admin','super_admin'));

-- Delete: never via the client (uninstall = status change; additive/audit-friendly).
DROP POLICY IF EXISTS "copilot_pack_installations_delete" ON public.copilot_pack_installations;
CREATE POLICY "copilot_pack_installations_delete" ON public.copilot_pack_installations FOR DELETE USING (false);

DROP TRIGGER IF EXISTS copilot_pack_installations_set_updated_at ON public.copilot_pack_installations;
CREATE TRIGGER copilot_pack_installations_set_updated_at
  BEFORE UPDATE ON public.copilot_pack_installations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
