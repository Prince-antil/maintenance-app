-- =============================================================================
-- Migration: Add notification tables and AMC overview support
-- Date: 2026-08-14
--
-- This migration adds:
--   1. notification_settings — admin-configurable notification preferences
--   2. notification_log — idempotent notification history to prevent duplicates
--   3. AMC-related indexes for faster overview queries
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Notification Settings
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_settings (
  id          text primary key default 'default',
  recipients jsonb not null default '[]'::jsonb,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Notification Log — stores sent notifications for idempotency
--    Unique key: eventType + recordId + reminderDate + recipient
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_log (
  id              text primary key,
  event_type      text not null,
  record_id       text not null,
  machine_name    text not null default '',
  recipient       text not null default '',
  channel         text not null default 'email',
  scheduled_at    timestamptz not null default timezone('utc', now()),
  sent_at         timestamptz,
  status          text not null default 'pending',
  error_message   text not null default '',
  idempotency_key text not null,
  created_at      timestamptz not null default timezone('utc', now())
);

-- Prevent duplicate notifications using idempotency key
create unique index if not exists idx_notification_log_idempotency
  on public.notification_log (idempotency_key);

-- Index for querying by event type and status
create index if not exists idx_notification_log_event_status
  on public.notification_log (event_type, status);

-- Index for date range queries
create index if not exists idx_notification_log_created
  on public.notification_log (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Additional AMC indexes for overview queries
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_amc_records_status
  on public.amc_records (contract_end_date, total_visits_agreed, completed_visits);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Additional machine_breakdown_logs indexes
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_machine_bd_logs_machine_date
  on public.machine_breakdown_logs (machine_id, date desc);

create index if not exists idx_machine_bd_logs_status
  on public.machine_breakdown_logs (status);

create index if not exists idx_machine_bd_logs_failure_cause
  on public.machine_breakdown_logs (failure_cause);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Enable RLS and policies
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notification_settings enable row level security;
alter table public.notification_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'notification_settings'
      and policyname = 'public notification settings access'
  ) then
    execute $p$
      create policy "public notification settings access"
        on public.notification_settings
        for all
        to anon, authenticated
        using (true)
        with check (true)
    $p$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'notification_log'
      and policyname = 'public notification log access'
  ) then
    execute $p$
      create policy "public notification log access"
        on public.notification_log
        for all
        to anon, authenticated
        using (true)
        with check (true)
    $p$;
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Add to Supabase Realtime publication (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_settings'
  ) then
    alter publication supabase_realtime add table public.notification_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_log'
  ) then
    alter publication supabase_realtime add table public.notification_log;
  end if;
end
$$;

-- Set REPLICA IDENTITY for real-time
alter table public.notification_settings replica identity full;
alter table public.notification_log replica identity full;
