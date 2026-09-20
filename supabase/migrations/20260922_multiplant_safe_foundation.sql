-- =============================================================================
-- CCPL Multi-Plant Foundation — SAFE Additive Migration (20260922)
-- =============================================================================
-- PURPOSE: Fix live database schema mismatch where frontend queries plant_id
-- but live DB missing plants table and plant_id columns.
-- This migration is 100% additive and idempotent: IF NOT EXISTS / ON CONFLICT.
-- NEVER: DROP TABLE, TRUNCATE, DELETE production data, recreate tables.
-- PRESERVES: energy_logs.plant_sec (does NOT rename), existing data.
-- BACKFILLS: all existing records to Nathupur plant where plant_id IS NULL.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PLANTS — central registry (safe create)
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

-- Seed Nathupur — fixed UUID is intentional: app hard-codes 000...0001 as fallback.
-- Use plant_code conflict to be idempotent; preserve any existing real UUID if present,
-- but ensure NATHUPUR exists. If a random UUID already exists for NATHUPUR, we keep it
-- and the backfill below will dynamically lookup by plant_code (not hardcoded UUID).
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SUPPORTING TABLES (user_profiles, user_plant_access, audit_log)
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
create index if not exists idx_audit_log_user on public.audit_log (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ADD plant_id TO ALL PLANT-SCOPED TABLES (SAFE — nullable first)
--    Preserve energy_logs.plant_sec — add plant_id as separate new column.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- Performance indexes for plant-scoped queries
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BACKFILL — assign ALL existing records to Nathupur (WHERE plant_id IS NULL)
--    Uses dynamic lookup by plant_code so it works even if NATHUPUR has a random UUID.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  nathupur_id uuid;
begin
  select id into nathupur_id from public.plants where plant_code = 'NATHUPUR' limit 1;
  if nathupur_id is null then
    -- Defensive: should not happen, but fallback to fixed UUID if lookup fails
    nathupur_id := '00000000-0000-0000-0000-000000000001'::uuid;
    -- Ensure plants row exists for FK before updating
    insert into public.plants (id, plant_code, plant_name, location, description, active)
    values (nathupur_id, 'NATHUPUR', 'Nathupur Plant', 'Nathupur, Haryana', 'Crystal Crop Protection Ltd. — Nathupur Formulation Plant', true)
    on conflict (plant_code) do nothing;
    select id into nathupur_id from public.plants where plant_code = 'NATHUPUR' limit 1;
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

  raise notice 'Backfill complete — all existing records assigned to Nathupur (%)', nathupur_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VERIFICATION VIEW — for post-migration validation (counts per table)
-- ─────────────────────────────────────────────────────────────────────────────
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
select 'monthly_herbicide_section', (select count(*) from public.monthly_herbicide_section), (select count(*) from public.monthly_herbicide_section where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.monthly_herbicide_section where plant_id is null)
union all
select 'monthly_insecticide_section', (select count(*) from public.monthly_insecticide_section), (select count(*) from public.monthly_insecticide_section where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.monthly_insecticide_section where plant_id is null)
union all
select 'monthly_water_stp', (select count(*) from public.monthly_water_stp), (select count(*) from public.monthly_water_stp where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.monthly_water_stp where plant_id is null)
union all
select 'monthly_air_compressor', (select count(*) from public.monthly_air_compressor), (select count(*) from public.monthly_air_compressor where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.monthly_air_compressor where plant_id is null)
union all
select 'daily_solar_generation', (select count(*) from public.daily_solar_generation), (select count(*) from public.daily_solar_generation where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.daily_solar_generation where plant_id is null)
union all
select 'energy_settings', (select count(*) from public.energy_settings), (select count(*) from public.energy_settings where plant_id = (select id from public.plants where plant_code='NATHUPUR' limit 1)), (select count(*) from public.energy_settings where plant_id is null);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — plants + supporting tables (permissive for bootstrap, strict via can_access_plant for operational tables)
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

-- Helper: can current user access target plant?
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

-- Operational tables: plant-scoped for authenticated, anon retains read (backwards compat until Auth fully enforced)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. REALTIME — add new tables to publication (idempotent)
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

-- NOTE: Do NOT make plant_id NOT NULL yet — keep nullable until backfill verified.
-- Future migration can add NOT NULL constraint after validation.
-- Do NOT rename energy_logs.plant_sec — it is preserved as legacy column alongside new plant_id.
