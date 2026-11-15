// =============================================================================
// Professional Excel export / import engine for the Inspection, Calibration &
// Statutory Compliance module.
//
//   • Export — 5 styled sheets:
//       1. Equipment Register
//       2. Certificate & Inspection History
//       3. Overdue & Due Soon
//       4. Category Summary
//       5. Instructions & Definitions
//
//   • Import — accepts the same workbook and returns normalized records:
//       equipment rows are matched by Equipment Code within the target plant
//       (never by name); history rows without a Record ID are appended, rows
//       with a Record ID are audited corrections. History is never deleted.
//
// All dates are stored as ISO strings (YYYY-MM-DD) internally and rendered as
// DD-MM-YYYY on export.
// =============================================================================
import { daysUntil } from './complianceLogic.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const DMY_DATE = /^(\d{2})-(\d{2})-(\d{4})$/;

function fmtDateDMY(value) {
  const iso = String(value || '').slice(0, 10);
  if (!ISO_DATE.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function cellDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    return '';
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const dmy = DMY_DATE.exec(raw);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (ISO_DATE.test(raw)) return raw.slice(0, 10);
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function cellBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'required'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'not required'].includes(s)) return false;
  return fallback;
}

function cellNum(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function cellText(value) {
  if (value === undefined || value === null) return '';
  if (value && typeof value === 'object' && value.text !== undefined) return String(value.text).trim();
  if (value && typeof value === 'object' && value.richText) {
    return value.richText.map((t) => t.text || '').join('').trim();
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function rowObject(row, headers) {
  const obj = {};
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = headers[colNumber];
    if (header) obj[header] = cell.value;
  });
  return obj;
}

function findSheet(wb, ...names) {
  for (const name of names) {
    const ws = wb.getWorksheet(name);
    if (ws) return ws;
  }
  // Fuzzy match, ignoring case and spacing.
  const wanted = names.map((n) => n.toLowerCase().replace(/\s+/g, ''));
  return wb.worksheets.find((ws) => wanted.includes(ws.name.toLowerCase().replace(/\s+/g, ''))) || null;
}

// Equipment Register — required column order per the CCPL compliance spec.
// Supplementary detail columns follow 'Remarks' so maker/serial/spec data is
// preserved in exports and round-trips through import without polluting the
// required layout. Install/Purchase Date are historical equipment fields and
// are NEVER mapped into inspection dates on import.
const EQUIPMENT_HEADERS = [
  'Equipment ID', 'Equipment Code', 'Equipment Name', 'Category', 'Plant', 'Department', 'Area',
  'Actual Inspection/Test Date', 'Certificate Issue Date', 'Inspection Start Date', 'Inspection Expiry Date',
  'Validity Period', 'Next Inspection Due Date', 'Days Remaining', 'Compliance Status', 'Responsible Person', 'Remarks',
  // ── supplementary detail columns ──
  'Category Code', 'Subcategory', 'Equipment Type', 'Section', 'Exact Location', 'Description',
  'Manufacturer', 'Model', 'Serial Number', 'Asset Tag', 'Install Date (Historical)', 'Purchase Date (Historical)',
  'Range', 'Accuracy', 'Capacity', 'Unit', 'SWL / Rated Load', 'Inspection Type', 'Standard / Requirement',
  'Responsible Dept', 'Certificate Required', 'Lifecycle Status', 'Serviceability',
  'Current Certificate No', 'Current Result', 'Expiry Source', 'Corrective Action Pending', 'Linked Machine Cert No',
];

const HISTORY_HEADERS = [
  'Record ID', 'Plant ID', 'Plant Name', 'Equipment Code', 'Equipment Name', 'Inspection Type',
  'Inspection Date', 'Certificate Number', 'Agency / Laboratory', 'Inspector / Competent Person', 'Result',
  'Issue Date', 'Validity Start Date', 'Calculated Expiry Date', 'Expiry Date', 'Expiry Source', 'Expiry Override Reason',
  'Validity (Months)', 'Validity (Days)', 'Next Due Date', 'Next Due Override Reason', 'Observations',
  'Defects', 'Corrective Action', 'Corrective Action Owner', 'Corrective Action Due Date',
  'Corrective Action Closure Date', 'Closure Remarks', 'Document Filename', 'Document Storage Path',
  'Uploaded By', 'Updated By', 'Created At',
];

const ODS_HEADERS = [
  'Plant Name', 'Equipment Code', 'Equipment Name', 'Category', 'Department', 'Area', 'Status', 'Reason',
  'Next Due Date', 'Expiry Date', 'Days Left', 'Certificate No', 'Last Result', 'Last Inspection',
];

const SUMMARY_HEADERS = [
  'Category Code', 'Category Name', 'Total Equipment', 'Valid', 'Due Soon', 'Overdue', 'Failed',
  'Action Required', 'No Certificate', 'Retired', 'Compliance %',
];

const STATUS_FILL = {
  VALID: 'FF064E3B',
  DUE_SOON: 'FF78350F',
  OVERDUE: 'FF7F1D1D',
  FAILED: 'FF7F1D1D',
  ACTION_REQUIRED: 'FF713F12',
  NOT_INSPECTED: 'FF1E293B',
  CERTIFICATE_MISSING: 'FF1E293B',
  UNDER_REPAIR: 'FF312E81',
  RETIRED: 'FF334155',
};

function statusFill(status) {
  return STATUS_FILL[status] || 'FF1E293B';
}

function styleHeaderRow(ws, headers) {
  const header = ws.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
  });
  headers.forEach((_, i) => {
    const col = ws.getColumn(i + 1);
    const longest = Math.max(
      headers[i].length,
      ...ws.getColumn(i + 1).values.slice(1).map((v) => String(v ?? '').length),
    );
    col.width = Math.min(Math.max(longest + 2, 12), 42);
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
}

function dataRows(ws) {
  if (!ws || ws.rowCount < 2) return [];
  const headers = {};
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const h = normalizeHeader(cell.value);
    if (h) headers[colNumber] = h;
  });
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = rowObject(row, headers);
    // Skip fully empty rows.
    if (Object.values(obj).some((v) => cellText(v) !== '')) out.push(obj);
  });
  return out;
}

export async function exportComplianceWorkbook({
  equipment = [],
  historyByEquipment = {},
  plantNameOf = () => '',
  settings = null,
  generatedBy = '',
  mode = 'export',
}) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CCPL Maintenance System';
  wb.lastModifiedBy = generatedBy || 'CCPL Maintenance System';
  wb.created = new Date();

  // ── 1. Equipment Register ──────────────────────────────────────────────────
  const wsEquip = wb.addWorksheet('Equipment Register', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsEquip.addRow(EQUIPMENT_HEADERS);
  equipment.forEach((r) => {
    const expiryISO = r._expiryDate || r.currentExpiryDate || '';
    const daysLeft = expiryISO ? daysUntil(expiryISO) : null;
    wsEquip.addRow([
      // Required columns (spec order)
      r.id || '',
      r.equipmentCode || '',
      r.equipmentName || '',
      r.categoryLabel || r.category || '',
      plantNameOf(r.plant_id || r.plantId),
      r.department || '',
      r.area || '',
      fmtDateDMY(r._lastInspectionDate || r.lastInspectionDate),
      fmtDateDMY(r._issueDate || r.currentIssueDate),
      fmtDateDMY(r._validityStartDate || r.currentValidityStartDate),
      fmtDateDMY(expiryISO),
      r.frequencyMonths || '',
      fmtDateDMY(r._dueDate || r.nextDueDate || r.currentNextDueDate),
      Number.isFinite(daysLeft) ? daysLeft : '',
      r._status || r.status || '',
      r.responsiblePerson || '',
      r.remarks || '',
      // Supplementary detail columns
      r.category || '',
      r.subcategory || '',
      r.equipmentType || '',
      r.section || '',
      r.exactLocation || '',
      r.description || '',
      r.manufacturer || '',
      r.model || '',
      r.serialNumber || '',
      r.assetTag || '',
      fmtDateDMY(r.installDate),
      fmtDateDMY(r.purchaseDate),
      r.rangeValue || '',
      r.accuracy || '',
      r.capacityValue || '',
      r.unit || '',
      r.swl || '',
      r.inspectionType || '',
      r.standard || '',
      r.responsibleDepartment || '',
      r.certificateRequired === false ? 'No' : 'Yes',
      r.lifecycleStatus || 'active',
      r.serviceability || '',
      r.currentCertificateNumber || r._certificateNumber || '',
      r.currentResult || r._lastResult || '',
      r.expirySource || r._expirySource || '',
      r.correctiveActionPending ? 'Yes' : 'No',
      r.linkedMachineCertNumber || '',
    ]).eachCell((cell, col) => {
      if (col === EQUIPMENT_HEADERS.indexOf('Compliance Status') + 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill(r._status) } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9 };
        cell.alignment = { horizontal: 'center' };
      }
    });
  });
  styleHeaderRow(wsEquip, EQUIPMENT_HEADERS);

  // ── 2. Certificate & Inspection History ───────────────────────────────────
  const wsHist = wb.addWorksheet('Inspection History', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsHist.addRow(HISTORY_HEADERS);
  equipment.forEach((eq) => {
    (historyByEquipment[eq.id] || []).forEach((h) => {
      wsHist.addRow([
        h.inspectionRecordId || h.id || '',
        eq.plant_id || eq.plantId || '',
        plantNameOf(eq.plant_id || eq.plantId),
        eq.equipmentCode || '',
        eq.equipmentName || '',
        h.inspectionType || '',
        fmtDateDMY(h.inspectionDate),
        h.certificateNumber || '',
        h.agency || '',
        h.competentPerson || h.inspector || '',
        h.result || '',
        fmtDateDMY(h.issueDate),
        fmtDateDMY(h.validityStartDate),
        fmtDateDMY(h.calculatedExpiryDate),
        fmtDateDMY(h.expiryDate),
        h.expirySource || '',
        h.expiryOverrideReason || '',
        h.validityMonths || '',
        h.validityDays || '',
        fmtDateDMY(h.nextDueDate),
        h.nextDueOverrideReason || '',
        h.observations || '',
        h.defects || '',
        h.correctiveAction || '',
        h.correctiveActionOwner || '',
        fmtDateDMY(h.correctiveActionDueDate),
        fmtDateDMY(h.correctiveActionClosureDate),
        h.closureRemarks || h.closureDetails || '',
        h.document?.filename || h.documentName || '',
        h.document?.storagePath || h.documentPath || '',
        h.uploadedBy || '',
        h.updatedBy || '',
        h.createdAt ? new Date(h.createdAt).toISOString() : '',
      ]);
    });
  });
  styleHeaderRow(wsHist, HISTORY_HEADERS);

  // ── 3. Overdue & Due Soon ──────────────────────────────────────────────────
  const attention = equipment.filter((r) => ['OVERDUE', 'FAILED', 'DUE_SOON', 'ACTION_REQUIRED'].includes(r._status));
  const wsOds = wb.addWorksheet('Overdue & Due Soon', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsOds.addRow(ODS_HEADERS);
  attention.forEach((r) => {
    wsOds.addRow([
      plantNameOf(r.plant_id || r.plantId),
      r.equipmentCode || '',
      r.equipmentName || '',
      r.categoryLabel || r.category || '',
      r.department || '',
      r.area || '',
      r._status || '',
      r._reason || '',
      fmtDateDMY(r._dueDate || r.nextDueDate),
      fmtDateDMY(r._expiryDate || r.currentExpiryDate),
      Number.isFinite(r._daysLeft) ? r._daysLeft : '',
      r._certificateNumber || '',
      r._lastResult || '',
      fmtDateDMY(r._lastInspectionDate),
    ]).eachCell((cell, col) => {
      if (col === ODS_HEADERS.indexOf('Status') + 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill(r._status) } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9 };
      }
    });
  });
  styleHeaderRow(wsOds, ODS_HEADERS);

  // ── 4. Category Summary ───────────────────────────────────────────────────
  const categories = new Map();
  equipment.forEach((r) => {
    const code = r.category || 'other';
    const entry = categories.get(code) || {
      code,
      label: r.categoryLabel || code,
      total: 0, valid: 0, dueSoon: 0, overdue: 0, failed: 0, action: 0, noCert: 0, retired: 0,
    };
    entry.total += 1;
    if (r._status === 'VALID') entry.valid += 1;
    else if (r._status === 'DUE_SOON') entry.dueSoon += 1;
    else if (r._status === 'OVERDUE') entry.overdue += 1;
    else if (r._status === 'FAILED') entry.failed += 1;
    else if (r._status === 'ACTION_REQUIRED') entry.action += 1;
    else if (r._status === 'RETIRED') entry.retired += 1;
    else if (['NOT_INSPECTED', 'CERTIFICATE_MISSING'].includes(r._status)) entry.noCert += 1;
    categories.set(code, entry);
  });
  const wsSum = wb.addWorksheet('Category Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsSum.addRow(SUMMARY_HEADERS);
  [...categories.values()].sort((a, b) => a.code.localeCompare(b.code)).forEach((c) => {
    const active = c.total - c.retired;
    const ok = c.valid;
    wsSum.addRow([
      c.code, c.label, c.total, c.valid, c.dueSoon, c.overdue, c.failed, c.action, c.noCert, c.retired,
      active ? `${Math.round((ok / active) * 1000) / 10}%` : '—',
    ]);
  });
  styleHeaderRow(wsSum, SUMMARY_HEADERS);

  // ── 5. Instructions & Definitions ─────────────────────────────────────────
  const wsInfo = wb.addWorksheet('Instructions & Definitions', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsInfo.addRow(['Topic', 'Detail']);
  const instructions = [
    ['Workbook purpose', mode === 'template' ? 'Import template — fill the Equipment Register and optional History sheets, then import via Inspection & Compliance → Import.' : 'Live export of the plant-scoped compliance register, certificate history and compliance position.'],
    ['Date format', 'All dates are DD-MM-YYYY. Excel date cells are accepted as-is.'],
    ['Inspection Start Date', 'Date from which the current certificate/inspection validity period starts. Left blank for existing records until verified.'],
    ['Inspection Expiry Date', 'Date until which the certificate remains valid. A printed certificate expiry always wins over any calculated date.'],
    ['Expiry calculation', 'Validity Period (months) from the Inspection Start Date → suggested expiry is the day before the start anniversary (start 01-04-2026 + 12 months = valid until 31-03-2027). Month-end and leap-year safe.'],
    ['Days Remaining', 'Inspection Expiry Date − today. Blank when no expiry is recorded (never shown as 0).'],
    ['Install / Purchase Date', 'Historical equipment fields only. They are NOT inspection or validity dates and are never auto-mapped on import.'],
    ['Matching rule', 'Equipment is matched by Equipment Code within the target plant. Names are never used for matching.'],
    ['Adding equipment', 'Leave Equipment ID blank on the Equipment Register sheet. Codes must be unique per plant.'],
    ['Updating equipment', 'Enter the existing Equipment ID or reuse the Equipment Code to update master fields.'],
    ['Appending history', 'Add rows to the Inspection History sheet without a Record ID. Old certificates are never overwritten.'],
    ['Correcting history', 'Reuse the exact Record ID to correct an existing certificate record. Every correction is audit-logged.'],
    ['Failures', 'Result = Fail keeps the item FAILED until a newer passing inspection is recorded. Closure alone does not clear the failure.'],
    ['Expiry source', 'certificate = printed on the certificate; calculated = validity start + period; manual_verified = manually entered & verified override.'],
    ['Next Inspection Due Date', 'Independent of certificate expiry — the next inspection may be required before the certificate expires.'],
    ['Certificate required', 'Yes = item needs a certificate to be VALID. No = inspection due dates still apply but a certificate is not mandatory.'],
    ['Lifecycle status', 'active = in service; retired = decommissioned (history retained); under_repair = compliance cannot be considered valid.'],
    ['Due-soon threshold', `${settings?.dueSoonDays || 30} days (configurable in module settings).`],
    ['Generated', `${new Date().toLocaleString('en-GB')} by ${generatedBy || 'CCPL Maintenance System'}`],
  ];
  instructions.forEach(([topic, detail]) => wsInfo.addRow([topic, detail]));
  styleHeaderRow(wsInfo, ['Topic', 'Detail']);
  wsInfo.getColumn(2).width = 90;

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

export async function downloadComplianceWorkbook(options) {
  const buffer = await exportComplianceWorkbook(options);
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compliance-${options.mode === 'template' ? 'template' : 'export'}-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

// Category labels used in the Equipment Register 'Category' column map back to
// their codes on import; unknown labels become custom 'other' categories.
const CATEGORY_LABEL_TO_CODE = {
  'pressure instruments & gauges': 'pressure',
  'temperature instruments': 'temperature',
  'weighing scales, balances & load cells': 'weighing',
  'pressure vessels & air receivers': 'vessels',
  'safety & relief valves': 'valves',
  'lifting tools, tackles & slings': 'lifting',
  'ppe & safety equipment (harnesses, lanyards)': 'ppe',
  'electrical testing & earthing equipment': 'electrical',
  'other inspection-controlled equipment': 'other',
};

function categoryFromLabel(label) {
  const key = String(label || '').trim().toLowerCase();
  if (!key) return null;
  if (CATEGORY_LABEL_TO_CODE[key]) return { code: CATEGORY_LABEL_TO_CODE[key], custom: '' };
  // Partial match for renamed labels, e.g. "Pressure Gauges".
  for (const [labelKey, code] of Object.entries(CATEGORY_LABEL_TO_CODE)) {
    if (key.includes(labelKey) || labelKey.includes(key)) return { code, custom: '' };
  }
  return { code: 'other', custom: String(label).trim() };
}

// Validity Period cells may be "12", 12 or "12 months".
function parseValidityPeriod(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/months?/i, '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeEquipmentRow(raw) {
  const obj = raw;
  const code = cellText(obj.equipment_code || obj['Equipment Code']);
  if (!code) return { _error: 'Equipment Code is required' };
  const name = cellText(obj.equipment_name || obj['Equipment Name']);
  if (!name) return { _error: 'Equipment Name is required' };
  // Category resolution: explicit code wins; the human-readable 'Category'
  // column (new layout) maps to its builtin code; anything unknown becomes a
  // custom 'other' category. Legacy 'Category Name' behaves the same way.
  const categoryCode = cellText(obj.category_code);
  const categoryLabelRaw = cellText(obj.category !== undefined ? obj.category : obj.category_name);
  const fromLabel = categoryFromLabel(categoryLabelRaw);
  const category = categoryCode || (fromLabel ? fromLabel.code : undefined);
  const customCategory = categoryCode === 'other'
    ? (categoryLabelRaw || '')
    : (fromLabel ? fromLabel.custom : (categoryLabelRaw || ''));
  return {
    recordId: cellText(obj.equipment_id || obj.record_id || obj['Equipment ID'] || obj['Record ID']),
    plantId: cellText(obj.plant_id || obj['Plant ID']),
    plantName: cellText(obj.plant_name || obj['Plant Name'] || obj.plant || obj['Plant']),
    equipmentCode: code,
    equipmentName: name,
    category,
    customCategory,
    subcategory: cellText(obj.subcategory || obj['Subcategory']),
    equipmentType: cellText(obj.equipment_type || obj['Equipment Type']),
    department: cellText(obj.department || obj['Department']),
    section: cellText(obj.section || obj['Section']),
    area: cellText(obj.area || obj['Area']),
    exactLocation: cellText(obj.exact_location || obj['Exact Location']),
    description: cellText(obj.description || obj['Description']),
    manufacturer: cellText(obj.manufacturer || obj['Manufacturer']),
    model: cellText(obj.model || obj['Model']),
    serialNumber: cellText(obj.serial_number || obj['Serial Number']),
    assetTag: cellText(obj.asset_tag || obj['Asset Tag']),
    // Historical equipment dates only — never treated as inspection dates.
    installDate: cellDate(obj.install_date || obj.install_date_historical || obj['Install Date'] || obj['Install Date (Historical)']),
    purchaseDate: cellDate(obj.purchase_date || obj.purchase_date_historical || obj['Purchase Date'] || obj['Purchase Date (Historical)']),
    rangeValue: cellText(obj.range_value || obj['Range']),
    accuracy: cellText(obj.accuracy || obj['Accuracy']),
    capacityValue: cellText(obj.capacity_value || obj['Capacity']),
    unit: cellText(obj.unit || obj['Unit']),
    swl: cellText(obj.swl || obj['SWL / Rated Load']),
    inspectionType: cellText(obj.inspection_type || obj['Inspection Type']),
    standard: cellText(obj.standard || obj['Standard / Requirement']),
    responsibleDepartment: cellText(obj.responsible_dept || obj['Responsible Dept']),
    responsiblePerson: cellText(obj.responsible_person || obj['Responsible Person']),
    frequencyMonths: parseValidityPeriod(obj.frequency_months || obj.validity_period || obj['Frequency (Months)'] || obj['Validity Period']),
    // Inspection & certification validity dates (current certificate).
    currentValidityStartDate: cellDate(obj.current_validity_start_date || obj.inspection_start_date || obj['Inspection Start Date']),
    currentExpiryDate: cellDate(obj.current_expiry_date || obj.inspection_expiry_date || obj['Inspection Expiry Date']),
    currentIssueDate: cellDate(obj.current_issue_date || obj.certificate_issue_date || obj['Certificate Issue Date']),
    lastInspectionDate: cellDate(obj.last_inspection_date || obj.actual_inspection_test_date || obj['Last Inspection Date'] || obj['Actual Inspection/Test Date']),
    nextDueDate: cellDate(obj.next_due_date || obj.next_inspection_due_date || obj['Next Due Date'] || obj['Next Inspection Due Date']),
    expirySource: cellText(obj.expiry_source || obj['Expiry Source']),
    certificateRequired: cellBool(obj.certificate_required || obj['Certificate Required'], true),
    lifecycleStatus: (cellText(obj.lifecycle_status || obj['Lifecycle Status']) || 'active').toLowerCase(),
    serviceability: cellText(obj.serviceability || obj['Serviceability']),
    remarks: cellText(obj.remarks || obj['Remarks']),
    // 'Days Remaining' and 'Compliance Status' are derived — intentionally ignored.
  };
}

function normalizeHistoryRow(raw) {
  const equipmentCode = cellText(raw.equipment_code || raw['Equipment Code']);
  const inspectionDate = cellDate(raw.inspection_date || raw['Inspection Date']);
  const result = cellText(raw.result || raw['Result']);
  if (!equipmentCode) return { _error: 'Equipment Code is required for history rows' };
  if (!inspectionDate) return { _error: `Inspection Date is required for ${equipmentCode}` };
  if (result && !['Pass', 'Conditional Pass', 'Fail'].includes(result)) {
    return { _error: `Invalid result "${result}" for ${equipmentCode}. Use Pass, Conditional Pass or Fail.` };
  }
  return {
    recordId: cellText(raw.record_id || raw['Record ID']),
    equipmentCode,
    plantId: cellText(raw.plant_id || raw['Plant ID']),
    plantName: cellText(raw.plant_name || raw['Plant Name']),
    inspectionType: cellText(raw.inspection_type || raw['Inspection Type']),
    inspectionDate,
    certificateNumber: cellText(raw.certificate_number || raw['Certificate Number']),
    agency: cellText(raw.agency || raw['Agency / Laboratory']),
    competentPerson: cellText(raw.inspector || raw['Inspector / Competent Person']),
    result: result || 'Pass',
    issueDate: cellDate(raw.issue_date || raw['Issue Date']),
    validityStartDate: cellDate(raw.validity_start_date || raw['Validity Start Date']),
    calculatedExpiryDate: cellDate(raw.calculated_expiry_date || raw['Calculated Expiry Date']),
    expiryDate: cellDate(raw.expiry_date || raw['Expiry Date']),
    expirySource: cellText(raw.expiry_source || raw['Expiry Source']),
    expiryOverrideReason: cellText(raw.expiry_override_reason || raw['Expiry Override Reason']),
    validityMonths: cellNum(raw.validity_months || raw['Validity (Months)']),
    validityDays: cellNum(raw.validity_days || raw['Validity (Days)']),
    nextDueDate: cellDate(raw.next_due_date || raw['Next Due Date']),
    nextDueOverrideReason: cellText(raw.next_due_override_reason || raw['Next Due Override Reason']),
    observations: cellText(raw.observations || raw['Observations']),
    defects: cellText(raw.defects || raw['Defects']),
    correctiveAction: cellText(raw.corrective_action || raw['Corrective Action']),
    correctiveActionOwner: cellText(raw.corrective_action_owner || raw['Corrective Action Owner']),
    correctiveActionDueDate: cellDate(raw.corrective_action_due_date || raw['Corrective Action Due Date']),
    correctiveActionClosureDate: cellDate(raw.corrective_action_closure_date || raw['Corrective Action Closure Date']),
    closureRemarks: cellText(raw.closure_remarks || raw['Closure Remarks']),
    documentFilename: cellText(raw.document_filename || raw['Document Filename']),
    documentStoragePath: cellText(raw.document_storage_path || raw['Document Storage Path']),
    uploadedBy: cellText(raw.uploaded_by || raw['Uploaded By']),
  };
}

export async function parseComplianceWorkbook(data) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const errors = [];
  const warnings = [];
  const equipment = [];
  const inspections = [];

  const wsEquip = findSheet(wb, 'Equipment Register', 'equipment register');
  const wsHist = findSheet(wb, 'Inspection History', 'Certificate & Inspection History', 'history');
  if (!wsEquip && !wsHist) {
    errors.push('Workbook must contain an "Equipment Register" or "Certificate & Inspection History" sheet.');
    return { equipment, inspections, errors, warnings };
  }

  if (wsEquip) {
    dataRows(wsEquip).forEach((raw, i) => {
      const row = normalizeEquipmentRow(raw);
      if (row._error) errors.push(`Equipment Register row ${i + 2}: ${row._error}`);
      else equipment.push(row);
    });
  }
  if (wsHist) {
    dataRows(wsHist).forEach((raw, i) => {
      const row = normalizeHistoryRow(raw);
      if (row._error) errors.push(`History row ${i + 2}: ${row._error}`);
      else inspections.push(row);
    });
  }
  return { equipment, inspections, errors, warnings };
}

export default {
  exportComplianceWorkbook,
  downloadComplianceWorkbook,
  parseComplianceWorkbook,
};
