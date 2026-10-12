// =============================================================================
// Inspection, Calibration & Statutory Compliance — pure logic (no imports).
// Status is ALWAYS derived from actual dates + inspection outcomes; nothing
// here fabricates demo values. Safe to unit-test in plain Node.
// =============================================================================

export const DUE_SOON_DAYS = 30;

export const COMPLIANCE_CATEGORIES = [
  { id: 'pressure', label: 'Pressure Instruments & Calibration', defaultFreqMonths: 12, fields: ['range_value', 'accuracy', 'unit', 'standard'] },
  { id: 'lifting', label: 'Lifting Tools & Tackles', defaultFreqMonths: 12, fields: ['swl', 'capacity_value', 'unit', 'standard'] },
  { id: 'vessels', label: 'Pressure Vessels & Statutory Equipment', defaultFreqMonths: 12, fields: ['capacity_value', 'unit', 'standard'] },
  { id: 'ppe', label: 'PPE & Safety Equipment', defaultFreqMonths: 6, fields: ['standard'] },
  { id: 'electrical', label: 'Electrical Testing & Safety Equipment', defaultFreqMonths: 12, fields: ['range_value', 'accuracy', 'unit', 'standard'] },
  { id: 'other', label: 'Other Inspection Equipment', defaultFreqMonths: 12, fields: [] },
];

export const RESULT_OPTIONS = ['Pass', 'Conditional Pass', 'Fail'];

export const FAIL_RESULTS = new Set(['Fail', 'Failed', 'Rejected']);

export function categoryLabel(category, customCategory) {
  if (category === 'other' && customCategory) return customCategory;
  return (COMPLIANCE_CATEGORIES.find((c) => c.id === category) || {}).label || category || 'Other';
}

export function defaultFreqFor(category) {
  return (COMPLIANCE_CATEGORIES.find((c) => c.id === category) || {}).defaultFreqMonths ?? 12;
}

// Add whole months to a YYYY-MM-DD date, clamping to month end.
export function addMonths(dateStr, months) {
  if (!dateStr) return '';
  const m = Number(months);
  if (!Number.isFinite(m) || m <= 0) return String(dateStr).slice(0, 10);
  const [y, mo, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !mo || !d) return '';
  const dt = new Date(Date.UTC(y, mo - 1 + m, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

export function daysUntil(dateStr, todayStr) {
  if (!dateStr) return null;
  const t = todayStr ? new Date(`${todayStr}T00:00:00Z`) : new Date();
  t.setUTCHours(0, 0, 0, 0);
  const e = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(e.getTime())) return null;
  return Math.round((e - t) / 86_400_000);
}

// Explicit next-due on the event wins; otherwise derive from inspection date.
export function computeNextDue(inspectionDate, frequencyMonths, explicitNextDue) {
  if (explicitNextDue) return String(explicitNextDue).slice(0, 10);
  return addMonths(inspectionDate, frequencyMonths);
}

/**
 * Derive equipment status. `latest` is the newest inspection event or null.
 * A failed latest result is NEVER auto-marked valid — it stays FAILED until
 * a newer passing inspection supersedes it.
 */
export function getComplianceStatus(equipment, latest, dueSoonDays = DUE_SOON_DAYS, todayStr) {
  const eq = equipment || {};
  const nextDue = String(latest?.next_due_date || latest?.nextDueDate || eq.next_due_date || eq.nextDueDate || '').slice(0, 10);
  const lastResult = String(latest?.result || '').trim();
  const lastDate = String(latest?.inspection_date || latest?.inspectionDate || '').slice(0, 10);

  if (FAIL_RESULTS.has(lastResult)) {
    return {
      status: 'FAILED',
      reason: `Last inspection ${lastDate || 'on file'} marked "${lastResult}" — flagged for authorized review`,
      daysLeft: daysUntil(nextDue, todayStr),
      alertDate: lastDate,
    };
  }
  if (!latest && !nextDue) {
    return { status: 'NO_CERTIFICATE', reason: 'No certificate on file', daysLeft: null, alertDate: '' };
  }
  if (!nextDue) {
    return {
      status: 'VALID',
      reason: lastDate ? `Last passed ${lastDate}; no expiry set` : 'No expiry set',
      daysLeft: null,
      alertDate: '',
    };
  }
  const left = daysUntil(nextDue, todayStr);
  if (left == null) {
    return { status: 'NO_CERTIFICATE', reason: 'No parsable due date', daysLeft: null, alertDate: '' };
  }
  if (left < 0) {
    return { status: 'OVERDUE', reason: `Overdue since ${nextDue} (${Math.abs(left)} days)`, daysLeft: left, alertDate: nextDue };
  }
  if (left <= dueSoonDays) {
    return { status: 'DUE_SOON', reason: `Due ${nextDue} (${left} days left)`, daysLeft: left, alertDate: nextDue };
  }
  return { status: 'VALID', reason: `Valid until ${nextDue}`, daysLeft: left, alertDate: '' };
}

export const COMPLIANCE_STATUS_META = {
  VALID: { label: 'Valid', tone: 'success' },
  DUE_SOON: { label: 'Due Soon', tone: 'warning' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  FAILED: { label: 'Failed / Unsafe', tone: 'danger' },
  NO_CERTIFICATE: { label: 'No Certificate', tone: 'info' },
};

// Plant isolation + register filters. plantId null/'' = all authorized plants.
export function filterCompliance(records, f = {}) {
  const q = String(f.query || '').trim().toLowerCase();
  const from = f.from ? String(f.from).slice(0, 10) : '';
  const to = f.to ? String(f.to).slice(0, 10) : '';
  return (records || []).filter((r) => {
    if (f.plantId) {
      const pid = r.plant_id || r.plantId;
      if (pid && pid !== f.plantId) return false;
      if (!pid && f.plantId !== '00000000-0000-0000-0000-000000000001') return false;
    }
    if (f.category && r.category !== f.category) return false;
    if (f.department && (r.department || '') !== f.department) return false;
    if (f.area && (r.area || '') !== f.area) return false;
    if (f.person && (r.responsible_person || r.responsiblePerson || '') !== f.person) return false;
    if (f.status && (r._status || r.status) !== f.status) return false;
    if (from || to) {
      const due = String(r.next_due_date || r.nextDueDate || '').slice(0, 10);
      if (!due) return false;
      if (from && due < from) return false;
      if (to && due > to) return false;
    }
    if (q) {
      const hay = [r.equipment_code, r.equipmentCode, r.equipment_name, r.equipmentName, r.manufacturer, r.model, r.serial_number, r.serialNumber, r.asset_tag, r.assetTag, r.department, r.area].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function summarizeCompliance(rows) {
  const s = { total: rows.length, valid: 0, dueSoon: 0, overdue: 0, failed: 0, noCert: 0 };
  rows.forEach((r) => {
    const st = r._status || r.status;
    if (st === 'VALID') s.valid += 1;
    else if (st === 'DUE_SOON') s.dueSoon += 1;
    else if (st === 'OVERDUE') s.overdue += 1;
    else if (st === 'FAILED') s.failed += 1;
    else s.noCert += 1;
  });
  return s;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildComplianceCsv(rows) {
  const header = ['Equipment Code', 'Name', 'Category', 'Plant', 'Department', 'Area', 'Manufacturer', 'Model', 'Serial', 'Status', 'Next Due', 'Reason', 'Last Result', 'Last Inspection', 'Certificate No', 'Agency'];
  const lines = [header.join(',')];
  rows.forEach((r) => {
    lines.push([
      r.equipment_code || r.equipmentCode, r.equipment_name || r.equipmentName,
      categoryLabel(r.category, r.custom_category || r.customCategory),
      r.plant_name || r.plantName || r.plant_id || r.plantId,
      r.department, r.area, r.manufacturer, r.model,
      r.serial_number || r.serialNumber,
      r._status || r.status, r.next_due_date || r.nextDueDate,
      r._reason || '', r._lastResult || '', r._lastDate || '',
      r._certNo || '', r._agency || '',
    ].map(csvCell).join(','));
  });
  return lines.join('\n');
}
