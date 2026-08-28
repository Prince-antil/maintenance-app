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
  paretoTop10, breakdownByDepartment, healthDistribution,
  availabilityTrend, mttrTrend, mtbfTrend, buildInsights, machineStatusDistribution,
  machineWiseBreakdown, failureCausePareto, machineBreakdownRegister, currentlyUnderBreakdown, buildAMCNotifications,
  lastNMonths, monthKey, monthlyPMCompletion, monthlyPMCompletionFromRecords,
  computePfTrend, computeDgFuelEfficiency, computeDailyDeltas,
  formatPowerFactor, computeWeightedPf,
} from '../analytics.js';
import { computeEnergySnapshot } from '../lib/energyEngine.js';
import { CATEGORY_META, EXT_META } from '../constants.js';
import { timeAgo, greeting, formatDateLong } from '../utils.js';
import Factory from 'lucide-react/dist/esm/icons/factory';
import Activity from 'lucide-react/dist/esm/icons/activity';
import Wrench from 'lucide-react/dist/esm/icons/wrench';
import AlertOctagon from 'lucide-react/dist/esm/icons/alert-octagon';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import FolderArchive from 'lucide-react/dist/esm/icons/folder-archive';
import Timer from 'lucide-react/dist/esm/icons/timer';
import TimerReset from 'lucide-react/dist/esm/icons/timer-reset';
import Gauge from 'lucide-react/dist/esm/icons/gauge';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks';
import Clock from 'lucide-react/dist/esm/icons/clock';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import User from 'lucide-react/dist/esm/icons/user';
import Zap from 'lucide-react/dist/esm/icons/zap';
import BrainCircuit from 'lucide-react/dist/esm/icons/brain-circuit';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Info from 'lucide-react/dist/esm/icons/info';
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Upload from 'lucide-react/dist/esm/icons/upload';
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Filter from 'lucide-react/dist/esm/icons/filter';
import { ProgressGauge } from '../components/charts.jsx';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend,
} from 'recharts';

// New Dashboard components
import { SolarPerformanceCard } from '../components/dashboard/SolarPerformanceCard.jsx';
import { RenewableEnergyCard } from '../components/dashboard/RenewableEnergyCard.jsx';
import { EnergySnapshotCard } from '../components/dashboard/EnergySnapshotCard.jsx';
import { computeDashboardMetrics } from '../components/dashboard/DashboardAnalyticsEngine.js';

const MODULE_GROUPS = [
  { label: 'Module A ┬À Preventive & Corrective Maintenance', cats: ['Monthly PM Report', 'Plantwise Breakdown Report', 'Machine Asset Register', 'FAT (Factory Acceptance Test)'] },
  { label: 'Module B ┬À Utilities & Energy Management', cats: ['Energy Report (DG 500 & 380KVA)', 'Energy Report (Solar)', 'Plantwise Energy Consumption'] },
  { label: 'Module C ┬À Continuous Improvement & Compliance', cats: ['Kaizen', 'Improvement', 'ORM Data (Operational Risk Management)'] },
];

const SEVERITY_META = {
  high: { icon: AlertTriangle, cls: 'text-red-400 bg-red-400/10 border-red-400/25' },
  medium: { icon: AlertTriangle, cls: 'text-amber-400 bg-amber-400/10 border-amber-400/25' },
  info: { icon: Info, cls: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/25' },
};

const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

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
  const { refreshKey, openUpload, openMasterImport } = useUI();
  const navigate = useNavigate();
  const store = useStore();
  const { machines, breakdowns, pms, machinePmRecords, dailyUtilityLog, dailySolarGeneration, monthlyHerbicide, monthlyInsecticide, monthlyWater, monthlyAirCompressor, energySettings } = store;
  const clock = useClock();
  const [categories, setCategories] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periodFilter, setPeriodFilter] = useState('all');
  // HYDRATION & FALLBACK STATE: ensure Dashboard uses same data context as EnergyManagement (store) with localStorage/supabase fallback
  const [hydratedUtility, setHydratedUtility] = useState([]);
  const [hydratedSolar, setHydratedSolar] = useState([]);
  const [energyLoading, setEnergyLoading] = useState(false);

  useEffect(() => {
    // If store already has data, keep hydrated in sync and skip fetch
    if (dailyUtilityLog.length > 0 || dailySolarGeneration.length > 0) {
      setHydratedUtility(dailyUtilityLog);
      setHydratedSolar(dailySolarGeneration);
      return;
    }
    const fetchEnergyData = async () => {
      try {
        setEnergyLoading(true);
        // 1. Fetch Utility Log Data (Fallback to LocalStorage if offline/cached)
        let utilityData = [];
        try {
          const cachedUtility = localStorage.getItem('daily_utility_log') || localStorage.getItem('CCPL_DAILY_UTILITY_LOG_V1') || localStorage.getItem('energy_utility_data');
          if (cachedUtility) {
            const parsed = JSON.parse(cachedUtility);
            if (Array.isArray(parsed) && parsed.length > 0) utilityData = parsed;
          }
        } catch {}
        if (typeof window !== 'undefined' && window.supabase) {
          try {
            const { data: uData } = await window.supabase.from('daily_utility_log').select('*');
            if (uData && uData.length > 0) utilityData = uData;
          } catch {}
        }
        // 2. Fetch Solar Generation Data
        let solarData = [];
        try {
          const cachedSolar = localStorage.getItem('daily_solar_generation') || localStorage.getItem('CCPL_DAILY_SOLAR_GENERATION_V1') || localStorage.getItem('energy_solar_data');
          if (cachedSolar) {
            const parsed = JSON.parse(cachedSolar);
            if (Array.isArray(parsed) && parsed.length > 0) solarData = parsed;
          }
        } catch {}
        if (typeof window !== 'undefined' && window.supabase) {
          try {
            const { data: sData } = await window.supabase.from('daily_solar_generation').select('*');
            if (sData && sData.length > 0) solarData = sData;
          } catch {}
        }
        if (Array.isArray(utilityData) && utilityData.length > 0) setHydratedUtility(utilityData);
        if (Array.isArray(solarData) && solarData.length > 0) setHydratedSolar(solarData);
      } catch (err) {
        console.error('Error loading dashboard energy metrics:', err);
      } finally {
        setEnergyLoading(false);
      }
    };
    fetchEnergyData();
  }, [dailyUtilityLog, dailySolarGeneration]);

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
  const kpi = useMemo(() => computeKPIs(store, totalFiles, periodFilter), [store, totalFiles, periodFilter]);

  // Effective rows: prefer store data, fallback to hydrated localStorage/supabase cache
  const effectiveUtilityLog = useMemo(() => (dailyUtilityLog.length > 0 ? dailyUtilityLog : hydratedUtility), [dailyUtilityLog, hydratedUtility]);
  const effectiveSolarLog = useMemo(() => (dailySolarGeneration.length > 0 ? dailySolarGeneration : hydratedSolar), [dailySolarGeneration, hydratedSolar]);

  // Period filter for charts (uses effective logs so fallback hydration is included)
  const availablePeriods = useMemo(() => {
    const allPeriods = new Set();
    store.breakdowns.forEach((r) => r.period && allPeriods.add(r.period));
    store.pms.forEach((r) => r.period && allPeriods.add(r.period));
    (store.machinePmRecords || []).forEach((r) => {
      if (r.pmDate) allPeriods.add(String(r.pmDate).slice(0, 7));
    });
    store.machineBreakdownLogs.forEach((r) => {
      if (r.date) allPeriods.add(String(r.date).slice(0, 7));
    });
    effectiveUtilityLog.forEach((r) => {
      if (r.date) allPeriods.add(String(r.date).slice(0, 7));
    });
    effectiveSolarLog.forEach((r) => {
      if (r.date) allPeriods.add(String(r.date).slice(0, 7));
    });
    return [...allPeriods].sort().reverse();
  }, [store, effectiveUtilityLog, effectiveSolarLog]);

  const filteredBreakdowns = useMemo(() =>
    periodFilter === 'all' ? store.breakdowns : store.breakdowns.filter((r) => r.period === periodFilter),
    [store.breakdowns, periodFilter]
  );
  const filteredPMs = useMemo(() =>
    periodFilter === 'all' ? store.pms : store.pms.filter((r) => r.period === periodFilter),
    [store.pms, periodFilter]
  );
  const filteredMachineBDLogs = useMemo(() =>
    periodFilter === 'all' ? store.machineBreakdownLogs : store.machineBreakdownLogs.filter((r) => String(r.date || '').slice(0, 7) === periodFilter),
    [store.machineBreakdownLogs, periodFilter]
  );
  const filteredMachinePmRecords = useMemo(() =>
    periodFilter === 'all' ? (machinePmRecords || []) : (machinePmRecords || []).filter((r) => String(r.pmDate || '').slice(0, 7) === periodFilter),
    [machinePmRecords, periodFilter]
  );

  const filteredDailyUtilityLog = useMemo(() =>
    periodFilter === 'all' ? effectiveUtilityLog : effectiveUtilityLog.filter((r) => String(r.date || '').slice(0, 7) === periodFilter),
    [effectiveUtilityLog, periodFilter]
  );
  const filteredDailySolarGeneration = useMemo(() =>
    periodFilter === 'all' ? effectiveSolarLog : effectiveSolarLog.filter((r) => String(r.date || '').slice(0, 7) === periodFilter),
    [effectiveSolarLog, periodFilter]
  );

  // Dashboard metrics using canonical calculations from canonical data sources
  const dashboardMetrics = useMemo(() => {
    return computeDashboardMetrics(filteredDailySolarGeneration, filteredDailyUtilityLog);
  }, [filteredDailySolarGeneration, filteredDailyUtilityLog]);

  const pfTrend = useMemo(() =>
    computePfTrend(effectiveUtilityLog, 12, periodFilter).map((d) => ({ ...d, label: d.date ? d.date.slice(5) : '' })),
    [effectiveUtilityLog, periodFilter]
  );
  const dgFuelEfficiency = useMemo(() => computeDgFuelEfficiency(effectiveUtilityLog, 6, periodFilter), [effectiveUtilityLog, periodFilter]);
  const pmTrend = useMemo(() => monthlyPMCompletionFromRecords(machinePmRecords, 6), [machinePmRecords]);

  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const latestPf = useMemo(() => {
    if (effectiveUtilityLog.length === 0) return null;
    const allDeltas = computeDailyDeltas(effectiveUtilityLog);
    const periodDeltas = periodFilter === 'all' ? allDeltas : allDeltas.filter((d) => String(d.date || '').slice(0, 7) === periodFilter);
    if (periodDeltas.length === 0) return null;
    const last = periodDeltas[0];
    const u1ImportKwh = Number(last._delta?.u1ImportKwhReading) || 0;
    const u2ImportKwh = Number(last._delta?.u2ImportKwhReading) || 0;
    const u1PfRaw = last.u1Pf > 0 ? last.u1Pf : 0;
    const u2PfRaw = last.u2Pf > 0 ? last.u2Pf : 0;
    const avgRaw = computeWeightedPf(periodDeltas);
    return {
      date: last.date,
      u1Pf: u1PfRaw > 0 ? formatPowerFactor(u1PfRaw) : null,
      u2Pf: u2PfRaw > 0 ? formatPowerFactor(u2PfRaw) : null,
      avgPf: avgRaw > 0 ? formatPowerFactor(avgRaw) : null,
    };
  }, [effectiveUtilityLog, periodFilter]);

  // Compute metrics dynamically from fetched rows ÔÇö uses robust computeEnergySnapshot with flexible key parsing & localStorage fallback
  const energySnapshot = useMemo(() => {
    return computeEnergySnapshot(filteredDailyUtilityLog, filteredDailySolarGeneration);
  }, [filteredDailyUtilityLog, filteredDailySolarGeneration]);

  const charts = useMemo(() => ({
    bdTrend: monthlyBreakdownTrend(filteredBreakdowns),
    equipment: equipmentWiseBreakdown(filteredBreakdowns).slice(0, 8),
    pareto: paretoTop10(filteredBreakdowns),
    dept: breakdownByDepartment(filteredBreakdowns),
    health: healthDistribution(store.machines, filteredBreakdowns, filteredPMs, filteredMachinePmRecords),
    machineStatus: machineStatusDistribution(store.machines),
    avail: availabilityTrend(filteredBreakdowns, store.machines.length),
    mttr: mttrTrend(filteredBreakdowns),
    mtbf: mtbfTrend(filteredBreakdowns, store.machines.length),
    topMachines: machineWiseBreakdown(filteredMachineBDLogs).slice(0, 10),
    failureCausePareto: failureCausePareto(filteredMachineBDLogs),
    monthlyRegister: machineBreakdownRegister(filteredMachineBDLogs),
    activeBreakdowns: currentlyUnderBreakdown(store.machineBreakdownLogs),
    amcNotifications: buildAMCNotifications(store.amc, store.machines),
    pfTrend,
    dgFuelEfficiency,
  }), [filteredBreakdowns, filteredPMs, filteredMachineBDLogs, filteredMachinePmRecords, store.machines, store.machineBreakdownLogs, store.amc, pfTrend, dgFuelEfficiency]);
  const insights = useMemo(() => buildInsights(store), [store]);

  // Merge local activity feed with server upload history
  const feed = useMemo(() => {
    const local = store.activity.map((a) => ({
      id: a.id, user: a.user, text: `${a.action} ${a.detail ? '┬À ' + a.detail : ''}`,
      type: a.type, ts: a.ts,
    }));
    const uploads = recent.map((r) => ({
      id: `srv-${r.id}`, user: r.uploader_name || 'System',
      text: `uploaded ${r.filename} ┬À ${r.category_name}`,
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

  const noBDs = filteredBreakdowns.length === 0;
  const noPMs = filteredPMs.length === 0;
  const noDailyUtility = filteredDailyUtilityLog.length === 0;
  const noSolar = filteredDailySolarGeneration.length === 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Welcome banner with live date/time + plant identity */}
      <section className="glass-card p-6 lg:p-7 relative overflow-hidden" aria-label="Welcome banner">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-cyan-500/8 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute -bottom-24 left-1/3 w-64 h-64 bg-emerald-500/6 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h2 className="text-page-title">
              {greeting()}, {user?.full_name || 'Engineer'} ­ƒæï
            </h2>
            <p className="text-body mt-1.5">
              {user ? 'Maintenance Engineer' : 'Viewer'} ÔÇö {store.settings.plantName} ┬À Crystal Crop Protection Ltd.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 mt-4">
              <StatusBadge
                status={kpi.breakdown > 0 ? 'breakdown' : 'running'}
                label={filteredBreakdowns.length > 0 ? `${filteredBreakdowns.reduce((s, r) => s + (r.breakdownCount || 0), 0)} Breakdown${filteredBreakdowns.reduce((s, r) => s + (r.breakdownCount || 0), 0) > 1 ? 's' : ''} ${periodFilter === 'all' ? 'Logged This Month' : 'in Period'}`
                  : filteredMachineBDLogs.length > 0
                    ? `${filteredMachineBDLogs.length} Breakdown${filteredMachineBDLogs.length > 1 ? 's' : ''} ${periodFilter === 'all' ? 'Logged This Month' : 'in Period'}`
                    : 'No Breakdown Logged This Month'}
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
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <button onClick={() => openUpload({ kind: 'bulk' })} className="btn-success inline-flex items-center gap-2 text-xs">
                  <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
                </button>
                <button onClick={openMasterImport} className="btn-primary inline-flex items-center gap-2 text-xs">
                  <FileSpreadsheet size={13} aria-hidden="true" /> Import Master Excel
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Period filter bar */}
      {availablePeriods.length > 1 && (
        <section aria-label="Period filter" className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Filter size={13} aria-hidden="true" />
            <span>Filter Period:</span>
          </div>
          <button
            onClick={() => setPeriodFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-control border transition-all ${
              periodFilter === 'all'
                ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:border-white/[0.15]'
            }`}
          >
            All Time
          </button>
          {availablePeriods.slice(0, 12).map((p) => {
            const [y, m] = p.split('-').map(Number);
            const label = new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
            return (
              <button
                key={p}
                onClick={() => setPeriodFilter(p)}
                className={`text-xs px-3 py-1.5 rounded-control border transition-all ${
                  periodFilter === p
                    ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                    : 'bg-white/[0.03] text-slate-400 border-white/[0.08] hover:border-white/[0.15]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </section>
      )}

      {/* 13 live KPI cards ÔÇö all values computed from stored data */}
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
          <KPIStatCard icon={ListChecks} label="Pending PM" value={kpi.openWorkOrders} sub={`${kpi.pmSectionLogs} PM section summaries`} tone={kpi.openWorkOrders ? 'warning' : 'neutral'} />
        </div>
      </section>

      {/* Energy Snapshot Section ÔÇö now hydrates via same store/context as EnergyManagement with fallback handling */}
      <EnergySnapshotCard snapshotMetrics={energySnapshot} isLoading={energyLoading || loading} />

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
        <ChartCard title="Monthly PM Completion" subtitle="Planned vs Done vs Pending (from machine records)" empty={noPMs}>
          <GroupedBarChart
            data={pmTrend}
            bars={[
              { dataKey: 'planned', name: 'Planned', color: '#06B6D4' },
              { dataKey: 'completed', name: 'Done', color: '#10B981' },
              { dataKey: 'pending', name: 'Pending', color: '#F59E0B' },
            ]}
          />
        </ChartCard>
        <ChartCard title="Section-wise Breakdowns" subtitle="Failure count per plant section" empty={noBDs}>
          <HorizontalBarChart data={charts.equipment} color="#06B6D4" />
        </ChartCard>
        <ChartCard title="Top 10 Breakdown Sections" subtitle="Pareto ÔÇö section-wise failure concentration" empty={noBDs} height={280}>
          <ParetoChart data={charts.pareto} />
        </ChartCard>
        <ChartCard title="Breakdown by Section" subtitle="Failure distribution across plant" empty={noBDs}>
          <PieDonutChart data={charts.dept} />
        </ChartCard>
        <ChartCard title="Power Factor Trend" subtitle="Unit 1, Unit 2 & Average daily power factor" empty={noDailyUtility} height={260} raw>
          {noDailyUtility ? (
            <div className="flex h-full items-center justify-center text-slate-500 text-sm">No data available for this period.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.pfTrend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 1]} width={48} />
                <RechartsTooltip contentStyle={{ backgroundColor: '#0F172A', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '10px', fontSize: '12px', color: '#E2E8F0', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} iconType="circle" iconSize={8} />
                <Line type="monotone" dataKey="u1Pf" name="U1 PF" stroke="#14B8A6" strokeWidth={2.5} dot={{ r: 3, fill: '#14B8A6', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                <Line type="monotone" dataKey="u2Pf" name="U2 PF" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 3, fill: '#8B5CF6', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                <Line type="monotone" dataKey="avgPf" name="Avg PF" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3, fill: '#F59E0B', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="DG Fuel Efficiency" subtitle="kWh per litre ÔÇö DG 500 vs DG 380" empty={noDailyUtility}>
          {noDailyUtility ? (
            <div className="flex h-full items-center justify-center text-slate-500 text-sm">No data available for this period.</div>
          ) : (
            <GroupedBarChart
              data={charts.dgFuelEfficiency}
              bars={[
                { dataKey: 'dg500KwhPerLitre', name: 'DG 500 kVA (kWh/L)', color: '#F59E0B' },
                { dataKey: 'dg380KwhPerLitre', name: 'DG 380 kVA (kWh/L)', color: '#FB923C' },
              ]}
            />
          )}
        </ChartCard>
        <SolarPerformanceCard metrics={dashboardMetrics} />
        <RenewableEnergyCard metrics={dashboardMetrics} />
        <ChartCard title="Machine Health Distribution" subtitle="Fleet condition derived from failures & PM" empty={!store.machines.length}>
          <PieDonutChart data={charts.health} donut centerLabel={kpi.machineCount} centerSub="Machines" />
        </ChartCard>
        <ChartCard title="Availability Trend" subtitle="Plant availability % ┬À last 6 months" empty={noBDs}>
          <TrendChart data={charts.avail} color="#10B981" unit="%" yDomain={[0, 100]} />
        </ChartCard>
        <ChartCard title="MTTR Trend" subtitle="Mean time to repair (hrs)" empty={noBDs}>
          <TrendChart data={charts.mttr} color="#8B5CF6" unit=" hrs" />
        </ChartCard>
        <ChartCard title="MTBF Trend" subtitle="Mean time between failures (hrs)" empty={noBDs}>
          <TrendChart data={charts.mtbf} color="#06B6D4" unit=" hrs" />
        </ChartCard>
        <ChartCard title="Top 10 Machines by Breakdown" subtitle="Machine-level breakdown ranking" empty={!store.machineBreakdownLogs.length}>
          <ParetoChart data={charts.topMachines} />
        </ChartCard>
        <ChartCard title="Failure Cause Pareto" subtitle="Breakdown causes ranked by frequency" empty={!store.machineBreakdownLogs.length}>
          <ParetoChart data={charts.failureCausePareto} />
        </ChartCard>
      </section>

      {/* Currently Under Breakdown ÔÇö real-time active incidents */}
      {charts.activeBreakdowns.length > 0 && (
        <section aria-label="Currently under breakdown">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-control bg-red-400/10 border border-red-400/25 flex items-center justify-center">
                <AlertOctagon size={17} className="text-red-400" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-card-title">Currently Under Breakdown</h3>
                <p className="text-meta">Active breakdown incidents without CLOSED status</p>
              </div>
              <span className="badge bg-red-500/15 text-red-400 border border-red-500/30 ml-2">{charts.activeBreakdowns.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[800px]">
                <thead>
                  <tr>
                    <th>Machine ID</th><th>Machine</th><th>Section</th><th>Start</th><th>Duration</th><th>Failure Cause</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {charts.activeBreakdowns.slice(0, 10).map((log) => {
                    const startD = log.startTime ? new Date(log.startTime) : null;
                    const durationHrs = log.startTime && !log.endTime
                      ? round1((Date.now() - new Date(log.startTime).getTime()) / 3_600_000)
                      : log.downtimeHours || 0;
                    return (
                      <tr key={log.id}
                        className="cursor-pointer hover:bg-white/[0.03]"
                        onClick={() => navigate(`/machines/${log.machineId}`)}
                      >
                        <td className="text-cyan-400 font-mono text-xs">{log.machineCode || log.machineId}</td>
                        <td className="text-white font-medium">{log.machineName}</td>
                        <td className="text-slate-300">{log.plantSection}</td>
                        <td className="text-slate-300 text-xs whitespace-nowrap">{startD ? startD.toLocaleString('en-GB') : 'ÔÇö'}</td>
                        <td className="text-amber-300 font-semibold">{durationHrs}h</td>
                        <td className="text-slate-300 max-w-[200px] truncate" title={log.failureCause}>{log.failureCause || 'ÔÇö'}</td>
                        <td><span className="badge bg-red-500/15 text-red-400">{log.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Monthly Machine Breakdown Register */}
      {charts.monthlyRegister.length > 0 && (
        <section aria-label="Monthly machine breakdown register">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-control bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">
                <CalendarDays size={17} className="text-amber-400" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-card-title">Monthly Machine Breakdown Register</h3>
                <p className="text-meta">Machine-wise breakdown summary by month</p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[400px]">
              <table className="enterprise-table w-full min-w-[900px]">
                <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                  <tr>
                    <th>Month</th><th>Machine ID</th><th>Machine</th><th>Section</th><th>Breakdowns</th><th>Downtime (hrs)</th><th>Main Failure Cause</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {charts.monthlyRegister.slice(0, 30).map((row, i) => {
                    const [year, month] = row.period.split('-').map(Number);
                    const monthName = new Date(year, month - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                    return (
                      <tr key={`${row.period}-${row.machineId}-${i}`}
                        className="cursor-pointer hover:bg-white/[0.03]"
                        onClick={() => row.machineId && navigate(`/machines/${row.machineId}`)}
                      >
                        <td className="text-slate-300 whitespace-nowrap">{monthName}</td>
                        <td className="text-cyan-400 font-mono text-xs">{row.machineCode || row.machineId}</td>
                        <td className="text-white font-medium">{row.machineName}</td>
                        <td className="text-slate-300">{row.plantSection}</td>
                        <td className="text-slate-200 font-semibold">{row.breakdownCount}</td>
                        <td className="text-amber-300">{row.downtimeHours}h</td>
                        <td className="text-slate-300 max-w-[180px] truncate" title={row.mainFailureCause}>{row.mainFailureCause || 'ÔÇö'}</td>
                        <td>
                          <span className={`badge ${row.status === 'ACTIVE' ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* AMC Alerts */}
      {charts.amcNotifications.length > 0 && (
        <section aria-label="AMC alerts">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-control bg-violet-400/10 border border-violet-400/25 flex items-center justify-center">
                <ShieldCheck size={17} className="text-violet-400" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-card-title">AMC Alerts</h3>
                <p className="text-meta">Upcoming AMC expiries and service visit overdue alerts</p>
              </div>
            </div>
            <div className="space-y-2">
              {charts.amcNotifications.slice(0, 8).map((n) => (
                <div key={n.id} className={`flex items-center gap-3 rounded-control border px-4 py-2.5 ${
                  n.type === 'danger' ? 'bg-red-500/10 border-red-500/25 text-red-300' :
                  n.type === 'warning' ? 'bg-amber-500/10 border-amber-500/25 text-amber-300' :
                  'bg-cyan-500/10 border-cyan-500/25 text-cyan-300'
                }`}>
                  <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{n.title}</p>
                    <p className="text-[11px] opacity-80">{n.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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

      {/* Recent activity ÔÇö merged store events + server uploads */}
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
