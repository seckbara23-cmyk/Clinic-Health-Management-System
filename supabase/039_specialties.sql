-- ════════════════════════════════════════════════════════════════
-- 039_specialties.sql — Phase 14.2.3: Specialty Registry (selection storage)
-- ════════════════════════════════════════════════════════════════
-- Fully ADDITIVE and forward-only. Safe on a live database.
--
-- DESIGN (frozen Phase 14.2 architecture, §5 / §17):
--   • The specialty TAXONOMY itself is a controlled CODE registry
--     (src/lib/specialties/taxonomy.ts) — reference data ships in code, i18n'd,
--     versioned, and extended by appending registry entries. It is deliberately
--     NOT a database table: no lookup table, no FK to it, nothing for PostgREST
--     to infer a relationship from.
--   • Only the professional's SELECTIONS persist, on the existing surrogate-PK
--     professional_profiles table (migration 038):
--       - primary_specialty        TEXT   (exactly one — added HERE, queryable)
--       - secondary_specialties    JSONB  (unlimited — already in 038)
--       - sub_specialties          JSONB  (unlimited — already in 038)
--     JSONB arrays instead of a user↔specialty junction table is the P0 rule
--     (surrogate PKs, no composite-FK PKs, no junction inference): this
--     migration creates NO new table, NO new FK, and therefore CANNOT introduce
--     any PostgREST relationship ambiguity.
--
-- Touches NO existing rows, policies, FKs or RPCs. RLS on
-- professional_profiles (own-row write, clinic-scoped read) already covers the
-- new column. The app is tolerant before this runs (reads degrade to null).

ALTER TABLE IF EXISTS public.professional_profiles
  ADD COLUMN IF NOT EXISTS primary_specialty TEXT;

-- Clinic-scoped listing/filtering by specialty (e.g. "all cardiologists here").
CREATE INDEX IF NOT EXISTS professional_profiles_primary_specialty_idx
  ON public.professional_profiles (clinic_id, primary_specialty);
