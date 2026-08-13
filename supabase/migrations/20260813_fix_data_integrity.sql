-- =============================================================================
-- Migration: Fix Data Integrity Issues
-- Date: 2026-08-13
--
-- This migration addresses all outstanding data integrity issues:
--
-- 1. Ensure machine_breakdown_logs has a unique constraint on
--    (machine_id, date, start_time, end_time) to make imports idempotent.
--    When importing the same Excel file twice, we now UPSERT (reuse existing ID)
--    instead of creating duplicates. This prevents 27 rows → 155 records.
--
-- 2. Ensure pm_logs period column exists and has data (it was missing in
--    cloud_sync_schema.sql but present in schema.sql). This fixes the
--    "could not find the 'period' column" error when upserting PM records.
--
-- 3. Add availability_override to breakdown_logs (done in prior migration
--    20260808_fix_realtime_sync.sql but guarded here as well).
--
-- Safe to run multiple times — all ADD COLUMN use IF NOT EXISTS.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ensure pm_logs has period column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pm_logs
  add column if not exists period text not null default '';

-- Populate period from year/month if any rows exist with empty period
update public.pm_logs
set period = to_char(to_date(year || '-' || month::text, 'YYYY-MM'), 'YYYY-MM')
where period = '' and year > 0 and month > 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add unique constraint on machine_breakdown_logs for idempotent imports
--
-- This allows an UPSERT (ON CONFLICT ... DO UPDATE) to reuse the existing
-- record ID when the same breakdown event (by machine/date/start/end) is
-- imported again. Without this, every import would add a new row with a
-- different uuid, causing duplication.
--
-- The constraint uses COALESCE to treat NULL start_time/end_time as a special
-- value so nulls don't collapse into a single "has-no-times" bucket.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the old constraint if it exists (for re-application)
alter table public.machine_breakdown_logs
  drop constraint if exists uq_machine_bd_logs_date_times cascade;

-- Create the new unique constraint
alter table public.machine_breakdown_logs
  add constraint uq_machine_bd_logs_date_times
    unique (
      machine_id,
      date,
      coalesce(start_time::text, ''),
      coalesce(end_time::text, '')
    );


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Guard: ensure breakdown_logs has availability_override
--    (This was added in 20260808_fix_realtime_sync.sql)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.breakdown_logs
  add column if not exists availability_override numeric(5, 1) default null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Ensure all six synced tables have REPLICA IDENTITY FULL
--    (So DELETE events carry the old row data including id)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.machines                replica identity full;
alter table public.breakdown_logs          replica identity full;
alter table public.pm_logs                 replica identity full;
alter table public.energy_logs             replica identity full;
alter table public.amc_records             replica identity full;
alter table public.machine_breakdown_logs  replica identity full;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Ensure all six tables are in supabase_realtime publication
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'machines'
  ) then
    alter publication supabase_realtime add table public.machines;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'breakdown_logs'
  ) then
    alter publication supabase_realtime add table public.breakdown_logs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pm_logs'
  ) then
    alter publication supabase_realtime add table public.pm_logs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'energy_logs'
  ) then
    alter publication supabase_realtime add table public.energy_logs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'amc_records'
  ) then
    alter publication supabase_realtime add table public.amc_records;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'machine_breakdown_logs'
  ) then
    alter publication supabase_realtime add table public.machine_breakdown_logs;
  end if;
end
$$;
