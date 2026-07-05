-- ════════════════════════════════════════════════════════════════
-- 041_pack_governance.sql — Phase 14.2.5: Clinical Copilot Governance
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Safe on a live database.
--
-- Governance is the middle tier of the frozen model (catalog ⊇ clinic install
-- ⊇ professional enable). It needs richer per-(clinic, pack) metadata and a place
-- to record each professional's enablement — BOTH added by extending EXISTING
-- surrogate-PK tables. This migration creates NO new table and NO new foreign
-- key, so it introduces ZERO new PostgREST relationships and cannot recreate the
-- junction ambiguity from the P0 incident.
--
--   A. copilot_pack_installations += lifecycle / version / governance columns
--   B. professional_profiles       += pack_enablement JSONB (per-professional)
--
-- Existing RLS already covers the new columns:
--   • copilot_pack_installations  — clinic-scoped read, admin/super_admin write
--   • professional_profiles       — own-row write, clinic-scoped read
-- No policy is changed. The app is tolerant before this runs (governance reads
-- degrade to registry/clinic defaults).

-- ── A. Clinic install + governance + version (per clinic, per pack) ──
ALTER TABLE IF EXISTS public.copilot_pack_installations
  -- Lifecycle stage (distinct from install status installed|disabled|deprecated).
  ADD COLUMN IF NOT EXISTS lifecycle_stage      TEXT NOT NULL DEFAULT 'stable',   -- preview|beta|stable|retired
  -- Version bookkeeping for upgrade/rollback detection.
  ADD COLUMN IF NOT EXISTS current_version      TEXT,
  ADD COLUMN IF NOT EXISTS previous_version     TEXT,
  -- Clinic governance.
  ADD COLUMN IF NOT EXISTS requirement          TEXT NOT NULL DEFAULT 'optional', -- mandatory|optional
  ADD COLUMN IF NOT EXISTS hidden               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_capability_level TEXT,
  ADD COLUMN IF NOT EXISTS max_capability_level TEXT;

-- ── B. Per-professional enablement (per user, per clinic) ──────────
-- Keyed object: { "<pack_id>": { enabled, preferred, pinned, favorite, level } }.
-- JSONB (not a junction table) keeps professional enablement free of any second
-- foreign key — the P0 anti-junction rule.
ALTER TABLE IF EXISTS public.professional_profiles
  ADD COLUMN IF NOT EXISTS pack_enablement JSONB NOT NULL DEFAULT '{}'::jsonb;
