-- =============================================================================
-- CCPL Maintenance & Reliability Hub — Complete Database Schema
-- =============================================================================
-- This is the single master SQL file for the Supabase database.
-- Copy and paste the entire script into the Supabase SQL Editor and run it.
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. MACHINES — Master equipment register
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.machines (
  id          text primary key,
  name        text not null,
  section     text not null,
  attachments jsonb not null default '[]'::jsonb,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_machines_section on public.machines (section);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BREAKDOWN LOGS — Section-level monthly breakdown summaries
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.breakdown_logs (
  id                   text primary key,
  month                integer not null check (month between 1 and 12),
  year                 integer not null check (year >= 2000),
  period               text not null,
  section              text not null,
  total_breakdowns     integer not null default 0,
  downtime_hours       numeric(10, 1) not null default 0,
  operating_hours      numeric(10, 1) not null default 0,
  mttr                 numeric(10, 1) not null default 0,
  mtbf                 numeric(10, 1) not null default 0,
  availability_override numeric(5, 1) default null,
  remarks              text not null default '',
  payload              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now()),
  unique (section, month, year)
);

create index if not exists idx_breakdown_logs_period on public.breakdown_logs (year desc, month desc, section);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PM LOGS — Section-level monthly PM summaries
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pm_logs (
  id              text primary key,
  month           integer not null check (month between 1 and 12),
  year            integer not null check (year >= 2000),
  period          text not null,
  section         text not null,
  planned_count   integer not null default 0,
  done_count      integer not null default 0,
  overdue_count   integer not null default 0,
  compliance_pct  numeric(5, 1) not null default 0,
  remarks         text not null default '',
  payload         jsonb not null default '{}'::jsonb,
  start_time      timestamptz,
  end_time        timestamptz,
  duration_hours  numeric(10, 2) not null default 0,
  created_at      timestamptz not null default timezone('utc', now()),
  updated_at      timestamptz not null default timezone('utc', now()),
  unique (section, month, year)
);

create index if not exists idx_pm_logs_period on public.pm_logs (year desc, month desc, section);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ENERGY LOGS — Daily energy consumption records
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.energy_logs (
  id                     text primary key,
  date                   date not null,
  source                 text not null default '',
  remarks                text not null default '',
  plant_section          text not null default '',
  dg500_run_hours        numeric(10, 2) not null default 0,
  dg380_run_hours        numeric(10, 2) not null default 0,
  fuel_consumed_litres   numeric(10, 2) not null default 0,
  solar_generation_kwh   numeric(10, 2) not null default 0,
  uhbvnl_unit1_kwh       numeric(12, 2) not null default 0,
  uhbvnl_unit2_kwh       numeric(12, 2) not null default 0,
  total_grid_kwh         numeric(12, 2) not null default 0,
  dg_kwh                 numeric(12, 2) not null default 0,
  total_kwh              numeric(12, 2) not null default 0,
  plant_sec              numeric(10, 2) not null default 0,
  kwh                    numeric(10, 2) not null default 0,
  section_consumption    jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default timezone('utc', now())
);

create index if not exists idx_energy_logs_date on public.energy_logs (date desc);
create index if not exists idx_energy_logs_section on public.energy_logs (plant_section, date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AMC RECORDS — Annual Maintenance Contracts per machine
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.amc_records (
  id                  text primary key,
  machine_id          text not null references public.machines (id) on delete cascade,
  vendor_name         text not null default '',
  contract_start_date date,
  contract_end_date   date,
  total_visits_agreed integer not null default 0,
  completed_visits    integer not null default 0,
  documents           jsonb not null default '[]'::jsonb,
  remarks             text not null default '',
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

create index if not exists idx_amc_records_machine on public.amc_records (machine_id);
create index if not exists idx_amc_records_end_date on public.amc_records (contract_end_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MACHINE BREAKDOWN LOGS — Individual per-machine breakdown events
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.machine_breakdown_logs (
  id             text primary key,
  machine_id     text not null references public.machines (id) on delete cascade,
  machine_code   text not null default '',
  machine_name   text not null default '',
  plant_section  text not null default '',
  date           date not null,
  start_time     timestamptz,
  end_time       timestamptz,
  downtime_hours numeric(8, 2) not null default 0,
  failure_cause  text not null default '',
  action_taken   text not null default '',
  status         text not null default 'closed'
                   check (status in ('open', 'closed', 'pending')),
  remarks        text not null default '',
  created_at     timestamptz not null default timezone('utc', now()),
  constraint uq_machine_bd_logs_date_times unique (
    machine_id,
    date,
    coalesce(start_time::text, ''),
    coalesce(end_time::text, '')
  )
);

create index if not exists idx_machine_bd_logs_machine on public.machine_breakdown_logs (machine_id);
create index if not exists idx_machine_bd_logs_date    on public.machine_breakdown_logs (date desc);
create index if not exists idx_machine_bd_logs_section on public.machine_breakdown_logs (plant_section);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. MACHINE PM RECORDS — Per-machine PM activity records
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.machine_pm_records (
  id              text primary key,
  machine_id      text not null references public.machines (id) on delete cascade,
  machine_code    text default '',
  machine_name    text default '',
  plant_section   text default '',
  pm_date         date not null,
  pm_type         text default 'Preventive',
  task            text default '',
  status          text default 'completed'
                    check (status in ('completed', 'pending', 'overdue', 'skipped')),
  completed       boolean default true,
  action          text default '',
  technician      text default '',
  remarks         text default '',
  start_time      timestamptz,
  end_time        timestamptz,
  duration_hours  numeric(10, 2) not null default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_machine_pm_records_machine on public.machine_pm_records (machine_id, pm_date desc);
create index if not exists idx_machine_pm_records_section on public.machine_pm_records (plant_section, pm_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PLANT SECTIONS — User-added dynamic sections (synced across devices)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.plant_sections (
  id          text primary key,
  name        text not null unique,
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_plant_sections_name on public.plant_sections (name);

-- =============================================================================
-- ROW LEVEL SECURITY — Enable RLS on all tables and create permissive policies
-- =============================================================================
alter table public.machines                 enable row level security;
alter table public.breakdown_logs           enable row level security;
alter table public.pm_logs                  enable row level security;
alter table public.energy_logs              enable row level security;
alter table public.amc_records              enable row level security;
alter table public.machine_breakdown_logs   enable row level security;
alter table public.machine_pm_records       enable row level security;
alter table public.plant_sections           enable row level security;

drop policy if exists "public machines access"              on public.machines;
drop policy if exists "public breakdown access"             on public.breakdown_logs;
drop policy if exists "public pm access"                    on public.pm_logs;
drop policy if exists "public energy access"                on public.energy_logs;
drop policy if exists "public amc access"                   on public.amc_records;
drop policy if exists "public machine bd logs access"       on public.machine_breakdown_logs;
drop policy if exists "public machine pm records access"    on public.machine_pm_records;
drop policy if exists "public plant sections access"        on public.plant_sections;

create policy "public machines access"
  on public.machines for all to anon, authenticated
  using (true) with check (true);

create policy "public breakdown access"
  on public.breakdown_logs for all to anon, authenticated
  using (true) with check (true);

create policy "public pm access"
  on public.pm_logs for all to anon, authenticated
  using (true) with check (true);

create policy "public energy access"
  on public.energy_logs for all to anon, authenticated
  using (true) with check (true);

create policy "public amc access"
  on public.amc_records for all to anon, authenticated
  using (true) with check (true);

create policy "public machine bd logs access"
  on public.machine_breakdown_logs for all to anon, authenticated
  using (true) with check (true);

create policy "public machine pm records access"
  on public.machine_pm_records for all to anon, authenticated
  using (true) with check (true);

create policy "public plant sections access"
  on public.plant_sections for all to anon, authenticated
  using (true) with check (true);

-- =============================================================================
-- REALTIME — Publish all tables for Realtime subscriptions
-- =============================================================================
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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'machine_pm_records'
  ) then
    alter publication supabase_realtime add table public.machine_pm_records;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plant_sections'
  ) then
    alter publication supabase_realtime add table public.plant_sections;
  end if;
end
$$;

-- =============================================================================
-- REPLICA IDENTITY FULL — Required so DELETE events carry the full old row
-- (including `id`) for all Realtime-synced tables.
-- =============================================================================
alter table public.machines                replica identity full;
alter table public.breakdown_logs          replica identity full;
alter table public.pm_logs                 replica identity full;
alter table public.energy_logs             replica identity full;
alter table public.amc_records             replica identity full;
alter table public.machine_breakdown_logs  replica identity full;
alter table public.machine_pm_records      replica identity full;
alter table public.plant_sections          replica identity full;

-- =============================================================================
-- SUPABASE STORAGE — AMC documents bucket
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('amc-documents', 'amc-documents', true)
  on conflict (id) do nothing;

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
