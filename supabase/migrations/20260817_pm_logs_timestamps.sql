-- Add start_time, end_time, duration_hours to pm_logs
-- These columns store the PM session timestamps and auto-calculated duration.
-- The client already sends these in pmToCloudRow(); this migration makes the
-- DB accept them instead of silently dropping them on upsert.

ALTER TABLE public.pm_logs
  ADD COLUMN IF NOT EXISTS start_time     timestamptz,
  ADD COLUMN IF NOT EXISTS end_time       timestamptz,
  ADD COLUMN IF NOT EXISTS duration_hours numeric(10, 2) NOT NULL DEFAULT 0;

-- Add start_time, end_time, duration_hours to machine_pm_records
-- (this table was created before the timestamp feature was added)

ALTER TABLE public.machine_pm_records
  ADD COLUMN IF NOT EXISTS start_time     timestamptz,
  ADD COLUMN IF NOT EXISTS end_time       timestamptz,
  ADD COLUMN IF NOT EXISTS duration_hours numeric(10, 2) NOT NULL DEFAULT 0;
