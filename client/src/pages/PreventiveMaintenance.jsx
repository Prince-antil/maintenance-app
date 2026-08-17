import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addPM, deletePM, updatePM } from '../store.js';
import { aggregatePMRecords, formatPeriodKey, monthlyPMCompletion, pmStats } from '../analytics.js';
import { MASTER_PLANT_SECTION, getAllSections } from '../constants.js';
import SectionSelect from '../components/SectionSelect.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { ChartCard, PMCompletionChart, TrendChart } from '../components/AnalyticsCharts.jsx';
import { ProgressGauge } from '../components/charts.jsx';
import { exportToCSV } from '../utils.js';
import {
  AlertCircle, CalendarX2, CheckCircle2, ClipboardCheck, Download, Eye,
  ListChecks, Pencil, Percent, Plus, Search, Trash2, Upload, X, Clock,
} from 'lucide-react';

const currentPeriod = () => new Date().toISOString().slice(0, 7);

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

          {/* Start & End Time (Feature 3) */}
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

function DetailModal({ row, onClose }) {
  const durationHours = row.durationHours || (row.startTime && row.endTime
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
    ['Duration', durationHours != null ? `${durationHours} hrs` : '—'],
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

// ── Inline edit modal ────────────────────────────────────────────────────────
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
  const overlayRef = useRef(null);
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
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true" aria-label="Edit PM record"
    >
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
            <div>
              <label className={labelCls}>Planned PM</label>
              <input type="number" min="0" value={form.plannedCount} onChange={set('plannedCount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Done PM</label>
              <input type="number" min="0" value={form.doneCount} onChange={set('doneCount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Pending PM</label>
              <input type="number" min="0" value={form.pendingCount} onChange={set('pendingCount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>
                Compliance %
                {liveCompliance !== null && (
                  <span className="ml-2 text-cyan-400 text-[10px] font-normal">auto: {liveCompliance}%</span>
                )}
              </label>
              <input
                type="number" min="0" max="100" step="0.1"
                value={form.compliancePct}
                onChange={set('compliancePct')}
                placeholder={liveCompliance !== null ? `Auto: ${liveCompliance}` : 'Leave blank to auto-calc'}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}><Clock size={11} className="inline mr-1" />Start Time</label>
              <input type="datetime-local" value={form.startTime} onChange={set('startTime')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><Clock size={11} className="inline mr-1" />End Time</label>
              <input type="datetime-local" value={form.endTime} onChange={set('endTime')} className={inputCls} />
            </div>
          </div>
          {durationHours != null && (
            <p className="text-xs text-cyan-300 bg-cyan-500/8 border border-cyan-500/20 rounded-control px-3 py-2">
              Calculated Duration: <strong>{durationHours} hours</strong>
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

export default function PreventiveMaintenance() {
  const { user } = useAuth();
  const { openUpload } = useUI();
  const store = useStore();
  const { pms, machines } = store;
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
    () => getAllSections(store.plantSections),
    [store.plantSections]
  );
  const trend = useMemo(() => monthlyPMCompletion(pms, 12), [pms]);
  const stats = useMemo(() => pmStats(pms), [pms]);
  const currentSummary = useMemo(() => aggregatePMRecords(pms, currentKey), [pms, currentKey]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return [...pms]
      .filter((row) => (
        (!q || row.section.toLowerCase().includes(q) || formatPeriodKey(row.period, true).toLowerCase().includes(q) || (row.remarks || '').toLowerCase().includes(q)) &&
        (!sectionF || row.section === sectionF) &&
        (!yearF || String(row.year) === yearF)
      ))
      .sort((a, b) => b.period.localeCompare(a.period) || a.section.localeCompare(b.section));
  }, [pms, search, sectionF, yearF]);

  const handleExport = () => exportToCSV(
    rows,
    [
      { label: 'Reporting Period', value: (row) => formatPeriodKey(row.period, true) },
      { key: 'section', label: 'Plant Section' },
      { key: 'plannedCount', label: 'Planned PM Count' },
      { key: 'doneCount', label: 'Done PM Count' },
      { key: 'pendingCount', label: 'Pending PM Count' },
      { key: 'compliancePct', label: 'Compliance %' },
      { label: 'Start Time', value: (row) => row.startTime ? new Date(row.startTime).toLocaleString('en-GB') : '' },
      { label: 'End Time', value: (row) => row.endTime ? new Date(row.endTime).toLocaleString('en-GB') : '' },
      { key: 'durationHours', label: 'Duration (hrs)' },
      { key: 'remarks', label: 'Remarks' },
    ],
    'pm-monthly-summary.csv'
  );

  const years = useMemo(
    () => [...new Set(pms.map((row) => String(row.year)))].sort((a, b) => b.localeCompare(a)),
    [pms]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <ClipboardCheck size={28} className="text-cyan-400" aria-hidden="true" />
            Preventive Maintenance
          </h2>
          <p className="text-body mt-1.5">Monthly compliance summaries aligned to {machines.length} registered machines across {sections.length - 1} operating sections</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {isAdmin && (
            <>
              <button onClick={() => openUpload({ kind: 'bulk', module: 'pm' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs">
                <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
              </button>
              <button onClick={() => setShowNew(true)} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
                <Plus size={15} aria-hidden="true" /> Log Monthly Summary
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { icon: ListChecks, label: 'Sections Logged', value: currentSummary.sections, cls: 'text-cyan-400' },
          { icon: ListChecks, label: 'Planned PM', value: currentSummary.plannedCount, cls: 'text-cyan-400' },
          { icon: CheckCircle2, label: 'Done PM', value: currentSummary.doneCount, cls: 'text-emerald-400' },
          { icon: CalendarX2, label: 'Pending PM', value: currentSummary.pendingCount, cls: 'text-red-400' },
          { icon: Percent, label: 'Compliance', value: `${currentSummary.compliance}%`, cls: 'text-emerald-400' },
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
        <ChartCard title="Monthly PM Completion" subtitle="Completed vs pending PM counts" empty={!pms.length}>
          <PMCompletionChart data={trend} />
        </ChartCard>
        <ChartCard title="Compliance Trend" subtitle="Section-wide PM compliance by month" empty={!pms.length}>
          <TrendChart data={trend} dataKey="compliance" color="#10B981" unit="%" yDomain={[0, 100]} />
        </ChartCard>
        <ChartCard title="Current PM Compliance" subtitle={`${stats.currentMonth.plannedCount} planned activities this month`} empty={!pms.length} raw>
          <div className="flex h-full items-center justify-center">
            <ProgressGauge value={currentSummary.compliance} label="PM Compliance" />
          </div>
        </ChartCard>
      </section>

      <div className="glass-card p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input type="search" className="input-field pl-9" placeholder="Search section, period, remarks..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search PM summaries" />
        </div>
        <SectionSelect value={sectionF} onChange={setSectionF} id="pm-filter-section" ariaLabel="Filter by section" />
        <select className="select-field" value={yearF} onChange={(event) => setYearF(event.target.value)} aria-label="Filter by year">
          <option value="">All Years</option>
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No PM summaries logged"
          description={pms.length ? 'No monthly summary matches the current filters.' : 'Log the first monthly PM summary to unlock compliance bars, gauges, and section-wise PM tracking.'}
          actionLabel={isAdmin && !pms.length ? '+ Log First Summary' : undefined}
          onAction={isAdmin ? () => setShowNew(true) : undefined}
        />
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="enterprise-table w-full min-w-[1000px]">
            <thead>
              <tr>
                <th>Period</th><th>Plant Section</th><th>Planned</th><th>Done</th>
                <th>Pending</th><th>Compliance</th><th>Start Time</th><th>End Time</th>
                <th>Duration</th><th>Remarks</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
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
                    <td className="text-slate-300 text-[11px] whitespace-nowrap">{row.startTime ? new Date(row.startTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="text-slate-300 text-[11px] whitespace-nowrap">{row.endTime ? new Date(row.endTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="text-cyan-300 text-xs font-semibold">{dur != null ? `${dur}h` : '—'}</td>
                    <td className="text-slate-400 max-w-[160px] truncate" title={row.remarks || ''}>{row.remarks || '—'}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <SummaryModal userName={userName} sections={sections} machines={machines} onClose={() => setShowNew(false)} />}
      {viewing && <DetailModal row={viewing} onClose={() => setViewing(null)} />}
      {editing && isAdmin && (
        <EditPMModal row={editing} userName={userName} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setDeleting(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Delete PM Summary</h3>
            <p className="text-body mb-5">Delete the summary for <span className="text-white font-medium">{deleting.section}</span> in <span className="text-white font-medium">{formatPeriodKey(deleting.period, true)}</span>?</p>
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
