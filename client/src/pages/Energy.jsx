import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import {
  useStore,
  addDailyUtilityLog, updateDailyUtilityLog, deleteDailyUtilityLog, purgeDailyUtilityLog,
  addMonthlyHerbicide, updateMonthlyHerbicide, deleteMonthlyHerbicide, purgeMonthlyHerbicide,
  addMonthlyInsecticide, updateMonthlyInsecticide, deleteMonthlyInsecticide, purgeMonthlyInsecticide,
  addMonthlyWater, updateMonthlyWater, deleteMonthlyWater, purgeMonthlyWater,
  addMonthlyAirCompressor, updateMonthlyAirCompressor, deleteMonthlyAirCompressor, purgeMonthlyAirCompressor,
  addDailySolarGeneration, updateDailySolarGeneration, deleteDailySolarGeneration, purgeDailySolarGeneration,
  upsertEnergySettings,
} from '../store.js';
import { 
  computeRenewableSummary, 
  computeDailyDeltas, 
  formatPowerFactor, 
  computeWeightedPf,
  computeEnergySummaryFromRows,
  computeDynamicPowerFactors,
  computeEnergySnapshot,
  computeEnergySummaryFromRows as computeEnergySummary
} from '../analytics.js';
import { 
  processUtilityRow, 
  processSolarRow 
} from '../lib/energyEngine.js';
import { 
  getSolarDerived, 
  processSolarRowForSave, 
  computeSolarSummary,
  getCurrentMonthSolarTotal,
  formatEnergy,
  getUtilityDerived,
  computeUtilitySummary,
  getCurrentMonthUtilityTotals,
  formatPowerFactor as formatPf,
  formatEnergy as formatEnergyUtil
} from '../lib/energyCalculations.js';
import { useEnergyCache, memoizedAggregations } from '../hooks/useEnergyCache.js';
import { downloadTemplate } from '../bulkImport.js';
import EmptyState from '../components/EmptyState.jsx';
import {
  Zap, Sun, Droplets, Wind, Settings, Download, Upload, Plus, Trash2, Pencil, AlertTriangle,
  Calendar, ChevronLeft, ChevronRight, TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';

const PAGE_SIZE = 12;
const C = { grid: '#06B6D4', solar: '#10B981', dg500: '#F59E0B', dg380: '#FB923C' };
const TABS = [
  { key: 'dailyUtility', label: 'Daily Utility', icon: Zap },
  { key: 'herbicide', label: 'Herbicide', icon: Sun },
  { key: 'insecticide', label: 'Insecticide', icon: Zap },
  { key: 'water', label: 'Water', icon: Droplets },
  { key: 'airCompressor', label: 'Air Compressor', icon: Wind },
  { key: 'solar', label: 'Solar', icon: Sun },
  { key: 'renewable', label: 'Renewable', icon: TrendingUp },
  { key: 'settings', label: 'Settings', icon: Settings },
];
const r1 = (n) => Math.round(n * 10) / 10;
const toN = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const mk = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const dateInRange = (d, f, t) => { if (!d) return false; if (f && d < f) return false; if (t && d > t) return false; return true; };
const monthInRange = (m, f, t) => { if (!m) return false; if (f && m < f.slice(0, 7)) return false; if (t && m > t.slice(0, 7)) return false; return true; };
const FILTER_PRESETS = [
  { label: 'This Month', get: () => { const d = new Date(); return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: new Date().toISOString().slice(0, 10) }; } },
  { label: 'Last Month', get: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}` }; } },
  { label: 'Last 6 Months', get: () => { const t = new Date(); const f = new Date(); f.setMonth(f.getMonth() - 5); f.setDate(1); return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) }; } },
  { label: 'Last 12 Months', get: () => { const t = new Date(); const f = new Date(); f.setMonth(f.getMonth() - 11); f.setDate(1); return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) }; } },
  { label: 'All', get: () => ({ from: '', to: '' }) },
];
const FEEDER_KEYS_INSECT = [
  'feeder2ScElectricRoomMeterReading', 'feeder3WaterbathMeterReading', 'feeder4JetmillMeterReading',
  'feeder5CartapPlantMeterReading', 'feeder6EcFormulationMeterReading', 'feeder7SpareMeterReading',
  'feeder8EcPackingMeterReading', 'feeder9AdminBlockMeterReading', 'acmInsecticideMeterReading',
  'airCompressor02IrMeterReading', 'airCompressor03AtlasMeterReading', 'airCompressor01IrAtlasMeterReading',
];
const FEEDER_LABELS_INSECT = ['F2 Elec Room', 'F3 Waterbath', 'F4 Jetmill', 'F5 Cartap', 'F6 EC Form', 'F7 Spare', 'F8 EC Pack', 'F9 Admin', 'ACM', 'Comp 02 IR', 'Comp 03 Atlas', 'Comp 01 IR Atlas'];
const TTIP = { contentStyle: { backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px', color: '#e2e8f0' } };
const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
const lblCls = 'block text-xs text-slate-400 mb-1';
const nf = (key, label, step) => ({ key, label, type: 'number', step: step || '0.1' });

function KpiCard({ label, value, unit, color = 'text-white', bg = 'bg-white/[0.04] border-white/[0.10]' }) {
  return (
    <div className={`rounded-control border p-4 ${bg}`}>
      <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5 leading-tight">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {unit && <p className="text-slate-500 text-xs mt-0.5">{unit}</p>}
    </div>
  );
}

function Pagination({ page, total, onChange }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
      <span className="text-xs text-slate-500">
        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page === 0} className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"><ChevronLeft size={12} /></button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let p = i;
          if (totalPages > 5) { if (page < 3) p = i; else if (page > totalPages - 4) p = totalPages - 5 + i; else p = page - 2 + i; }
          return <button key={p} onClick={() => onChange(p)} className={`text-xs px-2 py-1 rounded ${p === page ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white'}`}>{p + 1}</button>;
        })}
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1} className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"><ChevronRight size={12} /></button>
      </div>
    </div>
  );
}

function FormModal({ title, subtitle, fields, values, onChange, onSave, onClose }) {
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div><h3 className="text-card-title">{title}</h3>{subtitle && <p className="text-meta mt-0.5">{subtitle}</p>}</div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><Pencil size={16} className="rotate-45" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.full ? 'col-span-2' : ''}>
                <label className={lblCls}>{f.label}{f.required && ' *'}</label>
                <input type={f.type === 'number' ? 'number' : f.type} min={f.type === 'number' ? '0' : undefined}
                  step={f.step || (f.type === 'number' ? '0.1' : undefined)}
                  value={values[f.key] || ''} onChange={(e) => onChange(f.key, e.target.value)}
                  className={inputCls} placeholder={f.placeholder || ''} />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button type="submit" className="btn-primary text-xs">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TblHead({ columns, admin }) {
  return <thead><tr>{columns.map((c) => <th key={c.key} className={c.className || ''}>{c.label}</th>)}{admin && <th className="w-20 text-right" aria-label="Actions" />}</tr></thead>;
}

function Td({ value, className }) {
  if (value === null || value === undefined || value === '') return <td className="text-slate-600">—</td>;
  return <td className={className || 'text-white tabular-nums'}>{typeof value === 'number' ? value.toLocaleString() : value}</td>;
}

function Acts({ onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {onEdit && <button onClick={onEdit} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit"><Pencil size={13} /></button>}
      {onDelete && <button onClick={onDelete} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete"><Trash2 size={13} /></button>}
    </div>
  );
}

function ChartCard({ title, children, className = '' }) {
  return <div className={`glass-card p-5 ${className}`}><h4 className="text-card-title text-sm mb-4">{title}</h4>{children}</div>;
}

function Toolbar({ isAdmin, onAdd, onUpload, onDownload, label }) {
  if (!isAdmin) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={onAdd} className="btn-primary inline-flex items-center gap-1.5 text-xs"><Plus size={13} /> Add {label}</button>
      <button onClick={onUpload} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Upload size={13} /> Upload Excel</button>
      <button onClick={onDownload} className="btn-ghost inline-flex items-center gap-1.5 text-xs"><Download size={13} /> Download Template</button>
    </div>
  );
}

function PurgeModal({ domain, totalRecords, periodLabel, onPurgePeriod, onPurgeAll, onClose, loading }) {
  const [phase, setPhase] = useState('choose');
  const [periodCount, setPeriodCount] = useState(null);
  const [allCount, setAllCount] = useState(null);
  const [purging, setPurging] = useState(false);

  const doPurgePeriod = async () => { setPurging(true); try { await onPurgePeriod(); } finally { setPurging(false); } };
  const doPurgeAll = async () => { setPurging(true); try { await onPurgeAll(); } finally { setPurging(false); } };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !purging && onClose()} role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-md p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-red-500/10"><AlertTriangle size={18} className="text-red-400" /></div>
          <div>
            <h4 className="text-sm font-semibold text-white">Purge {domain} Data</h4>
            <p className="text-xs text-slate-400 mt-0.5">This permanently deletes data from Supabase. Cannot be undone.</p>
          </div>
        </div>
        <div className="space-y-2">
          {periodLabel && (
            <button onClick={doPurgePeriod} disabled={purging} className="w-full text-left px-4 py-3 rounded-control bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors disabled:opacity-50">
              <p className="text-xs font-semibold text-amber-300">Purge Selected Period</p>
              <p className="text-[10px] text-amber-200/60 mt-0.5">{periodLabel}</p>
            </button>
          )}
          <button onClick={doPurgeAll} disabled={purging} className="w-full text-left px-4 py-3 rounded-control bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            <p className="text-xs font-semibold text-red-300">Purge ALL DATA</p>
            <p className="text-[10px] text-red-200/60 mt-0.5">Delete all {totalRecords} records from {domain}</p>
          </button>
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} disabled={purging} className="btn-ghost text-xs">{purging ? 'Purging...' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
}

function DailyUtilityTab({ store, settings, userName, isAdmin, dateFrom, dateTo, registerMonth, setRegisterMonth, monthTabs, onAdd, onEdit, onUpload, formOpen, editRow, formValues, setForm, closeForm, page, setPage, todayStr, currentMK, pushToast }) {
  const formTitle = editRow ? 'Edit Daily Utility' : 'Add Daily Utility';
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';
  const { dailyUtilityLog } = store;
  const sorted = useMemo(() => [...dailyUtilityLog].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [dailyUtilityLog]);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  // Use canonical utility calculations - single source of truth
  const withDerived = useMemo(() => sorted.map((row) => ({ ...row, ...getUtilityDerived(row) })), [sorted]);
  const filteredDerived = useMemo(() => registerMonth ? withDerived.filter((r) => (r.date || '').slice(0, 7) === registerMonth) : withDerived, [withDerived, registerMonth]);
  const pageData = useMemo(() => filteredDerived.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredDerived, page]);

  // KPIs — fully dynamic PF from raw data (no hardcoded fallbacks)
  const kpis = useMemo(() => {
    if (filteredDerived.length === 0) return { grid: '0', dg: '0', solar: '0', pf: '0.00' };
    const summary = computeUtilitySummary(filteredDerived);
    const latest = filteredDerived[0];
    // PF dynamically calculated as ΣkWh/ΣkVAh across filtered period; fallback to latest's PF if summary is 0
    const dynamicPf = summary.avgCombinedPf > 0 ? summary.avgCombinedPf : (latest?.combinedPf || 0);
    return {
      grid: formatEnergy(latest?.gridNet || 0),
      dg: formatEnergy(latest?.dgTotal || 0),
      solar: formatEnergy(latest?.solarTotal || 0),
      pf: dynamicPf > 0 ? (formatPf(dynamicPf) ?? '0.00') : '0.00'
    };
  }, [filteredDerived]);

  // DG Summary using memoized aggregations - sums across filtered period
  const dgSummary = useMemo(() => {
    if (filteredDerived.length === 0) return { dg380Total: 0, dg500Total: 0, totalDg: 0, totalHsd: 0 };
    const totals = memoizedAggregations.dgTotals(filteredDerived);
    return { 
      dg380Total: r1(totals.dg380Total), 
      dg500Total: r1(totals.dg500Total), 
      totalDg: r1(totals.totalDg), 
      totalHsd: r1(totals.totalHsd) 
    };
  }, [filteredDerived]);

  const fields = useMemo(() => [
    { key: 'date', label: 'Date', type: 'date', required: true },
    nf('u1ImportKwhReading', 'U1 Import kWh'), nf('u1ImportKvahReading', 'U1 Import kVAh'),
    nf('u1ExportKwhReading', 'U1 Export kWh'), nf('u1ExportKvahReading', 'U1 Export kVAh'),
    nf('u1SolarKwhReading', 'U1 Solar kWh'), nf('u1SolarKvahReading', 'U1 Solar kVAh'),
    nf('u1Pf', 'U1 PF'),
    nf('u2ImportKwhReading', 'U2 Import kWh'), nf('u2ImportKvahReading', 'U2 Import kVAh'),
    nf('u2ExportKwhReading', 'U2 Export kWh'), nf('u2ExportKvahReading', 'U2 Export kVAh'),
    nf('u2SolarKwhReading', 'U2 Solar kWh'), nf('u2SolarKvahReading', 'U2 Solar kVAh'),
    nf('u2Pf', 'U2 PF'),
    nf('dg380KwhReading', 'DG380 kWh'), nf('dg380HourmeterReading', 'DG380 Hourmeter'),
    nf('dg380HsdOpeningLtr', 'DG380 HSD Opening (L)'), nf('dg380HsdAddedLtr', 'DG380 HSD Added (L)'),
    nf('dg380DefOpeningPct', 'DG380 DEF Opening %'), nf('dg380DefAddedPct', 'DG380 DEF %'),
    nf('dg500KwhReading', 'DG500 kWh'), nf('dg500HourmeterReading', 'DG500 Hourmeter'),
    nf('dg500HsdOpeningLtr', 'DG500 HSD Opening (L)'), nf('dg500HsdAddedLtr', 'DG500 HSD Added (L)'),
    nf('dg500DefOpeningPct', 'DG500 DEF Opening %'), nf('dg500DefAddedPct', 'DG500 DEF %'),
  ], []);

  const handleSave = () => {
    if (!formValues.date) { pushToast({ type: 'error', message: 'Date is required' }); return; }
    const payload = processUtilityRowForSave(formValues);
    if (editRow) updateDailyUtilityLog(editRow.id, payload, userName);
    else addDailyUtilityLog(payload, userName);
    closeForm();
  };

  const cols = [
    { key: 'date', label: 'Date' },
    { key: 'u1ImportKwhReading', label: 'U1 Import kWh' }, { key: 'u1ExportKwhReading', label: 'U1 Export kWh' },
    { key: 'u2ImportKwhReading', label: 'U2 Import kWh' }, { key: 'u2ExportKwhReading', label: 'U2 Export kWh' },
    { key: 'gridNet', label: 'Grid Net kWh', className: 'text-cyan-400' },
    { key: 'solarTotal', label: 'Solar kWh', className: 'text-emerald-400' },
    { key: 'dgTotal', label: 'DG kWh', className: 'text-amber-400' },
    { key: 'totalPlant', label: 'Total kWh', className: 'text-white font-semibold' },
    { key: 'u1Pf', label: 'U1 PF' }, { key: 'u2Pf', label: 'U2 PF' },
    { key: 'combinedPf', label: 'Avg PF', className: 'text-teal-400' },
    { key: 'dg380Hsd', label: 'DG 380 Fuel (L)' }, { key: 'dg500Hsd', label: 'DG 500 Fuel (L)' },
    { key: 'dg380Def', label: 'DG 380 DEF%' }, { key: 'dg500Def', label: 'DG 500 DEF%' },
  ];

  const activeMonth = registerMonth || (monthTabs.length > 0 ? monthTabs[0].key : '');

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* Sidebar */}
      <div className="col-span-12 lg:col-span-3">
        <div className="glass-card p-3">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2 px-1">Select Month</p>
          <div className="max-h-[480px] overflow-y-auto space-y-1 pr-1">
            <button
              onClick={() => { setRegisterMonth(''); setPage(0); }}
              className={`w-full text-left px-3 py-2.5 rounded-control text-xs transition-all flex items-center justify-between gap-2 ${
                !registerMonth
                  ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30 font-semibold'
                  : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <span className="truncate">All Months</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${!registerMonth ? 'bg-cyan-400/20 text-cyan-300' : 'bg-white/[0.06] text-slate-500'}`}>
                {dailyUtilityLog.length}
              </span>
            </button>
            {monthTabs.map((tab) => {
              const [y, m] = tab.key.split('-').map(Number);
              const label = new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
              const isActive = registerMonth === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => { setRegisterMonth(tab.key); setPage(0); }}
                  className={`w-full text-left px-3 py-2.5 rounded-control text-xs transition-all flex items-center justify-between gap-2 ${
                    isActive
                      ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30 font-semibold'
                      : 'text-slate-400 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span className="truncate">{label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-cyan-400/20 text-cyan-300' : 'bg-white/[0.06] text-slate-500'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="col-span-12 lg:col-span-9 space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Latest Grid" value={kpis.grid} unit="kWh" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Latest DG" value={kpis.dg} unit="kWh" color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="Latest Solar" value={kpis.solar} unit="kWh" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Current PF" value={kpis.pf} color={kpis.pf < 0.9 && kpis.pf > 0 ? 'text-red-300' : 'text-white'} bg={kpis.pf < 0.9 && kpis.pf > 0 ? 'bg-red-500/[0.07] border-red-500/20' : 'bg-white/[0.04] border-white/[0.10]'} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="DG 380 Total" value={dgSummary.dg380Total} unit="kWh" color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="DG 500 Total" value={dgSummary.dg500Total} unit="kWh" color="text-orange-300" bg="bg-orange-500/[0.07] border-orange-500/20" />
        <KpiCard label="Total DG Generation" value={dgSummary.totalDg} unit="kWh" color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="Total HSD Consumption" value={dgSummary.totalHsd} unit="L" color="text-orange-300" bg="bg-orange-500/[0.07] border-orange-500/20" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Toolbar isAdmin={isAdmin} onAdd={() => onAdd({ date: todayStr })} onUpload={() => onUpload({ kind: 'bulk', module: 'energyDailyUtility' })} onDownload={() => downloadTemplate('energyDailyUtility')} label="Daily Reading" />
        {isAdmin && dailyUtilityLog.length > 0 && <button onClick={() => setConfirmPurge(true)} className="btn-danger inline-flex items-center gap-1.5 text-xs"><Trash2 size={13} /> Purge Data</button>}
      </div>
      {filteredDerived.length > 0 ? (        <>
          <div className="space-y-4">
            <ChartCard title="Unit 1 & Unit 2 Daily Energy">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={filteredDerived.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey={(d) => d.date?.slice(5) || d.date} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip {...TTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="u1ImportKwh" name="U1 Import" stroke={C.grid} fill={C.grid} fillOpacity={0.2} />
                  <Area type="monotone" dataKey="u1SolarKwh" name="U1 Solar" stroke={C.solar} fill={C.solar} fillOpacity={0.2} />
                  <Area type="monotone" dataKey="u1ExportKwh" name="U1 Export" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="u2ImportKwh" name="U2 Import" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="u2SolarKwh" name="U2 Solar" stroke="#34D399" fill="#34D399" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="u2ExportKwh" name="U2 Export" stroke="#A78BFA" fill="#A78BFA" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Total Plant Energy (Grid Net + Solar)">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={filteredDerived.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey={(d) => d.date?.slice(5) || d.date} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip {...TTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="gridNet" name="Grid Net" stroke={C.grid} fill={C.grid} fillOpacity={0.3} />
                  <Area type="monotone" dataKey="solarTotal" name="Solar" stroke={C.solar} fill={C.solar} fillOpacity={0.3} />
                  <Area type="monotone" dataKey="dgTotal" name="DG" stroke={C.dg500} fill={C.dg500} fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="DG Generation (kWh)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredDerived.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey={(d) => d.date?.slice(5) || d.date} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip {...TTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="dg380Kwh" name="DG 380" fill={C.dg380} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="dg500Kwh" name="DG 500" fill={C.dg500} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="DG Running Hours">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredDerived.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey={(d) => d.date?.slice(5) || d.date} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip {...TTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="dg380Hours" name="DG 380 Hrs" fill={C.dg380} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="dg500Hours" name="DG 500 Hrs" fill={C.dg500} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="DG HSD Consumption (Litres)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredDerived.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey={(d) => d.date?.slice(5) || d.date} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip {...TTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="dg380Hsd" name="DG 380 HSD" fill={C.dg380} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="dg500Hsd" name="DG 500 HSD" fill={C.dg500} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="DG DEF Percentage">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredDerived.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey={(d) => d.date?.slice(5) || d.date} tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip {...TTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="dg380Def" name="DG 380 DEF%" fill={C.dg380} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="dg500Def" name="DG 500 DEF%" fill={C.dg500} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[1100px]">
                <TblHead columns={cols} admin={isAdmin} />
                <tbody>
                  {pageData.map((r) => (
                    <tr key={r.date}>
                      <td className="text-slate-300 whitespace-nowrap">{r.date || '—'}</td>
                      <Td value={formatEnergy(r.u1ImportKwhReading)} className="text-slate-300 tabular-nums" />
                      <Td value={formatEnergy(r.u1ExportKwhReading)} className="text-slate-300 tabular-nums" />
                      <Td value={formatEnergy(r.u2ImportKwhReading)} className="text-slate-300 tabular-nums" />
                      <Td value={formatEnergy(r.u2ExportKwhReading)} className="text-slate-300 tabular-nums" />
                      <Td value={formatEnergy(r.gridNet)} className="text-cyan-300 font-bold tabular-nums" />
                      <Td value={formatEnergy(r.solarTotal)} className="text-emerald-300 tabular-nums" />
                      <Td value={formatEnergy(r.dgTotal)} className="text-amber-300 tabular-nums" />
                      <Td value={formatEnergy(r.totalPlant)} className="text-white font-bold tabular-nums" />
                      <Td value={r.u1Pf != null && r.u1Pf > 0 ? formatPf(r.u1Pf) : '—'} className={r.u1Pf > 0 && r.u1Pf < 0.9 ? 'text-red-300 tabular-nums' : 'text-white tabular-nums'} />
                      <Td value={r.u2Pf != null && r.u2Pf > 0 ? formatPf(r.u2Pf) : '—'} className={r.u2Pf > 0 && r.u2Pf < 0.9 ? 'text-red-300 tabular-nums' : 'text-white tabular-nums'} />
                      <Td value={r.combinedPf != null && r.combinedPf > 0 ? formatPf(r.combinedPf) : '—'} className="text-teal-300 tabular-nums" />
                      <Td value={formatEnergy(r.dg380Hsd)} className="text-slate-300 tabular-nums" />
                      <Td value={formatEnergy(r.dg500Hsd)} className="text-slate-300 tabular-nums" />
                      <Td value={r.dg380Def != null && r.dg380Def > 0 ? r.dg380Def.toFixed(1) : '—'} className="text-slate-300 tabular-nums" />
                      <Td value={r.dg500Def != null && r.dg500Def > 0 ? r.dg500Def.toFixed(1) : '—'} className="text-slate-300 tabular-nums" />
                      {isAdmin && <td className="text-right"><Acts onEdit={() => { const raw = dailyUtilityLog.find((x) => x.date === r.date); if (raw) onEdit(raw); }} onDelete={() => { const raw = dailyUtilityLog.find((x) => x.date === r.date); if (raw && window.confirm('Delete this reading?')) deleteDailyUtilityLog(raw.id, userName); }} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={filteredDerived.length} onChange={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="No daily utility data available." description="Add daily meter readings to track grid import, DG generation, solar output, and fuel consumption." />
      )}
      {formOpen && <FormModal title={formTitle} subtitle={formSubtitle} fields={fields} values={formValues} onChange={setForm} onSave={handleSave} onClose={closeForm} />}
      {confirmPurge && (
        <PurgeModal
          domain="Daily Utility"
          totalRecords={dailyUtilityLog.length}
          periodLabel={registerMonth || null}
          onPurgePeriod={async () => {
            const monthStart = registerMonth + '-01';
            const [y, m] = registerMonth.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            const monthEnd = registerMonth + '-' + String(lastDay).padStart(2, '0');
            setPurgeLoading(true);
            try {
              const r = await purgeDailyUtilityLog(userName, monthStart, monthEnd);
              setConfirmPurge(false);
              setRegisterMonth('');
              pushToast({ type: 'success', message: `${r.purged} daily utility records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onPurgeAll={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeDailyUtilityLog(userName);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} daily utility records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onClose={() => setConfirmPurge(false)}
          loading={purgeLoading}
        />
      )}
      </div>
    </div>
  );
}

function HerbicideTab({ store, userName, isAdmin, dateFrom, dateTo, onAdd, onEdit, onUpload, formOpen, editRow, formValues, setForm, closeForm, page, setPage, currentMK, pushToast }) {
  const formTitle = editRow ? 'Edit Herbicide' : 'Add Herbicide';
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';
  const { monthlyHerbicide } = store;
  const sorted = useMemo(() => [...monthlyHerbicide].sort((a, b) => (b.month || '').localeCompare(a.month || '')), [monthlyHerbicide]);
  const filtered = useMemo(() => sorted.filter((r) => monthInRange(r.month, dateFrom, dateTo)), [sorted, dateFrom, dateTo]);

  const withCalc = useMemo(() => sorted.map((row, idx) => {
    const prev = sorted[idx + 1];
    const calc = (k) => {
      const d = r1(toN(row[k]) - toN(prev?.[k]));
      return (prev && d < 0) ? 0 : d;
    };
    const g1 = calc('glyphosateM1MeterReading'), t2 = calc('maintenanceTopperM2MeterReading');
    const a3 = calc('acmHerbicideM3MeterReading'), t4 = calc('topperHerbicideM4MeterReading');
    const pr = calc('maintenancePrintingMeterReading');
    return { ...row, _g1: g1, _t2: t2, _a3: a3, _t4: t4, _pr: pr, _total: r1(g1 + t2 + a3 + t4 + pr) };
  }), [sorted]);

  const filteredCalc = useMemo(() => withCalc.filter((r) => monthInRange(r.month, dateFrom, dateTo)), [withCalc, dateFrom, dateTo]);
  const pageData = useMemo(() => filteredCalc.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredCalc, page]);

  const kpis = useMemo(() => {
    if (filteredCalc.length === 0) return { total: 0, latest: '—', highest: '—', mom: '—' };
    const total = r1(filteredCalc.reduce((s, r) => s + r._total, 0));
    const latest = filteredCalc[0];
    const feeders = [
      { name: 'Glyphosate M1', val: latest._g1 }, { name: 'Topper M2', val: latest._t2 },
      { name: 'ACM M3', val: latest._a3 }, { name: 'Topper M4', val: latest._t4 }, { name: 'Printing', val: latest._pr },
    ];
    const highest = feeders.reduce((a, b) => a.val > b.val ? a : b);
    const prev = filteredCalc[1];
    const mom = prev && prev._total > 0 ? r1(((latest._total - prev._total) / prev._total) * 100) : '—';
    return { total, latest: latest.month, highest: highest.name, mom: typeof mom === 'number' ? `${mom}%` : mom };
  }, [filteredCalc]);

  const monthlyChart = useMemo(() => [...filteredCalc].reverse().map((r) => ({ name: r.month, kWh: r._total })), [filteredCalc]);
  const feederChart = useMemo(() => {
    if (filteredCalc.length === 0) return [];
    const r = filteredCalc[0];
    return [
      { name: 'Glyphosate M1', value: r._g1 }, { name: 'Topper M2', value: r._t2 },
      { name: 'ACM M3', value: r._a3 }, { name: 'Topper M4', value: r._t4 }, { name: 'Printing', value: r._pr },
    ];
  }, [filteredCalc]);

  const FEEDER_MAP = { glyphosateM1MeterReading: '_g1', maintenanceTopperM2MeterReading: '_t2', acmHerbicideM3MeterReading: '_a3', topperHerbicideM4MeterReading: '_t4', maintenancePrintingMeterReading: '_pr' };
  const FEEDER_NAMES = { glyphosateM1MeterReading: 'Glyphosate M1', maintenanceTopperM2MeterReading: 'Topper M2', acmHerbicideM3MeterReading: 'ACM M3', topperHerbicideM4MeterReading: 'Topper M4', maintenancePrintingMeterReading: 'Printing' };
  const [selFeeder, setSelFeeder] = useState('glyphosateM1MeterReading');
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const feederTrend = useMemo(() => {
    const prop = FEEDER_MAP[selFeeder] || '_g1';
    const name = FEEDER_NAMES[selFeeder] || 'Glyphosate M1';
    return [...filteredCalc].reverse().map((r) => ({ name: r.month, [name]: r[prop] }));
  }, [filteredCalc, selFeeder]);

  const fields = useMemo(() => [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    nf('glyphosateM1MeterReading', 'Glyphosate M1'), nf('maintenanceTopperM2MeterReading', 'Topper M2'),
    nf('acmHerbicideM3MeterReading', 'ACM M3'), nf('topperHerbicideM4MeterReading', 'Topper M4'),
    nf('maintenancePrintingMeterReading', 'Printing'),
  ], []);

  const handleSave = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) updateMonthlyHerbicide(editRow.id, formValues, userName);
    else addMonthlyHerbicide(formValues, userName);
    closeForm();
  };

  const cols = [
    { key: 'month', label: 'Month' }, { key: 'g1', label: 'Glyphosate M1', className: 'text-emerald-400' },
    { key: 't2', label: 'Topper M2', className: 'text-cyan-400' }, { key: 'a3', label: 'ACM M3', className: 'text-violet-400' },
    { key: 't4', label: 'Topper M4', className: 'text-amber-400' }, { key: 'pr', label: 'Printing', className: 'text-orange-400' },
    { key: 'total', label: 'Total kWh', className: 'text-white font-semibold' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total kWh" value={kpis.total} unit="kWh" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Latest Month" value={kpis.latest} color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Highest Feeder" value={kpis.highest} color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="MoM Change" value={kpis.mom} color="text-white" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Toolbar isAdmin={isAdmin} onAdd={() => onAdd({ month: currentMK })} onUpload={() => onUpload({ kind: 'bulk', module: 'energyMonthlyHerbicide' })} onDownload={() => downloadTemplate('energyMonthlyHerbicide')} label="Monthly Reading" />
        {isAdmin && monthlyHerbicide.length > 0 && <button onClick={() => setConfirmPurge(true)} className="btn-danger inline-flex items-center gap-1.5 text-xs"><Trash2 size={13} /> Purge Data</button>}
      </div>
      {filteredCalc.length > 0 ? (
        <>
          <div className="space-y-4">
            <ChartCard title="Monthly Consumption (kWh)"><ResponsiveContainer width="100%" height={300}><BarChart data={monthlyChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="kWh" fill={C.solar} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Feeder-wise Consumption (Latest Month)"><ResponsiveContainer width="100%" height={300}><BarChart data={feederChart} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={100} /><Tooltip {...TTIP} /><Bar dataKey="value" fill={C.solar} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[900px]">
                <TblHead columns={cols} admin={isAdmin} />
                <tbody>{pageData.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                    <Td value={r._g1} className="text-emerald-300 tabular-nums" />
                    <Td value={r._t2} className="text-cyan-300 tabular-nums" />
                    <Td value={r._a3} className="text-violet-300 tabular-nums" />
                    <Td value={r._t4} className="text-amber-300 tabular-nums" />
                    <Td value={r._pr} className="text-orange-300 tabular-nums" />
                    <Td value={r._total} className="text-white font-bold tabular-nums" />
                    {isAdmin && <td className="text-right"><Acts onEdit={() => onEdit(r)} onDelete={() => { if (window.confirm('Delete this record?')) deleteMonthlyHerbicide(r.id, userName); }} /></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination page={page} total={filteredCalc.length} onChange={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="No herbicide data available." description="Add monthly herbicide section consumption readings to track energy usage." />
      )}
      {formOpen && <FormModal title={formTitle} subtitle={formSubtitle} fields={fields} values={formValues} onChange={setForm} onSave={handleSave} onClose={closeForm} />}
      {confirmPurge && (
        <PurgeModal
          domain="Herbicide"
          totalRecords={monthlyHerbicide.length}
          periodLabel={dateFrom || dateTo ? `${dateFrom || '...'} to ${dateTo || '...'}` : null}
          onPurgePeriod={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeMonthlyHerbicide(userName, dateFrom || undefined, dateTo || undefined);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} herbicide records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onPurgeAll={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeMonthlyHerbicide(userName);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} herbicide records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onClose={() => setConfirmPurge(false)}
          loading={purgeLoading}
        />
      )}
    </div>
  );
}

function InsecticideTab({ store, userName, isAdmin, dateFrom, dateTo, onAdd, onEdit, onUpload, formOpen, editRow, formValues, setForm, closeForm, page, setPage, currentMK, pushToast }) {
  const formTitle = editRow ? 'Edit Insecticide' : 'Add Insecticide';
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';
  const { monthlyInsecticide } = store;
  const sorted = useMemo(() => [...monthlyInsecticide].sort((a, b) => (b.month || '').localeCompare(a.month || '')), [monthlyInsecticide]);

  const withCalc = useMemo(() => sorted.map((row, idx) => {
    const prev = sorted[idx + 1];
    const feeders = FEEDER_KEYS_INSECT.map((k) => {
      const d = r1(toN(row[k]) - toN(prev?.[k]));
      return (prev && d < 0) ? 0 : d;
    });
    return { ...row, _feeders: feeders, _total: r1(feeders.reduce((s, v) => s + v, 0)) };
  }), [sorted]);

  const filtered = useMemo(() => withCalc.filter((r) => monthInRange(r.month, dateFrom, dateTo)), [withCalc, dateFrom, dateTo]);
  const pageData = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const kpis = useMemo(() => {
    if (filtered.length === 0) return { total: 0, latest: '—', highest: '—', mom: '—' };
    const total = r1(filtered.reduce((s, r) => s + r._total, 0));
    const latest = filtered[0];
    const fMax = latest._feeders.map((v, i) => ({ name: FEEDER_LABELS_INSECT[i], val: v })).reduce((a, b) => a.val > b.val ? a : b);
    const prev = filtered[1];
    const mom = prev && prev._total > 0 ? r1(((latest._total - prev._total) / prev._total) * 100) : '—';
    return { total, latest: latest.month, highest: fMax.name, mom: typeof mom === 'number' ? `${mom}%` : mom };
  }, [filtered]);

  const monthlyChart = useMemo(() => [...filtered].reverse().map((r) => ({ name: r.month, kWh: r._total })), [filtered]);
  const feederChart = useMemo(() => {
    if (filtered.length === 0) return [];
    return FEEDER_LABELS_INSECT.map((name, i) => ({ name, value: filtered[0]._feeders[i] }));
  }, [filtered]);
  const top5Chart = useMemo(() => [...feederChart].sort((a, b) => b.value - a.value).slice(0, 5), [feederChart]);

  const [selIdx, setSelIdx] = useState(0);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const feederTrend = useMemo(() => [...filtered].reverse().map((r) => ({ name: r.month, [FEEDER_LABELS_INSECT[selIdx]]: r._feeders[selIdx] })), [filtered, selIdx]);

  const fields = useMemo(() => [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    ...FEEDER_LABELS_INSECT.map((label, i) => nf(FEEDER_KEYS_INSECT[i], label)),
  ], []);

  const handleSave = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) updateMonthlyInsecticide(editRow.id, formValues, userName);
    else addMonthlyInsecticide(formValues, userName);
    closeForm();
  };

  const handlePurge = async () => {
    setPurgeLoading(true);
    try {
      const r = await purgeMonthlyInsecticide(userName, dateFrom || undefined, dateTo || undefined);
      setConfirmPurge(false);
      pushToast({ type: 'success', message: `${r.purged} insecticide records purged` });
    } catch (err) {
      pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
    } finally { setPurgeLoading(false); }
  };

  const cols = [{ key: 'month', label: 'Month' }, ...FEEDER_LABELS_INSECT.map((l, i) => ({ key: 'f' + i, label: l, className: i < 8 ? 'text-cyan-400' : i < 9 ? 'text-violet-400' : 'text-amber-400' })), { key: 'total', label: 'Total kWh', className: 'text-white font-semibold' }];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total kWh" value={kpis.total} unit="kWh" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Latest Month" value={kpis.latest} color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Highest Feeder" value={kpis.highest} color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="MoM Change" value={kpis.mom} color="text-white" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Toolbar isAdmin={isAdmin} onAdd={() => onAdd({ month: currentMK })} onUpload={() => onUpload({ kind: 'bulk', module: 'energyMonthlyInsecticide' })} onDownload={() => downloadTemplate('energyMonthlyInsecticide')} label="Monthly Reading" />
        {isAdmin && monthlyInsecticide.length > 0 && <button onClick={() => setConfirmPurge(true)} className="btn-danger inline-flex items-center gap-1.5 text-xs"><Trash2 size={13} /> Purge Data</button>}
      </div>
      {filtered.length > 0 ? (
        <>
          <div className="space-y-4">
            <ChartCard title="Monthly Consumption (kWh)"><ResponsiveContainer width="100%" height={300}><BarChart data={monthlyChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="kWh" fill={C.grid} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Feeder-wise (Latest Month)"><ResponsiveContainer width="100%" height={300}><BarChart data={feederChart} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={90} /><Tooltip {...TTIP} /><Bar dataKey="value" fill={C.grid} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Top 5 Feeders"><ResponsiveContainer width="100%" height={300}><BarChart data={top5Chart} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={90} /><Tooltip {...TTIP} /><Bar dataKey="value" fill={C.solar} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Feeder Trend">
              <div className="flex gap-2 mb-3 flex-wrap">{FEEDER_LABELS_INSECT.map((l, i) => <button key={i} onClick={() => setSelIdx(i)} className={`text-[10px] px-2 py-0.5 rounded border ${i === selIdx ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'text-slate-400 border-transparent hover:text-white'}`}>{l}</button>)}</div>
              <ResponsiveContainer width="100%" height={300}><LineChart data={feederTrend}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Line type="monotone" dataKey={FEEDER_LABELS_INSECT[selIdx]} stroke={C.grid} dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer>
            </ChartCard>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[1200px]">
                <TblHead columns={cols} admin={isAdmin} />
                <tbody>{pageData.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                    {r._feeders.map((v, i) => <Td key={i} value={v} className={i < 8 ? 'text-cyan-300 tabular-nums' : i < 9 ? 'text-violet-300 tabular-nums' : 'text-amber-300 tabular-nums'} />)}
                    <Td value={r._total} className="text-white font-bold tabular-nums" />
                    {isAdmin && <td className="text-right"><Acts onEdit={() => onEdit(r)} onDelete={() => { if (window.confirm('Delete this record?')) deleteMonthlyInsecticide(r.id, userName); }} /></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination page={page} total={filtered.length} onChange={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="No insecticide data available." description="Add monthly insecticide section consumption readings." />
      )}
      {formOpen && <FormModal title={formTitle} subtitle={formSubtitle} fields={fields} values={formValues} onChange={setForm} onSave={handleSave} onClose={closeForm} />}
      {confirmPurge && <PurgeModal domain="Insecticide" totalRecords={monthlyInsecticide.length} periodLabel={dateFrom || dateTo ? `${dateFrom || '...'} to ${dateTo || '...'}` : null} onPurgePeriod={handlePurge} onPurgeAll={async () => { setPurgeLoading(true); try { await purgeMonthlyInsecticide(userName); setConfirmPurge(false); pushToast({ type: 'success', message: 'All insecticide records purged' }); } catch (err) { pushToast({ type: 'error', message: `Purge failed: ${err.message}` }); } finally { setPurgeLoading(false); } }} onClose={() => setConfirmPurge(false)} loading={purgeLoading} />}
    </div>
  );
}

function WaterTab({ store, userName, isAdmin, dateFrom, dateTo, onAdd, onEdit, onUpload, formOpen, editRow, formValues, setForm, closeForm, page, setPage, currentMK, pushToast }) {
  const formTitle = editRow ? 'Edit Water' : 'Add Water';
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';
  const { monthlyWater } = store;
  const sorted = useMemo(() => [...monthlyWater].sort((a, b) => (b.month || '').localeCompare(a.month || '')), [monthlyWater]);
  const withCalc = useMemo(() => sorted.map((row, idx) => {
    const prev = sorted[idx + 1];
    const calc = (k) => {
      const d = r1(toN(row[k]) - toN(prev?.[k]));
      return (prev && d < 0) ? 0 : d;
    };
    const stp = calc('stpOutletMeterReading'), roIn = calc('roInletMeterReading');
    const roRej = calc('roRejectedMeterReading'), piau = calc('piauWaterMeterReading');
    return { ...row, _stp: stp, _roIn: roIn, _roRej: roRej, _piau: piau, _total: r1(stp + roIn + roRej + piau) };
  }), [sorted]);
  const filtered = useMemo(() => withCalc.filter((r) => monthInRange(r.month, dateFrom, dateTo)), [withCalc, dateFrom, dateTo]);
  const pageData = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const kpis = useMemo(() => {
    if (filtered.length === 0) return { total: '—', stp: '—', roIn: '—', roRej: '—' };
    return { total: r1(filtered.reduce((s, r) => s + r._total, 0)), stp: filtered[0]._stp, roIn: filtered[0]._roIn, roRej: filtered[0]._roRej };
  }, [filtered]);

  const monthlyChart = useMemo(() => [...filtered].reverse().map((r) => ({ name: r.month, KL: r._total })), [filtered]);
  const meterChart = useMemo(() => {
    if (filtered.length === 0) return [];
    const r = filtered[0];
    return [{ name: 'STP Outlet', value: r._stp }, { name: 'RO Inlet', value: r._roIn }, { name: 'RO Rejected', value: r._roRej }, { name: 'PIAU Water', value: r._piau }];
  }, [filtered]);
  const trendChart = useMemo(() => [...filtered].reverse().map((r) => ({ name: r.month, STP: r._stp, 'RO Inlet': r._roIn, 'RO Rejected': r._roRej, PIAU: r._piau })), [filtered]);
  const latestCompChart = useMemo(() => {
    if (filtered.length === 0) return [];
    const r = filtered[0];
    return [{ name: 'STP', STP: r._stp }, { name: 'RO Inlet', RO: r._roIn }, { name: 'RO Rej', RORej: r._roRej }, { name: 'PIAU', PIAU: r._piau }];
  }, [filtered]);

  const fields = useMemo(() => [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    nf('stpOutletMeterReading', 'STP Outlet'), nf('roInletMeterReading', 'RO Inlet'),
    nf('roRejectedMeterReading', 'RO Rejected'), nf('piauWaterMeterReading', 'PIAU Water'),
  ], []);

  const handleSave = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) updateMonthlyWater(editRow.id, formValues, userName);
    else addMonthlyWater(formValues, userName);
    closeForm();
  };

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  const cols = [
    { key: 'month', label: 'Month' }, { key: 'stp', label: 'STP Outlet', className: 'text-cyan-400' },
    { key: 'roIn', label: 'RO Inlet', className: 'text-emerald-400' }, { key: 'roRej', label: 'RO Rejected', className: 'text-orange-400' },
    { key: 'piau', label: 'PIAU Water', className: 'text-violet-400' }, { key: 'total', label: 'Total KL', className: 'text-white font-semibold' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total KL" value={kpis.total} unit="KL" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="STP Outlet KL" value={kpis.stp} unit="KL" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="RO Inlet KL" value={kpis.roIn} unit="KL" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="RO Rejected KL" value={kpis.roRej} unit="KL" color="text-orange-300" bg="bg-orange-500/[0.07] border-orange-500/20" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Toolbar isAdmin={isAdmin} onAdd={() => onAdd({ month: currentMK })} onUpload={() => onUpload({ kind: 'bulk', module: 'energyMonthlyWater' })} onDownload={() => downloadTemplate('energyMonthlyWater')} label="Monthly Reading" />
        {isAdmin && monthlyWater.length > 0 && <button onClick={() => setConfirmPurge(true)} className="btn-danger inline-flex items-center gap-1.5 text-xs"><Trash2 size={13} /> Purge Data</button>}
      </div>
      {filtered.length > 0 ? (
        <>
          <div className="space-y-4">
            <ChartCard title="Monthly Consumption (KL)"><ResponsiveContainer width="100%" height={300}><BarChart data={monthlyChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="KL" fill={C.grid} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Meter-wise (Latest Month)"><ResponsiveContainer width="100%" height={300}><BarChart data={meterChart} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={80} /><Tooltip {...TTIP} /><Bar dataKey="value" fill={C.grid} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Water Trend"><ResponsiveContainer width="100%" height={300}><LineChart data={trendChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="STP" stroke={C.grid} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="RO Inlet" stroke={C.solar} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="RO Rejected" stroke={C.dg500} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="PIAU" stroke="#8b5cf6" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Latest Month Comparison"><ResponsiveContainer width="100%" height={300}><BarChart data={latestCompChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="STP" fill={C.grid} radius={[4, 4, 0, 0]} /><Bar dataKey="RO" fill={C.solar} radius={[4, 4, 0, 0]} /><Bar dataKey="RORej" fill={C.dg500} radius={[4, 4, 0, 0]} /><Bar dataKey="PIAU" fill="#8b5cf6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[800px]">
                <TblHead columns={cols} admin={isAdmin} />
                <tbody>{pageData.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                    <Td value={r._stp} className="text-cyan-300 tabular-nums" />
                    <Td value={r._roIn} className="text-emerald-300 tabular-nums" />
                    <Td value={r._roRej} className="text-orange-300 tabular-nums" />
                    <Td value={r._piau} className="text-violet-300 tabular-nums" />
                    <Td value={r._total} className="text-white font-bold tabular-nums" />
                    {isAdmin && <td className="text-right"><Acts onEdit={() => onEdit(r)} onDelete={() => { if (window.confirm('Delete this record?')) deleteMonthlyWater(r.id, userName); }} /></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination page={page} total={filtered.length} onChange={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="No water data available." description="Add monthly water consumption readings (STP, RO, PIAU)." />
      )}
      {formOpen && <FormModal title={formTitle} subtitle={formSubtitle} fields={fields} values={formValues} onChange={setForm} onSave={handleSave} onClose={closeForm} />}
      {confirmPurge && (
        <PurgeModal
          domain="Water"
          totalRecords={monthlyWater.length}
          periodLabel={dateFrom || dateTo ? `${dateFrom || '...'} to ${dateTo || '...'}` : null}
          onPurgePeriod={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeMonthlyWater(userName, dateFrom || undefined, dateTo || undefined);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} water records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onPurgeAll={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeMonthlyWater(userName);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} water records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onClose={() => setConfirmPurge(false)}
          loading={purgeLoading}
        />
      )}
    </div>
  );
}

function AirCompressorTab({ store, userName, isAdmin, dateFrom, dateTo, onAdd, onEdit, onUpload, formOpen, editRow, formValues, setForm, closeForm, page, setPage, currentMK, pushToast }) {
  const formTitle = editRow ? 'Edit Air Compressor' : 'Add Air Compressor';
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';
  const { monthlyAirCompressor } = store;
  const sorted = useMemo(() => [...monthlyAirCompressor].sort((a, b) => (b.month || '').localeCompare(a.month || '')), [monthlyAirCompressor]);
  const withCalc = useMemo(() => sorted.map((row, idx) => {
    const prev = sorted[idx + 1];
    const calc = (k) => {
      const d = r1(toN(row[k]) - toN(prev?.[k]));
      return (prev && d < 0) ? 0 : d;
    };
    const mk2 = (id) => {
      const run = calc(`compressor${id}RunHrsReading`), load = calc(`compressor${id}LoadHrsReading`);
      const unload = r1(Math.max(0, run - load));
      const pct = run > 0 ? r1((load / run) * 100) : 0;
      return { run, load, unload, pct };
    };
    const c1 = mk2(1), c2 = mk2(2), c3 = mk2(3);
    return { ...row, c1, c2, c3, _totalRun: r1(c1.run + c2.run + c3.run), _totalLoad: r1(c1.load + c2.load + c3.load), _avgPct: r1(c1.run + c2.run + c3.run) > 0 ? r1(((c1.load + c2.load + c3.load) / (c1.run + c2.run + c3.run)) * 100) : 0 };
  }), [sorted]);
  const filtered = useMemo(() => withCalc.filter((r) => monthInRange(r.month, dateFrom, dateTo)), [withCalc, dateFrom, dateTo]);
  const pageData = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const kpis = useMemo(() => {
    if (filtered.length === 0) return { run: '—', load: '—', avgPct: '—', highest: '—' };
    const r = filtered[0];
    const comps = [{ name: 'Compressor 1', pct: r.c1.pct }, { name: 'Compressor 2', pct: r.c2.pct }, { name: 'Compressor 3', pct: r.c3.pct }];
    const best = comps.reduce((a, b) => a.pct > b.pct ? a : b);
    return { run: r._totalRun, load: r._totalLoad, avgPct: r._avgPct, highest: best.name };
  }, [filtered]);

  const runLoadChart = useMemo(() => {
    if (filtered.length === 0) return [];
    const r = filtered[0];
    return [
      { name: 'Comp 1', Run: r.c1.run, Load: r.c1.load }, { name: 'Comp 2', Run: r.c2.run, Load: r.c2.load },
      { name: 'Comp 3', Run: r.c3.run, Load: r.c3.load },
    ];
  }, [filtered]);
  const loadPctChart = useMemo(() => {
    if (filtered.length === 0) return [];
    const r = filtered[0];
    return [{ name: 'Comp 1', 'Load %': r.c1.pct }, { name: 'Comp 2', 'Load %': r.c2.pct }, { name: 'Comp 3', 'Load %': r.c3.pct }];
  }, [filtered]);
  const unloadChart = useMemo(() => {
    if (filtered.length === 0) return [];
    const r = filtered[0];
    return [{ name: 'Comp 1', Unload: r.c1.unload }, { name: 'Comp 2', Unload: r.c2.unload }, { name: 'Comp 3', Unload: r.c3.unload }];
  }, [filtered]);
  const trendChart = useMemo(() => [...filtered].reverse().map((r) => ({ name: r.month, 'Comp 1': r.c1.pct, 'Comp 2': r.c2.pct, 'Comp 3': r.c3.pct })), [filtered]);

  const fields = useMemo(() => [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    nf('compressor1RunHrsReading', 'Comp1 Run Hrs'), nf('compressor1LoadHrsReading', 'Comp1 Load Hrs'),
    nf('compressor2RunHrsReading', 'Comp2 Run Hrs'), nf('compressor2LoadHrsReading', 'Comp2 Load Hrs'),
    nf('compressor3RunHrsReading', 'Comp3 Run Hrs'), nf('compressor3LoadHrsReading', 'Comp3 Load Hrs'),
  ], []);

  const handleSave = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) updateMonthlyAirCompressor(editRow.id, formValues, userName);
    else addMonthlyAirCompressor(formValues, userName);
    closeForm();
  };

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  const cols = [
    { key: 'month', label: 'Month' },
    { key: 'c1Run', label: 'C1 Run', className: 'text-cyan-400' }, { key: 'c1Load', label: 'C1 Load' }, { key: 'c1Unload', label: 'C1 Unload' }, { key: 'c1Pct', label: 'C1 %' },
    { key: 'c2Run', label: 'C2 Run', className: 'text-emerald-400' }, { key: 'c2Load', label: 'C2 Load' }, { key: 'c2Unload', label: 'C2 Unload' }, { key: 'c2Pct', label: 'C2 %' },
    { key: 'c3Run', label: 'C3 Run', className: 'text-amber-400' }, { key: 'c3Load', label: 'C3 Load' }, { key: 'c3Unload', label: 'C3 Unload' }, { key: 'c3Pct', label: 'C3 %' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Run Hrs" value={kpis.run} unit="hours" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Total Load Hrs" value={kpis.load} unit="hours" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Avg Load %" value={kpis.avgPct} unit="%" color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="Highest Loaded" value={kpis.highest} color="text-white" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Toolbar isAdmin={isAdmin} onAdd={() => onAdd({ month: currentMK })} onUpload={() => onUpload({ kind: 'bulk', module: 'energyMonthlyAirCompressor' })} onDownload={() => downloadTemplate('energyMonthlyAirCompressor')} label="Monthly Reading" />
        {isAdmin && monthlyAirCompressor.length > 0 && <button onClick={() => setConfirmPurge(true)} className="btn-danger inline-flex items-center gap-1.5 text-xs"><Trash2 size={13} /> Purge Data</button>}
      </div>
      {filtered.length > 0 ? (
        <>
          <div className="space-y-4">
            <ChartCard title="Run vs Load Hours (Latest)"><ResponsiveContainer width="100%" height={300}><BarChart data={runLoadChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Run" fill={C.grid} radius={[4, 4, 0, 0]} /><Bar dataKey="Load" fill={C.solar} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Compressor Load %"><ResponsiveContainer width="100%" height={300}><BarChart data={loadPctChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="Load %" fill={C.dg500} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Unload Hours"><ResponsiveContainer width="100%" height={300}><BarChart data={unloadChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="Unload" fill={C.dg380} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Monthly Performance Trend"><ResponsiveContainer width="100%" height={300}><LineChart data={trendChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Comp 1" stroke={C.grid} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="Comp 2" stroke={C.solar} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="Comp 3" stroke={C.dg500} dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[1100px]">
                <TblHead columns={cols} admin={isAdmin} />
                <tbody>{pageData.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                    <Td value={r.c1.run} className="text-cyan-300 tabular-nums" /><Td value={r.c1.load} /><Td value={r.c1.unload} /><Td value={r.c1.pct ? `${r.c1.pct}%` : '—'} />
                    <Td value={r.c2.run} className="text-emerald-300 tabular-nums" /><Td value={r.c2.load} /><Td value={r.c2.unload} /><Td value={r.c2.pct ? `${r.c2.pct}%` : '—'} />
                    <Td value={r.c3.run} className="text-amber-300 tabular-nums" /><Td value={r.c3.load} /><Td value={r.c3.unload} /><Td value={r.c3.pct ? `${r.c3.pct}%` : '—'} />
                    {isAdmin && <td className="text-right"><Acts onEdit={() => onEdit(r)} onDelete={() => { if (window.confirm('Delete this record?')) deleteMonthlyAirCompressor(r.id, userName); }} /></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination page={page} total={filtered.length} onChange={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="No air compressor data available." description="Add monthly compressor run/load/unload readings." />
      )}
      {formOpen && <FormModal title={formTitle} subtitle={formSubtitle} fields={fields} values={formValues} onChange={setForm} onSave={handleSave} onClose={closeForm} />}
      {confirmPurge && (
        <PurgeModal
          domain="Air Compressor"
          totalRecords={monthlyAirCompressor.length}
          periodLabel={dateFrom || dateTo ? `${dateFrom || '...'} to ${dateTo || '...'}` : null}
          onPurgePeriod={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeMonthlyAirCompressor(userName, dateFrom || undefined, dateTo || undefined);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} air compressor records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onPurgeAll={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeMonthlyAirCompressor(userName);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} air compressor records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onClose={() => setConfirmPurge(false)}
          loading={purgeLoading}
        />
      )}
    </div>
  );
}

function SolarTab({ store, userName, isAdmin, dateFrom, dateTo, onAdd, onEdit, onUpload, formOpen, editRow, formValues, setForm, closeForm, page, setPage, todayStr, currentMK, pushToast }) {
  const formTitle = editRow ? 'Edit Solar' : 'Add Solar';
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';
  const { dailySolarGeneration } = store;
  const sorted = useMemo(() => [...dailySolarGeneration].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [dailySolarGeneration]);
  const filtered = useMemo(() => sorted.filter((r) => dateInRange(r.date, dateFrom, dateTo)), [sorted, dateFrom, dateTo]);
  
  // Use canonical solar calculations - single source of truth
  const withCalc = useMemo(() => sorted.map((r) => ({ ...r, ...getSolarDerived(r) })), [sorted]);
  const filteredCalc = useMemo(() => withCalc.filter((r) => dateInRange(r.date, dateFrom, dateTo)), [withCalc, dateFrom, dateTo]);
  const pageData = useMemo(() => filteredCalc.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredCalc, page]);

  const kpis = useMemo(() => {
    if (filteredCalc.length === 0) return { today: '—', month: '—', avg: '—', best: '—', u1: '—', u2: '—', grandTotal: '—', monthlyAvg: '—' };
    
    // Use canonical solar summary - single source of truth
    const summary = computeSolarSummary(filteredCalc);
    
    // Month Generation: CURRENT calendar month from FULL dataset (not filtered)
    const monthGeneration = getCurrentMonthSolarTotal(sorted);
    
    const latest = filteredCalc[0];
    const best = Math.max(...filteredCalc.map((r) => r.grandTotal || 0));
    
    return { 
      today: latest.grandTotal || 0, 
      month: monthGeneration, 
      avg: summary.dailyAvg, 
      best, 
      u1: summary.u1Total, 
      u2: summary.u2Total, 
      grandTotal: summary.grandTotal, 
      monthlyAvg: summary.monthlyAvg 
    };
  }, [filteredCalc, sorted, currentMK, dateFrom]);

  // Chart data using canonical derived values
  const dailyChart = useMemo(() => [...filteredCalc].reverse().map((r) => ({ name: r.date?.slice(5) || r.date, kWh: r.grandTotal })), [filteredCalc]);
  const monthlyChart = useMemo(() => {
    const byMonth = {};
    filteredCalc.forEach((r) => { const m = r.date?.slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + (r.grandTotal || 0); });
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ name: m, kWh: r1(v) }));
  }, [filteredCalc]);
  const u1InvChart = useMemo(() => [...filteredCalc].reverse().map((r) => ({ name: r.date?.slice(5) || r.date, 'U1 Inv1': toN(r.u1Inv1Kwh), 'U1 Inv2': toN(r.u1Inv2Kwh), 'U1 Inv3': toN(r.u1Inv3Kwh), 'U1 Inv4': toN(r.u1Inv4Kwh) })), [filteredCalc]);
  const u2InvChart = useMemo(() => [...filteredCalc].reverse().map((r) => ({ name: r.date?.slice(5) || r.date, 'U2 Inv1': toN(r.u2Inv1Kwh), 'U2 Inv2': toN(r.u2Inv2Kwh), 'U2 Inv3': toN(r.u2Inv3Kwh) })), [filteredCalc]);
  
  // Monthly comparison using canonical aggregation
  const monthlyCompChart = useMemo(() => {
    const byMonth = {};
    filteredCalc.forEach((r) => {
      const m = r.date?.slice(0, 7);
      if (!m) return;
      if (!byMonth[m]) byMonth[m] = { u1: 0, u2: 0 };
      byMonth[m].u1 += r.u1Total || 0;
      byMonth[m].u2 += r.u2Total || 0;
    });
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ name: m, 'U1 Total': r1(v.u1), 'U2 Total': r1(v.u2), 'Grand Total': r1(v.u1 + v.u2) }));
  }, [filteredCalc]);
  
  // U1 vs U2 vs Grand Total chart
  const u1u2GrandChart = useMemo(() => [...filteredCalc].reverse().map((r) => ({ name: r.date?.slice(5) || r.date, 'U1 Total': r.u1Total, 'U2 Total': r.u2Total, 'Grand Total': r.grandTotal })), [filteredCalc]);

  const fields = useMemo(() => [
    { key: 'date', label: 'Date', type: 'date', required: true },
    nf('u1Inv1Kwh', 'U1 Inv1 kWh'), nf('u1Inv2Kwh', 'U1 Inv2 kWh'), nf('u1Inv3Kwh', 'U1 Inv3 kWh'), nf('u1Inv4Kwh', 'U1 Inv4 kWh'),
    nf('u2Inv1Kwh', 'U2 Inv1 kWh'), nf('u2Inv2Kwh', 'U2 Inv2 kWh'), nf('u2Inv3Kwh', 'U2 Inv3 kWh'),
  ], []);

  const handleSave = () => {
    if (!formValues.date) { pushToast({ type: 'error', message: 'Date is required' }); return; }
    const payload = processSolarRowForSave(formValues);
    if (editRow) updateDailySolarGeneration(editRow.id, payload, userName);
    else addDailySolarGeneration(payload, userName);
    closeForm();
  };

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  const cols = [
    { key: 'date', label: 'Date' }, { key: 'u1i1', label: 'U1 Inv1', className: 'text-emerald-400' },
    { key: 'u1i2', label: 'U1 Inv2', className: 'text-emerald-400' }, { key: 'u1i3', label: 'U1 Inv3', className: 'text-emerald-400' },
    { key: 'u1i4', label: 'U1 Inv4', className: 'text-emerald-400' }, { key: 'u1Total', label: 'U1 Total', className: 'text-emerald-300 font-semibold' },
    { key: 'u2i1', label: 'U2 Inv1', className: 'text-cyan-400' },
    { key: 'u2i2', label: 'U2 Inv2', className: 'text-cyan-400' }, { key: 'u2i3', label: 'U2 Inv3', className: 'text-cyan-400' },
    { key: 'u2Total', label: 'U2 Total', className: 'text-cyan-300 font-semibold' },
    { key: 'grandTotal', label: 'Grand Total kWh', className: 'text-white font-semibold' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Latest Day Generation" value={kpis.today} unit="kWh" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Month Generation" value={kpis.month} unit="kWh" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Avg Daily" value={kpis.avg} unit="kWh" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Best Day" value={kpis.best} unit="kWh" color="text-amber-300" bg="bg-amber-500/[0.07] border-amber-500/20" />
        <KpiCard label="U1 Total (Filtered)" value={kpis.u1} unit="kWh" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="U2 Total (Filtered)" value={kpis.u2} unit="kWh" color="text-cyan-300" bg="bg-cyan-500/[0.07] border-cyan-500/20" />
        <KpiCard label="Avg Monthly" value={kpis.monthlyAvg} unit="kWh" color="text-violet-300" bg="bg-violet-500/[0.07] border-violet-500/20" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Toolbar isAdmin={isAdmin} onAdd={() => onAdd({ date: todayStr })} onUpload={() => onUpload({ kind: 'bulk', module: 'energyDailySolar' })} onDownload={() => downloadTemplate('energyDailySolar')} label="Daily Reading" />
        {isAdmin && dailySolarGeneration.length > 0 && <button onClick={() => setConfirmPurge(true)} className="btn-danger inline-flex items-center gap-1.5 text-xs"><Trash2 size={13} /> Purge Data</button>}
      </div>
      {filteredCalc.length > 0 ? (
        <>
          <div className="space-y-4">
            <ChartCard title="Daily Solar Generation"><ResponsiveContainer width="100%" height={300}><AreaChart data={dailyChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Area type="monotone" dataKey="kWh" stroke={C.solar} fill={C.solar} fillOpacity={0.3} /></AreaChart></ResponsiveContainer></ChartCard>
            <ChartCard title="Monthly Solar Generation"><ResponsiveContainer width="100%" height={300}><BarChart data={monthlyCompChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="U1 Total" fill={C.solar} radius={[4, 4, 0, 0]} /><Bar dataKey="U2 Total" fill={C.grid} radius={[4, 4, 0, 0]} /><Bar dataKey="Grand Total" fill={C.dg500} radius={[4, 4, 0, 0]} />                </BarChart></ResponsiveContainer></ChartCard>
            <ChartCard title="U1 Inverter Generation"><ResponsiveContainer width="100%" height={300}><LineChart data={u1InvChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} />                <Line type="monotone" dataKey="U1 Inv1" stroke="#10B981" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="U1 Inv2" stroke="#06B6D4" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="U1 Inv3" stroke="#F59E0B" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="U1 Inv4" stroke="#8b5cf6" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
            <ChartCard title="U2 Inverter Generation"><ResponsiveContainer width="100%" height={300}><LineChart data={u2InvChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} />                <Line type="monotone" dataKey="U2 Inv1" stroke="#10B981" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="U2 Inv2" stroke="#06B6D4" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="U2 Inv3" stroke="#F59E0B" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
            <ChartCard title="U1 vs U2 vs Grand Total"><ResponsiveContainer width="100%" height={300}><LineChart data={u1u2GrandChart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="U1 Total" stroke={C.solar} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="U2 Total" stroke={C.grid} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="Grand Total" stroke={C.dg500} dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="enterprise-table w-full min-w-[900px]">
                <TblHead columns={cols} admin={isAdmin} />
                <tbody>{pageData.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-300 whitespace-nowrap">{r.date || '—'}</td>
                    <Td value={formatEnergy(r.u1Inv1Kwh)} className="text-emerald-300 tabular-nums" /><Td value={formatEnergy(r.u1Inv2Kwh)} className="text-emerald-300 tabular-nums" />
                    <Td value={formatEnergy(r.u1Inv3Kwh)} className="text-emerald-300 tabular-nums" />                    <Td value={formatEnergy(r.u1Inv4Kwh)} className="text-emerald-300 tabular-nums" />
                    <Td value={formatEnergy(r.u1Total)} className="text-emerald-300 font-semibold tabular-nums" />
                    <Td value={formatEnergy(r.u2Inv1Kwh)} className="text-cyan-300 tabular-nums" /><Td value={formatEnergy(r.u2Inv2Kwh)} className="text-cyan-300 tabular-nums" />
                    <Td value={formatEnergy(r.u2Inv3Kwh)} className="text-cyan-300 tabular-nums" />
                    <Td value={formatEnergy(r.u2Total)} className="text-cyan-300 font-semibold tabular-nums" />
                    <Td value={formatEnergy(r.grandTotal)} className="text-white font-bold tabular-nums" />
                    {isAdmin && <td className="text-right"><Acts onEdit={() => onEdit(r)} onDelete={() => { if (window.confirm('Delete this record?')) deleteDailySolarGeneration(r.id, userName); }} /></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination page={page} total={filteredCalc.length} onChange={setPage} />
          </div>
        </>
      ) : (
        <EmptyState title="No solar generation data available." description="Add daily inverter-level solar generation readings." />
      )}
      {formOpen && <FormModal title={formTitle} subtitle={formSubtitle} fields={fields} values={formValues} onChange={setForm} onSave={handleSave} onClose={closeForm} />}
      {confirmPurge && (
        <PurgeModal
          domain="Solar"
          totalRecords={dailySolarGeneration.length}
          periodLabel={dateFrom || dateTo ? `${dateFrom || '...'} to ${dateTo || '...'}` : null}
          onPurgePeriod={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeDailySolarGeneration(userName, dateFrom || undefined, dateTo || undefined);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} solar records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onPurgeAll={async () => {
            setPurgeLoading(true);
            try {
              const r = await purgeDailySolarGeneration(userName);
              setConfirmPurge(false);
              pushToast({ type: 'success', message: `${r.purged} solar records purged` });
            } catch (err) {
              pushToast({ type: 'error', message: `Purge failed: ${err.message}` });
            } finally { setPurgeLoading(false); }
          }}
          onClose={() => setConfirmPurge(false)}
          loading={purgeLoading}
        />
      )}
    </div>
  );
}

function RenewableTab({ store, currentMK, dateFrom, dateTo }) {
  const { dailyUtilityLog, dailySolarGeneration, energySettings } = store;
  const filteredSolar = useMemo(() => dailySolarGeneration.filter((l) => dateInRange(l.date, dateFrom, dateTo)), [dailySolarGeneration, dateFrom, dateTo]);
  const data = useMemo(() => computeRenewableSummary(dailyUtilityLog, filteredSolar, energySettings, currentMK), [dailyUtilityLog, filteredSolar, energySettings, currentMK]);

  const months = useMemo(() => {
    const keys = new Set();
    dailyUtilityLog.forEach((l) => { const m = l.date?.slice(0, 7); if (m) keys.add(m); });
    filteredSolar.forEach((l) => { const m = l.date?.slice(0, 7); if (m) keys.add(m); });
    return [...keys].sort().slice(-12);
  }, [dailyUtilityLog, filteredSolar]);

  const monthlyData = useMemo(() => months.map((m) => computeRenewableSummary(dailyUtilityLog, filteredSolar, energySettings, m)), [months, dailyUtilityLog, filteredSolar, energySettings]);

  const trendData = useMemo(() => months.map((m, i) => ({ name: m, 'Share %': monthlyData[i]?.renewableSharePct || 0 })), [months, monthlyData]);
  const solarVsCons = useMemo(() => months.map((m, i) => ({ name: m, Solar: monthlyData[i]?.solarFromInverters || 0, Consumption: monthlyData[i]?.totalPlantConsumption || 0 })), [months, monthlyData]);
  const co2Data = useMemo(() => months.map((m, i) => ({ name: m, CO2: monthlyData[i]?.co2AvoidedKg || 0 })), [months, monthlyData]);
  const pieData = useMemo(() => {
    if (data.totalPlantConsumption <= 0) return [];
    const solar = data.solarFromInverters || 0;
    const rest = Math.max(0, data.totalPlantConsumption - solar);
    const d = [];
    if (solar > 0) d.push({ name: 'Solar', value: solar, color: C.solar });
    if (rest > 0) d.push({ name: 'Grid+DG', value: rest, color: C.grid });
    return d;
  }, [data]);

  return (
    <div className="space-y-5">
      {data.warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-control px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
          <div>
            <p className="text-amber-300 text-sm font-medium">Solar Metering Cross-Check Required</p>
            {data.warnings.map((w, i) => <p key={i} className="text-amber-200/70 text-xs mt-0.5">{w}</p>)}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Solar Generation" value={data.solarFromInverters} unit="kWh" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Renewable Share" value={`${data.renewableSharePct}%`} color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="CO2 Avoided" value={data.co2AvoidedKg.toLocaleString()} unit="kg" color="text-emerald-300" bg="bg-emerald-500/[0.07] border-emerald-500/20" />
        <KpiCard label="Performance Ratio" value={`${data.performanceRatio}%`} color="text-white" />
      </div>
      {monthlyData.length > 0 && (
        <div className="space-y-4">
          <ChartCard title="Renewable Share Trend"><ResponsiveContainer width="100%" height={300}><LineChart data={trendData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Line type="monotone" dataKey="Share %" stroke={C.solar} dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Solar vs Plant Consumption"><ResponsiveContainer width="100%" height={300}><BarChart data={solarVsCons}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Solar" fill={C.solar} radius={[4, 4, 0, 0]} /><Bar dataKey="Consumption" fill={C.grid} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
          <ChartCard title="CO2 Avoided Trend"><ResponsiveContainer width="100%" height={300}><BarChart data={co2Data}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" /><XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} /><YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip {...TTIP} /><Bar dataKey="CO2" fill={C.solar} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
          {pieData.length > 0 && (
            <ChartCard title="Grid vs DG vs Solar"><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>{pieData.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip {...TTIP} /></PieChart></ResponsiveContainer></ChartCard>
          )}
        </div>
      )}
      {monthlyData.length === 0 && <EmptyState title="No renewable data available." description="Renewable data is computed from daily utility and solar generation logs." />}
    </div>
  );
}

function SettingsTab({ store, userName, isAdmin, onAdd, formOpen, editRow, formValues, setForm, closeForm, pushToast }) {
  const { energySettings } = store;
  const [editMode, setEditMode] = useState(false);
  const [vals, setVals] = useState({ ...energySettings });
  const sf = (k, v) => setVals((p) => ({ ...p, [k]: v }));

  const fields = useMemo(() => [
    nf('u1ImportExportCt', 'U1 Import/Export CT Ratio', '1'), nf('u1SolarCt', 'U1 Solar CT Ratio', '1'),
    nf('u2ImportExportCt', 'U2 Import/Export CT Ratio', '1'), nf('u2SolarCt', 'U2 Solar CT Ratio', '1'),
    nf('pfWarningThreshold', 'PF Warning Threshold', '0.01'), nf('installedSolarCapacityKwp', 'Installed Solar Capacity (kWp)', '0.1'),
    nf('gridCo2EmissionFactor', 'Grid CO2 Factor (kg/kWh)', '0.001'), nf('avgPeakSunHoursPerDay', 'Avg Peak Sun Hours/Day', '0.1'),
  ], []);

  const handleSave = () => {
    upsertEnergySettings(vals, userName);
    pushToast({ type: 'success', message: 'Energy settings saved' });
    setEditMode(false);
  };

  return (
    <div className="space-y-5">
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-card-title flex items-center gap-2"><Settings size={14} className="text-cyan-400" /> Energy Configuration</h3>
            <p className="text-meta mt-0.5">CT ratios, thresholds, and solar parameters used in derived calculations.</p>
          </div>
          {isAdmin && !editMode && (
            <button onClick={() => { setVals({ ...energySettings }); setEditMode(true); }} className="btn-primary inline-flex items-center gap-1.5 text-xs"><Pencil size={13} /> Edit Settings</button>
          )}
        </div>
        {editMode ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className={lblCls}>{f.label}</label>
                  <input type="number" step={f.step || '0.1'} min="0" value={vals[f.key] || ''} onChange={(e) => sf(f.key, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditMode(false)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handleSave} className="btn-primary text-xs">Save Settings</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'U1 Import/Export CT Ratio', value: energySettings.u1ImportExportCt },
              { label: 'U1 Solar CT Ratio', value: energySettings.u1SolarCt },
              { label: 'U2 Import/Export CT Ratio', value: energySettings.u2ImportExportCt },
              { label: 'U2 Solar CT Ratio', value: energySettings.u2SolarCt },
              { label: 'PF Warning Threshold', value: energySettings.pfWarningThreshold },
              { label: 'Installed Solar Capacity (kWp)', value: energySettings.installedSolarCapacityKwp },
              { label: 'Grid CO2 Factor (kg/kWh)', value: energySettings.gridCo2EmissionFactor },
              { label: 'Avg Peak Sun Hours/Day', value: energySettings.avgPeakSunHoursPerDay },
            ].map((k) => (
              <div key={k.label} className="rounded-control bg-white/[0.04] border border-white/[0.10] p-3">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">{k.label}</p>
                <p className="text-white text-lg font-bold tabular-nums">{k.value ?? '—'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Energy() {
  const { user } = useAuth();
  const { openUpload, pushToast } = useUI();
  const store = useStore();
  const {
    dailyUtilityLog, monthlyHerbicide, monthlyInsecticide,
    monthlyWater, monthlyAirCompressor, dailySolarGeneration, energySettings,
  } = store;

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';
  const [activeTab, setActiveTab] = useState('dailyUtility');
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [filterPreset, setFilterPreset] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [registerMonth, setRegisterMonth] = useState('');

  // Simple in-memory cache for tab data to avoid re-computation on tab switches
  const tabDataCache = useRef(new Map());
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  const getCachedTabData = useCallback((tabKey) => {
    const entry = tabDataCache.current.get(tabKey);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.data;
    }
    return null;
  }, []);

  const setCachedTabData = useCallback((tabKey, data) => {
    tabDataCache.current.set(tabKey, { data, timestamp: Date.now() });
  }, []);

  const invalidateTabCache = useCallback((tabKey) => {
    if (tabKey) {
      tabDataCache.current.delete(tabKey);
    } else {
      tabDataCache.current.clear();
    }
  }, []);

  const setForm = useCallback((k, v) => setFormValues((p) => ({ ...p, [k]: v })), []);
  const openAddForm = useCallback((d) => { setEditRow(null); setFormValues(d || {}); setFormOpen(true); }, []);
  const openEditForm = useCallback((r) => { setEditRow(r); setFormValues({ ...r }); setFormOpen(true); }, []);
  const closeForm = useCallback(() => { setFormOpen(false); setEditRow(null); setFormValues({}); }, []);

  const applyPreset = useCallback((label) => {
    const p = FILTER_PRESETS.find((x) => x.label === label);
    if (p) { const r = p.get(); setFilterPreset(label); setDateFrom(r.from); setDateTo(r.to); }
    setPage(0);
  }, []);

  const setFilterDate = useCallback((k, v) => {
    setFilterPreset('');
    if (k === 'from') setDateFrom(v); else setDateTo(v);
    setPage(0);
  }, []);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMK = useMemo(() => mk(new Date()), []);

  const monthTabs = useMemo(() => {
    const counts = {};
    dailyUtilityLog.forEach((r) => {
      const m = String(r.date || '').slice(0, 7);
      if (m) counts[m] = (counts[m] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [dailyUtilityLog]);

  const switchTab = useCallback((k) => { 
    setActiveTab(k); 
    setPage(0); 
    setRegisterMonth(''); 
  }, []);

  const formTitle = editRow ? 'Edit ' + activeTab : 'Add ' + activeTab.replace(/([A-Z])/g, ' $1').trim();
  const formSubtitle = editRow ? (editRow.date || editRow.month || '') : '';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-page-title flex items-center gap-3">
          <Zap size={28} className="text-amber-400" /> Energy Management
        </h2>
        <p className="text-body mt-1.5">Track utility, herbicide, insecticide, water, air compressor, solar and renewable energy metrics.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => switchTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap rounded-lg transition-colors ${isActive ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'}`}>
              <Icon size={13} /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab !== 'settings' && activeTab !== 'dailyUtility' && (
        <div className="glass-card px-4 py-3 flex items-center gap-3 flex-wrap">
          <Calendar size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-xs text-slate-400 font-medium">Period:</span>
          <div className="flex gap-1 flex-wrap">
            {FILTER_PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p.label)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${filterPreset === p.label ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-slate-400 hover:text-white border border-transparent hover:bg-white/[0.05]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-white/[0.1] mx-1 hidden sm:block" />
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setFilterDate('from', e.target.value)}
              className="text-xs bg-white/[0.06] border border-white/[0.12] rounded-control px-2 py-1 text-slate-300 focus:outline-none focus:border-cyan-400/60" />
            <span className="text-xs text-slate-500">to</span>
            <input type="date" value={dateTo} onChange={(e) => setFilterDate('to', e.target.value)}
              className="text-xs bg-white/[0.06] border border-white/[0.12] rounded-control px-2 py-1 text-slate-300 focus:outline-none focus:border-cyan-400/60" />
          </div>
        </div>
      )}

      {activeTab === 'dailyUtility' && (
        <DailyUtilityTab store={store} settings={energySettings} userName={userName} isAdmin={isAdmin}
          dateFrom={dateFrom} dateTo={dateTo} registerMonth={registerMonth} setRegisterMonth={setRegisterMonth} monthTabs={monthTabs}
          onAdd={openAddForm} onEdit={openEditForm} onUpload={openUpload}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm} closeForm={closeForm}
          page={page} setPage={setPage} todayStr={todayStr} currentMK={currentMK} pushToast={pushToast} />
      )}
      {activeTab === 'herbicide' && (
        <HerbicideTab store={store} userName={userName} isAdmin={isAdmin}
          dateFrom={dateFrom} dateTo={dateTo} onAdd={openAddForm} onEdit={openEditForm} onUpload={openUpload}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm} closeForm={closeForm}
          page={page} setPage={setPage} currentMK={currentMK} pushToast={pushToast} />
      )}
      {activeTab === 'insecticide' && (
        <InsecticideTab store={store} userName={userName} isAdmin={isAdmin}
          dateFrom={dateFrom} dateTo={dateTo} onAdd={openAddForm} onEdit={openEditForm} onUpload={openUpload}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm} closeForm={closeForm}
          page={page} setPage={setPage} currentMK={currentMK} pushToast={pushToast} />
      )}
      {activeTab === 'water' && (
        <WaterTab store={store} userName={userName} isAdmin={isAdmin}
          dateFrom={dateFrom} dateTo={dateTo} onAdd={openAddForm} onEdit={openEditForm} onUpload={openUpload}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm} closeForm={closeForm}
          page={page} setPage={setPage} currentMK={currentMK} pushToast={pushToast} />
      )}
      {activeTab === 'airCompressor' && (
        <AirCompressorTab store={store} userName={userName} isAdmin={isAdmin}
          dateFrom={dateFrom} dateTo={dateTo} onAdd={openAddForm} onEdit={openEditForm} onUpload={openUpload}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm} closeForm={closeForm}
          page={page} setPage={setPage} currentMK={currentMK} pushToast={pushToast} />
      )}
      {activeTab === 'solar' && (
        <SolarTab store={store} userName={userName} isAdmin={isAdmin}
          dateFrom={dateFrom} dateTo={dateTo} onAdd={openAddForm} onEdit={openEditForm} onUpload={openUpload}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm} closeForm={closeForm}
          page={page} setPage={setPage} todayStr={todayStr} currentMK={currentMK} pushToast={pushToast} />
      )}
      {activeTab === 'renewable' && (
        <RenewableTab store={store} currentMK={currentMK} dateFrom={dateFrom} dateTo={dateTo} />
      )}
      {activeTab === 'settings' && (
        <SettingsTab store={store} userName={userName} isAdmin={isAdmin}
          formOpen={formOpen} editRow={editRow} formValues={formValues} setForm={setForm}
          closeForm={closeForm} pushToast={pushToast} />
      )}
    </div>
  );
}
