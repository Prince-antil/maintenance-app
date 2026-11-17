#!/usr/bin/env node
// Dashboard calculation tests — verifies the P0/P1 calculation fixes.
// analytics.js and energyEngine.js are pure modules (no browser imports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => import(pathToFileURL(path.join(root, p)).href);
const analytics = await mod('client/src/analytics.js');
const energyEngine = await mod('client/src/lib/energyEngine.js');
const bulkImport = await mod('client/src/bulkImport.js');

const {
  computeAvailability, computeMTBF, computeKPIs, computePfTrend,
  computeDailyDeltas, aggregateBreakdownRecords,
} = analytics;
const { computeEnergySnapshot } = energyEngine;
const { parseKpiCell } = bulkImport;

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
};

const HOURS_PER_MONTH = 720;

console.log('— Availability (P1-8) —');
ok('zero machines → null (never fake 100%)', computeAvailability([], 0) === null);
ok('no rows → null', computeAvailability([], 5) === null);
ok('single month: 10 machines, 720h downtime → 90%', computeAvailability(
  [{ section: 'S', period: '2026-11', downtimeHours: 720, breakdownCount: 2 }], 10, '2026-11') === 90);
ok('"all" span scales planned hours by months of data', Math.abs(
  computeAvailability(
    [
      { section: 'S', period: '2026-10', downtimeHours: 20, breakdownCount: 1 },
      { section: 'S', period: '2026-11', downtimeHours: 20, breakdownCount: 1 },
    ], 20, null) - 99.9) < 0.1);

console.log('— MTBF fallback (P1-7) —');
const withFallback = computeMTBF(
  [{ section: 'S', period: '2026-11', downtimeHours: 10, breakdownCount: 3, operatingHours: 0 }],
  20, '2026-11');
ok('missing operatingHours → fallback (machineCount×720 − downtime)/count', Math.abs(withFallback - 4796.7) < 0.1);

console.log('— KPIs exclude archived machines (P1-5) —');
const kpi = computeKPIs({
  machines: [
    { id: 'm1', name: 'Active 1', status: 'running', archived: false, docs: [] },
    { id: 'm2', name: 'Active 2', status: 'breakdown', archived: false, docs: [] },
    { id: 'm3', name: 'Archived', status: 'running', archived: true, docs: [{ id: 'd1' }] },
  ],
  breakdowns: [],
  pms: [],
  machinePmRecords: [],
}, 0, 'all');
ok('machineCount excludes archived', kpi.machineCount === 2);
ok('breakdown count excludes archived (no breakdowns)', kpi.breakdown === 0);
ok('totalDocuments excludes archived machine docs', kpi.totalDocuments === 0);

console.log('— PF trend window (P1-1) —');
const deltas = [];
for (let i = 0; i < 25; i++) {
  const day = String(i + 1).padStart(2, '0');
  deltas.push({ date: `2026-10-${day}`, _delta: { u1ImportKwhReading: 100 + i, u1ImportKvahReading: 110 + i, u1Pf: 0.9 } });
}
const trend = computePfTrend(deltas, 12, 'all');
ok('returns exactly n points', trend.length === 12);
ok('newest-first window → points are the 12 most recent days', trend[0].date === '2026-10-14' && trend[11].date === '2026-10-25');
ok('axis runs ascending (oldest→newest)', trend[0].date < trend[11].date);

console.log('— Energy snapshot delta sums (P0-1/P0-2) —');
const snapshot = computeEnergySnapshot([
  { date: '2026-11-01', u1ImportKwhReading: 4200, u1ImportKvahReading: 4500, u2ImportKwhReading: 1800 },
  { date: '2026-11-02', u1ImportKwhReading: 4300, u1ImportKvahReading: 4600, u2ImportKwhReading: 1900 },
  { date: '2026-11-03', u1ImportKwhReading: 4450, u1ImportKvahReading: 4750, u2ImportKwhReading: 2000 },
], []);
ok('U1 grid = sum of daily deltas (4450−4200=250)', snapshot.unit1GridKwh === 250);
ok('U2 grid = sum of daily deltas (2000−1800=200)', snapshot.unit2GridKwh === 200);
ok('totalGrid = 450', snapshot.totalGridKwh === 450);

console.log('— KPI cell parsing —');
ok("'NA' → null (not zero)", parseKpiCell('NA') === null);
ok("'n/a' → null", parseKpiCell('n/a') === null);
ok("'—' → null", parseKpiCell('—') === null);
ok("'-' → null", parseKpiCell('-') === null);
ok("'' → null", parseKpiCell('') === null);
ok("'90.5' → 90.5", parseKpiCell('90.5') === 90.5);
ok("'>=95' → 95", parseKpiCell('>=95') === 95);

console.log('— Monthly delta calculator —');
const dd = computeDailyDeltas([
  { date: '2026-11-03', u1ImportKwhReading: 4450 },
  { date: '2026-11-01', u1ImportKwhReading: 4200 },
  { date: '2026-11-02', u1ImportKwhReading: 4300 },
]);
ok('sorted descending', dd[0].date === '2026-11-03' && dd[1].date === '2026-11-02');
ok('first row delta null (no previous)', dd[2]._delta.u1ImportKwhReading === null);
ok('delta 100 then 150 per day (descending)', dd[0]._delta.u1ImportKwhReading === 150 && dd[1]._delta.u1ImportKwhReading === 100);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
