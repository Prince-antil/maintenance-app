// Smoke test: Excel export → parse round-trip with the corrected column layout.
/* eslint-disable no-console */
import {
  exportComplianceWorkbook, parseComplianceWorkbook,
} from '../client/src/lib/complianceExcel.js';

let pass = 0; let fail = 0;
const ok = (cond, name) => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ FAIL: ${name}`); } };

const equipment = [{
  id: 'ceq-1', plant_id: '00000000-0000-0000-0000-000000000001', equipmentCode: 'PG-NAT-001',
  equipmentName: 'Pressure Gauge', category: 'pressure', categoryLabel: 'Pressure Instruments & Gauges',
  department: 'Production', area: 'Line 1', section: '', exactLocation: '', description: '',
  manufacturer: 'Wika', model: '111.10', serialNumber: 'SN-9', assetTag: 'T-1',
  installDate: '2024-05-10', purchaseDate: '2024-05-01', rangeValue: '0-16', accuracy: '±1%',
  capacityValue: '', unit: 'bar', swl: '', inspectionType: 'Calibration', standard: 'IS',
  responsibleDepartment: 'QA', responsiblePerson: 'Ravi', frequencyMonths: 12,
  currentValidityStartDate: '2026-04-01', currentExpiryDate: '2027-03-31',
  currentIssueDate: '2026-03-28', lastInspectionDate: '2026-03-25', nextDueDate: '2027-03-25',
  currentCertificateNumber: 'CERT-77', currentResult: 'Pass', expirySource: 'certificate',
  lifecycleStatus: 'active', certificateRequired: true, serviceability: 'Serviceable',
  remarks: 'ok', correctiveActionPending: false, _status: 'VALID', _daysLeft: 137,
}];
const historyByEquipment = {
  'ceq-1': [{
    id: 'cin-1', inspectionRecordId: 'cin-1', inspectionType: 'Calibration', inspectionDate: '2026-03-25',
    certificateNumber: 'CERT-77', agency: 'ABC Labs', competentPerson: 'Ravi', result: 'Pass',
    issueDate: '2026-03-28', validityStartDate: '2026-04-01', expiryDate: '2027-03-31',
    expirySource: 'certificate', validityMonths: 12, nextDueDate: '2027-03-25',
    uploadedBy: 'Admin', createdAt: '2026-03-25T10:00:00.000Z',
  }],
};

console.log('— Export with spec column layout —');
const buffer = await exportComplianceWorkbook({ equipment, historyByEquipment, plantNameOf: () => 'Nathupur', generatedBy: 'Test' });
ok(buffer && buffer.length > 0, 'workbook buffer generated');

console.log('— Parse round-trip —');
const parsed = await parseComplianceWorkbook(buffer);
ok(parsed.errors.length === 0, `no parse errors (${parsed.errors.join(' | ')})`);
ok(parsed.equipment.length === 1, 'one equipment row parsed');
ok(parsed.inspections.length === 1, 'one history row parsed');
const eq = parsed.equipment[0];
ok(eq.recordId === 'ceq-1', "Record ID read from 'Equipment ID' column");
ok(eq.currentValidityStartDate === '2026-04-01', 'Inspection Start Date parsed');
ok(eq.currentExpiryDate === '2027-03-31', 'Inspection Expiry Date parsed');
ok(eq.currentIssueDate === '2026-03-28', 'Certificate Issue Date parsed');
ok(eq.lastInspectionDate === '2026-03-25', 'Actual Inspection/Test Date parsed');
ok(eq.nextDueDate === '2027-03-25', 'Next Inspection Due Date parsed');
ok(eq.frequencyMonths === 12, 'Validity Period parsed as months');
ok(eq.installDate === '2024-05-10' && eq.purchaseDate === '2024-05-01', 'Install/Purchase dates stay historical fields');
ok(eq.category === 'pressure' && !eq.customCategory, "Category label maps back to 'pressure' code");
ok(eq.responsiblePerson === 'Ravi' && eq.remarks === 'ok', 'Responsible Person + Remarks round-trip');
const h = parsed.inspections[0];
ok(h.validityStartDate === '2026-04-01', 'history Validity Start Date preserved');
ok(h.expiryDate === '2027-03-31' && h.issueDate === '2026-03-28' && h.inspectionDate === '2026-03-25', 'history separate dates preserved');
ok(h.nextDueDate === '2027-03-25', 'history next due preserved');

console.log('— Template mode (blank) parses cleanly —');
const tpl = await exportComplianceWorkbook({ equipment: [], historyByEquipment: {}, plantNameOf: () => '', mode: 'template' });
const tplParsed = await parseComplianceWorkbook(tpl);
ok(tplParsed.errors.length === 0 && tplParsed.equipment.length === 0, 'blank template has no rows and no errors');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
