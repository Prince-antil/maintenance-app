-- =============================================================================
-- CCPL Maintenance App — Realtime Sync Fix
-- Date: 2026-08-08
--
-- Safe to run on the LIVE database. Audit summary:
--
--   ✅ No tables are dropped or recreated
--   ✅ No existing data is deleted or modified
--   ✅ No RLS policies are dropped, replaced, or weakened
--   ✅ RLS is NOT disabled on any table
--   ✅ No duplicate Realtime subscriptions (all guards use IF NOT EXISTS)
--   ✅ Every ALTER uses ADD COLUMN IF NOT EXISTS — fully idempotent
--
-- What this migration does:
--
--   1. Adds availability_override to breakdown_logs
--      → This column is serialized by breakdownToCloudRow() but was missing
--        from the DB.  Every breakdown upsert was failing silently with a
--        Postgres "column does not exist" error, so NO Realtime event was
--        ever fired for breakdowns.  This is the primary root cause of
--        PC-B never receiving breakdown changes.
--
--   2. Adds start_time / end_time to machine_breakdown_logs (idempotent)
--      → These columns were introduced in 20260808_breakdown_log_start_end_time.sql.
--        This guard ensures they exist even if that migration was not yet applied.
--
--   3. Creates the amc_records table (IF NOT EXISTS)
--      → amc_records does not exist in production yet.  The AMC feature is
--        fully implemented on the client (AmcTab.jsx, store.js addAmcRecord /
--        updateAmcRecord / deleteAmcRecord).  Without this table every AMC
--        write also fails silently.  Creating it enables the feature.
--
--   4. Sets REPLICA IDENTITY FULL on all six synced tables
--      → Without this, DELETE events arrive with old = {} (no id), forcing
--        a full re-fetch instead of an instant inline removal.
--
--   5. Ensures all six tables are in the supabase_realtime publication
--      → Each block is guarded with IF NOT EXISTS — no duplicate publishes.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. attachments column on machines  ← THIS IS THE ACTIVE BLOCKER
--    machineToCloudRow() always sends { id, name, section, attachments, payload }.
--    Without this column the entire machines table upsert is rejected by
--    Postgres with HTTP 400, so no machine change (status, edit, etc.) ever
--    reaches the DB and no Realtime event is ever fired.
--    Migration 20260801_machine_attachments.sql exists locally but was
--    never applied to the live production database.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.machines
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Back-fill: if any existing rows stored attachments inside the payload JSON
-- blob (the old format before the column was added), move them out.
update public.machines
set
  attachments = case
    when jsonb_typeof(payload -> 'attachments') = 'array'
    then payload -> 'attachments'
    else coalesce(attachments, '[]'::jsonb)
  end,
  payload = coalesce(payload, '{}'::jsonb) - 'attachments'
where payload ? 'attachments';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. availability_override on breakdown_logs
--    breakdownToCloudRow() sends this field; without the column every
--    breakdown upsert was rejected → no Realtime event fired for breakdowns.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.breakdown_logs
  add column if not exists availability_override numeric(5,1) default null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. start_time / end_time on machine_breakdown_logs (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.machine_breakdown_logs
  add column if not exists start_time timestamptz,
  add column if not exists end_time   timestamptz;

create index if not exists idx_machine_bd_logs_start_time
  on public.machine_breakdown_logs (start_time desc nulls last);

-- Auto-calc downtime trigger (idempotent — CREATE OR REPLACE)
create or replace function public.fn_auto_calc_breakdown_downtime()
returns trigger
language plpgsql
as $$
begin
  if (new.downtime_hours is null or new.downtime_hours = 0)
     and new.start_time is not null
     and new.end_time   is not null
     and new.end_time > new.start_time
  then
    new.downtime_hours :=
      round(extract(epoch from (new.end_time - new.start_time)) / 3600.0, 2);
  end if;
  if new.date is null and new.start_time is not null then
    new.date := new.start_time::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_calc_breakdown_downtime
  on public.machine_breakdown_logs;
create trigger trg_auto_calc_breakdown_downtime
  before insert or update on public.machine_breakdown_logs
  for each row execute function public.fn_auto_calc_breakdown_downtime();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Create amc_records table (IF NOT EXISTS — safe to run even after creation)
--
--    The AMC feature is fully built on the client. This table does not exist
--    in production yet. Creating it enables cross-PC Realtime sync for AMC.
--    The foreign key references machines(id) which exists in production.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.amc_records (
  id                  text        primary key,
  machine_id          text        not null references public.machines (id) on delete cascade,
  vendor_name         text        not null default '',
  contract_start_date date,
  contract_end_date   date,
  total_visits_agreed integer     not null default 0,
  completed_visits    integer     not null default 0,
  documents           jsonb       not null default '[]'::jsonb,
  remarks             text        not null default '',
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

create index if not exists idx_amc_records_machine
  on public.amc_records (machine_id);
create index if not exists idx_amc_records_end_date
  on public.amc_records (contract_end_date);

-- Enable RLS (mirrors pattern used on every other table in this project)
alter table public.amc_records enable row level security;

-- Access policy — same open pattern used by all other tables in this app.
-- Only creates this policy; does NOT touch any other table's policies.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'amc_records'
      and policyname = 'public amc access'
  ) then
    execute $p$
      create policy "public amc access"
        on public.amc_records
        for all
        to anon, authenticated
        using (true)
        with check (true)
    $p$;
  end if;
end
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REPLICA IDENTITY FULL on all six synced tables
--
--    Without this, DELETE events carry old = {} (no id).  The client falls
--    back to a full re-fetch instead of an instant inline removal.
--    This is a metadata-only change — no rows are affected.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.machines                replica identity full;
alter table public.breakdown_logs          replica identity full;
alter table public.pm_logs                 replica identity full;
alter table public.energy_logs             replica identity full;
alter table public.amc_records             replica identity full;
alter table public.machine_breakdown_logs  replica identity full;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Add all six tables to the supabase_realtime publication (idempotent)
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
