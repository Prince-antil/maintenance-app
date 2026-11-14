// =============================================================================
// Inspection, Calibration & Statutory Compliance — plant-wise register for
// non-machine equipment (gauges, lifting tackles, vessels, PPE, electrical).
// Machine Profile → Testing Certificates tab is intentionally untouched;
// linking here stores a REFERENCE only (no copy/move/duplicate).
// Statuses are always derived from dates + outcomes via complianceLogic.
// =============================================================================
import { useMemo, useState, useEffect } from 'react';
import {
  useStore, getPlantScopedData,
  addComplianceEquipment, updateComplianceEquipment, deleteComplianceEquipment,
  addComplianceInspection, updateComplianceInspection, deleteComplianceInspection,
  linkMachineCertificate, getComplianceEquipmentStatus,
  getComplianceSettings, saveComplianceSettings,
} from '../store.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlant } from '../context/PlantContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { canUpload, canDelete, canViewCorporateDashboard } from '../lib/plantAccess.js';
import {
  COMPLIANCE_CATEGORIES, COMPLIANCE_STATUS_META, RESULT_OPTIONS,
  DUE_SOON_DAYS, categoryLabel, defaultFreqFor,
  filterCompliance, summarizeCompliance, buildComplianceCsv,
} from '../lib/complianceLogic.js';
import { uploadComplianceDoc, resolveComplianceDocumentUrl } from '../lib/complianceDocs.js';
import EmptyState from '../components/EmptyState.jsx';
import {
  ClipboardList, Plus, Pencil, Trash2, FileText, Download, Upload, FileSpreadsheet,
  ShieldCheck, AlertTriangle, X, Save, Eye, CalendarDays, Award, History, Info,
} from 'lucide-react';

const PAGE_SIZE = 12;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DISMISS_LS_KEY = 'ccpl_compliance_dismissed_v1';
const CONFIG_LS_KEY = 'ccpl_compliance_config_v1';

const loadCfg = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_LS_KEY) || 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch {}
  return {};
};
const saveCfg = (cfg) => { try { localStorage.setItem(CONFIG_LS_KEY, JSON.stringify(cfg)); } catch {} };
const loadDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISS_LS_KEY) || '[]')); } catch { return new Set(); } };
const saveDismissed = (set) => { try { localStorage.setItem(DISMISS_LS_KEY, JSON.stringify([...set].slice(0, 500))); } catch {} };

const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB') : '—');

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

const toneCls = {
  success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  danger: 'bg-red-500/15 text-red-400 border border-red-500/30',
  info: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
};

function StatusBadge({ status }) {
  const meta = COMPLIANCE_STATUS_META[status] || COMPLIANCE_STATUS_META.NO_CERTIFICATE;
  return <span className={`badge text-[10px] px-2 py-0.5 rounded-full font-bold ${toneCls[meta.tone] || toneCls.info}`}>{meta.label}</span>;
}

/**
 * Document link that resolves asynchronously: private-bucket objects get a
 * short-lived signed URL via resolveComplianceDocumentUrl, offline data URLs
 * and public objects resolve immediately.
 */
function DocLink({ doc }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    setUrl(doc?.publicUrl || doc?.dataUrl || '');
    resolveComplianceDocumentUrl(doc).then((u) => { if (alive && u) setUrl(u); });
    return () => { alive = false; };
  }, [doc]);
  if (!doc || !url) return <span className="text-slate-600 text-[10px]">unavailable</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
      <FileText size={11} /> {doc.filename || 'document'}
    </a>
  );
}

const inp = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
const inpSelect = 'w-full rounded-control bg-slate-800 border border-white/[0.12] px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-400/60';
const lbl = 'block text-xs text-slate-400 mb-1';

// Category-specific visible fields (register form). Never force irrelevant fields.
const CATEGORY_FIELD_SETS = {
  pressure: ['range_value', 'accuracy', 'unit', 'standard', 'manufacturer', 'model', 'serial_number'],
  lifting: ['swl', 'capacity_value', 'unit', 'standard', 'manufacturer', 'model', 'serial_number'],
  vessels: ['capacity_value', 'unit', 'standard', 'manufacturer', 'model', 'serial_number'],
  ppe: ['standard', 'manufacturer', 'model', 'serial_number'],
  electrical: ['range_value', 'accuracy', 'unit', 'standard', 'manufacturer', 'model', 'serial_number'],
  other: ['standard', 'manufacturer', 'model', 'serial_number'],
};
const FIELD_DEFS = {
  manufacturer: { label: 'Manufacturer' }, model: { label: 'Model' }, serial_number: { label: 'Serial Number' },
  range_value: { label: 'Range (e.g. 0–16 bar)' }, accuracy: { label: 'Accuracy (e.g. ±1%)' },
  capacity_value: { label: 'Capacity' }, unit: { label: 'Unit' },
  swl: { label: 'SWL / Rated Load' }, standard: { label: 'Standard / Procedure / Statutory Requirement' },
};

function EquipmentForm({ initial, plants, currentPlantId, machineCerts, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => ({
    category: 'pressure', customCategory: '', equipmentCode: '', equipmentName: '', equipmentType: '',
    department: '', area: '', manufacturer: '', model: '', serial_number: '', assetTag: '',
    installDate: '', purchaseDate: '', range_value: '', accuracy: '', capacity_value: '', unit: '',
    swl: '', inspectionType: 'Calibration', standard: '', responsibleDepartment: '', responsiblePerson: '',
    frequencyMonths: '', linkedMachineCertId: '',
    ...initial,
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cat = COMPLIANCE_CATEGORIES.find((c) => c.id === form.category) || COMPLIANCE_CATEGORIES[5];
  const visible = CATEGORY_FIELD_SETS[form.category] || CATEGORY_FIELD_SETS.other;
  const plantName = (plants.find((p) => p.id === currentPlantId) || {}).plant_name || '';
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4 p-5 rounded-control bg-white/[0.03] border border-white/[0.08]">
      <h4 className="text-sm font-semibold text-white flex items-center gap-2"><ClipboardList size={14} className="text-cyan-400" />{initial?.id ? 'Edit Equipment' : 'Register Equipment'} — {plantName}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={lbl}>Category *</label><select value={form.category} onChange={set('category')} className={inpSelect} required>{COMPLIANCE_CATEGORIES.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.label}</option>)}</select></div>
        {form.category === 'other' && <div><label className={lbl}>Custom Category *</label><input value={form.customCategory} onChange={set('customCategory')} className={inp} placeholder="e.g. Torque Tools" required /></div>}
        <div><label className={lbl}>Equipment Code *</label><input value={form.equipmentCode} onChange={set('equipmentCode')} className={inp} placeholder="e.g. PG-NAT-001" required /></div>
        <div><label className={lbl}>Equipment Name *</label><input value={form.equipmentName} onChange={set('equipmentName')} className={inp} placeholder="e.g. Pressure Gauge" required /></div>
        <div><label className={lbl}>Type / Description</label><input value={form.equipmentType} onChange={set('equipmentType')} className={inp} /></div>
        <div><label className={lbl}>Department</label><input value={form.department} onChange={set('department')} className={inp} /></div>
        <div><label className={lbl}>Area / Location</label><input value={form.area} onChange={set('area')} className={inp} /></div>
        <div><label className={lbl}>Asset / Tag No.</label><input value={form.assetTag} onChange={set('assetTag')} className={inp} /></div>
        {visible.map((k) => (
          <div key={k}><label className={lbl}>{FIELD_DEFS[k].label}</label><input value={form[k] || ''} onChange={set(k)} className={inp} /></div>
        ))}
        <div><label className={lbl}>Install Date</label><input type="date" value={form.installDate} onChange={set('installDate')} className={inp} /></div>
        <div><label className={lbl}>Purchase Date</label><input type="date" value={form.purchaseDate} onChange={set('purchaseDate')} className={inp} /></div>
        <div><label className={lbl}>Inspection Type</label><input value={form.inspectionType} onChange={set('inspectionType')} className={inp} placeholder="Calibration / Inspection / Test" /></div>
        <div><label className={lbl}>Frequency (months) — default {cat.defaultFreqMonths}</label><input type="number" min="1" value={form.frequencyMonths} onChange={set('frequencyMonths')} className={inp} placeholder={String(cat.defaultFreqMonths)} /></div>
        <div><label className={lbl}>Responsible Dept</label><input value={form.responsibleDepartment} onChange={set('responsibleDepartment')} className={inp} /></div>
        <div><label className={lbl}>Responsible Person</label><input value={form.responsiblePerson} onChange={set('responsiblePerson')} className={inp} /></div>
        <div><label className={lbl}>Serviceability</label><select value={form.serviceability || 'Serviceable'} onChange={set('serviceability')} className={inpSelect}>{['Serviceable', 'Under Maintenance', 'Quarantined', 'Scrapped'].map((s) => <option key={s} value={s} className="bg-slate-900">{s}</option>)}</select></div>
        <div>
          <label className={lbl}>Link Machine Certificate (optional, reference only)</label>
          <select value={form.linkedMachineCertId || ''} onChange={set('linkedMachineCertId')} className={inpSelect}>
            <option value="" className="bg-slate-900">— none —</option>
            {machineCerts.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.certificateNumber} · {c.certificateType} ({c.machineName || c.machineCode})</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><label className={lbl}>Remarks</label><textarea rows={2} value={form.remarks || ''} onChange={set('remarks')} className={inp} /></div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-xs">Cancel</button>}
        <button type="submit" disabled={saving} className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"><Save size={12} /> {saving ? 'Saving...' : (initial?.id ? 'Save Changes' : 'Register')}</button>
      </div>
    </form>
  );
}

function InspectionForm({ equipment, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    inspectionDate: new Date().toISOString().slice(0, 10), certificateNumber: '', agency: '', inspector: '',
    result: 'Pass', issueDate: '', expiryDate: '', nextDueDate: '', observations: '', defects: '',
    correctiveAction: '', closureDetails: '',
  });
  const [docFile, setDocFile] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, _docFile: docFile }); }} className="space-y-4 p-5 rounded-control bg-white/[0.03] border border-white/[0.08]">
      <h4 className="text-sm font-semibold text-white flex items-center gap-2"><Award size={14} className="text-emerald-400" /> New Inspection — {equipment.equipmentCode} (appends to history; old records kept)</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={lbl}>Inspection Date *</label><input type="date" value={form.inspectionDate} onChange={set('inspectionDate')} className={inp} required /></div>
        <div><label className={lbl}>Certificate No.</label><input value={form.certificateNumber} onChange={set('certificateNumber')} className={inp} /></div>
        <div><label className={lbl}>Agency / Laboratory</label><input value={form.agency} onChange={set('agency')} className={inp} /></div>
        <div><label className={lbl}>Inspector / Competent Person</label><input value={form.inspector} onChange={set('inspector')} className={inp} /></div>
        <div><label className={lbl}>Result *</label><select value={form.result} onChange={set('result')} className={inpSelect}>{RESULT_OPTIONS.map((r) => <option key={r} value={r} className="bg-slate-900">{r}</option>)}</select></div>
        <div><label className={lbl}>Issue Date</label><input type="date" value={form.issueDate} onChange={set('issueDate')} className={inp} /></div>
        <div><label className={lbl}>Expiry Date</label><input type="date" value={form.expiryDate} onChange={set('expiryDate')} className={inp} /></div>
        <div><label className={lbl}>Next Due (blank = auto from frequency)</label><input type="date" value={form.nextDueDate} onChange={set('nextDueDate')} className={inp} /></div>
        <div><label className={lbl}>Certificate Document</label><input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(e) => setDocFile(e.target.files?.[0] || null)} className="w-full text-xs text-slate-400 file:mr-3 file:rounded-control file:border-0 file:bg-cyan-500 file:text-white file:px-3 file:py-1.5 file:text-xs" />{docFile && <p className="text-[10px] text-emerald-400 mt-1">{docFile.name}</p>}</div>
        <div className="sm:col-span-2"><label className={lbl}>Observations</label><textarea rows={2} value={form.observations} onChange={set('observations')} className={inp} /></div>
        <div className="sm:col-span-2"><label className={lbl}>Defects (required on Fail)</label><textarea rows={2} value={form.defects} onChange={set('defects')} className={inp} /></div>
        <div><label className={lbl}>Corrective Action</label><textarea rows={2} value={form.correctiveAction} onChange={set('correctiveAction')} className={inp} /></div>
        <div><label className={lbl}>Closure Details</label><textarea rows={2} value={form.closureDetails} onChange={set('closureDetails')} className={inp} /></div>
      </div>
      {form.result === 'Fail' && <p role="alert" className="text-xs text-red-300 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 flex items-center gap-2"><AlertTriangle size={13} /> Fail will flag this item unsafe for authorized review — it will NOT be marked valid.</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-xs">Cancel</button>}
        <button type="submit" disabled={saving} className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"><Save size={12} /> {saving ? 'Saving...' : 'Append to History'}</button>
      </div>
    </form>
  );
}

export default function Compliance() {
  const { user } = useAuth();
  const { plants, authorizedPlants, currentPlant, currentPlantId } = usePlant();
  const { pushToast } = useUI();
  const rawStore = useStore();
  const userName = user?.full_name || user?.username || 'Admin';
  const canWrite = canUpload(user?.role);
  const corporate = canViewCorporateDashboard(user?.role);

  const [tab, setTab] = useState('dashboard'); // dashboard | register | history | reports | settings | import
  const [reportPlant, setReportPlant] = useState(''); // '' = all authorized (corporate) else current
  const [q, setQ] = useState('');
  const [fCat, setFCat] = useState('');
  const [fDept, setFDept] = useState('');
  const [fArea, setFArea] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPerson, setFPerson] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [page, setPage] = useState(0);
  const [showEqForm, setShowEqForm] = useState(false);
  const [editingEq, setEditingEq] = useState(null);
  const [inspectEq, setInspectEq] = useState(null);
  const [detailEq, setDetailEq] = useState(null);
  const [saving, setSaving] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [cfgTick, setCfgTick] = useState(0);
  // History tab filters.
  const [hQuery, setHQuery] = useState('');
  const [hResult, setHResult] = useState('');
  const [hFrom, setHFrom] = useState('');
  const [hTo, setHTo] = useState('');
  // Import wizard: parse preview before committing.
  const [importFile, setImportFile] = useState(null);
  const [importParsed, setImportParsed] = useState(null);
  const [importDone, setImportDone] = useState(null);

  const settings = useMemo(() => getComplianceSettings(currentPlantId), [currentPlantId, rawStore]);
  const cfg = useMemo(() => ({ dueSoonDays: settings.dueSoonDays, ...(loadCfg()), _t: cfgTick }), [cfgTick, settings]);
  const dueSoonDays = Number(cfg.dueSoonDays) > 0 ? Number(cfg.dueSoonDays) : DUE_SOON_DAYS;
  const customCats = Array.isArray(cfg.customCategories) ? cfg.customCategories : [];
  const freqOverrides = cfg.freqOverrides || {};

  // Scope: corporate may pick a plant (or all authorized); plant users are locked to current plant.
  const scopePlantId = corporate ? (reportPlant || '') : currentPlantId;
  const scoped = useMemo(() => {
    const all = rawStore.complianceEquipment || [];
    const allowed = new Set((corporate ? authorizedPlants : [currentPlant]).filter(Boolean).map((p) => p.id));
    return all.filter((e) => {
      const pid = e.plant_id || e.plantId;
      if (scopePlantId) return pid === scopePlantId || (!pid && scopePlantId === '00000000-0000-0000-0000-000000000001');
      if (!pid) return true;
      return allowed.has(pid);
    });
  }, [rawStore, scopePlantId, corporate, authorizedPlants, currentPlant]);

  const inspectionsByEq = useMemo(() => {
    const map = {};
    (rawStore.complianceInspections || []).forEach((r) => {
      (map[r.equipmentId] = map[r.equipmentId] || []).push(r);
    });
    Object.values(map).forEach((a) => a.sort((x, y) => String(y.inspectionDate || '').localeCompare(String(x.inspectionDate || '')) || String(y.createdAt || '').localeCompare(String(x.createdAt || ''))));
    return map;
  }, [rawStore]);

  const enriched = useMemo(() => scoped.map((e) => {
    const hist = inspectionsByEq[e.id] || [];
    const st = getComplianceEquipmentStatus(e);
    const docs = [];
    const seenDocs = new Set();
    const pushDoc = (d) => {
      if (!d) return;
      const key = d.storagePath || d.publicUrl || d.filename || JSON.stringify(d);
      if (seenDocs.has(key)) return;
      seenDocs.add(key); docs.push(d);
    };
    (Array.isArray(e.documents) ? e.documents : []).forEach(pushDoc);
    if (e.document) pushDoc(e.document);
    hist.forEach((h) => {
      (Array.isArray(h.documents) ? h.documents : []).forEach(pushDoc);
      if (h.document) pushDoc(h.document);
    });
    return {
      ...e,
      _status: st.status, _reason: st.reason, _daysLeft: st.daysLeft, _alertDate: st.alertDate,
      _dueDate: st.dueDate || '', _expiryDate: st.expiryDate || '', _certificateNumber: st.certificateNumber || '',
      _lastResult: hist[0]?.result || '', _lastDate: (hist[0]?.inspectionDate || '').slice(0, 10),
      _certNo: hist[0]?.certificateNumber || '', _agency: hist[0]?.agency || hist[0]?.inspector || '',
      _hasDoc: !!(hist[0]?.document || e.document),
      _history: hist,
      _documents: docs,
    };
  }), [scoped, inspectionsByEq]);

  const filtered = useMemo(() => filterCompliance(enriched, {
    plantId: '', category: fCat, department: fDept, area: fArea, status: fStatus,
    person: fPerson, from: fFrom, to: fTo, query: q,
  }).sort((a, b) => String(a.nextDueDate || '9999').localeCompare(String(b.nextDueDate || '9999'))), [enriched, fCat, fDept, fArea, fStatus, fPerson, fFrom, fTo, q]);

  const summary = useMemo(() => summarizeCompliance(filtered), [filtered]);
  const depts = useMemo(() => [...new Set(enriched.map((e) => e.department).filter(Boolean))].sort(), [enriched]);
  const areas = useMemo(() => [...new Set(enriched.map((e) => e.area).filter(Boolean))].sort(), [enriched]);
  const persons = useMemo(() => [...new Set(enriched.map((e) => e.responsiblePerson).filter(Boolean))].sort(), [enriched]);
  const pageData = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const alerts = useMemo(() => enriched
    .filter((e) => ['OVERDUE', 'FAILED', 'DUE_SOON'].includes(e._status))
    .map((e) => ({ ...e, _dismissKey: `${e.id}:${e._alertDate || e._lastDate}:${e._status}` }))
    .filter((e) => !dismissed.has(e._dismissKey))
    .sort((a, b) => (a._status === 'FAILED' ? -1 : 1)), [enriched, dismissed]);

  const dismissAlert = (key) => { const n = new Set(dismissed); n.add(key); setDismissed(n); saveDismissed(n); };

  const plantNameOf = (pid) => (plants.find((p) => p.id === pid) || {}).plant_name || '';

  // Machine certificates eligible for linking: machines in authorized plants only.
  const linkableCerts = useMemo(() => {
    const allowed = new Set(authorizedPlants.map((p) => p.id));
    const machinePlant = {};
    (rawStore.machines || []).forEach((m) => { machinePlant[m.id] = m.plant_id || m.plantId; });
    return (rawStore.testingCertificates || []).filter((c) => {
      const pid = machinePlant[c.machineId];
      if (!pid) return corporate;
      return allowed.has(pid);
    });
  }, [rawStore, authorizedPlants, corporate]);

  const guardWrite = () => {
    if (!canWrite) { setErr('Your role is read-only for compliance records.'); return false; }
    return true;
  };

  const handleSaveEquipment = async (form) => {
    if (!guardWrite()) return;
    setSaving(true); setErr('');
    try {
      // Explicit value wins; else per-category override from Settings; else built-in default.
      const freq = Number(form.frequencyMonths) > 0 ? Number(form.frequencyMonths)
        : (freqOverrides[form.category] || defaultFreqFor(form.category));
      const payload = { ...form, frequencyMonths: freq };
      if (editingEq) await updateComplianceEquipment(editingEq.id, payload, userName);
      else await addComplianceEquipment(payload, userName);
      setShowEqForm(false); setEditingEq(null);
      pushToast({ type: 'success', message: editingEq ? 'Equipment updated' : 'Equipment registered' });
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleSaveInspection = async (equipment, form) => {
    if (!guardWrite()) return;
    if (form.result === 'Fail' && !String(form.defects || '').trim()) { setErr('Defects are required when the result is Fail.'); return; }
    setSaving(true); setErr('');
    try {
      let doc = null;
      if (form._docFile) {
        if (form._docFile.size > MAX_DOC_BYTES) throw new Error('Document exceeds 10 MB');
        const plantId = equipment.plant_id || equipment.plantId || currentPlantId;
        doc = await uploadComplianceDoc(form._docFile, plantId, equipment.id, `insp-${Date.now()}`, userName);
      }
      const { _docFile, ...rest } = form;
      await addComplianceInspection(equipment.id, doc ? { ...rest, document: doc } : rest, userName);
      setInspectEq(null);
      pushToast({ type: 'success', message: form.result === 'Fail' ? 'Failure recorded — item flagged unsafe' : 'Inspection appended to history' });
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDeleteEquipment = async (eq) => {
    if (!canDelete(user?.role)) { setErr('Only admins can retire compliance equipment.'); return; }
    if (!window.confirm(`Retire ${eq.equipmentCode}? Historical inspections and certificates are retained.`)) return;
    setErr('');
    try {
      await deleteComplianceEquipment(eq.id, userName);
      if (detailEq?.id === eq.id) setDetailEq(null);
      pushToast({ type: 'success', message: 'Equipment retired — history retained' });
    } catch (e) { setErr(e.message || 'Retire failed'); }
  };

  const handleLinkCert = async (eq, certId) => {
    if (!guardWrite()) return;
    const cert = linkableCerts.find((c) => c.id === certId) || null;
    try {
      await linkMachineCertificate(eq.id, cert, userName);
      pushToast({ type: 'success', message: cert ? 'Machine certificate linked (reference only)' : 'Link removed' });
    } catch (e) { setErr(e.message || 'Certificate link failed'); }
  };

  const exportRows = (rows, name) => {
    downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, buildComplianceCsv(rows.map((r) => ({ ...r, plant_name: plantNameOf(r.plant_id || r.plantId) }))));
    pushToast({ type: 'success', message: `Exported ${rows.length} rows` });
  };

  const exportExcel = async (rows) => {
    if (!rows.length) { setErr('Nothing to export yet.'); return; }
    setExcelBusy(true); setErr('');
    try {
      const { downloadComplianceWorkbook } = await import('../lib/complianceExcel.js');
      await downloadComplianceWorkbook({
        equipment: rows.map((r) => ({ ...r, categoryLabel: categoryLabel(r.category, r.customCategory) })),
        historyByEquipment: inspectionsByEq,
        plantNameOf,
        settings,
        generatedBy: userName,
      });
      pushToast({ type: 'success', message: `Excel workbook exported (${rows.length} equipment)` });
    } catch (e) { setErr(e.message || 'Excel export failed'); }
    finally { setExcelBusy(false); }
  };

  // ── Import wizard: parse first for review, then commit ─────────────────────
  const previewImport = async (file) => {
    if (!file) return;
    setImportFile(file); setImportParsed(null); setImportDone(null); setErr('');
    try {
      const { parseComplianceWorkbook } = await import('../lib/complianceExcel.js');
      const parsed = await parseComplianceWorkbook(await file.arrayBuffer());
      setImportParsed(parsed);
      if (!parsed.errors.length && !parsed.equipment.length && !parsed.inspections.length) {
        setErr('Import file has no equipment or history rows.');
      }
    } catch (e) { setErr(e.message || 'Could not read the Excel file'); }
  };

  const commitImport = async (parsed) => {
    if (!canWrite) { setErr('Your role is read-only for compliance records.'); return; }
    const targetPlantId = currentPlantId;
    if (!targetPlantId) { setErr('Select a target plant before importing.'); return; }
    if (parsed.errors.length) { setErr('Fix the problems listed above before importing.'); return; }
    if (!parsed.equipment.length && !parsed.inspections.length) {
      setErr('Import file has no equipment or history rows.');
      return;
    }
    setExcelBusy(true); setErr('');
    try {
      // Equipment is matched plant-scoped by Equipment Code (never by name).
      // The map stays fresh as rows are added so history rows can target
      // equipment created earlier in the same file.
      const codeToId = new Map();
      (rawStore.complianceEquipment || []).forEach((e) => {
        if ((e.plant_id || e.plantId) === targetPlantId) codeToId.set(String(e.equipmentCode || '').toLowerCase(), e);
      });
      const resolveEquipment = (code, recordId) =>
        (recordId && (rawStore.complianceEquipment || []).find((e) => e.id === recordId)) ||
        codeToId.get(String(code || '').toLowerCase()) || null;
      let added = 0; let updated = 0; let historyAdded = 0; let historyCorrected = 0; const rowErrors = [];
      for (const row of parsed.equipment) {
        try {
          const existing = resolveEquipment(row.equipmentCode, row.recordId);
          const patch = {
            ...row,
            plantId: targetPlantId,
            category: row.category || undefined,
          };
          delete patch.recordId; delete patch.plantName;
          if (existing) {
            const { plantId: _ignoredPlant, ...updatePatch } = patch;
            await updateComplianceEquipment(existing.id, updatePatch, userName);
            updated += 1;
          } else {
            const created = await addComplianceEquipment(patch, userName);
            if (created?.id) codeToId.set(String(created.equipmentCode || '').toLowerCase(), created);
            added += 1;
          }
        } catch (e) { rowErrors.push(`${row.equipmentCode}: ${e.message || 'failed'}`); }
      }
      for (const row of parsed.inspections) {
        try {
          const equipment = resolveEquipment(row.equipmentCode, row.plantId);
          if (!equipment) { rowErrors.push(`${row.equipmentCode}: equipment not found in target plant`); continue; }
          const fields = {
            inspectionType: row.inspectionType,
            inspectionDate: row.inspectionDate,
            certificateNumber: row.certificateNumber,
            agency: row.agency,
            competentPerson: row.competentPerson,
            result: row.result,
            issueDate: row.issueDate,
            expiryDate: row.expiryDate,
            expirySource: row.expirySource,
            expiryOverrideReason: row.expiryOverrideReason,
            validityMonths: row.validityMonths,
            validityDays: row.validityDays,
            nextDueDate: row.nextDueDate,
            nextDueOverrideReason: row.nextDueOverrideReason,
            observations: row.observations,
            defects: row.defects,
            correctiveAction: row.correctiveAction,
            correctiveActionOwner: row.correctiveActionOwner,
            correctiveActionDueDate: row.correctiveActionDueDate,
            correctiveActionClosureDate: row.correctiveActionClosureDate,
            closureRemarks: row.closureRemarks,
            uploadedBy: row.uploadedBy || userName,
          };
          const existingHist = row.recordId ? (rawStore.complianceInspections || []).find((h) => h.id === row.recordId || h.inspectionRecordId === row.recordId) : null;
          if (existingHist) {
            await updateComplianceInspection(existingHist.id, fields, userName);
            historyCorrected += 1;
          } else {
            await addComplianceInspection(equipment.id, fields, userName);
            historyAdded += 1;
          }
        } catch (e) { rowErrors.push(`${row.equipmentCode} (${row.inspectionDate}): ${e.message || 'failed'}`); }
      }
      setImportDone({ added, updated, historyAdded, historyCorrected, rowErrors, fileName: importFile?.name || '' });
      if (rowErrors.length) {
        setErr(`Import completed with ${rowErrors.length} row error(s):\n${rowErrors.slice(0, 8).join('\n')}${rowErrors.length > 8 ? '\n…' : ''}`);
      } else {
        setErr('');
      }
      pushToast({ type: 'success', message: `Import finished — ${added} added, ${updated} updated, ${historyAdded} history appended, ${historyCorrected} corrected.` });
    } catch (e) { setErr(e.message || 'Excel import failed'); }
    finally { setExcelBusy(false); }
  };

  const saveConfig = (patch) => { saveCfg({ ...loadCfg(), ...patch }); setCfgTick((t) => t + 1); };

  // ── History tab: flat append-only inspection log across scoped equipment ───
  const historyRows = useMemo(() => {
    const rows = enriched.flatMap((e) => (inspectionsByEq[e.id] || []).map((h) => ({ ...h, _eq: e })));
    const qn = hQuery.trim().toLowerCase();
    return rows.filter((h) => {
      if (hResult && String(h.result || '') !== hResult) return false;
      if (hFrom && String(h.inspectionDate || '').slice(0, 10) < hFrom) return false;
      if (hTo && String(h.inspectionDate || '').slice(0, 10) > hTo) return false;
      if (qn) {
        const hay = [h._eq?.equipmentCode, h._eq?.equipmentName, h.certificateNumber, h.agency, h.inspector, h.competentPerson, h.inspectionType, h.inspectionRecordId, h.recordId].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(qn)) return false;
      }
      return true;
    }).sort((a, b) => String(b.inspectionDate || '').localeCompare(String(a.inspectionDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [enriched, inspectionsByEq, hQuery, hResult, hFrom, hTo]);

  const openCorrectiveOf = (h) => {
    if (h.correctiveActionClosureDate) return <span className="text-emerald-400">Closed {fmtDate(h.correctiveActionClosureDate)}</span>;
    if (String(h.defects || '').trim() || String(h.correctiveAction || '').trim() || String(h.correctiveActionOwner || '').trim()) return <span className="text-amber-400 font-semibold">Open</span>;
    return <span className="text-slate-600">—</span>;
  };

  // Import preview: how many rows will be added vs updated in the target plant.
  const importPreview = useMemo(() => {
    if (!importParsed) return null;
    const byCode = (code) => (rawStore.complianceEquipment || []).find((e) =>
      (e.plant_id || e.plantId) === currentPlantId &&
      String(e.equipmentCode || '').toLowerCase() === String(code).toLowerCase());
    let eqNew = 0; let eqUpd = 0; let histNew = 0; let histUpd = 0; let histMissing = 0;
    importParsed.equipment.forEach((row) => {
      const existing = (row.recordId && (rawStore.complianceEquipment || []).find((e) => e.id === row.recordId)) || byCode(row.equipmentCode);
      if (existing) eqUpd += 1; else eqNew += 1;
    });
    importParsed.inspections.forEach((row) => {
      const equipment = byCode(row.equipmentCode);
      if (!equipment) { histMissing += 1; return; }
      const existingHist = row.recordId ? (rawStore.complianceInspections || []).find((h) => h.id === row.recordId || h.inspectionRecordId === row.recordId) : null;
      if (existingHist) histUpd += 1; else histNew += 1;
    });
    return { eqNew, eqUpd, histNew, histUpd, histMissing };
  }, [importParsed, rawStore, currentPlantId]);

  const downloadTemplate = async () => {
    setExcelBusy(true); setErr('');
    try {
      const { downloadComplianceWorkbook } = await import('../lib/complianceExcel.js');
      await downloadComplianceWorkbook({
        equipment: [], historyByEquipment: {},
        plantNameOf, settings, generatedBy: userName,
      });
      pushToast({ type: 'success', message: 'Blank compliance template downloaded (includes instructions sheet)' });
    } catch (e) { setErr(e.message || 'Template download failed'); }
    finally { setExcelBusy(false); }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3"><ShieldCheck size={28} className="text-cyan-400" /> Inspection, Calibration &amp; Statutory Compliance</h2>
          <p className="text-body mt-1.5">{corporate && !scopePlantId ? 'Consolidated view · authorized plants' : `${currentPlant?.plant_name || ''}`} · {filtered.length} items</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {corporate && (
            <select value={reportPlant} onChange={(e) => setReportPlant(e.target.value)} className="select-field text-xs" aria-label="Report plant">
              <option value="">All authorized plants</option>
              {authorizedPlants.map((p) => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
            </select>
          )}
          {canWrite && (
            <button onClick={() => setTab('import')} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Upload size={13} /> Import Excel</button>
          )}
          <button onClick={() => exportExcel(filtered)} disabled={excelBusy} className="btn-ghost inline-flex items-center gap-1.5 text-xs disabled:opacity-60"><FileSpreadsheet size={13} /> Export Excel</button>
          {canWrite && <button onClick={() => { setEditingEq(null); setShowEqForm(true); }} className="btn-primary inline-flex items-center gap-1.5 text-xs"><Plus size={13} /> Register Equipment</button>}
        </div>
      </div>

      {err && <div role="alert" className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Compliance views">
        {[['dashboard', 'Dashboard'], ['register', 'Register'], ['history', 'History'], ['reports', 'Reports'], ['settings', 'Settings'], ['import', 'Import']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setPage(0); }} className={`text-xs px-3 py-1.5 rounded-control border transition-colors ${tab === id ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.06]'}`}>{label}</button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              ['Total Equipment', summary.total, 'text-white'],
              ['Valid', summary.valid, 'text-emerald-400'],
              [`Due Soon (≤${dueSoonDays}d)`, summary.dueSoon, 'text-amber-400'],
              ['Overdue', summary.overdue, 'text-red-400'],
              ['Failed / Unsafe', summary.failed, 'text-red-400'],
              ['No Certificate', summary.noCert, 'text-slate-400'],
            ].map(([label, value, cls]) => (
              <div key={label} className="glass-card p-4"><p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p><p className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</p></div>
            ))}
          </div>
          <div className="glass-card p-5">
            <h4 className="text-card-title text-sm mb-3 flex items-center gap-2"><AlertTriangle size={14} className="text-amber-400" /> Action Required ({alerts.length})</h4>
            {alerts.length === 0 ? <p className="text-xs text-slate-500">No due, overdue or failed items. New alerts appear here with date and reason.</p> : (
              <div className="overflow-x-auto"><table className="enterprise-table w-full min-w-[760px]">
                <thead><tr><th>Equipment</th><th>Plant</th><th>Status</th><th>Alert Date</th><th>Reason</th><th className="w-24">Actions</th></tr></thead>
                <tbody>{alerts.map((a) => (
                  <tr key={a._dismissKey}>
                    <td className="text-white text-xs font-medium">{a.equipmentCode} · {a.equipmentName}</td>
                    <td className="text-slate-400 text-xs">{plantNameOf(a.plant_id || a.plantId)}</td>
                    <td><StatusBadge status={a._status} /></td>
                    <td className="text-slate-300 text-xs whitespace-nowrap">{fmtDate(a._alertDate)}</td>
                    <td className="text-slate-400 text-xs">{a._reason}</td>
                    <td><button onClick={() => dismissAlert(a._dismissKey)} className="btn-ghost text-[11px] px-2 py-1">Dismiss</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {tab === 'register' && (
        <div className="space-y-4">
          <div className="glass-card p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search code, name, maker…" className={`${inp} col-span-2`} aria-label="Search register" />
            <select value={fCat} onChange={(e) => { setFCat(e.target.value); setPage(0); }} className={inpSelect} aria-label="Category"><option value="">All categories</option>{COMPLIANCE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}{customCats.map((c) => <option key={`c:${c}`} value="other">{c}</option>)}</select>
            <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(0); }} className={inpSelect} aria-label="Status"><option value="">All statuses</option>{Object.keys(COMPLIANCE_STATUS_META).map((s) => <option key={s} value={s}>{COMPLIANCE_STATUS_META[s].label}</option>)}</select>
            <select value={fDept} onChange={(e) => { setFDept(e.target.value); setPage(0); }} className={inpSelect} aria-label="Department"><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            <select value={fArea} onChange={(e) => { setFArea(e.target.value); setPage(0); }} className={inpSelect} aria-label="Area"><option value="">All areas</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select>
            <select value={fPerson} onChange={(e) => { setFPerson(e.target.value); setPage(0); }} className={inpSelect} aria-label="Responsible person"><option value="">All persons</option>{persons.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <input type="date" value={fFrom} onChange={(e) => { setFFrom(e.target.value); setPage(0); }} className={inp} aria-label="Due from" />
            <input type="date" value={fTo} onChange={(e) => { setFTo(e.target.value); setPage(0); }} className={inp} aria-label="Due to" />
          </div>
          <div className="flex justify-end"><button onClick={() => exportRows(filtered, 'compliance-register')} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Download size={13} /> Export CSV ({filtered.length})</button></div>
          {showEqForm && <EquipmentForm plants={plants} currentPlantId={currentPlantId} machineCerts={linkableCerts} onSave={handleSaveEquipment} onCancel={() => setShowEqForm(false)} saving={saving} />}
          {editingEq && <EquipmentForm initial={editingEq} plants={plants} currentPlantId={currentPlantId} machineCerts={linkableCerts} onSave={handleSaveEquipment} onCancel={() => setEditingEq(null)} saving={saving} />}
          {filtered.length === 0 && !showEqForm ? (
            <EmptyState title="No equipment yet" description="Register pressure gauges, lifting tackles, vessels, harnesses and other inspectable items for this plant." actionLabel={canWrite ? 'Register First Equipment' : undefined} onAction={canWrite ? () => setShowEqForm(true) : undefined} />
          ) : (
            <div className="overflow-x-auto"><table className="enterprise-table w-full min-w-[1080px]">
              <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Plant</th><th>Next Due</th><th>Status</th><th>Last Result</th><th className="w-40">Actions</th></tr></thead>
              <tbody>{pageData.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs text-cyan-300">{r.equipmentCode}</td>
                  <td className="text-white text-xs">{r.equipmentName}</td>
                  <td className="text-slate-400 text-xs">{categoryLabel(r.category, r.customCategory)}</td>
                  <td className="text-slate-400 text-xs">{plantNameOf(r.plant_id || r.plantId)}</td>
                  <td className="text-slate-300 text-xs whitespace-nowrap">{fmtDate(r.nextDueDate)}</td>
                  <td><StatusBadge status={r._status} /></td>
                  <td className="text-slate-400 text-xs">{r._lastResult || '—'}</td>
                  <td><div className="flex items-center gap-1">
                    <button onClick={() => setDetailEq(r)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="View history"><Eye size={12} /></button>
                    {canWrite && <button onClick={() => setInspectEq(r)} className="btn-ghost !p-1.5 text-emerald-400 hover:text-emerald-300" aria-label="Add inspection"><Plus size={12} /></button>}
                    {canWrite && <button onClick={() => setEditingEq(r)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit"><Pencil size={12} /></button>}
                    {canDelete(user?.role) && <button onClick={() => handleDeleteEquipment(r)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete"><Trash2 size={12} /></button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Page {page + 1} of {Math.ceil(filtered.length / PAGE_SIZE)}</span>
              <div className="flex gap-2">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-ghost text-xs disabled:opacity-40">Prev</button>
                <button disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage((p) => p + 1)} className="btn-ghost text-xs disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
          {detailEq && (
            <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDetailEq(null)} role="dialog" aria-modal="true" aria-label="Equipment detail">
              <div className="modal-content glass-card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between mb-3">
                  <div><h3 className="text-card-title">{detailEq.equipmentCode} · {detailEq.equipmentName}</h3>
                  <p className="text-meta mt-0.5">{categoryLabel(detailEq.category, detailEq.customCategory)} · {plantNameOf(detailEq.plant_id || detailEq.plantId)}</p></div>
                  <button onClick={() => setDetailEq(null)} className="btn-ghost p-1.5" aria-label="Close"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs mb-4">
                  {[['Department', detailEq.department], ['Area', detailEq.area], ['Make / Model', [detailEq.manufacturer, detailEq.model].filter(Boolean).join(' ')], ['Serial', detailEq.serialNumber], ['Asset/Tag', detailEq.assetTag], ['Range', detailEq.rangeValue], ['Accuracy', detailEq.accuracy], ['Capacity', detailEq.capacityValue], ['Unit', detailEq.unit], ['SWL', detailEq.swl], ['Type', detailEq.inspectionType], ['Standard', detailEq.standard], ['Resp. Dept', detailEq.responsibleDepartment], ['Resp. Person', detailEq.responsiblePerson], ['Frequency', `${detailEq.frequencyMonths} mo`], ['Serviceability', detailEq.serviceability]].map(([k, v]) => (
                    <div key={k} className="rounded-control bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5"><p className="text-[10px] text-slate-500 uppercase">{k}</p><p className="text-slate-200">{v || '—'}</p></div>
                  ))}
                </div>
                {detailEq.linkedMachineCertNumber && <p className="text-xs text-slate-400 mb-3">Linked machine certificate (reference): <span className="text-cyan-300 font-mono">{detailEq.linkedMachineCertNumber}</span> {detailEq.linkedMachineName && <span>· {detailEq.linkedMachineName}</span>}</p>}
                {canWrite && (
                  <div className="flex items-center gap-2 mb-3">
                    <select id="link-cert" defaultValue={detailEq.linkedMachineCertId || ''} onChange={(e) => handleLinkCert(detailEq, e.target.value)} className={`${inpSelect} text-xs`} aria-label="Link machine certificate">
                      <option value="">Link machine certificate…</option>
                      {linkableCerts.map((c) => <option key={c.id} value={c.id}>{c.certificateNumber} · {c.certificateType}</option>)}
                    </select>
                  </div>
                )}
                <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><FileText size={14} className="text-cyan-400" /> Documents ({detailEq._documents.length})</h4>
                {detailEq._documents.length === 0 ? <p className="text-xs text-slate-500 mb-3">No documents attached to this equipment or its inspections.</p> : (
                  <ul className="space-y-1.5 mb-3">{detailEq._documents.map((d, i) => (
                    <li key={d.storagePath || d.publicUrl || i} className="flex items-center gap-2 text-xs">
                      <DocLink doc={d} />
                      <span className="text-slate-500 text-[10px]">{d.uploadedBy ? `· ${d.uploadedBy}` : ''}{d.uploadedAt ? ` · ${new Date(d.uploadedAt).toLocaleDateString('en-GB')}` : ''}</span>
                    </li>
                  ))}</ul>
                )}
                <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><CalendarDays size={14} className="text-cyan-400" /> Inspection History ({detailEq._history.length}) — renewals append, never overwrite</h4>
                {detailEq._history.length === 0 ? <p className="text-xs text-slate-500">No inspections recorded yet.</p> : (
                  <ol className="space-y-2">{detailEq._history.map((h) => (
                    <li key={h.id} className="rounded-control border border-white/[0.08] bg-white/[0.02] p-3 text-xs">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-white font-semibold">{fmtDate(h.inspectionDate)} · <span className={h.result === 'Fail' ? 'text-red-400' : 'text-emerald-400'}>{h.result}</span></span>
                        <span className="font-mono text-cyan-300">{h.certificateNumber || '—'}</span>
                      </div>
                      <p className="text-slate-400 mt-1">{h.agency || h.inspector || ''}{h.expiryDate ? ` · valid till ${fmtDate(h.expiryDate)}` : ''}{h.nextDueDate ? ` · next due ${fmtDate(h.nextDueDate)}` : ''}</p>
                      {(h.observations || h.defects || h.correctiveAction || h.closureDetails) && <p className="text-slate-500 mt-1">{[h.observations, h.defects, h.correctiveAction, h.closureDetails].filter(Boolean).join(' · ')}</p>}
                      {(h.document || (Array.isArray(h.documents) && h.documents.length)) && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {h.document && <DocLink doc={h.document} />}
                          {(Array.isArray(h.documents) ? h.documents : []).map((d, i) => <DocLink key={d.storagePath || d.publicUrl || i} doc={d} />)}
                        </div>
                      )}
                      <p className="text-[10px] text-slate-600 mt-1">By {h.uploadedBy || '—'} · {h.createdAt ? new Date(h.createdAt).toLocaleString('en-GB') : ''}</p>
                    </li>
                  ))}</ol>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-4">
          {[
            ['Plant-wise Compliance', filtered, `compliance-plant-${scopePlantId || 'all'}`],
            ['Upcoming Schedule (by due date)', [...filtered].filter((r) => r.nextDueDate).sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate))), 'compliance-schedule'],
            ['Overdue & Failed', filtered.filter((r) => ['OVERDUE', 'FAILED'].includes(r._status)), 'compliance-overdue-failed'],
            ['Certificate Completeness', filtered, 'compliance-completeness'],
          ].map(([title, rows, name]) => (
            <div key={name} className="glass-card p-5">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-card-title text-sm">{title} ({rows.length})</h4>
                <button onClick={() => exportRows(rows, name)} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Download size={13} /> CSV</button>
              </div>
              <p className="text-xs text-slate-500">
                {name === 'compliance-completeness'
                  ? `${rows.filter((r) => r._hasDoc).length} with documents · ${rows.filter((r) => !r._hasDoc).length} missing`
                  : name === 'compliance-overdue-failed'
                    ? `${rows.filter((r) => r._status === 'OVERDUE').length} overdue (date-passed) · ${rows.filter((r) => r._status === 'FAILED').length} failed/unsafe (inspection outcome)`
                    : `Source: live register${corporate && !scopePlantId ? ', consolidated across authorized plants' : `, ${currentPlant?.plant_name || ''}`}.`}
              </p>
            </div>
          ))}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-card-title text-sm">Inspection History ({scoped.flatMap((e) => inspectionsByEq[e.id] || []).length} events)</h4>
              <button onClick={() => {
                const evts = scoped.flatMap((e) => (inspectionsByEq[e.id] || []).map((h) => ({ ...h, _eq: `${e.equipmentCode} ${e.equipmentName}` })));
                const header = 'Equipment,Date,Certificate,Agency,Result,Expiry,Next Due';
                const csv = [header, ...evts.map((h) => [h._eq, h.inspectionDate, h.certificateNumber, h.agency || h.inspector, h.result, h.expiryDate, h.nextDueDate].map((v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','))].join('\n');
                downloadCsv(`compliance-history-${new Date().toISOString().slice(0, 10)}.csv`, csv);
              }} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Download size={13} /> CSV</button>
            </div>
            <p className="text-xs text-slate-500">Append-only audit trail — renewals never overwrite previous certificates.</p>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="glass-card p-5 space-y-4 max-w-xl">
          <h4 className="text-card-title text-sm">Compliance Settings (this plant)</h4>
          <div><label className={lbl}>Due-soon threshold (days) — synced to Supabase</label><input type="number" min="1" defaultValue={dueSoonDays} id="cfg-due" className={inp} /></div>
          <div>
            <label className={lbl}>Inspection frequency defaults (months per category)</label>
            {COMPLIANCE_CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
              <div key={c.id} className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-slate-400 flex-1">{c.label}</span>
                <input type="number" min="1" defaultValue={freqOverrides[c.id] ?? c.defaultFreqMonths} data-freq={c.id} className={`${inp} !w-24`} />
              </div>
            ))}
          </div>
          <div>
            <label className={lbl}>Additional category</label>
            <div className="flex gap-2">
              <input id="cfg-newcat" className={inp} placeholder="e.g. Torque Tools" />
              <button onClick={() => {
                const el = document.getElementById('cfg-newcat');
                const v = String(el?.value || '').trim();
                if (!v) return;
                const cur = loadCfg();
                const list = Array.isArray(cur.customCategories) ? cur.customCategories : [];
                if (!list.includes(v)) { saveConfig({ customCategories: [...list, v] }); pushToast({ type: 'success', message: `Category "${v}" added` }); }
              }} className="btn-ghost text-xs whitespace-nowrap">Add</button>
            </div>
            {customCats.length > 0 && <p className="text-[11px] text-slate-500 mt-1">Custom: {customCats.join(', ')}</p>}
          </div>
          <button onClick={async () => {
            const due = Number(document.getElementById('cfg-due')?.value);
            const freq = {};
            document.querySelectorAll('[data-freq]').forEach((el) => { const n = Number(el.value); if (Number.isFinite(n) && n > 0) freq[el.dataset.freq] = n; });
            saveConfig({ freqOverrides: freq });
            try {
              await saveComplianceSettings({ dueSoonDays: due > 0 ? due : settings.dueSoonDays }, userName);
              pushToast({ type: 'success', message: 'Compliance settings saved' });
            } catch (e) { setErr(e.message || 'Settings save failed'); }
          }} className="btn-primary text-xs">Save Settings</button>
          <p className="text-[11px] text-slate-500">Notifications: due/overdue/failed items surface in the Dashboard tab with date + reason; dismissing an alert is remembered per item+event so it is not shown twice. Email/WhatsApp push requires the Supabase Edge Function (`send-notification`), which is not deployed — see notificationService fallbacks.</p>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-400 flex items-center gap-2"><History size={14} className="text-cyan-400" /> Append-only inspection log — {historyRows.length} of {enriched.reduce((n, e) => n + (inspectionsByEq[e.id] || []).length, 0)} events · renewals never overwrite previous records.</p>
            {canWrite && enriched.length > 0 && (
              <select
                value=""
                onChange={(e) => { const eq = enriched.find((x) => x.id === e.target.value); if (eq) setInspectEq(eq); }}
                className={`${inpSelect} text-xs max-w-xs`} aria-label="Record inspection for equipment"
              >
                <option value="">Record inspection for…</option>
                {[...enriched].sort((a, b) => String(a.equipmentCode).localeCompare(String(b.equipmentCode))).map((r) => (
                  <option key={r.id} value={r.id}>{r.equipmentCode} · {r.equipmentName}</option>
                ))}
              </select>
            )}
          </div>
          <div className="glass-card p-4 grid grid-cols-2 md:grid-cols-5 gap-2">
            <input value={hQuery} onChange={(e) => setHQuery(e.target.value)} placeholder="Search equipment, certificate, agency…" className={`${inp} col-span-2`} aria-label="Search history" />
            <select value={hResult} onChange={(e) => setHResult(e.target.value)} className={inpSelect} aria-label="Result"><option value="">All results</option>{RESULT_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <input type="date" value={hFrom} onChange={(e) => setHFrom(e.target.value)} className={inp} aria-label="From date" />
            <input type="date" value={hTo} onChange={(e) => setHTo(e.target.value)} className={inp} aria-label="To date" />
          </div>
          {historyRows.length === 0 ? (
            <EmptyState title="No inspection records" description="Record an inspection or import historical certificates via the Import tab." />
          ) : (
            <div className="overflow-x-auto"><table className="enterprise-table w-full min-w-[1080px]">
              <thead><tr><th>Date</th><th>Equipment</th><th>Type</th><th>Certificate</th><th>Agency / Person</th><th>Result</th><th>Expiry</th><th>Next Due</th><th>Corrective</th><th>Record ID</th><th>Document</th></tr></thead>
              <tbody>{historyRows.map((h) => (
                <tr key={h.id}>
                  <td className="text-slate-300 text-xs whitespace-nowrap">{fmtDate(h.inspectionDate)}</td>
                  <td className="text-xs"><button onClick={() => setDetailEq(h._eq)} className="font-mono text-cyan-300 hover:underline">{h._eq?.equipmentCode}</button><span className="text-slate-400"> · {h._eq?.equipmentName}</span></td>
                  <td className="text-slate-400 text-xs">{h.inspectionType || '—'}</td>
                  <td className="font-mono text-xs text-cyan-300">{h.certificateNumber || '—'}</td>
                  <td className="text-slate-400 text-xs">{h.agency || h.competentPerson || h.inspector || '—'}</td>
                  <td><span className={`text-xs font-semibold ${h.result === 'Fail' ? 'text-red-400' : h.result === 'Conditional Pass' ? 'text-amber-400' : 'text-emerald-400'}`}>{h.result}</span></td>
                  <td className="text-slate-300 text-xs whitespace-nowrap">{fmtDate(h.expiryDate)}</td>
                  <td className="text-slate-300 text-xs whitespace-nowrap">{fmtDate(h.nextDueDate)}</td>
                  <td className="text-xs">{openCorrectiveOf(h)}</td>
                  <td className="font-mono text-[10px] text-slate-500">{h.inspectionRecordId || h.recordId || '—'}</td>
                  <td className="text-xs">{(h.document || (Array.isArray(h.documents) && h.documents.length)) ? <DocLink doc={h.document || (h.documents || [])[0]} /> : <span className="text-slate-600">—</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-4 max-w-4xl">
          {!canWrite && <div className="rounded-control border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Your role is read-only — importing is disabled.</div>}
          <div className="glass-card p-5">
            <h4 className="text-card-title text-sm mb-2 flex items-center gap-2"><Info size={14} className="text-cyan-400" /> How import works</h4>
            <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4">
              <li>Target plant is always your current plant — <span className="text-white">{currentPlant?.plant_name || '—'}</span>. Corporate users: switch plants before importing.</li>
              <li>Equipment rows match by <span className="text-white">Equipment Code</span> within that plant (never by name). Rows with a Record ID update that record.</li>
              <li>History rows without a Record ID are appended; rows with a Record ID correct the existing record (audited, original kept in history).</li>
              <li>Nothing is committed until you review the preview below and press Import.</li>
            </ul>
            <button onClick={downloadTemplate} disabled={excelBusy} className="btn-ghost inline-flex items-center gap-1.5 text-xs mt-3 disabled:opacity-60"><Download size={13} /> Download blank template (.xlsx)</button>
          </div>

          <div className="glass-card p-5">
            <h4 className="text-card-title text-sm mb-2 flex items-center gap-2"><FileSpreadsheet size={14} className="text-emerald-400" /> 1 · Select file</h4>
            {canWrite && (
              <label className={`btn-primary inline-flex items-center gap-1.5 text-xs cursor-pointer ${excelBusy ? 'opacity-60 pointer-events-none' : ''}`}>
                <Upload size={13} /> {importFile ? 'Choose another file' : 'Choose Excel file'}
                <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) previewImport(file); }} />
              </label>
            )}
            {importFile && <p className="text-xs text-slate-400 mt-2">{importFile.name} · {(importFile.size / 1024).toFixed(0)} KB</p>}
          </div>

          {importParsed && (
            <div className="glass-card p-5">
              <h4 className="text-card-title text-sm mb-2 flex items-center gap-2"><Eye size={14} className="text-cyan-400" /> 2 · Review preview</h4>
              {importParsed.errors.length > 0 ? (
                <div className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 whitespace-pre-line">Import blocked — {importParsed.errors.length} problem(s):{'\n'}{importParsed.errors.slice(0, 10).join('\n')}{importParsed.errors.length > 10 ? '\n…' : ''}</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3"><p className="text-[10px] text-slate-500 uppercase">Equipment — add</p><p className="text-xl font-bold text-emerald-400 tabular-nums">{importPreview.eqNew}</p></div>
                    <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3"><p className="text-[10px] text-slate-500 uppercase">Equipment — update</p><p className="text-xl font-bold text-cyan-400 tabular-nums">{importPreview.eqUpd}</p></div>
                    <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3"><p className="text-[10px] text-slate-500 uppercase">History — append</p><p className="text-xl font-bold text-emerald-400 tabular-nums">{importPreview.histNew}</p></div>
                    <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3"><p className="text-[10px] text-slate-500 uppercase">History — correct</p><p className="text-xl font-bold text-amber-400 tabular-nums">{importPreview.histUpd}</p></div>
                  </div>
                  {importPreview.histMissing > 0 && <p className="text-xs text-amber-300 mb-3">{importPreview.histMissing} history row(s) reference equipment codes not in this file or plant — register the equipment first or the rows will be reported as errors.</p>}
                  <button onClick={() => commitImport(importParsed)} disabled={excelBusy} className="btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-60">
                    <Upload size={13} /> {excelBusy ? 'Importing…' : `Import ${importParsed.equipment.length + importParsed.inspections.length} rows`}
                  </button>
                </>
              )}
            </div>
          )}

          {importDone && (
            <div className="glass-card p-5">
              <h4 className="text-card-title text-sm mb-2 flex items-center gap-2"><ClipboardList size={14} className="text-emerald-400" /> 3 · Result</h4>
              <p className="text-xs text-slate-300">{importDone.fileName} — {importDone.added} equipment added · {importDone.updated} updated · {importDone.historyAdded} history appended · {importDone.historyCorrected} corrected.</p>
              {importDone.rowErrors.length > 0 && <p className="text-xs text-amber-300 mt-1 whitespace-pre-line">{importDone.rowErrors.slice(0, 8).join('\n')}{importDone.rowErrors.length > 8 ? '\n…' : ''}</p>}
            </div>
          )}
        </div>
      )}

      {inspectEq && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setInspectEq(null)} role="dialog" aria-modal="true" aria-label="Record inspection">
          <div className="modal-content glass-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <InspectionForm equipment={inspectEq} onSave={(f) => handleSaveInspection(inspectEq, f)} onCancel={() => setInspectEq(null)} saving={saving} />
          </div>
        </div>
      )}
    </div>
  );
}
