import { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addKpiRecord, updateKpiRecord, deleteKpiRecord, purgeKpiRecords } from '../store.js';
import { aggregateKpiRecords, kpiTrends, kpiSectionBreakdown, kpiStatusMeta, computeKpiStatus, formatPeriodKey, lastNMonths } from '../analytics.js';
import { getAllSections } from '../constants.js';
import EmptyState from '../components/EmptyState.jsx';
import SectionSelect from '../components/SectionSelect.jsx';
import { exportToCSV } from '../utils.js';
import { downloadTemplate } from '../bulkImport.js';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, ComposedChart, Line, Tooltip, Legend, AreaChart, Area,
} from 'recharts';
import {
  Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Gauge, TrendingUp, Timer, TimerReset, Plus, Pencil, Trash2, Upload, Download, Eye, Search, X, BarChart3, Wrench,
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

// ── Helpers ────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const meta = kpiStatusMeta(status);
  return <span className={`badge text-[10px] px-2 py-0.5 rounded-full border ${meta.bg} ${meta.border} ${meta.color} font-semibold`}>{meta.label}</span>;
}
function AutoManualBadge({ isManual }) {
  return isManual ? (
    <span className="text-[9px] px-1 py-0 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400 ml-1">Manual</span>
  ) : (
    <span className="text-[9px] px-1 py-0 rounded border bg-cyan-500/10 border-cyan-500/20 text-cyan-400 ml-1">Auto</span>
  );
}

// ── KPI Form Modal ────────────────────────────────────────────────────────
function KpiFormModal({ mode, initial, machines, sections, userName, onClose, pushToast }) {
  const isEdit = mode === 'edit';
  // Derive auto values for display when not manual
  const [form, setForm] = useState(() => {
    const base = initial || {};
    return {
      period: base.period || currentPeriod(),
      section: base.section || '',
      machineId: base.machineId || '',
      machineRaw: base.machineName || base.machineCode || '',
      pmCompliancePct: base.pmCompliancePct ?? '',
      breakdownCount: base.breakdownCount ?? '',
      breakdownHours: base.breakdownHours ?? '',
      mttr: base.mttr ?? '',
      mtbf: base.mtbf ?? '',
      availabilityPct: base.availabilityPct ?? '',
      kpiStatus: base.kpiStatus || 'Good',
      remarks: base.remarks || '',
      isManualPmCompliance: !!base.isManualPmCompliance,
      isManualBreakdownCount: !!base.isManualBreakdownCount,
      isManualBreakdownHours: !!base.isManualBreakdownHours,
      isManualMttr: !!base.isManualMttr,
      isManualMtbf: !!base.isManualMtbf,
      isManualAvailability: !!base.isManualAvailability,
      isManualKpiStatus: !!base.isManualKpiStatus,
    };
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const setCheck = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.checked }));
  const setMachine = (val) => {
    // val is machineId or '' for section-level
    if (!val) { setForm((p) => ({ ...p, machineId: '', machineRaw: '' })); return; }
    const m = machines.find((x) => x.id === val);
    setForm((p) => ({ ...p, machineId: m ? m.id : '', machineRaw: m ? (m.name || m.machineCode) : val }));
  };
  const filteredMachines = form.section ? machines.filter((m) => m.section === form.section) : machines;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.period || !form.section) { setError('Month and Plant/Section are required.'); return; }
    const payload = {
      period: form.period,
      section: form.section,
      machineId: form.machineId || '',
      machineCode: form.machineRaw || '',
      machineName: form.machineRaw || '',
      pmCompliancePct: form.isManualPmCompliance ? Number(form.pmCompliancePct) : undefined,
      breakdownCount: form.isManualBreakdownCount ? Number(form.breakdownCount) : undefined,
      breakdownHours: form.isManualBreakdownHours ? Number(form.breakdownHours) : undefined,
      mttr: form.isManualMttr ? Number(form.mttr) : undefined,
      mtbf: form.isManualMtbf ? Number(form.mtbf) : undefined,
      availabilityPct: form.isManualAvailability ? Number(form.availabilityPct) : undefined,
      kpiStatus: form.isManualKpiStatus ? form.kpiStatus : undefined,
      remarks: form.remarks,
      isManualPmCompliance: form.isManualPmCompliance,
      isManualBreakdownCount: form.isManualBreakdownCount,
      isManualBreakdownHours: form.isManualBreakdownHours,
      isManualMttr: form.isManualMttr,
      isManualMtbf: form.isManualMtbf,
      isManualAvailability: form.isManualAvailability,
      isManualKpiStatus: form.isManualKpiStatus,
    };
    // Remove undefined to let auto logic fill
    Object.keys(payload).forEach((k) => payload[k]===undefined && delete payload[k]);
    if (isEdit) {
      updateKpiRecord(initial.id, payload, userName);
      pushToast({ type: 'success', title: 'KPI updated', message: `${form.section} · ${form.period}` });
    } else {
      addKpiRecord(payload, userName);
      pushToast({ type: 'success', title: 'KPI added', message: `${form.section} · ${form.period}` });
    }
    onClose();
  };

  const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const labelCls = 'block text-xs text-slate-400 mb-1';
  const checkCls = 'flex items-center gap-1.5 text-[10px] text-slate-400 mt-1';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit KPI' : 'Add KPI'}>
      <div className="modal-content glass-card p-6 w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title flex items-center gap-2">
            <Activity size={16} className="text-cyan-400" aria-hidden="true" /> {isEdit ? 'Edit KPI Status' : 'Add KPI Status'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        <p className="text-meta mb-5 text-xs">Values auto-calculate from existing PM and Breakdown records for the selected Month/Section/Machine. Check <span className="text-amber-400">Manual</span> to override — auto values remain the default. Status is <span className="text-emerald-400">Auto</span> unless manually set.</p>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="kpi-period">Month *</label>
            <input id="kpi-period" type="month" className="input-field" value={form.period} onChange={set('period')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="kpi-section">Plant / Section *</label>
            <SectionSelect value={form.section} onChange={(v) => setForm((p)=> ({...p, section: v}))} id="kpi-section" ariaLabel="Plant section" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="kpi-machine">Machine / Equipment (optional)</label>
            <select id="kpi-machine" className="select-field" value={form.machineId} onChange={(e)=>setMachine(e.target.value)}>
              <option value="">Section-level (no machine)</option>
              {filteredMachines.map((m)=> <option key={m.id} value={m.id}>{m.name || m.machineCode} — {m.section}</option>)}
            </select>
            {!form.machineId && (
              <input type="text" className={`${inputCls} mt-2 text-xs`} placeholder="Or type machine name/code manually (for import)" value={form.machineRaw} onChange={set('machineRaw')} />
            )}
          </div>

          {/* PM Compliance */}
          <div>
            <label className={labelCls}>PM Compliance % <AutoManualBadge isManual={form.isManualPmCompliance} /></label>
            <input type="number" min="0" max="100" step="0.1" className={inputCls} value={form.pmCompliancePct} onChange={set('pmCompliancePct')} disabled={!form.isManualPmCompliance} placeholder={form.isManualPmCompliance ? 'e.g. 92.5' : 'Auto from PM records'} />
            <label className={checkCls}><input type="checkbox" checked={form.isManualPmCompliance} onChange={setCheck('isManualPmCompliance')} className="rounded" /> Manual override</label>
          </div>
          <div>
            <label className={labelCls}>Breakdown Count <AutoManualBadge isManual={form.isManualBreakdownCount} /></label>
            <input type="number" min="0" className={inputCls} value={form.breakdownCount} onChange={set('breakdownCount')} disabled={!form.isManualBreakdownCount} placeholder={form.isManualBreakdownCount ? '' : 'Auto from Breakdown logs'} />
            <label className={checkCls}><input type="checkbox" checked={form.isManualBreakdownCount} onChange={setCheck('isManualBreakdownCount')} className="rounded" /> Manual</label>
          </div>
          <div>
            <label className={labelCls}>Breakdown Hours <AutoManualBadge isManual={form.isManualBreakdownHours} /></label>
            <input type="number" min="0" step="0.1" className={inputCls} value={form.breakdownHours} onChange={set('breakdownHours')} disabled={!form.isManualBreakdownHours} placeholder={form.isManualBreakdownHours ? '' : 'Auto'} />
            <label className={checkCls}><input type="checkbox" checked={form.isManualBreakdownHours} onChange={setCheck('isManualBreakdownHours')} className="rounded" /> Manual</label>
          </div>
          <div>
            <label className={labelCls}>MTTR (hrs) <AutoManualBadge isManual={form.isManualMttr} /></label>
            <input type="number" min="0" step="0.1" className={inputCls} value={form.mttr} onChange={set('mttr')} disabled={!form.isManualMttr} placeholder={form.isManualMttr ? '' : 'Auto = Hours/Count'} />
            <label className={checkCls}><input type="checkbox" checked={form.isManualMttr} onChange={setCheck('isManualMttr')} className="rounded" /> Manual</label>
          </div>
          <div>
            <label className={labelCls}>MTBF (hrs) <AutoManualBadge isManual={form.isManualMtbf} /></label>
            <input type="number" min="0" step="0.1" className={inputCls} value={form.mtbf} onChange={set('mtbf')} disabled={!form.isManualMtbf} placeholder={form.isManualMtbf ? '' : 'Auto from Availability logic'} />
            <label className={checkCls}><input type="checkbox" checked={form.isManualMtbf} onChange={setCheck('isManualMtbf')} className="rounded" /> Manual</label>
          </div>
          <div>
            <label className={labelCls}>Availability % <AutoManualBadge isManual={form.isManualAvailability} /></label>
            <input type="number" min="0" max="100" step="0.1" className={inputCls} value={form.availabilityPct} onChange={set('availabilityPct')} disabled={!form.isManualAvailability} placeholder={form.isManualAvailability ? '' : 'Auto ((Avail-BD)/Avail)*100'} />
            <label className={checkCls}><input type="checkbox" checked={form.isManualAvailability} onChange={setCheck('isManualAvailability')} className="rounded" /> Manual</label>
          </div>
          <div>
            <label className={labelCls}>KPI Status <AutoManualBadge isManual={form.isManualKpiStatus} /></label>
            <select className="select-field" value={form.kpiStatus} onChange={set('kpiStatus')} disabled={!form.isManualKpiStatus}>
              <option>Good</option><option>Warning</option><option>Critical</option>
            </select>
            <label className={checkCls}><input type="checkbox" checked={form.isManualKpiStatus} onChange={setCheck('isManualKpiStatus')} className="rounded" /> Manual</label>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="kpi-remarks">Remarks</label>
            <textarea id="kpi-remarks" rows={2} className="input-field resize-none" value={form.remarks} onChange={set('remarks')} placeholder="Optional notes" />
          </div>
          {error && (
            <div className="sm:col-span-2 bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2" role="alert">
              <AlertTriangle size={13} aria-hidden="true" /> {error}
            </div>
          )}
          <button type="submit" className="sm:col-span-2 btn-primary flex items-center justify-center gap-2">
            <Plus size={14} aria-hidden="true" /> {isEdit ? 'Save Changes' : 'Add KPI Record'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Detail Modal ───────────────────────────────────────────────────────────
function DetailModal({ row, onClose }) {
  if (!row) return null;
  const details = [
    ['Month', formatPeriodKey(row.period, true)],
    ['Plant / Section', row.section],
    ['Machine / Equipment', row.machineName || row.machineCode || '— (Section-level)'],
    ['PM Compliance %', `${row.pmCompliancePct}%`, row.isManualPmCompliance ? 'Manual' : 'Auto'],
    ['Breakdown Count', row.breakdownCount, row.isManualBreakdownCount ? 'Manual' : 'Auto'],
    ['Breakdown Hours', `${row.breakdownHours} hrs`, row.isManualBreakdownHours ? 'Manual' : 'Auto'],
    ['MTTR', `${row.mttr} hrs`, row.isManualMttr ? 'Manual' : 'Auto'],
    ['MTBF', `${row.mtbf} hrs`, row.isManualMtbf ? 'Manual' : 'Auto'],
    ['Availability %', `${row.availabilityPct}%`, row.isManualAvailability ? 'Manual' : 'Auto'],
    ['KPI Status', row.kpiStatus, row.isManualKpiStatus ? 'Manual' : 'Auto'],
    ['Remarks', row.remarks || '—', ''],
  ];
  return (
    <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget&&onClose()} role="dialog" aria-modal="true" aria-label="KPI detail">
      <div className="modal-content glass-card p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title">KPI Detail</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {details.map(([label, value, src])=>(
            <div key={label} className={label==='Remarks' ? 'sm:col-span-2' : ''}>
              <dt className="text-slate-500 text-[10px] uppercase tracking-wider flex items-center gap-1">{label} {src && <span className={`text-[9px] px-1 py-0 rounded border ${src==='Manual'?'bg-amber-500/10 border-amber-500/30 text-amber-400':'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'}`}>{src}</span>}</dt>
              <dd className="text-slate-200 text-[13px] mt-0.5 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ── Summary Cards ──────────────────────────────────────────────────────────
function KpiSummaryCards({ summary }) {
  const cards = [
    { icon: ClipboardCheck, label: 'Avg PM Compliance', value: `${summary.avgPmCompliance}%`, tone: summary.avgPmCompliance>=90?'success':summary.avgPmCompliance>=75?'warning':'danger', sub: `${summary.count} records` },
    { icon: AlertTriangle, label: 'Total Breakdowns', value: summary.totalBreakdowns, tone: summary.totalBreakdowns<=2?'success':summary.totalBreakdowns<=5?'warning':'danger', sub: `${summary.totalHours} hrs` },
    { icon: Timer, label: 'Avg MTTR', value: `${summary.avgMttr}h`, tone: summary.avgMttr<=2?'success':summary.avgMttr<=5?'warning':'danger' },
    { icon: TimerReset, label: 'Avg MTBF', value: `${summary.avgMtbf}h`, tone: summary.avgMtbf>=200?'success':summary.avgMtbf>=100?'warning':'danger' },
    { icon: Gauge, label: 'Avg Availability', value: `${summary.avgAvailability}%`, tone: summary.avgAvailability>=95?'success':summary.avgAvailability>=85?'warning':'danger' },
    { icon: Activity, label: 'KPI Status Mix', value: `G:${summary.byStatus.Good} W:${summary.byStatus.Warning} C:${summary.byStatus.Critical}`, tone: summary.byStatus.Critical>0?'danger':summary.byStatus.Warning>0?'warning':'success', sub: 'Good/Warning/Critical' },
  ];
  // Map tone to KPIStat style
  const toneMap = { success:'success', warning:'warning', danger:'danger' };
  return (
    <section aria-label="KPI summary" className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((c)=>(
        <div key={c.label} className="glass-card p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-control flex items-center justify-center bg-white/[0.06] ${c.tone==='success'?'text-emerald-400':c.tone==='warning'?'text-amber-400':c.tone==='danger'?'text-red-400':'text-cyan-400'}`}>
              <c.icon size={16} aria-hidden="true" />
            </div>
            <span className="text-slate-400 text-[11px] font-medium leading-tight">{c.label}</span>
          </div>
          <p className={`text-white text-xl font-bold leading-none tabular-nums ${c.tone==='success'?'text-emerald-400':c.tone==='warning'?'text-amber-400':c.tone==='danger'?'text-red-400':''}`}>{c.value}</p>
          {c.sub && <p className="text-slate-500 text-[11px]">{c.sub}</p>}
        </div>
      ))}
    </section>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────
export default function KPIStatus() {
  const { user } = useAuth();
  const { openUpload, pushToast } = useUI();
  const store = useStore();
  const { kpiRecords = [], kpiSettings, machines = [], breakdowns = [], pms = [], machineBreakdownLogs = [], machinePmRecords = [] } = store;
  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';

  const [monthFilter, setMonthFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(false);

  const sections = getAllSections(store.plantSections);
  const machineOptions = machines;

  // Auto-refresh: when PM/Breakdown source data changes, KPI records auto-update via store refreshKpiAutoValues
  // Also ensure derived display stays in sync with Realtime
  const filtered = useMemo(() => {
    let rows = [...(kpiRecords||[])];
    if (monthFilter) rows = rows.filter((r)=>r.period===monthFilter);
    if (sectionFilter) rows = rows.filter((r)=>r.section===sectionFilter);
    if (machineFilter) rows = rows.filter((r)=>(r.machineId||'')===machineFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r)=> (r.section||'').toLowerCase().includes(q) || (r.machineName||'').toLowerCase().includes(q) || (r.machineCode||'').toLowerCase().includes(q) || (r.period||'').toLowerCase().includes(q));
    }
    return rows.sort((a,b)=> b.period.localeCompare(a.period) || a.section.localeCompare(b.section));
  }, [kpiRecords, monthFilter, sectionFilter, machineFilter, search]);

  const summary = useMemo(()=> aggregateKpiRecords(filtered), [filtered]);
  const trends = useMemo(()=> kpiTrends(kpiRecords, 6, sectionFilter||null, machineFilter||null), [kpiRecords, sectionFilter, machineFilter]);
  const sectionBreakdown = useMemo(()=> kpiSectionBreakdown(filtered), [filtered]);

  const monthOptions = useMemo(()=>{
    const set = new Set((kpiRecords||[]).map((r)=>r.period).filter(Boolean));
    // also include months from PM/Breakdown for auto-create convenience
    [...breakdowns.map((r)=>r.period), ...pms.map((r)=>r.period)].forEach((p)=>p&&set.add(p));
    return [...set].sort((a,b)=>b.localeCompare(a));
  }, [kpiRecords, breakdowns, pms]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  const handleExport = () => exportToCSV(filtered, [
    { key: 'period', label: 'Month' },
    { key: 'section', label: 'Plant/Section' },
    { key: 'machineName', label: 'Machine/Equipment' },
    { key: 'pmCompliancePct', label: 'PM Compliance %' },
    { key: 'breakdownCount', label: 'Breakdown Count' },
    { key: 'breakdownHours', label: 'Breakdown Hours' },
    { key: 'mttr', label: 'MTTR' },
    { key: 'mtbf', label: 'MTBF' },
    { key: 'availabilityPct', label: 'Availability %' },
    { key: 'kpiStatus', label: 'KPI Status' },
    { key: 'remarks', label: 'Remarks' },
  ], `kpi-status-${monthFilter||'all'}.csv`);

  return (
    <div className="max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <Activity size={28} className="text-cyan-400" aria-hidden="true" /> KPI Status
          </h2>
          <p className="text-body mt-1.5">Monthly KPI per Section/Machine — auto-calculated from PM & Breakdown records, with manual override. {kpiRecords.length} records</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap"><Download size={13} aria-hidden="true" /> Export CSV</button>
          {isAdmin && (
            <>
              <button onClick={()=> downloadTemplate('kpi')} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap"><Download size={13} aria-hidden="true" /> KPI Template</button>
              <button onClick={()=> openUpload({ kind:'bulk', module:'kpi' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs"><Upload size={13} aria-hidden="true" /> Bulk Import</button>
              <button onClick={()=>{ setEditing(null); setShowForm(true); }} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap"><Plus size={15} aria-hidden="true" /> Add KPI</button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
        <div className="flex flex-1 gap-2 flex-wrap">
          <select className="select-field text-xs min-w-[160px]" value={monthFilter} onChange={(e)=>{setMonthFilter(e.target.value); setPage(1);}}>
            <option value="">All Months</option>
            {monthOptions.map((m)=> <option key={m} value={m}>{formatPeriodKey(m,true)}</option>)}
          </select>
          <select className="select-field text-xs min-w-[180px]" value={sectionFilter} onChange={(e)=>{setSectionFilter(e.target.value); setPage(1);}}>
            <option value="">All Plant/Sections</option>
            {sections.map((s)=> <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select-field text-xs min-w-[180px]" value={machineFilter} onChange={(e)=>{setMachineFilter(e.target.value); setPage(1);}}>
            <option value="">All Machines</option>
            {machineOptions.map((m)=> <option key={m.id} value={m.id}>{m.name || m.machineCode}</option>)}
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input type="search" className="input-field pl-9 text-xs" placeholder="Search section, machine, month..." value={search} onChange={(e)=>{setSearch(e.target.value); setPage(1);}} aria-label="Search KPI" />
          </div>
        </div>
        {isAdmin && kpiRecords.length>0 && (
          <button onClick={()=>setConfirmPurge(true)} className="btn-ghost text-xs whitespace-nowrap text-red-400 hover:text-red-300 border border-red-500/20"><Trash2 size={13} aria-hidden="true" /> Purge</button>
        )}
      </div>

      {/* Summary Cards */}
      {filtered.length>0 ? <KpiSummaryCards summary={summary} /> : null}

      {/* Trend Charts — 2x2 */}
      {filtered.length>0 && (
        <section aria-label="KPI Trends" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card p-5 flex flex-col">
            <h4 className="text-card-title mb-0.5">PM Compliance Trend</h4>
            <p className="text-meta mb-3">Monthly PM compliance %</p>
            <div className="flex-1" style={{minHeight:220}}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trends} margin={{top:8,right:12,left:4,bottom:0}}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={[0,100]} unit="%" />
                  <ChartTooltip />
                  <Line type="monotone" dataKey="pmCompliance" name="PM Compliance %" stroke="#10B981" strokeWidth={2.5} dot={{r:3,fill:'#10B981'}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="glass-card p-5 flex flex-col">
            <h4 className="text-card-title mb-0.5">Availability Trend</h4>
            <p className="text-meta mb-3">Monthly availability %</p>
            <div className="flex-1" style={{minHeight:220}}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trends} margin={{top:8,right:12,left:4,bottom:0}}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={[0,100]} unit="%" />
                  <ChartTooltip />
                  <Line type="monotone" dataKey="availability" name="Availability %" stroke="#06B6D4" strokeWidth={2.5} dot={{r:3,fill:'#06B6D4'}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="glass-card p-5 flex flex-col">
            <h4 className="text-card-title mb-0.5">MTTR Trend</h4>
            <p className="text-meta mb-3">Mean time to repair (hrs)</p>
            <div className="flex-1" style={{minHeight:220}}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trends} margin={{top:8,right:12,left:4,bottom:0}}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                  <ChartTooltip />
                  <Line type="monotone" dataKey="mttr" name="MTTR" stroke="#8B5CF6" strokeWidth={2.5} dot={{r:3,fill:'#8B5CF6'}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="glass-card p-5 flex flex-col">
            <h4 className="text-card-title mb-0.5">MTBF Trend</h4>
            <p className="text-meta mb-3">Mean time between failures (hrs)</p>
            <div className="flex-1" style={{minHeight:220}}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trends} margin={{top:8,right:12,left:4,bottom:0}}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                  <ChartTooltip />
                  <Line type="monotone" dataKey="mtbf" name="MTBF" stroke="#F59E0B" strokeWidth={2.5} dot={{r:3,fill:'#F59E0B'}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Section-wise breakdown */}
      {sectionBreakdown.length>0 && (
        <div className="glass-card p-5">
          <h4 className="text-card-title mb-0.5">Section-wise KPI Overview</h4>
          <p className="text-meta mb-3">Aggregated by Plant/Section {monthFilter? `for ${formatPeriodKey(monthFilter,true)}`:''}</p>
          <div className="overflow-x-auto">
            <table className="enterprise-table w-full min-w-[700px] text-xs">
              <thead><tr><th>Plant/Section</th><th>Records</th><th>PM Compliance</th><th>Availability</th><th>MTTR</th><th>MTBF</th><th>Breakdowns</th></tr></thead>
              <tbody>
                {sectionBreakdown.map((r)=>(
                  <tr key={r.section} className="hover:bg-white/[0.03] cursor-pointer" onClick={()=>setSectionFilter(r.section)}>
                    <td className="text-white font-medium">{r.section}</td>
                    <td className="text-slate-300">{r.count}</td>
                    <td className="text-emerald-400">{r.avgPmCompliance}%</td>
                    <td className="text-cyan-400">{r.avgAvailability}%</td>
                    <td className="text-slate-300">{r.avgMttr}h</td>
                    <td className="text-slate-300">{r.avgMtbf}h</td>
                    <td className="text-slate-300">{r.breakdownCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly KPI Table */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-control bg-cyan-400/10 border border-cyan-400/25 flex items-center justify-center">
            <BarChart3 size={17} className="text-cyan-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-card-title">Monthly KPI Table</h3>
            <p className="text-meta">Month • Plant/Section • Machine • PM% • Breakdowns • MTTR/MTBF • Availability • Status</p>
          </div>
        </div>
        {paged.length===0 ? (
          <EmptyState title="No KPI data available." description="KPIs auto-generate from PM and Breakdown records for the selected month/section/machine. Add a KPI record or import via Bulk/Master Excel. Manual overrides are marked Manual, otherwise Auto Calculated." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[1100px] text-xs">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                  <tr>
                    <th>Month</th><th>Plant/Section</th><th>Machine/Equipment</th><th>PM Compliance %</th><th>Breakdown Count</th><th>Breakdown Hours</th><th>MTTR</th><th>MTBF</th><th>Availability %</th><th>KPI Status</th><th>Remarks</th><th className="w-20 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row)=>(
                    <tr key={row.id} className="hover:bg-white/[0.03]">
                      <td className="text-slate-300 whitespace-nowrap">{formatPeriodKey(row.period,true)}</td>
                      <td className="text-white font-medium max-w-[140px] truncate" title={row.section}>{row.section}</td>
                      <td className="text-slate-300 max-w-[140px] truncate" title={row.machineName||row.machineCode||''}>{row.machineName || row.machineCode || <span className="text-slate-600">— Section-level</span>}</td>
                      <td className="text-emerald-400 tabular-nums">{row.pmCompliancePct}% <AutoManualBadge isManual={row.isManualPmCompliance} /></td>
                      <td className="text-slate-300 tabular-nums">{row.breakdownCount} <AutoManualBadge isManual={row.isManualBreakdownCount} /></td>
                      <td className="text-slate-300 tabular-nums">{row.breakdownHours}h <AutoManualBadge isManual={row.isManualBreakdownHours} /></td>
                      <td className="text-slate-300 tabular-nums">{row.mttr}h <AutoManualBadge isManual={row.isManualMttr} /></td>
                      <td className="text-slate-300 tabular-nums">{row.mtbf}h <AutoManualBadge isManual={row.isManualMtbf} /></td>
                      <td className="text-cyan-400 tabular-nums">{row.availabilityPct}% <AutoManualBadge isManual={row.isManualAvailability} /></td>
                      <td><StatusBadge status={row.kpiStatus} /> <AutoManualBadge isManual={row.isManualKpiStatus} /></td>
                      <td className="text-slate-400 max-w-[120px] truncate" title={row.remarks}>{row.remarks||'—'}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={()=>setViewing(row)} className="btn-ghost !p-1.5 text-slate-500 hover:text-cyan-400" aria-label="View"><Eye size={13} /></button>
                          {isAdmin && <>
                            <button onClick={()=>{setEditing(row); setShowForm(true);}} className="btn-ghost !p-1.5 text-slate-500 hover:text-cyan-400" aria-label="Edit"><Pencil size={13} /></button>
                            <button onClick={()=>setDeleting(row)} className="btn-ghost !p-1.5 text-slate-500 hover:text-red-400" aria-label="Delete"><Trash2 size={13} /></button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
              <p className="text-slate-500 text-[11px]">Showing {Math.min((page-1)*PAGE_SIZE+1, filtered.length)}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length} records</p>
              <div className="flex items-center gap-1">
                <button onClick={()=>setPage((p)=>Math.max(1,p-1))} disabled={page<=1} className="btn-ghost !p-1.5 disabled:opacity-30" aria-label="Prev"><X size={14} className="rotate-90" /></button>
                {Array.from({length: Math.min(totalPages,5)}, (_,i)=>{
                  const start = Math.max(1, Math.min(page-2, totalPages-4));
                  const p = start+i;
                  if(p>totalPages) return null;
                  return <button key={p} onClick={()=>setPage(p)} className={`w-7 h-7 rounded-control text-[11px] font-medium transition-all ${p===page?'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30':'text-slate-400 hover:bg-white/[0.06]'}`}>{p}</button>;
                })}
                <button onClick={()=>setPage((p)=>Math.min(totalPages,p+1))} disabled={page>=totalPages} className="btn-ghost !p-1.5 disabled:opacity-30" aria-label="Next"><X size={14} className="-rotate-90" /></button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showForm && <KpiFormModal mode={editing?'edit':'add'} initial={editing} machines={machines} sections={sections} userName={userName} onClose={()=>{setShowForm(false); setEditing(null);}} pushToast={pushToast} />}
      {viewing && <DetailModal row={viewing} onClose={()=>setViewing(null)} />}
      {deleting && (
        <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget&&setDeleting(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Delete KPI Record</h3>
            <p className="text-body mb-5">Delete KPI for <span className="text-white font-medium">{deleting.section}</span> · {formatPeriodKey(deleting.period,true)} {deleting.machineName? `· ${deleting.machineName}`:''}?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setDeleting(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={()=>{deleteKpiRecord(deleting.id, userName); setDeleting(null); pushToast({type:'success', title:'KPI deleted', message:`${deleting.section} · ${deleting.period}`});}} className="btn-danger text-xs inline-flex items-center gap-1.5"><Trash2 size={12} aria-hidden="true" /> Delete</button>
            </div>
          </div>
        </div>
      )}
      {confirmPurge && (
        <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget&&setConfirmPurge(false)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Purge KPI Data</h3>
            <p className="text-body mb-5">This will delete <span className="text-white font-medium">{kpiRecords.length} KPI records</span>. Existing PM and Breakdown data will remain untouched.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setConfirmPurge(false)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={async()=>{ await purgeKpiRecords(userName); setConfirmPurge(false); pushToast({type:'success', title:'KPI purged', message:'All KPI records deleted'}); }} className="btn-danger text-xs inline-flex items-center gap-1.5"><Trash2 size={12} aria-hidden="true" /> Purge All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
