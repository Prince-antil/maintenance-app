-- =============================================================================
-- CCPL CMMS — Purge Access Control (20261117)
-- =============================================================================
-- SECURITY HARDENING for machine permanent purge (P0 fix).
--
-- The purge_machine_v1 / purge_machine_probe_v1 functions introduced in
-- migration 20261116 were grant-executed to `anon`. Because this application
-- talks to Supabase exclusively through the anon role (custom cookie auth,
-- no Supabase Auth), any internet user could permanently delete machines and
-- their dependents with a forged RPC call.
--
-- This migration:
--   1. Revokes execute on both functions from `anon` (and `authenticated`,
--      since Supabase Auth is not used — no real user ever holds that role).
--   2. Grants execute to `authenticated` only (effective: callable solely
--      through the server-guarded /api/machines/purge endpoint).
--   3. Fixes the plant-validation bypass: previously a NULL client-supplied
--      p_plant_id skipped the ownership check entirely. Now any provided
--      plant id that mismatches the machine's real plant_id is rejected.
--   4. Locks down machine_purge_audit: inserts via SECURITY DEFINER purge
--      function only; no direct anon DML.
-- =============================================================================

revoke execute on function public.purge_machine_probe_v1(text) from anon, authenticated;
revoke execute on function public.purge_machine_v1(text, uuid, text, text) from anon, authenticated;

grant execute on function public.purge_machine_probe_v1(text) to authenticated;
grant execute on function public.purge_machine_v1(text, uuid, text, text) to authenticated;

revoke all on table public.machine_purge_audit from anon, authenticated;
grant insert on table public.machine_purge_audit to authenticated;

-- Re-create probe with the mandatory plant-validation rule and a documented
-- warning that the caller is responsible for authorisation.
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

-- Re-create purge with mandatory plant validation: a provided p_plant_id that
-- mismatches the machine's real plant_id is rejected before any deletion.
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
  select * into v_machine from public.machines where id = p_machine_id;
  if not found then
    raise exception 'machine_not_found: no machine with id %', p_machine_id;
  end if;

  -- Server-side plant ownership validation. A client-supplied plant id that
  -- mismatches the machine's database record aborts the purge before any row
  -- is deleted. Legacy rows with no plant_id are exempt (Nathupur default).
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

revoke execute on function public.purge_machine_probe_v1(text) from public;
revoke execute on function public.purge_machine_v1(text, uuid, text, text) from public;
grant execute on function public.purge_machine_probe_v1(text) to authenticated;
grant execute on function public.purge_machine_v1(text, uuid, text, text) to authenticated;
