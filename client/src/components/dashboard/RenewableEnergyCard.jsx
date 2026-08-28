import React from 'react';
import { formatEnergy } from '../../lib/energyCalculations.js';

export const RenewableEnergyCard = ({ metrics }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-white mb-1">Renewable Energy & CO₂ Avoided</h3>
      <p className="text-xs text-slate-400 mb-6">This month's sustainability metrics</p>
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* SOLAR GENERATION */}
        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Solar Generation</div>
          <div className="text-3xl font-bold text-emerald-400">
            {formatEnergy(metrics.inverterTotalKwh)}
          </div>
          <div className="text-xs text-emerald-500 mt-1">kWh</div>
        </div>
        {/* RENEWABLE SHARE */}
        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Renewable Share</div>
          <div className="text-3xl font-bold text-cyan-400">
            {metrics.renewableSharePct}%
          </div>
          <div className="text-xs text-cyan-500 mt-1">of total consumption</div>
        </div>
        {/* CO2 AVOIDED */}
        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">CO₂ Avoided</div>
          <div className="text-3xl font-bold text-teal-400">
            {formatEnergy(metrics.co2AvoidedKg, 0)}
          </div>
          <div className="text-xs text-teal-500 mt-1">kg</div>
        </div>
        {/* PERFORMANCE RATIO / DEVIATION */}
        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Performance Ratio</div>
          <div className="text-3xl font-bold text-yellow-400">
            {metrics.isCrossCheckRequired ? 'Check' : 'Optimal'}
          </div>
          <div className="text-xs text-yellow-500 mt-1">
            {metrics.isCrossCheckRequired ? 'Meter discrepancy detected' : 'Within normal limits'}
          </div>
        </div>
      </div>
      {metrics.isCrossCheckRequired && (
        <div className="flex items-center justify-center gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg py-2 px-3">
          <span>⚠️ Solar Metering Cross-Check Required</span>
        </div>
      )}
    </div>
  );
};

export default RenewableEnergyCard;