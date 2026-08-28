-- =============================================================================
-- Migration: Add Testing & Safety Certificates table
-- =============================================================================

create table if not exists public.testing_certificates (
  id                text primary key,
  machine_id        text not null,
  machine_code      text not null default '',
  machine_name      text not null default '',
  plant_section     text not null default '',
  certificate_type  text not null default '',
  certificate_number text not null default '',
  agency_name       text not null default '',
  issue_date        date,
  expiry_date       date,
  frequency         text not null default '',
  document          jsonb,
  document_name     text,
  document_url      text,
  document_path     text,
  remarks           text not null default '',
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create index if not exists idx_testing_cert_machine on public.testing_certificates (machine_id);
create index if not exists idx_testing_cert_expiry on public.testing_certificates (expiry_date);
create index if not exists idx_testing_cert_type on public.testing_certificates (certificate_type);

alter table public.testing_certificates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'testing_certificates'
        and policyname = 'public testing certificates access'
  ) then
    execute $p$
      create policy "public testing certificates access"
        on public.testing_certificates
        for all
        to anon, authenticated
        using (true)
        with check (true)
    $p$;
  end if;
end
$$;

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

-- Ensure notification_settings has safety columns (add if missing)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
      where table_schema='public' and table_name='notification_settings' and column_name='safety_expiry_warning'
  ) then
    alter table public.notification_settings add column safety_expiry_warning boolean not null default true;
  end if;
  if not exists (
    select 1 from information_schema.columns
      where table_schema='public' and table_name='notification_settings' and column_name='safety_expired'
  ) then
    alter table public.notification_settings add column safety_expired boolean not null default true;
  end if;
end
$$;

-- Ensure storage bucket for certificates exists (best-effort, may need manual creation)
-- Note: storage buckets are typically created via Supabase dashboard or storage API
-- This comment documents expected bucket: testing-certificates
