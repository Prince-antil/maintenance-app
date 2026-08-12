create table if not exists public.machines (
  id text primary key,
  name text not null,
  section text not null,
  attachments jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.breakdown_logs (
  id text primary key,
  month integer not null check (month between 1 and 12),
  year integer not null check (year >= 2000),
  period text not null,
  section text not null,
  total_breakdowns integer not null default 0,
  downtime_hours numeric(10, 1) not null default 0,
  operating_hours numeric(10, 1) not null default 0,
  mttr numeric(10, 1) not null default 0,
  mtbf numeric(10, 1) not null default 0,
  -- Explicit availability override (0–100 %). NULL = use auto-formula.
  availability_override numeric(5, 1) default null,
  remarks text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (section, month, year)
);

create table if not exists public.pm_logs (
  id text primary key,
  month integer not null check (month between 1 and 12),
  year integer not null check (year >= 2000),
  period text not null,
  section text not null,
  planned_count integer not null default 0,
  done_count integer not null default 0,
  overdue_count integer not null default 0,
  compliance_pct numeric(5, 1) not null default 0,
  remarks text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (section, month, year)
);

create index if not exists idx_machines_section on public.machines (section);
create index if not exists idx_breakdown_logs_period on public.breakdown_logs (year desc, month desc, section);
create index if not exists idx_pm_logs_period on public.pm_logs (year desc, month desc, section);

alter table public.machines enable row level security;
alter table public.breakdown_logs enable row level security;
alter table public.pm_logs enable row level security;

drop policy if exists "public machines access" on public.machines;
create policy "public machines access"
on public.machines
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public breakdown access" on public.breakdown_logs;
create policy "public breakdown access"
on public.breakdown_logs
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public pm access" on public.pm_logs;
create policy "public pm access"
on public.pm_logs
for all
to anon, authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'machines'
  ) then
    alter publication supabase_realtime add table public.machines;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'breakdown_logs'
  ) then
    alter publication supabase_realtime add table public.breakdown_logs;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pm_logs'
  ) then
    alter publication supabase_realtime add table public.pm_logs;
  end if;
end
$$;

-- Energy logs table (added to enable cross-device cloud sync)
create table if not exists public.energy_logs (
  id text primary key,
  date date not null,
  source text not null default '',
  remarks text not null default '',
  plant_section text not null default '',
  dg500_run_hours numeric(10, 2) not null default 0,
  dg380_run_hours numeric(10, 2) not null default 0,
  fuel_consumed_litres numeric(10, 2) not null default 0,
  solar_generation_kwh numeric(10, 2) not null default 0,
  plant_sec numeric(10, 2) not null default 0,
  kwh numeric(10, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_energy_logs_date on public.energy_logs (date desc);

alter table public.energy_logs enable row level security;

drop policy if exists "public energy access" on public.energy_logs;
create policy "public energy access"
on public.energy_logs
for all
to anon, authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'energy_logs'
  ) then
    alter publication supabase_realtime add table public.energy_logs;
  end if;
end
$$;

-- energy_logs: new columns for dual-unit grid, DG split, totals, section sub-meters
-- Run these ALTER statements against your Supabase project if the table already exists.
alter table public.energy_logs add column if not exists uhbvnl_unit1_kwh  numeric(12,2) not null default 0;
alter table public.energy_logs add column if not exists uhbvnl_unit2_kwh  numeric(12,2) not null default 0;
alter table public.energy_logs add column if not exists total_grid_kwh    numeric(12,2) not null default 0;
alter table public.energy_logs add column if not exists dg_kwh            numeric(12,2) not null default 0;
alter table public.energy_logs add column if not exists total_kwh         numeric(12,2) not null default 0;
alter table public.energy_logs add column if not exists section_consumption jsonb not null default '{}'::jsonb;

-- =============================================================================
-- AMC Records — Annual Maintenance Contracts per machine
-- =============================================================================
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

create index if not exists idx_amc_records_machine on public.amc_records (machine_id);
create index if not exists idx_amc_records_end_date on public.amc_records (contract_end_date);

alter table public.amc_records enable row level security;

drop policy if exists "public amc access" on public.amc_records;
create policy "public amc access"
  on public.amc_records
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- =============================================================================
-- Machine Breakdown Logs — individual per-machine breakdown events
-- =============================================================================
create table if not exists public.machine_breakdown_logs (
  id             text        primary key,
  machine_id     text        not null references public.machines (id) on delete cascade,
  machine_code   text        not null default '',
  machine_name   text        not null default '',
  plant_section  text        not null default '',
  date           date        not null,
  start_time     timestamptz,
  end_time       timestamptz,
  downtime_hours numeric(8, 2) not null default 0,
  failure_cause  text        not null default '',
  action_taken   text        not null default '',
  status         text        not null default 'closed'
                             check (status in ('open', 'closed', 'pending')),
  remarks        text        not null default '',
  created_at     timestamptz not null default timezone('utc', now())
);

create index if not exists idx_machine_bd_logs_machine on public.machine_breakdown_logs (machine_id);
create index if not exists idx_machine_bd_logs_date    on public.machine_breakdown_logs (date desc);
create index if not exists idx_machine_bd_logs_section on public.machine_breakdown_logs (plant_section);

alter table public.machine_breakdown_logs enable row level security;

drop policy if exists "public machine bd logs access" on public.machine_breakdown_logs;
create policy "public machine bd logs access"
  on public.machine_breakdown_logs
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- =============================================================================
-- Supabase Realtime — publish both new tables
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'amc_records'
  ) then
    alter publication supabase_realtime add table public.amc_records;
  end if;

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

-- =============================================================================
-- Supabase Storage — create AMC documents bucket (run once)
-- =============================================================================
-- Insert the bucket only if it does not exist yet.
insert into storage.buckets (id, name, public)
  values ('amc-documents', 'amc-documents', true)
  on conflict (id) do nothing;

-- Allow authenticated and anonymous reads (public bucket)
drop policy if exists "amc public read"   on storage.objects;
drop policy if exists "amc admin write"   on storage.objects;
drop policy if exists "amc admin delete"  on storage.objects;

create policy "amc public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'amc-documents');

create policy "amc admin write"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'amc-documents');

create policy "amc admin delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'amc-documents');

-- =============================================================================
-- REPLICA IDENTITY FULL — required so DELETE events carry the full old row
-- (including `id`) for all six Realtime-synced tables.
-- =============================================================================
alter table public.machines                replica identity full;
alter table public.breakdown_logs          replica identity full;
alter table public.pm_logs                 replica identity full;
alter table public.energy_logs             replica identity full;
alter table public.amc_records             replica identity full;
alter table public.machine_breakdown_logs  replica identity full;
