import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addPM, deletePM } from '../store.js';
import { aggregatePMRecords, formatPeriodKey, monthlyPMCompletion, pmStats } from '../analytics.js';
import { MASTER_PLANT_SECTION, getOperationalSections } from '../constants.js';
import EmptyState from '../components/EmptyState.jsx';
import { ChartCard, PMCompletionChart, TrendChart } from '../components/AnalyticsCharts.jsx';
import { ProgressGauge } from '../components/charts.jsx';
import { exportToCSV } from '../utils.js';
import {
  AlertCircle, CalendarX2, CheckCircle2, ClipboardCheck, Download, Eye,
  ListChecks, Percent, Plus, Search, Trash2, Upload, X,
} from 'lucide-react';

const currentPeriod = () => new Date().toISOString().slice(0, 7);

function SummaryModal({ userName, onClose, sections }) {
  const [form, setForm] = useState({
    period: currentPeriod(),
    section: '',
    plannedCount: '',
    doneCount: '',
    pendingCount: '',
    compliancePct: '',
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
    addPM(form, userName);
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
            <select id="pm-section" className="select-field" value={form.section} onChange={set('section')}>
              <option value="">Select section...</option>
              {sections.map((section) => <option key={section} value={section}>{section}</option>)}
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
  const [deleting, setDeleting] = useState(null);

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const currentKey = currentPeriod();
  const sections = useMemo(
    () => [MASTER_PLANT_SECTION, ...getOperationalSections(machines)],
    [machines]
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
          title="No PM summaries logged"
          description={pms.length ? 'No monthly summary matches the current filters.' : 'Log the first monthly PM summary to unlock compliance bars, gauges, and section-wise PM tracking.'}
          actionLabel={isAdmin && !pms.length ? '+ Log First Summary' : undefined}
          onAction={isAdmin ? () => setShowNew(true) : undefined}
        />
      ) : (
        <div className="glass-card overflow-x-auto">
          <table className="enterprise-table w-full min-w-[860px]">
            <thead>
              <tr>
                <th>Period</th><th>Plant Section</th><th>Planned</th><th>Done</th>
                <th>Pending</th><th>Compliance</th><th>Remarks</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="text-slate-300 whitespace-nowrap">{formatPeriodKey(row.period, true)}</td>
                  <td className="text-white font-medium">{row.section}</td>
                  <td className="text-slate-300">{row.plannedCount}</td>
                  <td className="text-slate-300">{row.doneCount}</td>
                  <td className="text-slate-300">{row.pendingCount}</td>
                  <td className="text-slate-300">{row.compliancePct}%</td>
                  <td className="text-slate-400 max-w-[220px] truncate" title={row.remarks || ''}>{row.remarks || '—'}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setViewing(row)} className="btn-ghost !p-1.5" aria-label={`View ${row.section} ${row.period}`}><Eye size={13} aria-hidden="true" /></button>
                      {isAdmin && (
                        <button onClick={() => setDeleting(row)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label={`Delete ${row.section} ${row.period}`}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
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
