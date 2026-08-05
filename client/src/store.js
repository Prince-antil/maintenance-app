import { useSyncExternalStore } from 'react';
import { loadLS, saveLS } from './utils.js';
import { normalizeMachineStatus } from './bulkImport.js';
import { SEED_MACHINES } from './equipmentData.js';
import { MASTER_PLANT_SECTION } from './constants.js';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient.js';

const KEYS = {
  machines: 'PLANT_EQUIPMENT_MASTER',
  breakdowns: 'BREAKDOWN_MONTHLY_LOGS',
  pms: 'PM_MONTHLY_LOGS',
  energy: 'ccpl_energy_v1',
  activity: 'ccpl_activity_v1',
  settings: 'ccpl_settings_v1',
};

const LEGACY_KEYS = {
  machines: ['ccpl_machines_v2'],
  breakdowns: ['ccpl_breakdowns_v2'],
  pms: ['ccpl_pms_v2'],
  energy: ['ccpl_energy_v1'],
  activity: ['ccpl_activity_v1'],
  settings: ['ccpl_settings_v1'],
};

const CLOUD_SYNC_QUEUE_KEY = 'CCPL_CLOUD_SYNC_QUEUE';

const MACHINE_DEFAULTS = {
  machineCode: '',
  department: '',
  area: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  installDate: '',
  powerRating: '',
  voltage: '',
  current: '',
  runningHours: 0,
  criticality: '',
  status: 'running',
  docs: [],
  spares: [],
  photos: [],
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const HOURS_PER_MONTH = 720;
const MASTER_SECTION = MASTER_PLANT_SECTION;
const SYNCED_ENTITIES = ['machines', 'breakdowns', 'pms', 'energy'];

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const normalizeText = (value) => String(value || '').trim().toLowerCase();
const isPresent = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const round1 = (value) => Math.round(toNumber(value) * 10) / 10;
const asPlainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

function normalizeMachineDoc(doc) {
  return {
    id: doc.id || uid('d'),
    tab: doc.tab || 'sop',
    filename: doc.filename || doc.file_name || 'Untitled document',
    file_format: doc.file_format || '',
    file_url: doc.file_url || doc.public_url || '',
    public_url: doc.public_url || doc.file_url || '',
    storage_path: doc.storage_path || '',
    uploadedAt: doc.uploadedAt || doc.uploaded_at || now(),
    uploaded_at: doc.uploaded_at || doc.uploadedAt || now(),
    uploadedBy: doc.uploadedBy || doc.uploaded_by || 'System',
    uploaded_by: doc.uploaded_by || doc.uploadedBy || 'System',
    machine_id: doc.machine_id || '',
    plant_section: doc.plant_section || '',
  };
}

const monthKey = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime())
    ? ''
    : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

const periodLabel = (period) => {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return '';
  return `${MONTHS[month - 1]} ${year}`;
};

function normalizeEnergyRecord(fields) {
  return {
    id: fields.id || uid('e'),
    createdAt: fields.createdAt || now(),
    date: fields.date || new Date().toISOString().slice(0, 10),
    source: fields.source || '',
    remarks: fields.remarks || '',
    plantSection: fields.plantSection || fields.section || '',
    dg500RunHours: toNumber(fields.dg500RunHours),
    dg380RunHours: toNumber(fields.dg380RunHours),
    fuelConsumedLitres: toNumber(fields.fuelConsumedLitres),
    solarGenerationKwh: toNumber(fields.solarGenerationKwh),
    plantSec: toNumber(fields.plantSec),
    kwh: toNumber(fields.kwh || fields.solarGenerationKwh),
  };
}

function normalizeMachineRecord(machine) {
  const payload = asPlainObject(machine.payload);
  const source = { ...payload, ...machine };
  const id = source.id || source.machineCode || uid('m');
  const docs = Array.isArray(source.attachments)
    ? source.attachments
    : Array.isArray(source.docs)
      ? source.docs
      : Array.isArray(payload.attachments)
        ? payload.attachments
        : Array.isArray(payload.docs)
          ? payload.docs
          : [];
  return {
    ...MACHINE_DEFAULTS,
    ...payload,
    ...machine,
    id,
    machineCode: source.machineCode || id,
    name: String(source.name || '').trim(),
    section: source.section || '',
    department: source.department || source.section || '',
    status: normalizeMachineStatus(source.status || 'running'),
    docs: docs.map((doc) => normalizeMachineDoc({ ...doc, machine_id: doc.machine_id || id, plant_section: doc.plant_section || source.section || '' })),
    spares: Array.isArray(source.spares) ? source.spares : [],
    photos: Array.isArray(source.photos) ? source.photos : [],
    createdAt: source.createdAt || source.created_at || now(),
  };
}

function machineMatches(left, right) {
  const leftCode = normalizeText(left.machineCode || left.id);
  const rightCode = normalizeText(right.machineCode || right.id);
  const leftName = normalizeText(left.name);
  const rightName = normalizeText(right.name);
  const leftSection = normalizeText(left.section);
  const rightSection = normalizeText(right.section);

  return (
    (left.id && right.id && left.id === right.id) ||
    (leftCode && rightCode && leftCode === rightCode) ||
    (leftName && rightName && leftSection && rightSection && leftName === rightName && leftSection === rightSection)
  );
}

function mergeSeedMachines(storedMachines, seedMachines) {
  const merged = Array.isArray(storedMachines)
    ? storedMachines.map(normalizeMachineRecord)
    : [];

  if (!merged.length) {
    return seedMachines.map(normalizeMachineRecord);
  }

  seedMachines
    .map(normalizeMachineRecord)
    .forEach((seedMachine) => {
      const matchIndex = merged.findIndex((machine) => machineMatches(machine, seedMachine));
      if (matchIndex === -1) {
        merged.push(seedMachine);
        return;
      }

      const current = merged[matchIndex];
      merged[matchIndex] = normalizeMachineRecord({
        ...seedMachine,
        ...current,
        id: current.id || seedMachine.id,
        machineCode: current.machineCode || seedMachine.machineCode,
        createdAt: current.createdAt || seedMachine.createdAt,
        department: current.department || current.section || seedMachine.section,
      });
    });

  return merged;
}

function resolvePeriod(fields = {}) {
  const direct = fields.period || fields.monthKey;
  if (/^\d{4}-\d{2}$/.test(String(direct || ''))) {
    const [year, month] = String(direct).split('-').map(Number);
    return { period: direct, year, month, monthName: MONTHS[month - 1] };
  }

  if (isPresent(fields.month) && isPresent(fields.year)) {
    const numericMonth = Number(fields.month);
    const monthIndex = Number.isInteger(numericMonth) && numericMonth > 0
      ? numericMonth - 1
      : MONTHS.findIndex((item) => normalizeText(item) === normalizeText(fields.month));
    const year = Number(fields.year);
    if (monthIndex >= 0 && year) {
      const period = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      return { period, year, month: monthIndex + 1, monthName: MONTHS[monthIndex] };
    }
  }

  const fallback = new Date(fields.createdAt || fields.breakdownDate || fields.pmDate || fields.date || now());
  const year = fallback.getFullYear();
  const month = fallback.getMonth() + 1;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return { period, year, month, monthName: MONTHS[month - 1] };
}

function normalizeBreakdownSummary(fields) {
  const { period, year, monthName } = resolvePeriod(fields);
  const section = fields.section || fields.plantSection || MASTER_SECTION;
  const breakdownCount = Math.max(0, Math.round(toNumber(fields.breakdownCount ?? fields.totalBreakdowns)));
  const downtimeHours = Math.max(0, round1(fields.downtimeHours ?? fields.totalDowntimeHours));
  const autoOperatingHours = sectionMachineCount(section) * HOURS_PER_MONTH;
  const operatingHours = Math.max(0, round1(isPresent(fields.operatingHours) ? fields.operatingHours : autoOperatingHours));
  const mttr = isPresent(fields.mttr)
    ? round1(fields.mttr)
    : breakdownCount > 0 ? round1(downtimeHours / breakdownCount) : 0;
  const mtbf = isPresent(fields.mtbf)
    ? round1(fields.mtbf)
    : breakdownCount > 0 ? round1(Math.max(0, operatingHours - downtimeHours) / breakdownCount) : 0;

  // availability_override: explicit percentage (0-100) set by admin to bypass
  // the dynamic formula. null / undefined means use auto-calculation.
  const rawOverride = fields.availability_override ?? fields.availabilityOverride;
  const availability_override = isPresent(rawOverride)
    ? Math.max(0, Math.min(100, round1(rawOverride)))
    : null;

  return {
    id: fields.id || uid('bdm'),
    period,
    month: monthName,
    year,
    section,
    breakdownCount,
    downtimeHours,
    operatingHours,
    mttr,
    mtbf,
    availability_override,
    remarks: fields.remarks || fields.notes || '',
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizePMSummary(fields) {
  const { period, year, monthName } = resolvePeriod(fields);
  const section = fields.section || fields.plantSection || MASTER_SECTION;
  const plannedCount = Math.max(0, Math.round(toNumber(fields.plannedCount ?? fields.actualPlannedPMCount)));
  const doneCount = Math.max(0, Math.round(toNumber(fields.doneCount ?? fields.actualDonePMCount)));
  const pendingCount = Math.max(0, Math.round(toNumber(fields.pendingCount ?? fields.overdueCount ?? fields.pendingPMCount)));
  const compliancePct = isPresent(fields.compliancePct)
    ? round1(fields.compliancePct)
    : plannedCount > 0 ? round1((doneCount / plannedCount) * 100) : 0;
  return {
    id: fields.id || uid('pmm'),
    period,
    month: monthName,
    year,
    section,
    plannedCount,
    doneCount,
    pendingCount,
    compliancePct,
    remarks: fields.remarks || fields.notes || '',
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMachineCloudRow(row) {
  const payload = asPlainObject(row.payload);
  return normalizeMachineRecord({
    ...payload,
    id: row.id,
    name: row.name || payload.name || '',
    section: row.section || payload.section || '',
    attachments: Array.isArray(row.attachments)
      ? row.attachments
      : Array.isArray(payload.attachments)
        ? payload.attachments
        : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function machineToCloudRow(machine) {
  const attachments = (machine.docs || []).map((doc) => ({
    id: doc.id,
    tab: doc.tab,
    file_name: doc.filename,
    file_format: doc.file_format,
    public_url: doc.public_url || doc.file_url || '',
    storage_path: doc.storage_path || '',
    uploaded_at: doc.uploaded_at || doc.uploadedAt || now(),
    uploaded_by: doc.uploaded_by || doc.uploadedBy || 'System',
    machine_id: machine.id,
    plant_section: machine.section || MASTER_SECTION,
  }));

  return {
    id: machine.id,
    name: machine.name,
    section: machine.section || MASTER_SECTION,
    attachments,
    payload: {
      machineCode: machine.machineCode || machine.id,
      department: machine.department || machine.section || '',
      area: machine.area || '',
      manufacturer: machine.manufacturer || '',
      model: machine.model || '',
      serialNumber: machine.serialNumber || '',
      installDate: machine.installDate || '',
      powerRating: machine.powerRating || '',
      voltage: machine.voltage || '',
      current: machine.current || '',
      runningHours: machine.runningHours || 0,
      criticality: machine.criticality || '',
      status: machine.status || 'running',
      spares: Array.isArray(machine.spares) ? machine.spares : [],
      photos: Array.isArray(machine.photos) ? machine.photos : [],
      createdAt: machine.createdAt || now(),
    },
  };
}

function normalizeBreakdownCloudRow(row) {
  return normalizeBreakdownSummary({
    id: row.id,
    month: row.month,
    year: row.year,
    section: row.section || MASTER_SECTION,
    breakdownCount: row.total_breakdowns,
    downtimeHours: row.downtime_hours,
    mttr: row.mttr,
    mtbf: row.mtbf,
    availability_override: row.availability_override ?? null,
    remarks: row.remarks || '',
  });
}

function breakdownToCloudRow(record) {
  const { year, month } = resolvePeriod(record);
  return {
    id: record.id,
    month,
    year,
    section: record.section || MASTER_SECTION,
    total_breakdowns: record.breakdownCount,
    downtime_hours: record.downtimeHours,
    mttr: record.mttr,
    mtbf: record.mtbf,
    availability_override: record.availability_override ?? null,
    remarks: record.remarks || '',
  };
}

function normalizePMCloudRow(row) {
  return normalizePMSummary({
    id: row.id,
    month: row.month,
    year: row.year,
    section: row.section || MASTER_SECTION,
    plannedCount: row.planned_count,
    doneCount: row.done_count,
    pendingCount: row.overdue_count,
  });
}

function pmToCloudRow(record) {
  const { year, month } = resolvePeriod(record);
  return {
    id: record.id,
    month,
    year,
    section: record.section || MASTER_SECTION,
    planned_count: record.plannedCount,
    done_count: record.doneCount,
    overdue_count: record.pendingCount,
  };
}

function normalizeEnergyCloudRow(row) {
  return normalizeEnergyRecord({
    id: row.id,
    date: row.date,
    source: row.source || '',
    remarks: row.remarks || '',
    plantSection: row.plant_section || '',
    dg500RunHours: row.dg500_run_hours,
    dg380RunHours: row.dg380_run_hours,
    fuelConsumedLitres: row.fuel_consumed_litres,
    solarGenerationKwh: row.solar_generation_kwh,
    plantSec: row.plant_sec,
    kwh: row.kwh,
    createdAt: row.created_at || row.date,
  });
}

function energyToCloudRow(record) {
  return {
    id: record.id,
    date: record.date,
    source: record.source || '',
    remarks: record.remarks || '',
    plant_section: record.plantSection || '',
    dg500_run_hours: record.dg500RunHours || 0,
    dg380_run_hours: record.dg380RunHours || 0,
    fuel_consumed_litres: record.fuelConsumedLitres || 0,
    solar_generation_kwh: record.solarGenerationKwh || 0,
    plant_sec: record.plantSec || 0,
    kwh: record.kwh || 0,
  };
}

const CLOUD_ENTITY_CONFIG = {
  machines: {
    table: 'machines',
    fromRow: normalizeMachineCloudRow,
    toRow: machineToCloudRow,
    orderBy: [{ column: 'name', ascending: true }, { column: 'id', ascending: true }],
  },
  breakdowns: {
    table: 'breakdown_logs',
    fromRow: normalizeBreakdownCloudRow,
    toRow: breakdownToCloudRow,
    orderBy: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }, { column: 'section', ascending: true }],
  },
  pms: {
    table: 'pm_logs',
    fromRow: normalizePMCloudRow,
    toRow: pmToCloudRow,
    orderBy: [{ column: 'year', ascending: false }, { column: 'month', ascending: false }, { column: 'section', ascending: true }],
  },
  energy: {
    table: 'energy_logs',
    fromRow: normalizeEnergyCloudRow,
    toRow: energyToCloudRow,
    orderBy: [{ column: 'date', ascending: false }],
  },
};

let version = 0;
const listeners = new Set();
let cloudSubscriptions = null;
let cloudInitStarted = false;
let cloudSyncChain = Promise.resolve();
const refreshTimers = {};

function loadPersistedValue(entity, fallback) {
  const primary = loadLS(KEYS[entity], undefined);
  if (primary !== undefined && primary !== null) {
    return primary;
  }

  for (const legacyKey of LEGACY_KEYS[entity] || []) {
    const legacy = loadLS(legacyKey, undefined);
    if (legacy !== undefined && legacy !== null) {
      return legacy;
    }
  }

  return fallback;
}

function removePersistedKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures and keep the in-memory reset path working.
  }
}

function loadPendingCloudOps() {
  const pending = loadLS(CLOUD_SYNC_QUEUE_KEY, []);
  return Array.isArray(pending) ? pending : [];
}

function savePendingCloudOps(queue) {
  saveLS(CLOUD_SYNC_QUEUE_KEY, queue);
}

function dropPendingCloudOpsForRecord(entity, recordId) {
  const nextQueue = loadPendingCloudOps().filter((item) => !(item.entity === entity && item.recordId === recordId));
  savePendingCloudOps(nextQueue);
  return nextQueue;
}

let state = {
  machines: mergeSeedMachines(loadPersistedValue('machines', null), SEED_MACHINES),
  breakdowns: loadPersistedValue('breakdowns', []).map((row) => row),
  pms: loadPersistedValue('pms', []).map((row) => row),
  energy: loadPersistedValue('energy', []).map(normalizeEnergyRecord),
  activity: loadPersistedValue('activity', []),
  settings: loadPersistedValue('settings', { plantName: 'Nathupur Formulation Plant', notifSeenAt: 0 }),
  sync: {
    cloudEnabled: isSupabaseConfigured,
    phase: isSupabaseConfigured ? 'booting' : 'local-only',
    pending: loadPendingCloudOps().length,
    lastSyncedAt: '',
    lastError: '',
  },
};

function persistEntity(entity) {
  saveLS(KEYS[entity], state[entity]);
}

function persistWholeState() {
  Object.keys(KEYS).forEach((entity) => persistEntity(entity));
}

function notifyStoreUpdate() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function updateSyncState(patch, notify = true) {
  state = {
    ...state,
    sync: {
      ...state.sync,
      ...patch,
    },
  };
  if (notify) notifyStoreUpdate();
}

function commit(entity) {
  persistEntity(entity);
  notifyStoreUpdate();
}

function commitAndQueue(entity, action, payload) {
  commit(entity);
  queueCloudMutation(entity, action, payload);
}

function replaceEntityState(entity, records, notify = true) {
  const nextValue = entity === 'machines'
    ? mergeSeedMachines(records, SEED_MACHINES)
    : records.map((row) => row);
  state = { ...state, [entity]: nextValue };
  persistEntity(entity);
  if (notify) notifyStoreUpdate();
}

function sectionMachineCount(section) {
  if (!section || section === MASTER_SECTION) return state.machines.length || 1;
  return state.machines.filter((machine) => machine.section === section).length || 1;
}

function summaryIdentity(record) {
  return `${record.section}::${record.period}`;
}

function buildPendingOp(entity, action, payload) {
  const recordId = typeof payload === 'string' ? payload : payload?.id;
  if (!recordId) return null;
  return {
    id: uid('sync'),
    entity,
    action,
    recordId,
    payload: action === 'delete' ? null : payload,
    queuedAt: now(),
  };
}

function queueCloudMutation(entity, action, payload, options = {}) {
  if (!SYNCED_ENTITIES.includes(entity)) return;

  const op = buildPendingOp(entity, action, payload);
  if (!op) return;

  const queue = loadPendingCloudOps();
  const withoutSameRecord = queue.filter((item) => !(item.entity === op.entity && item.recordId === op.recordId));
  const nextQueue = [...withoutSameRecord, op];
  savePendingCloudOps(nextQueue);
  updateSyncState({ pending: nextQueue.length, phase: isSupabaseConfigured ? state.sync.phase : 'local-only' });

  if (options.schedule !== false) {
    scheduleCloudFlush();
  }
}

function queueEntityReplacement(entity, nextRecords, previousRecords = []) {
  const nextIds = new Set(nextRecords.map((record) => record.id));
  previousRecords
    .filter((record) => !nextIds.has(record.id))
    .forEach((record) => queueCloudMutation(entity, 'delete', record.id, { schedule: false }));
  nextRecords.forEach((record) => queueCloudMutation(entity, 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
}

async function pushCloudOp(op) {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('Supabase is not configured');
  }

  const config = CLOUD_ENTITY_CONFIG[op.entity];
  if (!config) return;

  if (op.action === 'delete') {
    const { error } = await supabase.from(config.table).delete().eq('id', op.recordId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from(config.table)
    .upsert(config.toRow(op.payload), { onConflict: 'id' });
  if (error) throw error;
}

async function fetchCloudEntity(entity) {
  const config = CLOUD_ENTITY_CONFIG[entity];
  let query = supabase
    .from(config.table)
    .select('*');

  (config.orderBy || []).forEach(({ column, ascending }) => {
    query = query.order(column, { ascending });
  });

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(config.fromRow);
}

async function refreshCloudEntity(entity, notify = true) {
  if (!supabase || !isSupabaseConfigured) return state[entity];
  const records = await fetchCloudEntity(entity);
  replaceEntityState(entity, records, notify);
  return records;
}

function scheduleRemoteRefresh(entity) {
  if (!SYNCED_ENTITIES.includes(entity)) return;
  clearTimeout(refreshTimers[entity]);
  refreshTimers[entity] = setTimeout(() => {
    refreshCloudEntity(entity)
      .then(() => updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '' }))
      .catch((error) => updateSyncState({
        phase: isBrowserOnline() ? 'degraded' : 'offline',
        lastError: error.message || 'Realtime refresh failed',
      }));
  }, 250);
}

async function flushPendingCloudOps() {
  if (!supabase || !isSupabaseConfigured) {
    updateSyncState({ phase: 'local-only' });
    return;
  }

  if (!isBrowserOnline()) {
    updateSyncState({ phase: 'offline' });
    return;
  }

  const pending = loadPendingCloudOps();
  if (!pending.length) {
    updateSyncState({ pending: 0, phase: 'synced', lastError: '' }, false);
    return;
  }

  updateSyncState({ phase: 'syncing', pending: pending.length, lastError: '' });

  let remaining = pending;
  for (const op of pending) {
    await pushCloudOp(op);
    remaining = remaining.filter((item) => item.id !== op.id);
    savePendingCloudOps(remaining);
    updateSyncState({ pending: remaining.length, lastSyncedAt: now(), lastError: '' }, false);
  }

  updateSyncState({ phase: 'synced', pending: 0, lastSyncedAt: now(), lastError: '' });
}

function scheduleCloudFlush() {
  if (!isSupabaseConfigured || !supabase) return;
  if (!isBrowserOnline()) {
    updateSyncState({ phase: 'offline' });
    return;
  }

  cloudSyncChain = cloudSyncChain
    .then(() => flushPendingCloudOps())
    .catch((error) => updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      lastError: error.message || 'Cloud sync failed',
      pending: loadPendingCloudOps().length,
    }));
}

function startRealtimeSubscriptions() {
  if (!supabase || !isSupabaseConfigured || cloudSubscriptions) return;

  cloudSubscriptions = supabase.channel('ccpl-maintenance-sync');
  Object.entries(CLOUD_ENTITY_CONFIG).forEach(([entity, config]) => {
    cloudSubscriptions.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: config.table },
      () => scheduleRemoteRefresh(entity)
    );
  });

  cloudSubscriptions.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      updateSyncState({ phase: 'synced', lastError: '' });
    }
  });
}

function startOnlineListener() {
  if (typeof window === 'undefined' || window.__ccplCloudSyncBound) return;
  window.__ccplCloudSyncBound = true;

  window.addEventListener('online', () => {
    updateSyncState({ phase: 'syncing', lastError: '' });
    scheduleCloudFlush();
    SYNCED_ENTITIES.forEach((entity) => scheduleRemoteRefresh(entity));
  });

  window.addEventListener('offline', () => {
    updateSyncState({ phase: 'offline' });
  });
}

async function initializeCloudSync() {
  if (cloudInitStarted) return;
  cloudInitStarted = true;
  startOnlineListener();

  if (!supabase || !isSupabaseConfigured) {
    updateSyncState({ phase: 'local-only', cloudEnabled: false, pending: loadPendingCloudOps().length });
    return;
  }

  updateSyncState({ phase: isBrowserOnline() ? 'syncing' : 'offline', cloudEnabled: true });

  try {
    await flushPendingCloudOps();

    const [remoteMachines, remoteBreakdowns, remotePMs, remoteEnergy] = await Promise.all([
      fetchCloudEntity('machines'),
      fetchCloudEntity('breakdowns'),
      fetchCloudEntity('pms'),
      fetchCloudEntity('energy'),
    ]);

    const remoteSnapshots = {
      machines: remoteMachines,
      breakdowns: remoteBreakdowns,
      pms: remotePMs,
      energy: remoteEnergy,
    };

    if (remoteMachines.length) {
      replaceEntityState('machines', remoteMachines, false);
    }
    if (remoteBreakdowns.length) {
      replaceEntityState('breakdowns', remoteBreakdowns, false);
    }
    if (remotePMs.length) {
      replaceEntityState('pms', remotePMs, false);
    }
    if (remoteEnergy.length) {
      replaceEntityState('energy', remoteEnergy, false);
    }
    notifyStoreUpdate();

    SYNCED_ENTITIES.forEach((entity) => {
      if (!remoteSnapshots[entity].length && state[entity].length) {
        state[entity].forEach((record) => queueCloudMutation(entity, 'upsert', record, { schedule: false }));
      }
    });

    if (loadPendingCloudOps().length) {
      await flushPendingCloudOps();
      await Promise.all(SYNCED_ENTITIES.map((entity) => refreshCloudEntity(entity, false)));
      notifyStoreUpdate();
    }

    startRealtimeSubscriptions();
    updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '', pending: loadPendingCloudOps().length });
  } catch (error) {
    updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      lastError: error.message || 'Failed to initialize cloud sync',
      pending: loadPendingCloudOps().length,
    });
  }
}

function upsertSummary(entity, record, matchKey, userName, activityLabel, activityType) {
  const existing = state[entity].find((item) => item[matchKey] === record[matchKey] && item.section === record.section);
  if (existing) {
    const mergedRecord = { ...existing, ...record, id: existing.id };
    state = {
      ...state,
      [entity]: state[entity].map((item) => (item.id === existing.id ? mergedRecord : item)),
    };
    commitAndQueue(entity, 'upsert', mergedRecord);
    logActivity(userName, `updated ${activityLabel}`, `${record.section} · ${periodLabel(record.period)}`, activityType);
    return { ...mergedRecord, mode: 'updated' };
  }

  state = { ...state, [entity]: [record, ...state[entity]] };
  commitAndQueue(entity, 'upsert', record);
  logActivity(userName, `logged ${activityLabel}`, `${record.section} · ${periodLabel(record.period)}`, activityType);
  return { ...record, mode: 'created' };
}

persistWholeState();
initializeCloudSync();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getVersion = () => version;
export const getData = () => state;

export function useStore() {
  useSyncExternalStore(subscribe, getVersion);
  return state;
}

export function logActivity(userName, action, detail = '', type = 'info') {
  state = {
    ...state,
    activity: [{ id: uid('a'), ts: now(), user: userName || 'System', action, detail, type }, ...state.activity].slice(0, 120),
  };
  commit('activity');
}

export function updateSettings(patch) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  commit('settings');
}

export const getMachines = () => state.machines;
export const getMachine = (id) => state.machines.find((m) => m.id === id) || null;
export const getBreakdowns = () => state.breakdowns;
export const getPMs = () => state.pms;
export const getEnergyLogs = () => state.energy;

export function addMachine(fields, userName) {
  const machine = normalizeMachineRecord({
    ...fields,
    id: fields.id || fields.machineCode || uid('m'),
    createdAt: now(),
  });
  state = { ...state, machines: [machine, ...state.machines] };
  commitAndQueue('machines', 'upsert', machine);
  logActivity(userName, 'added machine', machine.name, 'machine');
  return machine;
}

export function updateMachine(id, patch, userName, silent = false) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== id) return machine;
      updatedMachine = normalizeMachineRecord({ ...machine, ...patch, id: machine.id });
      return updatedMachine;
    }),
  };
  if (!updatedMachine) return null;
  commitAndQueue('machines', 'upsert', updatedMachine);
  if (!silent && userName) logActivity(userName, 'updated machine', updatedMachine.name || '', 'machine');
  return updatedMachine;
}

export function deleteMachine(id, userName) {
  const name = getMachine(id)?.name || '';
  state = { ...state, machines: state.machines.filter((machine) => machine.id !== id) };
  commitAndQueue('machines', 'delete', id);
  logActivity(userName, 'deleted machine', name, 'machine');
}

export function addMachineDoc(machineId, doc, userName) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      const nextDoc = normalizeMachineDoc({
        ...doc,
        machine_id: machineId,
        plant_section: machine.section || MASTER_SECTION,
      });
      updatedMachine = normalizeMachineRecord({
        ...machine,
        docs: [nextDoc, ...(machine.docs || [])],
      });
      return updatedMachine;
    }),
  };
  if (!updatedMachine) return null;
  commitAndQueue('machines', 'upsert', updatedMachine);
  logActivity(userName, `uploaded ${doc.tab?.toUpperCase() || 'document'}`, `${doc.filename} → ${getMachine(machineId)?.name}`, 'upload');
  return getMachine(machineId);
}

export function removeMachineDoc(machineId, docId) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = normalizeMachineRecord({
        ...machine,
        docs: (machine.docs || []).filter((doc) => doc.id !== docId),
      });
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
  return getMachine(machineId);
}

export function addSparePart(machineId, spare) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        spares: [{ id: uid('s'), ...spare }, ...(machine.spares || [])],
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function removeSparePart(machineId, spareId) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        spares: (machine.spares || []).filter((spare) => spare.id !== spareId),
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function addMachinePhoto(machineId, photo) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        photos: [{ id: uid('p'), addedAt: now(), ...photo }, ...(machine.photos || [])],
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function removeMachinePhoto(machineId, photoId) {
  let updatedMachine = null;
  state = {
    ...state,
    machines: state.machines.map((machine) => {
      if (machine.id !== machineId) return machine;
      updatedMachine = {
        ...machine,
        photos: (machine.photos || []).filter((photo) => photo.id !== photoId),
      };
      return updatedMachine;
    }),
  };
  if (updatedMachine) commitAndQueue('machines', 'upsert', updatedMachine);
}

export function addBreakdown(fields, userName) {
  return upsertSummary(
    'breakdowns',
    normalizeBreakdownSummary(fields),
    'period',
    userName,
    'breakdown summary',
    'breakdown'
  );
}

export function updateBreakdown(id, patch, userName) {
  const existing = state.breakdowns.find((item) => item.id === id);
  if (!existing) return null;
  return addBreakdown({ ...existing, ...patch, id }, userName);
}

export function closeBreakdown(id, closure, userName) {
  return updateBreakdown(id, closure, userName);
}

export function deleteBreakdown(id, userName) {
  const record = state.breakdowns.find((item) => item.id === id);
  state = { ...state, breakdowns: state.breakdowns.filter((item) => item.id !== id) };
  commitAndQueue('breakdowns', 'delete', id);
  logActivity(userName, 'deleted breakdown summary', record ? `${record.section} · ${periodLabel(record.period)}` : '', 'breakdown');
}

export function addPM(fields, userName) {
  return upsertSummary(
    'pms',
    normalizePMSummary(fields),
    'period',
    userName,
    'PM summary',
    'pm'
  );
}

export function updatePM(id, patch, userName) {
  const existing = state.pms.find((item) => item.id === id);
  if (!existing) return null;
  return addPM({ ...existing, ...patch, id }, userName);
}

export function completePM(id, closure, userName) {
  return updatePM(id, closure, userName);
}

export function deletePM(id, userName) {
  const record = state.pms.find((item) => item.id === id);
  state = { ...state, pms: state.pms.filter((item) => item.id !== id) };
  commitAndQueue('pms', 'delete', id);
  logActivity(userName, 'deleted PM summary', record ? `${record.section} · ${periodLabel(record.period)}` : '', 'pm');
}

export function addEnergyLog(fields, userName) {
  const log = normalizeEnergyRecord(fields);
  state = { ...state, energy: [log, ...state.energy] };
  commitAndQueue('energy', 'upsert', log);
  const detail = log.source
    ? `${log.source} · ${log.kwh} kWh`
    : `${log.plantSection || 'Plant'} · Solar ${log.solarGenerationKwh} kWh · Fuel ${log.fuelConsumedLitres} L`;
  logActivity(userName, 'added energy log', detail, 'energy');
  return log;
}

export function updateEnergyLog(id, patch, userName) {
  const existing = state.energy.find((entry) => entry.id === id);
  if (!existing) return null;
  const updated = normalizeEnergyRecord({ ...existing, ...patch, id: existing.id });
  state = {
    ...state,
    energy: state.energy.map((entry) => (entry.id === id ? updated : entry)),
  };
  commitAndQueue('energy', 'upsert', updated);
  logActivity(userName, 'updated energy log', updated.source || updated.plantSection || '', 'energy');
  return updated;
}

export function deleteEnergyLog(id, userName) {
  state = { ...state, energy: state.energy.filter((entry) => entry.id !== id) };
  commitAndQueue('energy', 'delete', id);
  logActivity(userName, 'deleted energy log', '', 'energy');
}

export function exportBackup() {
  return JSON.stringify(
    {
      exportedAt: now(),
      machines: state.machines,
      breakdowns: state.breakdowns,
      pms: state.pms,
      energy: state.energy,
      activity: state.activity,
      settings: state.settings,
    },
    null,
    2
  );
}

export function importBackup(json) {
  const parsed = JSON.parse(json);

  if (Array.isArray(parsed.machines)) {
    const previousMachines = state.machines;
    state = { ...state, machines: mergeSeedMachines(parsed.machines, SEED_MACHINES) };
    commit('machines');
    queueEntityReplacement('machines', state.machines, previousMachines);
  }

  if (Array.isArray(parsed.breakdowns)) {
    const previousBreakdowns = state.breakdowns;
    state = { ...state, breakdowns: parsed.breakdowns.map(normalizeBreakdownSummary) };
    commit('breakdowns');
    queueEntityReplacement('breakdowns', state.breakdowns, previousBreakdowns);
  }

  if (Array.isArray(parsed.pms)) {
    const previousPMs = state.pms;
    state = { ...state, pms: parsed.pms.map(normalizePMSummary) };
    commit('pms');
    queueEntityReplacement('pms', state.pms, previousPMs);
  }

  if (Array.isArray(parsed.energy)) {
    state = { ...state, energy: parsed.energy.map(normalizeEnergyRecord) };
    commit('energy');
  }

  if (Array.isArray(parsed.activity)) {
    state = { ...state, activity: parsed.activity };
    commit('activity');
  }

  if (parsed.settings) {
    updateSettings(parsed.settings);
  }
}

export function resetPersistentData() {
  const previous = {
    machines: state.machines,
    breakdowns: state.breakdowns,
    pms: state.pms,
  };

  state = {
    machines: SEED_MACHINES.map(normalizeMachineRecord),
    breakdowns: [],
    pms: [],
    energy: [],
    activity: [],
    settings: { plantName: 'Nathupur Formulation Plant', notifSeenAt: 0 },
    sync: state.sync,
  };

  Object.entries(LEGACY_KEYS).forEach(([, keys]) => {
    keys.forEach((key) => removePersistedKey(key));
  });

  persistWholeState();
  notifyStoreUpdate();

  queueEntityReplacement('machines', state.machines, previous.machines);
  queueEntityReplacement('breakdowns', state.breakdowns, previous.breakdowns);
  queueEntityReplacement('pms', state.pms, previous.pms);
}

function findMachineByIdentity(machineCode, name, section) {
  const codeKey = normalizeText(machineCode);
  const nameKey = normalizeText(name);
  const sectionKey = normalizeText(section);
  return state.machines.find((machine) => (
    (codeKey && (normalizeText(machine.machineCode) === codeKey || normalizeText(machine.id) === codeKey)) ||
    (nameKey && normalizeText(machine.name) === nameKey && (!sectionKey || normalizeText(machine.section) === sectionKey))
  )) || null;
}

function ensureMachine(fields) {
  const existing = findMachineByIdentity(fields.machineCode, fields.name, fields.section);
  if (existing) {
    return existing;
  }

  const machine = normalizeMachineRecord({
    ...fields,
    id: fields.machineCode || fields.id || uid('m'),
    machineCode: fields.machineCode || fields.id || '',
    createdAt: now(),
  });
  state = { ...state, machines: [machine, ...state.machines] };
  return machine;
}

export function importMachinesBulk(rows, userName) {
  let created = 0;
  let updated = 0;
  const touchedMachines = [];

  rows.forEach((row) => {
    const incoming = normalizeMachineRecord({
      id: row.id || row.machineCode,
      machineCode: row.machineCode || row.id,
      name: row.name || row.machineName,
      section: row.section || row.plantSection,
      area: row.area || row.location || '',
      criticality: row.criticality || '',
      status: row.status || 'running',
    });
    const existing = findMachineByIdentity(incoming.machineCode, incoming.name, incoming.section);
    if (existing) {
      const merged = { ...existing, ...incoming, id: existing.id };
      state = {
        ...state,
        machines: state.machines.map((machine) => (machine.id === existing.id ? merged : machine)),
      };
      touchedMachines.push(merged);
      updated += 1;
      return;
    }
    state = { ...state, machines: [incoming, ...state.machines] };
    touchedMachines.push(incoming);
    created += 1;
  });

  commit('machines');
  touchedMachines.forEach((machine) => queueCloudMutation('machines', 'upsert', machine, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported machines', `${created} created · ${updated} updated`, 'machine');
  return { created, updated, total: rows.length };
}

export function importPMBulk(rows, userName) {
  let created = 0;
  let updated = 0;

  rows.forEach((row) => {
    const record = normalizePMSummary(row);
    const existing = state.pms.find((item) => summaryIdentity(item) === summaryIdentity(record));
    if (existing) updated += 1;
    else created += 1;
    addPM(record, userName);
  });

  return { created, updated, total: rows.length };
}

export function importBreakdownsBulk(rows, userName) {
  let created = 0;
  let updated = 0;

  rows.forEach((row) => {
    const record = normalizeBreakdownSummary(row);
    const existing = state.breakdowns.find((item) => summaryIdentity(item) === summaryIdentity(record));
    if (existing) updated += 1;
    else created += 1;
    addBreakdown(record, userName);
  });

  return { created, updated, total: rows.length };
}

export function importEnergyBulk(rows, userName) {
  const imports = rows.map((row) => normalizeEnergyRecord({
    date: String(row.date || '').slice(0, 10),
    plantSection: row.plantSection || '',
    dg500RunHours: row.dg500RunHours,
    dg380RunHours: row.dg380RunHours,
    fuelConsumedLitres: row.fuelConsumedLitres,
    solarGenerationKwh: row.solarGenerationKwh,
    plantSec: row.plantSec,
    remarks: 'Imported from bulk file',
  }));

  state = { ...state, energy: [...imports, ...state.energy] };
  commit('energy');
  imports.forEach((record) => queueCloudMutation('energy', 'upsert', record, { schedule: false }));
  scheduleCloudFlush();
  logActivity(userName, 'bulk imported energy logs', `${imports.length} rows added`, 'energy');
  return { created: imports.length, total: imports.length };
}

export async function syncCloudDataNow() {
  await flushPendingCloudOps();
  if (supabase && isSupabaseConfigured) {
    await Promise.all([...SYNCED_ENTITIES].map((entity) => refreshCloudEntity(entity, false)));
    notifyStoreUpdate();
  }
}

export async function syncMachineRecordNow(machineId) {
  const machine = getMachine(machineId);
  if (!machine) {
    throw new Error('Machine not found');
  }

  if (!supabase || !isSupabaseConfigured) {
    return machine;
  }

  updateSyncState({ phase: isBrowserOnline() ? 'syncing' : 'offline', lastError: '' });

  try {
    await pushCloudOp({
      entity: 'machines',
      action: 'upsert',
      recordId: machine.id,
      payload: machine,
    });
    const remaining = dropPendingCloudOpsForRecord('machines', machine.id);
    await refreshCloudEntity('machines', false);
    updateSyncState({
      phase: 'synced',
      pending: remaining.length,
      lastSyncedAt: now(),
      lastError: '',
    }, false);
    notifyStoreUpdate();
    return getMachine(machineId);
  } catch (error) {
    updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      pending: loadPendingCloudOps().length,
      lastError: error.message || 'Failed to sync machine record',
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Master Excel bulk import — runs PM, Breakdown, and Energy imports in one
// call from the result of parseMasterImportFile(). Every upsert goes through
// the standard commitAndQueue path so changes reach Supabase Realtime and
// every connected client PC immediately.
// ---------------------------------------------------------------------------

/**
 * @param {import('./bulkImport.js').MasterImportResult} masterResult
 * @param {string} userName
 * @returns {{ pm: object, breakdowns: object, energy: object, total: number }}
 */
export function importMasterExcelBulk(masterResult, userName) {
  const pmResult = masterResult?.pm?.parsedRows?.length
    ? importPMBulk(masterResult.pm.parsedRows, userName)
    : { created: 0, updated: 0, total: 0 };

  const bdResult = masterResult?.breakdowns?.parsedRows?.length
    ? importBreakdownsBulk(masterResult.breakdowns.parsedRows, userName)
    : { created: 0, updated: 0, total: 0 };

  const energyResult = masterResult?.energy?.parsedRows?.length
    ? importEnergyBulk(masterResult.energy.parsedRows, userName)
    : { created: 0, updated: 0, total: 0 };

  const total = pmResult.total + bdResult.total + energyResult.total;

  logActivity(
    userName,
    'master Excel import',
    `PM ${pmResult.total} · Breakdowns ${bdResult.total} · Energy ${energyResult.total} rows — syncing to all connected PCs`,
    'upload'
  );

  return { pm: pmResult, breakdowns: bdResult, energy: energyResult, total };
}

// ---------------------------------------------------------------------------
// Live Sheet API / URL polling sync (Option B)
//
// Consumers can configure a remote JSON endpoint in app settings:
//   updateSettings({ masterSheetEndpoint: 'https://script.google.com/...' })
//
// The endpoint must return JSON in the shape:
//   { pm?: Row[], breakdowns?: Row[], energy?: Row[] }
// where each array uses the same column keys accepted by the bulk importers.
//
// Call syncFromMasterSheet() on-demand or on a polling interval.
// ---------------------------------------------------------------------------

let masterSheetPollingTimer = null;

/**
 * Pull data from the configured remote sheet endpoint and apply it to the
 * store, syncing all three entities to Supabase.
 *
 * @returns {Promise<{ pm: object, breakdowns: object, energy: object, total: number, endpoint: string }>}
 */
export async function syncFromMasterSheet() {
  const endpoint = state.settings?.masterSheetEndpoint;
  if (!endpoint) {
    throw new Error('No masterSheetEndpoint configured. Add it via Settings → Master Sheet Sync.');
  }

  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Master sheet fetch failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const userName = 'Master Sheet Sync';

  const pmRows = Array.isArray(json.pm) ? json.pm : [];
  const bdRows = Array.isArray(json.breakdowns) ? json.breakdowns : [];
  const energyRows = Array.isArray(json.energy) ? json.energy : [];

  const pmResult = pmRows.length ? importPMBulk(pmRows, userName) : { created: 0, updated: 0, total: 0 };
  const bdResult = bdRows.length ? importBreakdownsBulk(bdRows, userName) : { created: 0, updated: 0, total: 0 };
  const energyResult = energyRows.length ? importEnergyBulk(energyRows, userName) : { created: 0, updated: 0, total: 0 };

  const total = pmResult.total + bdResult.total + energyResult.total;

  logActivity(
    userName,
    'live sheet sync',
    `PM ${pmResult.total} · Breakdowns ${bdResult.total} · Energy ${energyResult.total} rows pulled from remote endpoint`,
    'upload'
  );

  return { pm: pmResult, breakdowns: bdResult, energy: energyResult, total, endpoint };
}

/**
 * Start polling the configured master sheet endpoint at a given interval.
 * Calling again with a new interval replaces the existing timer.
 *
 * @param {number} intervalMs  Default: 5 minutes (300_000 ms)
 */
export function startMasterSheetPolling(intervalMs = 300_000) {
  stopMasterSheetPolling();
  masterSheetPollingTimer = setInterval(() => {
    syncFromMasterSheet().catch((err) => {
      updateSyncState({ lastError: `Master sheet poll: ${err.message}` }, false);
    });
  }, intervalMs);
}

/** Cancel any active master sheet polling timer. */
export function stopMasterSheetPolling() {
  if (masterSheetPollingTimer !== null) {
    clearInterval(masterSheetPollingTimer);
    masterSheetPollingTimer = null;
  }
}
