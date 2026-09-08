-- =============================================================================
-- 20250908 — KPI Status module + fix for ERROR 42601 on machine_breakdown_logs
-- Idempotent: safe to run multiple times, no data loss (IF NOT EXISTS, no DROP TABLE)
-- =============================================================================

-- Fix ERROR 42601: inline unique constraint with coalesce(...) is not valid syntax.
-- Original schema had: constraint uq_machine_bd_logs_date_times unique (machine_id, date, coalesce(...))
-- Replaced with unique index. This block removes the invalid constraint if it ever existed and creates the index.
do $$ begin
  alter table public.machine_breakdown_logs drop constraint if exists uq_machine_bd_logs_date_times;
exception when others then null;
end $$;
create unique index if not exists uq_machine_bd_logs_date_times
  on public.machine_breakdown_logs (machine_id, date, coalesce(start_time::text, ''), coalesce(end_time::text, ''));

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

-- RLS
alter table public.kpi_records  enable row level security;
alter table public.kpi_settings enable row level security;

drop policy if exists "public kpi records access"  on public.kpi_records;
drop policy if exists "public kpi settings access" on public.kpi_settings;

create policy "public kpi records access"
  on public.kpi_records for all to anon, authenticated using (true) with check (true);
create policy "public kpi settings access"
  on public.kpi_settings for all to anon, authenticated using (true) with check (true);

-- Realtime
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kpi_records') then
    alter publication supabase_realtime add table public.kpi_records;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kpi_settings') then
    alter publication supabase_realtime add table public.kpi_settings;
  end if;
end $$;

alter table public.kpi_records  replica identity full;
alter table public.kpi_settings replica identity full;
