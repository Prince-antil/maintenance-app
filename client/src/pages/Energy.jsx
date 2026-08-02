import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, addEnergyLog, deleteEnergyLog } from '../store.js';
import { monthlyEnergy, monthlyEnergyOverview, monthKey } from '../analytics.js';
import { ChartCard, TrendChart, PieDonutChart } from '../components/AnalyticsCharts.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import {
  Zap, Plus, Trash2, Download, AlertCircle, Sun, Fuel, PlugZap, FolderOpen, Upload,
} from 'lucide-react';

const SOURCES = ['DG 500 kVA', 'DG 380 kVA', 'Solar Generation', 'Grid / HT Supply', 'Plant SEC'];
const SOURCE_COLORS = {
  'DG 500 kVA': '#F59E0B', 'DG 380 kVA': '#FB923C', 'Solar Generation': '#10B981',
  'Grid / HT Supply': '#06B6D4', 'Plant SEC': '#8B5CF6',
};

export default function Energy() {
  const { user } = useAuth();
  const { openUpload } = useUI();
  const navigate = useNavigate();
  const store = useStore();
  const { energy } = store;
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), source: SOURCES[0], kwh: '', remarks: '' });
  const [error, setError] = useState('');
  const [sourceF, setSourceF] = useState('');

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const stats = useMemo(() => {
    const today = energy.filter((e) => (e.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10));
    const month = energy.filter((e) => monthKey(e.date || e.createdAt) === monthKey(new Date()));
    const bySource = {};
    energy.forEach((e) => {
      const label = e.source || (e.plantSection ? 'Bulk Energy Import' : 'Unspecified');
      bySource[label] = (bySource[label] || 0) + (e.solarGenerationKwh || e.kwh || 0);
    });
    const overview = monthlyEnergyOverview(energy);
    return {
      today: Math.round(today.reduce((s, e) => s + (e.fuelConsumedLitres || 0), 0)),
      month: Math.round(month.reduce((s, e) => s + (e.solarGenerationKwh || e.kwh || 0), 0)),
      total: Math.round(energy.reduce((s, e) => s + (e.solarGenerationKwh || e.kwh || 0), 0)),
      solarShare: (() => {
        const total = energy.reduce((s, e) => s + (e.solarGenerationKwh || e.kwh || 0), 0);
        const solar = energy.reduce((s, e) => s + (e.solarGenerationKwh || (e.source === 'Solar Generation' ? e.kwh : 0) || 0), 0);
        return total ? Math.round((solar / total) * 100) : 0;
      })(),
      pie: Object.entries(bySource).map(([label, value]) => ({ label, value: Math.round(value), color: SOURCE_COLORS[label] })),
      trend: monthlyEnergy(energy),
      overview,
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
        { key: 'kwh', label: 'kWh' },
        { key: 'fuelConsumedLitres', label: 'Fuel (L)' },
        { key: 'solarGenerationKwh', label: 'Solar (kWh)' },
        { label: 'DG Run Hours', value: (r) => (r.dg500RunHours || 0) + (r.dg380RunHours || 0) },
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

      {/* Live energy KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Fuel, label: 'Fuel Today', value: `${stats.today.toLocaleString()} L`, cls: 'text-amber-400' },
          { icon: Zap, label: 'Solar This Month', value: `${stats.month.toLocaleString()} kWh`, cls: 'text-cyan-400' },
          { icon: PlugZap, label: 'Total Logged', value: `${stats.total.toLocaleString()} kWh`, cls: 'text-orange-400' },
          { icon: Sun, label: 'Solar Share', value: `${stats.solarShare}%`, cls: 'text-emerald-400' },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="glass-card p-4 flex items-center gap-3">
              <Icon size={18} className={k.cls} aria-hidden="true" />
              <div>
                <p className="text-white text-base font-bold leading-tight">{k.value}</p>
                <p className="text-slate-500 text-[10px]">{k.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Monthly Energy Consumption" subtitle="Total kWh · last 6 months" empty={!energy.length}>
          <TrendChart data={stats.trend} dataKey="kwh" color="#F59E0B" unit=" kWh" />
        </ChartCard>
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
            <table className="enterprise-table w-full min-w-[560px]">
              <thead>
                <tr><th>Date</th><th>Source</th><th>kWh</th><th>Remarks</th>{isAdmin && <th className="w-12 text-right" aria-label="Actions" />}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{new Date(r.date).toLocaleDateString('en-GB')}</td>
                    <td>
                      <span className="badge border" style={{ color: SOURCE_COLORS[r.source] || '#10B981', borderColor: `${SOURCE_COLORS[r.source] || '#10B981'}40`, backgroundColor: `${SOURCE_COLORS[r.source] || '#10B981'}14` }}>
                        {r.source || (r.plantSection ? 'Bulk Entry' : 'Energy Log')}
                      </span>
                    </td>
                    <td className="text-white font-semibold">{(r.solarGenerationKwh || r.kwh || 0).toLocaleString()}</td>
                    <td className="text-slate-400">{r.remarks || `${r.plantSection || '—'} · Fuel ${r.fuelConsumedLitres || 0} L · DG ${((r.dg500RunHours || 0) + (r.dg380RunHours || 0)).toFixed(1)} h`}</td>
                    {isAdmin && (
                      <td className="text-right">
                        <button onClick={() => deleteEnergyLog(r.id, userName)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete reading">
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
