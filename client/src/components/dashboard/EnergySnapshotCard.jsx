// =============================================================================
// File: client/src/components/dashboard/EnergySnapshotCard.jsx
// (100% Standalone - Zero External Component or Math Imports)
// =============================================================================
import React from 'react';
// Pure local helper to avoid bundle evaluation loops
const safeFormat = (val, decimals = 1) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  const num = Number(val);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
};
export const EnergySnapshotCard = ({ snapshotMetrics = {} }) => {
  const m = snapshotMetrics;
  const u1Grid = safeFormat(m.unit1GridKwh);
  const u2Grid = safeFormat(m.unit2GridKwh);
  const totalGrid = safeFormat(m.totalGridKwh);
  const dg500 = safeFormat(m.dg500Kwh);
  const dg380 = safeFormat(m.dg380Kwh);
  const solar = safeFormat(m.solarKwh);
  const fuel = safeFormat(m.totalFuelLtrs, 0);
  const u1Pct = m.u1Pct ?? 50;
  const u2Pct = m.u2Pct ?? 50;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm text-slate-100">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-amber-400 text-lg">⚡</span>
        <h3 className="text-lg font-semibold text-white">Energy Snapshot — Active Period</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* UNIT 1 GRID */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Unit 1 Grid</div>
          <div className="text-2xl font-bold text-white">{u1Grid}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* UNIT 2 GRID */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Unit 2 Grid</div>
          <div className="text-2xl font-bold text-white">{u2Grid}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* TOTAL GRID */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Total Grid</div>
          <div className="text-2xl font-bold text-white">{totalGrid}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* DG 500 */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">DG 500</div>
          <div className="text-2xl font-bold text-amber-400">{dg500}</div>
          <div className="text-xs text-slate-500 mt-1">kWh · {m.dg500Hours || 0} hrs</div>
        </div>
        {/* DG 380 */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">DG 380</div>
          <div className="text-2xl font-bold text-amber-400">{dg380}</div>
          <div className="text-xs text-slate-500 mt-1">kWh · {m.dg380Hours || 0} hrs</div>
        </div>
        {/* SOLAR */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Solar</div>
          <div className="text-2xl font-bold text-emerald-400">{solar}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* FUEL */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Fuel</div>
          <div className="text-2xl font-bold text-rose-400">{fuel}</div>
          <div className="text-xs text-slate-500 mt-1">Ltrs</div>
        </div>
        {/* POWER FACTOR */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Power Factor</div>
          <div className="text-2xl font-bold text-cyan-400">{m.overallPf || '0.96'}</div>
          <div className="text-xs text-slate-500 mt-1">U1 {m.avgU1Pf || '0.95'} · U2 {m.avgU2Pf || '0.99'}</div>
        </div>
      </div>
      {/* GRID SPLIT */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>Grid split:</span>
          <span>U1 {u1Pct}% · U2 {u2Pct}%</span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-2 flex overflow-hidden">
          <div className="bg-cyan-400 h-full transition-all duration-500" style={{ width: `${u1Pct}%` }} />
          <div className="bg-purple-500 h-full transition-all duration-500" style={{ width: `${u2Pct}%` }} />
        </div>
      </div>
    </div>
  );
};
export default EnergySnapshotCard;
