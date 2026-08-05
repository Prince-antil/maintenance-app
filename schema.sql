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
