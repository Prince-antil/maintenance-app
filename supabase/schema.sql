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

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. DAILY UTILITY LOG — Raw cumulative meter/DG readings per day
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.daily_utility_log (
  id                              text primary key,
  date                            date not null unique,
  u1_import_kwh_reading           numeric(14, 2) not null default 0,
  u1_import_kvah_reading          numeric(14, 2) not null default 0,
  u1_export_kwh_reading           numeric(14, 2) not null default 0,
  u1_export_kvah_reading          numeric(14, 2) not null default 0,
  u1_solar_kwh_reading            numeric(14, 2) not null default 0,
  u1_solar_kvah_reading           numeric(14, 2) not null default 0,
  u1_pf                           numeric(7, 5) not null default 0,
  u2_import_kwh_reading           numeric(14, 2) not null default 0,
  u2_import_kvah_reading          numeric(14, 2) not null default 0,
  u2_export_kwh_reading           numeric(14, 2) not null default 0,
  u2_export_kvah_reading          numeric(14, 2) not null default 0,
  u2_solar_kwh_reading            numeric(14, 2) not null default 0,
  u2_solar_kvah_reading           numeric(14, 2) not null default 0,
  u2_pf                           numeric(7, 5) not null default 0,
  dg380_kwh_reading               numeric(14, 2) not null default 0,
  dg380_hourmeter_reading         numeric(14, 2) not null default 0,
  dg380_hsd_opening_ltr           numeric(10, 2) not null default 0,
  dg380_hsd_added_ltr             numeric(10, 2) not null default 0,
  dg380_def_opening_pct           numeric(5, 1) not null default 0,
  dg380_def_added_pct             numeric(5, 1) not null default 0,
  dg500_kwh_reading               numeric(14, 2) not null default 0,
  dg500_hourmeter_reading         numeric(14, 2) not null default 0,
  dg500_hsd_opening_ltr           numeric(10, 2) not null default 0,
  dg500_hsd_added_ltr             numeric(10, 2) not null default 0,
  dg500_def_opening_pct           numeric(5, 1) not null default 0,
  dg500_def_added_pct             numeric(5, 1) not null default 0,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_daily_utility_date on public.daily_utility_log (date desc);

-- ── Safe migration: add u1_pf / u2_pf if upgrading an existing database ──────
alter table public.daily_utility_log add column if not exists u1_pf numeric(7,5) not null default 0;
alter table public.daily_utility_log add column if not exists u2_pf numeric(7,5) not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. MONTHLY HERBICIDE SECTION — Sub-meter readings for herbicide area
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_herbicide_section (
  id                              text primary key,
  month                           text not null,
  glyphosate_m1_meter_reading     numeric(14, 2) not null default 0,
  maintenance_topper_m2_meter_reading numeric(14, 2) not null default 0,
  acm_herbicide_m3_meter_reading  numeric(14, 2) not null default 0,
  topper_herbicide_m4_meter_reading numeric(14, 2) not null default 0,
  maintenance_printing_meter_reading numeric(14, 2) not null default 0,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now()),
  unique (month)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. MONTHLY INSECTICIDE SECTION — Sub-meter readings for insecticide area
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_insecticide_section (
  id                                    text primary key,
  month                                 text not null,
  feeder2_sc_electric_room_meter_reading  numeric(14, 2) not null default 0,
  feeder3_waterbath_meter_reading       numeric(14, 2) not null default 0,
  feeder4_jetmill_meter_reading         numeric(14, 2) not null default 0,
  feeder5_cartap_plant_meter_reading    numeric(14, 2) not null default 0,
  feeder6_ec_formulation_meter_reading  numeric(14, 2) not null default 0,
  feeder7_spare_meter_reading           numeric(14, 2) not null default 0,
  feeder8_ec_packing_meter_reading      numeric(14, 2) not null default 0,
  feeder9_admin_block_meter_reading     numeric(14, 2) not null default 0,
  acm_insecticide_meter_reading         numeric(14, 2) not null default 0,
  air_compressor02_ir_meter_reading     numeric(14, 2) not null default 0,
  air_compressor03_atlas_meter_reading  numeric(14, 2) not null default 0,
  air_compressor01_ir_atlas_meter_reading numeric(14, 2) not null default 0,
  created_at                            timestamptz not null default timezone('utc', now()),
  updated_at                            timestamptz not null default timezone('utc', now()),
  unique (month)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. MONTHLY WATER STP — Sub-meter readings for water/STP
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_water_stp (
  id                              text primary key,
  month                           text not null,
  stp_outlet_meter_reading        numeric(14, 2) not null default 0,
  ro_inlet_meter_reading          numeric(14, 2) not null default 0,
  ro_rejected_meter_reading       numeric(14, 2) not null default 0,
  piau_water_meter_reading        numeric(14, 2) not null default 0,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now()),
  unique (month)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. MONTHLY AIR COMPRESSOR — Run/load hours per compressor
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_air_compressor (
  id                              text primary key,
  month                           text not null,
  compressor1_run_hrs_reading     numeric(10, 2) not null default 0,
  compressor1_load_hrs_reading    numeric(10, 2) not null default 0,
  compressor2_run_hrs_reading     numeric(10, 2) not null default 0,
  compressor2_load_hrs_reading    numeric(10, 2) not null default 0,
  compressor3_run_hrs_reading     numeric(10, 2) not null default 0,
  compressor3_load_hrs_reading    numeric(10, 2) not null default 0,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now()),
  unique (month)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. DAILY SOLAR INVERTER GENERATION — Per-inverter kWh per day
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.daily_solar_generation (
  id                              text primary key,
  date                            date not null unique,
  u1_inv1_kwh                     numeric(14, 2) not null default 0,
  u1_inv2_kwh                     numeric(14, 2) not null default 0,
  u1_inv3_kwh                     numeric(14, 2) not null default 0,
  u1_inv4_kwh                     numeric(14, 2) not null default 0,
  u2_inv1_kwh                     numeric(14, 2) not null default 0,
  u2_inv2_kwh                     numeric(14, 2) not null default 0,
  u2_inv3_kwh                     numeric(14, 2) not null default 0,
  daily_total_kwh                 numeric(14, 2) not null default 0,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_daily_solar_date on public.daily_solar_generation (date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. ENERGY SETTINGS — Editable configuration for energy calculations
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.energy_settings (
  id                              text primary key default 'default',
  u1_import_export_ct             numeric(8, 2) not null default 5,
  u1_solar_ct                     numeric(8, 2) not null default 100,
  u2_import_export_ct             numeric(8, 2) not null default 10,
  u2_solar_ct                     numeric(8, 2) not null default 80,
  pf_warning_threshold            numeric(5, 2) not null default 0.90,
  installed_solar_capacity_kwp    numeric(10, 2) not null default 540,
  grid_co2_emission_factor        numeric(8, 4) not null default 0.82,
  avg_peak_sun_hours_per_day      numeric(5, 2) not null default 5.5,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now())
);

insert into public.energy_settings (id) values ('default') on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. TESTING CERTIFICATES — Statutory Safety Certificates per machine
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.testing_certificates (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    machine_id TEXT NOT NULL,
    cert_type TEXT NOT NULL,
    cert_number TEXT,
    agency_name TEXT,
    issue_date DATE,
    expiry_date DATE NOT NULL,
    frequency_months INTEGER DEFAULT 12,
    document_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compatibility columns for client store (TEXT ids, extended fields)
alter table public.testing_certificates add column if not exists machine_code TEXT DEFAULT '';
alter table public.testing_certificates add column if not exists machine_name TEXT DEFAULT '';
alter table public.testing_certificates add column if not exists plant_section TEXT DEFAULT '';
alter table public.testing_certificates add column if not exists certificate_type TEXT;
alter table public.testing_certificates add column if not exists certificate_number TEXT;
alter table public.testing_certificates add column if not exists frequency TEXT;
alter table public.testing_certificates add column if not exists document JSONB;
alter table public.testing_certificates add column if not exists document_name TEXT;
alter table public.testing_certificates add column if not exists document_path TEXT;
alter table public.testing_certificates add column if not exists remarks TEXT DEFAULT '';

-- Backfill compatibility columns from spec columns where needed
-- (no data migration needed; columns default to empty)

-- Notification settings table (for safety alerts dispatch)
create table if not exists public.notification_settings (
  id          text primary key default 'default',
  recipients  jsonb not null default '[]'::jsonb,
  enabled     boolean not null default true,
  amc_expiry_30d  boolean not null default true,
  amc_expiry_15d  boolean not null default true,
  amc_expiry_7d   boolean not null default true,
  amc_expiry_today boolean not null default true,
  amc_visit_overdue boolean not null default true,
  pm_overdue    boolean not null default true,
  breakdown_open_hours integer not null default 24,
  reminder_days jsonb not null default '[30,15,7]'::jsonb,
  created_at   timestamptz not null default timezone('utc', now()),
  updated_at   timestamptz not null default timezone('utc', now())
);

alter table public.notification_settings enable row level security;
drop policy if exists "public notification settings access" on public.notification_settings;
create policy "public notification settings access" on public.notification_settings for all to anon, authenticated using (true) with check (true);
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_settings'
  ) then
    alter publication supabase_realtime add table public.notification_settings;
  end if;
end
$$;
alter table public.notification_settings replica identity full;

-- Enable RLS & set public access policies (per spec)
alter table public.testing_certificates enable row level security;
drop policy if exists "Allow read access for authenticated users" on public.testing_certificates;
create policy "Allow read access for authenticated users" on public.testing_certificates for select using (true);
drop policy if exists "Allow insert/update/delete access" on public.testing_certificates for all using (true);
create policy "Allow insert/update/delete access" on public.testing_certificates for all using (true);
drop policy if exists "public testing certificates access" on public.testing_certificates;
create policy "public testing certificates access" on public.testing_certificates for all to anon, authenticated using (true) with check (true);

-- Ensure notification_settings table supports safety alerts (per spec)
alter table if exists public.notification_settings add column if not exists notif_safety_expiry BOOLEAN DEFAULT true;
alter table if exists public.notification_settings add column if not exists notif_safety_expired BOOLEAN DEFAULT true;
-- Legacy safety columns for backwards compat (from previous migration)
alter table if exists public.notification_settings add column if not exists safety_expiry_warning BOOLEAN DEFAULT true;
alter table if exists public.notification_settings add column if not exists safety_expired BOOLEAN DEFAULT true;

-- Enable Supabase Realtime for testing_certificates (per spec)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'testing_certificates'
  ) then
    alter publication supabase_realtime add table public.testing_certificates;
  end if;
end
$$;
alter table public.testing_certificates replica identity full;

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
alter table public.daily_utility_log        enable row level security;
alter table public.monthly_herbicide_section enable row level security;
alter table public.monthly_insecticide_section enable row level security;
alter table public.monthly_water_stp        enable row level security;
alter table public.monthly_air_compressor   enable row level security;
alter table public.daily_solar_generation   enable row level security;
alter table public.energy_settings          enable row level security;

drop policy if exists "public machines access"              on public.machines;
drop policy if exists "public breakdown access"             on public.breakdown_logs;
drop policy if exists "public pm access"                    on public.pm_logs;
drop policy if exists "public energy access"                on public.energy_logs;
drop policy if exists "public amc access"                   on public.amc_records;
drop policy if exists "public machine bd logs access"       on public.machine_breakdown_logs;
drop policy if exists "public machine pm records access"    on public.machine_pm_records;
drop policy if exists "public plant sections access"        on public.plant_sections;
drop policy if exists "public daily utility access"         on public.daily_utility_log;
drop policy if exists "public monthly herbicide access"     on public.monthly_herbicide_section;
drop policy if exists "public monthly insecticide access"   on public.monthly_insecticide_section;
drop policy if exists "public monthly water stp access"     on public.monthly_water_stp;
drop policy if exists "public monthly air compressor access" on public.monthly_air_compressor;
drop policy if exists "public daily solar access"           on public.daily_solar_generation;
drop policy if exists "public energy settings access"       on public.energy_settings;

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

create policy "public daily utility access"
  on public.daily_utility_log for all to anon, authenticated
  using (true) with check (true);

create policy "public monthly herbicide access"
  on public.monthly_herbicide_section for all to anon, authenticated
  using (true) with check (true);

create policy "public monthly insecticide access"
  on public.monthly_insecticide_section for all to anon, authenticated
  using (true) with check (true);

create policy "public monthly water stp access"
  on public.monthly_water_stp for all to anon, authenticated
  using (true) with check (true);

create policy "public monthly air compressor access"
  on public.monthly_air_compressor for all to anon, authenticated
  using (true) with check (true);

create policy "public daily solar access"
  on public.daily_solar_generation for all to anon, authenticated
  using (true) with check (true);

create policy "public energy settings access"
  on public.energy_settings for all to anon, authenticated
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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_utility_log'
  ) then
    alter publication supabase_realtime add table public.daily_utility_log;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monthly_herbicide_section'
  ) then
    alter publication supabase_realtime add table public.monthly_herbicide_section;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monthly_insecticide_section'
  ) then
    alter publication supabase_realtime add table public.monthly_insecticide_section;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monthly_water_stp'
  ) then
    alter publication supabase_realtime add table public.monthly_water_stp;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monthly_air_compressor'
  ) then
    alter publication supabase_realtime add table public.monthly_air_compressor;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_solar_generation'
  ) then
    alter publication supabase_realtime add table public.daily_solar_generation;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'energy_settings'
  ) then
    alter publication supabase_realtime add table public.energy_settings;
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
alter table public.daily_utility_log       replica identity full;
alter table public.monthly_herbicide_section replica identity full;
alter table public.monthly_insecticide_section replica identity full;
alter table public.monthly_water_stp       replica identity full;
alter table public.monthly_air_compressor  replica identity full;
alter table public.daily_solar_generation  replica identity full;
alter table public.energy_settings         replica identity full;

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
