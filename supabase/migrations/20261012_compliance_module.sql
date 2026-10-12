-- =============================================================================
-- 20261012_compliance_module.sql — Inspection, Calibration & Statutory
-- Compliance register (non-machine equipment) + inspection history.
--
-- AUTHORIZATION MODEL (audited decision — read before changing):
--   This application authenticates users with its own login (Express API
--   cookie + offline directory: Prince/viewer/corporate/plant2admin) and does
--   NOT use Supabase Auth, so PostgREST requests arrive with the anon key and
--   auth.uid() is always NULL. Policies below therefore mirror the existing
--   "public testing certificates access" precedent (permissive anon), exactly
--   like testing_certificates, kpi_* and the energy tables. Real enforcement
--   lives in the app layer, same as every other module:
--     • commitAndQueue() overwrites plant_id from the current plant context
--       (client-supplied plant IDs are never trusted),
--     • getPlantScopedData() + authorizedPlants filter reads per plant,
--     • role-gated UI (canUpload/canDelete) + Express API auth.
--   Switching these tables to auth.uid() policies would silently block ALL
--   writes (proven by the pm_logs/energy RLS incident). Do not "harden" this
--   without first rolling out Supabase Auth end-to-end.
--
-- SAFETY: creates new tables only. No ALTER/DROP of existing tables, no data
-- migration, no changes to machine certificates or any other module.
-- All statements are idempotent.
-- =============================================================================

-- ── compliance_equipment ───────────────────────────────────────────────────
create table if not exists public.compliance_equipment (
  id                  text primary key,
  plant_id            uuid not null,
  equipment_code      text not null,
  category            text not null default 'other',
  custom_category     text not null default '',
  equipment_name      text not null default '',
  equipment_type      text not null default '',
  department          text not null default '',
  area                text not null default '',
  manufacturer        text not null default '',
  model               text not null default '',
  serial_number       text not null default '',
  asset_tag           text not null default '',
  install_date        date,
  purchase_date       date,
  range_value         text not null default '',
  accuracy            text not null default '',
  capacity_value      text not null default '',
  unit                text not null default '',
  swl                 text not null default '',
  inspection_type     text not null default '',
  standard            text not null default '',
  responsible_department text not null default '',
  responsible_person  text not null default '',
  frequency_months    integer not null default 12,
  next_due_date       date,
  status              text not null default 'NO_CERTIFICATE',
  serviceability      text not null default 'Serviceable',
  remarks             text not null default '',
  document            jsonb,
  linked_machine_id   text not null default '',
  linked_machine_name text not null default '',
  linked_machine_cert_id text not null default '',
  linked_machine_cert_number text not null default '',
  created_by          text not null default '',
  updated_by          text not null default '',
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now()),
  unique (plant_id, equipment_code)
);

create index if not exists idx_compliance_equipment_plant on public.compliance_equipment (plant_id);
create index if not exists idx_compliance_equipment_category on public.compliance_equipment (category);
create index if not exists idx_compliance_equipment_next_due on public.compliance_equipment (plant_id, next_due_date);
create index if not exists idx_compliance_equipment_status on public.compliance_equipment (plant_id, status);

-- ── compliance_inspections (append-only history; renewals INSERT) ──────────
create table if not exists public.compliance_inspections (
  id                  text primary key,
  equipment_id        text not null references public.compliance_equipment (id) on delete cascade,
  plant_id            uuid not null,
  inspection_date     date not null,
  certificate_number  text not null default '',
  agency              text not null default '',
  inspector           text not null default '',
  result              text not null default 'Pass',
  issue_date          date,
  expiry_date         date,
  next_due_date       date,
  observations        text not null default '',
  defects             text not null default '',
  corrective_action   text not null default '',
  closure_details     text not null default '',
  document            jsonb,
  uploaded_by         text not null default '',
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

create index if not exists idx_compliance_inspections_equipment on public.compliance_inspections (equipment_id);
create index if not exists idx_compliance_inspections_plant_due on public.compliance_inspections (plant_id, next_due_date);
create index if not exists idx_compliance_inspections_result on public.compliance_inspections (plant_id, result);

-- ── RLS (same precedent as testing_certificates — see header) ──────────────
alter table public.compliance_equipment enable row level security;
alter table public.compliance_inspections enable row level security;

drop policy if exists "public compliance equipment access" on public.compliance_equipment;
create policy "public compliance equipment access"
  on public.compliance_equipment for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "public compliance inspections access" on public.compliance_inspections;
create policy "public compliance inspections access"
  on public.compliance_inspections for all to anon, authenticated
  using (true) with check (true);

-- ── Realtime publication + replica identity (project convention) ───────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'compliance_equipment'
  ) then
    alter publication supabase_realtime add table public.compliance_equipment;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'compliance_inspections'
  ) then
    alter publication supabase_realtime add table public.compliance_inspections;
  end if;
end
$$;

alter table public.compliance_equipment replica identity full;
alter table public.compliance_inspections replica identity full;

-- ── Certificate document storage ───────────────────────────────────────────
-- Reuses the existing testing-certificates bucket (already provisioned and
-- proven by the Machine Profile certificates tab). Compliance files live
-- under compliance/<plant_id>/… so buckets stay shared but paths are
-- plant-namespaced. No new bucket required.
insert into storage.buckets (id, name, public)
  values ('testing-certificates', 'testing-certificates', true)
  on conflict (id) do nothing;
