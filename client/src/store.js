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
  amc: 'CCPL_AMC_RECORDS_V1',
  machineBreakdownLogs: 'CCPL_MACHINE_BD_LOGS_V1',
  machinePmRecords: 'CCPL_MACHINE_PM_RECORDS_V1',
  plantSections: 'CCPL_PLANT_SECTIONS_V1',
  activity: 'ccpl_activity_v1',
  settings: 'ccpl_settings_v1',
};

const LEGACY_KEYS = {
  machines: ['ccpl_machines_v2'],
  breakdowns: ['ccpl_breakdowns_v2'],
  pms: ['ccpl_pms_v2'],
  energy: ['ccpl_energy_v1'],
  amc: [],
  machineBreakdownLogs: [],
  machinePmRecords: [],
  plantSections: [],
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
const SYNCED_ENTITIES = ['machines', 'breakdowns', 'pms', 'energy', 'amc', 'machineBreakdownLogs', 'machinePmRecords'];

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
  const dg500RunHours = toNumber(fields.dg500RunHours ?? fields.dg500RunHrs);
  const dg380RunHours = toNumber(fields.dg380RunHours ?? fields.dg380RunHrs);
  const fuelConsumedLitres = toNumber(fields.fuelConsumedLitres ?? fields.fuelLtrs);
  const solarGenerationKwh = toNumber(fields.solarGenerationKwh ?? fields.solarKwh);
  const uhbvnlUnit1Kwh = toNumber(fields.uhbvnlUnit1Kwh);
  const uhbvnlUnit2Kwh = toNumber(fields.uhbvnlUnit2Kwh);
  const totalGridKwh = toNumber(fields.totalGridKwh) || (uhbvnlUnit1Kwh + uhbvnlUnit2Kwh);
  // totalKwh = grid + solar + DG-generated (if separate DG kWh provided; else omit)
  const dgKwh = toNumber(fields.dgKwh);
  const totalKwh = toNumber(fields.totalKwh) ||
    (totalGridKwh + solarGenerationKwh + dgKwh) ||
    toNumber(fields.kwh || fields.solarGenerationKwh);
  const plantSec = toNumber(fields.plantSec);

  // Section sub-meter consumption dict — preserve as plain object
  const raw = fields.sectionConsumption;
  const sectionConsumption = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? { ...raw }
    : {};

  return {
    id: fields.id || uid('e'),
    createdAt: fields.createdAt || now(),
    date: fields.date || new Date().toISOString().slice(0, 10),
    source: fields.source || '',
    remarks: fields.remarks || '',
    plantSection: fields.plantSection || fields.section || '',
    // ── Dual-unit grid ─────────────────────────────────────────────────────
    uhbvnlUnit1Kwh,
    uhbvnlUnit2Kwh,
    totalGridKwh,
    // ── DG generators ──────────────────────────────────────────────────────
    dg500RunHours,      // kept for backward compat
    dg380RunHours,      // kept for backward compat
    // ── Fuel & solar ───────────────────────────────────────────────────────
    fuelConsumedLitres, // kept for backward compat
    solarGenerationKwh, // kept for backward compat
    // ── Totals ─────────────────────────────────────────────────────────────
    dgKwh,
    totalKwh,
    plantSec,
    // legacy single-value kwh (used by Reports.jsx / analytics energyTotal)
    kwh: totalKwh || toNumber(fields.kwh || fields.solarGenerationKwh),
    // ── Section sub-meters ─────────────────────────────────────────────────
    sectionConsumption,
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

  const startTime = fields.startTime || fields.start_time || '';
  const endTime = fields.endTime || fields.end_time || '';
  let durationHours = toNumber(fields.durationHours ?? fields.duration_hours);
  if (!durationHours && startTime && endTime) {
    const diff = (new Date(endTime) - new Date(startTime)) / 3_600_000;
    durationHours = diff > 0 ? round1(diff) : 0;
  }

  return {
    id: fields.id || uid('pmm'),
    period,
    month: monthName,
    year,
    section,
    machineId: fields.machineId || '',
    plannedCount,
    doneCount,
    pendingCount,
    compliancePct,
    startTime,
    endTime,
    durationHours,
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
    period: row.period,
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
    period: record.period,
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
    period: row.period,
    month: row.month,
    year: row.year,
    section: row.section || MASTER_SECTION,
    plannedCount: row.planned_count,
    doneCount: row.done_count,
    pendingCount: row.overdue_count,
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    durationHours: row.duration_hours || 0,
  });
}

function pmToCloudRow(record) {
  const { year, month } = resolvePeriod(record);
  return {
    id: record.id,
    month,
    year,
    period: record.period,
    section: record.section || MASTER_SECTION,
    planned_count: record.plannedCount,
    done_count: record.doneCount,
    overdue_count: record.pendingCount,
    start_time: record.startTime || null,
    end_time: record.endTime || null,
    duration_hours: record.durationHours || 0,
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
    uhbvnlUnit1Kwh: row.uhbvnl_unit1_kwh,
    uhbvnlUnit2Kwh: row.uhbvnl_unit2_kwh,
    totalGridKwh: row.total_grid_kwh,
    dgKwh: row.dg_kwh,
    totalKwh: row.total_kwh,
    plantSec: row.plant_sec,
    kwh: row.kwh,
    sectionConsumption: row.section_consumption || {},
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
    uhbvnl_unit1_kwh: record.uhbvnlUnit1Kwh || 0,
    uhbvnl_unit2_kwh: record.uhbvnlUnit2Kwh || 0,
    total_grid_kwh: record.totalGridKwh || 0,
    dg_kwh: record.dgKwh || 0,
    total_kwh: record.totalKwh || 0,
    plant_sec: record.plantSec || 0,
    kwh: record.kwh || 0,
    section_consumption: record.sectionConsumption || {},
  };
}

// ── AMC (Annual Maintenance Contract) records ─────────────────────────────
function normalizeAmcRecord(fields) {
  return {
    id: fields.id || uid('amc'),
    machineId: fields.machineId || '',
    vendorName: String(fields.vendorName || '').trim(),
    contractStartDate: fields.contractStartDate || '',
    contractEndDate: fields.contractEndDate || '',
    totalVisitsAgreed: toNumber(fields.totalVisitsAgreed),
    completedVisits: toNumber(fields.completedVisits),
    // Document references stored as array of { id, filename, storagePath, publicUrl, uploadedAt, uploadedBy, docType }
    documents: Array.isArray(fields.documents) ? fields.documents : [],
    remarks: fields.remarks || '',
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeAmcCloudRow(row) {
  return normalizeAmcRecord({
    id: row.id,
    machineId: row.machine_id || '',
    vendorName: row.vendor_name || '',
    contractStartDate: row.contract_start_date || '',
    contractEndDate: row.contract_end_date || '',
    totalVisitsAgreed: row.total_visits_agreed,
    completedVisits: row.completed_visits,
    documents: row.documents || [],
    remarks: row.remarks || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function amcToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    vendor_name: record.vendorName,
    contract_start_date: record.contractStartDate,
    contract_end_date: record.contractEndDate,
    total_visits_agreed: record.totalVisitsAgreed || 0,
    completed_visits: record.completedVisits || 0,
    documents: record.documents || [],
    remarks: record.remarks || '',
    updated_at: now(),
  };
}

// ── Per-machine breakdown log records ─────────────────────────────────────

/**
 * Compute downtime hours from startTime / endTime ISO strings.
 * Returns null when either value is missing or the range is invalid.
 */
function calcDowntimeFromTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const start = new Date(startTime).getTime();
  const end   = new Date(endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round(((end - start) / 3_600_000) * 100) / 100; // hours, 2 dp
}

function normalizeMachineBreakdownLog(fields) {
  const startTime = fields.startTime || fields.start_time || '';
  const endTime   = fields.endTime   || fields.end_time   || '';

  // Derive date from startTime when date is absent
  let date = fields.date || '';
  if (!date && startTime) {
    date = new Date(startTime).toISOString().slice(0, 10);
  }
  if (!date) date = new Date().toISOString().slice(0, 10);

  // Downtime: auto-calculate from times when not explicitly provided
  const autoDowntime = calcDowntimeFromTimes(startTime, endTime);
  const downtimeHours = isPresent(fields.downtimeHours) && toNumber(fields.downtimeHours) > 0
    ? toNumber(fields.downtimeHours)
    : (autoDowntime !== null ? autoDowntime : 0);

  return {
    id: fields.id || uid('bdl'),
    machineId: fields.machineId || '',
    machineCode: fields.machineCode || '',
    machineName: fields.machineName || '',
    plantSection: fields.plantSection || '',
    date,
    startTime,
    endTime,
    downtimeHours,
    failureCause: String(fields.failureCause || '').trim(),
    actionTaken: String(fields.actionTaken || '').trim(),
    status: String(fields.status || 'closed').toLowerCase(),
    remarks: String(fields.remarks || '').trim(),
    createdAt: fields.createdAt || now(),
  };
}

function normalizeMachineBreakdownLogCloudRow(row) {
  return normalizeMachineBreakdownLog({
    id: row.id,
    machineId: row.machine_id || '',
    machineCode: row.machine_code || '',
    machineName: row.machine_name || '',
    plantSection: row.plant_section || '',
    date: row.date,
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    downtimeHours: row.downtime_hours,
    failureCause: row.failure_cause || '',
    actionTaken: row.action_taken || '',
    status: row.status || 'closed',
    remarks: row.remarks || '',
    createdAt: row.created_at,
  });
}

function machineBreakdownLogToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    machine_code: record.machineCode,
    machine_name: record.machineName,
    plant_section: record.plantSection,
    date: record.date,
    start_time: record.startTime || null,
    end_time: record.endTime || null,
    downtime_hours: record.downtimeHours || 0,
    failure_cause: record.failureCause,
    action_taken: record.actionTaken,
    status: record.status,
    remarks: record.remarks,
  };
}

// ── Per-machine PM records ──────────────────────────────────────────────────
function normalizeMachinePmRecord(fields) {
  const pmDate = fields.pmDate || fields.pm_date || new Date().toISOString().slice(0, 10);
  return {
    id: fields.id || uid('mpm'),
    machineId: fields.machineId || '',
    machineCode: fields.machineCode || '',
    machineName: fields.machineName || '',
    plantSection: fields.plantSection || '',
    pmDate,
    pmType: String(fields.pmType || fields.pm_type || 'Preventive').trim(),
    task: String(fields.task || '').trim(),
    status: String(fields.status || 'completed').toLowerCase(),
    completed: fields.completed !== false && fields.completed !== 'false',
    action: String(fields.action || '').trim(),
    technician: String(fields.technician || '').trim(),
    remarks: String(fields.remarks || '').trim(),
    createdAt: fields.createdAt || now(),
    updatedAt: fields.updatedAt || now(),
  };
}

function normalizeMachinePmCloudRow(row) {
  return normalizeMachinePmRecord({
    id: row.id,
    machineId: row.machine_id || '',
    machineCode: row.machine_code || '',
    machineName: row.machine_name || '',
    plantSection: row.plant_section || '',
    pmDate: row.pm_date,
    pmType: row.pm_type || '',
    task: row.task || '',
    status: row.status || 'completed',
    completed: row.completed,
    action: row.action || '',
    technician: row.technician || '',
    remarks: row.remarks || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function machinePmRecordToCloudRow(record) {
  return {
    id: record.id,
    machine_id: record.machineId,
    machine_code: record.machineCode,
    machine_name: record.machineName,
    plant_section: record.plantSection,
    pm_date: record.pmDate,
    pm_type: record.pmType,
    task: record.task,
    status: record.status,
    completed: record.completed,
    action: record.action,
    technician: record.technician,
    remarks: record.remarks,
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
  amc: {
    table: 'amc_records',
    fromRow: normalizeAmcCloudRow,
    toRow: amcToCloudRow,
    orderBy: [{ column: 'created_at', ascending: false }],
  },
  machineBreakdownLogs: {
    table: 'machine_breakdown_logs',
    fromRow: normalizeMachineBreakdownLogCloudRow,
    toRow: machineBreakdownLogToCloudRow,
    orderBy: [{ column: 'date', ascending: false }],
  },
  machinePmRecords: {
    table: 'machine_pm_records',
    fromRow: normalizeMachinePmCloudRow,
    toRow: machinePmRecordToCloudRow,
    orderBy: [{ column: 'pm_date', ascending: false }],
  },
};

let version = 0;
const listeners = new Set();
let cloudSubscriptions = null;
let cloudInitStarted = false;
let cloudSyncChain = Promise.resolve();
const refreshTimers = {};
// Tracks reconnect attempt count for exponential back-off
let realtimeReconnectAttempts = 0;

// ── Diagnostic logger ──────────────────────────────────────────────────────
// Set VITE_REALTIME_DEBUG=true in your .env to enable verbose Realtime logs.
// All log calls go through this helper so they're easy to strip later.
const RT_DEBUG = import.meta.env.VITE_REALTIME_DEBUG === 'true';
function rtLog(level, ...args) {
  if (!RT_DEBUG && level === 'debug') return;
  const tag = '[Realtime]';
  if (level === 'error') console.error(tag, ...args);
  else if (level === 'warn') console.warn(tag, ...args);
  else console.log(tag, ...args);
}

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
  amc: loadPersistedValue('amc', []).map(normalizeAmcRecord),
  machineBreakdownLogs: loadPersistedValue('machineBreakdownLogs', []).map(normalizeMachineBreakdownLog),
  machinePmRecords: loadPersistedValue('machinePmRecords', []).map(normalizeMachinePmRecord),
  plantSections: loadPersistedValue('plantSections', []),
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

/**
 * Persist locally + notify UI + write directly to Supabase immediately.
 * Direct write is critical for cross-PC / cross-device Realtime broadcast:
 * Supabase fires a postgres_changes event the moment the DB row changes,
 * which every subscribed client receives within ~100-300 ms.
 */
function commitAndQueue(entity, action, payload) {
  commit(entity);
  // Fire-and-forget direct write — queues to localStorage only if offline/error
  writeToCloudNow(entity, action, payload).catch(() => {
    // Error already handled inside writeToCloudNow; retry is queued
  });
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
    if (error) {
      rtLog('error', `DELETE failed on ${config.table} id=${op.recordId}:`, error.message, error.details || '');
      throw error;
    }
    rtLog('debug', `DELETE ok: ${config.table} id=${op.recordId}`);
    return;
  }

  const row = config.toRow(op.payload);
  const { error } = await supabase
    .from(config.table)
    .upsert(row, { onConflict: 'id' });
  if (error) {
    rtLog('error', `UPSERT failed on ${config.table} id=${op.recordId}:`, error.message, error.details || '', 'row keys:', Object.keys(row).join(', '));
    throw error;
  }
  rtLog('debug', `UPSERT ok: ${config.table} id=${op.recordId}`);
}

/**
 * Write a single record directly to Supabase right now — no queue, no delay.
 * Falls back to queueing if Supabase is offline or not configured.
 * This is the key path for instant multi-PC propagation: the DB write fires
 * Realtime postgres_changes immediately, which every connected client receives.
 */
async function writeToCloudNow(entity, action, payload) {
  if (!supabase || !isSupabaseConfigured || !isBrowserOnline()) {
    // Offline or not configured — queue for later
    queueCloudMutation(entity, action, payload);
    return;
  }

  const op = buildPendingOp(entity, action, payload);
  if (!op) return;

  try {
    await pushCloudOp(op);
    // Success — remove from queue in case it was previously queued
    dropPendingCloudOpsForRecord(entity, op.recordId);
    updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '' }, false);
  } catch (err) {
    // Write failed — queue it for retry
    queueCloudMutation(entity, action, payload);
    updateSyncState({
      phase: isBrowserOnline() ? 'degraded' : 'offline',
      lastError: err.message || 'Write failed',
    }, false);
  }
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

  let remaining = [...pending];
  for (const op of pending) {
    try {
      await pushCloudOp(op);
      remaining = remaining.filter((item) => item.id !== op.id);
      savePendingCloudOps(remaining);
      updateSyncState({ pending: remaining.length, lastSyncedAt: now(), lastError: '' }, false);
    } catch (err) {
      // Keep this op in the queue and log — continue flushing the rest
      rtLog('error', `Queue flush: op ${op.id} (${op.entity}/${op.action}) failed — kept in queue:`, err.message);
      updateSyncState({ lastError: err.message || 'Flush error' }, false);
    }
  }

  const stillPending = loadPendingCloudOps().length;
  updateSyncState({
    phase: stillPending ? 'degraded' : 'synced',
    pending: stillPending,
    lastSyncedAt: now(),
    ...(stillPending ? {} : { lastError: '' }),
  });
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

/**
 * Apply a single Realtime payload record directly to the in-memory state
 * without performing a full round-trip fetch.  Falls back to a full refresh
 * when the payload row is unavailable (e.g. DELETE events on Postgres that
 * don't include the old record).
 */
function applyRealtimePayload(entity, payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  const config = CLOUD_ENTITY_CONFIG[entity];
  if (!config) return;

  rtLog('info',
    `← ${eventType} on ${config.table}`,
    `id=${newRow?.id || oldRow?.id || '?'}`,
  );

  // DELETE — remove by id
  if (eventType === 'DELETE') {
    const deletedId = oldRow?.id;
    if (!deletedId) {
      rtLog('warn', `DELETE on ${config.table} had no old.id — falling back to full refresh`);
      scheduleRemoteRefresh(entity);
      return;
    }
    if (entity === 'machines') {
      state = { ...state, machines: state.machines.filter((m) => m.id !== deletedId) };
    } else {
      state = { ...state, [entity]: state[entity].filter((r) => r.id !== deletedId) };
    }
    persistEntity(entity);
    notifyStoreUpdate();
    rtLog('debug', `Applied DELETE ${config.table} id=${deletedId}`);
    return;
  }

  // INSERT / UPDATE — normalize and upsert into local state
  if (!newRow?.id) {
    rtLog('warn', `${eventType} on ${config.table} had no new.id — falling back to full refresh`);
    scheduleRemoteRefresh(entity);
    return;
  }

  const normalized = config.fromRow(newRow);

  if (entity === 'machines') {
    const exists = state.machines.some((m) => m.id === normalized.id);
    state = {
      ...state,
      machines: exists
        ? state.machines.map((m) => (m.id === normalized.id ? normalized : m))
        : [normalized, ...state.machines],
    };
  } else {
    const exists = state[entity].some((r) => r.id === normalized.id);
    state = {
      ...state,
      [entity]: exists
        ? state[entity].map((r) => (r.id === normalized.id ? normalized : r))
        : [normalized, ...state[entity]],
    };
  }

  persistEntity(entity);
  notifyStoreUpdate();
  updateSyncState({ phase: 'synced', lastSyncedAt: now(), lastError: '' }, false);
  rtLog('debug', `Applied ${eventType} ${config.table} id=${normalized.id}`);
}

function teardownRealtimeSubscriptions() {
  if (cloudSubscriptions && supabase) {
    try { supabase.removeChannel(cloudSubscriptions); } catch { /* ignore */ }
    cloudSubscriptions = null;
  }
}

function startRealtimeSubscriptions() {
  if (!supabase || !isSupabaseConfigured) return;

  // Tear down any stale channel before creating a fresh one
  teardownRealtimeSubscriptions();

  rtLog('info', `Starting Realtime channel (attempt ${realtimeReconnectAttempts + 1})`);

  cloudSubscriptions = supabase.channel('ccpl-maintenance-sync', {
    config: { broadcast: { self: false } },
  });

  Object.entries(CLOUD_ENTITY_CONFIG).forEach(([entity, config]) => {
    cloudSubscriptions.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: config.table },
      (payload) => {
        // Optimistically apply the payload directly for instant multi-PC broadcast.
        // If the payload row is missing or malformed, fall back to a full refresh.
        try {
          applyRealtimePayload(entity, payload);
        } catch (err) {
          rtLog('error', `applyRealtimePayload threw for ${entity}:`, err);
          scheduleRemoteRefresh(entity);
        }
      }
    );
  });

  cloudSubscriptions.subscribe((status, err) => {
    rtLog('info', `Channel status: ${status}${err ? ' — ' + (err.message || err) : ''}`);

    if (status === 'SUBSCRIBED') {
      realtimeReconnectAttempts = 0; // reset back-off counter on clean connect
      updateSyncState({ phase: 'synced', lastError: '' });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // Channel lost — do a full refresh so we don't drift, then reconnect
      updateSyncState({
        phase: isBrowserOnline() ? 'degraded' : 'offline',
        lastError: `Realtime: ${status}${err ? ' – ' + (err.message || err) : ''}`,
      });

      SYNCED_ENTITIES.forEach((entity) => scheduleRemoteRefresh(entity));

      // Exponential back-off: 2s, 4s, 8s … capped at 60s, plus ±500 ms jitter
      realtimeReconnectAttempts += 1;
      const baseDelay = Math.min(2_000 * Math.pow(2, realtimeReconnectAttempts - 1), 60_000);
      const jitter = Math.random() * 500;
      const delay = Math.round(baseDelay + jitter);

      rtLog('warn', `Reconnecting in ${delay} ms (attempt ${realtimeReconnectAttempts})`);
      setTimeout(() => {
        if (isBrowserOnline() && isSupabaseConfigured) {
          startRealtimeSubscriptions();
        }
      }, delay);
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
    // Re-establish Realtime channel after coming back online
    if (!cloudSubscriptions) startRealtimeSubscriptions();
  });

  window.addEventListener('offline', () => {
    updateSyncState({ phase: 'offline' });
  });

  // Re-subscribe when app returns from background (critical for mobile)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isBrowserOnline() && isSupabaseConfigured) {
      // Refresh all entities to catch up on missed events
      SYNCED_ENTITIES.forEach((entity) => scheduleRemoteRefresh(entity));
      // Re-subscribe if the channel was lost while in background
      if (!cloudSubscriptions) startRealtimeSubscriptions();
    }
  });
}

async function initializeCloudSync() {
  if (cloudInitStarted) return;
  cloudInitStarted = true;
  startOnlineListener();

  if (!supabase || !isSupabaseConfigured) {
    updateSyncState({ phase: 'local-only', cloudEnabled: false, pending: loadPendingCloudOps().length });
    rtLog('info', 'Supabase not configured — running in local-only mode');
    return;
  }

  rtLog('info', 'Initializing cloud sync…');
  updateSyncState({ phase: isBrowserOnline() ? 'syncing' : 'offline', cloudEnabled: true });

  // Start Realtime subscriptions FIRST so we don't miss any events that arrive
  // while the initial data fetch is in-flight.
  startRealtimeSubscriptions();

  try {
    await flushPendingCloudOps();

    const [remoteMachines, remoteBreakdowns, remotePMs, remoteEnergy, remoteAmc, remoteBreakdownLogs] = await Promise.all([
      fetchCloudEntity('machines'),
      fetchCloudEntity('breakdowns'),
      fetchCloudEntity('pms'),
      fetchCloudEntity('energy'),
      fetchCloudEntity('amc'),
      fetchCloudEntity('machineBreakdownLogs'),
    ]);

    const remoteSnapshots = {
      machines: remoteMachines,
      breakdowns: remoteBreakdowns,
      pms: remotePMs,
      energy: remoteEnergy,
      amc: remoteAmc,
      machineBreakdownLogs: remoteBreakdownLogs,
    };

    if (remoteMachines.length) replaceEntityState('machines', remoteMachines, false);
    if (remoteBreakdowns.length) replaceEntityState('breakdowns', remoteBreakdowns, false);
    if (remotePMs.length) replaceEntityState('pms', remotePMs, false);
    if (remoteEnergy.length) replaceEntityState('energy', remoteEnergy, false);
    if (remoteAmc.length) replaceEntityState('amc', remoteAmc, false);
    if (remoteBreakdownLogs.length) replaceEntityState('machineBreakdownLogs', remoteBreakdownLogs, false);
    notifyStoreUpdate();

    // Push any local-only records that aren't in Supabase yet
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

/**
 * Call this whenever the Supabase auth session changes (login, token refresh,
 * logout).  It updates the Realtime WebSocket JWT so postgres_changes events
 * continue to arrive after the access token rotates, and re-subscribes the
 * channel if it was previously disconnected.
 *
 * @param {string|null} accessToken  The new JWT, or null on logout.
 */
export function notifyRealtimeAuthChange(accessToken) {
  if (!supabase || !isSupabaseConfigured) return;
  if (accessToken) {
    // Update the JWT on the live WebSocket connection
    supabase.realtime.setAuth(accessToken);
    rtLog('info', 'Realtime JWT updated after auth change');
    // Re-subscribe if the channel was torn down while we had no session
    if (!cloudSubscriptions) startRealtimeSubscriptions();
  } else {
    // Logged out — tear down the authenticated channel gracefully
    rtLog('info', 'Auth cleared — tearing down Realtime channel');
    teardownRealtimeSubscriptions();
  }
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

// ── AMC exports ───────────────────────────────────────────────────────────
export const getAmcRecords = () => state.amc;
export const getAmcForMachine = (machineId) => state.amc.filter((r) => r.machineId === machineId);

export function addAmcRecord(fields, userName) {
  const record = normalizeAmcRecord({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, amc: [record, ...state.amc] };
  commitAndQueue('amc', 'upsert', record);
  logActivity(userName, 'added AMC record', `${record.vendorName} → ${getMachine(record.machineId)?.name || record.machineId}`, 'amc');
  return record;
}

export function updateAmcRecord(id, patch, userName) {
  const existing = state.amc.find((r) => r.id === id);
  if (!existing) return null;
  const updated = normalizeAmcRecord({ ...existing, ...patch, id, updatedAt: now() });
  state = { ...state, amc: state.amc.map((r) => (r.id === id ? updated : r)) };
  commitAndQueue('amc', 'upsert', updated);
  logActivity(userName, 'updated AMC record', `${updated.vendorName} → ${getMachine(updated.machineId)?.name || updated.machineId}`, 'amc');
  return updated;
}

export function deleteAmcRecord(id, userName) {
  const record = state.amc.find((r) => r.id === id);
  state = { ...state, amc: state.amc.filter((r) => r.id !== id) };
  commitAndQueue('amc', 'delete', id);
  logActivity(userName, 'deleted AMC record', record ? `${record.vendorName}` : '', 'amc');
}

// ── Per-machine PM record exports ──────────────────────────────────────────
export const getMachinePmRecords = () => state.machinePmRecords;
export const getMachinePmRecordsForMachine = (machineId) =>
  state.machinePmRecords.filter((r) => r.machineId === machineId);

export function addMachinePmRecord(fields, userName) {
  const record = normalizeMachinePmRecord({ ...fields, createdAt: now(), updatedAt: now() });
  state = { ...state, machinePmRecords: [record, ...state.machinePmRecords] };
  commitAndQueue('machinePmRecords', 'upsert', record);
  logActivity(userName, 'logged machine PM', `${record.machineName} · ${record.pmDate} · ${record.task || record.pmType}`, 'pm');
  return record;
}

export function deleteMachinePmRecord(id, userName) {
  state = { ...state, machinePmRecords: state.machinePmRecords.filter((r) => r.id !== id) };
  commitAndQueue('machinePmRecords', 'delete', id);
  logActivity(userName, 'deleted machine PM record', '', 'pm');
}

export function importMachinePmRecordsBulk(rows, userName) {
  const logs = [];
  const unmatchedRows = [];
  const autoMapped = [];

  rows.forEach((row, idx) => {
    // ── Smart Data Enrichment (Feature 2) ──────────────────────────────────
    let matched = findMachineByIdentity(row.machineCode, row.machineName, row.plantSection);

    // Fuzzy name match if no exact match
    if (!matched && row.machineName) {
      const nameLower = row.machineName.toLowerCase().trim();
      matched = state.machines.find((m) => {
        const mName = (m.name || '').toLowerCase().trim();
        return mName && (mName.includes(nameLower) || nameLower.includes(mName));
      }) || null;
    }

    const autoFilled = {};
    const record = normalizeMachinePmRecord({
      ...row,
      machineId: matched ? matched.id : (row.machineId || ''),
      machineCode: matched ? (matched.machineCode || matched.id) : (row.machineCode || ''),
      machineName: matched ? matched.name : (row.machineName || ''),
      plantSection: matched ? (matched.section || row.plantSection || '') : (row.plantSection || ''),
      pmDate: row.pmDate || row.pm_date || row.date || new Date().toISOString().slice(0, 10),
      pmType: row.pmType || row.pm_type || 'Preventive',
      task: row.task || row.description || '',
      status: row.status || 'completed',
      completed: row.completed !== false && row.completed !== 'false' && row.status !== 'pending',
      action: row.action || row.actionTaken || '',
      technician: row.technician || '',
      remarks: row.remarks || '',
      startTime: row.startTime || row.start_time || '',
      endTime: row.endTime || row.end_time || '',
    });

    if (matched) {
      if (!row.machineCode && matched.machineCode) autoFilled.machineCode = matched.machineCode;
      if (!row.machineName && matched.name) autoFilled.machineName = matched.name;
      if (!row.plantSection && matched.section) autoFilled.plantSection = matched.section;
      if (Object.keys(autoFilled).length > 0) {
        autoMapped.push({ row: idx + 2, machine: matched.name || matched.machineCode, fields: autoFilled });
      }
    }

    if (!record.machineId) {
      unmatchedRows.push(row.machineName || row.machineCode || `Row ${idx + 2}`);
      return;
    }
    logs.push(record);
    if (!matched) unmatchedRows.push(row.machineName || row.machineCode);
  });

  // Dedup on machineId + pmDate + task within Excel
  const seenInFile = new Map();
  logs.forEach((r) => {
    const key = `${r.machineId}:${r.pmDate}:${r.task}`;
    seenInFile.set(key, r);
  });
  const deduped = [...seenInFile.values()];

  state = { ...state, machinePmRecords: [...deduped, ...state.machinePmRecords] };
  commit('machinePmRecords');
  deduped.forEach((r) => queueCloudMutation('machinePmRecords', 'upsert', r, { schedule: false }));
  scheduleCloudFlush();

  const detail = unmatchedRows.length
    ? `${deduped.length} imported · ${unmatchedRows.length} unmatched: ${unmatchedRows.slice(0, 3).join(', ')}`
    : `${deduped.length} PM records imported`;
  logActivity(userName, 'bulk imported machine PM records', detail, 'pm');
  return { created: deduped.length, total: rows.length, unmatched: unmatchedRows, autoMapped };
}

// ── Dynamic Plant Sections ──────────────────────────────────────────────────
// User-added sections are persisted in localStorage and merged with the
// hardcoded PLANT_SECTIONS constant from constants.js at runtime.
export const getPlantSections = () => state.plantSections;

export function addPlantSection(name, userName) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const exists = state.plantSections.some(
    (s) => s.toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) return false;
  state = { ...state, plantSections: [...state.plantSections, trimmed] };
  commit('plantSections');
  logActivity(userName, 'added plant section', trimmed, 'info');
  return true;
}

export function removePlantSection(name, userName) {
  state = { ...state, plantSections: state.plantSections.filter((s) => s !== name) };
  commit('plantSections');
  logActivity(userName, 'removed plant section', name, 'info');
}

// ── Per-machine breakdown log exports ─────────────────────────────────────
export const getMachineBreakdownLogs = () => state.machineBreakdownLogs;
export const getMachineBreakdownLogsForMachine = (machineId) =>
  state.machineBreakdownLogs.filter((r) => r.machineId === machineId);

export function addMachineBreakdownLog(fields, userName) {
  const log = normalizeMachineBreakdownLog({ ...fields, createdAt: now() });
  state = { ...state, machineBreakdownLogs: [log, ...state.machineBreakdownLogs] };
  commitAndQueue('machineBreakdownLogs', 'upsert', log);
  logActivity(userName, 'logged machine breakdown', `${log.machineName} · ${log.downtimeHours}h · ${log.failureCause}`, 'breakdown');

  // ── Auto-sync into section-level breakdown summary ──────────────────────
  // Aggregate all per-machine logs for this machine's section + period so
  // that Dashboard, Machine Register, and Machine Profile all show identical
  // MTTR / MTBF / downtime figures derived from the same source of truth.
  if (log.plantSection && log.date) {
    const period = log.date.slice(0, 7); // YYYY-MM
    const section = log.plantSection;

    const sectionLogs = state.machineBreakdownLogs.filter(
      (l) => l.plantSection === section && l.date.slice(0, 7) === period
    );

    const totalBreakdowns = sectionLogs.length;
    const totalDowntime   = sectionLogs.reduce((sum, l) => sum + (l.downtimeHours || 0), 0);

    const existingSummary = state.breakdowns.find(
      (b) => b.section === section && b.period === period
    );

    addBreakdown({
      ...(existingSummary || {}),
      period,
      section,
      breakdownCount: totalBreakdowns,
      downtimeHours: Math.round(totalDowntime * 100) / 100,
      // Preserve operating hours and manual overrides from the existing summary
      operatingHours: existingSummary?.operatingHours,
      availability_override: existingSummary?.availability_override ?? null,
      id: existingSummary?.id,
    }, userName || 'System');
  }

  return log;
}

export function updateMachineBreakdownLog(id, patch, userName) {
  const existing = state.machineBreakdownLogs.find((r) => r.id === id);
  if (!existing) return null;
  const updated = normalizeMachineBreakdownLog({ ...existing, ...patch, id });
  state = { ...state, machineBreakdownLogs: state.machineBreakdownLogs.map((r) => (r.id === id ? updated : r)) };
  commitAndQueue('machineBreakdownLogs', 'upsert', updated);
  logActivity(userName, 'updated machine breakdown log', `${updated.machineName}`, 'breakdown');
  return updated;
}

export function deleteMachineBreakdownLog(id, userName) {
  const log = state.machineBreakdownLogs.find((r) => r.id === id);
  state = { ...state, machineBreakdownLogs: state.machineBreakdownLogs.filter((r) => r.id !== id) };
  commitAndQueue('machineBreakdownLogs', 'delete', id);
  logActivity(userName, 'deleted machine breakdown log', '', 'breakdown');

  // Recalculate the section-level summary for the affected period after deletion
  if (log?.plantSection && log?.date) {
    const period = log.date.slice(0, 7);
    const section = log.plantSection;
    const sectionLogs = state.machineBreakdownLogs.filter(
      (l) => l.plantSection === section && l.date.slice(0, 7) === period
    );
    const existingSummary = state.breakdowns.find((b) => b.section === section && b.period === period);
    if (existingSummary) {
      const totalBreakdowns = sectionLogs.length;
      const totalDowntime = sectionLogs.reduce((sum, l) => sum + (l.downtimeHours || 0), 0);
      addBreakdown({
        ...existingSummary,
        breakdownCount: totalBreakdowns,
        downtimeHours: Math.round(totalDowntime * 100) / 100,
      }, userName || 'System');
    }
  }
}

/**
 * Bulk import per-machine breakdown logs from a parsed Excel sheet.
 * Matches each row against the machine store by machineCode or machineName,
 * attaches the machineId, and recalculates the section-level breakdown summary
 * (MTTR/MTBF) for every affected section automatically.
 *
 * Columns supported: Machine Code, Machine Name, Plant Section, Breakdown Start
 * Time, Breakdown End Time, Downtime Hours (auto-calculated when blank),
 * Failure Cause, Action Taken, Status, Remarks.
 */
export function importMachineBreakdownLogsBulk(rows, userName) {
  const logs = [];
  const unmatchedRows = [];
  const autoMapped = [];

  rows.forEach((row, idx) => {
    // ── Smart Data Enrichment (Feature 2) ──────────────────────────────────
    // Try to match by code first, then by name, then by fuzzy name match
    let matched = findMachineByIdentity(row.machineCode, row.machineName, row.plantSection);

    // If no exact match by name, try case-insensitive substring match
    if (!matched && row.machineName) {
      const nameLower = row.machineName.toLowerCase().trim();
      matched = state.machines.find((m) => {
        const mName = (m.name || '').toLowerCase().trim();
        return mName && (mName.includes(nameLower) || nameLower.includes(mName));
      }) || null;
    }

    const autoFilled = {};
    const log = normalizeMachineBreakdownLog({
      ...row,
      machineId: matched ? matched.id : '',
      machineCode: matched ? (matched.machineCode || matched.id) : (row.machineCode || ''),
      machineName: matched ? matched.name : row.machineName,
      plantSection: matched ? (matched.section || row.plantSection || '') : (row.plantSection || ''),
      startTime: row.startTime || '',
      endTime:   row.endTime   || '',
    });

    if (matched) {
      if (!row.machineCode && matched.machineCode) autoFilled.machineCode = matched.machineCode;
      if (!row.machineName && matched.name) autoFilled.machineName = matched.name;
      if (!row.plantSection && matched.section) autoFilled.plantSection = matched.section;
      if (Object.keys(autoFilled).length > 0) {
        autoMapped.push({ row: idx + 2, machine: matched.name || matched.machineCode, fields: autoFilled });
      }
    }

    if (!log.date) return;
    if (!log.machineId) {
      unmatchedRows.push(row.machineName || row.machineCode || `Row ${idx + 2}`);
      return;
    }
    logs.push(log);
    if (!matched) unmatchedRows.push(row.machineName || row.machineCode);
  });

  // Dedup on machineId + startTime or machineId + date + cause
  const existingKeys = new Set(
    state.machineBreakdownLogs.map((r) =>
      r.startTime
        ? `${r.machineId}:st:${r.startTime}`
        : `${r.machineId}:${r.date}:${r.failureCause}`
    )
  );

  const newLogs = logs.filter((l) => {
    const key = l.startTime
      ? `${l.machineId}:st:${l.startTime}`
      : `${l.machineId}:${l.date}:${l.failureCause}`;
    return !existingKeys.has(key);
  });

  state = { ...state, machineBreakdownLogs: [...newLogs, ...state.machineBreakdownLogs] };
  commit('machineBreakdownLogs');
  newLogs.forEach((l) => queueCloudMutation('machineBreakdownLogs', 'upsert', l, { schedule: false }));
  scheduleCloudFlush();

  // Recalculate section-level breakdown summaries for affected sections
  const affectedSections = [...new Set(newLogs.map((l) => l.plantSection).filter(Boolean))];
  affectedSections.forEach((section) => {
    const sectionLogs = state.machineBreakdownLogs.filter((l) => l.plantSection === section);
    const byPeriod = {};
    sectionLogs.forEach((l) => {
      const period = (l.startTime || l.date || '').slice(0, 7);
      if (!period) return;
      if (!byPeriod[period]) byPeriod[period] = { period, section, breakdownCount: 0, downtimeHours: 0 };
      byPeriod[period].breakdownCount += 1;
      byPeriod[period].downtimeHours = Math.round((byPeriod[period].downtimeHours + (l.downtimeHours || 0)) * 100) / 100;
    });
    Object.values(byPeriod).forEach((aggRow) => {
      const existingSummary = state.breakdowns.find((b) => b.section === aggRow.section && b.period === aggRow.period);
      addBreakdown({
        ...(existingSummary || {}),
        ...aggRow,
        id: existingSummary?.id,
        operatingHours: existingSummary?.operatingHours,
        availability_override: existingSummary?.availability_override ?? null,
      }, userName);
    });
  });

  const detail = unmatchedRows.length
    ? `${newLogs.length} imported · ${unmatchedRows.length} unmatched machines`
    : `${newLogs.length} breakdown logs imported`;

  logActivity(userName, 'bulk imported machine breakdown logs', detail, 'breakdown');
  return { created: newLogs.length, total: rows.length, unmatched: unmatchedRows, autoMapped };
}

export function exportBackup() {
  return JSON.stringify(
    {
      exportedAt: now(),
      machines: state.machines,
      breakdowns: state.breakdowns,
      pms: state.pms,
      energy: state.energy,
      machinePmRecords: state.machinePmRecords,
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

  if (Array.isArray(parsed.amc)) {
    parsed.amc.forEach((r) => addAmcRecord(r, 'Backup Restore'));
  }
  if (Array.isArray(parsed.machineBreakdownLogs)) {
    state = { ...state, machineBreakdownLogs: parsed.machineBreakdownLogs.map(normalizeMachineBreakdownLog) };
    commit('machineBreakdownLogs');
  }
  if (Array.isArray(parsed.machinePmRecords)) {
    state = { ...state, machinePmRecords: parsed.machinePmRecords.map(normalizeMachinePmRecord) };
    commit('machinePmRecords');
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
    uhbvnlUnit1Kwh: row.uhbvnlUnit1Kwh,
    uhbvnlUnit2Kwh: row.uhbvnlUnit2Kwh,
    totalGridKwh: row.totalGridKwh,
    dg500RunHours: row.dg500RunHours,
    dg380RunHours: row.dg380RunHours,
    fuelConsumedLitres: row.fuelConsumedLitres,
    solarGenerationKwh: row.solarGenerationKwh,
    dgKwh: row.dgKwh,
    totalKwh: row.totalKwh,
    plantSec: row.plantSec,
    sectionConsumption: row.sectionConsumption || {},
    kwh: row.kwh,
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
