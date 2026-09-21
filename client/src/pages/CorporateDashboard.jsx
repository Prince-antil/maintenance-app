import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.js';
import { usePlant } from '../context/PlantContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { canViewCorporateDashboard } from '../lib/plantAccess.js';
import { computeKPIs, aggregateBreakdownRecords, aggregatePMRecords, monthlyBreakdownTrend, monthlyPMCompletion } from '../analytics.js';
import KPIStatCard from '../components/KPIStatCard.jsx';
import { ChartCard, GroupedBarChart, DualTrendChart, PieDonutChart, TrendChart } from '../components/AnalyticsCharts.jsx';
import FormulaExplorerModal from '../components/FormulaExplorerModal.jsx';
import {
  Factory, Layers, AlertOctagon, ClipboardCheck, Timer, Gauge,
  Building2, Zap, TrendingUp, ArrowRight, Shield, BarChart3, HelpCircle, Info,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from 'recharts';

function PlantComparisonTable({ plants, plantData, onDrill }) {
  const rows = plants.map((p) => {
    const d = plantData[p.id] || {};
    return {
      plant: p,
      machines: d.machines?.length || 0,
      breakdowns: d.kpi?.breakdown || 0,
      bdHours: d.bdHours || 0,
      mttr: d.kpi?.mttr || 0,
      mtbf: d.kpi?.mtbf || 0,
      availability: d.kpi?.availability || 0,
      pmCompliance: d.kpi?.pmCompliance || 0,
      energy: d.energyTotal || 0,
    };
  });

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-white/[0.06] flex items-center gap-2">
        <BarChart3 size={14} className="text-cyan-400" />
        <h3 className="text-card-title">Plant Comparison</h3>
        <span className="ml-auto text-meta text-xs">{plants.length} plants</span>
      </div>
      <div className="overflow-x-auto">
        <table className="enterprise-table w-full min-w-[900px]">
          <thead>
            <tr>
              <th>Plant</th>
              <th>Machines</th>
              <th>PM %</th>
              <th>Breakdowns</th>
              <th>BD Hours</th>
              <th>MTTR</th>
              <th>MTBF</th>
              <th>Availability</th>
              <th>Energy (kWh)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.plant.id} className="hover:bg-white/[0.03]">
                <td>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Building2 size={12} className="text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-white text-xs font-semibold">{r.plant.plant_name}</p>
                      <p className="text-slate-500 text-[10px]">{r.plant.plant_code}</p>
                    </div>
                  </div>
                </td>
                <td className="text-white font-semibold">{r.machines}</td>
                <td>
                  <span className={`badge ${r.pmCompliance >= 90 ? 'bg-emerald-500/15 text-emerald-400' : r.pmCompliance >= 75 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                    {r.pmCompliance > 0 ? `${r.pmCompliance}%` : 'No data'}
                  </span>
                </td>
                <td className="text-white">{r.breakdowns || <span className="text-slate-500 text-xs">No data</span>}</td>
                <td className="text-amber-300">{r.bdHours ? `${r.bdHours}h` : <span className="text-slate-500 text-xs">No data</span>}</td>
                <td className="text-slate-300">{r.mttr ? `${r.mttr}h` : '—'}</td>
                <td className="text-slate-300">{r.mtbf ? `${r.mtbf}h` : '—'}</td>
                <td>
                  <span className={`text-xs font-semibold ${r.availability >= 95 ? 'text-emerald-400' : r.availability >= 85 ? 'text-amber-400' : 'text-red-400'}`}>
                    {r.availability ? `${r.availability}%` : '—'}
                  </span>
                </td>
                <td className="text-cyan-300">{r.energy ? r.energy.toLocaleString() : <span className="text-slate-500 text-xs">No data</span>}</td>
                <td>
                  <button onClick={() => onDrill(r.plant.id)} className="btn-ghost text-xs inline-flex items-center gap-1 py-1 px-2">
                    View <ArrowRight size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-white/[0.03] border-t border-white/[0.08]">
              <td className="text-white font-bold">All Plants</td>
              <td className="text-white font-bold">{rows.reduce((s, r) => s + r.machines, 0)}</td>
              <td colSpan={2} className="text-white font-bold">{rows.reduce((s, r) => s + r.breakdowns, 0)} total</td>
              <td className="text-amber-300 font-bold">{rows.reduce((s, r) => s + r.bdHours, 0).toFixed(1)}h</td>
              <td colSpan={4} className="text-slate-400 text-xs">Use charts below for cross-plant trends</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function CorporateDashboard() {
  const { user } = useAuth();
  const { plants, authorizedPlants, setCurrentPlant } = usePlant();
  const store = useStore();
  const navigate = useNavigate();
  const [periodFilter, setPeriodFilter] = useState('all');
  const [showPmFormula, setShowPmFormula] = useState(false);
  const [showAvailFormula, setShowAvailFormula] = useState(false);
  const [showEnergyFormula, setShowEnergyFormula] = useState(false);

  if (!canViewCorporateDashboard(user?.role)) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <Shield size={32} className="text-slate-600 mx-auto mb-4" />
        <h2 className="text-white text-lg font-bold">Corporate Access Required</h2>
        <p className="text-slate-400 text-sm mt-2">This dashboard is available to Corporate Head and Super Admin users only.</p>
      </div>
    );
  }

  // Plants visible to this corporate user
  const visiblePlants = authorizedPlants.length ? authorizedPlants : plants;

  // Compute per-plant KPIs
  const plantData = useMemo(() => {
    const out = {};
    visiblePlants.forEach((p) => {
      const pid = p.id;
      const filter = (arr) => (arr || []).filter((r) => (r.plant_id || r.plantId) === pid || (!r.plant_id && !r.plantId && pid === '00000000-0000-0000-0000-000000000001'));
      const pMachines = filter(store.machines);
      const pBreakdowns = filter(store.breakdowns);
      const pPms = filter(store.pms);
      const pEnergy = filter(store.energy);
      const pBDLogs = filter(store.machineBreakdownLogs);
      const filteredStore = { machines: pMachines, breakdowns: pBreakdowns, pms: pPms, energy: pEnergy, machineBreakdownLogs: pBDLogs, machinePmRecords: filter(store.machinePmRecords), amc: filter(store.amc), dailyUtilityLog: filter(store.dailyUtilityLog), dailySolarGeneration: filter(store.dailySolarGeneration), activity: store.activity, settings: store.settings };
      const kpi = computeKPIs(filteredStore, 0, periodFilter);
      const bdAgg = aggregateBreakdownRecords(pBreakdowns);
      out[pid] = {
        machines: pMachines,
        breakdowns: pBreakdowns,
        pms: pPms,
        kpi,
        bdHours: bdAgg.downtimeHours,
        energyTotal: pEnergy.reduce((s, e) => s + (e.kwh || e.totalKwh || 0), 0),
        breakdownTrend: monthlyBreakdownTrend(pBreakdowns, 6),
        pmTrend: monthlyPMCompletion(pPms, 6),
      };
    });
    return out;
  }, [visiblePlants, store, periodFilter]);

  // Aggregated totals — WEIGHTED (fixes “total average PM wrong”)
  // Previous simple average of percentages was incorrect for cross-plant; weighted is Σ done / Σ planned
  const totals = useMemo(() => {
    const allMachines = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.machines.length || 0), 0);
    const allBD = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.breakdown || 0), 0);
    const allBDHours = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.bdHours || 0), 0);
    // Weighted PM compliance = total completed / total planned across all visible plants
    const totalPlanned = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.pmDue || plantData[p.id]?.kpi.pmCompleted + plantData[p.id]?.kpi.pmPending || 0), 0);
    const totalDone = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.pmCompleted || 0), 0);
    // Fallback: if pmDue/pmCompleted not populated (legacy), use simple average
    const avgCompliance = totalPlanned > 0
      ? Math.round((totalDone / totalPlanned) * 1000) / 10
      : (visiblePlants.length ? Math.round(visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.pmCompliance || 0), 0) / visiblePlants.length * 10) / 10 : 0);
    // Weighted availability & MTTR/MTBF from aggregated downtime
    let avgAvail = 0; let avgMttr = 0; let avgMtbf = 0;
    try {
      const totalOp = allMachines * 720;
      avgAvail = totalOp > 0 ? Math.round(((totalOp - allBDHours) / totalOp) * 1000) / 10 : 0;
      if (avgAvail > 100) avgAvail = 100; if (avgAvail < 0) avgAvail = 0;
      avgMttr = allBD > 0 ? Math.round((allBDHours / allBD) * 10) / 10 : 0;
      const totalOpMinusDown = Math.max(0, totalOp - allBDHours);
      avgMtbf = allBD > 0 ? Math.round((totalOpMinusDown / allBD) * 10) / 10 : 0;
      if (allBD === 0) {
        avgMttr = visiblePlants.length ? Math.round(visiblePlants.reduce((s,p)=>s+(plantData[p.id]?.kpi.mttr||0),0)/visiblePlants.length*10)/10 : 0;
        avgMtbf = visiblePlants.length ? Math.round(visiblePlants.reduce((s,p)=>s+(plantData[p.id]?.kpi.mtbf||0),0)/visiblePlants.length*10)/10 : 0;
      }
    } catch {
      avgAvail = visiblePlants.length ? Math.round(visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.availability || 0), 0) / visiblePlants.length * 10) / 10 : 0;
      avgMttr = visiblePlants.length ? Math.round(visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.mttr || 0), 0) / visiblePlants.length * 10) / 10 : 0;
      avgMtbf = visiblePlants.length ? Math.round(visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.mtbf || 0), 0) / visiblePlants.length * 10) / 10 : 0;
    }
    const totalEnergy = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.energyTotal || 0), 0);
    const openPM = visiblePlants.reduce((s, p) => s + (plantData[p.id]?.kpi.pmPending || 0), 0);
    return { allMachines, allBD, allBDHours, avgCompliance, avgAvail, avgMttr, avgMtbf, totalEnergy, openPM, totalPlanned, totalDone };
  }, [visiblePlants, plantData]);

  // Chart data: plant-wise PM compliance
  const pmChartData = visiblePlants.map((p) => ({
    label: p.plant_code,
    value: plantData[p.id]?.kpi.pmCompliance || 0,
    fullName: p.plant_name,
  }));
  const bdChartData = visiblePlants.map((p) => ({
    label: p.plant_code,
    value: plantData[p.id]?.kpi.breakdown || 0,
    fullName: p.plant_name,
  }));
  const bdHoursData = visiblePlants.map((p) => ({
    label: p.plant_code,
    value: plantData[p.id]?.bdHours || 0,
    fullName: p.plant_name,
  }));
  const availData = visiblePlants.map((p) => ({
    label: p.plant_code,
    value: plantData[p.id]?.kpi.availability || 0,
    fullName: p.plant_name,
  }));
  const energyData = visiblePlants.map((p) => ({
    label: p.plant_code,
    value: Math.round((plantData[p.id]?.energyTotal || 0)),
    fullName: p.plant_name,
  }));

  // Monthly trends across plants (for multi-line)
  const monthlyComparative = useMemo(() => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun'];
    // Use last 6 months labels from monthlyBreakdownTrend
    const base = monthlyBreakdownTrend([], 6);
    return base.map((m, idx) => {
      const row = { label: m.label };
      visiblePlants.forEach((p) => {
        const trend = plantData[p.id]?.breakdownTrend || [];
        row[p.plant_code] = trend[idx]?.count || 0;
      });
      return row;
    });
  }, [visiblePlants, plantData]);

  const handleDrill = (plantId) => {
    setCurrentPlant(plantId);
    navigate('/');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <section className="glass-card p-6 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-violet-500/8 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 left-1/4 w-64 h-64 bg-cyan-500/6 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-page-title flex items-center gap-2">
                <Layers size={22} className="text-violet-400" />
                CRYSTAL CROP PROTECTION LTD.
              </h2>
              <p className="text-violet-300 text-xs font-semibold tracking-wider mt-1">CORPORATE MAINTENANCE & RELIABILITY DASHBOARD</p>
              <p className="text-slate-400 text-xs mt-1">Consolidated view across {visiblePlants.length} plants · {totals.allMachines} machines monitored</p>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <span className="badge bg-violet-500/15 text-violet-300 border border-violet-500/25">Corporate</span>
              <span className="text-slate-500 text-xs">{visiblePlants.map((p) => p.plant_code).join(' · ')}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button onClick={() => setPeriodFilter('all')} className={`text-xs px-3 py-1.5 rounded-control border ${periodFilter==='all' ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.08]'}`}>All Time</button>
            {['2026-04','2026-03','2026-02'].map((p) => (
              <button key={p} onClick={() => setPeriodFilter(p)} className={`text-xs px-3 py-1.5 rounded-control border ${periodFilter===p ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.08]'}`}>{p}</button>
            ))}
          </div>
        </div>
      </section>

      {/* Summary cards — Weighted totals with Explore */}
      <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <KPIStatCard icon={Layers} label="Total Plants" value={visiblePlants.length} sub={visiblePlants.map((p) => p.plant_code).join(', ')} tone="accent" />
        <KPIStatCard icon={Factory} label="Total Machines" value={totals.allMachines} sub="Across all plants" tone="accent" />
        <KPIStatCard icon={AlertOctagon} label="Total Breakdowns" value={totals.allBD} sub={`${totals.allBDHours} hrs downtime`} tone={totals.allBD ? 'danger' : 'neutral'} />
        <div className="relative group">
          <KPIStatCard icon={ClipboardCheck} label="PM Compliance" value={`${totals.avgCompliance}%`} sub={`Weighted · ${totals.totalDone||0}/${totals.totalPlanned||0} done`} tone={totals.avgCompliance>=90?'success':totals.avgCompliance>=75?'warning':'danger'} />
          <button onClick={()=>setShowPmFormula(true)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors" title="Explore PM formula"><HelpCircle size={11}/></button>
        </div>
        <div className="relative group">
          <KPIStatCard icon={Gauge} label="Avg Availability" value={`${totals.avgAvail}%`} sub="Weighted by machines" tone={totals.avgAvail>=95?'success':totals.avgAvail>=85?'warning':'danger'} />
          <button onClick={()=>setShowAvailFormula(true)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors" title="Explore availability formula"><HelpCircle size={11}/></button>
        </div>
        <KPIStatCard icon={Timer} label="Avg MTTR" value={`${totals.avgMttr}h`} sub={`MTBF ${totals.avgMtbf}h`} tone="accent" />
        <div className="relative group">
          <KPIStatCard icon={Zap} label="Total Energy" value={totals.totalEnergy.toLocaleString()} sub="kWh · Σ plants" tone="accent" />
          <button onClick={()=>setShowEnergyFormula(true)} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-colors" title="Explore energy formula"><HelpCircle size={11}/></button>
        </div>
        <KPIStatCard icon={ClipboardCheck} label="Open PM" value={totals.openPM} sub="Pending across plants" tone={totals.openPM?'warning':'neutral'} />
      </section>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <Info size={12} className="text-slate-500"/> Weighted averages: PM = Σ done / Σ planned · Availability = (Σ machines×720 − Σ downtime)/ Σ machines×720 · MTTR = Σ downtime / Σ breakdowns
        <span className="hidden sm:inline">·</span>
        <button onClick={()=>setShowPmFormula(true)} className="text-cyan-400 hover:text-cyan-300 underline decoration-dotted">Explore formulas</button>
      </div>

      {/* Plant comparison table */}
      <PlantComparisonTable plants={visiblePlants} plantData={plantData} onDrill={handleDrill} />

      {/* Charts grid */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Plant-wise PM Compliance" subtitle="Compliance % per plant" empty={!visiblePlants.length}>
          {pmChartData.every((d) => d.value===0) ? <div className="flex h-full items-center justify-center text-slate-500 text-sm">No data</div> : (
            <GroupedBarChart data={pmChartData.map((d)=>({label:d.label, planned: d.value}))} bars={[{dataKey:'planned', name:'Compliance %', color:'#10B981'}]} />
          )}
        </ChartCard>
        <ChartCard title="Plant-wise Breakdown Count" subtitle="Breakdowns per plant" empty={!visiblePlants.length}>
          <GroupedBarChart data={bdChartData.map((d)=>({label:d.label, planned:d.value}))} bars={[{dataKey:'planned', name:'Breakdowns', color:'#EF4444'}]} />
        </ChartCard>
        <ChartCard title="Plant-wise Breakdown Hours" subtitle="Downtime hours per plant" empty={!visiblePlants.length}>
          <GroupedBarChart data={bdHoursData.map((d)=>({label:d.label, planned:d.value}))} bars={[{dataKey:'planned', name:'Hours', color:'#F59E0B'}]} />
        </ChartCard>
        <ChartCard title="Plant-wise Availability" subtitle="Availability % per plant" empty={!visiblePlants.length}>
          <GroupedBarChart data={availData.map((d)=>({label:d.label, planned:d.value}))} bars={[{dataKey:'planned', name:'Availability %', color:'#06B6D4'}]} />
        </ChartCard>
        <ChartCard title="Plant-wise Energy Consumption" subtitle="kWh per plant" empty={!visiblePlants.length}>
          <GroupedBarChart data={energyData.map((d)=>({label:d.label, planned:d.value}))} bars={[{dataKey:'planned', name:'Energy kWh', color:'#F59E0B'}]} />
        </ChartCard>
        <ChartCard title="Plant-wise MTTR" subtitle="Mean time to repair (hrs)" empty={!visiblePlants.length}>
          <GroupedBarChart data={visiblePlants.map((p)=>({label:p.plant_code, planned: plantData[p.id]?.kpi.mttr||0}))} bars={[{dataKey:'planned', name:'MTTR hrs', color:'#8B5CF6'}]} />
        </ChartCard>
        <ChartCard title="Monthly Breakdown Trend — All Plants" subtitle="Breakdowns per month, per plant" empty={!visiblePlants.length} height={260} raw>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyComparative} margin={{top:8,right:12,left:4,bottom:0}}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{fill:'#64748B',fontSize:11}} axisLine={false} tickLine={false} />
              <YAxis tick={{fill:'#64748B',fontSize:11}} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{backgroundColor:'#0F172A',border:'1px solid rgba(148,163,184,0.2)',borderRadius:'10px',fontSize:'12px',color:'#E2E8F0'}} />
              <Legend wrapperStyle={{fontSize:11,color:'#94A3B8'}} iconType="circle" iconSize={8} />
              {visiblePlants.map((p,i) => (
                <Line key={p.id} type="monotone" dataKey={p.plant_code} name={p.plant_name} stroke={['#06B6D4','#10B981','#F59E0B','#8B5CF6','#EF4444'][i%5]} strokeWidth={2.5} dot={{r:3}} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Plant Health Distribution" subtitle="Healthy / Fair / Poor aggregate" empty={!visiblePlants.length} height={260} raw>
          <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
            <div className="grid grid-cols-3 gap-3 w-full">
              {[
                {label:'NATHUPUR', good: visiblePlants[0] ? Math.max(0, (plantData[visiblePlants[0].id]?.machines.length||0) - Math.floor((plantData[visiblePlants[0].id]?.kpi.breakdown||0)/2)) : 0, total: plantData[visiblePlants[0]?.id]?.machines.length||0},
              ].map(()=>null)}
              <div className="rounded-control bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                <p className="text-emerald-400 text-lg font-bold">{visiblePlants.reduce((s,p)=>s+(plantData[p.id]?.machines.length||0),0)}</p>
                <p className="text-slate-500 text-[10px]">Total Machines</p>
              </div>
              <div className="rounded-control bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-amber-400 text-lg font-bold">{totals.allBD}</p>
                <p className="text-slate-500 text-[10px]">Total Breakdowns</p>
              </div>
              <div className="rounded-control bg-cyan-500/10 border border-cyan-500/20 p-3 text-center">
                <p className="text-cyan-400 text-lg font-bold">{totals.avgCompliance}%</p>
                <p className="text-slate-500 text-[10px]">Avg PM Compliance</p>
              </div>
            </div>
            <p className="text-slate-500 text-xs text-center">Drill down into any plant table row to open its Maintenance Hub</p>
          </div>
        </ChartCard>
      </section>

      {/* Drill-down hint */}
      <div className="glass-card p-4 flex items-center gap-3">
        <TrendingUp size={16} className="text-cyan-400" />
        <p className="text-slate-400 text-xs">Click <span className="text-white font-semibold">View</span> in the table above to drill down: Corporate → Plant Dashboard → Machines → Breakdown history. Breadcrumb always shows current plant.</p>
      </div>

      {/* Formula Explorer Modals — senior UX */}
      <FormulaExplorerModal
        isOpen={showPmFormula}
        onClose={()=>setShowPmFormula(false)}
        title="PM Compliance — Weighted Average"
        subtitle="Corporate PM % = total completed across all plants ÷ total planned across all plants"
        formula="PM Compliance % = ( Σ done_p ) / ( Σ planned_p ) × 100"
        variables={[
          { name: 'Total Planned (all plants)', source: 'Σ pmDue', value: totals.totalPlanned ?? visiblePlants.reduce((s,p)=>s+(plantData[p.id]?.kpi.pmDue||0),0), unit: '' },
          { name: 'Total Completed (all plants)', source: 'Σ pmCompleted', value: totals.totalDone ?? visiblePlants.reduce((s,p)=>s+(plantData[p.id]?.kpi.pmCompleted||0),0), unit: '' },
          { name: 'Weighted Compliance', source: 'computed', value: `${totals.avgCompliance}%`, unit: '' },
          ...visiblePlants.map(p=>({ name: `${p.plant_code} — done/planned`, source: `${p.plant_code}`, value: `${plantData[p.id]?.kpi.pmCompleted||0}/${plantData[p.id]?.kpi.pmDue||0} = ${plantData[p.id]?.kpi.pmCompliance||0}%`, unit: '' })),
        ]}
        steps={[
          `Per plant: pmCompliance_p = done_p / planned_p × 100 (e.g. NATHUPUR ${plantData[visiblePlants[0]?.id]?.kpi.pmCompliance||0}%)`,
          `Corporate weighted: Σ done = ${totals.totalDone}, Σ planned = ${totals.totalPlanned}`,
          `Weighted = ${totals.totalDone} / ${totals.totalPlanned} × 100 = ${totals.avgCompliance}%`,
          `Fixes previous bug: simple average of percentages (e.g. (90+0)/2=45%) is wrong when Plant 2 has 0 planned — weighted correctly gives ${totals.avgCompliance}%`,
        ]}
        result={`${totals.avgCompliance}%`}
        resultLabel="Corporate Weighted PM Compliance"
      />
      <FormulaExplorerModal
        isOpen={showAvailFormula}
        onClose={()=>setShowAvailFormula(false)}
        title="Availability — Weighted by Machines"
        subtitle="Availability = (total operating hours − total downtime) / total operating hours"
        formula="Availability % = ( Σ machines × 720 − Σ downtime ) / ( Σ machines × 720 ) × 100"
        variables={[
          { name: 'Total Machines', source: 'Σ machines', value: totals.allMachines, unit: '' },
          { name: 'Total Downtime', source: 'Σ downtimeHours', value: `${totals.allBDHours} hrs`, unit: '' },
          { name: 'Total Operating Hours', source: 'machines × 720', value: `${totals.allMachines * 720} hrs`, unit: '' },
          { name: 'Weighted Availability', source: 'computed', value: `${totals.avgAvail}%`, unit: '' },
        ]}
        steps={[
          `Total operating = ${totals.allMachines} machines × 720 hrs = ${totals.allMachines*720} hrs`,
          `Availability = (${totals.allMachines*720} − ${totals.allBDHours}) / ${totals.allMachines*720} × 100 = ${totals.avgAvail}%`,
          `Per-plant availability is weighted by its machine count, not simple average`,
        ]}
        result={`${totals.avgAvail}%`}
        resultLabel="Corporate Weighted Availability"
      />
      <FormulaExplorerModal
        isOpen={showEnergyFormula}
        onClose={()=>setShowEnergyFormula(false)}
        title="Energy — Plant-Isolated Totals"
        subtitle="Each plant’s energy is Σ kWh for that plant only; corporate total = Σ plants"
        formula="Energy_p = Σ (kwh_p)   ;   Corporate = Σ Energy_p"
        variables={[
          ...visiblePlants.map(p=>({ name: `${p.plant_code} energy`, source: `${p.plant_code}`, value: `${(plantData[p.id]?.energyTotal||0).toLocaleString()} kWh`, unit: '' })),
          { name: 'Corporate Total', source: 'Σ Energy_p', value: `${totals.totalEnergy.toLocaleString()} kWh`, unit: '' },
          { name: 'Note', source: 'isolation', value: totals.totalEnergy>0 && visiblePlants.some(p=> (plantData[p.id]?.energyTotal||0)===0) ? 'Plant 2/3 shows 0 until they upload — not duplicated from NATHUPUR' : 'Plant-isolated via plant_id', unit: '' },
        ]}
        steps={[
          `Per plant: Energy_p = sum of kwh where plant_id = p (NATHUPUR ${ (plantData[visiblePlants.find(p=>p.plant_code==='NATHUPUR')?.id]?.energyTotal||0).toLocaleString()} kWh, others 0 until upload)`,
          `Corporate total = sum across plants = ${totals.totalEnergy.toLocaleString()} kWh`,
          `Data is plant-isolated; Plant 2/3 do NOT duplicate NATHUPUR — they show No data until uploaded for that plant`,
        ]}
        result={`${totals.totalEnergy.toLocaleString()} kWh`}
        resultLabel="Corporate Energy Total"
      />
    </div>
  );
}
