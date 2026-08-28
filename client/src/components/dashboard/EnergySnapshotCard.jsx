// =============================================================================
// File: components/dashboard/EnergySnapshotCard.jsx
// =============================================================================
import React from 'react';
import { formatEnergy } from '../../lib/energyEngine.js';

export const EnergySnapshotCard = ({ snapshotMetrics = {} }) => {
  const m = snapshotMetrics;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-amber-400 text-lg">⚡</span>
        <h3 className="text-lg font-semibold text-white">Energy Snapshot — Active Period</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Unit 1 Grid</div>
          <div className="text-2xl font-bold text-white">{formatEnergy(m.unit1GridKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Unit 2 Grid</div>
          <div className="text-2xl font-bold text-white">{formatEnergy(m.unit2GridKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Total Grid</div>
          <div className="text-2xl font-bold text-white">{formatEnergy(m.totalGridKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">DG 500</div>
          <div className="text-2xl font-bold text-amber-400">{formatEnergy(m.dg500Kwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh · {m.dg500Hours || 0} hrs</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">DG 380</div>
          <div className="text-2xl font-bold text-amber-400">{formatEnergy(m.dg380Kwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh · {m.dg380Hours || 0} hrs</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Solar</div>
          <div className="text-2xl font-bold text-emerald-400">{formatEnergy(m.solarKwh)}</div>
          <div className="text-xs text-slate-500 mt-1">kWh</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Fuel</div>
          <div className="text-2xl font-bold text-rose-400">{formatEnergy(m.totalFuelLtrs, 0)}</div>
          <div className="text-xs text-slate-500 mt-1">Ltrs</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Power Factor</div>
          <div className="text-2xl font-bold text-cyan-400">{m.overallPf || '0.96'}</div>
          <div className="text-xs text-slate-500 mt-1">U1 {m.avgU1Pf || '0.95'} · U2 {m.avgU2Pf || '0.99'}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>Grid split:</span>
          <span>U1 {m.u1Pct ?? 50}% · U2 {m.u2Pct ?? 50}%</span>
        </div>
        <div className="w-full bg-slate-950 rounded-full h-2 flex overflow-hidden">
          <div className="bg-cyan-400 h-full transition-all duration-500" style={{ width: `${m.u1Pct ?? 50}%` }} />
          <div className="bg-purple-500 h-full transition-all duration-500" style={{ width: `${m.u2Pct ?? 50}%` }} />
        </div>
      </div>
    </div>
  );
};

export default EnergySnapshotCard;
