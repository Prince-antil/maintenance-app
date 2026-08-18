import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addPM, deletePM, updatePM, purgePmRecords } from '../store.js';
import {
  formatPeriodKey, pmStats, lastNMonths,
  machineWisePM, pmTypePareto, machinePMRegister,
  monthlyPMComplianceTrendFromRecords,
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
  Percent, Pencil, Plus, Search, Trash2, Upload, X,
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
    remarks: '',
  });
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const filteredMachines = useMemo(() => {
    if (!form.section) return machines || [];
    return (machines || []).filter((m) => m.section === form.section);
  }, [form.section, machines]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.period || !form.section) {
      setError('Reporting month and plant section are required.');
      return;
    }
    addPM({
      ...form,
      machineId: form.machineId || '',
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
        <p className="text-meta mb-5">Percentage done auto-calculates from actual done and planned count when left blank.</p>

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
  const details = [
    ['Period', formatPeriodKey(row.period, true)],
    ['Plant Section', row.section],
    ['Planned PM Count', row.plannedCount],
    ['Done PM Count', row.doneCount],
    ['Pending PM Count', row.pendingCount],
    ['Compliance', `${row.compliancePct}%`],
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
            <div key={label} className={label === 'Remarks' ? 'sm:col-span-2' : ''}>
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
    remarks: row.remarks || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const liveCompliance = (() => {
    const planned = Number(form.plannedCount);
    const done = Number(form.doneCount);
    if (!planned) return null;
    return Math.round((done / planned) * 1000) / 10;
  })();

  const handleSave = (e) => {
    e.preventDefault();
    updatePM(row.id, { ...form }, userName);
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
          </div>
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
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  // Register filters
  const [registerMonth, setRegisterMonth] = useState('');
  const [kpiMonth, setKpiMonth] = useState('');
  const [regSearch, setRegSearch] = useState('');
  const [regSection, setRegSection] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [regPage, setRegPage] = useState(1);

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const currentKey = currentPeriod();
  const sections = useMemo(() => getAllSections(store.plantSections), [store.plantSections]);

  // ── Analytics: data derivations (ordered to avoid forward references) ──
  const stats = useMemo(() => pmStats(pms), [pms]);
  const topMachines = useMemo(() => machineWisePM(machinePmRecords).slice(0, 10), [machinePmRecords]);
  const typePareto = useMemo(() => pmTypePareto(machinePmRecords), [machinePmRecords]);
  const monthlyRegister = useMemo(() => machinePMRegister(machinePmRecords), [machinePmRecords]);

  // Available months for sidebar — must come before KPI month resolution
  const availableMonths = useMemo(() => {
    const monthSet = new Set(monthlyRegister.map((r) => r.period));
    return lastNMonths(12).filter((m) => monthSet.has(m.key));
  }, [monthlyRegister]);

  // Determine the active month for KPI calculation:
  // - If user selected a month tab, use that
  // - Otherwise default to the latest month containing PM data
  const activeKpiMonth = useMemo(() => {
    if (kpiMonth) return kpiMonth;
    return availableMonths.length ? availableMonths[0].key : '';
  }, [kpiMonth, availableMonths]);

  const currentMonthRecords = useMemo(
    () => machinePmRecords.filter((r) => activeKpiMonth && (r.pmDate || '').slice(0, 7) === activeKpiMonth),
    [machinePmRecords, activeKpiMonth]
  );

  // Previous month relative to the active KPI month
  const prevKpiMonth = useMemo(() => {
    if (!activeKpiMonth) return '';
    const [y, m] = activeKpiMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // month is 1-indexed, subtract 2 for prev month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [activeKpiMonth]);

  const prevMonthRecords = useMemo(
    () => machinePmRecords.filter((r) => prevKpiMonth && (r.pmDate || '').slice(0, 7) === prevKpiMonth),
    [machinePmRecords, prevKpiMonth]
  );

  const totalPlanned = currentMonthRecords.length;
  const totalCompleted = currentMonthRecords.filter((r) => String(r.status || '').toLowerCase() === 'completed' || r.completed === true).length;
  const totalPending = totalPlanned - totalCompleted;
  const overallCompliance = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 1000) / 10 : 0;

  const prevPlanned = prevMonthRecords.length;
  const prevCompleted = prevMonthRecords.filter((r) => String(r.status || '').toLowerCase() === 'completed' || r.completed === true).length;
  const prevPending = prevPlanned - prevCompleted;
  const prevCompliance = prevPlanned > 0 ? Math.round((prevCompleted / prevPlanned) * 1000) / 10 : 0;

  const pctChange = (curr, prev) => {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const complianceTrend = useMemo(() => monthlyPMComplianceTrendFromRecords(machinePmRecords, 12), [machinePmRecords]);

  // Default to current month
  useEffect(() => {
    if (!registerMonth && availableMonths.length) {
      const currentM = availableMonths.find((m) => m.key === currentKey);
      const defaultMonth = currentM ? currentM.key : availableMonths[0].key;
      setRegisterMonth(defaultMonth);
      setKpiMonth(defaultMonth);
    }
  }, [availableMonths, registerMonth, currentKey]);

  // Filtered register rows — search across Machine Code, Name, Section, and Task
  const registerRows = useMemo(() => {
    const filtered = monthlyRegister.filter((r) => {
      if (registerMonth && r.period !== registerMonth) return false;
      if (regSearch) {
        const q = regSearch.toLowerCase();
        const haystack = [
          r.machineCode, r.machineName, r.plantSection, r.mainTask, r.mainFailureCause,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
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
      { key: 'plantSection', label: 'Plant Section' },
      { key: 'period', label: 'PM Date' },
      { key: 'mainTask', label: 'PM Type & Task' },
      { key: 'status', label: 'Status' },
    ],
    'pm-machine-register.csv'
  );

  const handlePurge = async () => {
    setPurgeLoading(true);
    try {
      await purgePmRecords(userName);
      setConfirmPurge(false);
    } catch (err) {
      // error logged inside store
    } finally {
      setPurgeLoading(false);
    }
  };

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
              <button onClick={() => setConfirmPurge(true)} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20">
                <Trash2 size={13} aria-hidden="true" /> Purge PM Data
              </button>
              <button onClick={() => setShowNew(true)} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
                <Plus size={15} aria-hidden="true" /> Log Summary
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── KPI Cards (computed directly from machine_pm_records) ────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={ClipboardCheck} label="Total PM Planned / Logged" value={totalPlanned} changePct={pctChange(totalPlanned, prevPlanned)} cls="text-cyan-400" invert={false} />
        <KPICard icon={CheckCircle2} label="Completed PMs" value={totalCompleted} changePct={pctChange(totalCompleted, prevCompleted)} cls="text-emerald-400" invert={false} />
        <KPICard icon={CalendarX2} label="Pending / Overdue" value={totalPending} changePct={pctChange(totalPending, prevPending)} cls="text-red-400" invert={true} />
        <KPICard icon={Percent} label="PM Compliance %" value={`${overallCompliance}%`} changePct={pctChange(overallCompliance, prevCompliance)} cls="text-emerald-400" invert={false} />
      </div>

      {/* ── Charts Section ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
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
      </section>

      {/* ── Monthly PM Trend (Compliance) ──────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5">
        <div className="glass-card p-5">
          <h3 className="text-card-title text-sm mb-1">PM Compliance Trend</h3>
          <p className="text-meta mb-4">Monthly compliance % over 12 months</p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={complianceTrend} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="pmComplianceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
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
        </div>
      </section>

      {/* ── Month-wise Machine PM Register ─────────────────────────────── */}
      <section className="glass-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-control bg-cyan-400/10 border border-cyan-400/25 flex items-center justify-center">
            <ClipboardCheck size={17} className="text-cyan-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-card-title">Machine-wise PM Register</h3>
            <p className="text-meta">
              {registerRows.length} PM entries across {new Set(registerRows.map((r) => r.machineCode || r.machineId)).size} machines
              {registerMonth ? ` for ${availableMonths.find((m) => m.key === registerMonth)?.full || registerMonth}` : ' — click a month tab to filter'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Left Sidebar — Month Tabs */}
          <div className="col-span-12 lg:col-span-3">
            <div className="max-h-[480px] overflow-y-auto space-y-1 pr-1">
              {/* All Months tab */}
              <button
                onClick={() => { setRegisterMonth(''); setKpiMonth(''); setRegPage(1); }}
                className={`w-full text-left px-3 py-2.5 rounded-control text-xs transition-all flex items-center justify-between gap-2 ${
                  !registerMonth
                    ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold'
                    : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="truncate">All Months</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${!registerMonth ? 'bg-amber-400/20 text-amber-300' : 'bg-white/[0.06] text-slate-500'}`}>
                  {machinePmRecords.length}
                </span>
              </button>
              {availableMonths.map((m) => (
                <button
                  key={m.key}
                  onClick={() => { setRegisterMonth(m.key); setKpiMonth(m.key); setRegPage(1); }}
                  className={`w-full text-left px-3 py-2.5 rounded-control text-xs transition-all flex items-center justify-between gap-2 ${
                    registerMonth === m.key
                      ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold'
                      : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span className="truncate">{m.full}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${registerMonth === m.key ? 'bg-amber-400/20 text-amber-300' : 'bg-white/[0.06] text-slate-500'}`}>
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
          <div className="col-span-12 lg:col-span-9">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input type="search" className="input-field pl-9 text-xs" placeholder="Search machine, code, section, or task..."
                  value={regSearch} onChange={(e) => { setRegSearch(e.target.value); setRegPage(1); }} aria-label="Search machine PM records" />
              </div>
              <SectionSelect value={regSection} onChange={(v) => { setRegSection(v); setRegPage(1); }} className="select-field text-xs" showAddNew={false} />
              <select className="select-field text-xs w-full sm:w-36" value={regStatus} onChange={(e) => { setRegStatus(e.target.value); setRegPage(1); }} aria-label="Filter by status">
                <option value="">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="PENDING">Pending</option>
              </select>
            </div>

            {/* Table */}
            {regPageRows.length === 0 ? (
              <EmptyState title="No PM records for this period" description="Upload a PM Excel or log a summary to populate this register." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="enterprise-table w-full min-w-[800px]">
                    <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                      <tr>
                        <th>Machine Code</th>
                        <th>Machine Name</th>
                        <th>Plant Section</th>
                        <th>PM Date</th>
                        <th>PM Type & Task</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regPageRows.map((row) => (
                        <tr key={`${row.machineId}-${row.period}`} className="cursor-pointer hover:bg-white/[0.03]">
                          <td className="text-cyan-400 font-mono text-xs whitespace-nowrap">{row.machineCode || '—'}</td>
                          <td className="text-white font-medium text-xs max-w-[140px] truncate" title={row.machineName}>{row.machineName || '—'}</td>
                          <td className="text-slate-300 text-xs max-w-[120px] truncate">{row.plantSection || '—'}</td>
                          <td className="text-slate-300 text-xs whitespace-nowrap">{formatPeriodKey(row.period, true)}</td>
                          <td className="text-slate-300 text-xs max-w-[160px] truncate" title={row.mainTask}>{row.mainTask || row.mainFailureCause || '—'}</td>
                          <td>
                            <span className={`badge text-[10px] ${
                              row.status === 'COMPLETED'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-amber-500/15 text-amber-400'
                            }`}>
                              {row.status === 'COMPLETED' ? 'Completed' : 'Pending'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
                  <p className="text-slate-500 text-[11px]">
                    Showing {Math.min((regPage - 1) * PAGE_SIZE + 1, registerRows.length)}–{Math.min(regPage * PAGE_SIZE, registerRows.length)} of {registerRows.length} entries
                  </p>
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
              </>
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
                  <th>Pending</th><th>Compliance</th><th>Remarks</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr key={row.id}>
                    <td className="text-slate-300 whitespace-nowrap">{formatPeriodKey(row.period, true)}</td>
                    <td className="text-white font-medium">{row.section}</td>
                    <td className="text-slate-300">{row.plannedCount}</td>
                    <td className="text-slate-300">{row.doneCount}</td>
                    <td className="text-slate-300">{row.pendingCount}</td>
                    <td className="text-slate-300">{row.compliancePct}%</td>
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
                ))}
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
      {confirmPurge && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !purgeLoading && setConfirmPurge(false)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Purge All PM Records</h3>
            <p className="text-body mb-5">
              Are you sure you want to purge all <span className="text-white font-medium">{machinePmRecords.length} PM records</span>?
              Existing <span className="text-white font-medium">{machines.length} machines</span> will remain untouched.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmPurge(false)} disabled={purgeLoading} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handlePurge} disabled={purgeLoading} className="btn-danger text-xs inline-flex items-center gap-1.5">
                <Trash2 size={12} aria-hidden="true" /> {purgeLoading ? 'Purging...' : 'Purge All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
