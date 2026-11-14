-- =============================================================================
-- 20261113_compliance_upgrade.sql — Equipment Inspection, Calibration &
-- Statutory Compliance upgrade.
--
-- PURPOSE
--   Extends the existing compliance_equipment / compliance_inspections tables
--   (created by 20261012_compliance_module.sql) without dropping or rewriting
--   any existing row, certificate or document reference. Adds:
--     • Rich identification + technical specification fields (JSONB)
--     • Separate certificate / inspection / expiry / next-due date engine
--       fields and a cached current-certification summary per equipment
--     • Configurable category definitions and field schemas
--     • Configurable compliance settings (thresholds, notifications)
--     • Append-only compliance audit log
--     • Private certificate storage bucket (app uses signed URLs; existing
--       public testing-certificates bucket remains as a fallback)
--
-- AUTHORIZATION MODEL (unchanged — read the 20261012 migration header first)
--   This application authenticates with its own Express API / offline session
--   and does NOT issue Supabase Auth JWTs for routine users. PostgREST sees
--   the anon role and auth.uid() is NULL. The project therefore uses the same
--   permissive anon precedent as testing_certificates, kpi_* and energy_*.
--   Plant isolation is enforced by the application layer:
--     • commitAndQueue() overwrites plant_id from the current plant context
--     • fetchCloudEntity() filters by plant for plant users
--     • UI role/plant gates + Express API auth + import validation
--   Truly hardened RLS requires migrating the whole application to Supabase
--   Auth. Until then, restricting these policies to auth.uid() would silently
--   block every write (see the pm_logs/energy RLS incident).
--
-- SAFETY
--   * Only ALTER TABLE ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
--   * No DROP, no DELETE, no destructive column type changes.
--   * Backfill only fills the new cache columns when they are still NULL.
--   * If the 20261012 base migration has not been applied yet, this file also
--     bootstraps compliance_equipment / compliance_inspections first so the
--     upgrade can never fail with "relation ... does not exist".
--   * All statements are idempotent and may be re-run safely.
-- =============================================================================

-- ── 0. Bootstrap base compliance schema (only if 20261012 never ran) ────────
-- The upgrade below extends compliance_equipment / compliance_inspections.
-- On projects where the base migration has not been applied yet, creating the
-- two base tables first prevents the hard failure:
--   ERROR 42P01: relation "public.compliance_equipment" does not exist
-- These statements are no-ops when the tables already exist.
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
  status              text not null default 'NOT_INSPECTED',
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

-- Base RLS + realtime (same permissive anon precedent; see header above).
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
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
  end if;
end
$$;

alter table public.compliance_equipment replica identity full;
alter table public.compliance_inspections replica identity full;

-- Also seed the shared public certificate bucket if this is a brand-new
-- project that never received the base migration's storage step.
insert into storage.buckets (id, name, public)
  values ('testing-certificates', 'testing-certificates', true)
  on conflict (id) do nothing;

-- ── 1. compliance_equipment — master record extensions ─────────────────────
alter table public.compliance_equipment
  add column if not exists subcategory             text not null default '',
  add column if not exists section                 text not null default '',
  add column if not exists exact_location          text not null default '',
  add column if not exists description             text not null default '',
  add column if not exists technical_specs         jsonb not null default '{}'::jsonb,
  add column if not exists certificate_required    boolean not null default true,
  add column if not exists lifecycle_status        text not null default 'active',
  add column if not exists last_inspection_date    date,
  add column if not exists current_inspection_id   text,
  add column if not exists current_certificate_number text not null default '',
  add column if not exists current_issue_date      date,
  add column if not exists current_expiry_date     date,
  add column if not exists current_next_due_date   date,
  add column if not exists current_result          text not null default '',
  add column if not exists expiry_source           text not null default '',
  add column if not exists corrective_action_pending boolean not null default false,
  add column if not exists documents               jsonb not null default '[]'::jsonb;

-- Also normalise the cached-status default for fresh rows.
alter table public.compliance_equipment
  alter column status set default 'NOT_INSPECTED';

create index if not exists idx_compliance_equipment_lifecycle
  on public.compliance_equipment (plant_id, lifecycle_status);
create index if not exists idx_compliance_equipment_expiry
  on public.compliance_equipment (plant_id, current_expiry_date);
create index if not exists idx_compliance_equipment_department
  on public.compliance_equipment (plant_id, department);

-- ── 2. compliance_inspections — certificate / inspection event extensions ──
alter table public.compliance_inspections
  add column if not exists inspection_type          text not null default '',
  add column if not exists inspection_record_id     text not null default '',
  add column if not exists competent_person         text not null default '',
  add column if not exists validity_months          integer,
  add column if not exists validity_days            integer,
  add column if not exists calculated_expiry_date   date,
  add column if not exists expiry_source            text not null default '',
  add column if not exists expiry_override_reason   text not null default '',
  add column if not exists next_due_override_reason text not null default '',
  add column if not exists corrective_action_owner  text not null default '',
  add column if not exists corrective_action_due_date date,
  add column if not exists corrective_action_closure_date date,
  add column if not exists closure_remarks          text not null default '',
  add column if not exists documents                jsonb not null default '[]'::jsonb,
  add column if not exists updated_by               text not null default '';

create index if not exists idx_compliance_inspections_certificate
  on public.compliance_inspections (plant_id, certificate_number);
create index if not exists idx_compliance_inspections_expiry
  on public.compliance_inspections (plant_id, expiry_date);

-- Backfill the permanent inspection record id for rows created before this
-- upgrade. The primary key already is permanent; this column is the user-facing
-- record reference used by exports. Safe to re-run.
update public.compliance_inspections
set inspection_record_id = id
where inspection_record_id is null or inspection_record_id = '';

-- ── 3. compliance_categories — configurable categories + dynamic fields ────
create table if not exists public.compliance_categories (
  id                       text primary key,
  code                     text not null unique,
  label                    text not null default '',
  default_frequency_months integer not null default 12,
  technical_fields         jsonb not null default '[]'::jsonb,
  active                   boolean not null default true,
  sort_order               integer not null default 100,
  created_by               text not null default '',
  updated_by               text not null default '',
  created_at               timestamptz not null default timezone('utc', now()),
  updated_at               timestamptz not null default timezone('utc', now())
);

create index if not exists idx_compliance_categories_active
  on public.compliance_categories (active, sort_order);

-- ── 4. compliance_settings — thresholds, notification policy ───────────────
-- One row per plant (plant_id) plus one optional corporate row (plant_id NULL).
create table if not exists public.compliance_settings (
  id                          text primary key,
  plant_id                    uuid,
  due_soon_days               integer not null default 30,
  due_soon_secondary_days     integer not null default 60,
  report_window_days          integer not null default 60,
  notify_days                 jsonb not null default '[30,15,7,0]'::jsonb,
  notify_in_app               boolean not null default true,
  notify_emails               text not null default '',
  notify_whatsapp             text not null default '',
  recipients                  jsonb not null default '{}'::jsonb,
  as_of_date                  date,
  updated_by                  text not null default '',
  created_at                  timestamptz not null default timezone('utc', now()),
  updated_at                  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_compliance_settings_plant
  on public.compliance_settings (plant_id);

-- ── 5. compliance_audit_log — append-only audit trail ──────────────────────
create table if not exists public.compliance_audit_log (
  id              text primary key,
  plant_id        uuid not null,
  equipment_id    text not null default '',
  inspection_id   text not null default '',
  action          text not null default '',
  detail          text not null default '',
  changes         jsonb not null default '{}'::jsonb,
  user_name       text not null default '',
  created_at      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_compliance_audit_equipment
  on public.compliance_audit_log (equipment_id, created_at desc);
create index if not exists idx_compliance_audit_plant
  on public.compliance_audit_log (plant_id, created_at desc);

-- ── 6. Safe backfill of cached current-certification summary ───────────────
-- Only fills empty cache columns. Existing values are never overwritten.
-- "Current" record = newest inspection by inspection date, then created_at.
update public.compliance_equipment e
set
  current_inspection_id        = l.id,
  last_inspection_date         = l.inspection_date,
  current_certificate_number   = coalesce(l.certificate_number, ''),
  current_issue_date           = l.issue_date,
  current_expiry_date          = l.expiry_date,
  current_next_due_date        = coalesce(l.next_due_date, e.next_due_date),
  current_result               = coalesce(l.result, ''),
  expiry_source                = case
                                    when l.expiry_date is not null and l.issue_date is not null
                                      then 'calculated'
                                    when l.expiry_date is not null then 'certificate'
                                    else ''
                                  end,
  corrective_action_pending    = (coalesce(l.defects, '') <> ''
                                  or coalesce(l.corrective_action, '') <> '')
                                 and l.corrective_action_closure_date is null
from (
  select distinct on (equipment_id)
    equipment_id, id, inspection_date, certificate_number, issue_date, expiry_date,
    next_due_date, result, defects, corrective_action, corrective_action_closure_date
  from public.compliance_inspections
  order by equipment_id, inspection_date desc, created_at desc
) l
where l.equipment_id = e.id
  and (e.current_inspection_id is null or e.current_inspection_id = '')
  and e.current_certificate_number = '';

-- ── 7. RLS (same precedent as the existing compliance tables) ──────────────
alter table public.compliance_categories enable row level security;
alter table public.compliance_settings   enable row level security;
alter table public.compliance_audit_log  enable row level security;

drop policy if exists "public compliance categories access" on public.compliance_categories;
create policy "public compliance categories access"
  on public.compliance_categories for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "public compliance settings access" on public.compliance_settings;
create policy "public compliance settings access"
  on public.compliance_settings for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "public compliance audit access" on public.compliance_audit_log;
create policy "public compliance audit access"
  on public.compliance_audit_log for all to anon, authenticated
  using (true) with check (true);

-- ── 8. Realtime publication + replica identity ─────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'compliance_categories'
    ) then
      alter publication supabase_realtime add table public.compliance_categories;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'compliance_settings'
    ) then
      alter publication supabase_realtime add table public.compliance_settings;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'compliance_audit_log'
    ) then
      alter publication supabase_realtime add table public.compliance_audit_log;
    end if;
  end if;
end
$$;

alter table public.compliance_categories replica identity full;
alter table public.compliance_settings   replica identity full;
alter table public.compliance_audit_log  replica identity full;

-- ── 9. Private certificate storage bucket (signed URLs) ────────────────────
-- The existing public 'testing-certificates' bucket is retained as a fallback
-- because machine certificates already depend on it. New compliance uploads
-- use this private bucket and the app resolves short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('compliance-documents', 'compliance-documents', false)
on conflict (id) do update set public = false;

drop policy if exists "ccpl compliance documents access" on storage.objects;
create policy "ccpl compliance documents access"
  on storage.objects for all to anon, authenticated
  using (bucket_id = 'compliance-documents')
  with check (bucket_id = 'compliance-documents');

-- =============================================================================
-- END OF MIGRATION
-- Rollback notes (manual, only if the module must be removed):
--   • Drop the three new tables (categories/settings/audit) — no historical
--     equipment or certificate rows are affected.
--   • The added columns may remain safely; dropping them would lose cache and
--     classification metadata. Do not drop compliance_inspections.
-- =============================================================================