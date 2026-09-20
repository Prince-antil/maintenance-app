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
  created_at     timestamptz not null default timezone('utc', now())
);

create index if not exists idx_machine_bd_logs_machine on public.machine_breakdown_logs (machine_id);
create index if not exists idx_machine_bd_logs_date    on public.machine_breakdown_logs (date desc);
create index if not exists idx_machine_bd_logs_section on public.machine_breakdown_logs (plant_section);
-- Fix ERROR 42601: inline unique constraint with coalesce(start_time::text,'') is not valid.
-- Fix ERROR 42P17: coalesce(...::text) uses stable cast, not immutable for index.
-- Use simple unique index on raw columns (immutable). Nulls are distinct per Postgres, which is acceptable;
-- app-level duplicate check via id prevents real duplicates. Idempotent, preserves data.
do $$ begin
  alter table public.machine_breakdown_logs drop constraint if exists uq_machine_bd_logs_date_times;
exception when others then null;
end $$;
drop index if exists public.uq_machine_bd_logs_date_times;
create unique index if not exists uq_machine_bd_logs_date_times on public.machine_breakdown_logs (machine_id, date, start_time, end_time);

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
-- 16. KPI STATUS — Monthly KPI records per section/machine (auto from PM/Breakdown)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.kpi_records (
  id                              text primary key,
  period                          text not null, -- YYYY-MM
  month                           integer not null check (month between 1 and 12),
  year                            integer not null check (year >= 2000),
  section                         text not null,
  machine_id                      text not null default '',
  machine_code                    text not null default '',
  machine_name                    text not null default '',
  pm_compliance_pct               numeric(5,1) not null default 0,
  breakdown_count                 integer not null default 0,
  breakdown_hours                 numeric(10,1) not null default 0,
  mttr                            numeric(10,1) not null default 0,
  mtbf                            numeric(10,1) not null default 0,
  availability_pct                numeric(5,1) not null default 0,
  kpi_status                      text not null default 'Good' check (kpi_status in ('Good','Warning','Critical')),
  remarks                         text not null default '',
  is_manual_pm_compliance         boolean not null default false,
  is_manual_breakdown_count       boolean not null default false,
  is_manual_breakdown_hours       boolean not null default false,
  is_manual_mttr                  boolean not null default false,
  is_manual_mtbf                  boolean not null default false,
  is_manual_availability          boolean not null default false,
  is_manual_kpi_status            boolean not null default false,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now()),
  unique (period, section, machine_id)
);

create index if not exists idx_kpi_records_period on public.kpi_records (year desc, month desc, section);
create index if not exists idx_kpi_records_machine on public.kpi_records (machine_id);
create index if not exists idx_kpi_records_section on public.kpi_records (section);

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. KPI SETTINGS — Thresholds for Good/Warning/Critical status
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.kpi_settings (
  id                              text primary key default 'default',
  pm_compliance_good              numeric(5,1) not null default 90,
  pm_compliance_warning           numeric(5,1) not null default 75,
  availability_good               numeric(5,1) not null default 95,
  availability_warning            numeric(5,1) not null default 85,
  mttr_good                       numeric(10,1) not null default 2,
  mttr_warning                    numeric(10,1) not null default 5,
  mtbf_good                       numeric(10,1) not null default 200,
  mtbf_warning                    numeric(10,1) not null default 100,
  breakdown_count_good            integer not null default 2,
  breakdown_count_warning         integer not null default 5,
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now())
);

insert into public.kpi_settings (id) values ('default') on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. KPI FY SHEET — Plant-level PQSCDM Goal Cascade FY 2026-27 (27-col sheet)
-- Stores monthly actuals Apr-Mar and quarterly targets for the 16 KPI rows as JSON
-- Preserves old kpi_records/kpi_settings for backwards compatibility (no DROP)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.kpi_fy_sheet (
  id                              text primary key,
  fy                              text not null unique, -- e.g., '2026-27'
  title                           text not null default 'FY 2026-27 ◆ PQSCDM Goal Cascade ◆ Plant Engg Manager',
  subtitle                        text not null default 'Plant Engineering / Maintenance Manager | Reports to Engg Head | Plant-specific | FY 2026-27',
  data                            jsonb not null default '[]'::jsonb, -- array of KPI rows with Apr..Mar, Q1..Q4, YTD
  created_at                      timestamptz not null default timezone('utc', now()),
  updated_at                      timestamptz not null default timezone('utc', now())
);

insert into public.kpi_fy_sheet (id, fy, data) values ('2026-27', '2026-27', '[]'::jsonb) on conflict (fy) do nothing;

-- =============================================================================
-- 19. MULTI-PLANT FOUNDATION — Plants registry + plant_id on operational tables
-- =============================================================================
-- Additive, idempotent — safe to run on existing production DB without data loss
create table if not exists public.plants (
  id            uuid primary key default gen_random_uuid(),
  plant_code    text not null unique,
  plant_name    text not null,
  location      text not null default '',
  description   text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);

-- Seed Nathupur (existing plant) — idempotent via plant_code, preserves real UUID if already exists
insert into public.plants (id, plant_code, plant_name, location, description, active)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'NATHUPUR',
  'Nathupur Plant',
  'Nathupur, Haryana',
  'Crystal Crop Protection Ltd. — Nathupur Formulation Plant (existing operational plant)',
  true
) on conflict (plant_code) do update set
  plant_name = excluded.plant_name,
  updated_at = timezone('utc', now());

insert into public.plants (plant_code, plant_name, location, description, active)
values
  ('PLANT2', 'Plant 2', '', 'Configurable — rename from Plant Management', true),
  ('PLANT3', 'Plant 3', '', 'Configurable — rename from Plant Management', true)
on conflict (plant_code) do nothing;

create table if not exists public.user_profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  email       text not null default '',
  role        text not null default 'plant_user'
               check (role in ('super_admin','corporate_head','plant_admin','plant_user','viewer','admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_plant_access (
  user_id      uuid not null references auth.users (id) on delete cascade,
  plant_id     uuid not null references public.plants (id) on delete cascade,
  access_level text not null default 'member'
                check (access_level in ('member','admin','viewer')),
  created_at   timestamptz not null default timezone('utc', now()),
  primary key (user_id, plant_id)
);

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  user_name   text not null default '',
  plant_id    uuid references public.plants (id) on delete set null,
  action      text not null,
  module      text not null default '',
  record_id   text not null default '',
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default timezone('utc', now())
);
create index if not exists idx_audit_log_plant on public.audit_log (plant_id, created_at desc);

-- Add plant_id to all plant-specific operational tables (SAFE — nullable first, preserve plant_sec on energy_logs)
alter table public.machines                 add column if not exists plant_id uuid references public.plants (id);
alter table public.breakdown_logs           add column if not exists plant_id uuid references public.plants (id);
alter table public.pm_logs                  add column if not exists plant_id uuid references public.plants (id);
alter table public.energy_logs              add column if not exists plant_id uuid references public.plants (id);
alter table public.amc_records              add column if not exists plant_id uuid references public.plants (id);
alter table public.machine_breakdown_logs   add column if not exists plant_id uuid references public.plants (id);
alter table public.machine_pm_records       add column if not exists plant_id uuid references public.plants (id);
alter table public.plant_sections           add column if not exists plant_id uuid references public.plants (id);
alter table public.daily_utility_log        add column if not exists plant_id uuid references public.plants (id);
alter table public.monthly_herbicide_section add column if not exists plant_id uuid references public.plants (id);
alter table public.monthly_insecticide_section add column if not exists plant_id uuid references public.plants (id);
alter table public.monthly_water_stp        add column if not exists plant_id uuid references public.plants (id);
alter table public.monthly_air_compressor   add column if not exists plant_id uuid references public.plants (id);
alter table public.daily_solar_generation   add column if not exists plant_id uuid references public.plants (id);
alter table public.energy_settings          add column if not exists plant_id uuid references public.plants (id);

create index if not exists idx_machines_plant on public.machines (plant_id);
create index if not exists idx_breakdown_logs_plant on public.breakdown_logs (plant_id);
create index if not exists idx_pm_logs_plant on public.pm_logs (plant_id);
create index if not exists idx_energy_logs_plant on public.energy_logs (plant_id);
create index if not exists idx_amc_records_plant on public.amc_records (plant_id);
create index if not exists idx_machine_bd_logs_plant on public.machine_breakdown_logs (plant_id);
create index if not exists idx_machine_pm_records_plant on public.machine_pm_records (plant_id);
create index if not exists idx_plant_sections_plant on public.plant_sections (plant_id);
create index if not exists idx_daily_utility_log_plant on public.daily_utility_log (plant_id);
create index if not exists idx_monthly_herbicide_plant on public.monthly_herbicide_section (plant_id);
create index if not exists idx_monthly_insecticide_plant on public.monthly_insecticide_section (plant_id);
create index if not exists idx_monthly_water_plant on public.monthly_water_stp (plant_id);
create index if not exists idx_monthly_air_compressor_plant on public.monthly_air_compressor (plant_id);
create index if not exists idx_daily_solar_plant on public.daily_solar_generation (plant_id);

-- Backfill: assign ALL existing records to Nathupur (only where plant_id IS NULL) — dynamic lookup protects against UUID mismatch
do $$
declare
  nathupur_id uuid;
begin
  select id into nathupur_id from public.plants where plant_code = 'NATHUPUR' limit 1;
  if nathupur_id is null then
    nathupur_id := '00000000-0000-0000-0000-000000000001'::uuid;
  end if;
  update public.machines                 set plant_id = nathupur_id where plant_id is null;
  update public.breakdown_logs           set plant_id = nathupur_id where plant_id is null;
  update public.pm_logs                  set plant_id = nathupur_id where plant_id is null;
  update public.energy_logs              set plant_id = nathupur_id where plant_id is null;
  update public.amc_records              set plant_id = nathupur_id where plant_id is null;
  update public.machine_breakdown_logs   set plant_id = nathupur_id where plant_id is null;
  update public.machine_pm_records       set plant_id = nathupur_id where plant_id is null;
  update public.plant_sections           set plant_id = nathupur_id where plant_id is null;
  update public.daily_utility_log        set plant_id = nathupur_id where plant_id is null;
  update public.monthly_herbicide_section set plant_id = nathupur_id where plant_id is null;
  update public.monthly_insecticide_section set plant_id = nathupur_id where plant_id is null;
  update public.monthly_water_stp        set plant_id = nathupur_id where plant_id is null;
  update public.monthly_air_compressor   set plant_id = nathupur_id where plant_id is null;
  update public.daily_solar_generation   set plant_id = nathupur_id where plant_id is null;
  update public.energy_settings          set plant_id = nathupur_id where plant_id is null;
end $$;

-- Verification view for migration report
create or replace view public.v_migration_plant_backfill_report as
select
  'machines' as table_name,
  (select count(*) from public.machines) as total,
  (select count(*) from public.machines where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)) as nathupur,
  (select count(*) from public.machines where plant_id is null) as unassigned
union all
select 'breakdown_logs', (select count(*) from public.breakdown_logs), (select count(*) from public.breakdown_logs where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.breakdown_logs where plant_id is null)
union all
select 'pm_logs', (select count(*) from public.pm_logs), (select count(*) from public.pm_logs where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.pm_logs where plant_id is null)
union all
select 'energy_logs', (select count(*) from public.energy_logs), (select count(*) from public.energy_logs where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.energy_logs where plant_id is null)
union all
select 'amc_records', (select count(*) from public.amc_records), (select count(*) from public.amc_records where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.amc_records where plant_id is null)
union all
select 'machine_breakdown_logs', (select count(*) from public.machine_breakdown_logs), (select count(*) from public.machine_breakdown_logs where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.machine_breakdown_logs where plant_id is null)
union all
select 'machine_pm_records', (select count(*) from public.machine_pm_records), (select count(*) from public.machine_pm_records where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.machine_pm_records where plant_id is null)
union all
select 'plant_sections', (select count(*) from public.plant_sections), (select count(*) from public.plant_sections where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.plant_sections where plant_id is null)
union all
select 'daily_utility_log', (select count(*) from public.daily_utility_log), (select count(*) from public.daily_utility_log where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.daily_utility_log where plant_id is null)
union all
select 'daily_solar_generation', (select count(*) from public.daily_solar_generation), (select count(*) from public.daily_solar_generation where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.daily_solar_generation where plant_id is null);

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
alter table public.kpi_records              enable row level security;
alter table public.kpi_settings             enable row level security;
alter table public.kpi_fy_sheet             enable row level security;

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
drop policy if exists "public kpi records access"           on public.kpi_records;
drop policy if exists "public kpi settings access"          on public.kpi_settings;
drop policy if exists "public kpi fy sheet access"         on public.kpi_fy_sheet;

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

create policy "public kpi records access"
  on public.kpi_records for all to anon, authenticated
  using (true) with check (true);

create policy "public kpi settings access"
  on public.kpi_settings for all to anon, authenticated
  using (true) with check (true);

create policy "public kpi fy sheet access"
  on public.kpi_fy_sheet for all to anon, authenticated
  using (true) with check (true);

-- ── Multi-plant RLS (plants, user_profiles, user_plant_access, audit_log) ─────
alter table public.plants              enable row level security;
alter table public.user_profiles       enable row level security;
alter table public.user_plant_access   enable row level security;
alter table public.audit_log           enable row level security;

drop policy if exists "plants read all authenticated" on public.plants;
create policy "plants read all authenticated"
  on public.plants for select to authenticated, anon using (true);

drop policy if exists "plants super_admin write" on public.plants;
create policy "plants super_admin write"
  on public.plants for all to authenticated
  using (
    exists (select 1 from public.user_profiles
            where user_profiles.user_id = auth.uid()
            and user_profiles.role in ('super_admin','admin'))
  )
  with check (
    exists (select 1 from public.user_profiles
            where user_profiles.user_id = auth.uid()
            and user_profiles.role in ('super_admin','admin'))
  );

-- Plant-scoped helper function (idempotent)
create or replace function public.can_access_plant(target_plant_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.user_profiles up
      where up.user_id = auth.uid()
      and up.role in ('super_admin','corporate_head','admin')
    )
    or exists (
      select 1 from public.user_plant_access upa
      where upa.user_id = auth.uid()
      and upa.plant_id = target_plant_id
    )
    or not exists (
      select 1 from public.user_plant_access where user_id = auth.uid()
    )
    or target_plant_id is null;
$$;

-- Replace permissive policies with plant-scoped ones where appropriate (keep anon read for backwards compat)
drop policy if exists "public machines access" on public.machines;
drop policy if exists "machines plant scoped" on public.machines;
create policy "machines plant scoped"
  on public.machines for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "machines anon read" on public.machines;
create policy "machines anon read" on public.machines for select to anon using (true);

drop policy if exists "public breakdown access" on public.breakdown_logs;
drop policy if exists "breakdown_logs plant scoped" on public.breakdown_logs;
create policy "breakdown_logs plant scoped"
  on public.breakdown_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "breakdown_logs anon read" on public.breakdown_logs;
create policy "breakdown_logs anon read" on public.breakdown_logs for select to anon using (true);

drop policy if exists "public pm access" on public.pm_logs;
drop policy if exists "pm_logs plant scoped" on public.pm_logs;
create policy "pm_logs plant scoped"
  on public.pm_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "pm_logs anon read" on public.pm_logs;
create policy "pm_logs anon read" on public.pm_logs for select to anon using (true);

drop policy if exists "public energy access" on public.energy_logs;
drop policy if exists "energy_logs plant scoped" on public.energy_logs;
create policy "energy_logs plant scoped"
  on public.energy_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "energy_logs anon read" on public.energy_logs;
create policy "energy_logs anon read" on public.energy_logs for select to anon using (true);

drop policy if exists "public amc access" on public.amc_records;
drop policy if exists "amc_records plant scoped" on public.amc_records;
create policy "amc_records plant scoped"
  on public.amc_records for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "amc_records anon read" on public.amc_records;
create policy "amc_records anon read" on public.amc_records for select to anon using (true);

drop policy if exists "public machine bd logs access" on public.machine_breakdown_logs;
drop policy if exists "machine_breakdown_logs plant scoped" on public.machine_breakdown_logs;
create policy "machine_breakdown_logs plant scoped"
  on public.machine_breakdown_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "machine_breakdown_logs anon read" on public.machine_breakdown_logs;
create policy "machine_breakdown_logs anon read" on public.machine_breakdown_logs for select to anon using (true);

drop policy if exists "public machine pm records access" on public.machine_pm_records;
drop policy if exists "machine_pm_records plant scoped" on public.machine_pm_records;
create policy "machine_pm_records plant scoped"
  on public.machine_pm_records for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "machine_pm_records anon read" on public.machine_pm_records;
create policy "machine_pm_records anon read" on public.machine_pm_records for select to anon using (true);

drop policy if exists "public plant sections access" on public.plant_sections;
drop policy if exists "plant_sections plant scoped" on public.plant_sections;
create policy "plant_sections plant scoped"
  on public.plant_sections for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "plant_sections anon read" on public.plant_sections;
create policy "plant_sections anon read" on public.plant_sections for select to anon using (true);

drop policy if exists "public daily utility access" on public.daily_utility_log;
drop policy if exists "daily_utility_log plant scoped" on public.daily_utility_log;
create policy "daily_utility_log plant scoped"
  on public.daily_utility_log for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "daily_utility_log anon read" on public.daily_utility_log;
create policy "daily_utility_log anon read" on public.daily_utility_log for select to anon using (true);

drop policy if exists "public monthly herbicide access" on public.monthly_herbicide_section;
drop policy if exists "monthly_herbicide_section plant scoped" on public.monthly_herbicide_section;
create policy "monthly_herbicide_section plant scoped"
  on public.monthly_herbicide_section for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_herbicide_section anon read" on public.monthly_herbicide_section;
create policy "monthly_herbicide_section anon read" on public.monthly_herbicide_section for select to anon using (true);

drop policy if exists "public monthly insecticide access" on public.monthly_insecticide_section;
drop policy if exists "monthly_insecticide_section plant scoped" on public.monthly_insecticide_section;
create policy "monthly_insecticide_section plant scoped"
  on public.monthly_insecticide_section for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_insecticide_section anon read" on public.monthly_insecticide_section;
create policy "monthly_insecticide_section anon read" on public.monthly_insecticide_section for select to anon using (true);

drop policy if exists "public monthly water stp access" on public.monthly_water_stp;
drop policy if exists "monthly_water_stp plant scoped" on public.monthly_water_stp;
create policy "monthly_water_stp plant scoped"
  on public.monthly_water_stp for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_water_stp anon read" on public.monthly_water_stp;
create policy "monthly_water_stp anon read" on public.monthly_water_stp for select to anon using (true);

drop policy if exists "public monthly air compressor access" on public.monthly_air_compressor;
drop policy if exists "monthly_air_compressor plant scoped" on public.monthly_air_compressor;
create policy "monthly_air_compressor plant scoped"
  on public.monthly_air_compressor for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_air_compressor anon read" on public.monthly_air_compressor;
create policy "monthly_air_compressor anon read" on public.monthly_air_compressor for select to anon using (true);

drop policy if exists "public daily solar access" on public.daily_solar_generation;
drop policy if exists "daily_solar_generation plant scoped" on public.daily_solar_generation;
create policy "daily_solar_generation plant scoped"
  on public.daily_solar_generation for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "daily_solar_generation anon read" on public.daily_solar_generation;
create policy "daily_solar_generation anon read" on public.daily_solar_generation for select to anon using (true);

drop policy if exists "public energy settings access" on public.energy_settings;
drop policy if exists "energy_settings plant scoped" on public.energy_settings;
create policy "energy_settings plant scoped"
  on public.energy_settings for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "energy_settings anon read" on public.energy_settings;
create policy "energy_settings anon read" on public.energy_settings for select to anon using (true);

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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kpi_records'
  ) then
    alter publication supabase_realtime add table public.kpi_records;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kpi_settings'
  ) then
    alter publication supabase_realtime add table public.kpi_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kpi_fy_sheet'
  ) then
    alter publication supabase_realtime add table public.kpi_fy_sheet;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plants'
  ) then
    alter publication supabase_realtime add table public.plants;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_profiles'
  ) then
    alter publication supabase_realtime add table public.user_profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_plant_access'
  ) then
    alter publication supabase_realtime add table public.user_plant_access;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_log'
  ) then
    alter publication supabase_realtime add table public.audit_log;
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
alter table public.kpi_records             replica identity full;
alter table public.kpi_settings            replica identity full;
alter table public.kpi_fy_sheet            replica identity full;
alter table public.plants                  replica identity full;
alter table public.user_profiles           replica identity full;
alter table public.user_plant_access       replica identity full;
alter table public.audit_log               replica identity full;

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
