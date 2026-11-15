-- =============================================================================
-- 20261114 — Inspection & Certification validity dates
--
-- Adds the two fields required so that "Inspection Start Date" and
-- "Inspection Expiry Date / Valid Until" are first-class certificate dates,
-- separate from equipment installation / purchase history:
--
--   compliance_inspections.validity_start_date
--       Date from which the recorded inspection/certificate validity starts.
--   compliance_equipment.current_validity_start_date
--       Cached validity start of the CURRENT certificate (mirrors
--       current_expiry_date / current_issue_date).
--
-- Safety guarantees:
--   • Idempotent — safe to run again.
--   • No data is deleted, truncated, re-typed or backfilled. Existing
--     install_date / purchase_date values are left untouched and keep their
--     meaning as optional equipment history, NOT inspection dates.
--   • No dates are guessed for existing records: validity start stays NULL
--     ("unknown — flag for verification") until a real value is recorded.
--   • plant_id / equipment IDs / certificate dates are not modified.
--   • Realtime and RLS are unaffected (column-only change).
--
-- Run AFTER 20261113_compliance_upgrade.sql (it creates the base tables).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.compliance_equipment') IS NULL OR to_regclass('public.compliance_inspections') IS NULL THEN
    RAISE WARNING 'Compliance tables not found — run 20261113_compliance_upgrade.sql first. Skipping validity-date migration.';
    RETURN;
  END IF;
END $$;

ALTER TABLE public.compliance_equipment
  ADD COLUMN IF NOT EXISTS current_validity_start_date date;

ALTER TABLE public.compliance_inspections
  ADD COLUMN IF NOT EXISTS validity_start_date date;

COMMENT ON COLUMN public.compliance_inspections.validity_start_date IS
  'Inspection Start Date — date from which this inspection/certificate validity period starts (ISO YYYY-MM-DD). NULL = not yet recorded/verified.';

COMMENT ON COLUMN public.compliance_equipment.current_validity_start_date IS
  'Cached Inspection Start Date of the current certificate. Recomputed from the newest inspection that records one; manual entries survive until then.';
