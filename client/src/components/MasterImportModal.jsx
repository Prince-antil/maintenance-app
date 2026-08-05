import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle,
  ClipboardCheck, AlertOctagon, Zap, RefreshCw, Link, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { parseMasterImportFile, downloadMasterTemplate } from '../bulkImport.js';
import { importMasterExcelBulk, syncFromMasterSheet, useStore, updateSettings } from '../store.js';

// ── tiny helpers ──────────────────────────────────────────────────────────────
const MODULE_META = {
  pm:         { label: 'PM Data',        icon: ClipboardCheck, color: 'text-cyan-400',   bg: 'bg-cyan-400/10',   border: 'border-cyan-400/25' },
  breakdowns: { label: 'Breakdowns',     icon: AlertOctagon,   color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/25' },
  energy:     { label: 'Energy Logs',    icon: Zap,            color: 'text-amber-400',  bg: 'bg-amber-400/10',  border: 'border-amber-400/25' },
};

function ProgressBar({ value, label }) {
  return (
    <div className="rounded-card border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-cyan-400">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function SheetSummaryRow({ moduleId, result }) {
  const meta = MODULE_META[moduleId];
  const Icon = meta.icon;
  const [open, setOpen] = useState(false);
  const hasErrors = result.errors.length > 0;
  const hasRows = result.counts.valid > 0;

  return (
    <div className={`rounded-card border ${meta.border} ${meta.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={() => (hasErrors || hasRows) && setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className={`w-8 h-8 rounded-control flex items-center justify-center flex-shrink-0 ${meta.bg} border ${meta.border}`}>
          <Icon size={15} className={meta.color} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold">{meta.label}</p>
          {result.sheetName ? (
            <p className="text-slate-400 text-xs mt-0.5">
              Sheet: <span className="text-slate-300">{result.sheetName}</span>
              {' · '}
              <span className="text-emerald-400">{result.counts.valid} valid</span>
              {result.errors.length > 0 && (
                <span className="text-red-400 ml-1">· {result.errors.length} issue{result.errors.length > 1 ? 's' : ''}</span>
              )}
            </p>
          ) : (
            <p className="text-slate-500 text-xs mt-0.5">Sheet not found in workbook</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {result.counts.valid > 0 && (
            <span className="text-xs font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/25 rounded-control px-2 py-0.5">
              {result.counts.valid} rows
            </span>
          )}
          {(hasErrors || hasRows) && (
            open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/[0.07] px-4 py-3 space-y-2">
          {/* Preview rows */}
          {result.parsedRows?.slice(0, 4).map((row, i) => (
            <div key={i} className="text-[11px] text-slate-400 bg-white/[0.03] rounded-control px-3 py-1.5 font-mono truncate">
              {Object.entries(row).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </div>
          ))}
          {/* Errors */}
          {result.errors.slice(0, 4).map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-400">
              <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
              <span>{err}</span>
            </div>
          ))}
          {result.errors.length > 4 && (
            <p className="text-xs text-slate-500">…and {result.errors.length - 4} more issues</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live Sheet Sync panel ─────────────────────────────────────────────────────
function LiveSyncPanel({ onClose }) {
  const store = useStore();
  const { pushToast } = useUI();
  const { user } = useAuth();
  const [endpoint, setEndpoint] = useState(store.settings?.masterSheetEndpoint || '');
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const save = () => {
    updateSettings({ masterSheetEndpoint: endpoint.trim() });
    pushToast({ type: 'success', title: 'Endpoint saved', message: 'Master sheet URL has been stored in settings.' });
  };

  const runSync = async () => {
    if (!endpoint.trim()) {
      pushToast({ type: 'error', title: 'No endpoint', message: 'Enter a sheet URL first.' });
      return;
    }
    setSyncing(true);
    setLastResult(null);
    try {
      const result = await syncFromMasterSheet();
      setLastResult(result);
      pushToast({
        type: 'success',
        title: 'Live sync complete',
        message: `PM ${result.pm.total} · Breakdowns ${result.breakdowns.total} · Energy ${result.energy.total} rows synced.`,
      });
    } catch (err) {
      pushToast({ type: 'error', title: 'Sync failed', message: err.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <p className="text-meta text-xs">
        Point to a Google Apps Script Web App (or any endpoint) that returns{' '}
        <code className="bg-white/[0.06] rounded px-1 py-0.5 text-[11px]">{'{ pm: [], breakdowns: [], energy: [] }'}</code>.
        Kiro fetches it on demand and syncs all three entities to Supabase Realtime.
      </p>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Sheet JSON endpoint URL</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="url"
              className="input-field pl-9 text-xs"
              placeholder="https://script.google.com/macros/s/…/exec"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>
          <button type="button" onClick={save} className="btn-ghost text-xs px-3">Save</button>
        </div>
      </div>

      <button
        type="button"
        onClick={runSync}
        disabled={syncing}
        className="btn-success w-full inline-flex items-center justify-center gap-2 text-xs disabled:opacity-60"
      >
        <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
        {syncing ? 'Syncing…' : 'Sync Now from Remote Sheet'}
      </button>

      {lastResult && (
        <div className="rounded-card border border-emerald-400/25 bg-emerald-400/5 p-3 text-xs space-y-1">
          <p className="text-emerald-400 font-semibold flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Sync successful
          </p>
          {['pm', 'breakdowns', 'energy'].map((k) => (
            <p key={k} className="text-slate-400 pl-5">
              {MODULE_META[k].label}: {lastResult[k].total} rows ({lastResult[k].created ?? 0} new · {lastResult[k].updated ?? 0} updated)
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function MasterImportModal({ onClose, onSuccess }) {
  const { user } = useAuth();
  const { pushToast } = useUI();
  const userName = user?.full_name || 'Admin';

  const [tab, setTab] = useState('upload'); // 'upload' | 'live'
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [parseError, setParseError] = useState('');
  const fileRef = useRef(null);
  const overlayRef = useRef(null);

  // Parse file whenever it changes
  useEffect(() => {
    if (!file) return;
    let active = true;
    setParsing(true);
    setParseResult(null);
    setParseError('');
    setProgress(10);
    setProgressLabel('Parsing workbook sheets…');
    parseMasterImportFile(file)
      .then((result) => {
        if (!active) return;
        setParseResult(result);
        setProgress(30);
        setProgressLabel(result.hasData ? 'Preview ready' : 'No importable data found');
      })
      .catch((err) => {
        if (!active) return;
        setParseError(err.message || 'Failed to parse workbook.');
        setProgress(0);
        setProgressLabel('');
      })
      .finally(() => { if (active) setParsing(false); });
    return () => { active = false; };
  }, [file]);

  const handleFile = (selected) => {
    if (!selected) return;
    const ext = '.' + selected.name.split('.').pop().toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) {
      setParseError('Only .xlsx and .xls files are supported for master import.');
      return;
    }
    setParseError('');
    setImportResult(null);
    setProgress(0);
    setFile(selected);
  };

  const handleImport = async () => {
    if (!parseResult?.hasData) return;
    setImporting(true);
    setProgress(60);
    setProgressLabel('Importing PM records…');

    try {
      // Small visual delay between steps for feedback
      await new Promise((r) => setTimeout(r, 120));
      setProgress(72);
      setProgressLabel('Importing breakdown records…');
      await new Promise((r) => setTimeout(r, 120));
      setProgress(84);
      setProgressLabel('Importing energy logs…');
      await new Promise((r) => setTimeout(r, 120));

      const result = importMasterExcelBulk(parseResult, userName);
      setProgress(100);
      setProgressLabel('Import complete — syncing to all PCs');
      setImportResult(result);

      pushToast({
        type: 'success',
        title: 'Master import complete',
        message: `PM ${result.pm.total} · Breakdowns ${result.breakdowns.total} · Energy ${result.energy.total} rows synced to Supabase Realtime.`,
      });
      onSuccess?.();
    } catch (err) {
      setProgress(0);
      setProgressLabel('Import failed');
      pushToast({ type: 'error', title: 'Import failed', message: err.message });
    } finally {
      setImporting(false);
    }
  };

  const canImport = !importing && !parsing && parseResult?.hasData && !importResult;

  const totalErrors = useMemo(
    () => parseResult?.totalErrors?.length ?? 0,
    [parseResult]
  );

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import Master Excel"
    >
      <div className="glass-card w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/[0.06]">
          <div>
            <h2 className="text-card-title flex items-center gap-2">
              <FileSpreadsheet size={17} className="text-emerald-400" aria-hidden="true" />
              Master Excel Import
            </h2>
            <p className="text-meta mt-1 text-xs">
              Upload one workbook with <span className="text-white">PM_Data</span>,{' '}
              <span className="text-white">Breakdown_Data</span>, and{' '}
              <span className="text-white">Energy_Data</span> sheets — all three sync
              to Supabase Realtime and update every connected PC instantly.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 flex-shrink-0 ml-4" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] px-6">
          {[
            { id: 'upload', label: 'Upload Workbook' },
            { id: 'live',   label: 'Live Sheet Sync' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-cyan-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-5">
          {tab === 'live' ? (
            <LiveSyncPanel onClose={onClose} />
          ) : (
            <>
              {/* Template download */}
              <div className="flex items-center justify-between rounded-card border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div>
                  <p className="text-xs text-white font-semibold">Need a template?</p>
                  <p className="text-xs text-slate-400 mt-0.5">Download a pre-structured workbook with all three sheets.</p>
                </div>
                <button
                  type="button"
                  onClick={downloadMasterTemplate}
                  className="btn-ghost text-xs inline-flex items-center gap-1.5 flex-shrink-0 ml-4"
                >
                  <Download size={13} aria-hidden="true" /> Download Template
                </button>
              </div>

              {/* Drop zone */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Workbook file (.xlsx / .xls)</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
                  role="button"
                  tabIndex={0}
                  aria-label="Select or drop master Excel workbook"
                  className={`cursor-pointer rounded-card border-2 border-dashed p-6 text-center transition-all ${
                    dragOver
                      ? 'border-emerald-400 bg-emerald-400/5'
                      : file
                      ? 'border-emerald-400/50 bg-emerald-400/5'
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files[0])}
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-400">
                      <FileSpreadsheet size={18} aria-hidden="true" />
                      <span className="text-sm font-medium max-w-xs truncate">{file.name}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Upload size={24} aria-hidden="true" />
                      <p className="text-sm">Drag & drop or click to select</p>
                      <p className="text-xs text-slate-500">Excel workbook with PM_Data · Breakdown_Data · Energy_Data sheets</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Parse error */}
              {parseError && (
                <div className="flex items-start gap-2 rounded-card border border-red-500/30 bg-red-500/8 px-4 py-3 text-xs text-red-400" role="alert">
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Progress bar */}
              {(parsing || importing || progress > 0) && (
                <ProgressBar value={progress} label={progressLabel || (parsing ? 'Parsing…' : 'Processing…')} />
              )}

              {/* Per-sheet summaries */}
              {parseResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-300">Sheet Detection Results</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-400">{parseResult.totalValid} total valid rows</span>
                      {totalErrors > 0 && <span className="text-red-400">{totalErrors} issues</span>}
                    </div>
                  </div>
                  {['pm', 'breakdowns', 'energy'].map((moduleId) => (
                    <SheetSummaryRow
                      key={moduleId}
                      moduleId={moduleId}
                      result={parseResult[moduleId]}
                    />
                  ))}

                  {/* Unrecognised sheets warning */}
                  {parseResult.sheetNames?.filter((n) => {
                    const k = n.replace(/[^a-z0-9]+/gi, '').toLowerCase();
                    return !['pmdata','preventivemaintenance','pm','pmreport','pmsummary','preventive',
                      'breakdowndata','breakdowns','breakdownreport','breakdownsummary','breakdown',
                      'energydata','energylogs','energy','energyreport','energylog'].includes(k);
                  }).length > 0 && (
                    <p className="text-xs text-slate-500 pl-1">
                      Other sheets detected ({parseResult.sheetNames.filter((n) => !Object.values(parseResult.sheetMap).includes(n)).join(', ')}) — skipped.
                    </p>
                  )}
                </div>
              )}

              {/* Import result */}
              {importResult && (
                <div className="rounded-card border border-emerald-400/25 bg-emerald-400/5 px-4 py-3 space-y-1">
                  <p className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                    <CheckCircle2 size={13} /> Import complete — all changes synced to Supabase Realtime
                  </p>
                  {['pm', 'breakdowns', 'energy'].map((k) => (
                    <p key={k} className="text-slate-400 text-xs pl-5">
                      {MODULE_META[k].label}: {importResult[k].total} rows
                      {' '}({importResult[k].created ?? 0} new · {importResult[k].updated ?? 0} updated)
                    </p>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={onClose} className="btn-ghost text-xs">
                  {importResult ? 'Close' : 'Cancel'}
                </button>
                {!importResult && (
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={!canImport}
                    className="btn-success inline-flex items-center gap-2 text-xs disabled:opacity-40"
                  >
                    <Upload size={13} aria-hidden="true" />
                    {importing ? 'Importing…' : `Import ${parseResult?.totalValid ?? 0} Rows → Sync All PCs`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
