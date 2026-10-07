-- =============================================================================
-- 20261007_permissive_anon_operational_access.sql
--
-- WHY THIS EXISTS:
--   The app authenticates users with its own login (Express API cookie +
--   offline directory: Prince / viewer / corporate / plant2admin) — NOT with
--   Supabase Auth. The Supabase JS client therefore talks to PostgREST with
--   the anon key. The plant-scoped migrations replaced the original
--   permissive policies with `FOR ALL TO authenticated` policies, which
--   rejects every app write with:
--     "new row violates row-level security policy" (HTTP 401)
--   ...even for a super_admin logged into the app, because there is no
--   Supabase Auth JWT (auth.uid() is NULL).
--
-- WHAT THIS DOES:
--   Restores the ORIGINAL permissive policies from supabase/schema.sql on the
--   15 operational tables only:
--     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
--   App-level authorization (role + plant filtering) stays enforced in the
--   client (PlantContext / enrichUser) and the Express API, exactly as the
--   project was designed before the Supabase-Auth rollout.
--
-- WHAT THIS DOES *NOT* TOUCH:
--   plants, user_profiles, user_plant_access, audit_log,
--   notification_*, testing_certificates, kpi_*, storage.objects —
--   those keep whatever policies they already have.
--
-- All statements are idempotent (DROP POLICY IF EXISTS). Safe to re-run.
-- =============================================================================

-- ── machines ───────────────────────────────────────────────────────────────
drop policy if exists "machines plant scoped"  on public.machines;
drop policy if exists "machines anon read"     on public.machines;
drop policy if exists "public machines access" on public.machines;
create policy "public machines access"
  on public.machines for all to anon, authenticated
  using (true) with check (true);

-- ── breakdown_logs ─────────────────────────────────────────────────────────
drop policy if exists "breakdown_logs plant scoped" on public.breakdown_logs;
drop policy if exists "breakdown_logs anon read"    on public.breakdown_logs;
drop policy if exists "public breakdown access"     on public.breakdown_logs;
create policy "public breakdown access"
  on public.breakdown_logs for all to anon, authenticated
  using (true) with check (true);

-- ── pm_logs ────────────────────────────────────────────────────────────────
drop policy if exists "pm_logs plant scoped" on public.pm_logs;
drop policy if exists "pm_logs anon read"    on public.pm_logs;
drop policy if exists "public pm access"      on public.pm_logs;
create policy "public pm access"
  on public.pm_logs for all to anon, authenticated
  using (true) with check (true);

-- ── energy_logs ────────────────────────────────────────────────────────────
drop policy if exists "energy_logs plant scoped" on public.energy_logs;
drop policy if exists "energy_logs anon read"    on public.energy_logs;
drop policy if exists "public energy access"     on public.energy_logs;
create policy "public energy access"
  on public.energy_logs for all to anon, authenticated
  using (true) with check (true);

-- ── amc_records ────────────────────────────────────────────────────────────
drop policy if exists "amc_records plant scoped" on public.amc_records;
drop policy if exists "amc_records anon read"    on public.amc_records;
drop policy if exists "public amc access"        on public.amc_records;
create policy "public amc access"
  on public.amc_records for all to anon, authenticated
  using (true) with check (true);

-- ── machine_breakdown_logs ─────────────────────────────────────────────────
drop policy if exists "machine_breakdown_logs plant scoped" on public.machine_breakdown_logs;
drop policy if exists "machine_breakdown_logs anon read"    on public.machine_breakdown_logs;
drop policy if exists "public machine bd logs access"       on public.machine_breakdown_logs;
create policy "public machine bd logs access"
  on public.machine_breakdown_logs for all to anon, authenticated
  using (true) with check (true);

-- ── machine_pm_records ─────────────────────────────────────────────────────
drop policy if exists "machine_pm_records plant scoped"   on public.machine_pm_records;
drop policy if exists "machine_pm_records anon read"      on public.machine_pm_records;
drop policy if exists "public machine_pm_records access"  on public.machine_pm_records;
drop policy if exists "public machine pm records access" on public.machine_pm_records;
create policy "public machine pm records access"
  on public.machine_pm_records for all to anon, authenticated
  using (true) with check (true);

-- ── plant_sections ─────────────────────────────────────────────────────────
drop policy if exists "plant_sections plant scoped"  on public.plant_sections;
drop policy if exists "plant_sections anon read"     on public.plant_sections;
drop policy if exists "public plant_sections access" on public.plant_sections;
drop policy if exists "public plant sections access" on public.plant_sections;
create policy "public plant sections access"
  on public.plant_sections for all to anon, authenticated
  using (true) with check (true);

-- ── daily_utility_log ──────────────────────────────────────────────────────
drop policy if exists "daily_utility_log plant scoped" on public.daily_utility_log;
drop policy if exists "daily_utility_log anon read"    on public.daily_utility_log;
drop policy if exists "public daily utility access"    on public.daily_utility_log;
create policy "public daily utility access"
  on public.daily_utility_log for all to anon, authenticated
  using (true) with check (true);

-- ── monthly_herbicide_section ──────────────────────────────────────────────
drop policy if exists "monthly_herbicide_section plant scoped" on public.monthly_herbicide_section;
drop policy if exists "monthly_herbicide_section anon read"    on public.monthly_herbicide_section;
drop policy if exists "public monthly herbicide access"        on public.monthly_herbicide_section;
create policy "public monthly herbicide access"
  on public.monthly_herbicide_section for all to anon, authenticated
  using (true) with check (true);

-- ── monthly_insecticide_section ────────────────────────────────────────────
drop policy if exists "monthly_insecticide_section plant scoped" on public.monthly_insecticide_section;
drop policy if exists "monthly_insecticide_section anon read"    on public.monthly_insecticide_section;
drop policy if exists "public monthly insecticide access"       on public.monthly_insecticide_section;
create policy "public monthly insecticide access"
  on public.monthly_insecticide_section for all to anon, authenticated
  using (true) with check (true);

-- ── monthly_water_stp ──────────────────────────────────────────────────────
drop policy if exists "monthly_water_stp plant scoped" on public.monthly_water_stp;
drop policy if exists "monthly_water_stp anon read"    on public.monthly_water_stp;
drop policy if exists "public monthly water stp access" on public.monthly_water_stp;
create policy "public monthly water stp access"
  on public.monthly_water_stp for all to anon, authenticated
  using (true) with check (true);

-- ── monthly_air_compressor ─────────────────────────────────────────────────
drop policy if exists "monthly_air_compressor plant scoped" on public.monthly_air_compressor;
drop policy if exists "monthly_air_compressor anon read"    on public.monthly_air_compressor;
drop policy if exists "public monthly air compressor access" on public.monthly_air_compressor;
create policy "public monthly air compressor access"
  on public.monthly_air_compressor for all to anon, authenticated
  using (true) with check (true);

-- ── daily_solar_generation ─────────────────────────────────────────────────
drop policy if exists "daily_solar_generation plant scoped" on public.daily_solar_generation;
drop policy if exists "daily_solar_generation anon read"    on public.daily_solar_generation;
drop policy if exists "public daily solar access"           on public.daily_solar_generation;
create policy "public daily solar access"
  on public.daily_solar_generation for all to anon, authenticated
  using (true) with check (true);

-- ── energy_settings ────────────────────────────────────────────────────────
drop policy if exists "energy_settings plant scoped"  on public.energy_settings;
drop policy if exists "energy_settings anon read"     on public.energy_settings;
drop policy if exists "public energy settings access" on public.energy_settings;
create policy "public energy settings access"
  on public.energy_settings for all to anon, authenticated
  using (true) with check (true);
