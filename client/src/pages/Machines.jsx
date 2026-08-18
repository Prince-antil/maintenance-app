import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, deleteMachine } from '../store.js';
import { machineHealth, aggregateBreakdownRecords, summaryMonthKey, formatPeriodKey, lastNMonths, equipmentWiseBreakdown } from '../analytics.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import { getOperationalSections } from '../constants.js';
import {
  Plus, Search, Cog, MapPin, FileText, ChevronRight, Trash2, Factory,
  Download, HeartPulse, Upload, AlertOctagon, Timer, Wrench, TrendingUp,
  ClipboardCheck, X,
} from 'lucide-react';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'running', label: 'Running' },
  { value: 'maintenance', label: 'Under Maintenance' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'standby', label: 'Standby' },
];

const healthColor = (h) => (h >= 75 ? 'bg-emerald-400' : h >= 50 ? 'bg-amber-400' : 'bg-red-400');
const healthText = (h) => (h >= 75 ? 'text-emerald-400' : h >= 50 ? 'text-amber-400' : 'text-red-400');

/**
 * Machine asset register — searchable, filterable, health-scored fleet directory.
 */
export default function Machines() {
  const { user } = useAuth();
  const { openAddMachine, openUpload } = useUI();
  const navigate = useNavigate();
  const { machines, breakdowns, pms, machinePmRecords } = useStore();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [section, setSection] = useState('');
  const [month, setMonth] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const sections = useMemo(
    () => getOperationalSections(machines),
    [machines]
  );

  // Build month option list from all breakdown + PM periods
  const monthOptions = useMemo(() => {
    const keys = [
      ...breakdowns.map((r) => summaryMonthKey(r)),
      ...pms.map((r) => summaryMonthKey(r)),
    ];
    return [...new Set(keys)].filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [breakdowns, pms]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return machines
      .map((m) => ({ ...m, health: machineHealth(m, breakdowns, pms) }))
      .filter((m) =>
        (!q ||
          m.name.toLowerCase().includes(q) ||
          m.section.toLowerCase().includes(q) ||
          (m.machineCode || '').toLowerCase().includes(q) ||
          (m.department || '').toLowerCase().includes(q)) &&
        (!status || m.status === status) &&
        (!section || m.section === section)
      );
  }, [machines, breakdowns, pms, search, status, section]);

  // Plant-wise metrics filtered by section + month
  const filteredMetrics = useMemo(() => {
    const bdFiltered = breakdowns.filter((r) =>
      (!section || r.section === section) &&
      (!month || summaryMonthKey(r) === month)
    );
    const bdSummary = aggregateBreakdownRecords(bdFiltered);

    const pmFiltered = machinePmRecords.filter((r) => {
      const recMonth = (r.pmDate || '').slice(0, 7);
      return (!section || r.plantSection === section) && (!month || recMonth === month);
    });
    const pmTotal = pmFiltered.length;
    const pmCompleted = pmFiltered.filter((r) =>
      String(r.status || '').toLowerCase() === 'completed' || r.completed === true
    ).length;
    const pmCompliance = pmTotal > 0 ? Math.round((pmCompleted / pmTotal) * 1000) / 10 : 0;

    const sectionBreakdowns = equipmentWiseBreakdown(bdFiltered);

    return {
      breakdownCount: bdSummary.breakdownCount,
      downtimeHours: bdSummary.downtimeHours,
      mttr: bdSummary.mttr,
      mtbf: bdSummary.mtbf,
      pmCompliance,
      pmDone: pmCompleted,
      pmPlanned: pmTotal,
      sectionBreakdowns,
      isFiltered: !!(section || month),
    };
  }, [breakdowns, machinePmRecords, section, month]);

  const handleExport = () =>
    exportToCSV(
      rows,
      [
        { key: 'machineCode', label: 'Machine ID' },
        { key: 'name', label: 'Machine Name' },
        { key: 'section', label: 'Plant Section' },
        { key: 'department', label: 'Department' },
        { key: 'area', label: 'Area' },
        { key: 'manufacturer', label: 'Manufacturer' },
        { key: 'model', label: 'Model' },
        { key: 'serialNumber', label: 'Serial No' },
        { key: 'installDate', label: 'Installed' },
        { key: 'powerRating', label: 'Power' },
        { key: 'status', label: 'Status' },
        { key: 'runningHours', label: 'Running Hrs' },
        { key: 'health', label: 'Health %' },
        { label: 'Documents', value: (m) => (m.docs || []).length },
      ],
      'machine-register.csv'
    );

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMachine(deleteTarget.id, user?.full_name || 'Admin');
    setDeleteTarget(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <Factory size={28} className="text-cyan-400" aria-hidden="true" />
            Machine Asset Register
          </h2>
          <p className="text-body mt-1.5">
            {machines.length} assets across {sections.length} operating sections · specs, health scores, QR codes, SOPs, spares & maintenance history
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {user?.role === 'admin' && (
            <>
              <button onClick={() => openUpload({ kind: 'bulk', module: 'machines' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs">
                <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
              </button>
              <button onClick={openAddMachine} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
                <Plus size={15} aria-hidden="true" /> New Machine
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search + filters */}
      <div className="glass-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            className="input-field pl-9"
            placeholder="Search name, code, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search machines"
          />
        </div>
        <select className="select-field" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Filter by section">
          <option value="">All Plant Sections</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select-field" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="select-field" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter metrics by month">
          <option value="">All Months (Metrics)</option>
          {monthOptions.map((m) => (
            <option key={m} value={m}>{formatPeriodKey(m, true)}</option>
          ))}
        </select>
        {(section || month || status || search) && (
          <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2 flex-wrap pt-0.5">
            <span className="text-slate-500 text-xs">Active filters:</span>
            {search && (
              <button onClick={() => setSearch('')} className="inline-flex items-center gap-1 badge bg-slate-700 text-slate-200 hover:bg-slate-600">
                Search: {search} <X size={10} />
              </button>
            )}
            {section && (
              <button onClick={() => setSection('')} className="inline-flex items-center gap-1 badge bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25">
                {section} <X size={10} />
              </button>
            )}
            {status && (
              <button onClick={() => setStatus('')} className="inline-flex items-center gap-1 badge bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">
                {STATUS_OPTIONS.find((o) => o.value === status)?.label} <X size={10} />
              </button>
            )}
            {month && (
              <button onClick={() => setMonth('')} className="inline-flex items-center gap-1 badge bg-violet-500/15 text-violet-300 hover:bg-violet-500/25">
                {formatPeriodKey(month, true)} <X size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Plant-wise breakdown & PM metrics panel */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-card-title flex items-center gap-2">
            <TrendingUp size={15} className="text-cyan-400" aria-hidden="true" />
            Plant-wise Reliability Metrics
            {filteredMetrics.isFiltered && (
              <span className="badge bg-cyan-500/15 text-cyan-300 text-[10px]">
                {section || 'All sections'}{month ? ` · ${formatPeriodKey(month, true)}` : ''}
              </span>
            )}
          </h3>
          {!filteredMetrics.isFiltered && (
            <p className="text-meta text-[11px]">Use Section / Month filters above to drill down</p>
          )}
        </div>

        {/* Top KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {[
            { label: 'Breakdowns', value: filteredMetrics.breakdownCount, icon: <AlertOctagon size={12} className="text-red-400" />, color: 'text-red-300' },
            { label: 'Downtime (hrs)', value: filteredMetrics.downtimeHours, icon: <Timer size={12} className="text-amber-400" />, color: 'text-amber-300' },
            { label: 'MTTR (hrs)', value: filteredMetrics.mttr, icon: <Wrench size={12} className="text-cyan-400" />, color: 'text-cyan-300' },
            { label: 'MTBF (hrs)', value: filteredMetrics.mtbf, icon: <TrendingUp size={12} className="text-violet-400" />, color: 'text-violet-300' },
            { label: 'PM Done', value: filteredMetrics.pmDone, icon: <ClipboardCheck size={12} className="text-emerald-400" />, color: 'text-emerald-300' },
            { label: 'PM Compliance', value: `${filteredMetrics.pmCompliance}%`, icon: <ClipboardCheck size={12} className="text-emerald-400" />, color: filteredMetrics.pmCompliance >= 90 ? 'text-emerald-300' : filteredMetrics.pmCompliance >= 75 ? 'text-amber-300' : 'text-red-300' },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-control bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
              <p className={`text-base font-bold flex items-center justify-center gap-1 ${kpi.color}`}>
                {kpi.icon}{kpi.value}
              </p>
              <p className="text-slate-500 text-[10px] mt-0.5">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Section-wise breakdown table — shown when there is data */}
        {filteredMetrics.sectionBreakdowns.length > 0 && (
          <div className="overflow-x-auto mt-1">
            <table className="enterprise-table w-full min-w-[480px]">
              <thead>
                <tr>
                  <th>Plant Section</th>
                  <th>Breakdowns</th>
                  <th>Downtime (hrs)</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {filteredMetrics.sectionBreakdowns.map((row) => {
                  const pct = filteredMetrics.breakdownCount
                    ? Math.round((row.count / filteredMetrics.breakdownCount) * 100)
                    : 0;
                  return (
                    <tr key={row.label}>
                      <td className="text-white font-medium">{row.label}</td>
                      <td>
                        <span className={`font-semibold ${row.count > 5 ? 'text-red-400' : row.count > 2 ? 'text-amber-400' : 'text-slate-200'}`}>
                          {row.count}
                        </span>
                      </td>
                      <td className="text-amber-300">{row.downtime}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${row.count > 5 ? 'bg-red-400' : row.count > 2 ? 'bg-amber-400' : 'bg-slate-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-slate-400 text-[11px]">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {filteredMetrics.sectionBreakdowns.length === 0 && (
          <p className="text-slate-500 text-xs py-1">No breakdown data for the selected filters.</p>
        )}
      </div>

      {/* Machine grid */}
      {rows.length === 0 ? (
        <EmptyState
          title="No machines found"
          description={search || status || section ? 'No machine matches the current filters.' : 'Create the first machine profile to start building the asset register.'}
          actionLabel={user?.role === 'admin' && !search ? '+ Add Machine' : undefined}
          onAction={user?.role === 'admin' ? openAddMachine : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {rows.map((m) => {
            const docCount = (m.docs || []).length;
            return (
              <div key={m.id} className="glass-card glass-card-hover p-5 group relative">
                <button
                  onClick={() => navigate(`/machines/${m.id}`)}
                  className="w-full text-left"
                  aria-label={`Open machine profile: ${m.name}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-11 h-11 rounded-control bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Cog size={20} className="text-cyan-400" aria-hidden="true" />
                    </div>
                    <ChevronRight size={15} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all mt-1" aria-hidden="true" />
                  </div>
                  <h3 className="text-card-title leading-tight mb-1">{m.name}</h3>
                  {m.machineCode && <p className="text-cyan-400/80 text-[11px] font-mono mb-1">{m.machineCode}</p>}
                  <p className="text-slate-400 text-xs flex items-center gap-1.5 mb-3">
                    <MapPin size={11} aria-hidden="true" /> {m.section}
                  </p>
                  {/* Health bar — auto-derived from breakdowns & PM discipline */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-500 text-[10px] uppercase tracking-wider flex items-center gap-1">
                        <HeartPulse size={10} aria-hidden="true" /> Health
                      </span>
                      <span className={`text-[11px] font-bold ${healthText(m.health)}`}>{m.health}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden" role="progressbar" aria-valuenow={m.health} aria-valuemin={0} aria-valuemax={100}>
                      <div className={`h-full rounded-full transition-all duration-500 ${healthColor(m.health)}`} style={{ width: `${m.health}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={m.status} pulse={m.status === 'breakdown'} />
                    <span className="badge bg-slate-700/60 text-slate-300">
                      <FileText size={10} aria-hidden="true" /> {docCount} docs
                    </span>
                  </div>
                </button>
                {user?.role === 'admin' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(m); }}
                    className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-400/10 transition-all"
                    aria-label={`Delete machine ${m.name}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Delete Machine</h3>
            <p className="text-body mb-5">
              Delete <span className="text-white font-medium">"{deleteTarget.name}"</span> and all its attached documents? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handleDelete} className="btn-danger text-xs inline-flex items-center gap-1.5">
                <Trash2 size={12} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
