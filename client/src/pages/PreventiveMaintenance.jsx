import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addPM, deletePM, updatePM } from '../store.js';
import {
  aggregatePMRecords, formatPeriodKey, pmStats, lastNMonths,
  machineWisePM, pmTypePareto, machinePMRegister,
  monthlyPMComplianceTrend, monthlyPMDurationTrend,
} from '../analytics.js';
import { getAllSections } from '../constants.js';
import SectionSelect from '../components/SectionSelect.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Line, Tooltip, Legend,
} from 'recharts';
import {
  AlertCircle, CalendarX2, CheckCircle2, ClipboardCheck, Download, Eye,
  Percent, Pencil, Plus, Search, Trash2, Upload, X, Clock,
  Timer,
} from 'lucide-react';

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const PAGE_SIZE = 15;

const GRID = 'rgba(148,163,184,0.08)';
const AXIS = { fill: '#64748B', fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: '#0F172A',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: '10px',
  fontSize: '12px',
  color: '#E2E8F0',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};

// ── KPI Card Component ──────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, changePct, cls, invert }) {
  const isPositive = invert ? changePct < 0 : changePct > 0;
  const badgeCls = isPositive
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : changePct === 0
      ? 'text-slate-400 bg-slate-500/10 border-slate-500/30'
      : 'text-red-400 bg-red-500/10 border-red-500/30';
  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-control flex items-center justify-center bg-white/[0.04] ${cls}`}>
        <Icon size={16} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-lg font-bold leading-tight truncate">{value}</p>
        <p className="text-slate-500 text-[10px] truncate">{label}</p>
      </div>
      {changePct !== undefined && changePct !== null && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-control border ${badgeCls} whitespace-nowrap`}>
          {isPositive ? '+' : ''}{Math.round(changePct)}%
        </span>
      )}
    </div>
  );
}

// ── Summary Modal ───────────────────────────────────────────────────────────
function SummaryModal({ userName, onClose, sections, machines }) {
  const [form, setForm] = useState({
    period: currentPeriod(),
    section: '',
    machineId: '',
    plannedCount: '',
    doneCount: '',
    pendingCount: '',
    compliancePct: '',
    startTime: '',
    endTime: '',
    remarks: '',
  });
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const filteredMachines = useMemo(() => {
    if (!form.section) return machines || [];
    return (machines || []).filter((m) => m.section === form.section);
  }, [form.section, machines]);

  const durationHours = useMemo(() => {
    if (!form.startTime || !form.endTime) return '';
    const diff = (new Date(form.endTime) - new Date(form.startTime)) / 3_600_000;
    return diff > 0 ? Math.round(diff * 10) / 10 : '';
  }, [form.startTime, form.endTime]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.period || !form.section) {
      setError('Reporting month and plant section are required.');
      return;
    }
    addPM({
      ...form,
      machineId: form.machineId || '',
      startTime: form.startTime || '',
      endTime: form.endTime || '',
      durationHours: durationHours || 0,
    }, userName);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Log monthly PM summary">
      <div className="modal-content glass-card p-6 w-full max-w-xl max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title flex items-center gap-2">
            <ClipboardCheck size={16} className="text-cyan-400" aria-hidden="true" /> Monthly PM Summary
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        <p className="text-meta mb-5">Percentage done auto-calculates from actual done and planned count when left blank. Duration auto-calculates from start/end times.</p>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-period">Month & Year *</label>
            <input id="pm-period" type="month" className="input-field" value={form.period} onChange={set('period')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-section">Plant Section *</label>
            <SectionSelect value={form.section} onChange={(v) => set('section')({ target: { value: v } })} id="pm-section" ariaLabel="Plant section" />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-machine">Machine (optional)</label>
            <select id="pm-machine" className="select-field" value={form.machineId} onChange={set('machineId')}>
              <option value="">All machines in section</option>
              {filteredMachines.map((m) => <option key={m.id} value={m.id}>{m.name || m.machineCode || m.id}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-planned">Actual Planned PM Count</label>
            <input id="pm-planned" type="number" min="0" className="input-field" value={form.plannedCount} onChange={set('plannedCount')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-done">Actual Done PM Count</label>
            <input id="pm-done" type="number" min="0" className="input-field" value={form.doneCount} onChange={set('doneCount')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-compliance">Percentage Done (%)</label>
            <input id="pm-compliance" type="number" min="0" max="100" step="0.1" className="input-field" value={form.compliancePct} onChange={set('compliancePct')} placeholder="Leave blank to auto-calculate" />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-pending">Overdue / Pending PM Count</label>
            <input id="pm-pending" type="number" min="0" className="input-field" value={form.pendingCount} onChange={set('pendingCount')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-start">
              <Clock size={11} className="inline mr-1" aria-hidden="true" />Start Date & Time
            </label>
            <input id="pm-start" type="datetime-local" className="input-field" value={form.startTime} onChange={set('startTime')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-end">
              <Clock size={11} className="inline mr-1" aria-hidden="true" />End Date & Time
            </label>
            <input id="pm-end" type="datetime-local" className="input-field" value={form.endTime} onChange={set('endTime')} />
          </div>
          {durationHours !== '' && (
            <div className="sm:col-span-2 bg-cyan-500/8 border border-cyan-500/20 rounded-control px-3 py-2 text-xs text-cyan-300">
              Calculated Duration: <strong>{durationHours} hours</strong>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="pm-remarks">Remarks</label>
            <textarea id="pm-remarks" rows={3} className="input-field resize-none" value={form.remarks} onChange={set('remarks')} placeholder="Optional notes for the monthly PM summary" />
          </div>
          {error && (
            <div className="sm:col-span-2 bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}
          <button type="submit" className="sm:col-span-2 btn-primary flex items-center justify-center gap-2">
            <Plus size={14} aria-hidden="true" /> Save Monthly Summary
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Detail Modal ────────────────────────────────────────────────────────────
function DetailModal({ row, onClose }) {
  const dur = row.durationHours || (row.startTime && row.endTime
    ? Math.round(((new Date(row.endTime) - new Date(row.startTime)) / 3_600_000) * 10) / 10
    : null);
  const details = [
    ['Period', formatPeriodKey(row.period, true)],
    ['Plant Section', row.section],
    ['Planned PM Count', row.plannedCount],
    ['Done PM Count', row.doneCount],
    ['Pending PM Count', row.pendingCount],
    ['Compliance', `${row.compliancePct}%`],
    ['Start Time', row.startTime ? new Date(row.startTime).toLocaleString('en-GB') : '—'],
    ['End Time', row.endTime ? new Date(row.endTime).toLocaleString('en-GB') : '—'],
    ['Duration', dur != null ? `${dur} hrs` : '—'],
    ['Remarks', row.remarks || '—'],
  ];
  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="PM summary details">
      <div className="modal-content glass-card p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title">PM Summary Detail</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {details.map(([label, value]) => (
            <div key={label} className={['Remarks', 'Start Time', 'End Time', 'Duration'].includes(label) ? 'sm:col-span-2' : ''}>
              <dt className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</dt>
              <dd className="text-slate-200 text-[13px] mt-0.5 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ── Edit PM Modal ───────────────────────────────────────────────────────────
function EditPMModal({ row, userName, onClose }) {
  const [form, setForm] = useState({
    plannedCount: String(row.plannedCount ?? ''),
    doneCount: String(row.doneCount ?? ''),
    pendingCount: String(row.pendingCount ?? ''),
    compliancePct: String(row.compliancePct ?? ''),
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    remarks: row.remarks || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const liveCompliance = (() => {
    const planned = Number(form.plannedCount);
    const done = Number(form.doneCount);
    if (!planned) return null;
    return Math.round((done / planned) * 1000) / 10;
  })();

  const durationHours = useMemo(() => {
    if (!form.startTime || !form.endTime) return null;
    const diff = (new Date(form.endTime) - new Date(form.startTime)) / 3_600_000;
    return diff > 0 ? Math.round(diff * 10) / 10 : null;
  }, [form.startTime, form.endTime]);

  const handleSave = (e) => {
    e.preventDefault();
    updatePM(row.id, {
      ...form,
      startTime: form.startTime || '',
      endTime: form.endTime || '',
      durationHours: durationHours || 0,
    }, userName);
    onClose();
  };

  const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const labelCls = 'block text-xs text-slate-400 mb-1';
  const periodLabel = new Date(`${row.period}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Edit PM record">
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-card-title">Edit PM Summary</h3>
            <p className="text-meta mt-0.5">{periodLabel} · {row.section}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X size={16} /></button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Planned PM</label><input type="number" min="0" value={form.plannedCount} onChange={set('plannedCount')} className={inputCls} /></div>
            <div><label className={labelCls}>Done PM</label><input type="number" min="0" value={form.doneCount} onChange={set('doneCount')} className={inputCls} /></div>
            <div><label className={labelCls}>Pending PM</label><input type="number" min="0" value={form.pendingCount} onChange={set('pendingCount')} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Compliance % {liveCompliance !== null && <span className="ml-2 text-cyan-400 text-[10px] font-normal">auto: {liveCompliance}%</span>}</label>
              <input type="number" min="0" max="100" step="0.1" value={form.compliancePct} onChange={set('compliancePct')} placeholder={liveCompliance !== null ? `Auto: ${liveCompliance}` : 'Leave blank to auto-calc'} className={inputCls} />
            </div>
            <div><label className={labelCls}><Clock size={11} className="inline mr-1" />Start Time</label><input type="datetime-local" value={form.startTime} onChange={set('startTime')} className={inputCls} /></div>
            <div><label className={labelCls}><Clock size={11} className="inline mr-1" />End Time</label><input type="datetime-local" value={form.endTime} onChange={set('endTime')} className={inputCls} /></div>
          </div>
          {durationHours != null && (
            <p className="text-xs text-cyan-300 bg-cyan-500/8 border border-cyan-500/20 rounded-control px-3 py-2">
              Calculated Duration: <strong>{durationHours} hours</strong>
            </p>
          )}
          <div><label className={labelCls}>Remarks</label><textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inputCls} /></div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button type="submit" className="btn-primary text-xs">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function PreventiveMaintenance() {
  const { user } = useAuth();
  const { openUpload } = useUI();
  const store = useStore();
  const { pms, machines, machinePmRecords } = store;
  const [showNew, setShowNew] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Register filters
  const [registerMonth, setRegisterMonth] = useState('');
  const [regSearch, setRegSearch] = useState('');
  const [regSection, setRegSection] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [regPage, setRegPage] = useState(1);

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const currentKey = currentPeriod();
  const sections = useMemo(() => getAllSections(store.plantSections), [store.plantSections]);

  // ── Analytics ────────────────────────────────────────────────────────────
  const stats = useMemo(() => pmStats(pms), [pms]);
  const currentSummary = useMemo(() => aggregatePMRecords(pms, currentKey), [pms, currentKey]);

  // Previous month for comparison
  const prevMonthKey = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const prevSummary = useMemo(() => aggregatePMRecords(pms, prevMonthKey), [pms, prevMonthKey]);

  const pctChange = (curr, prev) => {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

  const totalDuration = useMemo(
    () => round1(machinePmRecords.reduce((sum, r) => sum + (r.durationHours || 0), 0)),
    [machinePmRecords]
  );
  const prevTotalDuration = useMemo(() => {
    const prevRows = machinePmRecords.filter((r) => (r.pmDate || '').slice(0, 7) === prevMonthKey);
    return round1(prevRows.reduce((sum, r) => sum + (r.durationHours || 0), 0));
  }, [machinePmRecords, prevMonthKey]);

  const topMachines = useMemo(() => machineWisePM(machinePmRecords).slice(0, 10), [machinePmRecords]);
  const typePareto = useMemo(() => pmTypePareto(machinePmRecords), [machinePmRecords]);
  const complianceTrend = useMemo(() => monthlyPMComplianceTrend(pms, 12), [pms]);
  const durationTrend = useMemo(() => monthlyPMDurationTrend(machinePmRecords, 12), [machinePmRecords]);
  const monthlyRegister = useMemo(() => machinePMRegister(machinePmRecords), [machinePmRecords]);

  // Available months for sidebar
  const availableMonths = useMemo(() => {
    const monthSet = new Set(monthlyRegister.map((r) => r.period));
    return lastNMonths(12).filter((m) => monthSet.has(m.key));
  }, [monthlyRegister]);

  // Default to current month
  useEffect(() => {
    if (!registerMonth && availableMonths.length) {
      const currentM = availableMonths.find((m) => m.key === currentKey);
      if (currentM) setRegisterMonth(currentM.key);
      else if (availableMonths.length) setRegisterMonth(availableMonths[0].key);
    }
  }, [availableMonths, registerMonth, currentKey]);

  // Filtered register rows
  const registerRows = useMemo(() => {
    const filtered = monthlyRegister.filter((r) => {
      if (registerMonth && r.period !== registerMonth) return false;
      if (regSearch) {
        const q = regSearch.toLowerCase();
        if (!(r.machineCode || '').toLowerCase().includes(q) && !(r.machineName || '').toLowerCase().includes(q)) return false;
      }
      if (regSection && r.plantSection !== regSection) return false;
      if (regStatus) {
        const st = r.status || '';
        if (regStatus === 'COMPLETED' && st !== 'COMPLETED') return false;
        if (regStatus === 'PENDING' && st !== 'PENDING') return false;
      }
      return true;
    });
    return filtered;
  }, [monthlyRegister, registerMonth, regSearch, regSection, regStatus]);

  const regTotalPages = Math.max(1, Math.ceil(registerRows.length / PAGE_SIZE));
  const regPageRows = registerRows.slice((regPage - 1) * PAGE_SIZE, regPage * PAGE_SIZE);

  // Month tab counts
  const monthCounts = useMemo(() => {
    const counts = {};
    monthlyRegister.forEach((r) => {
      counts[r.period] = (counts[r.period] || 0) + r.pmCount;
    });
    return counts;
  }, [monthlyRegister]);

  // Summary table
  const summaryRows = useMemo(() => {
    return [...pms]
      .filter((row) => {
        if (registerMonth && row.period !== registerMonth) return false;
        if (regSection && row.section !== regSection) return false;
        return true;
      })
      .sort((a, b) => b.period.localeCompare(a.period) || a.section.localeCompare(b.section));
  }, [pms, registerMonth, regSection]);

  const handleExport = () => exportToCSV(
    registerRows,
    [
      { key: 'machineCode', label: 'Machine Code' },
      { key: 'machineName', label: 'Machine Name' },
      { key: 'plantSection', label: 'Section' },
      { key: 'pmDate', label: 'PM Date' },
      { key: 'pmType', label: 'PM Type' },
      { key: 'mainTask', label: 'Task' },
      { key: 'pmCount', label: 'PM Count' },
      { key: 'completedCount', label: 'Completed' },
      { key: 'pendingCount', label: 'Pending' },
      { key: 'totalDuration', label: 'Duration (hrs)' },
      { key: 'status', label: 'Status' },
    ],
    'pm-machine-register.csv'
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <ClipboardCheck size={28} className="text-cyan-400" aria-hidden="true" />
            Preventive Maintenance
          </h2>
          <p className="text-body mt-1.5">{machinePmRecords.length} PM records across {machines.length} machines in {sections.length - 1} sections</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {isAdmin && (
            <>
              <button onClick={() => openUpload({ kind: 'bulk', module: 'pm' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs">
                <Upload size={13} aria-hidden="true" /> Upload Excel
              </button>
              <button onClick={() => setShowNew(true)} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
                <Plus size={15} aria-hidden="true" /> Log Summary
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard icon={ClipboardCheck} label="Total PM Planned" value={currentSummary.plannedCount} changePct={pctChange(currentSummary.plannedCount, prevSummary.plannedCount)} cls="text-cyan-400" invert={false} />
        <KPICard icon={CheckCircle2} label="Completed PMs" value={currentSummary.doneCount} changePct={pctChange(currentSummary.doneCount, prevSummary.doneCount)} cls="text-emerald-400" invert={false} />
        <KPICard icon={CalendarX2} label="Pending / Overdue" value={currentSummary.pendingCount} changePct={pctChange(currentSummary.pendingCount, prevSummary.pendingCount)} cls="text-red-400" invert={true} />
        <KPICard icon={Timer} label="Total PM Hours" value={`${totalDuration}h`} changePct={pctChange(totalDuration, prevTotalDuration)} cls="text-orange-400" invert={true} />
        <KPICard icon={Percent} label="PM Compliance" value={`${currentSummary.compliance}%`} changePct={pctChange(currentSummary.compliance, prevSummary.compliance)} cls="text-emerald-400" invert={false} />
      </div>

      {/* ── Charts Section ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Top 10 Machines by PM Count */}
        <div className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">Top Machines by PM Count</h3>
          <p className="text-meta mb-4">Most frequently serviced equipment</p>
          {topMachines.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-8">No PM records yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topMachines} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} />
                <YAxis type="category" dataKey="label" tick={AXIS} width={120} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#06B6D4" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* PM Type Distribution (Pareto) */}
        <div className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">PM Type Distribution</h3>
          <p className="text-meta mb-4">Pareto of preventive vs corrective tasks</p>
          {typePareto.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-8">No PM records yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={typePareto} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis yAxisId="left" tick={AXIS} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                <Bar yAxisId="left" dataKey="count" fill="#06B6D4" radius={[4, 4, 0, 0]} name="Count" />
                <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: '#F59E0B' }} name="Cumulative %" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly PM Trend */}
        <div className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">Monthly PM Trend</h3>
          <p className="text-meta mb-4">Planned vs completed PM counts</p>
          {complianceTrend.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-8">No PM data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={complianceTrend} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis yAxisId="left" tick={AXIS} />
                <YAxis yAxisId="right" orientation="right" tick={AXIS} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                <Bar yAxisId="left" dataKey="planned" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Planned" />
                <Bar yAxisId="left" dataKey="done" fill="#10B981" radius={[4, 4, 0, 0]} name="Completed" />
                <Line yAxisId="right" type="monotone" dataKey="compliance" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: '#F59E0B' }} name="Compliance %" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ── Compliance & Duration Trend Row ────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">PM Compliance Trend</h3>
          <p className="text-meta mb-4">Monthly compliance % over 12 months</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={complianceTrend} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="pmComplianceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} />
              <YAxis tick={AXIS} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="compliance" stroke="#10B981" strokeWidth={2.5} dot={{ r: 3, fill: '#10B981' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">PM Duration Trend</h3>
          <p className="text-meta mb-4">Total maintenance hours spent on PM per month</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={durationTrend} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} />
              <YAxis tick={AXIS} unit="h" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="totalDuration" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Total Hours" />
              <Line type="monotone" dataKey="avgDuration" stroke="#06B6D4" strokeWidth={2} dot={{ r: 3, fill: '#06B6D4' }} name="Avg per Record" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── Month-wise Machine PM Register ─────────────────────────────── */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-card-title text-sm">Machine-wise PM Register</h3>
            <p className="text-meta mt-0.5">{registerRows.length} PM entries across {new Set(registerRows.map((r) => r.machineCode || r.machineId)).size} machines</p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Left Sidebar — Month Tabs */}
          <div className="col-span-12 lg:col-span-3">
            <div className="max-h-[480px] overflow-y-auto space-y-1 pr-1">
              {availableMonths.map((m) => (
                <button
                  key={m.key}
                  onClick={() => { setRegisterMonth(m.key); setRegPage(1); }}
                  className={`w-full text-left px-3 py-2.5 rounded-control text-xs transition-all flex items-center justify-between ${
                    registerMonth === m.key
                      ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold'
                      : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span>{m.full}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${registerMonth === m.key ? 'bg-amber-400/20 text-amber-300' : 'bg-white/[0.06] text-slate-500'}`}>
                    {monthCounts[m.key] || 0}
                  </span>
                </button>
              ))}
              {availableMonths.length === 0 && (
                <p className="text-slate-500 text-xs text-center py-4">No PM data yet</p>
              )}
            </div>
          </div>

          {/* Right Content — Filters + Table */}
          <div className="col-span-12 lg:col-span-9 space-y-3">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input type="search" className="input-field pl-9 text-xs" placeholder="Search machine code or name..." value={regSearch} onChange={(e) => { setRegSearch(e.target.value); setRegPage(1); }} />
              </div>
              <SectionSelect value={regSection} onChange={(v) => { setRegSection(v); setRegPage(1); }} className="select-field text-xs" showAddNew={false} />
              <select className="select-field text-xs w-full sm:w-36" value={regStatus} onChange={(e) => { setRegStatus(e.target.value); setRegPage(1); }}>
                <option value="">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="PENDING">Pending</option>
              </select>
            </div>

            {/* Table */}
            {regPageRows.length === 0 ? (
              <EmptyState title="No PM records for this period" description="Upload a PM Excel or log a summary to populate this register." />
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full text-xs">
                  <thead>
                    <tr>
                      <th>Machine Code</th>
                      <th>Machine Name</th>
                      <th>Section</th>
                      <th>PM Date</th>
                      <th>PM Type & Task</th>
                      <th>Duration</th>
                      <th>Count</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regPageRows.map((row) => (
                      <tr key={`${row.machineId}-${row.period}`} className="cursor-pointer hover:bg-cyan-500/5">
                        <td className="text-cyan-400 font-medium">{row.machineCode || '—'}</td>
                        <td className="text-slate-300 max-w-[160px] truncate" title={row.machineName}>{row.machineName || '—'}</td>
                        <td className="text-slate-300">{row.plantSection || '—'}</td>
                        <td className="text-slate-300 whitespace-nowrap">{formatPeriodKey(row.period, true)}</td>
                        <td className="text-slate-300 max-w-[140px] truncate" title={row.mainTask}>{row.mainTask || row.mainFailureCause || '—'}</td>
                        <td className="text-cyan-300 font-semibold">{row.totalDuration}h</td>
                        <td className="text-slate-300">{row.pmCount}</td>
                        <td>
                          <span className={`status-pill text-[10px] ${
                            row.status === 'COMPLETED'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-amber-500/15 text-amber-400'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setViewing(row)} className="btn-ghost !p-1.5" aria-label="View"><Eye size={12} /></button>
                            {isAdmin && (
                              <>
                                <button onClick={() => setEditing(row)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit"><Pencil size={12} /></button>
                                <button onClick={() => setDeleting(row)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete"><Trash2 size={12} /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {regTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-meta">Showing {((regPage - 1) * PAGE_SIZE) + 1}–{Math.min(regPage * PAGE_SIZE, registerRows.length)} of {registerRows.length}</p>
                <div className="flex gap-1">
                  {Array.from({ length: regTotalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === regTotalPages || Math.abs(p - regPage) <= 2)
                    .map((p, idx, arr) => (
                      <span key={p} className="flex items-center">
                        {idx > 0 && arr[idx - 1] !== p - 1 && <span className="text-slate-600 px-1">…</span>}
                        <button
                          onClick={() => setRegPage(p)}
                          className={`w-7 h-7 rounded-control text-[11px] font-medium transition-all ${
                            regPage === p
                              ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                              : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Summary Table (Section-Level Monthly) ──────────────────────── */}
      {summaryRows.length > 0 && (
        <section className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">Section-Level PM Summaries</h3>
          <p className="text-meta mb-4">Monthly compliance by plant section</p>
          <div className="overflow-x-auto">
            <table className="enterprise-table w-full text-xs">
              <thead>
                <tr>
                  <th>Period</th><th>Plant Section</th><th>Planned</th><th>Done</th>
                  <th>Pending</th><th>Compliance</th><th>Duration</th><th>Remarks</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => {
                  const dur = row.durationHours || (row.startTime && row.endTime
                    ? Math.round(((new Date(row.endTime) - new Date(row.startTime)) / 3_600_000) * 10) / 10
                    : null);
                  return (
                    <tr key={row.id}>
                      <td className="text-slate-300 whitespace-nowrap">{formatPeriodKey(row.period, true)}</td>
                      <td className="text-white font-medium">{row.section}</td>
                      <td className="text-slate-300">{row.plannedCount}</td>
                      <td className="text-slate-300">{row.doneCount}</td>
                      <td className="text-slate-300">{row.pendingCount}</td>
                      <td className="text-slate-300">{row.compliancePct}%</td>
                      <td className="text-cyan-300 text-xs font-semibold">{dur != null ? `${dur}h` : '—'}</td>
                      <td className="text-slate-400 max-w-[120px] truncate">{row.remarks || '—'}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => setViewing(row)} className="btn-ghost !p-1.5" aria-label="View"><Eye size={12} /></button>
                          {isAdmin && (
                            <>
                              <button onClick={() => setEditing(row)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit"><Pencil size={12} /></button>
                              <button onClick={() => setDeleting(row)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete"><Trash2 size={12} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {showNew && <SummaryModal userName={userName} sections={sections} machines={machines} onClose={() => setShowNew(false)} />}
      {viewing && <DetailModal row={viewing} onClose={() => setViewing(null)} />}
      {editing && isAdmin && <EditPMModal row={editing} userName={userName} onClose={() => setEditing(null)} />}
      {deleting && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setDeleting(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Delete PM Summary</h3>
            <p className="text-body mb-5">Delete the summary for <span className="text-white font-medium">{deleting.section || deleting.machineName}</span> in <span className="text-white font-medium">{formatPeriodKey(deleting.period, true)}</span>?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleting(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => { deletePM(deleting.id, userName); setDeleting(null); }} className="btn-danger text-xs inline-flex items-center gap-1.5">
                <Trash2 size={12} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
