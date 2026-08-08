-- =============================================================================
-- Migration: Add start_time and end_time to machine_breakdown_logs
-- Date: 2026-08-08
--
-- These columns enable precise downtime calculation per breakdown event and
-- power the multi-PC Realtime broadcast of exact incident timestamps.
-- Downtime is auto-calculated on the client as (end_time - start_time) / 3600s
-- when the explicit downtime_hours value is blank.
-- =============================================================================

-- Add start_time and end_time as nullable timestamptz columns
alter table public.machine_breakdown_logs
  add column if not exists start_time timestamptz,
  add column if not exists end_time   timestamptz;

-- Index for range queries and sorting by incident start time
create index if not exists idx_machine_bd_logs_start_time
  on public.machine_breakdown_logs (start_time desc nulls last);

-- When start_time is present and end_time is present, keep downtime_hours
-- consistent via a generated/computed approach.  Postgres does not allow
-- a stored generated column that references other non-immutable expressions
-- easily, so we use a BEFORE INSERT/UPDATE trigger instead to auto-fill
-- downtime_hours when it is zero/null but the times are available.

create or replace function public.fn_auto_calc_breakdown_downtime()
returns trigger
language plpgsql
as $$
begin
  -- Auto-calculate downtime_hours from start/end timestamps when not supplied
  if (new.downtime_hours is null or new.downtime_hours = 0)
     and new.start_time is not null
     and new.end_time   is not null
     and new.end_time > new.start_time
  then
    new.downtime_hours :=
      round(
        extract(epoch from (new.end_time - new.start_time)) / 3600.0,
        2
      );
  end if;

  -- Auto-derive date from start_time when date is not explicitly set
  if new.date is null and new.start_time is not null then
    new.date := new.start_time::date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_calc_breakdown_downtime on public.machine_breakdown_logs;
create trigger trg_auto_calc_breakdown_downtime
  before insert or update on public.machine_breakdown_logs
  for each row
  execute function public.fn_auto_calc_breakdown_downtime();

-- Ensure Supabase Realtime still publishes this table (idempotent guard)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'machine_breakdown_logs'
  ) then
    alter publication supabase_realtime add table public.machine_breakdown_logs;
  end if;
end
$$;
