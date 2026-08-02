import * as XLSX from 'xlsx';

const CLEAN_RX = /[^a-z0-9]+/g;
const toKey = (value) => String(value || '').trim().toLowerCase().replace(CLEAN_RX, '');

const MODULE_ORDER = ['pm', 'breakdowns', 'energy', 'machines'];
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
        MTTR: 3.31,
        MTBF: 4406.69,
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
        Date: new Date().toISOString().slice(0, 10),
        'Plant Section': 'Utility Section',
        'DG 500kVA Run Hrs': 4.5,
        'DG 380kVA Run Hrs': 2,
        'Fuel Consumed (Ltrs)': 180,
        'Solar Generation (kWh)': 620,
        'Plant SEC (kWh/MT)': 7.8,
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
    dg500RunHours: ['dg500kvarunhrs', 'dg500runhrs', 'dg500hours', 'dg500kvahours'],
    dg380RunHours: ['dg380kvarunhrs', 'dg380runhrs', 'dg380hours', 'dg380kvahours'],
    fuelConsumedLitres: ['fuelconsumedltrs', 'fuelconsumedlitres', 'fuelconsumed', 'fuel'],
    solarGenerationKwh: ['solargenerationkwh', 'solarkwh', 'solargeneration'],
    plantSec: ['plantseckwhmt', 'plantsec', 'sec'],
  },
  machines: {
    machineId: ['machineid', 'machinecode', 'equipmentid', 'equipmentcode', 'assetid'],
    machineName: ['machinename', 'machine', 'equipment', 'equipmentname', 'assetname'],
    plantSection: ['plantsection', 'section', 'department'],
    status: ['status', 'machinestatus', 'equipmentstatus'],
    location: ['location', 'area', 'site'],
    criticality: ['criticality', 'priority', 'assetcriticality'],
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
    return {
      period,
      section,
      plannedCount: parseNumber(getCell(row, mapping, 'plannedCount')),
      doneCount: parseNumber(getCell(row, mapping, 'doneCount')),
      pendingCount: parseNumber(getCell(row, mapping, 'pendingCount')),
      compliancePct: parseNumber(getCell(row, mapping, 'compliancePct')),
    };
  }

  if (moduleId === 'breakdowns') {
    const period = parsePeriodValue(getCell(row, mapping, 'period'), getCell(row, mapping, 'month'), getCell(row, mapping, 'year'));
    const section = String(getCell(row, mapping, 'section') || '').trim();
    if (!section || !period || !mapping.breakdownCount) {
      return { error: `Row ${index}: reporting period, plant section, and breakdown count are required.` };
    }
    return {
      period,
      section,
      breakdownCount: parseNumber(getCell(row, mapping, 'breakdownCount')),
      downtimeHours: parseNumber(getCell(row, mapping, 'downtimeHours')),
      operatingHours: parseNumber(getCell(row, mapping, 'operatingHours')),
      mttr: parseNumber(getCell(row, mapping, 'mttr')),
      mtbf: parseNumber(getCell(row, mapping, 'mtbf')),
    };
  }

  if (moduleId === 'energy') {
    const date = parseDateValue(getCell(row, mapping, 'date'));
    if (!date) return { error: `Row ${index}: date is required.` };
    return {
      date,
      plantSection: String(getCell(row, mapping, 'plantSection') || '').trim(),
      dg500RunHours: parseNumber(getCell(row, mapping, 'dg500RunHours')),
      dg380RunHours: parseNumber(getCell(row, mapping, 'dg380RunHours')),
      fuelConsumedLitres: parseNumber(getCell(row, mapping, 'fuelConsumedLitres')),
      solarGenerationKwh: parseNumber(getCell(row, mapping, 'solarGenerationKwh')),
      plantSec: parseNumber(getCell(row, mapping, 'plantSec')),
    };
  }

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
