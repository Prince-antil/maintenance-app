import * as XLSX from 'xlsx';

const CLEAN_RX = /[^a-z0-9]+/g;
const toKey = (value) => String(value || '').trim().toLowerCase().replace(CLEAN_RX, '');

const MODULE_ORDER = ['pm', 'breakdowns', 'machineBreakdownLogs', 'energy', 'machines', 'machinePmRecords'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const IMPORT_MODULES = {
  pm: {
    id: 'pm',
    label: 'Preventive Maintenance',
    shortLabel: 'PM',
    templateFilename: 'PM_Monthly_Summary_Template.xlsx',
    defaultCategory: 'Monthly PM Report',
    required: ['section', 'period', 'plannedCount'],
    sampleRows: [
      {
        'Reporting Period': new Date().toISOString().slice(0, 7),
        'Plant Section': 'Herbi EC Packaging',
        'Planned PM Count': 24,
        'Done PM Count': 21,
        'Pending PM Count': 3,
        'Compliance %': 87.5,
      },
    ],
  },
  breakdowns: {
    id: 'breakdowns',
    label: 'Breakdowns',
    shortLabel: 'Breakdowns',
    templateFilename: 'Breakdown_Monthly_Summary_Template.xlsx',
    defaultCategory: 'Plantwise Breakdown Report',
    required: ['section', 'period', 'breakdownCount'],
    sampleRows: [
      {
        'Reporting Period': new Date().toISOString().slice(0, 7),
        'Plant Section': 'EC INSEC Packaging',
        'Breakdown Count': 8,
        'Downtime Hours': 26.5,
        'Operating Hours': 35280,
        'MTTR': '',
        'MTBF': '',
        'Remarks': '(MTTR/MTBF auto-calculated if blank)',
      },
    ],
  },
  energy: {
    id: 'energy',
    label: 'Energy Logs',
    shortLabel: 'Energy',
    templateFilename: 'Energy_Log_Template.xlsx',
    defaultCategory: 'Plantwise Energy Consumption',
    required: ['date'],
    sampleRows: [
      {
        'Date': new Date().toISOString().slice(0, 10),
        'Plant Section': 'Utility Section',
        'UHBVNL Unit 1 KWh (Col H)': 4200,
        'UHBVNL Unit 2 KWh (Col U)': 1850,
        'DG 500kVA Run Hrs': 4.5,
        'DG 380kVA Run Hrs': 2,
        'Fuel Consumed (Ltrs)': 180,
        'Solar Generation (kWh)': 620,
        'DG KWh': 0,
        'Total KWh': '',
        'Production MT': 120,
        'Plant SEC (kWh/MT)': '',
        'Glyphosate (kWh)': 310,
        'ACM (kWh)': 820,
        'Jet-mill (kWh)': 540,
        'Cartap (kWh)': 270,
        'Compressors (kWh)': 95,
        'Water/STP (kWh)': 65,
      },
    ],
  },
  machines: {
    id: 'machines',
    label: 'Machines / Equipment',
    shortLabel: 'Machines',
    templateFilename: 'Machines_Import_Template.xlsx',
    defaultCategory: 'Machine Asset Register',
    required: ['machineName'],
    sampleRows: [
      {
        'Machine ID': 'MC-151',
        'Machine Name': 'Example Equipment',
        'Plant Section': 'Utility Section',
        Status: 'Running',
        Location: 'Block B - Ground Floor',
        Criticality: 'A - Critical',
      },
    ],
  },
  machineBreakdownLogs: {
    id: 'machineBreakdownLogs',
    label: 'Machine Breakdown Logs (Per-Machine)',
    shortLabel: 'BD Logs',
    templateFilename: 'Machine_Breakdown_Log_Template.xlsx',
    defaultCategory: 'Plantwise Breakdown Report',
    required: ['machineName'],
    sampleRows: [
      {
        'Machine Code': 'MC-101',
        'Machine Name': 'Filling Machine #1',
        'Plant Section': 'Herbi EC Packaging',
        'Breakdown Start Time': `${new Date().toISOString().slice(0, 10)}T08:00`,
        'Breakdown End Time': `${new Date().toISOString().slice(0, 10)}T12:30`,
        'Downtime Hours': '',
        'Failure Cause': 'Bearing failure in main shaft',
        'Action Taken': 'Bearing replaced, shaft aligned',
        'Status': 'Closed',
        'Remarks': '(Downtime auto-calculated from Start/End if blank)',
      },
    ],
  },
  machinePmRecords: {
    id: 'machinePmRecords',
    label: 'Machine-wise PM Records (Per-Machine)',
    shortLabel: 'PM Records',
    templateFilename: 'Machine_PM_Records_Template.xlsx',
    defaultCategory: 'Monthly PM Report',
    required: ['machineName'],
    sampleRows: [
      {
        'Machine Code': 'MC-101',
        'Machine Name': 'Filling Machine #1',
        'Plant Section': 'Herbi EC Packaging',
        'PM Date': new Date().toISOString().slice(0, 10),
        'PM Type': 'Preventive',
        'Task': 'Lubrication and filter replacement',
        'Status': 'Completed',
        'Action Taken': 'Grease applied, filter replaced',
        'Technician': 'Ravi Kumar',
        'Remarks': '',
      },
    ],
  },
};

const FIELD_ALIASES = {
  pm: {
    period: ['reportingperiod', 'period', 'monthyear', 'reportmonth', 'month'],
    month: ['reportingmonth', 'monthname'],
    year: ['reportingyear', 'year'],
    section: ['plantsection', 'section', 'department', 'plantarea'],
    plannedCount: ['plannedpmcount', 'plannedcount', 'pmplanned', 'actualplannedpmcount'],
    doneCount: ['donepmcount', 'donecount', 'completedpmcount', 'actualdonepmcount'],
    pendingCount: ['pendingpmcount', 'overduependingpmcount', 'overduecount', 'pendingcount'],
    compliancePct: ['compliance', 'compliancepct', 'compliancepercent', 'percentagedone', 'donepercent'],
  },
  breakdowns: {
    period: ['reportingperiod', 'period', 'monthyear', 'reportmonth', 'month'],
    month: ['reportingmonth', 'monthname'],
    year: ['reportingyear', 'year'],
    section: ['plantsection', 'section', 'department'],
    breakdownCount: ['breakdowncount', 'totalbreakdowns', 'numberofbreakdowns'],
    downtimeHours: ['downtimehours', 'breakdownhours', 'totalbreakdownhours', 'downtime'],
    operatingHours: ['operatinghours', 'plannedoperatinghours'],
    mttr: ['mttr', 'meantimetorepair'],
    mtbf: ['mtbf', 'meantimebetweenfailures'],
  },
  energy: {
    date: ['date', 'logdate', 'readingdate'],
    plantSection: ['plantsection', 'section', 'department'],
    // Dual UHBVNL grid feeders
    uhbvnlUnit1Kwh: ['uhbvnlunit1kwh', 'unit1kwh', 'kwhi', 'kwh_i', 'columnh', 'gridunit1', 'uhbvnl1', 'unit1import', 'u1kwh'],
    uhbvnlUnit2Kwh: ['uhbvnlunit2kwh', 'unit2kwh', 'kwhi10', 'kwh_i10', 'columnu', 'gridunit2', 'uhbvnl2', 'unit2import', 'u2kwh'],
    totalGridKwh:   ['totalgridkwh', 'gridkwh', 'totalgrid', 'gridtotal', 'totalimport'],
    // DG generators
    dg500RunHours: ['dg500kvarunhrs', 'dg500runhrs', 'dg500hours', 'dg500kvahours', 'dg500runhours'],
    dg380RunHours: ['dg380kvarunhrs', 'dg380runhrs', 'dg380hours', 'dg380kvahours', 'dg380runhours'],
    fuelConsumedLitres: ['fuelconsumedltrs', 'fuelconsumedlitres', 'fuelconsumed', 'fuel', 'fuellitres', 'fuelltrs'],
    // Solar — individual inverters and aggregates
    solarGenerationKwh: ['solargenerationkwh', 'solarkwh', 'solargeneration', 'totalsolar',
                         'unit1inv1', 'unit1inv2', 'unit1inv3', 'unit1inv4',
                         'unit2inv1', 'unit2inv2', 'unit2inv3'],
    dgKwh:       ['dgkwh', 'dgeneration', 'dgtotalkwh', 'dgkwhtotal'],
    totalKwh:    ['totalkwh', 'totalconsumption', 'totalenergy', 'planttotalkwh'],
    plantSec:    ['plantseckwhmt', 'plantsec', 'sec', 'specifickwh', 'seckwhmt'],
    productionMT: ['productionmt', 'production', 'outputmt', 'mton'],
    // Section sub-meters (Plantwise Monitoring Report)
    secGlyphosate:   ['glyphosate', 'glyphosatecons', 'glyphosatekwh', 'glyphosateunitcons'],
    secAcm:          ['acm', 'acmcons', 'acmkwh', 'acmunitcons'],
    secJetmill:      ['jetmill', 'jetmillcons', 'jetmillkwh', 'jetmillunitcons'],
    secCartap:       ['cartap', 'cartapcons', 'cartapkwh', 'cartapunitcons'],
    secCompressors:  ['compressors', 'compressorcons', 'compressorkwh', 'compressorunitcons'],
    secWaterStp:     ['waterstp', 'water', 'stp', 'watercons', 'stpkwh', 'waterunitcons'],
  },
  machines: {
    machineId: ['machineid', 'machinecode', 'equipmentid', 'equipmentcode', 'assetid'],
    machineName: ['machinename', 'machine', 'equipment', 'equipmentname', 'assetname'],
    plantSection: ['plantsection', 'section', 'department'],
    status: ['status', 'machinestatus', 'equipmentstatus'],
    location: ['location', 'area', 'site'],
    criticality: ['criticality', 'priority', 'assetcriticality'],
  },
  machineBreakdownLogs: {
    date:          ['date', 'breakdowndate', 'incidentdate', 'logdate'],
    startTime:     ['starttime', 'breakdownstarttime', 'startdatetime', 'start', 'startedat', 'breakdown start time', 'start time'],
    endTime:       ['endtime', 'breakdownendtime', 'enddatetime', 'end', 'endedat', 'resumetime', 'breakdown end time', 'end time'],
    machineCode:   ['machinecode', 'machineid', 'equipmentid', 'assetid', 'equipmentcode'],
    machineName:   ['machinename', 'machine', 'equipment', 'equipmentname', 'assetname'],
    plantSection:  ['plantsection', 'section', 'department'],
    downtimeHours: ['downtimehours', 'downtime', 'breakdownhours', 'durationhours', 'duration'],
    failureCause:  ['failurecause', 'cause', 'failurereason', 'problem', 'fault', 'description'],
    actionTaken:   ['actiontaken', 'action', 'repair', 'correctiveaction', 'resolution', 'remedy'],
    status:        ['status', 'breakdownstatus', 'closurestatus'],
    remarks:       ['remarks', 'notes', 'comment', 'comments'],
  },
  machinePmRecords: {
    machineCode:   ['machinecode', 'machineid', 'equipmentid', 'assetid', 'equipmentcode'],
    machineName:   ['machinename', 'machine', 'equipment', 'equipmentname', 'assetname'],
    plantSection:  ['plantsection', 'section', 'department'],
    pmDate:        ['pmdate', 'date', 'completiondate', 'donedate', 'pm date'],
    pmType:        ['pmtype', 'type', 'maintenance type', 'pm type'],
    task:          ['task', 'description', 'work', 'job', 'activity', 'jobdescription'],
    status:        ['status', 'pmstatus', 'completionstatus'],
    completed:     ['completed', 'iscompleted', 'done'],
    actionTaken:   ['actiontaken', 'action', 'correctiveaction', 'resolution'],
    technician:    ['technician', 'assignedto', 'doneby', 'engineer'],
    remarks:       ['remarks', 'notes', 'comment', 'comments'],
  },
};

const PREVIEW_LIMIT = 8;

const isEmptyValue = (value) => value == null || String(value).trim() === '';
const isRowEmpty = (row) => Object.values(row).every(isEmptyValue);

function readWorkbook(file) {
  return file.arrayBuffer().then((buffer) => XLSX.read(buffer, { type: 'array', cellDates: false }));
}

function sheetRows(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return { sheetName, rows };
}

function detectModule(headers) {
  const scores = MODULE_ORDER.map((moduleId) => {
    const aliases = FIELD_ALIASES[moduleId];
    let score = 0;
    Object.values(aliases).forEach((synonyms) => {
      if (headers.some((header) => synonyms.includes(toKey(header)))) score += 1;
    });
    return { moduleId, score };
  }).sort((a, b) => b.score - a.score);
  return scores[0]?.score ? scores[0].moduleId : null;
}

function buildMapping(moduleId, headers) {
  const aliases = FIELD_ALIASES[moduleId];
  return Object.fromEntries(
    Object.entries(aliases).map(([field, synonyms]) => [
      field,
      headers.find((header) => synonyms.includes(toKey(header))) || null,
    ])
  );
}

function parseNumber(value) {
  if (isEmptyValue(value)) return 0;
  const clean = String(value).replace(/,/g, '').trim();
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(value) {
  if (isEmptyValue(value)) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S)).toISOString();
  }
  const direct = new Date(String(value).trim());
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return '';
}

export function normalizeMachineStatus(value) {
  const key = toKey(value);
  if (['running', 'run'].includes(key)) return 'running';
  if (['undermaintenance', 'maintenance', 'maint', 'service'].includes(key)) return 'maintenance';
  if (['breakdown', 'down', 'failed', 'failure'].includes(key)) return 'breakdown';
  if (['standby', 'idle'].includes(key)) return 'standby';
  return 'running';
}

function getCell(row, mapping, field) {
  const header = mapping[field];
  return header ? row[header] : '';
}

function parsePeriodValue(periodValue, monthValue, yearValue) {
  const rawPeriod = String(periodValue || '').trim();
  if (/^\d{4}-\d{2}$/.test(rawPeriod)) return rawPeriod;

  const monthName = String(monthValue || '').trim();
  const year = Number(yearValue);
  if (monthName && year) {
    const monthIndex = MONTHS.findIndex((item) => toKey(item) === toKey(monthName));
    if (monthIndex >= 0) return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  }

  const parsedDate = parseDateValue(rawPeriod);
  if (parsedDate) return parsedDate.slice(0, 7);
  return '';
}

function parseModuleRow(moduleId, row, mapping, index) {
  if (moduleId === 'pm') {
    const period = parsePeriodValue(getCell(row, mapping, 'period'), getCell(row, mapping, 'month'), getCell(row, mapping, 'year'));
    const section = String(getCell(row, mapping, 'section') || '').trim();
    if (!section || !period || !mapping.plannedCount) {
      return { error: `Row ${index}: reporting period, plant section, and planned PM count are required.` };
    }
    const plannedCount = parseNumber(getCell(row, mapping, 'plannedCount'));
    const doneCount    = parseNumber(getCell(row, mapping, 'doneCount'));
    const pendingCount = parseNumber(getCell(row, mapping, 'pendingCount'));
    // Auto-calculate compliance if not supplied or zero
    const rawCompliance = parseNumber(getCell(row, mapping, 'compliancePct'));
    const compliancePct = rawCompliance || (plannedCount > 0 ? Math.round((doneCount / plannedCount) * 1000) / 10 : 0);
    return {
      period,
      section,
      plannedCount,
      doneCount,
      pendingCount,
      compliancePct,
    };
  }

  if (moduleId === 'breakdowns') {
    const period = parsePeriodValue(getCell(row, mapping, 'period'), getCell(row, mapping, 'month'), getCell(row, mapping, 'year'));
    const section = String(getCell(row, mapping, 'section') || '').trim();
    if (!section || !period || !mapping.breakdownCount) {
      return { error: `Row ${index}: reporting period, plant section, and breakdown count are required.` };
    }
    const breakdownCount = parseNumber(getCell(row, mapping, 'breakdownCount'));
    const downtimeHours = parseNumber(getCell(row, mapping, 'downtimeHours'));
    const operatingHours = parseNumber(getCell(row, mapping, 'operatingHours'));
    // Auto-calculate MTTR and MTBF if not provided or zero in the sheet
    const rawMttr = parseNumber(getCell(row, mapping, 'mttr'));
    const rawMtbf = parseNumber(getCell(row, mapping, 'mtbf'));
    const mttr = rawMttr || (breakdownCount > 0 ? Math.round((downtimeHours / breakdownCount) * 100) / 100 : 0);
    const mtbf = rawMtbf || (breakdownCount > 0 ? Math.round((Math.max(0, operatingHours - downtimeHours) / breakdownCount) * 100) / 100 : 0);
    return {
      period,
      section,
      breakdownCount,
      downtimeHours,
      operatingHours,
      mttr,
      mtbf,
    };
  }

  if (moduleId === 'energy') {
    const date = parseDateValue(getCell(row, mapping, 'date'));
    if (!date) return { error: `Row ${index}: date is required.` };

    // ── Dual-unit UHBVNL grid ──────────────────────────────────────────────
    const uhbvnlUnit1Kwh = parseNumber(getCell(row, mapping, 'uhbvnlUnit1Kwh'));
    const uhbvnlUnit2Kwh = parseNumber(getCell(row, mapping, 'uhbvnlUnit2Kwh'));
    const rawTotalGrid   = parseNumber(getCell(row, mapping, 'totalGridKwh'));
    const totalGridKwh   = rawTotalGrid || (uhbvnlUnit1Kwh + uhbvnlUnit2Kwh);

    // ── DG generators ─────────────────────────────────────────────────────
    const dg500RunHours      = parseNumber(getCell(row, mapping, 'dg500RunHours'));
    const dg380RunHours      = parseNumber(getCell(row, mapping, 'dg380RunHours'));
    const fuelConsumedLitres = parseNumber(getCell(row, mapping, 'fuelConsumedLitres'));

    // ── Solar (aggregate of individual inverters if present) ───────────────
    // solarGenerationKwh column may itself be a pre-aggregated total, or one
    // of the individual inverter columns (Unit1 INV 1-4 / Unit2 INV 1-3).
    // When the sheet has a dedicated "Solar Generation (kWh)" total column we
    // use it; the individual INV columns are handled by the master parser.
    const solarGenerationKwh = parseNumber(getCell(row, mapping, 'solarGenerationKwh'));
    const dgKwh              = parseNumber(getCell(row, mapping, 'dgKwh'));

    // ── Total plant kWh ───────────────────────────────────────────────────
    const rawTotal  = parseNumber(getCell(row, mapping, 'totalKwh'));
    const totalKwh  = rawTotal || (totalGridKwh + solarGenerationKwh + dgKwh) || 0;

    // ── Specific Energy Consumption ────────────────────────────────────────
    const rawPlantSec    = parseNumber(getCell(row, mapping, 'plantSec'));
    const productionMT   = parseNumber(getCell(row, mapping, 'productionMT'));
    const plantSec       = rawPlantSec || (productionMT > 0 ? Math.round((totalKwh / productionMT) * 100) / 100 : 0);

    // ── Section sub-meter consumption ─────────────────────────────────────
    const sectionConsumption = {
      glyphosate:   parseNumber(getCell(row, mapping, 'secGlyphosate')),
      acm:          parseNumber(getCell(row, mapping, 'secAcm')),
      jetmill:      parseNumber(getCell(row, mapping, 'secJetmill')),
      cartap:       parseNumber(getCell(row, mapping, 'secCartap')),
      compressors:  parseNumber(getCell(row, mapping, 'secCompressors')),
      waterStp:     parseNumber(getCell(row, mapping, 'secWaterStp')),
    };

    return {
      date,
      plantSection: String(getCell(row, mapping, 'plantSection') || '').trim(),
      uhbvnlUnit1Kwh,
      uhbvnlUnit2Kwh,
      totalGridKwh,
      dg500RunHours,
      dg380RunHours,
      fuelConsumedLitres,
      solarGenerationKwh,
      dgKwh,
      totalKwh,
      plantSec,
      sectionConsumption,
      // legacy single kwh for analytics backward compat
      kwh: totalKwh || solarGenerationKwh,
    };
  }

  if (moduleId === 'machineBreakdownLogs') {
    // Prefer startTime as the primary date source; fall back to a dedicated date column
    const rawStartTime = parseDateValue(getCell(row, mapping, 'startTime'));
    const rawEndTime   = parseDateValue(getCell(row, mapping, 'endTime'));
    const rawDate      = parseDateValue(getCell(row, mapping, 'date'));

    // Resolve the calendar date
    const date = (rawStartTime || rawDate || '').slice(0, 10);
    if (!date) return { error: `Row ${index}: date or start time is required.` };

    const mName = String(getCell(row, mapping, 'machineName') || '').trim();
    if (!mName) return { error: `Row ${index}: machine name is required.` };

    // Downtime: auto-calculate from start/end when the cell is blank or zero
    let downtimeHours = parseNumber(getCell(row, mapping, 'downtimeHours'));
    if (!downtimeHours && rawStartTime && rawEndTime) {
      const diff = (new Date(rawEndTime) - new Date(rawStartTime)) / 3_600_000;
      if (diff > 0) downtimeHours = Math.round(diff * 100) / 100;
    }

    return {
      date,
      startTime: rawStartTime || '',
      endTime:   rawEndTime   || '',
      machineCode: String(getCell(row, mapping, 'machineCode') || '').trim(),
      machineName: mName,
      plantSection: String(getCell(row, mapping, 'plantSection') || '').trim(),
      downtimeHours,
      failureCause: String(getCell(row, mapping, 'failureCause') || '').trim(),
      actionTaken: String(getCell(row, mapping, 'actionTaken') || '').trim(),
      status: String(getCell(row, mapping, 'status') || 'closed').trim().toLowerCase() || 'closed',
      remarks: String(getCell(row, mapping, 'remarks') || '').trim(),
    };
  }

  if (moduleId === 'machinePmRecords') {
    const mName = String(getCell(row, mapping, 'machineName') || '').trim();
    if (!mName) return { error: `Row ${index}: machine name is required.` };

    const pmDateRaw = parseDateValue(getCell(row, mapping, 'pmDate'));
    const pmDate = pmDateRaw ? pmDateRaw.slice(0, 10) : new Date().toISOString().slice(0, 10);

    return {
      machineCode: String(getCell(row, mapping, 'machineCode') || '').trim(),
      machineName: mName,
      plantSection: String(getCell(row, mapping, 'plantSection') || '').trim(),
      pmDate,
      pmType: String(getCell(row, mapping, 'pmType') || 'Preventive').trim() || 'Preventive',
      task: String(getCell(row, mapping, 'task') || '').trim(),
      status: String(getCell(row, mapping, 'status') || 'completed').trim().toLowerCase() || 'completed',
      completed: String(getCell(row, mapping, 'completed') || '').toLowerCase() !== 'false',
      actionTaken: String(getCell(row, mapping, 'actionTaken') || '').trim(),
      technician: String(getCell(row, mapping, 'technician') || '').trim(),
      remarks: String(getCell(row, mapping, 'remarks') || '').trim(),
    };
  }

  // ── Machines (fallback) ───────────────────────────────────────────────────
  const machineName = String(getCell(row, mapping, 'machineName') || '').trim();
  if (!machineName) return { error: `Row ${index}: machine name is required.` };
  return {
    machineCode: String(getCell(row, mapping, 'machineId') || '').trim(),
    name: machineName,
    section: String(getCell(row, mapping, 'plantSection') || '').trim(),
    status: normalizeMachineStatus(getCell(row, mapping, 'status')),
    area: String(getCell(row, mapping, 'location') || '').trim(),
    criticality: String(getCell(row, mapping, 'criticality') || '').trim(),
  };
}

function previewColumns(mapping) {
  return Object.entries(mapping)
    .filter(([, header]) => header)
    .map(([field, header]) => ({ field, header }));
}

export async function parseImportFile(file, selectedModule = 'auto') {
  const workbook = await readWorkbook(file);
  const { rows } = sheetRows(workbook);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const detectedModule = detectModule(headers);
  const moduleId = selectedModule === 'auto' ? detectedModule : selectedModule;

  if (!moduleId || !IMPORT_MODULES[moduleId]) {
    return {
      moduleId: null,
      headers,
      previewRows: [],
      parsedRows: [],
      errors: ['Unable to detect a supported import template from the uploaded headers.'],
      mapping: {},
      counts: { total: rows.length, valid: 0, invalid: rows.length || 0 },
    };
  }

  const mapping = buildMapping(moduleId, headers);
  const definition = IMPORT_MODULES[moduleId];
  const missingRequired = definition.required.filter((field) => !mapping[field]);
  const errors = missingRequired.map((field) => `Missing required header mapping for "${field}".`);
  const parsedRows = [];

  rows.forEach((row, idx) => {
    if (isRowEmpty(row)) return;
    const parsed = parseModuleRow(moduleId, row, mapping, idx + 2);
    if (parsed.error) errors.push(parsed.error);
    else parsedRows.push(parsed);
  });

  return {
    moduleId,
    headers,
    mapping,
    mappingPreview: previewColumns(mapping),
    previewRows: parsedRows.slice(0, PREVIEW_LIMIT),
    parsedRows,
    errors,
    counts: {
      total: rows.filter((row) => !isRowEmpty(row)).length,
      valid: parsedRows.length,
      invalid: errors.length,
    },
  };
}

export function downloadTemplate(moduleId) {
  const definition = IMPORT_MODULES[moduleId];
  if (!definition) return;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(definition.sampleRows);
  XLSX.utils.book_append_sheet(workbook, sheet, definition.shortLabel);
  XLSX.writeFile(workbook, definition.templateFilename);
}

export function inferUploadMeta(moduleId, parsedRows) {
  const definition = IMPORT_MODULES[moduleId];
  const first = parsedRows?.[0] || {};
  const period = first.period || (first.date ? first.date.slice(0, 7) : new Date().toISOString().slice(0, 7));
  const [year, month] = period.split('-').map(Number);
  return {
    category_name: definition?.defaultCategory || '',
    reporting_month: MONTHS[(month || 1) - 1],
    reporting_year: String(year || new Date().getFullYear()),
    plant_section: first.section || first.plantSection || 'Overall Nathupur Maintenance Formulation Plant (Master Combined View)',
  };
}

// ---------------------------------------------------------------------------
// Master Excel multi-sheet parsing
// ---------------------------------------------------------------------------

/**
 * Canonical sheet name aliases for each module in a master workbook.
 * Matching is case-insensitive and strips non-alphanumeric chars.
 */
const MASTER_SHEET_ALIASES = {
  pm: ['pmdata', 'preventivemaintenance', 'pm', 'pmreport', 'pmsummary', 'preventive'],
  breakdowns: ['breakdowndata', 'breakdowns', 'breakdownreport', 'breakdownsummary', 'breakdown'],
  energy: ['energydata', 'energylogs', 'energy', 'energyreport', 'energylog'],
};

/**
 * Detect which module a sheet name maps to.
 * @param {string} sheetName
 * @returns {'pm'|'breakdowns'|'energy'|null}
 */
function detectSheetModule(sheetName) {
  const key = toKey(sheetName);
  for (const [moduleId, aliases] of Object.entries(MASTER_SHEET_ALIASES)) {
    if (aliases.includes(key)) return moduleId;
  }
  return null;
}

/**
 * Parse a single sheet from a workbook into rows for the given module.
 * Returns { parsedRows, errors, counts }.
 */
function parseSheet(workbook, sheetName, moduleId) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { parsedRows: [], errors: [], counts: { total: 0, valid: 0, invalid: 0 } };

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const nonEmptyRows = rawRows.filter((row) => !isRowEmpty(row));
  if (!nonEmptyRows.length) return { parsedRows: [], errors: [], counts: { total: 0, valid: 0, invalid: 0 } };

  const headers = Object.keys(nonEmptyRows[0]);
  const mapping = buildMapping(moduleId, headers);
  const definition = IMPORT_MODULES[moduleId];
  const missingRequired = definition.required.filter((field) => !mapping[field]);
  const errors = missingRequired.map((field) => `[${sheetName}] Missing required column for "${field}".`);
  const parsedRows = [];

  nonEmptyRows.forEach((row, idx) => {
    const parsed = parseModuleRow(moduleId, row, mapping, idx + 2);
    if (parsed.error) errors.push(`[${sheetName}] ${parsed.error}`);
    else parsedRows.push(parsed);
  });

  return {
    parsedRows,
    errors,
    counts: {
      total: nonEmptyRows.length,
      valid: parsedRows.length,
      invalid: errors.length,
    },
  };
}

/**
 * Parse a master multi-sheet workbook.
 *
 * Accepts a .xlsx file whose sheets are named (case-insensitive):
 *   - PM_Data / Preventive Maintenance / PM
 *   - Breakdown_Data / Breakdowns
 *   - Energy_Data / Energy Logs / Energy
 *
 * Returns a result object per module plus aggregate totals.
 *
 * @param {File} file
 * @returns {Promise<MasterImportResult>}
 *
 * @typedef {{ parsedRows: object[], errors: string[], counts: object }} SheetResult
 * @typedef {{ pm: SheetResult, breakdowns: SheetResult, energy: SheetResult, sheetMap: object, totalValid: number, totalErrors: string[], hasData: boolean }} MasterImportResult
 */
export async function parseMasterImportFile(file) {
  const workbook = await readWorkbook(file);
  const sheetNames = workbook.SheetNames;

  // Map each sheet name to a module
  const sheetMap = {}; // moduleId -> sheetName
  sheetNames.forEach((name) => {
    const moduleId = detectSheetModule(name);
    if (moduleId && !sheetMap[moduleId]) {
      sheetMap[moduleId] = name;
    }
  });

  const results = {};
  const totalErrors = [];
  let totalValid = 0;

  for (const moduleId of ['pm', 'breakdowns', 'energy']) {
    const sheetName = sheetMap[moduleId];
    if (!sheetName) {
      results[moduleId] = {
        parsedRows: [],
        errors: [],
        counts: { total: 0, valid: 0, invalid: 0 },
        sheetName: null,
      };
      continue;
    }
    const result = parseSheet(workbook, sheetName, moduleId);
    results[moduleId] = { ...result, sheetName };
    totalErrors.push(...result.errors);
    totalValid += result.counts.valid;
  }

  return {
    pm: results.pm,
    breakdowns: results.breakdowns,
    energy: results.energy,
    sheetMap,
    sheetNames,
    totalValid,
    totalErrors,
    hasData: totalValid > 0,
  };
}

/**
 * Generate and download a master template workbook with all three sheets pre-populated.
 */
export function downloadMasterTemplate() {
  const workbook = XLSX.utils.book_new();

  const pmSample = [
    {
      'Reporting Period': new Date().toISOString().slice(0, 7),
      'Plant Section': 'Herbi EC Packaging',
      'Planned PM Count': 24,
      'Done PM Count': 21,
      'Pending PM Count': 3,
      'Compliance %': 87.5,
      Remarks: '',
    },
  ];
  const bdSample = [
    {
      'Reporting Period': new Date().toISOString().slice(0, 7),
      'Plant Section': 'EC INSEC Packaging',
      'Breakdown Count': 8,
      'Downtime Hours': 26.5,
      'Operating Hours': 35280,
      'MTTR': '',
      'MTBF': '',
      'Remarks': '(MTTR and MTBF are auto-calculated if left blank)',
    },
  ];
  const energySample = [
    {
      'Date': new Date().toISOString().slice(0, 10),
      'Plant Section': 'Utility Section',
      'UHBVNL Unit 1 KWh (Col H)': 4200,
      'UHBVNL Unit 2 KWh (Col U)': 1850,
      'DG 500kVA Run Hrs': 4.5,
      'DG 380kVA Run Hrs': 2,
      'Fuel Consumed (Ltrs)': 180,
      'Solar Generation (kWh)': 620,
      'DG KWh': 0,
      'Total KWh': '',
      'Production MT': 120,
      'Plant SEC (kWh/MT)': '',
      'Glyphosate (kWh)': 310,
      'ACM (kWh)': 820,
      'Jet-mill (kWh)': 540,
      'Cartap (kWh)': 270,
      'Compressors (kWh)': 95,
      'Water/STP (kWh)': 65,
      'Remarks': '(Total KWh & SEC auto-calculated if blank)',
    },
  ];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pmSample), 'PM_Data');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bdSample), 'Breakdown_Data');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(energySample), 'Energy_Data');
  XLSX.writeFile(workbook, 'Master_Import_Template.xlsx');
}
