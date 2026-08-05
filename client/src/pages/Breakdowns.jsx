import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addBreakdown, deleteBreakdown, updateBreakdown } from '../store.js';
import {
  aggregateBreakdownRecords,
  computeAvailability,
  formatPeriodKey,
  monthlyBreakdownTrend,
} from '../analytics.js';
import { MASTER_PLANT_SECTION, getOperationalSections } from '../constants.js';
import EmptyState from '../components/EmptyState.jsx';
import { ChartCard, DualTrendChart, TrendChart } from '../components/AnalyticsCharts.jsx';
import { exportToCSV } from '../utils.js';
import {
  AlertCircle, AlertOctagon, Download, Eye, Gauge, Pencil, Plus, Search,
  Timer, TimerReset, Trash2, Upload, Wrench, X,
} from 'lucide-react';

const currentPeriod = () => new Date().toISOString().slice(0, 7);

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
  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.period || !form.section) {
      setError('Reporting month and plant section are required.');
      return;
    }
    addBreakdown(form, userName);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Log monthly breakdown summary">
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
              {sections.map((section) => <option key={section} value={section}>{section}</option>)}
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
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Breakdown summary details">
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

// ── Inline edit modal ────────────────────────────────────────────────────────
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
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true" aria-label="Edit breakdown record"
    >
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
            <div>
              <label className={labelCls}>Breakdown Count</label>
              <input type="number" min="0" value={form.breakdownCount} onChange={set('breakdownCount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Downtime (hrs)</label>
              <input type="number" min="0" step="0.1" value={form.downtimeHours} onChange={set('downtimeHours')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Operating Hours</label>
              <input type="number" min="0" step="0.1" value={form.operatingHours} onChange={set('operatingHours')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>MTTR (hrs)</label>
              <input type="number" min="0" step="0.01" value={form.mttr} onChange={set('mttr')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>MTBF (hrs)</label>
              <input type="number" min="0" step="0.01" value={form.mtbf} onChange={set('mtbf')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>
                Availability Override %
                <span className="ml-1.5 text-slate-500 text-[10px]">(blank = auto)</span>
              </label>
              <input
                type="number" min="0" max="100" step="0.1"
                value={form.availability_override}
                onChange={set('availability_override')}
                placeholder="e.g. 94.5"
                className={`${inputCls} ${form.availability_override !== '' ? 'border-amber-400/50' : ''}`}
              />
            </div>
          </div>
          {form.availability_override !== '' && (
            <p className="text-xs text-amber-300 bg-amber-400/8 border border-amber-400/20 rounded-control px-3 py-2">
              Override active — availability KPIs will use <strong>{form.availability_override}%</strong> for this period.
            </p>
          )}
          <div>
            <label className={labelCls}>Remarks</label>
            <textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button type="submit" className="btn-primary text-xs">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Breakdowns() {
  const { user } = useAuth();
  const { openUpload } = useUI();
  const store = useStore();
  const { breakdowns, machines } = store;
  const [search, setSearch] = useState('');
  const [sectionF, setSectionF] = useState('');
  const [yearF, setYearF] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const currentKey = currentPeriod();
  const sections = useMemo(
    () => [MASTER_PLANT_SECTION, ...getOperationalSections(machines)],
    [machines]
  );
  const trend = useMemo(() => monthlyBreakdownTrend(breakdowns, 12), [breakdowns]);
  const currentSummary = useMemo(() => aggregateBreakdownRecords(breakdowns, currentKey), [breakdowns, currentKey]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return [...breakdowns]
      .filter((row) => (
        (!q || row.section.toLowerCase().includes(q) || formatPeriodKey(row.period, true).toLowerCase().includes(q) || (row.remarks || '').toLowerCase().includes(q)) &&
        (!sectionF || row.section === sectionF) &&
        (!yearF || String(row.year) === yearF)
      ))
      .sort((a, b) => b.period.localeCompare(a.period) || a.section.localeCompare(b.section));
  }, [breakdowns, search, sectionF, yearF]);

  const handleExport = () => exportToCSV(
    rows,
    [
      { label: 'Reporting Period', value: (row) => formatPeriodKey(row.period, true) },
      { key: 'section', label: 'Plant Section' },
      { key: 'breakdownCount', label: 'Breakdown Count' },
      { key: 'downtimeHours', label: 'Downtime Hours' },
      { key: 'mttr', label: 'MTTR (hrs)' },
      { key: 'mtbf', label: 'MTBF (hrs)' },
      { key: 'operatingHours', label: 'Operating Hours' },
      { key: 'remarks', label: 'Remarks' },
    ],
    'breakdown-monthly-summary.csv'
  );

  const availability = useMemo(
    () => computeAvailability(breakdowns, machines.length, currentKey),
    [breakdowns, machines.length, currentKey]
  );

  const years = useMemo(
    () => [...new Set(breakdowns.map((row) => String(row.year)))].sort((a, b) => b.localeCompare(a)),
    [breakdowns]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <AlertOctagon size={28} className="text-red-400" aria-hidden="true" />
            Breakdown Management
          </h2>
          <p className="text-body mt-1.5">Monthly section-wise reliability summaries aligned to {machines.length} registered machines across {sections.length - 1} operating sections</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {isAdmin && (
            <>
              <button onClick={() => openUpload({ kind: 'bulk', module: 'breakdowns' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs">
                <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
              </button>
              <button onClick={() => setShowNew(true)} className="btn-danger inline-flex items-center gap-2 whitespace-nowrap">
                <Plus size={15} aria-hidden="true" /> Log Monthly Summary
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { icon: Wrench, label: 'Sections Logged', value: currentSummary.sections, cls: 'text-amber-400' },
          { icon: AlertOctagon, label: 'Breakdowns', value: currentSummary.breakdownCount, cls: 'text-red-400' },
          { icon: Timer, label: 'Downtime', value: `${currentSummary.downtimeHours}h`, cls: 'text-orange-400' },
          { icon: TimerReset, label: 'MTTR', value: `${currentSummary.mttr}h`, cls: 'text-cyan-400' },
          { icon: Gauge, label: 'Availability', value: `${availability}%`, cls: 'text-emerald-400' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="glass-card p-4 flex items-center gap-3">
              <Icon size={18} className={item.cls} aria-hidden="true" />
              <div>
                <p className="text-white text-base font-bold leading-tight">{item.value}</p>
                <p className="text-slate-500 text-[10px]">{item.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <ChartCard title="Monthly Breakdown Trend" subtitle="Breakdown count and downtime trend" empty={!breakdowns.length}>
          <DualTrendChart data={trend} />
        </ChartCard>
        <ChartCard title="MTTR Trend" subtitle="Mean time to repair by month" empty={!breakdowns.length}>
          <TrendChart data={trend} dataKey="mttr" color="#8B5CF6" unit=" hrs" />
        </ChartCard>
        <ChartCard title="MTBF Trend" subtitle="Mean time between failures by month" empty={!breakdowns.length}>
          <TrendChart data={trend} dataKey="mtbf" color="#06B6D4" unit=" hrs" />
        </ChartCard>
      </section>

      <div className="glass-card p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input type="search" className="input-field pl-9" placeholder="Search section, period, remarks..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search breakdown summaries" />
        </div>
        <select className="select-field" value={sectionF} onChange={(event) => setSectionF(event.target.value)} aria-label="Filter by section">
          <option value="">All Plant Sections</option>
          {sections.map((section) => <option key={section} value={section}>{section}</option>)}
        </select>
        <select className="select-field" value={yearF} onChange={(event) => setYearF(event.target.value)} aria-label="Filter by year">
          <option value="">All Years</option>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No breakdown summaries logged"
          description={breakdowns.length ? 'No monthly summary matches the current filters.' : 'Log the first monthly section summary to unlock trend analytics for downtime, MTTR, MTBF, and failure counts.'}
          actionLabel={isAdmin && !breakdowns.length ? '+ Log First Summary' : undefined}
          onAction={isAdmin ? () => setShowNew(true) : undefined}
        />
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="enterprise-table w-full min-w-[860px]">
            <thead>
              <tr>
                <th>Period</th><th>Plant Section</th><th>Breakdowns</th><th>Downtime</th>
                <th>MTTR</th><th>MTBF</th><th>Operating Hours</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="text-slate-300 whitespace-nowrap">{formatPeriodKey(row.period, true)}</td>
                  <td className="text-white font-medium">{row.section}</td>
                  <td className="text-slate-300">{row.breakdownCount}</td>
                  <td className="text-slate-300">{row.downtimeHours} hrs</td>
                  <td className="text-slate-300">{row.mttr} hrs</td>
                  <td className="text-slate-300">{row.mtbf} hrs</td>
                  <td className="text-slate-400">{row.operatingHours || 0} hrs</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setViewing(row)} className="btn-ghost !p-1.5" aria-label={`View ${row.section} ${row.period}`}><Eye size={13} aria-hidden="true" /></button>
                      {isAdmin && (
                        <>
                          <button onClick={() => setEditing(row)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label={`Edit ${row.section} ${row.period}`}>
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button onClick={() => setDeleting(row)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label={`Delete ${row.section} ${row.period}`}>
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
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

      {showNew && <SummaryModal userName={userName} sections={sections} onClose={() => setShowNew(false)} />}
      {viewing && <DetailModal row={viewing} onClose={() => setViewing(null)} />}
      {editing && isAdmin && (
        <EditBreakdownModal row={editing} userName={userName} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setDeleting(null)} role="dialog" aria-modal="true">
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
