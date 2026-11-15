// Smoke test: inspection validity dates correction (spec §3, §4, §10).
/* eslint-disable no-console */
import {
  computeExpiry, suggestExpiryFromStart, daysRemainingLabel, daysUntil,
  deriveCompliance, getComplianceStatus, formatDateDMY, addMonths, todayISO,
} from '../client/src/lib/complianceLogic.js';

let pass = 0; let fail = 0;
const ok = (cond, name) => { if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ FAIL: ${name}`); } };

console.log('— Start-based expiry convention (spec example) —');
ok(suggestExpiryFromStart('2026-04-01', 12) === '2027-03-31', 'start 01/04/2026 + 12 months → 31/03/2027');
ok(suggestExpiryFromStart('2026-01-31', 1) === '2026-02-27', 'month-end clamp: 31/01/2026 + 1 month → 27/02/2026 (28/02 minus 1 day)');
ok(suggestExpiryFromStart('2024-02-29', 12) === '2025-02-27', 'leap-year clamp: 29/02/2024 + 12 months → 27/02/2025');
ok(suggestExpiryFromStart('2026-04-01', 12, 10) === '2027-04-10', 'start + 12 months + 10 days → 10/04/2027');
ok(suggestExpiryFromStart('', 12) === '', 'blank start → blank suggestion');

console.log('— computeExpiry —');
let c = computeExpiry({ startDate: '2026-04-01', validityMonths: 12, manualExpiryDate: '', expirySource: '' });
ok(c.calculatedExpiry === '2027-03-31' && c.effectiveExpiry === '2027-03-31' && c.source === 'calculated', 'start-based calculated + source calculated');
c = computeExpiry({ startDate: '2026-04-01', validityMonths: 12, manualExpiryDate: '2027-06-30', expirySource: 'certificate' });
ok(c.effectiveExpiry === '2027-06-30' && c.source === 'certificate', 'printed certificate expiry wins');
ok(c.differs === true && c.differenceDays === 91, 'manual vs calculated difference detected (91 days)');
c = computeExpiry({ issueDate: '2026-04-01', validityMonths: 12, manualExpiryDate: '', expirySource: '' });
ok(c.calculatedExpiry === '2027-04-01', 'legacy issue-based convention unchanged (01/04/2027)');
c = computeExpiry({ startDate: '2026-04-01', manualExpiryDate: '', expirySource: '' });
ok(c.calculatedExpiry === '', 'no validity period → no calculated expiry');

console.log('— Days remaining read-out (spec §3 examples) —');
const today = todayISO();
const d20 = addDaysISO(today, 20); const d1 = addDaysISO(today, 1); const dm1 = addDaysISO(today, -1);
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
ok(daysRemainingLabel(d20, today).text === '20 days remaining' && daysRemainingLabel(d20, today).days === 20, '20 days away → "20 days remaining"');
ok(daysRemainingLabel(today, today).text === 'Expires Today', 'expiry today → "Expires Today"');
ok(daysRemainingLabel(dm1, today).text === '1 day overdue', 'yesterday → "1 day overdue"');
ok(daysRemainingLabel('', today).text === 'No Expiry Date' && daysRemainingLabel('', today).days === null, 'no expiry → "No Expiry Date", not zero');

console.log('— Status engine (spec §4) —');
const mk = (over = {}) => ({ id: 'e1', equipmentCode: 'PG-1', equipmentName: 'Gauge', category: 'pressure', lifecycleStatus: 'active', plant_id: 'p1', ...over });
let st = getComplianceStatus(mk({ currentExpiryDate: addDaysISO(today, -5), currentNextDueDate: addDaysISO(today, 90) }), null, 30, today);
ok(st.status === 'EXPIRED', 'expired certificate → EXPIRED');
st = getComplianceStatus(mk({ currentExpiryDate: addDaysISO(today, 200), currentNextDueDate: addDaysISO(today, -3) }), null, 30, today);
ok(st.status === 'OVERDUE', 'next due passed while certificate valid → OVERDUE (independent dates)');
st = getComplianceStatus(mk({ currentExpiryDate: d20 }), { result: 'Fail', inspectionDate: addDaysISO(today, -10), defects: 'x' }, 30, today);
ok(st.status === 'FAILED', 'failed inspection with future expiry → FAILED (never appears valid)');

console.log('— deriveCompliance validity start —');
const derived = deriveCompliance(
  mk({ currentValidityStartDate: '2026-04-01', currentExpiryDate: '2027-03-31', currentNextDueDate: '2026-10-01' }),
  [{ id: 'i1', equipmentId: 'e1', inspectionDate: '2026-04-01', result: 'Pass', validityStartDate: '2026-04-01', expiryDate: '2027-03-31', nextDueDate: '2026-10-01' }],
  { today },
);
ok(derived._validityStartDate === '2026-04-01', 'derived validity start from latest inspection');
ok(derived._expiryDate === '2027-03-31' && derived._dueDate === '2026-10-01', 'expiry + next due preserved and independent');
const derivedManual = deriveCompliance(mk({ currentValidityStartDate: '2026-04-01', currentExpiryDate: '2027-03-31' }), [], { today });
ok(derivedManual._validityStartDate === '2026-04-01', 'manual equipment-level validity start survives with empty history');
ok(formatDateDMY('2026-04-01') === '01-04-2026', 'DD-MM-YYYY display format');

console.log('— daysUntil sanity —');
ok(daysUntil('2026-04-01', '2026-04-01') === 0 && daysUntil('2026-04-02', '2026-04-01') === 1, 'daysUntil UTC-day arithmetic');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
