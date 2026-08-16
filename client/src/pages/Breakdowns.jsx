import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import {
  useStore, addBreakdown, deleteBreakdown, updateBreakdown,
  addMachineBreakdownLog, deleteMachineBreakdownLog,
} from '../store.js';
import {
  aggregateBreakdownRecords, computeAvailability, formatPeriodKey,
  monthlyBreakdownTrend, machineWiseBreakdown, paretoTop10Machines,
  failureCausePareto, machineBreakdownRegister, lastNMonths,
} from '../analytics.js';
import { MASTER_PLANT_SECTION, getOperationalSections } from '../constants.js';
import EmptyState from '../components/EmptyState.jsx';
import { ChartCard } from '../components/AnalyticsCharts.jsx';
import { exportToCSV } from '../utils.js';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ComposedChart, Line, Tooltip, Legend,
} from 'recharts';
import {
  AlertCircle, AlertOctagon, ChevronLeft, ChevronRight, Download, Eye,
  Gauge, Pencil, Plus, Search, Timer, TimerReset, Trash2, Upload, Wrench, X,
} from 'lucide-react';

const PAGE_SIZE = 15;
const currentPeriod = () => new Date().toISOString().slice(0, 7);

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
function ChartTooltip(props) {
  return <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.06)' }} {...props} />;
}

// ── Modals ──────────────────────────────────────────────────────────────────

function SummaryModal({ userName, onClose, sections }) {
  const [form, setForm] = useState({
    period: currentPeriod(),
    section: '',
    breakdownCount: '',
    downtimeHours: '',
    mttr: '',
    mtbf: '',
    remarks: '',
  });
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.period || !form.section) {
      setError('Reporting month and plant section are required.');
      return;
    }
    addBreakdown(form, userName);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Log monthly breakdown summary">
      <div className="modal-content glass-card p-6 w-full max-w-xl max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title flex items-center gap-2">
            <AlertOctagon size={16} className="text-red-400" aria-hidden="true" /> Monthly Breakdown Summary
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        <p className="text-meta mb-5">MTTR auto-calculates from downtime and breakdown count. MTBF auto-calculates from available operating hours when left blank.</p>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-period">Month & Year *</label>
            <input id="bd-period" type="month" className="input-field" value={form.period} onChange={set('period')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-section">Plant Section *</label>
            <select id="bd-section" className="select-field" value={form.section} onChange={set('section')}>
              <option value="">Select section...</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-count">Total Number of Breakdowns</label>
            <input id="bd-count" type="number" min="0" className="input-field" value={form.breakdownCount} onChange={set('breakdownCount')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-hours">Total Breakdown Hours</label>
            <input id="bd-hours" type="number" min="0" step="0.1" className="input-field" value={form.downtimeHours} onChange={set('downtimeHours')} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-mttr">MTTR (hrs)</label>
            <input id="bd-mttr" type="number" min="0" step="0.1" className="input-field" value={form.mttr} onChange={set('mttr')} placeholder="Leave blank to auto-calculate" />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-mtbf">MTBF (hrs)</label>
            <input id="bd-mtbf" type="number" min="0" step="0.1" className="input-field" value={form.mtbf} onChange={set('mtbf')} placeholder="Leave blank to auto-calculate" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="bd-remarks">Remarks</label>
            <textarea id="bd-remarks" rows={3} className="input-field resize-none" value={form.remarks} onChange={set('remarks')} placeholder="Optional notes for the monthly summary" />
          </div>
          {error && (
            <div className="sm:col-span-2 bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}
          <button type="submit" className="sm:col-span-2 btn-danger flex items-center justify-center gap-2">
            <Plus size={14} aria-hidden="true" /> Save Monthly Summary
          </button>
        </form>
      </div>
    </div>
  );
}

function DetailModal({ row, onClose }) {
  const details = [
    ['Period', formatPeriodKey(row.period, true)],
    ['Plant Section', row.section],
    ['Breakdowns', row.breakdownCount],
    ['Downtime Hours', `${row.downtimeHours} hrs`],
    ['MTTR', `${row.mttr} hrs`],
    ['MTBF', `${row.mtbf} hrs`],
    ['Operating Hours', `${row.operatingHours || 0} hrs`],
    ['Remarks', row.remarks || '—'],
  ];
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Breakdown summary details">
      <div className="modal-content glass-card p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title">Breakdown Summary Detail</h3>
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

function EditBreakdownModal({ row, userName, onClose }) {
  const [form, setForm] = useState({
    breakdownCount: String(row.breakdownCount ?? ''),
    downtimeHours: String(row.downtimeHours ?? ''),
    operatingHours: String(row.operatingHours ?? ''),
    mttr: String(row.mttr ?? ''),
    mtbf: String(row.mtbf ?? ''),
    availability_override: row.availability_override != null ? String(row.availability_override) : '',
    remarks: row.remarks || '',
  });
  const overlayRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = (e) => {
    e.preventDefault();
    updateBreakdown(row.id, {
      ...form,
      availability_override: form.availability_override !== '' ? Number(form.availability_override) : null,
    }, userName);
    onClose();
  };

  const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const labelCls = 'block text-xs text-slate-400 mb-1';
  const periodLabel = new Date(`${row.period}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div ref={overlayRef} onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true" aria-label="Edit breakdown record">
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-card-title">Edit Breakdown Summary</h3>
            <p className="text-meta mt-0.5">{periodLabel} · {row.section}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X size={16} /></button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Breakdown Count</label><input type="number" min="0" value={form.breakdownCount} onChange={set('breakdownCount')} className={inputCls} /></div>
            <div><label className={labelCls}>Downtime (hrs)</label><input type="number" min="0" step="0.1" value={form.downtimeHours} onChange={set('downtimeHours')} className={inputCls} /></div>
            <div><label className={labelCls}>Operating Hours</label><input type="number" min="0" step="0.1" value={form.operatingHours} onChange={set('operatingHours')} className={inputCls} /></div>
            <div><label className={labelCls}>MTTR (hrs)</label><input type="number" min="0" step="0.01" value={form.mttr} onChange={set('mttr')} className={inputCls} /></div>
            <div><label className={labelCls}>MTBF (hrs)</label><input type="number" min="0" step="0.01" value={form.mtbf} onChange={set('mtbf')} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Availability Override % <span className="ml-1.5 text-slate-500 text-[10px]">(blank = auto)</span></label>
              <input type="number" min="0" max="100" step="0.1" value={form.availability_override} onChange={set('availability_override')} placeholder="e.g. 94.5"
                className={`${inputCls} ${form.availability_override !== '' ? 'border-amber-400/50' : ''}`} />
            </div>
          </div>
          {form.availability_override !== '' && (
            <p className="text-xs text-amber-300 bg-amber-400/8 border border-amber-400/20 rounded-control px-3 py-2">
              Override active — availability KPIs will use <strong>{form.availability_override}%</strong> for this period.
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

// ── KPI Card ────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, changePct, cls, invert }) {
  const positive = changePct > 0;
  const negative = changePct < 0;
  const isGood = invert ? negative : positive;
  const changeColor = changePct === 0 ? 'text-slate-500 bg-slate-500/10 border-slate-500/20'
    : isGood ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
    : 'text-red-400 bg-red-400/10 border-red-400/20';
  const arrow = positive ? '↑' : negative ? '↓' : '—';

  return (
    <div className="glass-card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-control flex items-center justify-center ${cls} bg-current/10`}>
          <Icon size={16} className={cls} aria-hidden="true" />
        </div>
        <span className="text-slate-400 text-[11px] font-medium leading-tight">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-white text-xl font-bold leading-none tabular-nums">{value}</p>
        {changePct != null && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-control border ${changeColor}`}>
            {arrow} {Math.abs(changePct)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function Breakdowns() {
  const { user } = useAuth();
  const { openUpload } = useUI();
  const store = useStore();
  const navigate = useNavigate();
  const { breakdowns, machines, machineBreakdownLogs } = store;
  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const currentKey = currentPeriod();

  // Modals
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

  const sections = useMemo(
    () => [MASTER_PLANT_SECTION, ...getOperationalSections(machines)],
    [machines]
  );

  // ── KPI data ──────────────────────────────────────────────────────────────
  const currentSummary = useMemo(() => aggregateBreakdownRecords(breakdowns, currentKey), [breakdowns, currentKey]);
  const availability = useMemo(() => computeAvailability(breakdowns, machines.length, currentKey), [breakdowns, machines.length, currentKey]);

  const prevMonthKey = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const prevSummary = useMemo(() => aggregateBreakdownRecords(breakdowns, prevMonthKey), [breakdowns, prevMonthKey]);
  const prevAvailability = useMemo(() => computeAvailability(breakdowns, machines.length, prevMonthKey), [breakdowns, machines.length, prevMonthKey]);

  const pctChange = (curr, prev) => {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  // ── Chart data ────────────────────────────────────────────────────────────
  const trend = useMemo(() => monthlyBreakdownTrend(breakdowns, 12), [breakdowns]);
  const topMachines = useMemo(() => machineWiseBreakdown(machineBreakdownLogs).slice(0, 10), [machineBreakdownLogs]);
  const topMachinesPareto = useMemo(() => paretoTop10Machines(machineBreakdownLogs), [machineBreakdownLogs]);
  const failurePareto = useMemo(() => failureCausePareto(machineBreakdownLogs), [machineBreakdownLogs]);
  const monthlyRegister = useMemo(() => machineBreakdownRegister(machineBreakdownLogs), [machineBreakdownLogs]);

  // ── Month tabs for register ────────────────────────────────────────────────
  const monthTabs = useMemo(() => {
    const counts = {};
    machineBreakdownLogs.forEach((r) => {
      const m = String(r.date || '').slice(0, 7);
      if (m) counts[m] = (counts[m] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [machineBreakdownLogs]);

  // Auto-select first month if none selected
  const activeMonth = registerMonth || (monthTabs.length > 0 ? monthTabs[0].key : '');

  // ── Register table rows ───────────────────────────────────────────────────
  const registerRows = useMemo(() => {
    const logs = activeMonth
      ? machineBreakdownLogs.filter((r) => String(r.date || '').slice(0, 7) === activeMonth)
      : machineBreakdownLogs;
    const q = regSearch.toLowerCase();
    return logs
      .filter((r) => {
        if (q && !(r.machineName || '').toLowerCase().includes(q) && !(r.machineCode || '').toLowerCase().includes(q) && !(r.failureCause || '').toLowerCase().includes(q)) return false;
        if (regSection && r.plantSection !== regSection) return false;
        if (regStatus === 'open' && r.status === 'closed') return false;
        if (regStatus === 'closed' && r.status !== 'closed') return false;
        return true;
      })
      .sort((a, b) => (b.startTime || b.date || '').localeCompare(a.startTime || a.date || ''));
  }, [machineBreakdownLogs, activeMonth, regSearch, regSection, regStatus]);

  const totalRegPages = Math.max(1, Math.ceil(registerRows.length / PAGE_SIZE));
  const paginatedRows = registerRows.slice((regPage - 1) * PAGE_SIZE, regPage * PAGE_SIZE);

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = () => exportToCSV(
    registerRows.map((r) => ({
      ...r,
      startTime: r.startTime ? new Date(r.startTime).toLocaleString('en-GB') : '',
      endTime: r.endTime ? new Date(r.endTime).toLocaleString('en-GB') : '',
    })),
    [
      { key: 'machineCode', label: 'Machine Code' },
      { key: 'machineName', label: 'Machine Name' },
      { key: 'plantSection', label: 'Section' },
      { key: 'startTime', label: 'Start Time' },
      { key: 'endTime', label: 'End Time' },
      { key: 'downtimeHours', label: 'Downtime (hrs)' },
      { key: 'failureCause', label: 'Failure Cause' },
      { key: 'actionTaken', label: 'Action Taken' },
      { key: 'status', label: 'Status' },
      { key: 'remarks', label: 'Remarks' },
    ],
    `breakdown-register-${activeMonth || 'all'}.csv`
  );

  const kpiCards = [
    { icon: AlertOctagon, label: 'Total Breakdowns', value: currentSummary.breakdownCount, changePct: pctChange(currentSummary.breakdownCount, prevSummary.breakdownCount), cls: 'text-red-400', invert: true },
    { icon: Timer, label: 'Total Downtime', value: `${currentSummary.downtimeHours}h`, changePct: pctChange(currentSummary.downtimeHours, prevSummary.downtimeHours), cls: 'text-orange-400', invert: true },
    { icon: TimerReset, label: 'MTTR', value: `${currentSummary.mttr}h`, changePct: pctChange(currentSummary.mttr, prevSummary.mttr), cls: 'text-cyan-400', invert: true },
    { icon: Gauge, label: 'MTBF', value: `${currentSummary.mtbf}h`, changePct: pctChange(currentSummary.mtbf, prevSummary.mtbf), cls: 'text-violet-400', invert: false },
    { icon: Gauge, label: 'Availability', value: `${availability}%`, changePct: pctChange(availability, prevAvailability), cls: 'text-emerald-400', invert: false },
  ];

  return (
    <div className="max-w-[1440px] mx-auto space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <AlertOctagon size={28} className="text-red-400" aria-hidden="true" />
            Breakdown Management
          </h2>
          <p className="text-body mt-1.5">Per-machine breakdown tracking, RCA analytics, and section-level monthly summaries for {machines.length} machines</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {isAdmin && (
            <>
              <button onClick={() => openUpload({ kind: 'bulk', module: 'machineBreakdownLogs' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs">
                <Upload size={13} aria-hidden="true" /> Bulk Import
              </button>
              <button onClick={() => setShowNew(true)} className="btn-danger inline-flex items-center gap-2 whitespace-nowrap">
                <Plus size={15} aria-hidden="true" /> Log Monthly Summary
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── KPI Row: 5 cards ────────────────────────────────────────────── */}
      <section aria-label="KPI summary" className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {kpiCards.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </section>

      {/* ── Charts Row: 3 columns ───────────────────────────────────────── */}
      <section aria-label="Charts" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top 10 Machines by Breakdown */}
        <div className="glass-card p-5 flex flex-col">
          <h4 className="text-card-title mb-0.5">Top 10 Machines</h4>
          <p className="text-meta mb-3">Ranked by breakdown count</p>
          <div className="flex-1" style={{ minHeight: 260 }}>
            {topMachines.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No machine breakdown logs yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topMachines} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: '#94A3B8', fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
                  <ChartTooltip formatter={(v) => [`${v} breakdowns`, 'Count']} />
                  <Bar dataKey="count" name="Breakdowns" fill="#EF4444" fillOpacity={0.85} radius={[0, 5, 5, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Failure Cause Pareto */}
        <div className="glass-card p-5 flex flex-col">
          <h4 className="text-card-title mb-0.5">Failure Cause Pareto</h4>
          <p className="text-meta mb-3">Breakdown causes ranked by frequency</p>
          <div className="flex-1" style={{ minHeight: 260 }}>
            {failurePareto.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No failure cause data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={failurePareto.slice(0, 10)} margin={{ top: 8, right: 6, left: 4, bottom: 28 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 9 }} axisLine={false} tickLine={false} angle={-32} textAnchor="end" interval={0} height={52} />
                  <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
                  <YAxis yAxisId="right" orientation="right" tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" width={44} />
                  <ChartTooltip />
                  <Bar yAxisId="left" dataKey="count" name="Count" fill="#06B6D4" fillOpacity={0.85} radius={[5, 5, 0, 0]} maxBarSize={26} />
                  <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Cumulative %" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3, fill: '#F59E0B' }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Monthly BD & Downtime Trend */}
        <div className="glass-card p-5 flex flex-col">
          <h4 className="text-card-title mb-0.5">Monthly Trend</h4>
          <p className="text-meta mb-3">Breakdown count and downtime hours</p>
          <div className="flex-1" style={{ minHeight: 260 }}>
            {trend.every((t) => t.count === 0) ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No breakdown trend data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
                  <YAxis yAxisId="right" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={48} />
                  <ChartTooltip />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} iconType="circle" iconSize={8} />
                  <Line yAxisId="left" type="monotone" dataKey="count" name="Breakdowns" stroke="#EF4444" strokeWidth={2.5} dot={{ r: 3, fill: '#EF4444' }} />
                  <Line yAxisId="right" type="monotone" dataKey="downtime" name="Downtime (hrs)" stroke="#06B6D4" strokeWidth={2.5} dot={{ r: 3, fill: '#06B6D4' }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ── MTTR & MTBF Row ─────────────────────────────────────────────── */}
      <section aria-label="MTTR and MTBF trends" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-5 flex flex-col">
          <h4 className="text-card-title mb-0.5">MTTR Trend</h4>
          <p className="text-meta mb-3">Mean time to repair (hrs) by month</p>
          <div className="flex-1" style={{ minHeight: 220 }}>
            {trend.every((t) => t.mttr === 0) ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No MTTR data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-mttr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} />
                  <ChartTooltip formatter={(v) => [`${v} hrs`, 'MTTR']} />
                  <Line type="monotone" dataKey="mttr" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 3, fill: '#8B5CF6' }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="glass-card p-5 flex flex-col">
          <h4 className="text-card-title mb-0.5">MTBF Trend</h4>
          <p className="text-meta mb-3">Mean time between failures (hrs) by month</p>
          <div className="flex-1" style={{ minHeight: 220 }}>
            {trend.every((t) => t.mtbf === 0) ? (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No MTBF data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-mtbf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} />
                  <ChartTooltip formatter={(v) => [`${v} hrs`, 'MTBF']} />
                  <Line type="monotone" dataKey="mtbf" stroke="#06B6D4" strokeWidth={2.5} dot={{ r: 3, fill: '#06B6D4' }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ── Month-wise Machine Breakdown Register ────────────────────────── */}
      <section aria-label="Machine breakdown register">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-control bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">
              <AlertOctagon size={17} className="text-amber-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-card-title">Machine Breakdown Register</h3>
              <p className="text-meta">Per-machine breakdown log — click a month tab to filter</p>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-4">
            {/* Left: Month tabs */}
            <div className="col-span-12 lg:col-span-3">
              <div className="max-h-[480px] overflow-y-auto space-y-1 pr-1">
                {monthTabs.length === 0 && (
                  <p className="text-slate-500 text-xs py-4 text-center">No breakdown logs yet</p>
                )}
                {monthTabs.map((tab) => {
                  const [y, m] = tab.key.split('-').map(Number);
                  const label = new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                  const isActive = activeMonth === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => { setRegisterMonth(tab.key); setRegPage(1); }}
                      className={`w-full text-left px-3 py-2.5 rounded-control text-xs transition-all flex items-center justify-between gap-2 ${
                        isActive
                          ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30 font-semibold'
                          : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-amber-400/20 text-amber-300' : 'bg-white/[0.06] text-slate-500'}`}>
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Table + filters */}
            <div className="col-span-12 lg:col-span-9">
              {/* Filters bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                  <input type="search" className="input-field pl-9 text-xs" placeholder="Search machine, code, failure cause..."
                    value={regSearch} onChange={(e) => { setRegSearch(e.target.value); setRegPage(1); }} aria-label="Search machine breakdown logs" />
                </div>
                <select className="select-field text-xs" value={regSection} onChange={(e) => { setRegSection(e.target.value); setRegPage(1); }} aria-label="Filter by section">
                  <option value="">All Sections</option>
                  {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="select-field text-xs" value={regStatus} onChange={(e) => { setRegStatus(e.target.value); setRegPage(1); }} aria-label="Filter by status">
                  <option value="">All Statuses</option>
                  <option value="open">Open / Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              {/* Table */}
              {paginatedRows.length === 0 ? (
                <div className="py-12 text-center">
                  <AlertOctagon size={28} className="text-slate-600 mx-auto mb-3" aria-hidden="true" />
                  <p className="text-slate-500 text-xs">
                    {machineBreakdownLogs.length ? 'No breakdown logs match the current filters.' : 'No machine breakdown logs yet. Import via Bulk Import or log from Machine Profiles.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="enterprise-table w-full min-w-[900px]">
                      <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                        <tr>
                          <th>Machine Code</th>
                          <th>Machine Name</th>
                          <th>Section</th>
                          <th>Start Time</th>
                          <th>End Time</th>
                          <th>Downtime</th>
                          <th>Failure Cause</th>
                          <th>Status</th>
                          <th>Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.map((row) => {
                          const startD = row.startTime ? new Date(row.startTime) : null;
                          const endD = row.endTime ? new Date(row.endTime) : null;
                          return (
                            <tr key={row.id}
                              className="cursor-pointer hover:bg-white/[0.03]"
                              onClick={() => row.machineId && navigate(`/machines/${row.machineId}`)}
                            >
                              <td className="text-cyan-400 font-mono text-xs whitespace-nowrap">{row.machineCode || row.machineId}</td>
                              <td className="text-white font-medium text-xs max-w-[140px] truncate">{row.machineName}</td>
                              <td className="text-slate-300 text-xs max-w-[120px] truncate">{row.plantSection}</td>
                              <td className="text-slate-300 text-[11px] whitespace-nowrap">{startD ? startD.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                              <td className="text-slate-300 text-[11px] whitespace-nowrap">{endD ? endD.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                              <td className="text-amber-300 text-xs font-semibold">{row.downtimeHours ? `${row.downtimeHours}h` : '—'}</td>
                              <td className="text-slate-300 text-xs max-w-[160px] truncate" title={row.failureCause}>{row.failureCause || '—'}</td>
                              <td>
                                <span className={`badge text-[10px] ${row.status === 'closed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                  {row.status === 'closed' ? 'Closed' : 'Open'}
                                </span>
                              </td>
                              <td className="text-slate-400 text-[11px] max-w-[100px] truncate" title={row.remarks}>{row.remarks || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
                    <p className="text-slate-500 text-[11px]">
                      Showing {Math.min((regPage - 1) * PAGE_SIZE + 1, registerRows.length)}–{Math.min(regPage * PAGE_SIZE, registerRows.length)} of {registerRows.length} entries
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setRegPage((p) => Math.max(1, p - 1))}
                        disabled={regPage <= 1}
                        className="btn-ghost !p-1.5 disabled:opacity-30"
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      {Array.from({ length: Math.min(totalRegPages, 5) }, (_, i) => {
                        const start = Math.max(1, Math.min(regPage - 2, totalRegPages - 4));
                        const pageNum = start + i;
                        if (pageNum > totalRegPages) return null;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setRegPage(pageNum)}
                            className={`w-7 h-7 rounded-control text-[11px] font-medium transition-all ${
                              pageNum === regPage
                                ? 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                                : 'text-slate-400 hover:bg-white/[0.06]'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setRegPage((p) => Math.min(totalRegPages, p + 1))}
                        disabled={regPage >= totalRegPages}
                        className="btn-ghost !p-1.5 disabled:opacity-30"
                        aria-label="Next page"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showNew && <SummaryModal userName={userName} sections={sections} onClose={() => setShowNew(false)} />}
      {viewing && <DetailModal row={viewing} onClose={() => setViewing(null)} />}
      {editing && isAdmin && <EditBreakdownModal row={editing} userName={userName} onClose={() => setEditing(null)} />}
      {deleting && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleting(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Delete Breakdown Summary</h3>
            <p className="text-body mb-5">Delete the summary for <span className="text-white font-medium">{deleting.section}</span> in <span className="text-white font-medium">{formatPeriodKey(deleting.period, true)}</span>?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleting(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => { deleteBreakdown(deleting.id, userName); setDeleting(null); }} className="btn-danger text-xs inline-flex items-center gap-1.5">
                <Trash2 size={12} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
