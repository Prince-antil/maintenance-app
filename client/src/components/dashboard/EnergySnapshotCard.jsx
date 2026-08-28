import React from 'react';
import { formatEnergy } from '../../lib/energyCalculations.js';

export const EnergySnapshotCard = ({ snapshotMetrics = {}, isLoading = false }) => {
  const m = snapshotMetrics;
  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm animate-pulse">
        <div className="flex items-center gap-2 mb-6">
          <span className="text-amber-400 text-lg">⚡</span>
          <h3 className="text-lg font-semibold text-white">Energy Snapshot — Active Period</h3>
          <span className="ml-auto text-xs text-slate-500">Loading...</span>
        </div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-amber-400 text-lg">⚡</span>
        <h3 className="text-lg font-semibold text-white">Energy Snapshot — Active Period</h3>
      </div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* UNIT 1 GRID */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Unit 1 Grid</div>
          <div className="text-2xl font-bold text-white">{formatEnergy(m.unit1GridKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* UNIT 2 GRID */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Unit 2 Grid</div>
          <div className="text-2xl font-bold text-white">{formatEnergy(m.unit2GridKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* TOTAL GRID */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Total Grid</div>
          <div className="text-2xl font-bold text-white">{formatEnergy(m.totalGridKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* DG 500 */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">DG 500</div>
          <div className="text-2xl font-bold text-amber-400">{formatEnergy(m.dg500Kwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh · {m.dg500Hours || 0} hrs</div>
        </div>
        {/* DG 380 */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">DG 380</div>
          <div className="text-2xl font-bold text-amber-400">{formatEnergy(m.dg380Kwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh · {m.dg380Hours || 0} hrs</div>
        </div>
        {/* SOLAR */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Solar</div>
          <div className="text-2xl font-bold text-emerald-400">{formatEnergy(m.solarKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        {/* FUEL */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Fuel</div>
          <div className="text-2xl font-bold text-rose-400">{formatEnergy(m.totalFuelLtrs, 0)}</div>
          <div className="text-xs text-slate-500 mt-1">Ltrs</div>
        </div>
        {/* POWER FACTOR */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Power Factor</div>
          <div className="text-2xl font-bold text-cyan-400">{m.overallPf || '0.96'}</div>
          <div className="text-xs text-slate-500 mt-1">U1 {m.avgU1Pf} · U2 {m.avgU2Pf}</div>
        </div>
      </div>
      {/* GRID SPLIT BAR */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>Grid split:</span>
          <span>U1 {m.u1Pct}% · U2 {m.u2Pct}%</span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-2 flex overflow-hidden">
          <div className="bg-cyan-400 h-full transition-all duration-500" style={{ width: `${m.u1Pct}%` }} />
          <div className="bg-purple-500 h-full transition-all duration-500" style={{ width: `${m.u2Pct}%` }} />
        </div>
      </div>
    </div>
  );
};

export default EnergySnapshotCard;