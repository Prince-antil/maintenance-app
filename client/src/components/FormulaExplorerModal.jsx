// =============================================================================
// FormulaExplorerModal — Reusable Explore Formulas & Data Modal
// =============================================================================
import React, { useState, useEffect } from 'react';

export default function FormulaExplorerModal({
  isOpen,
  onClose,
  title,
  subtitle,
  formula,
  variables = [],
  steps = [],
  result,
  resultLabel = 'Result',
  editableFields = [],
  onSave,
  saveLabel = 'Save / Apply',
}) {
  const [localEdits, setLocalEdits] = useState({});

  useEffect(() => {
    if (isOpen) {
      const init = {};
      editableFields.forEach((f) => { init[f.key] = f.value; });
      setLocalEdits(init);
    }
  }, [isOpen, JSON.stringify(editableFields.map(f => f.value))]);

  if (!isOpen) return null;

  const handleChange = (key, val) => {
    setLocalEdits((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    if (onSave) {
      onSave(localEdits);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 p-5 flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold flex items-center gap-2">{title} <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">EXPLORE</span></h3>
            {subtitle && <p className="text-slate-400 text-xs mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white transition-colors" aria-label="Close">✕</button>
        </div>
        <div className="p-5 space-y-5">
          {/* Formula Card */}
          {formula && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
              <p className="text-slate-400 text-[11px] uppercase tracking-wider mb-2">Formula</p>
              <p className="text-cyan-300 text-sm font-mono text-center leading-relaxed bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">{formula}</p>
            </div>
          )}
          {/* Editable Inputs */}
          {editableFields.length > 0 && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-3">
              <p className="text-white text-xs font-semibold">Editable Parameters</p>
              {editableFields.map((field) => (
                <div key={field.key}>
                  <label className="block text-slate-400 text-xs mb-1">{field.label} {field.unit && <span className="text-slate-500">({field.unit})</span>}</label>
                  <input
                    type={field.type || 'number'}
                    value={localEdits[field.key] ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60"
                    placeholder={field.placeholder || ''}
                  />
                  {field.hint && <p className="text-slate-500 text-[11px] mt-1">{field.hint}</p>}
                </div>
              ))}
            </div>
          )}
          {/* Live Calculation Table */}
          {variables.length > 0 && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-800">
                <p className="text-white text-xs font-semibold">Live Calculation — Variables</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/50">
                    <tr className="text-slate-500">
                      <th className="text-left px-3 py-2 font-medium">Variable</th>
                      <th className="text-left px-3 py-2 font-medium">Source Column</th>
                      <th className="text-right px-3 py-2 font-medium">Current Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {variables.map((v, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-slate-300">{v.name}</td>
                        <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">{v.source || ' — '}</td>
                        <td className="px-3 py-2 text-right text-white font-mono">{v.value != null && v.value !== '' ? String(v.value) : ' — '} {v.unit || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Step-by-Step Breakdown */}
          {steps.length > 0 && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-2">
              <p className="text-white text-xs font-semibold">Step-by-Step Breakdown</p>
              <ol className="space-y-1.5">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="text-cyan-400 font-mono">0{i + 1}.</span>
                    <span className="text-slate-300 font-mono">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {/* Result */}
          {result != null && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 flex items-center justify-between">
              <span className="text-emerald-300 text-xs font-semibold">{resultLabel}:</span>
              <span className="text-emerald-400 text-lg font-bold font-mono">{result}</span>
            </div>
          )}
          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-xs">Close</button>
            {onSave && (
              <button onClick={handleSave} className="btn-primary text-xs">
                {saveLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
