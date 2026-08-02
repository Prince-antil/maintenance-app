import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { api } from '../api.js';
import KPIStatCard from '../components/KPIStatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {
  ChartCard, TrendChart, DualTrendChart, GroupedBarChart, HorizontalBarChart,
  ParetoChart, PieDonutChart,
} from '../components/AnalyticsCharts.jsx';
import { useStore } from '../store.js';
import {
  computeKPIs, monthlyBreakdownTrend, equipmentWiseBreakdown,
  paretoTop10, breakdownByDepartment, monthlyEnergy, healthDistribution,
  availabilityTrend, mttrTrend, mtbfTrend, buildInsights, machineStatusDistribution, monthlyEnergyOverview,
} from '../analytics.js';
import { CATEGORY_META, EXT_META } from '../constants.js';
import { timeAgo, greeting, formatDateLong } from '../utils.js';
import {
  Factory, Activity, Wrench, AlertOctagon, ClipboardCheck, ClipboardList,
  FolderArchive, Timer, TimerReset, Gauge, ListChecks, Clock, ChevronRight,
  FileText, User, Zap, BrainCircuit, AlertTriangle, Info, CalendarDays,
  Sparkles, ArrowRight, Upload,
} from 'lucide-react';
import { ProgressGauge } from '../components/charts.jsx';

const MODULE_GROUPS = [
  { label: 'Module A · Preventive & Corrective Maintenance', cats: ['Monthly PM Report', 'Plantwise Breakdown Report', 'Machine Asset Register', 'FAT (Factory Acceptance Test)'] },
  { label: 'Module B · Utilities & Energy Management', cats: ['Energy Report (DG 500 & 380KVA)', 'Energy Report (Solar)', 'Plantwise Energy Consumption'] },
  { label: 'Module C · Continuous Improvement & Compliance', cats: ['Kaizen', 'Improvement', 'ORM Data (Operational Risk Management)'] },
];

const SEVERITY_META = {
  high: { icon: AlertTriangle, cls: 'text-red-400 bg-red-400/10 border-red-400/25' },
  medium: { icon: AlertTriangle, cls: 'text-amber-400 bg-amber-400/10 border-amber-400/25' },
  info: { icon: Info, cls: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/25' },
};

const ACTIVITY_COLORS = {
  breakdown: 'from-red-400/80 to-rose-500/80',
  pm: 'from-cyan-400/80 to-blue-500/80',
  machine: 'from-violet-400/80 to-purple-500/80',
  energy: 'from-amber-400/80 to-yellow-500/80',
  upload: 'from-emerald-400/80 to-cyan-400/80',
  info: 'from-slate-400/80 to-slate-500/80',
};

function useClock() {
  const [nowD, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return nowD;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { refreshKey, openUpload } = useUI();
  const navigate = useNavigate();
  const store = useStore();
  const clock = useClock();
  const [categories, setCategories] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [cats, rec] = await Promise.all([api.getCategories(), api.getRecent()]);
        setCategories(cats);
        setRecent(rec);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshKey]);

  const catMap = Object.fromEntries(categories.map((c) => [c.category_name, c]));
  const totalFiles = categories.reduce((sum, c) => sum + c.file_count, 0);

  // ---- everything below auto-recomputes when store data changes ----
  const kpi = useMemo(() => computeKPIs(store, totalFiles), [store, totalFiles]);
  const charts = useMemo(() => ({
    bdTrend: monthlyBreakdownTrend(store.breakdowns),
    equipment: equipmentWiseBreakdown(store.breakdowns).slice(0, 8),
    pareto: paretoTop10(store.breakdowns),
    dept: breakdownByDepartment(store.breakdowns),
    energy: monthlyEnergy(store.energy),
    energyOverview: monthlyEnergyOverview(store.energy),
    health: healthDistribution(store.machines, store.breakdowns, store.pms),
    machineStatus: machineStatusDistribution(store.machines),
    avail: availabilityTrend(store.breakdowns, store.machines.length),
    mttr: mttrTrend(store.breakdowns),
    mtbf: mtbfTrend(store.breakdowns, store.machines.length),
  }), [store]);
  const insights = useMemo(() => buildInsights(store), [store]);

  // Merge local activity feed with server upload history
  const feed = useMemo(() => {
    const local = store.activity.map((a) => ({
      id: a.id, user: a.user, text: `${a.action} ${a.detail ? '· ' + a.detail : ''}`,
      type: a.type, ts: a.ts,
    }));
    const uploads = recent.map((r) => ({
      id: `srv-${r.id}`, user: r.uploader_name || 'System',
      text: `uploaded ${r.filename} · ${r.category_name}`,
      type: 'upload', ts: r.uploaded_at, ext: r.file_format,
    }));
    return [...local, ...uploads]
      .sort((a, b) => new Date(b.ts?.endsWith?.('Z') ? b.ts : b.ts + 'Z') - new Date(a.ts?.endsWith?.('Z') ? a.ts : a.ts + 'Z'))
      .slice(0, 12);
  }, [store.activity, recent]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6" role="status" aria-label="Loading dashboard">
        <div className="glass-card h-32 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="glass-card h-32 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass-card h-64 animate-pulse" />)}
        </div>
      </div>
    );
  }

  const noBDs = store.breakdowns.length === 0;
  const noPMs = store.pms.length === 0;
  const noEnergy = store.energy.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Welcome banner with live date/time + plant identity */}
      <section className="glass-card p-6 lg:p-7 relative overflow-hidden" aria-label="Welcome banner">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-cyan-500/8 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute -bottom-24 left-1/3 w-64 h-64 bg-emerald-500/6 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h2 className="text-page-title">
              {greeting()}, {user?.full_name || 'Engineer'} 👋
            </h2>
            <p className="text-body mt-1.5">
              {user ? 'Maintenance Engineer' : 'Viewer'} — {store.settings.plantName} · Crystal Crop Protection Ltd.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 mt-4">
              <StatusBadge
                status={kpi.breakdown > 0 ? 'breakdown' : 'running'}
                label={kpi.breakdown > 0 ? `${kpi.breakdown} Breakdown${kpi.breakdown > 1 ? 's' : ''} Logged This Month` : 'No Breakdown Logged This Month'}
                pulse
              />
              <span className="status-pill bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
                {kpi.machineCount} Machines Monitored
              </span>
            </div>
          </div>
          <div className="text-left md:text-right flex-shrink-0">
            <p className="text-white text-2xl font-bold tabular-nums tracking-tight" aria-label="Current time">
              {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-slate-400 text-sm mt-0.5 flex items-center md:justify-end gap-1.5">
              <CalendarDays size={13} aria-hidden="true" />
              {formatDateLong(clock)}
            </p>
            <p className="text-slate-500 text-[11px] mt-1">Logged in as {user?.username || 'guest'}</p>
            {user?.role === 'admin' && (
              <button onClick={() => openUpload({ kind: 'bulk' })} className="btn-success mt-4 inline-flex items-center gap-2 text-xs">
                <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 13 live KPI cards — all values computed from stored data */}
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 lg:gap-5">
          <KPIStatCard icon={Factory} label="Total Machines" value={kpi.machineCount} sub="Asset register" tone="accent" />
          <KPIStatCard icon={Activity} label="Running Machines" value={kpi.running} sub="Healthy & producing" tone="success" />
          <KPIStatCard icon={Wrench} label="Under Maintenance" value={kpi.underMaintenance} sub="Planned jobs" tone="warning" />
          <KPIStatCard icon={AlertOctagon} label="Breakdowns This Month" value={kpi.breakdown} sub={`${kpi.breakdownSectionLogs} section summaries`} tone={kpi.breakdown ? 'danger' : 'neutral'} pulse={kpi.breakdown > 0} />
          <KPIStatCard icon={ClipboardList} label="PM Planned" value={kpi.pmDue} sub={`${kpi.pmPending} pending`} tone={kpi.pmPending ? 'warning' : 'accent'} />
          <KPIStatCard icon={ClipboardCheck} label="PM Done" value={kpi.pmCompleted} sub={`Compliance ${kpi.pmCompliance}%`} tone="success" />
          <KPIStatCard icon={Gauge} label="Availability" value={`${kpi.availability}%`} sub="This month" tone={kpi.availability >= 95 ? 'success' : kpi.availability >= 85 ? 'warning' : 'danger'} />
          <KPIStatCard icon={TimerReset} label="Avg MTTR" value={`${kpi.mttr} hrs`} sub="Mean time to repair" tone="accent" />
          <KPIStatCard icon={Timer} label="Avg MTBF" value={`${kpi.mtbf} hrs`} sub="Mean time between failures" tone="accent" />
          <KPIStatCard icon={FolderArchive} label="Total Documents" value={kpi.totalDocuments} sub="Reports + machine docs" tone="accent" />
          <KPIStatCard icon={Zap} label="Energy Today" value={`${kpi.energyToday}`} sub="kWh logged today" tone="warning" />
          <KPIStatCard icon={ListChecks} label="Pending PM" value={kpi.openWorkOrders} sub={`${kpi.pmSectionLogs} PM section summaries`} tone={kpi.openWorkOrders ? 'warning' : 'neutral'} />
        </div>
      </section>

      {/* AI reliability insights */}
      <section aria-label="AI analytics">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-control bg-violet-400/10 border border-violet-400/25 flex items-center justify-center">
              <BrainCircuit size={17} className="text-violet-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-card-title flex items-center gap-1.5">
                AI Reliability Insights <Sparkles size={13} className="text-violet-400" aria-hidden="true" />
              </h3>
              <p className="text-meta">Auto-generated from monthly breakdown summaries, PM compliance logs, and machine status</p>
            </div>
          </div>
          {insights.length === 0 ? (
            <p className="text-body py-2">Add machine records and monthly breakdown / PM summaries to generate reliability recommendations automatically.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((ins) => {
                const meta = SEVERITY_META[ins.severity] || SEVERITY_META.info;
                const Icon = meta.icon;
                return (
                  <div key={ins.id} className={`rounded-control border p-3.5 flex gap-3 ${meta.cls.replace(/text-\S+/, '')} bg-white/[0.02] border-white/[0.06]`}>
                    <div className={`w-8 h-8 rounded-control border flex items-center justify-center flex-shrink-0 ${meta.cls}`}>
                      <Icon size={15} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-[13px] font-semibold">{ins.title}</p>
                      <p className="text-slate-400 text-xs leading-relaxed mt-0.5">{ins.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 10 interactive analytics charts */}
      <section aria-label="Analytics charts" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Monthly Breakdown Trend" subtitle="Breakdown count and downtime hours" empty={noBDs}>
          <DualTrendChart data={charts.bdTrend} />
        </ChartCard>
        <ChartCard title="Machine Running Status" subtitle="Running vs maintenance vs breakdown" empty={!store.machines.length}>
          <PieDonutChart data={charts.machineStatus} donut centerLabel={kpi.machineCount} centerSub="Machines" />
        </ChartCard>
        <ChartCard title="Monthly PM Completion Rate" subtitle="Current month completion gauge from aggregate PM logs" empty={noPMs} height={280} raw>
          <div className="flex h-full items-center justify-center">
            <ProgressGauge value={kpi.pmCompliance} label="PM Compliance" />
          </div>
        </ChartCard>
        <ChartCard title="Energy Consumption Overview" subtitle="Fuel litres, solar kWh and DG run hours" empty={noEnergy}>
          <GroupedBarChart
            data={charts.energyOverview}
            bars={[
              { dataKey: 'fuelLitres', name: 'Fuel (L)', color: '#F59E0B' },
              { dataKey: 'solarKwh', name: 'Solar (kWh)', color: '#10B981' },
              { dataKey: 'dgRunHours', name: 'DG Run Hrs', color: '#06B6D4' },
            ]}
          />
        </ChartCard>
        <ChartCard title="Section-wise Breakdowns" subtitle="Failure count per plant section" empty={noBDs}>
          <HorizontalBarChart data={charts.equipment} color="#06B6D4" />
        </ChartCard>
        <ChartCard title="Top 10 Breakdown Sections" subtitle="Pareto — section-wise failure concentration" empty={noBDs} height={280}>
          <ParetoChart data={charts.pareto} />
        </ChartCard>
        <ChartCard title="Breakdown by Section" subtitle="Failure distribution across plant" empty={noBDs}>
          <PieDonutChart data={charts.dept} />
        </ChartCard>
        <ChartCard title="Monthly Energy Consumption" subtitle="Total live kWh trend" empty={noEnergy}>
          <TrendChart data={charts.energy} dataKey="kwh" color="#F59E0B" unit=" kWh" />
        </ChartCard>
        <ChartCard title="Machine Health Distribution" subtitle="Fleet condition derived from failures & PM" empty={!store.machines.length}>
          <PieDonutChart data={charts.health} donut centerLabel={kpi.machineCount} centerSub="Machines" />
        </ChartCard>
        <ChartCard title="Availability Trend" subtitle="Plant availability % · last 6 months" empty={noBDs}>
          <TrendChart data={charts.avail} color="#10B981" unit="%" yDomain={[0, 100]} />
        </ChartCard>
        <ChartCard title="MTTR Trend" subtitle="Mean time to repair (hrs)" empty={noBDs}>
          <TrendChart data={charts.mttr} color="#8B5CF6" unit=" hrs" />
        </ChartCard>
        <ChartCard title="MTBF Trend" subtitle="Mean time between failures (hrs)" empty={noBDs}>
          <TrendChart data={charts.mtbf} color="#06B6D4" unit=" hrs" />
        </ChartCard>
      </section>

      {/* Document modules */}
      <section aria-label="Report modules">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-section-heading">Report & Document Modules</h3>
          <button onClick={() => navigate('/reports')} className="btn-ghost text-xs flex items-center gap-1.5">
            Analytics Reports <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
        {MODULE_GROUPS.map((group) => (
          <div key={group.label} className="mb-6">
            <h4 className="text-meta uppercase tracking-wider mb-3 px-1">{group.label}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
              {group.cats.map((name) => {
                const cat = catMap[name] || { file_count: 0, last_uploaded: null };
                const meta = CATEGORY_META[name] || { icon: FileText, color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20' };
                const Icon = meta.icon;
                return (
                  <button
                    key={name}
                    onClick={() => navigate(`/category/${encodeURIComponent(name)}`)}
                    className="glass-card glass-card-hover p-5 text-left cursor-pointer group"
                    aria-label={`Open ${name} (${cat.file_count} files)`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-10 h-10 rounded-control ${meta.bg} ${meta.border} border flex items-center justify-center`}>
                        <Icon size={18} className={meta.color} aria-hidden="true" />
                      </div>
                      <ChevronRight size={15} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                    </div>
                    <h5 className="text-white text-sm font-semibold leading-tight mb-2.5 line-clamp-2">{name}</h5>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="badge bg-slate-700/60 text-slate-300">{cat.file_count} files</span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} aria-hidden="true" />
                        {cat.last_uploaded ? timeAgo(cat.last_uploaded) : 'No uploads'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* Recent activity — merged store events + server uploads */}
      <section aria-label="Recent activity">
        <h3 className="text-section-heading mb-4">Recent Activity</h3>
        <div className="glass-card overflow-hidden">
          {feed.length === 0 ? (
            <div className="p-10 text-center">
              <FileText size={28} className="text-slate-600 mx-auto mb-3" aria-hidden="true" />
              <p className="text-body">No activity yet. Uploads, breakdowns, PM completions and machine changes will appear here.</p>
            </div>
          ) : (
            <ol className="divide-y divide-white/[0.04]">
              {feed.map((f) => {
                const extMeta = f.ext ? EXT_META[f.ext] : null;
                return (
                  <li key={f.id} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
                    <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${ACTIVITY_COLORS[f.type] || ACTIVITY_COLORS.info} flex items-center justify-center flex-shrink-0`} aria-hidden="true">
                      <User size={14} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-200 text-[13px] leading-snug">
                        <span className="text-white font-semibold">{f.user}</span>{' '}
                        <span className="text-slate-300">{f.text}</span>
                      </p>
                    </div>
                    {extMeta && <span className={`badge ${extMeta.badge} hidden sm:inline-flex`}>{extMeta.label}</span>}
                    <span className="text-slate-500 text-[11px] whitespace-nowrap flex-shrink-0">{timeAgo(f.ts)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
