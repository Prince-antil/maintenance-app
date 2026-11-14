// =============================================================================
// Inspection, Calibration & Statutory Compliance — pure domain logic.
//
// No React, no Supabase, no browser-only APIs except optional localStorage
// defaults. Everything here is deterministic and unit-testable in Node.
//
// Core rules implemented:
//   • Date-only arithmetic with month-end clamping and leap-year safety.
//   • Certificate expiry: printed/manual date ALWAYS wins over calculation.
//   • Expiry source tracked as certificate | calculated | manual_verified.
//   • Next inspection due date is separate from certificate expiry.
//   • Status is derived from actual dates + inspection outcomes, with a hard
//     priority so an expired/overdue/failed record can never read as valid.
//   • A failed inspection stays FAILED until a NEWER passing inspection exists.
// =============================================================================

export const DUE_SOON_DAYS = 30;
export const DUE_SOON_SECONDARY_DAYS = 60;
export const REPORT_WINDOW_DAYS = 60;

export const DEFAULT_SETTINGS = {
  dueSoonDays: DUE_SOON_DAYS,
  dueSoonSecondaryDays: DUE_SOON_SECONDARY_DAYS,
  reportWindowDays: REPORT_WINDOW_DAYS,
  notifyDays: [30, 15, 7, 0],
  notifyInApp: true,
  notifyEmails: '',
  notifyWhatsApp: '',
  recipients: {},
  asOfDate: '',
};

export const EXPIRY_SOURCES = {
  CERTIFICATE: 'certificate',
  CALCULATED: 'calculated',
  MANUAL_VERIFIED: 'manual_verified',
};

export const EXPIRY_SOURCE_LABELS = {
  certificate: 'Taken from certificate',
  calculated: 'Automatically calculated',
  manual_verified: 'Manually entered & verified',
};

export const RESULT_OPTIONS = ['Pass', 'Conditional Pass', 'Fail'];
export const FAIL_RESULTS = new Set(['Fail', 'Failed', 'Rejected', 'Unsafe']);

export const INSPECTION_TYPES = [
  'Calibration',
  'Inspection',
  'Test',
  'Statutory Examination',
  'Safety Inspection',
  'Condition Monitoring',
  'Other',
];

export const VALIDITY_PRESETS = [
  { months: 1, label: '1 Month' },
  { months: 3, label: '3 Months' },
  { months: 6, label: '6 Months' },
  { months: 12, label: '12 Months' },
  { months: 18, label: '18 Months' },
  { months: 24, label: '24 Months' },
  { months: 36, label: '36 Months' },
];

export const LIFECYCLE_STATUSES = ['active', 'under_repair', 'retired'];
export const SERVICEABILITY_OPTIONS = ['Serviceable', 'Under Maintenance', 'Under Repair', 'Quarantined', 'Scrapped'];

// ── Category definitions ────────────────────────────────────────────────────
// `fields` stores dynamic technical fields. Keys are persisted inside
// compliance_equipment.technical_specs. Legacy columns (range_value, accuracy,
// capacity_value, swl, unit, standard) remain mirrored for backwards
// compatibility with records created before the upgrade.
const F = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

export const BUILTIN_CATEGORIES = [
  {
    id: 'pressure',
    code: 'pressure',
    label: 'Pressure Instruments & Gauges',
    defaultFreqMonths: 12,
    fields: [
      F('measuring_range', 'Measuring Range', 'text'),
      F('unit', 'Unit', 'text'),
      F('accuracy_class', 'Accuracy Class', 'text'),
      F('dial_size', 'Dial Size', 'text'),
      F('pressure_type', 'Pressure Type', 'select', { options: ['Gauge', 'Absolute', 'Differential', 'Vacuum', 'Compound'] }),
      F('standard', 'Calibration Standard / Procedure', 'text'),
    ],
  },
  {
    id: 'temperature',
    code: 'temperature',
    label: 'Temperature Instruments',
    defaultFreqMonths: 12,
    fields: [
      F('measuring_range', 'Measuring Range', 'text'),
      F('unit', 'Unit', 'text'),
      F('accuracy_class', 'Accuracy Class', 'text'),
      F('dial_size', 'Dial Size', 'text'),
      F('sensor_type', 'Sensor / Instrument Type', 'text'),
      F('standard', 'Calibration Standard / Procedure', 'text'),
    ],
  },
  {
    id: 'weighing',
    code: 'weighing',
    label: 'Weighing Scales, Balances & Load Cells',
    defaultFreqMonths: 12,
    fields: [
      F('capacity', 'Capacity', 'text'),
      F('unit', 'Unit', 'text'),
      F('accuracy_class', 'Accuracy / Resolution', 'text'),
      F('scale_type', 'Scale / Load Cell Type', 'text'),
      F('standard', 'Calibration Standard / Procedure', 'text'),
    ],
  },
  {
    id: 'vessels',
    code: 'vessels',
    label: 'Pressure Vessels & Air Receivers',
    defaultFreqMonths: 12,
    fields: [
      F('design_pressure', 'Design Pressure', 'text'),
      F('working_pressure', 'Working Pressure', 'text'),
      F('test_pressure', 'Test Pressure', 'text'),
      F('capacity', 'Capacity / Volume', 'text'),
      F('unit', 'Unit', 'text'),
      F('vessel_type', 'Vessel Type', 'text'),
      F('standard', 'Applicable Standard / Rule', 'text'),
    ],
  },
  {
    id: 'valves',
    code: 'valves',
    label: 'Safety & Relief Valves',
    defaultFreqMonths: 12,
    fields: [
      F('set_pressure', 'Set Pressure', 'text'),
      F('unit', 'Unit', 'text'),
      F('valve_type', 'Valve Type', 'text'),
      F('test_medium', 'Test Medium', 'text'),
      F('standard', 'Applicable Standard', 'text'),
    ],
  },
  {
    id: 'lifting',
    code: 'lifting',
    label: 'Lifting Tools, Tackles & Slings',
    defaultFreqMonths: 12,
    fields: [
      F('swl', 'Safe Working Load (SWL)', 'text'),
      F('capacity_unit', 'Capacity Unit', 'text'),
      F('equipment_type', 'Equipment Type', 'select', { options: ['Chain Pulley Block', 'Wire Rope Sling', 'Shackle', 'Hook', 'Chain Sling', 'Lifting Beam', 'Clamp', 'Other'] }),
      F('identification_number', 'Identification Number', 'text'),
      F('standard', 'Standard / Procedure', 'text'),
    ],
  },
  {
    id: 'ppe',
    code: 'ppe',
    label: 'PPE & Safety Equipment (Harnesses, Lanyards)',
    defaultFreqMonths: 6,
    fields: [
      F('harness_type', 'Harness / Equipment Type', 'text'),
      F('batch_number', 'Serial / Batch Number', 'text'),
      F('assigned_to', 'Assigned Area / Person', 'text'),
      F('service_life_months', 'Manufacturer Service Life (months)', 'number'),
      F('standard', 'Standard / Certification', 'text'),
    ],
  },
  {
    id: 'electrical',
    code: 'electrical',
    label: 'Electrical Testing & Earthing Equipment',
    defaultFreqMonths: 12,
    fields: [
      F('instrument_type', 'Instrument Type', 'text'),
      F('measurement_range', 'Measurement Range', 'text'),
      F('accuracy', 'Accuracy', 'text'),
      F('calibration_standard', 'Calibration Standard', 'text'),
      F('standard', 'Procedure / Statutory Requirement', 'text'),
    ],
  },
  {
    id: 'other',
    code: 'other',
    label: 'Other Inspection-Controlled Equipment',
    defaultFreqMonths: 12,
    fields: [F('standard', 'Standard / Procedure / Statutory Requirement', 'text')],
  },
];

// Backwards-compatible export (legacy pages import COMPLIANCE_CATEGORIES).
export const COMPLIANCE_CATEGORIES = BUILTIN_CATEGORIES.map((c) => ({
  id: c.id,
  label: c.label,
  defaultFreqMonths: c.defaultFreqMonths,
  fields: c.fields.map((f) => f.key),
}));

export function normalizeConfiguredCategories(configured = []) {
  if (!Array.isArray(configured)) return [];
  return configured
    .filter((c) => c && c.code && c.active !== false)
    .map((c) => ({
      id: c.code,
      code: c.code,
      label: c.label || c.code,
      defaultFreqMonths: Math.max(1, Number(c.defaultFrequencyMonths || c.default_frequency_months || 12)),
      fields: Array.isArray(c.technicalFields || c.technical_fields)
        ? (c.technicalFields || c.technical_fields).map((f) => ({
            key: String(f.key || f.name || '').trim(),
            label: String(f.label || f.name || f.key || '').trim(),
            type: f.type || 'text',
            options: Array.isArray(f.options) ? f.options : [],
            unit: f.unit || '',
          })).filter((f) => f.key)
        : [],
      custom: true,
    }));
}

export function resolveCategories(configured = []) {
  const custom = normalizeConfiguredCategories(configured);
  const byCode = new Map();
  BUILTIN_CATEGORIES.forEach((c) => byCode.set(c.code, { ...c }));
  custom.forEach((c) => {
    // An administratively configured code may override a built-in definition.
    byCode.set(c.code, c);
  });
  return [...byCode.values()];
}

export function getCategoryDef(category, configured = []) {
  return resolveCategories(configured).find((c) => c.code === category || c.id === category) || null;
}

export function categoryLabel(category, customCategory, configured = []) {
  if (category === 'other' && customCategory) return customCategory;
  const def = getCategoryDef(category, configured);
  return def?.label || customCategory || category || 'Other';
}

export function defaultFreqFor(category, configured = []) {
  return getCategoryDef(category, configured)?.defaultFreqMonths ?? 12;
}

export function categoryFields(category, configured = []) {
  return getCategoryDef(category, configured)?.fields || [];
}

// ── Date primitives (date-only, no timezone drift) ─────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

export function isValidISODate(value) {
  const s = String(value || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Normalise many input formats to YYYY-MM-DD. Accepts ISO, DD-MM-YYYY,
// DD/MM/YYYY, and JS Date objects. Returns '' for invalid/blank.
export function normalizeDateInput(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.slice(0, 10);
    return isValidISODate(iso) ? iso : '';
  }
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (m) {
    const iso = `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    return isValidISODate(iso) ? iso : '';
  }
  return '';
}

export function toISODate(date) {
  return normalizeDateInput(date);
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function formatDateDMY(value) {
  const iso = normalizeDateInput(value);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function formatDateTimeDMY(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${pad2(dt.getDate())}-${pad2(dt.getMonth() + 1)}-${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

export function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Add whole months to a YYYY-MM-DD date, clamping to the last valid day
// (e.g. 31 Jan + 1 month = 28/29 Feb; 29 Feb 2024 + 12 months = 28 Feb 2025).
export function addMonths(dateStr, months) {
  const iso = normalizeDateInput(dateStr);
  if (!iso) return '';
  const m = Number(months);
  if (!Number.isFinite(m) || m === 0) return iso;
  const [y, mo, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + Math.trunc(m), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const iso = normalizeDateInput(dateStr);
  if (!iso) return '';
  const n = Number(days);
  if (!Number.isFinite(n) || n === 0) return iso;
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(n));
  return dt.toISOString().slice(0, 10);
}

export function daysUntil(dateStr, todayStr) {
  const iso = normalizeDateInput(dateStr);
  if (!iso) return null;
  const today = normalizeDateInput(todayStr) || todayISO();
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((a - b) / 86_400_000);
}

export function daysBetween(fromDate, toDate) {
  return daysUntil(toDate, fromDate);
}

// ── Expiry + next-due engine ────────────────────────────────────────────────
export function computeExpiry({
  issueDate,
  validityMonths,
  validityDays,
  manualExpiryDate,
  expirySource,
} = {}) {
  const issue = normalizeDateInput(issueDate);
  const manual = normalizeDateInput(manualExpiryDate);
  const months = Number(validityMonths);
  const days = Number(validityDays);
  const hasValidity = (Number.isFinite(months) && months > 0) || (Number.isFinite(days) && days > 0);
  let calculated = '';
  if (issue && hasValidity) {
    calculated = addMonths(issue, Number.isFinite(months) ? months : 0);
    if (Number.isFinite(days) && days > 0) calculated = addDays(calculated, days);
  } else if (issue && !manual && !hasValidity) {
    calculated = '';
  }
  const manualWins = !!manual;
  const effective = manualWins ? manual : calculated;
  const expectedSource = manualWins
    ? (expirySource === EXPIRY_SOURCES.CALCULATED ? EXPIRY_SOURCES.MANUAL_VERIFIED : (expirySource || EXPIRY_SOURCES.CERTIFICATE))
    : (calculated ? EXPIRY_SOURCES.CALCULATED : (expirySource || ''));
  return {
    calculatedExpiry: calculated,
    effectiveExpiry: effective,
    source: expectedSource || '',
    manualExpiryEntered: !!manual,
    differs: !!(manual && calculated && manual !== calculated),
    differenceDays: manual && calculated ? daysUntil(manual, calculated) : null,
  };
}

export function computeNextDue(inspectionDate, frequencyMonths, explicitNextDue, frequencyDays = 0) {
  const explicit = normalizeDateInput(explicitNextDue);
  if (explicit) return explicit;
  const base = addMonths(inspectionDate, frequencyMonths);
  if (base && Number(frequencyDays) > 0) return addDays(base, Number(frequencyDays));
  return base;
}

export function validityLabel(months, days, customText = '') {
  if (customText) return customText;
  const m = Number(months);
  const d = Number(days);
  const parts = [];
  if (Number.isFinite(m) && m > 0) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  if (Number.isFinite(d) && d > 0) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  return parts.join(' + ') || '—';
}

/**
 * Validate inspection/certificate dates. Returns blocking errors and
 * non-blocking warnings. Expiry before issue is blocked unless an explicit
 * authorised exception reason is supplied.
 */
export function validateInspectionDates(form = {}, { allowExpiryException = false } = {}) {
  const errors = [];
  const warnings = [];
  const inspectionDate = normalizeDateInput(form.inspectionDate);
  const issueDate = normalizeDateInput(form.issueDate);
  const manualExpiry = normalizeDateInput(form.manualExpiryDate || form.expiryDate);
  const exceptionalReason = String(form.expiryOverrideReason || '').trim();

  if (!inspectionDate) errors.push('Inspection / test date is required.');
  if ((form.issueDate && !issueDate) || (form.manualExpiryDate || form.expiryDate) && !manualExpiry) {
    errors.push('One or more dates are invalid. Use the date picker or DD-MM-YYYY format.');
  }
  if (inspectionDate && issueDate && inspectionDate > issueDate) {
    warnings.push('Inspection date is after the certificate issue date. Confirm this is correct.');
  }
  if (issueDate && manualExpiry && manualExpiry < issueDate) {
    if (allowExpiryException && exceptionalReason) {
      warnings.push('Expiry date precedes the issue date under an authorised exception.');
    } else {
      errors.push('Certificate expiry cannot precede the certificate issue date without an authorised exception reason.');
    }
  }
  const calc = computeExpiry({
    issueDate,
    validityMonths: form.validityMonths,
    validityDays: form.validityDays,
    manualExpiryDate: manualExpiry,
    expirySource: form.expirySource,
  });
  if (calc.differs) {
    warnings.push(
      `Printed/manual expiry ${formatDateDMY(manualExpiry)} differs from the calculated date ` +
      `${formatDateDMY(calc.calculatedExpiry)}. The printed certificate date is retained.`
    );
  }
  if (form.explicitNextDue && issueDate && manualExpiry && form.explicitNextDue > addMonths(manualExpiry, 12)) {
    warnings.push('Next inspection due date is more than 12 months after certificate expiry. Verify the procedure.');
  }
  if (form.explicitNextDue && !String(form.nextDueOverrideReason || '').trim()) {
    warnings.push('Next inspection due date was overridden; record a reason for the audit trail.');
  }
  if (form.result && FAIL_RESULTS.has(String(form.result)) && !String(form.defects || '').trim()) {
    errors.push('Defects / failure details are required when the inspection result is Fail.');
  }
  if ((String(form.defects || '').trim() || FAIL_RESULTS.has(String(form.result))) && !String(form.correctiveAction || '').trim()) {
    warnings.push('A corrective action is recommended for every defect or failed inspection.');
  }
  return { errors, warnings, calculatedExpiry: calc.calculatedExpiry, effectiveExpiry: calc.effectiveExpiry, expirySource: calc.source };
}

// ── Status engine ───────────────────────────────────────────────────────────
export const COMPLIANCE_STATUS = {
  VALID: 'VALID',
  DUE_SOON: 'DUE_SOON',
  OVERDUE: 'OVERDUE',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  UNDER_REPAIR: 'UNDER_REPAIR',
  NOT_INSPECTED: 'NOT_INSPECTED',
  CERTIFICATE_MISSING: 'CERTIFICATE_MISSING',
  RETIRED: 'RETIRED',
};

// Lower index = higher severity priority.
export const STATUS_PRIORITY = [
  COMPLIANCE_STATUS.RETIRED,
  COMPLIANCE_STATUS.FAILED,
  COMPLIANCE_STATUS.EXPIRED,
  COMPLIANCE_STATUS.OVERDUE,
  COMPLIANCE_STATUS.ACTION_REQUIRED,
  COMPLIANCE_STATUS.UNDER_REPAIR,
  COMPLIANCE_STATUS.DUE_SOON,
  COMPLIANCE_STATUS.NOT_INSPECTED,
  COMPLIANCE_STATUS.CERTIFICATE_MISSING,
  COMPLIANCE_STATUS.VALID,
];

export const COMPLIANCE_STATUS_META = {
  VALID: { label: 'Valid', tone: 'success', chart: '#10B981' },
  DUE_SOON: { label: 'Due Soon', tone: 'warning', chart: '#F59E0B' },
  OVERDUE: { label: 'Overdue', tone: 'danger', chart: '#EF4444' },
  EXPIRED: { label: 'Expired', tone: 'danger', chart: '#B91C1C' },
  FAILED: { label: 'Failed / Unsafe', tone: 'danger', chart: '#DC2626' },
  ACTION_REQUIRED: { label: 'Action Required', tone: 'warning', chart: '#D97706' },
  UNDER_REPAIR: { label: 'Under Repair', tone: 'warning', chart: '#F97316' },
  NOT_INSPECTED: { label: 'Not Inspected', tone: 'info', chart: '#64748B' },
  CERTIFICATE_MISSING: { label: 'Certificate Missing', tone: 'info', chart: '#7C3AED' },
  RETIRED: { label: 'Retired', tone: 'muted', chart: '#475569' },
  // Legacy cache value from the first implementation.
  NO_CERTIFICATE: { label: 'Certificate Missing', tone: 'info', chart: '#7C3AED' },
};

const fieldOf = (obj, camel, snake) => obj?.[camel] ?? obj?.[snake];

function sortHistory(history = []) {
  return [...history].sort((a, b) => {
    const ad = String(fieldOf(a, 'inspectionDate', 'inspection_date') || '').slice(0, 10);
    const bd = String(fieldOf(b, 'inspectionDate', 'inspection_date') || '').slice(0, 10);
    if (ad !== bd) return bd.localeCompare(ad);
    return String(fieldOf(b, 'createdAt', 'created_at') || '').localeCompare(String(fieldOf(a, 'createdAt', 'created_at') || ''));
  });
}

function historyHasCertificate(record) {
  if (!record) return false;
  return !!(
    String(fieldOf(record, 'certificateNumber', 'certificate_number') || '').trim() ||
    fieldOf(record, 'issueDate', 'issue_date') ||
    fieldOf(record, 'expiryDate', 'expiry_date')
  );
}

/**
 * Derive the complete compliance picture for one equipment item.
 * `history` may be unsorted; newest inspection wins.
 */
export function deriveCompliance(equipment, history = [], options = {}) {
  const eq = equipment || {};
  const rows = sortHistory(Array.isArray(history) ? history : []);
  const latest = rows[0] || null;
  const latestCert = rows.find(historyHasCertificate) || null;
  const dueSoonDays = Number(options.dueSoonDays) > 0 ? Number(options.dueSoonDays) : DUE_SOON_DAYS;
  const today = normalizeDateInput(options.today) || normalizeDateInput(options.asOfDate) || todayISO();
  const status = getComplianceStatus(eq, latest, dueSoonDays, today, latestCert);

  const currentExpiry = normalizeDateInput(
    fieldOf(latestCert, 'expiryDate', 'expiry_date') ||
    fieldOf(eq, 'currentExpiryDate', 'current_expiry_date') ||
    fieldOf(eq, 'expiryDate', 'expiry_date')
  );
  const currentIssue = normalizeDateInput(
    fieldOf(latestCert, 'issueDate', 'issue_date') ||
    fieldOf(eq, 'currentIssueDate', 'current_issue_date')
  );
  const currentCertNumber = String(
    fieldOf(latestCert, 'certificateNumber', 'certificate_number') ||
    fieldOf(eq, 'currentCertificateNumber', 'current_certificate_number') ||
    ''
  ).trim();
  const nextDue = normalizeDateInput(
    status.dueDate ||
    fieldOf(latest, 'nextDueDate', 'next_due_date') ||
    fieldOf(latestCert, 'nextDueDate', 'next_due_date') ||
    fieldOf(eq, 'currentNextDueDate', 'current_next_due_date') ||
    fieldOf(eq, 'nextDueDate', 'next_due_date')
  );
  const lastInspectionDate = normalizeDateInput(
    fieldOf(latest, 'inspectionDate', 'inspection_date') ||
    fieldOf(eq, 'lastInspectionDate', 'last_inspection_date')
  );
  const lastResult = String(fieldOf(latest, 'result', 'result') || fieldOf(eq, 'currentResult', 'current_result') || '').trim();
  const documents = [];
  const seen = new Set();
  const pushDocs = (docs) => {
    if (!Array.isArray(docs)) return;
    docs.forEach((d) => {
      if (!d) return;
      const key = d.storagePath || d.storage_path || d.publicUrl || d.public_url || d.filename || JSON.stringify(d);
      if (seen.has(key)) return;
      seen.add(key);
      documents.push(d);
    });
  };
  pushDocs(fieldOf(eq, 'documents', 'documents'));
  pushDocs(fieldOf(eq, 'document', 'document'));
  rows.forEach((r) => {
    pushDocs(fieldOf(r, 'documents', 'documents'));
    pushDocs(fieldOf(r, 'document', 'document'));
  });
  const openCorrective = rows.find((r) => {
    const defects = String(fieldOf(r, 'defects', 'defects') || '').trim();
    const action = String(fieldOf(r, 'correctiveAction', 'corrective_action') || '').trim();
    const closure = fieldOf(r, 'correctiveActionClosureDate', 'corrective_action_closure_date') || fieldOf(r, 'closureDate', 'closure_date');
    const owner = String(fieldOf(r, 'correctiveActionOwner', 'corrective_action_owner') || '').trim();
    return (defects || action || owner) && !closure;
  }) || null;
  const certificateRequired = !(eq.certificateRequired === false || eq.certificate_required === false);

  return {
    ...eq,
    _history: rows,
    _latest: latest,
    _latestCertificateRecord: latestCert,
    _status: status.status,
    _reason: status.reason,
    _daysLeft: status.daysLeft,
    _nextDueDays: status.nextDueDays,
    _expiryDays: status.expiryDays,
    _alertDate: status.alertDate,
    _dueDate: nextDue,
    _expiryDate: currentExpiry,
    _issueDate: currentIssue,
    _certificateNumber: currentCertNumber,
    _lastInspectionDate: lastInspectionDate,
    _lastResult: lastResult,
    _expirySource: String(fieldOf(latestCert, 'expirySource', 'expiry_source') || fieldOf(eq, 'expirySource', 'expiry_source') || '').trim(),
    _certificateRequired: certificateRequired,
    _correctiveOpen: !!openCorrective,
    _correctiveRecord: openCorrective,
    _documents: documents,
    _hasCertificate: !!(currentCertNumber || currentExpiry || currentIssue),
    _inspectionCount: rows.length,
    _validityMonths: Number(fieldOf(latestCert, 'validityMonths', 'validity_months') || fieldOf(eq, 'frequencyMonths', 'frequency_months') || 0) || null,
    _validityDays: Number(fieldOf(latestCert, 'validityDays', 'validity_days') || 0) || null,
    _plantId: fieldOf(eq, 'plant_id', 'plant_id') || fieldOf(eq, 'plantId', 'plant_id') || '',
  };
}

/**
 * Derive status. Signature kept compatible with the first implementation.
 * A failed latest inspection can never fall through to VALID: a newer passing
 * inspection is required to supersede it.
 */
export function getComplianceStatus(equipment, latest, dueSoonDays = DUE_SOON_DAYS, todayStr, currentCert = null) {
  const eq = equipment || {};
  const today = normalizeDateInput(todayStr) || todayISO();
  const lifecycle = String(fieldOf(eq, 'lifecycleStatus', 'lifecycle_status') || 'active').toLowerCase();
  const serviceability = String(fieldOf(eq, 'serviceability', 'serviceability') || '').trim();
  const lastResult = String(fieldOf(latest, 'result', 'result') || fieldOf(eq, 'currentResult', 'current_result') || '').trim();
  const lastDate = normalizeDateInput(fieldOf(latest, 'inspectionDate', 'inspection_date') || fieldOf(eq, 'lastInspectionDate', 'last_inspection_date'));
  const cert = currentCert || (historyHasCertificate(latest) ? latest : null);
  const expiry = normalizeDateInput(
    fieldOf(cert, 'expiryDate', 'expiry_date') ||
    fieldOf(eq, 'currentExpiryDate', 'current_expiry_date') ||
    fieldOf(eq, 'expiryDate', 'expiry_date')
  );
  const nextDue = normalizeDateInput(
    fieldOf(latest, 'nextDueDate', 'next_due_date') ||
    fieldOf(cert, 'nextDueDate', 'next_due_date') ||
    fieldOf(eq, 'currentNextDueDate', 'current_next_due_date') ||
    fieldOf(eq, 'nextDueDate', 'next_due_date')
  );
  const nextDays = daysUntil(nextDue, today);
  const expiryDays = daysUntil(expiry, today);
  const certificateRequired = !(eq.certificateRequired === false || eq.certificate_required === false);
  const certNumber = String(fieldOf(cert, 'certificateNumber', 'certificate_number') || fieldOf(eq, 'currentCertificateNumber', 'current_certificate_number') || '').trim();
  const issue = normalizeDateInput(fieldOf(cert, 'issueDate', 'issue_date') || fieldOf(eq, 'currentIssueDate', 'current_issue_date'));
  const hasCert = !!(certNumber || expiry || issue);
  const defects = String(fieldOf(latest, 'defects', 'defects') || '').trim();
  const action = String(fieldOf(latest, 'correctiveAction', 'corrective_action') || '').trim();
  const actionOwner = String(fieldOf(latest, 'correctiveActionOwner', 'corrective_action_owner') || '').trim();
  const actionDue = normalizeDateInput(fieldOf(latest, 'correctiveActionDueDate', 'corrective_action_due_date'));
  const closureDate = normalizeDateInput(fieldOf(latest, 'correctiveActionClosureDate', 'corrective_action_closure_date') || fieldOf(latest, 'closureDate', 'closure_date'));
  const openCorrective = !!(defects || action || actionOwner) && !closureDate;
  const base = {
    daysLeft: nextDays ?? expiryDays,
    nextDueDays: nextDays,
    expiryDays,
    dueDate: nextDue,
    expiryDate: expiry,
    certificateNumber: certNumber,
    issueDate: issue,
    lastInspectionDate: lastDate,
    lastResult,
    alertDate: nextDue || expiry,
    hasCertificate: hasCert,
    correctiveOpen: openCorrective,
  };

  if (lifecycle === 'retired' || lifecycle === 'scrapped') {
    return { ...base, status: COMPLIANCE_STATUS.RETIRED, reason: 'Equipment retired — retained for historical traceability', alertDate: '' };
  }
  if (FAIL_RESULTS.has(lastResult)) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.FAILED,
      reason: `Last inspection ${formatDateDMY(lastDate)} marked "${lastResult}" — remains failed until a newer passing inspection is recorded`,
      alertDate: lastDate || nextDue || expiry,
    };
  }
  if (expiry && expiryDays < 0) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.EXPIRED,
      reason: `Certificate expired on ${formatDateDMY(expiry)} (${Math.abs(expiryDays)} days ago)`,
      alertDate: expiry,
    };
  }
  if (nextDue && nextDays < 0) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.OVERDUE,
      reason: `Inspection overdue since ${formatDateDMY(nextDue)} (${Math.abs(nextDays)} days)`,
      alertDate: nextDue,
    };
  }
  if (openCorrective) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.ACTION_REQUIRED,
      reason: `Corrective action open${actionOwner ? ` — owner ${actionOwner}` : ''}${actionDue ? `, due ${formatDateDMY(actionDue)}` : ''}`,
      alertDate: actionDue || nextDue || expiry || lastDate,
    };
  }
  const repairStates = ['under repair', 'under maintenance', 'quarantined'];
  if (lifecycle === 'under_repair' || repairStates.includes(serviceability.toLowerCase())) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.UNDER_REPAIR,
      reason: `Equipment is ${serviceability || 'under repair'} — compliance cannot be considered valid`,
      alertDate: nextDue || expiry || lastDate,
    };
  }
  if (!latest && !nextDue && !expiry) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.NOT_INSPECTED,
      reason: 'No inspection or certificate recorded yet',
      alertDate: '',
    };
  }
  if (certificateRequired && !hasCert) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.CERTIFICATE_MISSING,
      reason: 'Inspection history exists but no certificate number, issue date or expiry date is recorded',
      alertDate: nextDue || expiry || lastDate,
    };
  }
  if (!latest && certificateRequired) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.CERTIFICATE_MISSING,
      reason: 'No certificate on file for this certificate-controlled item',
      alertDate: nextDue || expiry,
    };
  }
  if (nextDays != null && nextDays <= dueSoonDays) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.DUE_SOON,
      reason: nextDays === 0 ? 'Inspection is due today' : `Due ${formatDateDMY(nextDue)} (${nextDays} days left)`,
      alertDate: nextDue,
    };
  }
  if (expiryDays != null && expiryDays <= dueSoonDays) {
    return {
      ...base,
      status: COMPLIANCE_STATUS.DUE_SOON,
      reason: `Certificate expires ${formatDateDMY(expiry)} (${expiryDays} days left)`,
      alertDate: expiry,
    };
  }
  return {
    ...base,
    status: COMPLIANCE_STATUS.VALID,
    reason: nextDue ? `Valid — next inspection ${formatDateDMY(nextDue)}` : (expiry ? `Valid until ${formatDateDMY(expiry)}` : 'No expiry set'),
    alertDate: '',
  };
}

// ── Filtering / summaries ──────────────────────────────────────────────────
export function filterCompliance(records, f = {}) {
  const q = String(f.query || '').trim().toLowerCase();
  const from = normalizeDateInput(f.from);
  const to = normalizeDateInput(f.to);
  const statusFilter = f.status
    ? (Array.isArray(f.status) ? f.status : String(f.status).split(',')).map((s) => String(s).trim()).filter(Boolean)
    : [];
  const categories = f.category
    ? (Array.isArray(f.category) ? f.category : [f.category])
    : [];
  return (records || []).filter((r) => {
    if (!r) return false;
    const pid = r.plant_id || r.plantId || r._plantId;
    if (f.plantId) {
      if (pid && pid !== f.plantId) return false;
      if (!pid && f.plantId !== '00000000-0000-0000-0000-000000000001') return false;
    }
    if (categories.length && !categories.includes(r.category)) return false;
    if (f.subcategory && (r.subcategory || '') !== f.subcategory) return false;
    if (f.department && (r.department || '') !== f.department) return false;
    if (f.area && ((r.area || '') !== f.area && (r.section || '') !== f.area)) return false;
    if (f.person && (fieldOf(r, 'responsiblePerson', 'responsible_person') || '') !== f.person) return false;
    if (statusFilter.length && !statusFilter.includes(r._status || r.status)) return false;
    if (f.result && (r._lastResult || fieldOf(r._latest, 'result', 'result')) !== f.result) return false;
    if (f.missingCertificate && !['CERTIFICATE_MISSING', 'NOT_INSPECTED'].includes(r._status || r.status)) return false;
    if (f.overdueOnly && !['OVERDUE', 'EXPIRED'].includes(r._status || r.status)) return false;
    if (f.failedOnly && (r._status || r.status) !== 'FAILED') return false;
    const due = normalizeDateInput(r._dueDate || fieldOf(r, 'nextDueDate', 'next_due_date') || r._expiryDate || fieldOf(r, 'currentExpiryDate', 'current_expiry_date'));
    if (from || to) {
      if (!due) return false;
      if (from && due < from) return false;
      if (to && due > to) return false;
    }
    if (f.withinDays != null) {
      const left = r._daysLeft ?? daysUntil(due, f.today);
      if (left == null || left < 0 || left > Number(f.withinDays)) return false;
    }
    if (f.hasDocuments != null) {
      const has = !!(r._documents?.length || r._hasDocument || r._hasDoc);
      if (has !== !!f.hasDocuments) return false;
    }
    if (q) {
      const hay = [
        r.equipmentCode, r.equipment_code, r.equipmentName, r.equipment_name,
        r.manufacturer, r.model, r.serialNumber, r.serial_number, r.assetTag, r.asset_tag,
        r.department, r.area, r.section, r.subcategory, r.responsiblePerson, r.responsible_person,
        r._certificateNumber, r._lastResult, r._status, r.description,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortCompliance(records, sort = { key: 'nextDue', dir: 'asc' }) {
  const dir = sort?.dir === 'desc' ? -1 : 1;
  const key = sort?.key || 'nextDue';
  const valueOf = (r) => {
    switch (key) {
      case 'code': return String(r.equipmentCode || r.equipment_code || '').toLowerCase();
      case 'name': return String(r.equipmentName || r.equipment_name || '').toLowerCase();
      case 'category': return String(r.category || '').toLowerCase();
      case 'plant': return String(r.plant_id || r.plantId || '').toLowerCase();
      case 'department': return String(r.department || '').toLowerCase();
      case 'area': return String(r.area || r.section || '').toLowerCase();
      case 'serial': return String(r.serialNumber || r.serial_number || '').toLowerCase();
      case 'lastInspection': return String(r._lastInspectionDate || '');
      case 'issue': return String(r._issueDate || '');
      case 'expiry': return String(r._expiryDate || '');
      case 'days': return r._daysLeft == null ? 999999 : r._daysLeft;
      case 'status': return STATUS_PRIORITY.indexOf(r._status || r.status);
      case 'person': return String(r.responsiblePerson || r.responsible_person || '').toLowerCase();
      case 'nextDue':
      default: return String(r._dueDate || r.nextDueDate || r.next_due_date || '9999-12-31');
    }
  };
  return [...(records || [])].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function summarizeCompliance(rows) {
  const s = {
    total: 0, valid: 0, dueSoon: 0, dueSoon30: 0, dueSoon60: 0,
    overdue: 0, expired: 0, failed: 0, actionRequired: 0, underRepair: 0,
    notInspected: 0, certMissing: 0, retired: 0, noCert: 0,
    overdueCertificates: 0, missingCertificates: 0, actionOrRepair: 0,
  };
  (rows || []).forEach((r) => {
    const st = r._status || r.status;
    s.total += 1;
    if (st === 'VALID') s.valid += 1;
    else if (st === 'DUE_SOON') {
      s.dueSoon += 1;
      const left = r._daysLeft;
      if (left != null && left <= 30) s.dueSoon30 += 1;
      if (left != null && left <= 60) s.dueSoon60 += 1;
    } else if (st === 'OVERDUE') s.overdue += 1;
    else if (st === 'EXPIRED') s.expired += 1;
    else if (st === 'FAILED') s.failed += 1;
    else if (st === 'ACTION_REQUIRED') s.actionRequired += 1;
    else if (st === 'UNDER_REPAIR') s.underRepair += 1;
    else if (st === 'NOT_INSPECTED') s.notInspected += 1;
    else if (st === 'CERTIFICATE_MISSING' || st === 'NO_CERTIFICATE') s.certMissing += 1;
    else if (st === 'RETIRED') s.retired += 1;
    else s.noCert += 1;
  });
  s.overdueCertificates = s.overdue + s.expired;
  s.missingCertificates = s.certMissing + s.notInspected;
  s.actionOrRepair = s.actionRequired + s.underRepair;
  return s;
}

export function compliancePercent(rows) {
  const active = (rows || []).filter((r) => (r._status || r.status) !== 'RETIRED');
  if (!active.length) return 0;
  const valid = active.filter((r) => (r._status || r.status) === 'VALID').length;
  return Math.round((valid / active.length) * 1000) / 10;
}

export function groupByMonth(rows, dateKey = '_dueDate') {
  const map = new Map();
  (rows || []).forEach((r) => {
    const d = normalizeDateInput(r[dateKey] || r._dueDate || r._expiryDate);
    if (!d) return;
    const ym = d.slice(0, 7);
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(r);
  });
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ym, items]) => ({ month: ym, label: monthLabel(ym), items }));
}

export function countBy(rows, getter) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const key = getter(r) || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// ── Legacy CSV export (kept for other callers; module uses real XLSX) ───────
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildComplianceCsv(rows) {
  const header = ['Equipment ID', 'Equipment Code', 'Name', 'Category', 'Plant', 'Department', 'Area', 'Manufacturer', 'Model', 'Serial', 'Status', 'Next Due', 'Days Remaining', 'Reason', 'Last Result', 'Last Inspection', 'Certificate No', 'Expiry', 'Agency'];
  const lines = [header.join(',')];
  rows.forEach((r) => {
    lines.push([
      r.id, r.equipment_code || r.equipmentCode, r.equipment_name || r.equipmentName,
      categoryLabel(r.category, r.custom_category || r.customCategory),
      r.plant_name || r.plantName || r.plant_id || r.plantId,
      r.department, r.area || r.section, r.manufacturer, r.model,
      r.serial_number || r.serialNumber,
      r._status || r.status, r._dueDate || r.next_due_date || r.nextDueDate,
      r._daysLeft ?? '', r._reason || '', r._lastResult || '', r._lastInspectionDate || '',
      r._certificateNumber || '', r._expiryDate || '', r._agency || '',
    ].map(csvCell).join(','));
  });
  return lines.join('\n');
}

// ── Settings helpers ───────────────────────────────────────────────────────
export function normalizeSettings(raw = {}) {
  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : fallback);
  let notifyDays = raw.notifyDays ?? raw.notify_days ?? DEFAULT_SETTINGS.notifyDays;
  if (typeof notifyDays === 'string') {
    notifyDays = notifyDays.split(',').map((s) => Number(String(s).trim())).filter((n) => Number.isFinite(n) && n >= 0);
  }
  if (!Array.isArray(notifyDays) || !notifyDays.length) notifyDays = DEFAULT_SETTINGS.notifyDays;
  return {
    dueSoonDays: num(raw.dueSoonDays ?? raw.due_soon_days, DEFAULT_SETTINGS.dueSoonDays),
    dueSoonSecondaryDays: num(raw.dueSoonSecondaryDays ?? raw.due_soon_secondary_days, DEFAULT_SETTINGS.dueSoonSecondaryDays),
    reportWindowDays: num(raw.reportWindowDays ?? raw.report_window_days, DEFAULT_SETTINGS.reportWindowDays),
    notifyDays: [...new Set(notifyDays.map(Number))].sort((a, b) => b - a),
    notifyInApp: raw.notifyInApp ?? raw.notify_in_app ?? true,
    notifyEmails: String(raw.notifyEmails ?? raw.notify_emails ?? ''),
    notifyWhatsApp: String(raw.notifyWhatsApp ?? raw.notify_whatsapp ?? ''),
    recipients: raw.recipients && typeof raw.recipients === 'object' ? raw.recipients : {},
    asOfDate: normalizeDateInput(raw.asOfDate ?? raw.as_of_date ?? ''),
  };
}

export function statusLabel(status) {
  return COMPLIANCE_STATUS_META[status]?.label || status || '—';
}

export function isActiveStatus(status) {
  return status !== 'RETIRED';
}

export default {
  DUE_SOON_DAYS,
  DEFAULT_SETTINGS,
  BUILTIN_CATEGORIES,
  COMPLIANCE_STATUS,
  COMPLIANCE_STATUS_META,
  deriveCompliance,
  getComplianceStatus,
  computeExpiry,
  computeNextDue,
  addMonths,
  daysUntil,
  filterCompliance,
  summarizeCompliance,
};