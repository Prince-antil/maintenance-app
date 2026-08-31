// =============================================================================
// File: client/src/components/dashboard/EnergySnapshotCard.jsx
// (100% Standalone - Zero External Component or Math Imports)
// =============================================================================
import React, { useState } from 'react';
// Pure local helper to avoid bundle evaluation loops
const safeFormat = (val, decimals = 1) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  const num = Number(val);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
};
export const EnergySnapshotCard = ({ snapshotMetrics = {}, solarSpecific = null, onSolarCapacitySave }) => {
  const [showPfModal, setShowPfModal] = useState(false);
  const [showSolarModal, setShowSolarModal] = useState(false);
  const [editSolarCapacity, setEditSolarCapacity] = useState('');
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
  // Fully dynamic PF — no hardcoded fallbacks, show 0.00 when no data
  const overallPf = m.overallPf != null && m.overallPf !== '' ? String(m.overallPf) : '0.00';
  const avgU1Pf = m.avgU1Pf != null && m.avgU1Pf !== '' ? String(m.avgU1Pf) : '0.00';
  const avgU2Pf = m.avgU2Pf != null && m.avgU2Pf !== '' ? String(m.avgU2Pf) : '0.00';
  const hasPfData = m.totalKwh > 0 || m.totalKvah > 0 || m.u1Kwh > 0 || m.u1Kvah > 0 || Number(m.overallPf) > 0;
  const solarYield = solarSpecific?.yield != null ? String(solarSpecific.yield) : '0.00';
  const solarCapacity = solarSpecific?.capacity ?? 540;
  const solarDays = solarSpecific?.days ?? 0;
  const solarTotal = solarSpecific?.total ?? Number(m.solarKwh || 0);
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
        {/* SOLAR SPECIFIC GENERATION */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => { setEditSolarCapacity(String(solarCapacity)); setShowSolarModal(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditSolarCapacity(String(solarCapacity)); setShowSolarModal(true); } }}
          className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 cursor-pointer hover:border-emerald-500/40 hover:bg-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          title="Click to explore solar yield calculation"
          aria-label="Solar Specific Generation — click to explore"
        >
          <div className="text-xs text-slate-400 font-medium uppercase mb-1 flex items-center justify-between">
            <span>SOLAR SPECIFIC GENERATION</span>
            <span className="text-[10px] text-emerald-400/70">EXPLORE →</span>
          </div>
          <div className="text-2xl font-bold text-emerald-400">{solarYield}</div>
          <div className="text-xs text-slate-500 mt-1">kWh/kWp/day</div>
        </div>
        {/* FUEL */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400 font-medium uppercase mb-1">Fuel</div>
          <div className="text-2xl font-bold text-rose-400">{fuel}</div>
          <div className="text-xs text-slate-500 mt-1">Ltrs</div>
        </div>
        {/* POWER FACTOR — fully dynamic, clickable to explore */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowPfModal(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowPfModal(true); } }}
          className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 cursor-pointer hover:border-cyan-500/40 hover:bg-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
          title="Click to explore PF details"
          aria-label="Power Factor — click to explore details"
        >
          <div className="text-xs text-slate-400 font-medium uppercase mb-1 flex items-center justify-between">
            <span>Power Factor</span>
            <span className="text-[10px] text-cyan-400/70">Explore →</span>
          </div>
          <div className="text-2xl font-bold text-cyan-400">{overallPf}</div>
          <div className="text-xs text-slate-500 mt-1">U1 {avgU1Pf} · U2 {avgU2Pf}</div>
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

      {/* PF Explore Modal — fully dynamic, no hardcoded values */}
      {showPfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Power Factor Details">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPfModal(false)} aria-hidden="true" />
          <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 text-lg">⚡</span>
                <h3 className="text-white font-semibold">Power Factor — Explore</h3>
              </div>
              <button onClick={() => setShowPfModal(false)} className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white transition-colors" aria-label="Close">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {!hasPfData ? (
                <p className="text-slate-400 text-sm text-center py-8">No PF data available for the active period. Upload daily utility logs with kWh and kVAh readings to calculate PF dynamically.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wider">Overall PF</div>
                      <div className="text-xl font-bold text-cyan-400 mt-1">{overallPf}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{safeFormat(m.totalKwh ?? 0)} kWh / {safeFormat(m.totalKvah ?? 0)} kVAh</div>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wider">U1 PF</div>
                      <div className="text-xl font-bold text-teal-400 mt-1">{avgU1Pf}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{safeFormat(m.u1Kwh ?? m.u1KwhSum ?? 0)} kWh / {safeFormat(m.u1Kvah ?? m.u1KvahSum ?? m.u1KvarhSum ?? 0)} kVAh</div>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wider">U2 PF</div>
                      <div className="text-xl font-bold text-violet-400 mt-1">{avgU2Pf}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{safeFormat(m.u2Kwh ?? m.u2KwhSum ?? 0)} kWh / {safeFormat(m.u2Kvah ?? m.u2KvahSum ?? m.u2KvarhSum ?? 0)} kVAh</div>
                    </div>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-2">
                    <h4 className="text-white text-sm font-semibold">How PF is calculated</h4>
                    <p className="text-slate-400 text-xs leading-relaxed">PF = ΣkWh / ΣkVAh (true weighted). If kVAh is missing but PF is present, kVAh is derived dynamically as <span className="text-slate-300 font-mono">kVAh = kWh / PF</span>. No static fallbacks — all values come directly from uploaded rows.</p>
                    <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                      <div className="space-y-1">
                        <div className="text-slate-500">U1 Energy</div>
                        <div className="text-white font-mono">{safeFormat(m.u1Kwh ?? 0)} kWh</div>
                        <div className="text-white font-mono">{safeFormat(m.u1Kvah ?? 0)} kVAh</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-slate-500">U2 Energy</div>
                        <div className="text-white font-mono">{safeFormat(m.u2Kwh ?? 0)} kWh</div>
                        <div className="text-white font-mono">{safeFormat(m.u2Kvah ?? 0)} kVAh</div>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs pt-2 border-t border-slate-800">
                      <span className="text-slate-500">Total</span>
                      <span className="text-white font-mono">{safeFormat(m.totalKwh ?? 0)} kWh / {safeFormat(m.totalKvah ?? 0)} kVAh → PF {overallPf}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Solar Specific Generation Explore Modal */}
      {showSolarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Solar Generation Efficiency Breakdown">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSolarModal(false)} aria-hidden="true" />
          <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-lg">☀️</span>
                <h3 className="text-white font-semibold">Solar Generation Efficiency Breakdown</h3>
              </div>
              <button onClick={() => setShowSolarModal(false)} className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white transition-colors" aria-label="Close">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
                <p className="text-slate-400 text-xs font-mono text-center leading-relaxed">
                  Units = Total Solar Generation (kWh) / (Installed Capacity (kW) × Days)
                </p>
                <p className="text-emerald-400 text-xs font-mono text-center mt-2">
                  {safeFormat(solarTotal, 1)} / ({safeFormat(Number(editSolarCapacity || solarCapacity), 0)} × {solarDays || 1}) = {(() => { const cap = Number(editSolarCapacity || solarCapacity); const days = Number(solarDays || 1); const total = Number(solarTotal); return cap && days ? (total / (cap * days)).toFixed(2) : '0.00'; })()} kWh/kW/day
                </p>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Installed Capacity (kW) — Editable</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={editSolarCapacity}
                  onChange={(e) => setEditSolarCapacity(e.target.value)}
                  className="w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400/60"
                  placeholder="540"
                />
                <p className="text-slate-500 text-[11px] mt-1">Default 540 kW — updates persist to Settings → Energy Configuration and Supabase.</p>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Filtered Generation:</span><span className="text-white font-mono">{safeFormat(solarTotal, 1)} kWh</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Installed Capacity:</span><span className="text-white font-mono">{safeFormat(Number(editSolarCapacity || solarCapacity), 0)} kW</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Period Days:</span><span className="text-white font-mono">{solarDays || 1} Days</span></div>
                <div className="flex justify-between pt-2 border-t border-slate-800 font-semibold"><span className="text-slate-300">Result:</span><span className="text-emerald-400 font-mono">{safeFormat(solarTotal, 1)} / ({safeFormat(Number(editSolarCapacity || solarCapacity), 0)} × {solarDays || 1}) = {(() => { const cap = Number(editSolarCapacity || solarCapacity); const days = Number(solarDays || 1); const total = Number(solarTotal); return cap && days ? (total / (cap * days)).toFixed(2) : '0.00'; })()} kWh/kW/day</span></div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowSolarModal(false)} className="btn-ghost text-xs">Cancel</button>
                <button
                  onClick={() => {
                    const cap = Number(editSolarCapacity);
                    if (!Number.isFinite(cap) || cap <= 0) return;
                    if (onSolarCapacitySave) onSolarCapacitySave(cap);
                    else {
                      try { localStorage.setItem('ccpl_solar_capacity', String(cap)); } catch {}
                    }
                    setShowSolarModal(false);
                  }}
                  className="btn-primary text-xs"
                >
                  Save / Apply
                </button>
              </div>
              <p className="text-slate-500 text-[11px]">Recalculates Specific Yield across all time filters instantly. Persisted to energy_settings (Supabase) and localStorage.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default EnergySnapshotCard;
