-- =============================================================================
-- CCPL CMMS — Machine Archive & Permanent Purge (20261116)
-- =============================================================================
-- SCOPE: Machines module only. Inspection & Compliance is NOT touched.
--
-- WHAT THIS DOES
--   1. machine_purge_audit — minimal audit trail for every permanent purge
--      (machine identity, plant, actor, reason, dependent-record counts,
--      result, orphaned file references). Also acts as the cross-PC tombstone
--      registry: clients read it on boot so a purged machine can never be
--      resurrected from seeds or offline queue retries.
--
--   2. purge_machine_probe_v1(p_machine_id) — read-only dependency summary
--      (PM records, breakdown logs, AMC records, testing certificates,
--      machine documents) used to populate the confirmation modal.
--
--   3. purge_machine_v1(...) — the permanent purge itself.
--      - SECURITY DEFINER: the function validates the machine's real
--        plant_id in the database (client-supplied plant ids are never
--        trusted) and deletes all dependents inside ONE implicit
--        transaction, so partial deletion is impossible.
--      - Deletes (in order): testing_certificates → amc_records →
--        machine_breakdown_logs → machine_pm_records → the machine row.
--        (machine_pm_records / amc_records also cascade via FK; explicit
--        deletes give exact counts and cover tables without FKs.)
--      - Writes one machine_purge_audit row with exact counts.
--      - Returns a JSON summary; raises exceptions (machine_not_found,
--        plant_mismatch) on failure — no partial state.
--
-- ARCHIVE: no schema change needed — archived machines are stored in the
-- machines.payload JSONB (archived / archivedAt / archivedBy / archiveReason)
-- and stay untouched in this migration. Records, history, AMC, certificates
-- and documents of archived machines are preserved.
--
-- IDEMPOTENT: safe to run multiple times. No data is deleted or modified by
-- running this migration itself.
-- =============================================================================

-- ── 1. Audit / tombstone registry ────────────────────────────────────────────
create table if not exists public.machine_purge_audit (
  id                   uuid primary key default gen_random_uuid(),
  machine_id           text not null,
  machine_code         text not null default '',
  machine_name         text not null default '',
  plant_id             uuid,
  operation            text not null default 'purge',
  actor                text not null default '',
  reason               text not null default '',
  pm_records           integer not null default 0,
  breakdown_logs       integer not null default 0,
  amc_records          integer not null default 0,
  testing_certificates integer not null default 0,
  machine_documents    integer not null default 0,
  orphaned_files       jsonb not null default '[]'::jsonb,
  result               text not null default 'success',
  created_at           timestamptz not null default timezone('utc', now())
);

create index if not exists idx_machine_purge_audit_machine
  on public.machine_purge_audit (machine_id, created_at desc);

alter table public.machine_purge_audit enable row level security;

-- Same open policy pattern as every other table in this project
-- (auth is application-level; no Supabase-Auth-based RLS policies exist here).
drop policy if exists "public machine_purge_audit access" on public.machine_purge_audit;
create policy "public machine_purge_audit access"
on public.machine_purge_audit
for all
to anon, authenticated
using (true)
with check (true);

-- ── 2. Read-only dependency probe (confirmation modal) ──────────────────────
create or replace function public.purge_machine_probe_v1(p_machine_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine public.machines%rowtype;
  v_pm integer;
  v_bd integer;
  v_amc integer;
  v_cert integer;
  v_docs integer;
begin
  select * into v_machine from public.machines where id = p_machine_id;
  if not found then
    return jsonb_build_object(
      'found', false,
      'machine_id', p_machine_id,
      'pm_records', 0, 'breakdown_logs', 0, 'amc_records', 0,
      'testing_certificates', 0, 'machine_documents', 0
    );
  end if;

  select count(*) into v_pm   from public.machine_pm_records      where machine_id = p_machine_id;
  select count(*) into v_bd   from public.machine_breakdown_logs where machine_id = p_machine_id;
  select count(*) into v_amc  from public.amc_records            where machine_id = p_machine_id;
  select count(*) into v_cert from public.testing_certificates   where machine_id = p_machine_id;
  select coalesce(jsonb_array_length(attachments), 0) into v_docs
    from public.machines where id = p_machine_id;

  return jsonb_build_object(
    'found', true,
    'machine_id', v_machine.id,
    'machine_code', v_machine.payload ->> 'machineCode',
    'machine_name', v_machine.name,
    'plant_id', v_machine.plant_id,
    'pm_records', v_pm,
    'breakdown_logs', v_bd,
    'amc_records', v_amc,
    'testing_certificates', v_cert,
    'machine_documents', v_docs
  );
end;
$$;

-- ── 3. The transactional purge ───────────────────────────────────────────────
create or replace function public.purge_machine_v1(
  p_machine_id text,
  p_plant_id   uuid default null,
  p_actor      text default '',
  p_reason     text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine public.machines%rowtype;
  v_pm integer := 0;
  v_bd integer := 0;
  v_amc integer := 0;
  v_cert integer := 0;
  v_docs integer := 0;
begin
  -- Server-side validation: the machine must exist in the database.
  select * into v_machine from public.machines where id = p_machine_id;
  if not found then
    raise exception 'machine_not_found: no machine with id %', p_machine_id;
  end if;

  -- Server-side plant ownership validation: never trust the client-supplied
  -- plant id. A mismatch aborts the purge before anything is deleted.
  if p_plant_id is not null
     and v_machine.plant_id is not null
     and v_machine.plant_id <> p_plant_id then
    raise exception 'plant_mismatch: machine % belongs to plant %, not %',
      p_machine_id, v_machine.plant_id, p_plant_id;
  end if;

  select count(*) into v_pm   from public.machine_pm_records      where machine_id = p_machine_id;
  select count(*) into v_bd   from public.machine_breakdown_logs where machine_id = p_machine_id;
  select count(*) into v_amc  from public.amc_records            where machine_id = p_machine_id;
  select count(*) into v_cert from public.testing_certificates   where machine_id = p_machine_id;
  select coalesce(jsonb_array_length(attachments), 0) into v_docs
    from public.machines where id = p_machine_id;

  -- Explicit dependent deletes (one implicit transaction — no partial state).
  -- testing_certificates has no FK, so it must be deleted explicitly.
  delete from public.testing_certificates   where machine_id = p_machine_id;
  delete from public.amc_records            where machine_id = p_machine_id;
  delete from public.machine_breakdown_logs where machine_id = p_machine_id;
  delete from public.machine_pm_records     where machine_id = p_machine_id;
  delete from public.machines               where id = p_machine_id;

  insert into public.machine_purge_audit (
    machine_id, machine_code, machine_name, plant_id, operation,
    actor, reason, pm_records, breakdown_logs, amc_records,
    testing_certificates, machine_documents, result
  ) values (
    p_machine_id,
    v_machine.payload ->> 'machineCode',
    v_machine.name,
    v_machine.plant_id,
    'purge',
    p_actor,
    p_reason,
    v_pm, v_bd, v_amc, v_cert, v_docs,
    'success'
  );

  return jsonb_build_object(
    'success', true,
    'machine_id', p_machine_id,
    'machine_code', v_machine.payload ->> 'machineCode',
    'machine_name', v_machine.name,
    'plant_id', v_machine.plant_id,
    'deleted', jsonb_build_object(
      'pm_records', v_pm,
      'breakdown_logs', v_bd,
      'amc_records', v_amc,
      'testing_certificates', v_cert,
      'machine_documents', v_docs
    )
  );
end;
$$;

revoke all on function public.purge_machine_probe_v1(text) from public;
revoke all on function public.purge_machine_v1(text, uuid, text, text) from public;
grant execute on function public.purge_machine_probe_v1(text) to anon, authenticated;
grant execute on function public.purge_machine_v1(text, uuid, text, text) to anon, authenticated;
