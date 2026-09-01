import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, FileText, AlertCircle, FileSpreadsheet, Download, Table2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { CATEGORIES, MONTHS, YEARS, ALLOWED_EXT, EXT_META } from '../constants.js';
import SectionSelect from './SectionSelect.jsx';
import { IMPORT_MODULES, downloadTemplate, inferUploadMeta, parseImportFile } from '../bulkImport.js';
import { importBreakdownsBulk, importMachinesBulk, importPMBulk, importMachineBreakdownLogsBulk, importMachinePmRecordsBulk, dryRunImportMachinePmRecords, importDailyUtilityLogBulk, importMonthlyHerbicideBulk, importMonthlyInsecticideBulk, importMonthlyWaterBulk, importMonthlyAirCompressorBulk, importDailySolarGenerationBulk } from '../store.js';

const BULK_ALLOWED_EXT = ['.xlsx', '.xls', '.csv'];
const MODULE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect from headers' },
  ...Object.values(IMPORT_MODULES).map((item) => ({ value: item.id, label: item.label })),
];

const importers = {
  pm: importPMBulk,
  breakdowns: importBreakdownsBulk,
  machines: importMachinesBulk,
  machineBreakdownLogs: importMachineBreakdownLogsBulk,
  machinePmRecords: importMachinePmRecordsBulk,
  energyDailyUtility: importDailyUtilityLogBulk,
  energyMonthlyHerbicide: importMonthlyHerbicideBulk,
  energyMonthlyInsecticide: importMonthlyInsecticideBulk,
  energyMonthlyWater: importMonthlyWaterBulk,
  energyMonthlyAirCompressor: importMonthlyAirCompressorBulk,
  energyDailySolar: importDailySolarGenerationBulk,
};

function ProgressBar({ value, label }) {
  return (
    <div className="rounded-card border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-cyan-400">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-300" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function UploadModal({ onClose, onSuccess, initialState = {} }) {
  const { user } = useAuth();
  const { pushToast } = useUI();
  const isBulk = (initialState.kind || 'document') === 'bulk';
  const now = new Date();
  const [form, setForm] = useState({
    category_name: initialState.category || '',
    reporting_month: now.toLocaleDateString('en-GB', { month: 'long' }),
    reporting_year: String(now.getFullYear()),
    plant_section: 'Overall Nathupur Maintenance Formulation Plant (Master Combined View)',
  });
  const [moduleId, setModuleId] = useState(initialState.module || 'auto');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Waiting for file');
  const [parseState, setParseState] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [showDryRun, setShowDryRun] = useState(false);
  const fileRef = useRef(null);

  const allowedExt = isBulk ? BULK_ALLOWED_EXT : ALLOWED_EXT;

  useEffect(() => {
    if (!file || !isBulk) return;
    let active = true;
    setProgress(8);
    setProgressLabel('Parsing spreadsheet');
    parseImportFile(file, moduleId).then((result) => {
      if (!active) return;
      setParseState(result);
      if (result.moduleId) {
        const inferred = inferUploadMeta(result.moduleId, result.parsedRows);
        setForm((current) => ({
          ...current,
          category_name: initialState.category || inferred.category_name,
          reporting_month: inferred.reporting_month,
          reporting_year: inferred.reporting_year,
          plant_section: inferred.plant_section,
        }));
        // Compute dry-run preview for PM machine records
        if (result.moduleId === 'machinePmRecords' && result.parsedRows.length > 0) {
          const preview = dryRunImportMachinePmRecords(result.parsedRows);
          setDryRun(preview);
          setShowDryRun(true);
        } else {
          setDryRun(null);
          setShowDryRun(false);
        }
      }
      setProgress(28);
      setProgressLabel(result.errors.length ? 'Preview ready with validation notes' : 'Preview ready');
    }).catch((err) => {
      if (!active) return;
      setParseState(null);
      setError(err.message || 'Failed to parse the spreadsheet.');
      setProgress(0);
      setProgressLabel('Parsing failed');
    });
    return () => { active = false; };
  }, [file, moduleId, isBulk, initialState.category]);

  const handleFile = (selectedFile) => {
    if (!selectedFile) return;
    const ext = '.' + selectedFile.name.split('.').pop().toLowerCase();
    if (!allowedExt.includes(ext)) {
      setError(`Invalid file type. Allowed: ${allowedExt.join(', ')}`);
      return;
    }
    setError('');
    setFile(selectedFile);
    setParseState(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.category_name || !form.reporting_month || !form.reporting_year || !form.plant_section) {
      setError('All repository fields are required');
      return;
    }
    if (!file) {
      setError('Please select a file');
      return;
    }
    if (isBulk && (!parseState?.moduleId || !parseState?.parsedRows?.length)) {
      setError('Please upload a valid import file with at least one mapped row');
      return;
    }

    setLoading(true);
    setError('');

    try {
      setProgress(35);
      setProgressLabel('Uploading file to shared repository');

      const fd = new FormData();
      fd.append('file', file);
      fd.append('category_name', form.category_name);
      fd.append('reporting_month', form.reporting_month);
      fd.append('reporting_year', form.reporting_year);
      fd.append('plant_section', form.plant_section);

      const fileExt = '.' + file.name.split('.').pop().toLowerCase();
      setProgressLabel('Syncing file with Supabase repository');
      const apiRecord = await api.uploadReport(fd, {
        onProgress: (value) => setProgress(35 + Math.round(value * 0.35)),
      });

      setProgress(74);
      setProgressLabel('Shared repository metadata saved');

      if (isBulk) {
        setProgress(84);
        setProgressLabel('Importing structured rows into synchronized records');
        const result = importers[parseState.moduleId](parseState.parsedRows, user?.full_name || 'Prince');
        setProgress(100);
        setProgressLabel('Import complete');

        // Build success message with auto-mapping summary
        let message = `${result.total} ${IMPORT_MODULES[parseState.moduleId].shortLabel} records synchronized.`;
        if (result.autoMapped && result.autoMapped.length > 0) {
          const mappedSample = result.autoMapped.slice(0, 3).map((m) => `"${m.fields.machineCode || m.fields.machineName || m.fields.plantSection}" → ${m.machine}`).join(', ');
          message += ` Auto-filled: ${result.autoMapped.length} row(s) (${mappedSample}${result.autoMapped.length > 3 ? '...' : ''}).`;
        }
        if (result.unmatched && result.unmatched.length > 0) {
          message += ` ${result.unmatched.length} row(s) could not be matched to a machine.`;
        }
        pushToast({
          type: 'success',
          title: 'Bulk import completed',
          message,
        });
      } else {
        setProgress(100);
        setProgressLabel('Upload complete');
        pushToast({
          type: 'success',
          title: 'Document uploaded',
          message: `${apiRecord.filename || file.name} is now available to every connected device through the shared repository.`,
        });
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      const message = err.message || 'Upload failed';
      setError(message);
      setProgressLabel('Upload failed');
      pushToast({
        type: 'error',
        title: 'Upload failed',
        message,
      });
    } finally {
      setLoading(false);
    }
  };

  const fileExt = file ? '.' + file.name.split('.').pop().toLowerCase() : null;
  const fileMeta = fileExt ? EXT_META[fileExt] : null;
  const previewColumns = useMemo(
    () => Object.keys(parseState?.previewRows?.[0] || {}).slice(0, 6),
    [parseState]
  );
  const title = isBulk ? 'Upload Excel / Bulk Import' : 'Upload New Report';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-content glass-card w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-card-title">{title}</h2>
            <p className="text-meta mt-1">
              {isBulk
                ? 'Upload one Excel/CSV file, preview mapped rows, store the raw file, and recalculate live dashboards instantly.'
                : 'Upload a report document to the central repository.'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 transition-colors hover:text-white" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isBulk && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_auto]">
              <div>
                <label htmlFor="bulk-module" className="mb-1.5 block text-xs font-medium text-slate-400">Import Module *</label>
                <select id="bulk-module" className="select-field" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                  {MODULE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <button
                type="button"
                disabled={moduleId === 'auto'}
                onClick={() => downloadTemplate(moduleId)}
                className="btn-ghost inline-flex items-center justify-center gap-2 self-end text-xs disabled:opacity-40"
              >
                <Download size={13} aria-hidden="true" /> Download Sample Template
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className={isBulk ? '' : 'md:col-span-2'}>
              <label htmlFor="up-category" className="mb-1.5 block text-xs font-medium text-slate-400">Repository Category *</label>
              <select id="up-category" className="select-field" value={form.category_name} onChange={(e) => setForm({ ...form, category_name: e.target.value })}>
                <option value="">Select category...</option>
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="up-month" className="mb-1.5 block text-xs font-medium text-slate-400">Reporting Month *</label>
              <select id="up-month" className="select-field" value={form.reporting_month} onChange={(e) => setForm({ ...form, reporting_month: e.target.value })}>
                <option value="">Month...</option>
                {MONTHS.map((month) => <option key={month} value={month}>{month}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="up-year" className="mb-1.5 block text-xs font-medium text-slate-400">Reporting Year *</label>
              <select id="up-year" className="select-field" value={form.reporting_year} onChange={(e) => setForm({ ...form, reporting_year: e.target.value })}>
                <option value="">Year...</option>
                {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="up-section" className="mb-1.5 block text-xs font-medium text-slate-400">Plant Section *</label>
              <SectionSelect id="up-section" value={form.plant_section} onChange={(v) => setForm({ ...form, plant_section: v })} />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">File *</label>
            <div
              className={`cursor-pointer rounded-card border-2 border-dashed p-6 text-center transition-all ${
                dragOver
                  ? 'border-cyan-400 bg-cyan-400/5'
                  : file
                  ? 'border-emerald-400/50 bg-emerald-400/5'
                  : 'border-slate-600 hover:border-slate-500'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files[0]);
              }}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              aria-label="Select or drop a file"
            >
              <input ref={fileRef} type="file" accept={allowedExt.join(',')} className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-emerald-400">
                  <FileText size={18} aria-hidden="true" />
                  <span className="max-w-xs truncate text-sm font-medium">{file.name}</span>
                  {fileMeta && <span className={`badge ${fileMeta.badge}`}>{fileMeta.label}</span>}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Upload size={24} aria-hidden="true" />
                  <p className="text-sm">Drag & drop or click to select</p>
                  <p className="text-xs text-slate-500">{isBulk ? 'Excel (.xlsx, .xls) or CSV only' : 'Word, Excel, PowerPoint, PDF, CSV'}</p>
                </div>
              )}
            </div>
          </div>

          {(loading || progress > 0) && <ProgressBar value={progress} label={progressLabel} />}

          {isBulk && dryRun && showDryRun && (
            <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileSpreadsheet size={15} className="text-amber-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-amber-300">Import Validation Preview</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div className="rounded-control border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Rows</p>
                  <p className="text-white text-lg font-bold">{dryRun.totalRows}</p>
                </div>
                <div className="rounded-control border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider">Matched</p>
                  <p className="text-emerald-400 text-lg font-bold">{dryRun.matched} / {dryRun.totalRows}</p>
                </div>
                <div className="rounded-control border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <p className="text-[10px] text-amber-400/70 uppercase tracking-wider">To Auto-Create</p>
                  <p className="text-amber-400 text-lg font-bold">{dryRun.autoCreateCount}</p>
                </div>
                <div className="rounded-control border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                  <p className="text-[10px] text-cyan-400/70 uppercase tracking-wider">Compliance</p>
                  <p className="text-cyan-400 text-lg font-bold">{dryRun.compliance}%</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div className="rounded-control border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Completed</p>
                  <p className="text-emerald-400 text-sm font-semibold">{dryRun.totalCompleted}</p>
                </div>
                <div className="rounded-control border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Pending</p>
                  <p className="text-amber-400 text-sm font-semibold">{dryRun.totalPending}</p>
                </div>
                <div className="rounded-control border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Target Months</p>
                  <p className="text-white text-sm font-semibold">{dryRun.targetMonths.join(', ') || '—' }</p>
                </div>
                <div className="rounded-control border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Sections</p>
                  <p className="text-white text-sm font-semibold">{dryRun.sectionsDetected.length}</p>
                </div>
              </div>
              {dryRun.unmatchedNames.length > 0 && (
                <div className="rounded-control border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <p className="text-[10px] text-amber-400/70 uppercase tracking-wider mb-1">Unmatched Machines (will be auto-created as UNASSIGNED)</p>
                  <div className="flex flex-wrap gap-1">
                    {dryRun.unmatchedNames.slice(0, 10).map((name, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">{name}</span>
                    ))}
                    {dryRun.unmatchedNames.length > 10 && (
                      <span className="text-[10px] text-amber-400/60">+{dryRun.unmatchedNames.length - 10} more</span>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => { setShowDryRun(false); setDryRun(null); }} className="btn-ghost text-xs">Cancel Import</button>
                <button type="button" onClick={() => setShowDryRun(false)} className="btn-success text-xs inline-flex items-center gap-1.5">
                  Confirm & Continue Import
                </button>
              </div>
            </div>
          )}

          {isBulk && parseState && (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
              <div className="rounded-card border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <FileSpreadsheet size={15} className="text-cyan-400" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-white">Mapping Summary</h3>
                </div>
                <p className="text-xs text-slate-400">
                  Module: <span className="text-white">{parseState.moduleId ? IMPORT_MODULES[parseState.moduleId].label : 'Unknown'}</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Rows: <span className="text-white">{parseState.counts.valid}</span> valid / <span className="text-white">{parseState.counts.total}</span> detected
                </p>
                <ul className="mt-3 space-y-2 text-xs">
                  {parseState.mappingPreview?.map((item) => (
                    <li key={item.field} className="flex items-start justify-between gap-3 rounded-control border border-white/[0.06] px-3 py-2">
                      <span className="font-medium capitalize text-slate-200">{item.field}</span>
                      <span className="text-right text-slate-400">{item.header}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-card border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Table2 size={15} className="text-emerald-400" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-white">Live Preview</h3>
                </div>
                {parseState.previewRows.length === 0 ? (
                  <p className="text-xs text-slate-500">No importable rows found yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="enterprise-table min-w-[560px]">
                      <thead>
                        <tr>{previewColumns.map((column) => <th key={column}>{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {parseState.previewRows.map((row, index) => (
                          <tr key={index}>
                            {previewColumns.map((column) => (
                              <td key={column} className="max-w-[160px] truncate text-xs text-slate-300" title={String(row[column] ?? '')}>
                                {Array.isArray(row[column]) ? row[column].length : String(row[column] ?? '—' )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {(error || parseState?.errors?.length > 0) && (
            <div className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
              <div className="flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  {error && <p>{error}</p>}
                  {parseState?.errors?.slice(0, 5).map((item) => <p key={item}>{item}</p>)}
                  {parseState?.errors?.length > 5 && <p>+ {parseState.errors.length - 5} more validation notes</p>}
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={loading || showDryRun} className="btn-success flex items-center justify-center gap-2 disabled:opacity-40">
            <Upload size={15} aria-hidden="true" />
            {loading ? 'Processing...' : isBulk ? 'Save File & Import Rows' : 'Upload Report'}
          </button>
        </form>
      </div>
    </div>
  );
}
