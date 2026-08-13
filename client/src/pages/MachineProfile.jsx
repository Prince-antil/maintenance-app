import { useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import {
  useStore, updateMachine, addMachineDoc, removeMachineDoc,
  addSparePart, removeSparePart, addMachinePhoto, removeMachinePhoto, syncMachineRecordNow,
  addMachineBreakdownLog, deleteMachineBreakdownLog,
} from '../store.js';
import { machineHealth, aggregateBreakdownRecords, aggregatePMRecords, summaryMonthKey, formatPeriodKey, lastNMonths, monthKey } from '../analytics.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AmcTab, { getAmcAlertCount } from '../components/AmcTab.jsx';
import { removeStoredDocument, uploadMachineAttachment } from '../lib/documentStorage.js';
import { getDocumentUrl, toPreviewDocument } from '../lib/documentLinks.js';
import { MACHINE_DOC_TABS, EXT_META, ALLOWED_EXT, PLANT_SECTIONS } from '../constants.js';
import { timeAgo } from '../utils.js';
import {
  ArrowLeft, Cog, MapPin, Upload, Eye, Download, Trash2, FileText, AlertCircle,
  QrCode, Pencil, X, Save, HeartPulse, Timer, AlertOctagon, Wrench, Package,
  Plus, Image as ImageIcon, History, ClipboardCheck, Filter, ShieldCheck,
  CalendarDays,
} from 'lucide-react';

const MEDIA_EXT = ['.mp4', '.webm', '.mov'];
const MAX_DOC_BYTES = 4 * 1024 * 1024;
const MAX_IMG_BYTES = 2 * 1024 * 1024;

const SPEC_FIELDS = [
  { key: 'machineCode', label: 'Machine ID / Code' },
  { key: 'department', label: 'Department' },
  { key: 'area', label: 'Area / Location' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'serialNumber', label: 'Serial Number' },
  { key: 'installDate', label: 'Installation Date', type: 'date' },
  { key: 'powerRating', label: 'Power Rating' },
  { key: 'voltage', label: 'Voltage' },
  { key: 'current', label: 'Full-Load Current' },
  { key: 'runningHours', label: 'Running Hours', type: 'number' },
];

const EXTRA_TABS = [
  { id: 'spares',  label: 'Spare Parts' },
  { id: 'photos',  label: 'Photos' },
  { id: 'history', label: 'Maintenance History' },
  { id: 'bdLogs',  label: 'Breakdown Log' },
];

const healthText = (h) => (h >= 75 ? 'text-emerald-400' : h >= 50 ? 'text-amber-400' : 'text-red-400');
const healthBar = (h) => (h >= 75 ? 'bg-emerald-400' : h >= 50 ? 'bg-amber-400' : 'bg-red-400');

/** Inline editor for the full machine specification sheet. */
function EditSpecsModal({ machine, userName, onClose }) {
  const [form, setForm] = useState(() => ({
    name: machine.name, section: machine.section,
    ...Object.fromEntries(SPEC_FIELDS.map((f) => [f.key, machine[f.key] ?? ''])),
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    updateMachine(machine.id, { ...form, runningHours: Number(form.runningHours) || 0 }, userName);
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Edit machine specifications">
      <div className="modal-content glass-card p-6 w-full max-w-2xl max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-card-title flex items-center gap-2"><Pencil size={15} className="text-cyan-400" aria-hidden="true" /> Edit Machine Specifications</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="es-name">Machine Name *</label>
            <input id="es-name" type="text" className="input-field" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="es-section">Plant Section</label>
            <select id="es-section" className="select-field" value={form.section} onChange={set('section')}>
              {PLANT_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {SPEC_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor={`es-${f.key}`}>{f.label}</label>
              <input id={`es-${f.key}`} type={f.type || 'text'} className="input-field" value={form[f.key]} onChange={set(f.key)} />
            </div>
          ))}
          <div className="sm:col-span-2 flex justify-end gap-2 mt-1">
            <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button type="submit" className="btn-primary text-xs inline-flex items-center gap-1.5"><Save size={13} aria-hidden="true" /> Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Machine profile — nameplate specs, QR identity, live health, documents,
 * spare parts, photo gallery and full maintenance history.
 */
export default function MachineProfile() {
  const { machineId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openPreview, pushToast } = useUI();
  const store = useStore();

  const machine = store.machines.find((m) => m.id === machineId) || null;
  const [tab, setTab] = useState('sop');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [spareForm, setSpareForm] = useState({ name: '', partCode: '', qty: '', remarks: '' });
  // History tab filters
  const [histMonthFilter, setHistMonthFilter] = useState('');
  const [histSectionFilter, setHistSectionFilter] = useState('');
  // Breakdown log tab filters
  const [bdLogMonthFilter, setBdLogMonthFilter] = useState('');
  // New manual breakdown log form
  const [bdLogForm, setBdLogForm] = useState({ startTime: '', endTime: '', date: new Date().toISOString().slice(0, 10), downtimeHours: '', failureCause: '', actionTaken: '', status: 'closed', remarks: '' });
  const [downtimeManual, setDowntimeManual] = useState(false);
  const fileRef = useRef(null);
  const photoRef = useRef(null);

  // ── derive available month options from section data ──────────────────────
  const historyMonthOptions = useMemo(() => {
    const section = histSectionFilter || machine?.section || '';
    const bdPeriods = store.breakdowns
      .filter((r) => !section || r.section === section)
      .map((r) => summaryMonthKey(r));
    const pmPeriods = store.pms
      .filter((r) => !section || r.section === section)
      .map((r) => summaryMonthKey(r));
    const all = [...new Set([...bdPeriods, ...pmPeriods])].filter(Boolean).sort((a, b) => b.localeCompare(a));
    return all;
  }, [store.breakdowns, store.pms, machine, histSectionFilter]);

  // ── unique sections from data (for section override filter) ───────────────
  const historySectionOptions = useMemo(() => {
    const all = [...new Set([
      ...store.breakdowns.map((r) => r.section),
      ...store.pms.map((r) => r.section),
    ])].filter(Boolean).sort();
    return all;
  }, [store.breakdowns, store.pms]);

  const stats = useMemo(() => {
    if (!machine) return null;

    // Health uses unfiltered 90-day window (spec: health is always live)
    const health = machineHealth(machine, store.breakdowns, store.pms);

    // Per-machine breakdown logs — filtered by this machine, sorted newest first
    const machineLogs = (store.machineBreakdownLogs || []).filter((l) => l.machineId === machine.id);
    const breakdownHistory = [...machineLogs]
      .filter((l) => !histMonthFilter || (l.date || '').slice(0, 7) === histMonthFilter)
      .sort((a, b) => (b.date || b.startTime || '').localeCompare(a.date || a.startTime || ''));

    // Section PM history — still section-level (PMs are logged per section)
    const effectiveSection = histSectionFilter || machine.section;
    const pmHistory = [...store.pms]
      .filter((r) =>
        r.section === effectiveSection &&
        (!histMonthFilter || summaryMonthKey(r) === histMonthFilter)
      )
      .sort((a, b) => (b.period || '').localeCompare(a.period || ''));

    // KPIs derived from actual per-machine breakdown logs
    const bdCount = breakdownHistory.length;
    const totalDowntime = breakdownHistory.reduce((sum, l) => sum + (l.downtimeHours || 0), 0);
    const avgMttr = bdCount > 0 ? Math.round((totalDowntime / bdCount) * 100) / 100 : 0;

    return {
      health,
      breakdownCount: bdCount,
      downtimeHours: Math.round(totalDowntime * 100) / 100,
      mttr: avgMttr,
      mtbf: 0,
      pmDone: 0,
      pmPlanned: 0,
      pmCompliance: 0,
      breakdownHistory,
      pmHistory,
      history: [
        ...breakdownHistory.map((r) => ({
          id: r.id,
          kind: 'breakdown',
          ts: r.createdAt,
          period: r.date || (r.startTime || '').slice(0, 10),
          title: `Breakdown — ${r.date || (r.startTime || '').slice(0, 10)}`,
          detail: `${r.failureCause || 'No cause recorded'} · ${r.downtimeHours || 0}h downtime${r.actionTaken ? ' · ' + r.actionTaken : ''}${r.remarks ? ' · ' + r.remarks : ''}`,
          status: r.status || 'closed',
        })),
        ...pmHistory.map((r) => ({
          id: r.id,
          kind: 'pm',
          ts: r.createdAt,
          period: r.period,
          title: `PM Summary — ${formatPeriodKey(r.period, true)}`,
          detail: `Planned ${r.plannedCount} · Done ${r.doneCount} · Pending ${r.pendingCount} · Compliance ${r.compliancePct}%${r.remarks ? ' · ' + r.remarks : ''}`,
          status: r.doneCount >= r.plannedCount ? 'completed' : 'pending',
        })),
      ].sort((a, b) => (b.period || '').localeCompare(a.period || '')),
    };
  }, [machine, store.machineBreakdownLogs, store.breakdowns, store.pms, histMonthFilter, histSectionFilter]);

  if (!machine) {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState
          title="Machine not found"
          description="This machine profile may have been removed."
          actionLabel="Back to Machine Register"
          onAction={() => navigate('/machines')}
        />
      </div>
    );
  }

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const docs = (machine.docs || []).filter((d) => d.tab === tab);

  // AMC alert count — drives the badge on the AMC tab
  const amcAlerts = getAmcAlertCount(store.amc, machine.id);
  // Per-machine breakdown log count
  const bdLogs = (store.machineBreakdownLogs || []).filter((l) => l.machineId === machine.id);

  const tabCounts = {
    ...Object.fromEntries(MACHINE_DOC_TABS.map((t) => [t.id, (machine.docs || []).filter((d) => d.tab === t.id).length])),
    // AMC tab: show alert count when > 0, otherwise contract count
    amc: amcAlerts > 0 ? `⚠ ${amcAlerts}` : (store.amc || []).filter((r) => r.machineId === machine.id).length,
    spares:  (machine.spares || []).length,
    photos:  (machine.photos || []).length,
    history: (stats?.breakdownHistory?.length || 0) + (stats?.pmHistory?.length || 0),
    bdLogs:  bdLogs.length,
  };
  const acceptExt = tab === 'media' ? [...MEDIA_EXT, ...ALLOWED_EXT] : ALLOWED_EXT;
  const qrValue = `${window.location.origin}/machines/${machine.id}`;

  const handleFile = async (f) => {
    if (!f) return;
    setError('');
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!acceptExt.includes(ext)) {
      setError(`Invalid file type. Allowed: ${acceptExt.join(', ')}`);
      return;
    }
    if (f.size > MAX_DOC_BYTES) {
      setError('File exceeds the 4 MB machine attachment limit. Upload large files via a report category instead.');
      return;
    }
    let uploadedDoc = null;
    try {
      setUploading(true);
      uploadedDoc = await uploadMachineAttachment({
        file: f,
        machineId: machine.id,
        plantSection: machine.section,
        tab,
        uploadedBy: userName,
      });
      addMachineDoc(machine.id, uploadedDoc, userName);
      await syncMachineRecordNow(machine.id);
      pushToast({
        type: 'success',
        title: 'Document uploaded',
        message: `${f.name} is now stored in the shared document repository for ${machine.name}.`,
      });
    } catch (uploadError) {
      if (uploadedDoc?.storage_path) {
        try {
          await removeStoredDocument(uploadedDoc.storage_path);
        } catch {
          // Keep the original sync error visible to the user.
        }
        removeMachineDoc(machine.id, uploadedDoc.id);
      }
      setError(uploadError.message || 'Failed to upload file.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (doc) => {
    try {
      await removeStoredDocument(doc.storage_path);
    } catch (removeError) {
      pushToast({
        type: 'error',
        title: 'Storage cleanup failed',
        message: removeError.message || 'The document metadata was removed, but cloud storage cleanup failed.',
      });
    }
    removeMachineDoc(machine.id, doc.id);
  };

  const handlePhoto = (f) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) { setError('Only image files are allowed in the photo gallery.'); return; }
    if (f.size > MAX_IMG_BYTES) { setError('Photo exceeds the 2 MB limit — compress it and retry.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      addMachinePhoto(machine.id, { name: f.name, dataUrl: reader.result, addedBy: userName });
      pushToast({
        type: 'success',
        title: 'Photo saved',
        message: `${f.name} was saved to persistent storage for ${machine.name}.`,
      });
    };
    reader.readAsDataURL(f);
  };

  const handleAddSpare = (e) => {
    e.preventDefault();
    if (!spareForm.name.trim()) return;
    addSparePart(machine.id, { ...spareForm, qty: Number(spareForm.qty) || 0 });
    setSpareForm({ name: '', partCode: '', qty: '', remarks: '' });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate('/machines')}
          className="mt-1.5 w-9 h-9 rounded-control border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-white/25 transition-all flex-shrink-0"
          aria-label="Back to machine register"
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-page-title flex items-center gap-3 flex-wrap">
            <Cog size={26} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
            {machine.name}
            {machine.machineCode && <span className="text-cyan-400/80 text-sm font-mono font-normal">{machine.machineCode}</span>}
          </h2>
          <p className="text-body mt-1 flex items-center gap-1.5">
            <MapPin size={12} aria-hidden="true" /> {machine.section}{machine.department ? ` · ${machine.department}` : ''}{machine.area ? ` · ${machine.area}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <button onClick={() => setShowQR((v) => !v)} className="btn-ghost inline-flex items-center gap-1.5 text-xs" aria-expanded={showQR}>
            <QrCode size={13} aria-hidden="true" /> QR
          </button>
          {isAdmin && (
            <button onClick={() => setEditing(true)} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
              <Pencil size={13} aria-hidden="true" /> Edit
            </button>
          )}
          {isAdmin ? (
            <select
              className="select-field !w-auto text-xs"
              value={machine.status}
              onChange={(e) => updateMachine(machine.id, { status: e.target.value }, userName)}
              aria-label="Machine status"
            >
              <option value="running">Running</option>
              <option value="maintenance">Under Maintenance</option>
              <option value="breakdown">Breakdown</option>
              <option value="standby">Standby</option>
            </select>
          ) : (
            <StatusBadge status={machine.status} pulse={machine.status === 'breakdown'} />
          )}
        </div>
      </div>

      {/* Live stats + spec sheet + QR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-card-title">Nameplate & Specifications</h3>
            <StatusBadge status={machine.status} pulse={machine.status === 'breakdown'} />
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3.5">
            {SPEC_FIELDS.map((f) => (
              <div key={f.key}>
                <dt className="text-slate-500 text-[10px] uppercase tracking-wider">{f.label}</dt>
                <dd className="text-slate-200 text-[13px] font-medium mt-0.5 break-words">
                  {f.key === 'runningHours'
                    ? `${Number(machine.runningHours || 0).toLocaleString()} hrs`
                    : machine[f.key] || <span className="text-slate-600">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="glass-card p-5 flex flex-col gap-4">
          {/* Auto-computed health */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
                <HeartPulse size={12} aria-hidden="true" /> Machine Health
              </span>
              <span className={`text-lg font-bold ${healthText(stats.health)}`}>{stats.health}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden" role="progressbar" aria-valuenow={stats.health} aria-valuemin={0} aria-valuemax={100} aria-label="Machine health">
              <div className={`h-full rounded-full transition-all duration-500 ${healthBar(stats.health)}`} style={{ width: `${stats.health}%` }} />
            </div>
            <p className="text-slate-600 text-[10px] mt-1.5">Derived from 90-day failures, downtime & PM discipline</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 text-center">
            <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-2.5">
              <p className="text-white text-base font-bold flex items-center justify-center gap-1"><AlertOctagon size={13} className="text-red-400" aria-hidden="true" />{stats.breakdownCount}</p>
              <p className="text-slate-500 text-[10px] mt-0.5">Breakdowns</p>
            </div>
            <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-2.5">
              <p className="text-white text-base font-bold flex items-center justify-center gap-1"><Timer size={13} className="text-amber-400" aria-hidden="true" />{stats.downtimeHours}h</p>
              <p className="text-slate-500 text-[10px] mt-0.5">Downtime</p>
            </div>
            <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-2.5">
              <p className="text-white text-base font-bold flex items-center justify-center gap-1"><Wrench size={13} className="text-cyan-400" aria-hidden="true" />{stats.mttr}h</p>
              <p className="text-slate-500 text-[10px] mt-0.5">MTTR</p>
            </div>
            <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-2.5">
              <p className="text-white text-base font-bold flex items-center justify-center gap-1"><ClipboardCheck size={13} className="text-emerald-400" aria-hidden="true" />{stats.pmDone}</p>
              <p className="text-slate-500 text-[10px] mt-0.5">PM Done</p>
            </div>
          </div>
          {showQR && (
            <div className="flex flex-col items-center gap-2 rounded-control bg-white p-4">
              <QRCodeSVG value={qrValue} size={140} level="M" aria-label={`QR code for ${machine.name}`} />
              <p className="text-slate-700 text-[10px] font-medium text-center">{machine.machineCode || machine.name}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs: documents + spares + photos + history */}
      <div className="glass-card overflow-hidden">
        <div className="flex overflow-x-auto border-b border-white/[0.06]" role="tablist" aria-label="Machine records">
          {[...MACHINE_DOC_TABS, ...EXTRA_TABS].map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => { setTab(t.id); setError(''); }}
              className={`flex items-center gap-2 px-4 lg:px-5 py-3.5 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id ? 'border-cyan-400 text-white bg-cyan-500/5' : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {t.id === 'amc' && amcAlerts > 0 && <ShieldCheck size={13} className="text-amber-400" aria-hidden="true" />}
              {t.label}
              <span className={`badge ${
                t.id === 'amc' && amcAlerts > 0
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : tab === t.id
                    ? 'bg-cyan-500/15 text-cyan-400'
                    : 'bg-slate-700/60 text-slate-400'
              }`}>
                {tabCounts[t.id]}
              </span>
            </button>
          ))}
        </div>

        <div className="p-4 lg:p-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2 mb-4" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}

          {/* ---- Spare parts ---- */}
          {tab === 'spares' && (
            <div className="space-y-4">
              {isAdmin && (
                <form onSubmit={handleAddSpare} className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                  <input type="text" className="input-field" placeholder="Spare part name *" value={spareForm.name} onChange={(e) => setSpareForm((s) => ({ ...s, name: e.target.value }))} aria-label="Spare part name" />
                  <input type="text" className="input-field" placeholder="Part code" value={spareForm.partCode} onChange={(e) => setSpareForm((s) => ({ ...s, partCode: e.target.value }))} aria-label="Part code" />
                  <input type="number" min="0" className="input-field" placeholder="Qty in stock" value={spareForm.qty} onChange={(e) => setSpareForm((s) => ({ ...s, qty: e.target.value }))} aria-label="Quantity" />
                  <input type="text" className="input-field" placeholder="Remarks" value={spareForm.remarks} onChange={(e) => setSpareForm((s) => ({ ...s, remarks: e.target.value }))} aria-label="Remarks" />
                  <button type="submit" className="btn-success text-xs inline-flex items-center justify-center gap-1.5"><Plus size={13} aria-hidden="true" /> Add Spare</button>
                </form>
              )}
              {(machine.spares || []).length === 0 ? (
                <EmptyState title="No spare parts listed" description="Maintain the critical spares list for this machine so the store can plan inventory." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="enterprise-table w-full">
                    <thead><tr><th>Part Name</th><th>Code</th><th>Qty</th><th>Remarks</th>{isAdmin && <th className="w-10" aria-label="Actions" />}</tr></thead>
                    <tbody>
                      {machine.spares.map((s) => (
                        <tr key={s.id}>
                          <td className="text-white font-medium">{s.name}</td>
                          <td className="font-mono text-xs">{s.partCode || '—'}</td>
                          <td>{s.qty}</td>
                          <td className="text-slate-400">{s.remarks || '—'}</td>
                          {isAdmin && (
                            <td>
                              <button onClick={() => removeSparePart(machine.id, s.id)} className="text-slate-500 hover:text-red-400 p-1" aria-label={`Remove ${s.name}`}>
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ---- Photo gallery ---- */}
          {tab === 'photos' && (
            <div className="space-y-4">
              {isAdmin && (
                <div className="flex items-center gap-3">
                  <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { handlePhoto(e.target.files[0]); e.target.value = ''; }} />
                  <button onClick={() => photoRef.current?.click()} className="btn-success text-xs inline-flex items-center gap-1.5">
                    <ImageIcon size={13} aria-hidden="true" /> Add Photo
                  </button>
                  <p className="text-meta">JPG / PNG · up to 2 MB</p>
                </div>
              )}
              {(machine.photos || []).length === 0 ? (
                <EmptyState title="No photos yet" description="Add nameplate, installation and condition photos for quick field reference." />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {machine.photos.map((p) => (
                    <figure key={p.id} className="group relative rounded-control overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                      <img src={p.dataUrl} alt={p.name} className="w-full h-36 object-cover" loading="lazy" />
                      <figcaption className="px-2.5 py-1.5 text-[10px] text-slate-400 truncate">{p.name}</figcaption>
                      {isAdmin && (
                        <button
                          onClick={() => removeMachinePhoto(machine.id, p.id)}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/60 text-red-400 p-1.5 rounded-lg transition-opacity"
                          aria-label={`Delete photo ${p.name}`}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---- Maintenance history ---- */}
          {tab === 'history' && (
            <div className="space-y-5">
              {/* Filter bar */}
              <div className="flex flex-col sm:flex-row gap-2.5 p-3 rounded-control bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-2 text-slate-400 text-xs shrink-0">
                  <Filter size={13} aria-hidden="true" /> Filters:
                </div>
                <select
                  className="select-field !py-1 text-xs flex-1"
                  value={histMonthFilter}
                  onChange={(e) => setHistMonthFilter(e.target.value)}
                  aria-label="Filter by month"
                >
                  <option value="">All Months</option>
                  {historyMonthOptions.map((m) => (
                    <option key={m} value={m}>{formatPeriodKey(m, true)}</option>
                  ))}
                </select>
                {(histMonthFilter) && (
                  <button
                    className="btn-ghost text-xs !py-1 shrink-0"
                    onClick={() => { setHistMonthFilter(''); }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Filtered KPI bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: 'Breakdowns', value: stats.breakdownCount, icon: <AlertOctagon size={12} className="text-red-400" /> },
                  { label: 'Downtime (hrs)', value: stats.downtimeHours, icon: <Timer size={12} className="text-amber-400" /> },
                  { label: 'MTTR (hrs)', value: stats.mttr, icon: <Wrench size={12} className="text-cyan-400" /> },
                  { label: 'MTBF (hrs)', value: stats.mtbf, icon: <History size={12} className="text-violet-400" /> },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                    <p className="text-white text-base font-bold flex items-center justify-center gap-1.5">{kpi.icon}{kpi.value}</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">{kpi.label}</p>
                  </div>
                ))}
              </div>

              {/* ── Breakdown History ── */}
              <section>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-2.5">
                  <AlertOctagon size={13} className="text-red-400" aria-hidden="true" />
                  Breakdown History
                  <span className="badge bg-red-500/15 text-red-400">{stats.breakdownHistory.length}</span>
                </h4>
                {stats.breakdownHistory.length === 0 ? (
                  <p className="text-slate-500 text-xs py-3 pl-1">No breakdown logs for this machine.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="enterprise-table w-full min-w-[700px]">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Start Time</th>
                          <th>End Time</th>
                          <th>Downtime (hrs)</th>
                          <th>Failure Cause</th>
                          <th>Action Taken</th>
                          <th>Status</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.breakdownHistory.map((r) => (
                          <tr key={r.id}>
                            <td className="text-white font-medium whitespace-nowrap">{r.date || '—'}</td>
                            <td className="text-slate-300 whitespace-nowrap">{r.startTime ? new Date(r.startTime).toLocaleString() : '—'}</td>
                            <td className="text-slate-300 whitespace-nowrap">{r.endTime ? new Date(r.endTime).toLocaleString() : '—'}</td>
                            <td className="text-amber-300 font-semibold">{r.downtimeHours || 0}</td>
                            <td className="text-slate-300 max-w-[180px] truncate" title={r.failureCause}>{r.failureCause || '—'}</td>
                            <td className="text-slate-300 max-w-[180px] truncate" title={r.actionTaken}>{r.actionTaken || '—'}</td>
                            <td>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                r.status === 'closed' ? 'bg-emerald-500/15 text-emerald-400' :
                                r.status === 'open' ? 'bg-red-500/15 text-red-400' :
                                'bg-amber-500/15 text-amber-400'
                              }`}>{r.status || 'closed'}</span>
                            </td>
                            <td className="text-slate-400 max-w-[150px] truncate" title={r.remarks}>{r.remarks || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* ── PM History ── */}
              <section>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2 mb-2.5">
                  <ClipboardCheck size={13} className="text-emerald-400" aria-hidden="true" />
                  PM History
                  <span className="badge bg-emerald-500/15 text-emerald-400">{stats.pmHistory.length}</span>
                </h4>
                {stats.pmHistory.length === 0 ? (
                  <p className="text-slate-500 text-xs py-3 pl-1">No PM records for this filter.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="enterprise-table w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th>Period</th>
                          <th>Plant Section</th>
                          <th>Planned</th>
                          <th>Done</th>
                          <th>Pending</th>
                          <th>Compliance %</th>
                          <th>Schedule Adherence</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.pmHistory.map((r) => {
                          const adherence = r.plannedCount > 0
                            ? Math.round((r.doneCount / r.plannedCount) * 100)
                            : 0;
                          const adherenceColor = adherence >= 90
                            ? 'text-emerald-400'
                            : adherence >= 75
                              ? 'text-amber-400'
                              : 'text-red-400';
                          return (
                            <tr key={r.id}>
                              <td className="text-white font-medium whitespace-nowrap">{formatPeriodKey(r.period, true)}</td>
                              <td className="text-slate-300 max-w-[180px] truncate" title={r.section}>{r.section}</td>
                              <td className="text-slate-200">{r.plannedCount}</td>
                              <td className="text-emerald-300 font-semibold">{r.doneCount}</td>
                              <td className={r.pendingCount > 0 ? 'text-amber-400' : 'text-slate-400'}>{r.pendingCount}</td>
                              <td>
                                <span className={`font-semibold ${adherenceColor}`}>{r.compliancePct}%</span>
                              </td>
                              <td>
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${adherence >= 90 ? 'bg-emerald-400' : adherence >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ width: `${Math.min(adherence, 100)}%` }}
                                    />
                                  </div>
                                  <span className={`text-[11px] ${adherenceColor}`}>{adherence}%</span>
                                </div>
                              </td>
                              <td className="text-slate-400 max-w-[180px] truncate" title={r.remarks}>{r.remarks || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ---- AMC Management tab ---- */}
          {tab === 'amc' && (
            <AmcTab machineId={machine.id} machineName={machine.name} />
          )}

          {/* ---- Per-machine breakdown log tab ---- */}
          {tab === 'bdLogs' && (
            <div className="space-y-5">
              {/* Add log form (admin only) */}
              {isAdmin && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!bdLogForm.failureCause.trim()) return;
                    addMachineBreakdownLog({
                      ...bdLogForm,
                      machineId: machine.id,
                      machineCode: machine.machineCode || machine.id,
                      machineName: machine.name,
                      plantSection: machine.section,
                      downtimeHours: Number(bdLogForm.downtimeHours) || 0,
                    }, userName);
                    setBdLogForm({ startTime: '', endTime: '', date: new Date().toISOString().slice(0, 10), downtimeHours: '', failureCause: '', actionTaken: '', status: 'closed', remarks: '' });
                    setDowntimeManual(false);
                  }}
                  className="glass-card p-4 space-y-3"
                >
                  <h4 className="text-card-title flex items-center gap-2">
                    <Plus size={14} className="text-red-400" aria-hidden="true" /> Log New Breakdown
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Breakdown Start Time *</label>
                      <input
                        type="datetime-local"
                        className="input-field"
                        value={bdLogForm.startTime}
                        required
                        onChange={(e) => {
                          const startTime = e.target.value;
                          setBdLogForm((f) => {
                            const next = { ...f, startTime };
                            // Auto-derive date from start time
                            if (startTime) next.date = startTime.slice(0, 10);
                            // Auto-calc downtime unless manually overridden
                            if (!downtimeManual && f.endTime && startTime) {
                              const diff = (new Date(f.endTime) - new Date(startTime)) / 3_600_000;
                              next.downtimeHours = diff > 0 ? String(Math.round(diff * 100) / 100) : '';
                            }
                            return next;
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Breakdown End Time</label>
                      <input
                        type="datetime-local"
                        className="input-field"
                        value={bdLogForm.endTime}
                        onChange={(e) => {
                          const endTime = e.target.value;
                          setBdLogForm((f) => {
                            const next = { ...f, endTime };
                            // Auto-calc downtime unless manually overridden
                            if (!downtimeManual && f.startTime && endTime) {
                              const diff = (new Date(endTime) - new Date(f.startTime)) / 3_600_000;
                              next.downtimeHours = diff > 0 ? String(Math.round(diff * 100) / 100) : '';
                            }
                            return next;
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Downtime (hrs)
                        {!downtimeManual && bdLogForm.startTime && bdLogForm.endTime && (
                          <span className="ml-1.5 text-cyan-400/70">(auto-calculated)</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input-field"
                        placeholder="e.g. 4.5"
                        value={bdLogForm.downtimeHours}
                        onChange={(e) => {
                          setDowntimeManual(true);
                          setBdLogForm((f) => ({ ...f, downtimeHours: e.target.value }));
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Status</label>
                      <select className="select-field" value={bdLogForm.status}
                        onChange={(e) => setBdLogForm((f) => ({ ...f, status: e.target.value }))}>
                        <option value="closed">Closed</option>
                        <option value="open">Open</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Failure Cause *</label>
                      <input type="text" className="input-field" placeholder="Describe the failure…"
                        value={bdLogForm.failureCause} onChange={(e) => setBdLogForm((f) => ({ ...f, failureCause: e.target.value }))} required />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Action Taken</label>
                      <input type="text" className="input-field" placeholder="Corrective action / repair performed…"
                        value={bdLogForm.actionTaken} onChange={(e) => setBdLogForm((f) => ({ ...f, actionTaken: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Remarks</label>
                      <input type="text" className="input-field" placeholder="Optional"
                        value={bdLogForm.remarks} onChange={(e) => setBdLogForm((f) => ({ ...f, remarks: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="btn-danger text-xs inline-flex items-center gap-1.5">
                      <AlertOctagon size={12} aria-hidden="true" /> Add Breakdown Entry
                    </button>
                  </div>
                </form>
              )}

              {/* Month filter */}
              <div className="flex items-center gap-2">
                <Filter size={13} className="text-slate-500" aria-hidden="true" />
                <select className="select-field !w-auto text-xs" value={bdLogMonthFilter}
                  onChange={(e) => setBdLogMonthFilter(e.target.value)} aria-label="Filter by month">
                  <option value="">All Months</option>
                  {[...new Set(bdLogs.map((l) => l.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)).map((m) => (
                    <option key={m} value={m}>{formatPeriodKey(m, true)}</option>
                  ))}
                </select>
                {bdLogMonthFilter && (
                  <button className="btn-ghost text-xs !py-1" onClick={() => setBdLogMonthFilter('')}>Clear</button>
                )}
              </div>

              {/* Log table */}
              {bdLogs.length === 0 ? (
                <EmptyState
                  title="No breakdown logs yet"
                  description="Log individual breakdowns for this machine. Bulk import via the Machine Breakdown Logs template also auto-punches entries here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="enterprise-table w-full min-w-[900px]">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Start Time</th>
                        <th>End Time</th>
                        <th>Downtime (hrs)</th>
                        <th>Failure Cause</th>
                        <th>Action Taken</th>
                        <th>Status</th>
                        <th>Remarks</th>
                        {isAdmin && <th className="w-10" aria-label="Actions" />}
                      </tr>
                    </thead>
                    <tbody>
                      {bdLogs
                        .filter((l) => !bdLogMonthFilter || l.date.slice(0, 7) === bdLogMonthFilter)
                        .sort((a, b) => {
                          // Sort by startTime if available, otherwise by date
                          const aKey = a.startTime || a.date;
                          const bKey = b.startTime || b.date;
                          return bKey.localeCompare(aKey);
                        })
                        .map((l) => {
                          const fmtDateTime = (iso) => {
                            if (!iso) return '—';
                            const d = new Date(iso);
                            return Number.isNaN(d.getTime())
                              ? iso
                              : `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
                          };
                          return (
                          <tr key={l.id}>
                            <td className="text-white whitespace-nowrap">
                              <span className="flex items-center gap-1">
                                <CalendarDays size={11} className="text-slate-500" aria-hidden="true" />
                                {new Date(l.date).toLocaleDateString('en-GB')}
                              </span>
                            </td>
                            <td className="text-slate-300 whitespace-nowrap text-xs">{fmtDateTime(l.startTime)}</td>
                            <td className="text-slate-300 whitespace-nowrap text-xs">{fmtDateTime(l.endTime)}</td>
                            <td className={`font-semibold ${l.downtimeHours > 8 ? 'text-red-400' : l.downtimeHours > 4 ? 'text-amber-300' : 'text-slate-200'}`}>
                              {l.downtimeHours ? `${l.downtimeHours}h` : '—'}
                            </td>
                            <td className="text-slate-200 max-w-[200px] truncate" title={l.failureCause}>{l.failureCause || '—'}</td>
                            <td className="text-slate-400 max-w-[200px] truncate" title={l.actionTaken}>{l.actionTaken || '—'}</td>
                            <td>
                              <span className={`badge ${l.status === 'closed' ? 'bg-emerald-500/15 text-emerald-400' : l.status === 'open' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                {l.status}
                              </span>
                            </td>
                            <td className="text-slate-500 max-w-[140px] truncate" title={l.remarks}>{l.remarks || '—'}</td>
                            {isAdmin && (
                              <td>
                                <button
                                  onClick={() => deleteMachineBreakdownLog(l.id, userName)}
                                  className="text-slate-500 hover:text-red-400 p-1"
                                  aria-label="Delete log entry"
                                >
                                  <Trash2 size={13} aria-hidden="true" />
                                </button>
                              </td>
                            )}
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ---- Document tabs ---- */}
          {MACHINE_DOC_TABS.some((t) => t.id === tab) && tab !== 'amc' && (
            <>
              {isAdmin && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                  <input
                    ref={fileRef}
                    type="file"
                    accept={acceptExt.join(',')}
                    className="hidden"
                    onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="btn-success inline-flex items-center gap-2 text-xs whitespace-nowrap"
                  >
                    <Upload size={13} aria-hidden="true" />
                    {uploading ? 'Attaching...' : `Upload ${MACHINE_DOC_TABS.find((t) => t.id === tab)?.label}`}
                  </button>
                  <p className="text-meta">Word, Excel, PowerPoint, PDF{tab === 'media' ? ', MP4' : ''} · up to 4 MB per document</p>
                </div>
              )}

              {docs.length === 0 ? (
                <EmptyState
                  title={`No ${MACHINE_DOC_TABS.find((t) => t.id === tab)?.label} uploaded yet`}
                  description="Attach the controlled document for this machine so operators and technicians can access it instantly."
                  actionLabel={isAdmin ? 'Upload First Document' : undefined}
                  onAction={isAdmin ? () => fileRef.current?.click() : undefined}
                />
              ) : (
                <ul className="grid gap-2.5">
                  {docs.map((d) => {
                    const extMeta = EXT_META[d.file_format];
                    const fileUrl = getDocumentUrl(d);
                    return (
                      <li key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-control border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-9 h-9 rounded-control flex items-center justify-center flex-shrink-0 ${extMeta?.badge || 'bg-slate-700 text-slate-400'}`}>
                            <FileText size={16} aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-white text-sm font-medium truncate">{d.filename}</p>
                            <p className="text-meta">
                              {extMeta?.label || d.file_format} · {d.uploadedBy} · {timeAgo(d.uploadedAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => fileUrl && openPreview(toPreviewDocument(d))}
                            disabled={!fileUrl}
                            className="btn-ghost inline-flex items-center gap-1.5 text-xs !py-1.5 disabled:opacity-40"
                            aria-label={`Preview ${d.filename}`}
                          >
                            <Eye size={12} aria-hidden="true" /> Preview
                          </button>
                          <a
                            href={fileUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`btn-ghost inline-flex items-center gap-1.5 text-xs !py-1.5 text-cyan-400 hover:text-cyan-300 ${fileUrl ? '' : 'pointer-events-none opacity-40'}`}
                            aria-label={`Download ${d.filename}`}
                          >
                            <Download size={12} aria-hidden="true" /> Download
                          </a>
                          {isAdmin && (
                          <button onClick={() => handleDeleteDoc(d)} className="btn-ghost inline-flex items-center gap-1.5 text-xs !py-1.5 text-red-400 hover:text-red-300" aria-label={`Delete ${d.filename}`}>
                              <Trash2 size={12} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {editing && <EditSpecsModal machine={machine} userName={userName} onClose={() => setEditing(false)} />}
    </div>
  );
}
