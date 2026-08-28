import React from 'react';
import { formatEnergy } from '../../lib/energyCalculations.js';

export const SolarPerformanceCard = ({ metrics }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-white mb-1">Solar Performance</h3>
      <p className="text-xs text-slate-400 mb-6">Inverter total vs meter-side import & export</p>
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* INVERTER TOTAL */}
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-4 text-center">
          <div className="text-xs text-slate-400 font-medium mb-1 uppercase tracking-wider">Inverter Total</div>
          <div className="text-2xl font-bold text-emerald-400">
            {formatEnergy(metrics.inverterTotalKwh)}
          </div>
          <div className="text-xs text-emerald-500/80 mt-1">kWh</div>
        </div>
        {/* METER IMPORT */}
        <div className="bg-sky-950/30 border border-sky-800/40 rounded-lg p-4 text-center">
          <div className="text-xs text-slate-400 font-medium mb-1 uppercase tracking-wider">Meter Import</div>
          <div className="text-2xl font-bold text-sky-400">
            {formatEnergy(metrics.meterImportKwh)}
          </div>
          <div className="text-xs text-sky-500/80 mt-1">kWh</div>
        </div>
        {/* METER EXPORT */}
        <div className="bg-purple-950/30 border border-purple-800/40 rounded-lg p-4 text-center">
          <div className="text-xs text-slate-400 font-medium mb-1 uppercase tracking-wider">Meter Export</div>
          <div className="text-2xl font-bold text-purple-400">
            {formatEnergy(metrics.meterExportKwh)}
          </div>
          <div className="text-xs text-purple-500/80 mt-1">kWh</div>
        </div>
      </div>
      <div className="text-center text-xs text-amber-400 font-medium">
        Cross-check deviation: {metrics.crossCheckDeviationPct}%
      </div>
    </div>
  );
};

export default SolarPerformanceCard;