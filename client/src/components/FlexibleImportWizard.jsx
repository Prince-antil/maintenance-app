import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download, ArrowRight, X, AlertTriangle } from 'lucide-react';

// Common alias map for flexible column detection
const ALIASES = {
  machine_code: ['machine no','machine number','machine code','equipment no','equipment code','asset code','machine id','equipment id','code','id'],
  machine_name: ['machine name','equipment name','asset name','machine','equipment','name'],
  section: ['plant section','section','department','area','plant area','location'],
  date: ['breakdown date','bd date','date','incident date','log date','pm date','pmdate','report date'],
  downtime_hours: ['downtime','downtime hours','bd hours','breakdown hours','hours','duration','duration hours'],
  failure_cause: ['failure cause','failure reason','cause','reason','problem','fault','description','breakdown reason'],
  action_taken: ['action taken','action','repair','corrective action','resolution','remedy','work done'],
  plant_id: ['plant','plant code','plant id','plant name'],
};

function normalizeHeader(h) {
  return String(h||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function detectMapping(headers, aliasMap) {
  const mapping = {};
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  Object.entries(aliasMap).forEach(([field, synonyms]) => {
    const normSyns = synonyms.map((s) => normalizeHeader(s));
    let found = null;
    for (const { raw, norm } of normHeaders) {
      if (normSyns.includes(norm) || normSyns.some((syn) => norm.includes(syn) || syn.includes(norm))) {
        found = raw;
        break;
      }
    }
    mapping[field] = found;
  });
  return mapping;
}

function parseSheet(file) {
  return file.arrayBuffer().then((buf) => {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    return { wb, headers, rows };
  });
}

export default function FlexibleImportWizard({ module = 'machineBreakdownLogs', onClose, onImport }) {
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState([]);
  const [validation, setValidation] = useState({ valid: [], invalid: [], duplicates: [] });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const aliasMap = useMemo(() => {
    if (module === 'machines') return { machine_code: ALIASES.machine_code, machine_name: ALIASES.machine_name, section: ALIASES.section };
    if (module === 'pm') return { machine_code: ALIASES.machine_code, machine_name: ALIASES.machine_name, section: ALIASES.section, date: ALIASES.date };
    if (module === 'energy') return { date: ALIASES.date, section: ALIASES.section };
    return { machine_code: ALIASES.machine_code, machine_name: ALIASES.machine_name, section: ALIASES.section, date: ALIASES.date, downtime_hours: ALIASES.downtime_hours, failure_cause: ALIASES.failure_cause, action_taken: ALIASES.action_taken };
  }, [module]);

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    const { headers: h, rows: r } = await parseSheet(f);
    setHeaders(h);
    setRows(r.filter((row) => Object.values(row).some((v) => String(v).trim() !== '')));
    const m = detectMapping(h, aliasMap);
    setMapping(m);
    setStep(2);
  };

  const handleMapChange = (field, header) => {
    setMapping((prev) => ({ ...prev, [field]: header || null }));
  };

  const buildPreview = () => {
    const valid = [];
    const invalid = [];
    const seen = new Set();
    const dups = [];
    rows.forEach((row, idx) => {
      const mapped = {};
      Object.entries(mapping).forEach(([field, header]) => {
        mapped[field] = header ? row[header] : '';
      });
      // Required check: machine_name is required for most modules
      if (module !== 'energy' && !String(mapped.machine_name || '').trim()) {
        invalid.push({ idx: idx+2, row: mapped, reason: 'Machine name missing' });
        return;
      }
      if (!String(mapped.date || '').trim() && module !== 'machines') {
        // Try to allow but flag
        if (module === 'machineBreakdownLogs') {
          invalid.push({ idx: idx+2, row: mapped, reason: 'Date missing' });
          return;
        }
      }
      const key = `${mapped.machine_code || mapped.machine_name}::${mapped.date}`;
      if (seen.has(key)) dups.push({ idx: idx+2, row: mapped });
      else seen.add(key);
      valid.push(mapped);
    });
    setPreview(valid.slice(0, 8));
    setValidation({ valid, invalid, duplicates: dups });
    setStep(3);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      // Enforce plant_id from current context — ignore any plant column in file
      const currentPlantId = (() => { try { return JSON.parse(localStorage.getItem('ccpl_current_plant_id')); } catch { return null; } })();
      const payload = validation.valid.map((r) => ({ ...r, plant_id: currentPlantId, plantId: currentPlantId }));
      const res = await onImport?.(payload, { fileName: file?.name || 'upload.xlsx', module });
      setResult(res || { added: payload.length, updated: 0, duplicates: validation.duplicates.length, invalid: validation.invalid.length });
      setStep(4);
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setImporting(false);
    }
  };

  const downloadErrors = () => {
    if (!validation.invalid.length) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(validation.invalid.map((e) => ({ Row: e.idx, Reason: e.reason, ...e.row })));
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    XLSX.writeFile(wb, 'import_errors.xlsx');
  };

  const requiredFields = Object.keys(aliasMap);
  const unmappedRequired = requiredFields.filter((f) => !mapping[f]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-card-title flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-emerald-400" /> Flexible Import — {module}
            <span className="badge bg-cyan-500/10 text-cyan-300 text-[10px]">Wizard</span>
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={16} /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-white/[0.06]">
          {[
            { n: 1, label: 'Select Module & File' },
            { n: 2, label: 'Map Columns' },
            { n: 3, label: 'Preview & Validate' },
            { n: 4, label: 'Import Summary' },
          ].map((s) => (
            <div key={s.n} className={`flex items-center gap-1.5 text-xs ${step===s.n ? 'text-cyan-400 font-semibold' : step>s.n ? 'text-emerald-400' : 'text-slate-500'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] border ${step===s.n ? 'bg-cyan-500/15 border-cyan-500/30' : step>s.n ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-white/[0.04] border-white/[0.08]'}`}>{step>s.n ? <CheckCircle2 size={12}/> : s.n}</span>
              <span className="hidden sm:inline">{s.label}</span>
              {s.n<4 && <span className="text-slate-600 mx-1">→</span>}
            </div>
          ))}
        </div>

        <div className="px-6 py-5 space-y-5">
          {step === 1 && (
            <>
              <p className="text-slate-400 text-xs">Upload any Excel/CSV — columns will be auto-mapped. You can adjust mapping in the next step. Plant destination is always forced to your current plant.</p>
              <label className="block text-xs font-medium text-slate-400 mb-1">Module</label>
              <select value={module} disabled className="select-field w-full opacity-60" aria-label="Module">
                <option value={module}>{module}</option>
              </select>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">File</label>
                <div
                  onClick={() => document.getElementById('flex-file')?.click()}
                  onDragOver={(e)=>e.preventDefault()}
                  onDrop={(e)=>{e.preventDefault(); handleFile(e.dataTransfer.files[0]);}}
                  className="rounded-card border-2 border-dashed border-slate-600 hover:border-slate-500 p-6 text-center cursor-pointer"
                  role="button" tabIndex={0}
                >
                  <Upload size={20} className="mx-auto text-slate-500 mb-2" />
                  <p className="text-slate-400 text-sm">{file ? file.name : 'Drag & drop or click to select Excel/CSV'}</p>
                  <input id="flex-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e)=>handleFile(e.target.files[0])} />
                </div>
              </div>
              {file && headers.length>0 && (
                <button onClick={() => setStep(2)} className="btn-primary w-full inline-flex items-center justify-center gap-2">Next: Map Columns <ArrowRight size={13}/></button>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="rounded-card border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-white text-xs font-semibold">Detected Columns</p>
                <p className="text-slate-500 text-[11px] mt-1">Auto-mapped using aliases. Adjust if uncertain — do not guess dangerous fields.</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {headers.map((h) => (
                    <span key={h} className={`badge text-[10px] ${Object.values(mapping).includes(h) ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>{h} {Object.values(mapping).includes(h) ? '✓ mapped' : '○ unmapped'}</span>
                  ))}
                </div>
              </div>

              {unmappedRequired.length>0 && (
                <div className="flex items-start gap-2 rounded-card border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-400">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  <span>Unmapped required: {unmappedRequired.join(', ')} — please map before proceeding.</span>
                </div>
              )}

              <div className="space-y-3">
                {Object.keys(aliasMap).map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <label className="text-slate-300 text-xs w-36 flex-shrink-0">{field} {requiredFields.includes(field) && <span className="text-red-400">*</span>}</label>
                    <select value={mapping[field] || ''} onChange={(e)=>handleMapChange(field, e.target.value)} className="select-field flex-1 text-xs">
                      <option value="">— Not mapped —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span className={`text-[10px] ${mapping[field] ? 'text-emerald-400' : 'text-slate-500'}`}>{mapping[field] ? 'Mapped' : 'Unmapped'}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between gap-3 pt-2">
                <button onClick={()=>setStep(1)} className="btn-ghost text-xs">Back</button>
                <button onClick={buildPreview} className="btn-primary text-xs inline-flex items-center gap-2">Preview & Validate <ArrowRight size={12}/></button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-control bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-center">
                  <p className="text-emerald-400 text-base font-bold">{validation.valid.length}</p>
                  <p className="text-slate-500 text-[10px]">To Add/Update</p>
                </div>
                <div className="rounded-control bg-cyan-500/10 border border-cyan-500/20 p-2.5 text-center">
                  <p className="text-cyan-400 text-base font-bold">{validation.duplicates.length}</p>
                  <p className="text-slate-500 text-[10px]">Duplicates</p>
                </div>
                <div className="rounded-control bg-red-500/10 border border-red-500/20 p-2.5 text-center">
                  <p className="text-red-400 text-base font-bold">{validation.invalid.length}</p>
                  <p className="text-slate-500 text-[10px]">Invalid</p>
                </div>
                <div className="rounded-control bg-slate-500/10 border border-white/[0.06] p-2.5 text-center">
                  <p className="text-white text-base font-bold">{rows.length}</p>
                  <p className="text-slate-500 text-[10px]">Total Rows</p>
                </div>
              </div>

              {validation.invalid.length>0 && (
                <div className="flex items-center justify-between rounded-card border border-red-500/25 bg-red-500/5 px-3 py-2">
                  <p className="text-red-400 text-xs flex items-center gap-2"><AlertCircle size={12}/> {validation.invalid.length} invalid rows will be skipped</p>
                  <button onClick={downloadErrors} className="btn-ghost text-xs inline-flex items-center gap-1"><Download size={11}/> Download Errors</button>
                </div>
              )}

              <div>
                <p className="text-white text-xs font-semibold mb-2">Preview (first 8 valid rows)</p>
                <div className="overflow-x-auto">
                  <table className="enterprise-table w-full min-w-[600px] text-xs">
                    <thead><tr>{Object.keys(aliasMap).map((k)=><th key={k}>{k}</th>)}</tr></thead>
                    <tbody>
                      {preview.map((r,i)=>(
                        <tr key={i}>{Object.keys(aliasMap).map((k)=><td key={k} className="text-slate-300 truncate max-w-[150px]">{String(r[k]||'—')}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.length===0 && <p className="text-slate-500 text-xs py-3">No valid rows to preview.</p>}
              </div>

              <div className="rounded-card border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                <p className="text-cyan-300 text-xs">Plant enforcement: all records will be saved to <span className="font-semibold">{(()=>{try{const id=JSON.parse(localStorage.getItem('ccpl_current_plant_id')); const plants=JSON.parse(localStorage.getItem('ccpl_plants_cache')||'[]'); const p=plants.find(x=>x.id===id); return p?`${p.plant_name} (${p.plant_code})`:'Current plant';}catch{return 'Current plant';}})()}</span>. Excel plant columns are ignored.</p>
              </div>

              <div className="flex justify-between gap-3">
                <button onClick={()=>setStep(2)} className="btn-ghost text-xs">Back to Mapping</button>
                <div className="flex gap-2">
                  <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
                  <button onClick={handleImport} disabled={importing || !validation.valid.length} className="btn-success text-xs inline-flex items-center gap-2 disabled:opacity-40">
                    {importing ? 'Importing…' : `Import Valid Records (${validation.valid.length})`}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <div className="text-center py-4 space-y-3">
              {result?.error ? (
                <div className="rounded-card border border-red-500/30 bg-red-500/8 p-4">
                  <AlertCircle size={20} className="text-red-400 mx-auto mb-2" />
                  <p className="text-red-400 text-sm font-semibold">Import failed</p>
                  <p className="text-slate-400 text-xs mt-1">{result.error}</p>
                </div>
              ) : (
                <div className="rounded-card border border-emerald-500/25 bg-emerald-500/5 p-4">
                  <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-emerald-400 text-sm font-semibold">Import Complete</p>
                  <div className="flex items-center justify-center gap-4 mt-3 text-xs">
                    <span className="text-emerald-300">Added: {result?.added ?? 0}</span>
                    <span className="text-cyan-300">Updated: {result?.updated ?? 0}</span>
                    <span className="text-amber-400">Dup: {result?.duplicates ?? 0}</span>
                    <span className="text-red-400">Invalid: {result?.invalid ?? 0}</span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-2">All records scoped to your current plant. Realtime sync sent to authorized users.</p>
                </div>
              )}
              <button onClick={onClose} className="btn-primary text-xs mt-2">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
