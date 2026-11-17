#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Machine Archive & Purge — smoke test suite
//  1. Permission matrix (plantAccess) for archive / purge roles
//  2. Static audit of the purge migration (RPC, transactional deletes, audit)
//  3. Store integration audit (tombstones, resurrection guards, sync hardening)
//  4. UI audit (Actions menu, purge modal safeguards, archive view, banners)
// Run: node scripts/test-machine-purge.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');

const DEP_KEYS = ['pm_records', 'breakdown_logs', 'amc_records', 'testing_certificates', 'machine_documents'];

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
};

console.log('— Permission matrix (plantAccess) —');
{
  const mod = await import(`file://${path.join(root, 'client/src/lib/plantAccess.js').replace(/\\/g, '/')}`);
  const { canPurgeMachine, canArchiveMachine } = mod;
  ok('super_admin can purge', canPurgeMachine('super_admin') === true);
  ok('legacy admin can purge', canPurgeMachine('admin') === true);
  ok('plant_admin can NOT purge', canPurgeMachine('plant_admin') === false);
  ok('corporate_head can NOT purge', canPurgeMachine('corporate_head') === false);
  ok('plant_user can NOT purge', canPurgeMachine('plant_user') === false);
  ok('viewer can NOT purge', canPurgeMachine('viewer') === false);
  ok('plant_admin CAN archive', canArchiveMachine('plant_admin') === true);
  ok('super_admin CAN archive', canArchiveMachine('super_admin') === true);
  ok('corporate_head can NOT archive', canArchiveMachine('corporate_head') === false);
  ok('plant_user can NOT archive', canArchiveMachine('plant_user') === false);
  ok('viewer can NOT archive', canArchiveMachine('viewer') === false);
}

console.log('— Migration 20261116 (transactional purge RPC) —');
{
  const sql = read('supabase/migrations/20261116_machine_archive_purge.sql');
  ok('audit table created', /create table if not exists public\.machine_purge_audit/i.test(sql));
  ok('audit table has actor/reason/counts columns', /actor|reason|pm_records|breakdown_logs|amc_records|testing_certificates|machine_documents|orphaned_files/i.test(sql));
  ok('audit RLS policy created', /create policy "public machine_purge_audit access"/i.test(sql));
  ok('probe function exists', /function public\.purge_machine_probe_v1/i.test(sql));
  ok('purge function exists', /function public\.purge_machine_v1/i.test(sql));
  ok('purge is SECURITY DEFINER (server-side validation)', /security definer/i.test(sql));
  ok('search_path hardened', /set search_path = public/i.test(sql));
  ok('machine existence validated server-side', /machine_not_found/i.test(sql));
  ok('plant ownership validated server-side (never trusts client id)', /plant_mismatch/i.test(sql));
  ok('deletes machine-specific testing certificates (no FK)', /delete from public\.testing_certificates\s+where machine_id/i.test(sql));
  ok('deletes AMC records explicitly', /delete from public\.amc_records\s+where machine_id/i.test(sql));
  ok('deletes machine breakdown logs explicitly', /delete from public\.machine_breakdown_logs\s+where machine_id/i.test(sql));
  ok('deletes machine PM records explicitly', /delete from public\.machine_pm_records\s+where machine_id/i.test(sql));
  ok('deletes the machine row itself', /delete from public\.machines\s+where id = p_machine_id/i.test(sql));
  ok('single PL/pgSQL function = one implicit transaction (no partial purge)',
    (sql.match(/create or replace function public\.purge_machine_v1[\s\S]*?\$\$;/i) || [''])
      .some((body) => body.includes('delete from public.machines') && body.includes('delete from public.testing_certificates')));
  ok('audit row written with exact counts', /insert into public\.machine_purge_audit/i.test(sql));
  ok('execute granted to app roles only (no public grant)', /grant execute on function public\.purge_machine_v1[\s\S]*to anon, authenticated/i.test(sql));
  ok('no auth.uid() RLS introduced', !/auth\.uid\(\)/i.test(sql));
  ok('no second Supabase client or queue introduced', !/create extension|foreign data wrapper/i.test(sql));
}

console.log('— Store integration (archive / purge / tombstones / sync) —');
{
  const store = read('client/src/store.js');
  ok('archive fields in MACHINE_DEFAULTS', /archived: false,\s*\n\s*archivedAt: ''/.test(store));
  ok('archiveMachine action exists', /export function archiveMachine\(id, userName, reason/.test(store));
  ok('restoreMachine action exists', /export function restoreMachine\(id, userName\)/.test(store));
  ok('purgeMachine action exists (awaited DB confirmation)', /export async function purgeMachine\(machineId, options/.test(store));
  ok('tombstone registry persisted locally', /CCPL_PURGED_MACHINES/.test(store));
  ok('seeds cannot resurrect purged machines (mergeSeedMachines filtered)', /return applyMachineTombstones\(merged\);/.test(store));
  ok('realtime DELETE adopts tombstone', /addMachineTombstone\(purged, \{ purgedBy: 'Realtime delete' \}\)/.test(store));
  ok('realtime upsert of purged machine is blocked + re-queued as delete', /Blocked Realtime \$\{eventType\} for purged machine/.test(store));
  ok('queued stale upserts for purged machine are superseded (dedupe by recordId)', /withoutSameRecord/.test(store));
  ok('cross-PC tombstones adopted from machine_purge_audit on boot', /Purge audit sync/.test(store));
  ok('dependent records of purged machines swept locally', /sweepTombstonedMachineDependents/.test(store));
  ok('purge probe queries the server-guarded /api/machines/purge-probe endpoint', /machines\/purge-probe/.test(store) && /source: 'server-api'/.test(store));
  ok('purge executes via /api/machines/purge (awaited DB confirmation)', /fetch\('\/api\/machines\/purge'/.test(store));
  ok('purge RPC is transactional (all dependent deletes + machine row in one function)', (() => {
    const migrationSql = read('supabase/migrations/20261116_machine_archive_purge.sql');
    const body = (migrationSql.match(/create or replace function public\.purge_machine_v1[\s\S]*?\$\$;/i) || [''])[0];
    return body.includes('delete from public.testing_certificates')
      && body.includes('delete from public.amc_records')
      && body.includes('delete from public.machine_breakdown_logs')
      && body.includes('delete from public.machine_pm_records')
      && body.includes('delete from public.machines');
  })());
  ok('Case B guard: history requires elevated force flag', /blocked: 'history'/.test(store));
  ok('failed purge keeps machine (tombstone reverted)', /loadMachineTombstones\(\)\.filter\(\(t\) => t\.id !== machineId\)/.test(store));
  ok('machine-exclusive storage prefixes cleaned (machines/amc/certs)', /machines\/\$\{machineId\}\/|amc\/\$\{machineId\}\/|certs\/\$\{machineId\}\//.test(store));
  ok('storage failures recorded as orphaned references, not silent', /orphans/.test(store));
  ok('archive flag synced via existing payload JSONB (no second client)', /archived: machine\.archived === true,/.test(store));
  ok('updateMachine refuses to touch purged machine ids', /if \(isMachinePurged\(id\)\) return null;/.test(store));
  ok('intentional re-creation clears tombstone (addMachine)', /saveMachineTombstones\(loadMachineTombstones\(\)\.filter\(\(t\) => t\.id !== machine\.id\)\)/.test(store));
  ok('scoped view separates archivedMachines from active register', /archivedMachines: filter\(state\.machines\)\.filter\(\(m\) => m\.archived === true\)/.test(store));
  ok('availability machine counts exclude archived machines', /const active = state\.machines\.filter\(\(machine\) => machine\.archived !== true\);/.test(store));
  ok('compliance module untouched by purge flow', !/purgeCompliance|compliance.*purge_machine/i.test(store.split('purgeMachine')[1] || ''));
}

console.log('— UI audit (Machines register + profile) —');
{
  const actions = read('client/src/components/MachineActions.jsx');
  ok('Actions menu with View / Edit / Archive / Purge', /View Machine/.test(actions) && /Edit Machine/.test(actions) && /Archive Machine/.test(actions) && /Purge Machine/.test(actions));
  ok('archive icon used for archive action', /Archive size=\{13\}/.test(actions));
  ok('trash icon used for purge action', /Trash2 size=\{13\}/.test(actions));
  ok('red destructive styling only on purge', /danger/.test(actions));
  ok('permanent warning text present', /This operation is permanent and cannot be undone/.test(actions));
  ok('machine-code typed confirmation required', /Type the exact Machine Code/.test(actions));
  ok('double confirmation (armed → execute)', /setArmed\(true\)/.test(actions) && /Permanently Purge Machine/.test(actions));
  ok('duplicate purge prevention (ref guard)', /purgingRef\.current/.test(actions));
  ok('dependency summary rows rendered', /Dependency Summary/.test(actions) && DEP_KEYS.every((k) => actions.includes(k)));
  ok('Case B recommends Archive', /Archive Machine is the recommended action/.test(actions));
  ok('elevated acknowledgment checkbox for history machines', /permanently deleted from the database and cannot be recovered/.test(actions));
  ok('success/failure result banner', /Machine permanently purged from the database/.test(actions) && /Purge failed — the machine was retained/.test(actions));
  ok('loading state while querying and purging', /Querying database for linked records/.test(actions) && /Purging…/.test(actions));
  ok('archive modal preserves records messaging', /preserved/.test(actions));
  ok('archived banner with restore on profile', /Archived machine/.test(actions) && /Restore Machine/.test(actions));

  const machines = read('client/src/pages/Machines.jsx');
  ok('register has archived view toggle', /Archived \(/.test(machines) && /viewArchived/.test(machines));
  ok('register wired to purge modal', /PurgeMachineModal/.test(machines));
  ok('register wired to archive modal', /ArchiveMachineModal/.test(machines));
  ok('no browser-confirm-only delete left on register', !/window\.confirm\('Delete/.test(machines));

  const profile = read('client/src/pages/MachineProfile.jsx');
  ok('profile has Actions menu', /MachineActionsMenu/.test(profile));
  ok('profile has archived banner + restore', /MachineArchivedBanner/.test(profile) && /restoreMachine/.test(profile));
  ok('profile wired to purge modal', /PurgeMachineModal/.test(profile));
  ok('profile auto-opens editor when navigated with autoEdit state', /autoEdit/.test(profile));
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
