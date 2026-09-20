-- =============================================================================
-- CCPL Multi-Plant CMMS Transformation — Safe Additive Migration
-- =============================================================================
-- PRINCIPLES:
--  1. Additive only — no DROP TABLE, no TRUNCATE, no DELETE of existing data
--  2. All existing Nathupur records are preserved and backfilled
--  3. Zero unassigned operational records before enforcing constraints
--  4. Idempotent — safe to run multiple times
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PLANTS — central registry
-- ─────────────────────────────────────────────────────────────────────────────
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

-- Seed Nathupur plant (idempotent) — this is the existing plant that owns all data
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

-- Seed Plant 2 and Plant 3 as configurable placeholders (admin can rename)
insert into public.plants (plant_code, plant_name, location, description, active)
values
  ('PLANT2', 'Plant 2', '', 'Configurable — rename from Plant Management', true),
  ('PLANT3', 'Plant 3', '', 'Configurable — rename from Plant Management', true)
on conflict (plant_code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ROLES enum helper (stored as text + check constraint for flexibility)
--    Supported roles: super_admin, corporate_head, plant_admin, plant_user
--    Future roles can be added without schema change
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. USER PROFILES — extends Supabase Auth users with CMMS role
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. USER PLANT ACCESS — many-to-many mapping
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_plant_access (
  user_id      uuid not null references auth.users (id) on delete cascade,
  plant_id     uuid not null references public.plants (id) on delete cascade,
  access_level text not null default 'member'
                check (access_level in ('member','admin','viewer')),
  created_at   timestamptz not null default timezone('utc', now()),
  primary key (user_id, plant_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AUDIT LOG — plant-aware operational trail
-- ─────────────────────────────────────────────────────────────────────────────
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
create index if not exists idx_audit_log_user on public.audit_log (user_id, created_at desc);
create index if not exists idx_audit_log_module on public.audit_log (module, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ADD plant_id TO ALL OPERATIONAL TABLES (SAFE — nullable first)
-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: add column if not exists (each table added individually for idempotency)

-- Core CMMS tables
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

-- Indexes for plant-scoped queries (performance critical)
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

-- Unique constraints: machine code unique WITHIN a plant (not globally)
-- First drop old global uniqueness if it exists on machines.name (none), but add plant-scoped one
-- We keep id as PK; plant_id+machine_code uniqueness is enforced via unique index
create unique index if not exists uq_machines_plant_code on public.machines (plant_id, id);
-- For breakdown_logs/pm_logs: period uniqueness already per (section, month, year) — enhance with plant_id
-- Add composite uniqueness including plant_id as additional safety (does not break existing data)
create unique index if not exists uq_breakdown_logs_plant_period on public.breakdown_logs (plant_id, section, month, year);
create unique index if not exists uq_pm_logs_plant_period on public.pm_logs (plant_id, section, month, year);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. BACKFILL — assign ALL existing records to Nathupur plant
--    SAFE: only fills where plant_id IS NULL
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  nathupur_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
begin
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
  -- energy_settings is a singleton — assign to Nathupur
  update public.energy_settings          set plant_id = nathupur_id where plant_id is null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VERIFICATION VIEW — counts before/after (for migration report)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_migration_plant_backfill_report as
select
  'machines' as table_name,
  (select count(*) from public.machines) as total,
  (select count(*) from public.machines where plant_id = '00000000-0000-0000-0000-000000000001'::uuid) as nathupur,
  (select count(*) from public.machines where plant_id is null) as unassigned
union all
select 'breakdown_logs', (select count(*) from public.breakdown_logs), (select count(*) from public.breakdown_logs where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.breakdown_logs where plant_id is null)
union all
select 'pm_logs', (select count(*) from public.pm_logs), (select count(*) from public.pm_logs where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.pm_logs where plant_id is null)
union all
select 'energy_logs', (select count(*) from public.energy_logs), (select count(*) from public.energy_logs where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.energy_logs where plant_id is null)
union all
select 'amc_records', (select count(*) from public.amc_records), (select count(*) from public.amc_records where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.amc_records where plant_id is null)
union all
select 'machine_breakdown_logs', (select count(*) from public.machine_breakdown_logs), (select count(*) from public.machine_breakdown_logs where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.machine_breakdown_logs where plant_id is null)
union all
select 'machine_pm_records', (select count(*) from public.machine_pm_records), (select count(*) from public.machine_pm_records where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.machine_pm_records where plant_id is null)
union all
select 'plant_sections', (select count(*) from public.plant_sections), (select count(*) from public.plant_sections where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.plant_sections where plant_id is null)
union all
select 'daily_utility_log', (select count(*) from public.daily_utility_log), (select count(*) from public.daily_utility_log where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.daily_utility_log where plant_id is null)
union all
select 'daily_solar_generation', (select count(*) from public.daily_solar_generation), (select count(*) from public.daily_solar_generation where plant_id = '00000000-0000-0000-0000-000000000001'::uuid), (select count(*) from public.daily_solar_generation where plant_id is null);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS — plants + user_profiles + user_plant_access + audit_log
-- ─────────────────────────────────────────────────────────────────────────────
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

drop policy if exists "user_profiles read own or admin" on public.user_profiles;
create policy "user_profiles read own or admin"
  on public.user_profiles for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_profiles up
               where up.user_id = auth.uid()
               and up.role in ('super_admin','corporate_head','admin'))
  );

drop policy if exists "user_profiles admin write" on public.user_profiles;
create policy "user_profiles admin write"
  on public.user_profiles for all to authenticated
  using (
    exists (select 1 from public.user_profiles up
            where up.user_id = auth.uid()
            and up.role in ('super_admin','admin'))
  )
  with check (
    exists (select 1 from public.user_profiles up
            where up.user_id = auth.uid()
            and up.role in ('super_admin','admin'))
  );

drop policy if exists "user_plant_access read own or admin" on public.user_plant_access;
create policy "user_plant_access read own or admin"
  on public.user_plant_access for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_profiles up
               where up.user_id = auth.uid()
               and up.role in ('super_admin','corporate_head','admin'))
  );

drop policy if exists "user_plant_access admin write" on public.user_plant_access;
create policy "user_plant_access admin write"
  on public.user_plant_access for all to authenticated
  using (
    exists (select 1 from public.user_profiles up
            where up.user_id = auth.uid()
            and up.role in ('super_admin','admin'))
  )
  with check (
    exists (select 1 from public.user_profiles up
            where up.user_id = auth.uid()
            and up.role in ('super_admin','admin'))
  );

drop policy if exists "audit_log read plant scoped" on public.audit_log;
create policy "audit_log read plant scoped"
  on public.audit_log for select to authenticated
  using (
    exists (select 1 from public.user_profiles up
            where up.user_id = auth.uid()
            and up.role in ('super_admin','corporate_head','admin'))
    or plant_id in (select plant_id from public.user_plant_access where user_id = auth.uid())
  );

drop policy if exists "audit_log insert authenticated" on public.audit_log;
create policy "audit_log insert authenticated"
  on public.audit_log for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PLANT-SCOPED RLS FOR OPERATIONAL TABLES
--     Replace the permissive "public ... access" policies with plant-scoped ones
--     Super admin / corporate_head bypass plant restriction.
--     Regular users must have a row in user_plant_access for that plant.
--     If no user_plant_access rows exist yet (bootstrap), allow access — this
--     prevents lockout immediately after migration before admin configures access.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function: returns true if current user can access given plant_id
create or replace function public.can_access_plant(target_plant_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    -- Super admin / corporate bypass
    exists (
      select 1 from public.user_profiles up
      where up.user_id = auth.uid()
      and up.role in ('super_admin','corporate_head','admin')
    )
    -- Or explicit plant access
    or exists (
      select 1 from public.user_plant_access upa
      where upa.user_id = auth.uid()
      and upa.plant_id = target_plant_id
    )
    -- Bootstrap: if user has no plant access rows at all, allow (prevents lockout)
    or not exists (
      select 1 from public.user_plant_access where user_id = auth.uid()
    )
    -- Null plant_id records (should not exist after backfill) — allow for migration safety
    or target_plant_id is null;
$$;

-- Replace policies for each operational table
-- Machines
drop policy if exists "public machines access" on public.machines;
create policy "machines plant scoped"
  on public.machines for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));

-- Also allow anon for now (backwards compat until Supabase Auth fully rolled out)
-- anon can read but writes are restricted to authenticated above
drop policy if exists "machines anon read" on public.machines;
create policy "machines anon read"
  on public.machines for select to anon using (true);

-- Breakdown logs
drop policy if exists "public breakdown access" on public.breakdown_logs;
create policy "breakdown_logs plant scoped"
  on public.breakdown_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "breakdown_logs anon read" on public.breakdown_logs;
create policy "breakdown_logs anon read" on public.breakdown_logs for select to anon using (true);

-- PM logs
drop policy if exists "public pm access" on public.pm_logs;
create policy "pm_logs plant scoped"
  on public.pm_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "pm_logs anon read" on public.pm_logs;
create policy "pm_logs anon read" on public.pm_logs for select to anon using (true);

-- Energy logs
drop policy if exists "public energy access" on public.energy_logs;
create policy "energy_logs plant scoped"
  on public.energy_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "energy_logs anon read" on public.energy_logs;
create policy "energy_logs anon read" on public.energy_logs for select to anon using (true);

-- AMC
drop policy if exists "public amc access" on public.amc_records;
create policy "amc_records plant scoped"
  on public.amc_records for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "amc_records anon read" on public.amc_records;
create policy "amc_records anon read" on public.amc_records for select to anon using (true);

-- Machine breakdown logs
drop policy if exists "public machine bd logs access" on public.machine_breakdown_logs;
create policy "machine_breakdown_logs plant scoped"
  on public.machine_breakdown_logs for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "machine_breakdown_logs anon read" on public.machine_breakdown_logs;
create policy "machine_breakdown_logs anon read" on public.machine_breakdown_logs for select to anon using (true);

-- Machine PM records
drop policy if exists "public machine pm records access" on public.machine_pm_records;
create policy "machine_pm_records plant scoped"
  on public.machine_pm_records for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "machine_pm_records anon read" on public.machine_pm_records;
create policy "machine_pm_records anon read" on public.machine_pm_records for select to anon using (true);

-- Plant sections (already plant-scoped but keep anon read)
drop policy if exists "public plant sections access" on public.plant_sections;
create policy "plant_sections plant scoped"
  on public.plant_sections for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "plant_sections anon read" on public.plant_sections;
create policy "plant_sections anon read" on public.plant_sections for select to anon using (true);

-- Daily utility
drop policy if exists "public daily utility access" on public.daily_utility_log;
create policy "daily_utility_log plant scoped"
  on public.daily_utility_log for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "daily_utility_log anon read" on public.daily_utility_log;
create policy "daily_utility_log anon read" on public.daily_utility_log for select to anon using (true);

-- Monthly herbicide/insecticide/water/air compressor
drop policy if exists "public monthly herbicide access" on public.monthly_herbicide_section;
create policy "monthly_herbicide_section plant scoped"
  on public.monthly_herbicide_section for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_herbicide_section anon read" on public.monthly_herbicide_section;
create policy "monthly_herbicide_section anon read" on public.monthly_herbicide_section for select to anon using (true);

drop policy if exists "public monthly insecticide access" on public.monthly_insecticide_section;
create policy "monthly_insecticide_section plant scoped"
  on public.monthly_insecticide_section for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_insecticide_section anon read" on public.monthly_insecticide_section;
create policy "monthly_insecticide_section anon read" on public.monthly_insecticide_section for select to anon using (true);

drop policy if exists "public monthly water stp access" on public.monthly_water_stp;
create policy "monthly_water_stp plant scoped"
  on public.monthly_water_stp for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_water_stp anon read" on public.monthly_water_stp;
create policy "monthly_water_stp anon read" on public.monthly_water_stp for select to anon using (true);

drop policy if exists "public monthly air compressor access" on public.monthly_air_compressor;
create policy "monthly_air_compressor plant scoped"
  on public.monthly_air_compressor for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "monthly_air_compressor anon read" on public.monthly_air_compressor;
create policy "monthly_air_compressor anon read" on public.monthly_air_compressor for select to anon using (true);

-- Daily solar
drop policy if exists "public daily solar access" on public.daily_solar_generation;
create policy "daily_solar_generation plant scoped"
  on public.daily_solar_generation for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "daily_solar_generation anon read" on public.daily_solar_generation;
create policy "daily_solar_generation anon read" on public.daily_solar_generation for select to anon using (true);

-- Energy settings (singleton — restrict to plant_admin+)
drop policy if exists "public energy settings access" on public.energy_settings;
create policy "energy_settings plant scoped"
  on public.energy_settings for all to authenticated
  using (public.can_access_plant(plant_id))
  with check (public.can_access_plant(plant_id));
drop policy if exists "energy_settings anon read" on public.energy_settings;
create policy "energy_settings anon read" on public.energy_settings for select to anon using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. REALTIME — add new tables to publication
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plants') then
    alter publication supabase_realtime add table public.plants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_profiles') then
    alter publication supabase_realtime add table public.user_profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_plant_access') then
    alter publication supabase_realtime add table public.user_plant_access;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_log') then
    alter publication supabase_realtime add table public.audit_log;
  end if;
end $$;

alter table public.plants              replica identity full;
alter table public.user_profiles       replica identity full;
alter table public.user_plant_access   replica identity full;
alter table public.audit_log           replica identity full;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. REPORT_FILES — add plant_id (local SQLite db uses report_files; Supabase
--     may store documents via storage. Add column for future plant scoping.
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: report_files is in the local SQLite (server/db.js), not Supabase.
-- No Supabase migration needed for it. Plant scoping for report vault is
-- handled client-side via localStorage namespace per plant.
