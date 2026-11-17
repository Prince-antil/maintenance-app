import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, getPlantScopedData } from '../store.js';
import { usePlant } from '../context/PlantContext.jsx';
import { machineHealth, aggregateBreakdownRecords, summaryMonthKey, formatPeriodKey, lastNMonths, equipmentWiseBreakdown } from '../analytics.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { MachineActionsMenu, ArchiveMachineModal, PurgeMachineModal, MachineArchivedBanner } from '../components/MachineActions.jsx';
import { exportToCSV } from '../utils.js';
import { getOperationalSections } from '../constants.js';
import { normalizeRole, canUpload, canDelete, canArchiveMachine, canPurgeMachine } from '../lib/plantAccess.js';
import {
  Plus, Search, Cog, MapPin, FileText, ChevronRight, Factory,
  Download, HeartPulse, Upload, AlertOctagon, Timer, Wrench, TrendingUp,
  ClipboardCheck, X, Archive, ArchiveRestore,
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
 * Includes an Archived Machines view and per-machine Actions menu
 * (View / Edit / Archive / Purge) with role-based destructive permissions.
 */
export default function Machines() {
  const { user } = useAuth();
  const { openAddMachine, openUpload, pushToast } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const raw = useStore();
  const { currentPlant, currentPlantId } = usePlant();
  const scoped = getPlantScopedData(currentPlantId);
  const { machines, archivedMachines, breakdowns, pms, machinePmRecords } = scoped;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [section, setSection] = useState('');
  const [month, setMonth] = useState('');
  const [viewArchived, setViewArchived] = useState(Boolean(location.state?.viewArchived));
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);

  const userName = user?.full_name || 'Admin';

  const sourceMachines = viewArchived ? archivedMachines : machines;

  const sections = useMemo(
    () => getOperationalSections(sourceMachines),
    [sourceMachines]
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
    return sourceMachines
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
  }, [sourceMachines, breakdowns, pms, search, status, section]);

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
      'machine-register-'+(currentPlant?.plant_code||'NATHUPUR')+'.csv'
    );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-[11px] text-slate-500"><span>Home</span><span>/</span><span className="text-cyan-400 font-semibold">{currentPlant?.plant_name}</span><span>/</span><span className="text-white">Machines</span><span className="ml-auto badge bg-cyan-500/10 text-cyan-400 text-[10px]">CURRENT PLANT: {currentPlant?.plant_code}</span></div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <Factory size={28} className="text-cyan-400" aria-hidden="true" />
            Machine Asset Register
          </h2>
          <p className="text-body mt-1.5">
            {viewArchived
              ? `${archivedMachines.length} archived asset${archivedMachines.length === 1 ? '' : 's'} — records, history and documents are preserved and can be restored`
              : `${machines.length} assets in ${currentPlant?.plant_name} across ${sections.length} operating sections · specs, health scores, QR codes, SOPs, spares & maintenance history`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canArchiveMachine(user?.role) && (
            <button
              onClick={() => { setViewArchived((v) => !v); setSearch(''); setStatus(''); setSection(''); }}
              className={`inline-flex items-center gap-2 text-xs whitespace-nowrap ${viewArchived ? 'btn-primary' : 'btn-ghost'}`}
              title={viewArchived ? 'Show active machines' : 'View archived machines and restore them'}
              aria-pressed={viewArchived}
            >
              {viewArchived ? <ArchiveRestore size={13} aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
              {viewArchived ? 'Active Register' : `Archived (${archivedMachines.length})`}
            </button>
          )}
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {canUpload(user?.role) && !viewArchived && (
            <button onClick={() => openUpload({ kind: 'bulk', module: 'machines' })} className="btn-success inline-flex items-center gap-2 whitespace-nowrap text-xs">
              <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
            </button>
          )}
          {canDelete(user?.role) && !viewArchived && (
            <button onClick={openAddMachine} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
              <Plus size={15} aria-hidden="true" /> New Machine
            </button>
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

      {!viewArchived && (
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
      )}

      {/* Machine grid */}
      {rows.length === 0 ? (
        <EmptyState
          title={viewArchived ? 'No archived machines' : 'No machines found'}
          description={viewArchived
            ? 'Archived machines appear here with all their records preserved. Use the Actions menu on any machine to archive it.'
            : search || status || section ? 'No machine matches the current filters.' : 'Create the first machine profile to start building the asset register.'}
          actionLabel={user?.role === 'admin' && !search && !viewArchived ? '+ Add Machine' : undefined}
          onAction={user?.role === 'admin' && !viewArchived ? openAddMachine : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {rows.map((m) => {
            const docCount = (m.docs || []).length;
            const canManage = canArchiveMachine(user?.role);
            return (
              <div key={m.id} className={`glass-card p-5 group relative ${m.archived ? 'border-amber-500/30 bg-amber-500/[0.03]' : 'glass-card-hover'}`}>
                <button
                  onClick={() => navigate(`/machines/${m.id}`)}
                  className="w-full text-left"
                  aria-label={`Open machine profile: ${m.name}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-11 h-11 rounded-control flex items-center justify-center ${m.archived ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
                      {m.archived ? <Archive size={20} className="text-amber-400" aria-hidden="true" /> : <Cog size={20} className="text-cyan-400" aria-hidden="true" />}
                    </div>
                    <ChevronRight size={15} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all mt-1" aria-hidden="true" />
                  </div>
                  <h3 className="text-card-title leading-tight mb-1">{m.name}</h3>
                  {m.machineCode && <p className="text-cyan-400/80 text-[11px] font-mono mb-1">{m.machineCode}</p>}
                  <p className="text-slate-400 text-xs flex items-center gap-1.5 mb-3">
                    <MapPin size={11} aria-hidden="true" /> {m.section}
                  </p>
                  {!viewArchived && (
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
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {m.archived ? (
                      <span className="badge bg-amber-500/15 text-amber-300">Archived{m.archivedBy ? ` · ${m.archivedBy}` : ''}</span>
                    ) : (
                      <StatusBadge status={m.status} pulse={m.status === 'breakdown'} />
                    )}
                    <span className="badge bg-slate-700/60 text-slate-300">
                      <FileText size={10} aria-hidden="true" /> {docCount} docs
                    </span>
                  </div>
                </button>
                {canManage && (
                  <div className="absolute top-4 right-4 z-10">
                    <MachineActionsMenu
                      machine={m}
                      user={user}
                      compact
                      onView={() => navigate(`/machines/${m.id}`)}
                      onEdit={() => navigate(`/machines/${m.id}`, { state: { autoEdit: true } })}
                      onArchive={() => setArchiveTarget(m)}
                      onPurge={() => setPurgeTarget(m)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Archive / Restore confirmation */}
      {archiveTarget && (
        <ArchiveMachineModal
          machine={archiveTarget}
          userName={userName}
          onClose={() => setArchiveTarget(null)}
          onDone={(updated, action) => pushToast({
            type: 'success',
            title: action === 'restored' ? 'Machine restored' : 'Machine archived',
            message: updated?.name
              ? `${updated.name} ${action === 'restored' ? 'is back in the active register' : 'was moved to the archived view'}. All records preserved.`
              : undefined,
          })}
        />
      )}

      {/* Permanent purge confirmation */}
      {purgeTarget && (
        <PurgeMachineModal
          machine={purgeTarget}
          userName={userName}
          plantId={currentPlantId}
          onClose={() => setPurgeTarget(null)}
          onPurged={(res) => pushToast({
            type: 'success',
            title: 'Machine permanently purged',
            message: `${res.machine?.name} (${res.machine?.machineCode}) deleted with ${res.counts?.pm_records || 0} PM · ${res.counts?.breakdown_logs || 0} breakdown · ${res.counts?.amc_records || 0} AMC · ${res.counts?.testing_certificates || 0} certificate records.`,
          })}
        />
      )}
    </div>
  );
}
