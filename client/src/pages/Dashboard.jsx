import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { api } from '../api.js';
import KPIStatCard from '../components/KPIStatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { LineChart, DonutChart, ProgressGauge, BarChart } from '../components/charts.jsx';
import { CATEGORY_META, EXT_META } from '../constants.js';
import { timeAgo, greeting } from '../utils.js';
import {
  Factory, Activity, Wrench, AlertOctagon, ClipboardCheck, FolderArchive,
  Timer, TimerReset, Gauge, ListChecks, Clock, ChevronRight, FileText, User,
} from 'lucide-react';

// Live plant KPI snapshot (equipment registry runs on the reliability desk)
const KPI_CARDS = [
  { icon: Factory, label: 'Total Machines', value: '128', trend: '+3 Added', trendUp: true, tone: 'accent' },
  { icon: Activity, label: 'Running Status', value: '124', sub: 'Healthy', tone: 'success' },
  { icon: Wrench, label: 'Under Maintenance', value: '3', sub: 'Planned jobs in progress', tone: 'warning' },
  { icon: AlertOctagon, label: 'Active Breakdowns', value: '1', sub: 'Red alert — RCA open', tone: 'danger', pulse: true },
  { icon: ClipboardCheck, label: 'PM Compliance', value: '96%', trend: '+2% vs Last Month', trendUp: true, tone: 'success' },
];

const HEALTH_WIDGETS = [
  { icon: Timer, label: 'MTBF', value: '312 hrs', desc: 'Mean Time Between Failures', color: 'text-cyan-400' },
  { icon: TimerReset, label: 'MTTR', value: '2.4 hrs', desc: 'Mean Time To Repair', color: 'text-emerald-400' },
  { icon: Gauge, label: 'OEE', value: '87.5%', desc: 'Overall Equipment Effectiveness', color: 'text-amber-400' },
  { icon: ListChecks, label: 'Open Work Orders', value: '14', desc: '3 high priority', color: 'text-rose-400' },
];

const BREAKDOWN_TREND = [
  { label: 'Feb', value: 42 }, { label: 'Mar', value: 35 }, { label: 'Apr', value: 48 },
  { label: 'May', value: 29 }, { label: 'Jun', value: 22 }, { label: 'Jul', value: 16 },
];

const ENERGY_DATA = [
  { label: 'DG 500kVA', value: 18400, color: '#F59E0B' },
  { label: 'DG 380kVA', value: 12750, color: '#FB923C' },
  { label: 'Solar Gen', value: 21300, color: '#10B981' },
  { label: 'Plant SEC', value: 9600, color: '#06B6D4', unit: 'kWh/MT' },
];

const MODULE_GROUPS = [
  { label: 'Module A · Preventive & Corrective Maintenance', cats: ['Monthly PM Report', 'Plantwise Breakdown Report', 'FAT (Factory Acceptance Test)'] },
  { label: 'Module B · Utilities & Energy Management', cats: ['Energy Report (DG 500 & 380KVA)', 'Energy Report (Solar)', 'Plantwise Energy Consumption'] },
  { label: 'Module C · Continuous Improvement & Compliance', cats: ['Kaizen', 'Improvement', 'ORM Data (Operational Risk Management)'] },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { refreshKey } = useUI();
  const navigate = useNavigate();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" role="status" aria-label="Loading dashboard" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Welcome banner */}
      <section className="glass-card p-6 lg:p-7 relative overflow-hidden" aria-label="Welcome banner">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-cyan-500/8 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute -bottom-24 left-1/3 w-64 h-64 bg-emerald-500/6 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative z-10">
          <h2 className="text-page-title">
            {greeting()}, {user?.full_name || 'Engineer'} 👋
          </h2>
          <p className="text-body mt-1.5">
            Maintenance Engineer — Crystal Crop Protection Ltd. (Nathupur Unit)
          </p>
          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            <StatusBadge status="running" label="Plant Systems Nominal" pulse />
            <span className="status-pill bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
              21 Plant Sections Monitored
            </span>
          </div>
        </div>
      </section>

      {/* 6 Live KPI summary cards */}
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 lg:gap-5">
          {KPI_CARDS.map((k) => <KPIStatCard key={k.label} {...k} />)}
          <KPIStatCard
            icon={FolderArchive}
            label="Document Vault"
            value={totalFiles > 0 ? totalFiles : '583'}
            sub="Excel · Word · PPT · PDF"
            tone="accent"
          />
        </div>
      </section>

      {/* Equipment health widgets */}
      <section aria-label="Equipment health indicators">
        <h3 className="text-section-heading mb-4">Equipment Health</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {HEALTH_WIDGETS.map((w) => {
            const Icon = w.icon;
            return (
              <div key={w.label} className="glass-card glass-card-hover p-5 flex items-center gap-4">
                <div className={`w-11 h-11 rounded-control bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0 ${w.color}`}>
                  <Icon size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-white text-lg font-bold leading-tight">{w.value}</p>
                  <p className="text-slate-400 text-xs font-medium">{w.label}</p>
                  <p className="text-slate-600 text-[10px] truncate">{w.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Analytics charts */}
      <section aria-label="Analytics charts" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-card p-5">
          <h4 className="text-card-title mb-1">Monthly Breakdown Trend</h4>
          <p className="text-meta mb-3">Downtime hours · last 6 months</p>
          <LineChart data={BREAKDOWN_TREND} />
        </div>
        <div className="glass-card p-5">
          <h4 className="text-card-title mb-1">Machine Running Status</h4>
          <p className="text-meta mb-3">Live fleet distribution</p>
          <div className="flex justify-center pt-2">
            <DonutChart
              segments={[
                { label: 'Running', value: 124, color: '#10B981' },
                { label: 'Maintenance', value: 3, color: '#F59E0B' },
                { label: 'Breakdown', value: 1, color: '#EF4444' },
              ]}
              centerLabel="128"
              centerSub="Machines"
            />
          </div>
        </div>
        <div className="glass-card p-5">
          <h4 className="text-card-title mb-1">Monthly PM Completion Rate</h4>
          <p className="text-meta mb-3">July 2026 schedule adherence</p>
          <div className="flex justify-center pt-4">
            <ProgressGauge value={96} label="PM Compliance" size={230} />
          </div>
        </div>
        <div className="glass-card p-5">
          <h4 className="text-card-title mb-1">Energy Consumption Overview</h4>
          <p className="text-meta mb-3">DG 500kVA vs 380kVA vs Solar vs Plant SEC</p>
          <BarChart data={ENERGY_DATA} />
        </div>
      </section>

      {/* Document modules */}
      <section aria-label="Report modules">
        <h3 className="text-section-heading mb-4">Report & Document Modules</h3>
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

      {/* Recent activity timeline */}
      <section aria-label="Recent activity">
        <h3 className="text-section-heading mb-4">Recent Activity Timeline</h3>
        <div className="glass-card overflow-hidden">
          {recent.length === 0 ? (
            <div className="p-10 text-center">
              <FileText size={28} className="text-slate-600 mx-auto mb-3" aria-hidden="true" />
              <p className="text-body">No activity yet. Uploads, SOP additions and report approvals will appear here.</p>
            </div>
          ) : (
            <ol className="divide-y divide-white/[0.04]">
              {recent.map((r) => {
                const extMeta = EXT_META[r.file_format];
                return (
                  <li key={r.id} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-white/[0.02] transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400/80 to-cyan-400/80 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                      <User size={14} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-200 text-[13px] leading-snug">
                        <span className="text-white font-semibold">{r.uploader_name || 'System'}</span>{' '}
                        uploaded <span className="text-cyan-400 font-medium">{r.filename}</span>
                      </p>
                      <p className="text-slate-500 text-[11px] mt-0.5 truncate">
                        {r.category_name} · {r.plant_section} · {r.reporting_month} {r.reporting_year}
                      </p>
                    </div>
                    {extMeta && <span className={`badge ${extMeta.badge} hidden sm:inline-flex`}>{extMeta.label}</span>}
                    <span className="text-slate-500 text-[11px] whitespace-nowrap flex-shrink-0">{timeAgo(r.uploaded_at)}</span>
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
