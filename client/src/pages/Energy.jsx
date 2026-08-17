import { useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addEnergyLog, deleteEnergyLog, updateEnergyLog } from '../store.js';
import { monthlyEnergy, monthlyEnergyOverview, monthKey } from '../analytics.js';
import { ChartCard, TrendChart, PieDonutChart, GroupedBarChart } from '../components/AnalyticsCharts.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import { SECTION_METERS } from '../constants.js';
import SectionSelect from '../components/SectionSelect.jsx';
import {
  Zap, Plus, Pencil, Trash2, Download, AlertCircle, Sun, Fuel,
  PlugZap, FolderOpen, Upload, X, BarChart3, Grid2x2,
} from 'lucide-react';

const SOURCES = ['DG 500 kVA', 'DG 380 kVA', 'Solar Generation', 'Grid / HT Supply', 'Plant SEC'];
const SOURCE_COLORS = {
  'DG 500 kVA': '#F59E0B', 'DG 380 kVA': '#FB923C', 'Solar Generation': '#10B981',
  'Grid / HT Supply': '#06B6D4', 'Plant SEC': '#8B5CF6',
};

// ── Inline edit modal ────────────────────────────────────────────────────────
function EditEnergyModal({ row, userName, onClose }) {
  const [form, setForm] = useState({
    date: row.date ? String(row.date).slice(0, 10) : '',
    source: row.source || SOURCES[0],
    kwh: String(row.kwh ?? ''),
    fuelConsumedLitres: String(row.fuelConsumedLitres ?? ''),
    solarGenerationKwh: String(row.solarGenerationKwh ?? ''),
    dg500RunHours: String(row.dg500RunHours ?? ''),
    dg380RunHours: String(row.dg380RunHours ?? ''),
    plantSection: row.plantSection || '',
    remarks: row.remarks || '',
  });
  const overlayRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = (e) => {
    e.preventDefault();
    updateEnergyLog(row.id, form, userName);
    onClose();
  };

  const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog" aria-modal="true" aria-label="Edit energy record"
    >
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-card-title">Edit Energy Log</h3>
            <p className="text-meta mt-0.5">{new Date(row.date).toLocaleDateString('en-GB')} · {row.source || row.plantSection || 'Energy Log'}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X size={16} /></button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={form.date} onChange={set('date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Source</label>
              <select value={form.source} onChange={set('source')} className={inputCls}>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>kWh</label>
              <input type="number" min="0" step="0.01" value={form.kwh} onChange={set('kwh')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Fuel (L)</label>
              <input type="number" min="0" step="0.01" value={form.fuelConsumedLitres} onChange={set('fuelConsumedLitres')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Solar (kWh)</label>
              <input type="number" min="0" step="0.01" value={form.solarGenerationKwh} onChange={set('solarGenerationKwh')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>DG 500 Run Hrs</label>
              <input type="number" min="0" step="0.1" value={form.dg500RunHours} onChange={set('dg500RunHours')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>DG 380 Run Hrs</label>
              <input type="number" min="0" step="0.1" value={form.dg380RunHours} onChange={set('dg380RunHours')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Plant Section</label>
              <SectionSelect value={form.plantSection} onChange={(v) => set('plantSection')({ target: { value: v } })} showAddNew={false} />
            </div>
          </div>
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

export default function Energy() {
  const { user } = useAuth();
  const { openUpload } = useUI();
  const navigate = useNavigate();
  const store = useStore();
  const { energy } = store;
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), source: SOURCES[0], kwh: '', remarks: '' });
  const [error, setError] = useState('');
  const [sourceF, setSourceF] = useState('');
  const [editing, setEditing] = useState(null);

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const currentMK = monthKey(new Date());
    const todayRows  = energy.filter((e) => (e.date || '').slice(0, 10) === todayStr);
    const monthRows  = energy.filter((e) => monthKey(e.date || e.createdAt) === currentMK);

    // ── Dual UHBVNL grid ──────────────────────────────────────────────────
    const unit1KwhMonth  = Math.round(monthRows.reduce((s, e) => s + (e.uhbvnlUnit1Kwh || 0), 0));
    const unit2KwhMonth  = Math.round(monthRows.reduce((s, e) => s + (e.uhbvnlUnit2Kwh || 0), 0));
    const totalGridMonth = Math.round(monthRows.reduce((s, e) => s + (e.totalGridKwh || 0), 0)) || (unit1KwhMonth + unit2KwhMonth);

    // ── DG generators ─────────────────────────────────────────────────────
    const dg500HrsMonth  = Math.round(monthRows.reduce((s, e) => s + (e.dg500RunHours || 0), 0) * 10) / 10;
    const dg380HrsMonth  = Math.round(monthRows.reduce((s, e) => s + (e.dg380RunHours || 0), 0) * 10) / 10;
    const fuelMonth      = Math.round(monthRows.reduce((s, e) => s + (e.fuelConsumedLitres || 0), 0));
    const fuelToday      = Math.round(todayRows.reduce((s, e) => s + (e.fuelConsumedLitres || 0), 0));

    // ── Solar ─────────────────────────────────────────────────────────────
    const solarMonth     = Math.round(monthRows.reduce((s, e) => s + (e.solarGenerationKwh || 0), 0));
    const totalKwhMonth  = Math.round(monthRows.reduce((s, e) => s + (e.totalKwh || e.kwh || 0), 0));

    // ── Overall totals (all-time) ─────────────────────────────────────────
    const totalLogged    = Math.round(energy.reduce((s, e) => s + (e.totalKwh || e.kwh || 0), 0));
    const totalSolar     = Math.round(energy.reduce((s, e) => s + (e.solarGenerationKwh || 0), 0));
    const solarShare     = totalLogged ? Math.round((totalSolar / totalLogged) * 100) : 0;

    // ── Pie chart by source ───────────────────────────────────────────────
    const bySource = {};
    energy.forEach((e) => {
      const label = e.source || (e.plantSection ? 'Bulk Energy Import' : 'Unspecified');
      bySource[label] = (bySource[label] || 0) + (e.solarGenerationKwh || e.kwh || 0);
    });
    const pie = Object.entries(bySource).map(([label, value]) => ({
      label, value: Math.round(value), color: SOURCE_COLORS[label],
    }));

    // ── Grid unit pie ─────────────────────────────────────────────────────
    const gridPie = [
      { label: 'UHBVNL Unit 1', value: unit1KwhMonth, color: '#06B6D4' },
      { label: 'UHBVNL Unit 2', value: unit2KwhMonth, color: '#8B5CF6' },
    ].filter((d) => d.value > 0);

    // ── DG split grouped bar (last 6 months) ─────────────────────────────
    const dgTrend = monthlyEnergyOverview(energy, 6).map((m) => ({
      label: m.label,
      'DG 500 kVA': m.dg500RunHours || 0,
      'DG 380 kVA': m.dg380RunHours || 0,
    }));

    // ── Section sub-meter totals (month) ──────────────────────────────────
    const sectionTotals = {};
    SECTION_METERS.forEach(({ key }) => { sectionTotals[key] = 0; });
    monthRows.forEach((e) => {
      const sc = e.sectionConsumption || {};
      SECTION_METERS.forEach(({ key }) => {
        sectionTotals[key] += Number(sc[key] || 0);
      });
    });

    return {
      fuelToday,
      unit1KwhMonth, unit2KwhMonth, totalGridMonth,
      dg500HrsMonth, dg380HrsMonth, fuelMonth, solarMonth,
      totalKwhMonth, totalLogged, solarShare,
      pie, gridPie, dgTrend, sectionTotals,
      trend:    monthlyEnergy(energy),
      overview: monthlyEnergyOverview(energy),
    };
  }, [energy]);

  const rows = useMemo(
    () => energy.filter((e) => !sourceF || e.source === sourceF),
    [energy, sourceF]
  );

  const submit = (e) => {
    e.preventDefault();
    if (!form.date || !form.kwh || Number(form.kwh) <= 0) {
      setError('Date and a positive kWh reading are required');
      return;
    }
    setError('');
    addEnergyLog(form, userName);
    setForm((f) => ({ ...f, kwh: '', remarks: '' }));
  };

  const handleExport = () =>
    exportToCSV(
      rows,
      [
        { label: 'Date', value: (r) => new Date(r.date).toLocaleDateString('en-GB') },
        { key: 'source', label: 'Source' },
        { key: 'uhbvnlUnit1Kwh', label: 'Unit 1 kWh' },
        { key: 'uhbvnlUnit2Kwh', label: 'Unit 2 kWh' },
        { key: 'totalGridKwh', label: 'Total Grid kWh' },
        { key: 'solarGenerationKwh', label: 'Solar (kWh)' },
        { key: 'dg500RunHours', label: 'DG 500 Hrs' },
        { key: 'dg380RunHours', label: 'DG 380 Hrs' },
        { key: 'fuelConsumedLitres', label: 'Fuel (L)' },
        { key: 'totalKwh', label: 'Total kWh' },
        { key: 'plantSec', label: 'SEC (kWh/MT)' },
        { key: 'plantSection', label: 'Plant Section' },
        { key: 'remarks', label: 'Remarks' },
      ],
      'energy-log.csv'
    );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <Zap size={28} className="text-amber-400" aria-hidden="true" />
            Energy Management
          </h2>
          <p className="text-body mt-1.5">DG, solar and grid consumption logs — dashboard KPIs and trends update instantly</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap">
            <Download size={13} aria-hidden="true" /> Export CSV
          </button>
          {isAdmin && (
            <button onClick={() => openUpload({ kind: 'bulk', module: 'energy' })} className="btn-success inline-flex items-center gap-2 text-xs whitespace-nowrap">
              <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
            </button>
          )}
          <button
            onClick={() => navigate('/category/' + encodeURIComponent('Plantwise Energy Consumption'))}
            className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap"
          >
            <FolderOpen size={13} aria-hidden="true" /> Energy Documents
          </button>
        </div>
      </div>

      {/* ── Row 1: UHBVNL Dual-Unit Grid ── */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Grid2x2 size={15} className="text-cyan-400" aria-hidden="true" />
          <h3 className="text-card-title">UHBVNL Grid Import — This Month</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Unit 1 */}
          <div className="rounded-control bg-cyan-500/[0.07] border border-cyan-500/20 p-4">
            <p className="text-slate-400 text-[11px] uppercase tracking-wider mb-1.5">Unit 1 (Col H / KWh_I)</p>
            <p className="text-white text-2xl font-bold tabular-nums">{stats.unit1KwhMonth.toLocaleString()}</p>
            <p className="text-cyan-400 text-xs mt-0.5">kWh</p>
          </div>
          {/* Unit 2 */}
          <div className="rounded-control bg-violet-500/[0.07] border border-violet-500/20 p-4">
            <p className="text-slate-400 text-[11px] uppercase tracking-wider mb-1.5">Unit 2 (Col U / KWh_I 10)</p>
            <p className="text-white text-2xl font-bold tabular-nums">{stats.unit2KwhMonth.toLocaleString()}</p>
            <p className="text-violet-400 text-xs mt-0.5">kWh</p>
          </div>
          {/* Combined */}
          <div className="rounded-control bg-white/[0.04] border border-white/[0.10] p-4 flex flex-col justify-between">
            <p className="text-slate-400 text-[11px] uppercase tracking-wider mb-1.5">Total Grid (Unit 1 + 2)</p>
            <p className="text-white text-2xl font-bold tabular-nums">{stats.totalGridMonth.toLocaleString()}</p>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: stats.totalGridMonth ? `${Math.round((stats.unit1KwhMonth / stats.totalGridMonth) * 100)}%` : '50%' }} />
              </div>
              <span className="text-slate-500 text-[10px] whitespace-nowrap">
                U1 {stats.totalGridMonth ? Math.round((stats.unit1KwhMonth / stats.totalGridMonth) * 100) : 0}% / U2 {stats.totalGridMonth ? Math.round((stats.unit2KwhMonth / stats.totalGridMonth) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
        {/* Mini grid pie if data exists */}
        {stats.gridPie.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <ChartCard title="Grid Unit Split" subtitle="Unit 1 vs Unit 2 this month" empty={false} height={180}>
              <PieDonutChart data={stats.gridPie} donut centerLabel={`${stats.totalGridMonth.toLocaleString()}`} centerSub="kWh grid" />
            </ChartCard>
            <ChartCard title="Monthly Energy Trend" subtitle="Total kWh · last 6 months" empty={!energy.length} height={180}>
              <TrendChart data={stats.trend} dataKey="kwh" color="#F59E0B" unit=" kWh" />
            </ChartCard>
          </div>
        )}
      </div>

      {/* ── Row 2: DG 500 kVA vs 380 kVA ── */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={15} className="text-amber-400" aria-hidden="true" />
          <h3 className="text-card-title">DG Backup Generators — This Month</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'DG 500 kVA Run Hrs', value: stats.dg500HrsMonth, unit: 'hrs', color: 'text-amber-300', bg: 'bg-amber-500/[0.07] border-amber-500/20' },
            { label: 'DG 380 kVA Run Hrs', value: stats.dg380HrsMonth, unit: 'hrs', color: 'text-orange-300', bg: 'bg-orange-500/[0.07] border-orange-500/20' },
            { label: 'Total DG Run Hrs',   value: Math.round((stats.dg500HrsMonth + stats.dg380HrsMonth) * 10) / 10, unit: 'hrs', color: 'text-yellow-300', bg: 'bg-yellow-500/[0.07] border-yellow-500/20' },
            { label: 'Fuel Consumed',      value: stats.fuelMonth.toLocaleString(), unit: 'Ltrs', color: 'text-red-300', bg: 'bg-red-500/[0.07] border-red-500/20' },
          ].map((k) => (
            <div key={k.label} className={`rounded-control border p-4 ${k.bg}`}>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5 leading-tight">{k.label}</p>
              <p className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</p>
              <p className="text-slate-500 text-xs mt-0.5">{k.unit}</p>
            </div>
          ))}
        </div>
        <ChartCard title="DG Run Hours Split — Last 6 Months" subtitle="DG 500 kVA vs DG 380 kVA" empty={!energy.length} height={200}>
          <GroupedBarChart
            data={stats.dgTrend}
            bars={[
              { dataKey: 'DG 500 kVA', name: 'DG 500 kVA (hrs)', color: '#F59E0B' },
              { dataKey: 'DG 380 kVA', name: 'DG 380 kVA (hrs)', color: '#FB923C' },
            ]}
          />
        </ChartCard>
      </div>

      {/* ── Row 3: Solar + Source pie ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="glass-card p-4 flex items-center gap-3">
          <Sun size={18} className="text-emerald-400" aria-hidden="true" />
          <div>
            <p className="text-white text-xl font-bold tabular-nums">{stats.solarMonth.toLocaleString()} kWh</p>
            <p className="text-slate-500 text-[10px]">Solar Generation This Month</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <PlugZap size={18} className="text-orange-400" aria-hidden="true" />
          <div>
            <p className="text-white text-xl font-bold tabular-nums">{stats.solarShare}%</p>
            <p className="text-slate-500 text-[10px]">Solar Share of Total Consumption</p>
          </div>
        </div>
      </div>

      {/* ── Row 4: Section sub-meter + Consumption-by-source pie ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Section sub-meter table */}
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <h3 className="text-card-title flex items-center gap-2">
              <BarChart3 size={14} className="text-cyan-400" aria-hidden="true" />
              Section Sub-Meter Consumption
            </h3>
            <p className="text-meta mt-0.5">Plant-wise kWh this month from sub-meters</p>
          </div>
          {SECTION_METERS.every(({ key }) => !stats.sectionTotals[key]) ? (
            <div className="p-5">
              <EmptyState
                title="No sub-meter data"
                description="Upload the Plantwise Monitoring Report to populate section-wise consumption."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>kWh This Month</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const total = SECTION_METERS.reduce((s, { key }) => s + (stats.sectionTotals[key] || 0), 0) || 1;
                    return SECTION_METERS.map(({ key, label }) => {
                      const val = Math.round(stats.sectionTotals[key] || 0);
                      const pct = Math.round((val / total) * 100);
                      return (
                        <tr key={key}>
                          <td className="text-white font-medium">{label}</td>
                          <td className="text-amber-300 font-semibold tabular-nums">{val.toLocaleString()}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                                <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-slate-400 text-[11px]">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Source pie */}
        <ChartCard title="Consumption by Source" subtitle="Lifetime split across DG / solar / grid" empty={!energy.length}>
          <PieDonutChart data={stats.pie} donut centerLabel={`${stats.solarShare}%`} centerSub="Solar" />
        </ChartCard>
      </div>

      {/* Quick log entry */}
      {isAdmin && (
        <div className="glass-card p-5">
          <h3 className="text-card-title mb-4">Log Energy Reading</h3>
          <form onSubmit={submit} className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <input type="date" className="input-field" value={form.date} onChange={set('date')} aria-label="Reading date" />
            <select className="select-field" value={form.source} onChange={set('source')} aria-label="Energy source">
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" min="0" step="0.1" className="input-field" placeholder="kWh *" value={form.kwh} onChange={set('kwh')} aria-label="kWh reading" />
            <input type="text" className="input-field" placeholder="Remarks" value={form.remarks} onChange={set('remarks')} aria-label="Remarks" />
            <button type="submit" className="btn-success text-xs inline-flex items-center justify-center gap-1.5">
              <Plus size={13} aria-hidden="true" /> Add Reading
            </button>
          </form>
          {error && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}
        </div>
      )}

      {/* Log table */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-card-title">Consumption Log</h3>
          <select className="select-field !w-auto text-xs" value={sourceF} onChange={(e) => setSourceF(e.target.value)} aria-label="Filter by source">
            <option value="">All Sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No energy readings" description="Log daily DG, solar and grid readings — the dashboard energy KPI and trend chart update automatically." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="enterprise-table w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source / Section</th>
                  <th className="text-cyan-400">Unit 1 kWh</th>
                  <th className="text-violet-400">Unit 2 kWh</th>
                  <th>Total Grid kWh</th>
                  <th className="text-emerald-400">Solar kWh</th>
                  <th className="text-amber-400">DG 500 Hrs</th>
                  <th className="text-orange-400">DG 380 Hrs</th>
                  <th>Fuel (L)</th>
                  <th>Total kWh</th>
                  {isAdmin && <th className="w-20 text-right" aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{new Date(r.date).toLocaleDateString('en-GB')}</td>
                    <td>
                      <span className="badge border truncate max-w-[140px]" style={{ color: SOURCE_COLORS[r.source] || '#10B981', borderColor: `${SOURCE_COLORS[r.source] || '#10B981'}40`, backgroundColor: `${SOURCE_COLORS[r.source] || '#10B981'}14` }}>
                        {r.source || (r.plantSection ? r.plantSection : 'Energy Log')}
                      </span>
                    </td>
                    <td className="text-cyan-300 tabular-nums">{r.uhbvnlUnit1Kwh ? r.uhbvnlUnit1Kwh.toLocaleString() : '—'}</td>
                    <td className="text-violet-300 tabular-nums">{r.uhbvnlUnit2Kwh ? r.uhbvnlUnit2Kwh.toLocaleString() : '—'}</td>
                    <td className="text-slate-200 font-semibold tabular-nums">{r.totalGridKwh ? r.totalGridKwh.toLocaleString() : '—'}</td>
                    <td className="text-emerald-300 tabular-nums">{r.solarGenerationKwh ? r.solarGenerationKwh.toLocaleString() : '—'}</td>
                    <td className="text-amber-300 tabular-nums">{r.dg500RunHours || '—'}</td>
                    <td className="text-orange-300 tabular-nums">{r.dg380RunHours || '—'}</td>
                    <td className="text-red-300 tabular-nums">{r.fuelConsumedLitres || '—'}</td>
                    <td className="text-white font-bold tabular-nums">{(r.totalKwh || r.kwh || 0).toLocaleString()}</td>
                    {isAdmin && (
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setEditing(r)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit reading">
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          <button onClick={() => deleteEnergyLog(r.id, userName)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete reading">
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && isAdmin && (
        <EditEnergyModal row={editing} userName={userName} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
