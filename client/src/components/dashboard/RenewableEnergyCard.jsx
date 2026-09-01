import React, { useState } from 'react';
import { formatEnergy } from '../../lib/energyCalculations.js';

export const RenewableEnergyCard = ({ metrics = {} }) => {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm relative">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1">Renewable Energy & CO₂ Avoided</h3>
          <p className="text-xs text-slate-400">This month's sustainability metrics</p>
        </div>

        {/* Explore Formula Button */}
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-400 bg-cyan-950/40 border border-cyan-800/50 rounded-lg hover:bg-cyan-900/50 transition-all"
        >
          <span>🔍 Explore Formulas</span>
        </button>
      </div>

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
            {metrics.renewableSharePct ?? 0}%
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
        <div className="flex items-center justify-center gap-2 text-xs text-amber-400 bg-amber-950/30 border border-amber-800/40 rounded-lg py-2.5 px-3">
          <span>⚠️ Solar Metering Cross-Check Required</span>
        </div>
      )}

      {/* EXPLORE FORMULAS & DIAGNOSTICS MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 text-slate-200 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
              <h4 className="text-lg font-bold text-white flex items-center gap-2">
                ⚡ Formula & Diagnostic Breakdown
              </h4>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-xl font-bold px-2"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6 mt-4">
              {/* CURRENT INPUT DATA SUMMARY */}
              <div>
                <h5 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2">1. Current Live Inputs</h5>
                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div> • Solar Inverter Total: <b className="text-white">{metrics.inverterTotalKwh} kWh</b></div>
                  <div> • Unit 1 Import: <b className="text-white">{metrics.totalU1Import} kWh</b></div>
                  <div> • Unit 2 Import: <b className="text-white">{metrics.totalU2Import} kWh</b></div>
                  <div> • Unit 1 Export: <b className="text-white">{metrics.totalU1Export} kWh</b></div>
                  <div> • Unit 2 Export: <b className="text-white">{metrics.totalU2Export} kWh</b></div>
                  <div> • Total Meter Import: <b className="text-white">{metrics.meterImportKwh} kWh</b></div>
                  <div> • Total Meter Export: <b className="text-white">{metrics.meterExportKwh} kWh</b></div>
                  <div> • DG Generation: <b className="text-white">{metrics.totalDg} kWh</b></div>
                </div>
              </div>

              {/* FORMULAS EXPLAINED */}
              <div>
                <h5 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2">2. Formulas & Active Calculations</h5>
                <div className="space-y-2 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div>
                    <span className="text-slate-400">Total Plant Consumption:</span>
                    <p className="text-slate-300 font-mono mt-0.5">(Meter Import - Meter Export) + Solar Generation + DG</p>
                    <p className="text-emerald-400 font-mono">({metrics.meterImportKwh} - {metrics.meterExportKwh}) + {metrics.inverterTotalKwh} + {metrics.totalDg} = {metrics.totalPlantConsumptionKwh} kWh</p>
                  </div>
                  <hr className="border-slate-800 my-2" />
                  <div>
                    <span className="text-slate-400">Renewable Share (%):</span>
                    <p className="text-slate-300 font-mono mt-0.5">(Solar Generation / Total Plant Consumption) * 100</p>
                    <p className="text-cyan-400 font-mono">({metrics.inverterTotalKwh} / {metrics.totalPlantConsumptionKwh}) * 100 = {metrics.renewableSharePct}%</p>
                  </div>
                  <hr className="border-slate-800 my-2" />
                  <div>
                    <span className="text-slate-400">CO₂ Avoided (kg):</span>
                    <p className="text-slate-300 font-mono mt-0.5">Solar Generation * 0.82 kg CO₂/kWh (CEA Factor)</p>
                    <p className="text-teal-400 font-mono">{metrics.inverterTotalKwh} * 0.82 = {metrics.co2AvoidedKg} kg</p>
                  </div>
                  <hr className="border-slate-800 my-2" />
                  <div>
                    <span className="text-slate-400">Cross-Check Deviation (%):</span>
                    <p className="text-slate-300 font-mono mt-0.5">|Inverter Total - Utility Solar Meter| / Inverter Total * 100</p>
                    <p className="text-amber-400 font-mono">|{metrics.inverterTotalKwh} - {metrics.totalUtilitySolar}| / {metrics.inverterTotalKwh} * 100 = {metrics.crossCheckDeviationPct}%</p>
                  </div>
                </div>
              </div>

              {/* ACTIVE ALERTS & ERRORS */}
              <div>
                <h5 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">3. Diagnostic Status & Alerts</h5>
                <div className="text-xs bg-amber-950/20 border border-amber-800/40 p-3 rounded-lg text-amber-300 space-y-1">
                  {metrics.meterImportKwh === 0 && (
                    <p> • <b>Meter Import is 0:</b> Verify that Utility Energy Log records exist for Unit 1 and Unit 2 for the active date range.</p>
                  )}
                  {metrics.crossCheckDeviationPct > 5 && (
                    <p> • <b>Cross-Check Deviation ({metrics.crossCheckDeviationPct}%):</b> Discrepancy between solar inverter generation ({metrics.inverterTotalKwh} kWh) and utility solar meter ({metrics.totalUtilitySolar} kWh) exceeds the 5% tolerance threshold.
                    </p>
                  )}
                  {metrics.meterImportKwh > 0 && metrics.crossCheckDeviationPct <= 5 && (
                    <p className="text-emerald-400"> • <b>All Systems Operational:</b> Meter import readings and inverter readings cross-check successfully.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default RenewableEnergyCard;