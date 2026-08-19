import { useState, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import {
  useStore,
  addDailyUtilityLog, updateDailyUtilityLog, deleteDailyUtilityLog,
  addMonthlyHerbicide, addMonthlyInsecticide,
  addMonthlyWater, addMonthlyAirCompressor,
  addDailySolarGeneration,
  upsertEnergySettings,
} from '../store.js';
import {
  computeDailyUtilityDerived,
  computeHerbicideConsumption,
  computeInsecticideConsumption,
  computeWaterConsumption,
  computeAirCompressorPerformance,
  computeRenewableSummary,
} from '../analytics.js';
import { downloadTemplate } from '../bulkImport.js';
import EmptyState from '../components/EmptyState.jsx';
import {
  Zap, Sun, Droplets, Wind, Settings, Download, Upload, Plus, Trash2, Pencil, AlertTriangle,
} from 'lucide-react';

const PAGE_SIZE = 15;

const TABS = [
  { key: 'dailyUtility', label: 'Daily Utility', icon: Zap },
  { key: 'herbicide', label: 'Herbicide', icon: Sun },
  { key: 'insecticide', label: 'Insecticide', icon: Zap },
  { key: 'water', label: 'Water', icon: Droplets },
  { key: 'airCompressor', label: 'Air Compressor', icon: Wind },
  { key: 'solar', label: 'Solar', icon: Sun },
  { key: 'renewable', label: 'Renewable', icon: Zap },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const r1 = (n) => Math.round(n * 10) / 10;
const monthKey = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function Pagination({ page, total, onChange }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
      <span className="text-xs text-slate-500">
        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page === 0} className="btn-ghost text-xs px-2 py-1 disabled:opacity-30">Prev</button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let p = i;
          if (totalPages > 5) {
            if (page < 3) p = i;
            else if (page > totalPages - 4) p = totalPages - 5 + i;
            else p = page - 2 + i;
          }
          return (
            <button key={p} onClick={() => onChange(p)}
              className={`text-xs px-2 py-1 rounded ${p === page ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-400 hover:text-white'}`}>
              {p + 1}
            </button>
          );
        })}
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages - 1} className="btn-ghost text-xs px-2 py-1 disabled:opacity-30">Next</button>
      </div>
    </div>
  );
}

function FormModal({ title, subtitle, fields, values, onChange, onSave, onClose }) {
  const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const labelCls = 'block text-xs text-slate-400 mb-1';
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-card-title">{title}</h3>
            {subtitle && <p className="text-meta mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><Pencil size={16} className="rotate-45" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.full ? 'col-span-2' : ''}>
                <label className={labelCls}>{f.label}{f.required && ' *'}</label>
                {f.type === 'select' ? (
                  <select value={values[f.key] || ''} onChange={(e) => onChange(f.key, e.target.value)} className={inputCls}>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type === 'number' ? 'number' : f.type} min={f.type === 'number' ? '0' : undefined}
                    step={f.step || (f.type === 'number' ? '0.1' : undefined)}
                    value={values[f.key] || ''} onChange={(e) => onChange(f.key, e.target.value)}
                    className={inputCls} placeholder={f.placeholder || ''} />
                )}
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

function TableHeader({ columns, admin }) {
  return (
    <thead>
      <tr>
        {columns.map((c) => <th key={c.key} className={c.className || ''}>{c.label}</th>)}
        {admin && <th className="w-20 text-right" aria-label="Actions" />}
      </tr>
    </thead>
  );
}

function TableCell({ value, className }) {
  if (value === null || value === undefined || value === '') return <td className="text-slate-600">—</td>;
  return <td className={className || 'text-white tabular-nums'}>{typeof value === 'number' ? value.toLocaleString() : value}</td>;
}

function ActionButtons({ onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {onEdit && <button onClick={onEdit} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit"><Pencil size={13} /></button>}
      {onDelete && <button onClick={onDelete} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete"><Trash2 size={13} /></button>}
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
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const setForm = useCallback((k, v) => setFormValues((prev) => ({ ...prev, [k]: v })), []);

  const openAddForm = useCallback((defaults) => {
    setEditRow(null);
    setFormValues(defaults || {});
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((row) => {
    setEditRow(row);
    setFormValues({ ...row });
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => { setFormOpen(false); setEditRow(null); setFormValues({}); }, []);

  const currentMK = useMemo(() => monthKey(new Date()), []);

  // ── Daily Utility ─────────────────────────────────────────────────────────
  const sortedUtility = useMemo(
    () => [...dailyUtilityLog].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [dailyUtilityLog]
  );

  const todayStr = new Date().toISOString().slice(0, 10);

  const utilityKpis = useMemo(() => {
    const today = sortedUtility.find((r) => (r.date || '').slice(0, 10) === todayStr);
    const yesterday = sortedUtility.find((r) => {
      const d = new Date(r.date);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10) === todayStr;
    }) || sortedUtility[1];

    const u1Grid = today ? r1((Number(today.u1ImportKwhReading) || 0) - (Number(yesterday?.u1ImportKwhReading) || 0)) : 0;
    const u2Grid = today ? r1((Number(today.u2ImportKwhReading) || 0) - (Number(yesterday?.u2ImportKwhReading) || 0)) : 0;
    const gridImport = r1(u1Grid + u2Grid);

    const dg380 = today ? r1((Number(today.dg380KwhReading) || 0) - (Number(yesterday?.dg380KwhReading) || 0)) : 0;
    const dg500 = today ? r1((Number(today.dg500KwhReading) || 0) - (Number(yesterday?.dg500KwhReading) || 0)) : 0;
    const dgGen = r1(dg380 + dg500);

    const solar = today
      ? r1(((Number(today.u1SolarKwhReading) || 0) - (Number(yesterday?.u1SolarKwhReading) || 0))
        + ((Number(today.u2SolarKwhReading) || 0) - (Number(yesterday?.u2SolarKwhReading) || 0)))
      : 0;

    const u1Pf = today && Number(today.u1ImportKvahReading) > 0
      ? r1((Number(today.u1ImportKwhReading) || 0) / (Number(today.u1ImportKvahReading) || 1))
      : 0;
    const u2Pf = today && Number(today.u2ImportKvahReading) > 0
      ? r1((Number(today.u2ImportKwhReading) || 0) / (Number(today.u2ImportKvahReading) || 1))
      : 0;
    const overallPf = (u1Pf + u2Pf) > 0 ? r1((u1Pf + u2Pf) / 2) : 0;

    return { gridImport, dgGen, solar, overallPf };
  }, [sortedUtility, todayStr]);

  const utilityPage = useMemo(() => sortedUtility.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedUtility, page]);

  const handleSaveDailyUtility = () => {
    if (!formValues.date) { pushToast({ type: 'error', message: 'Date is required' }); return; }
    if (editRow) { updateDailyUtilityLog(editRow.id, formValues, userName); }
    else { addDailyUtilityLog(formValues, userName); }
    closeForm();
  };

  // ── Herbicide ─────────────────────────────────────────────────────────────
  const sortedHerbicide = useMemo(
    () => [...monthlyHerbicide].sort((a, b) => (b.month || '').localeCompare(a.month || '')),
    [monthlyHerbicide]
  );

  const herbicideWithConsumption = useMemo(() => {
    return sortedHerbicide.map((row, idx) => {
      const prev = sortedHerbicide[idx + 1];
      const calc = (key) => r1((Number(row[key]) || 0) - (Number(prev?.[key]) || 0));
      const g1 = calc('glyphosateM1MeterReading');
      const t2 = calc('maintenanceTopperM2MeterReading');
      const a3 = calc('acmHerbicideM3MeterReading');
      const t4 = calc('topperHerbicideM4MeterReading');
      const pr = calc('maintenancePrintingMeterReading');
      const total = r1(g1 + t2 + a3 + t4 + pr);
      return { ...row, _g1: g1, _t2: t2, _a3: a3, _t4: t4, _pr: pr, _total: total };
    });
  }, [sortedHerbicide]);

  const herbicidePage = useMemo(() => herbicideWithConsumption.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [herbicideWithConsumption, page]);

  const handleSaveHerbicide = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) { pushToast({ type: 'info', message: 'Edit not supported — delete and re-add' }); }
    else { addMonthlyHerbicide(formValues, userName); }
    closeForm();
  };

  // ── Insecticide ───────────────────────────────────────────────────────────
  const sortedInsecticide = useMemo(
    () => [...monthlyInsecticide].sort((a, b) => (b.month || '').localeCompare(a.month || '')),
    [monthlyInsecticide]
  );

  const insecticideWithConsumption = useMemo(() => {
    const FIELDS = [
      'feeder2ScElectricRoomMeterReading', 'feeder3WaterbathMeterReading', 'feeder4JetmillMeterReading',
      'feeder5CartapPlantMeterReading', 'feeder6EcFormulationMeterReading', 'feeder7SpareMeterReading',
      'feeder8EcPackingMeterReading', 'feeder9AdminBlockMeterReading', 'acmInsecticideMeterReading',
      'airCompressor02IrMeterReading', 'airCompressor03AtlasMeterReading', 'airCompressor01IrAtlasMeterReading',
    ];
    return sortedInsecticide.map((row, idx) => {
      const prev = sortedInsecticide[idx + 1];
      const calc = (key) => r1((Number(row[key]) || 0) - (Number(prev?.[key]) || 0));
      const feeders = FIELDS.map((k) => calc(k));
      const total = r1(feeders.reduce((s, v) => s + v, 0));
      return { ...row, _feeders: feeders, _total: total };
    });
  }, [sortedInsecticide]);

  const insecticidePage = useMemo(() => insecticideWithConsumption.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [insecticideWithConsumption, page]);

  const handleSaveInsecticide = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) { pushToast({ type: 'info', message: 'Edit not supported — delete and re-add' }); }
    else { addMonthlyInsecticide(formValues, userName); }
    closeForm();
  };

  // ── Water ─────────────────────────────────────────────────────────────────
  const sortedWater = useMemo(
    () => [...monthlyWater].sort((a, b) => (b.month || '').localeCompare(a.month || '')),
    [monthlyWater]
  );

  const waterWithConsumption = useMemo(() => {
    const KEYS = ['stpOutletMeterReading', 'roInletMeterReading', 'roRejectedMeterReading', 'piauWaterMeterReading'];
    return sortedWater.map((row, idx) => {
      const prev = sortedWater[idx + 1];
      const calc = (key) => r1((Number(row[key]) || 0) - (Number(prev?.[key]) || 0));
      const vals = KEYS.map((k) => calc(k));
      const total = r1(vals.reduce((s, v) => s + v, 0));
      return { ...row, _vals: vals, _total: total };
    });
  }, [sortedWater]);

  const waterPage = useMemo(() => waterWithConsumption.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [waterWithConsumption, page]);

  const handleSaveWater = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) { pushToast({ type: 'info', message: 'Edit not supported — delete and re-add' }); }
    else { addMonthlyWater(formValues, userName); }
    closeForm();
  };

  // ── Air Compressor ────────────────────────────────────────────────────────
  const sortedAirCompressor = useMemo(
    () => [...monthlyAirCompressor].sort((a, b) => (b.month || '').localeCompare(a.month || '')),
    [monthlyAirCompressor]
  );

  const airCompressorWithMetrics = useMemo(() => {
    return sortedAirCompressor.map((row, idx) => {
      const prev = sortedAirCompressor[idx + 1];
      const calc = (key) => r1((Number(row[key]) || 0) - (Number(prev?.[key]) || 0));
      return {
        ...row,
        _c1Run: calc('compressor1RunHrsReading'), _c1Load: calc('compressor1LoadHrsReading'),
        _c1Unload: r1(Math.max(0, calc('compressor1RunHrsReading') - calc('compressor1LoadHrsReading'))),
        _c1Pct: calc('compressor1RunHrsReading') > 0 ? r1((calc('compressor1LoadHrsReading') / calc('compressor1RunHrsReading')) * 100) : 0,
        _c2Run: calc('compressor2RunHrsReading'), _c2Load: calc('compressor2LoadHrsReading'),
        _c2Unload: r1(Math.max(0, calc('compressor2RunHrsReading') - calc('compressor2LoadHrsReading'))),
        _c2Pct: calc('compressor2RunHrsReading') > 0 ? r1((calc('compressor2LoadHrsReading') / calc('compressor2RunHrsReading')) * 100) : 0,
        _c3Run: calc('compressor3RunHrsReading'), _c3Load: calc('compressor3LoadHrsReading'),
        _c3Unload: r1(Math.max(0, calc('compressor3RunHrsReading') - calc('compressor3LoadHrsReading'))),
        _c3Pct: calc('compressor3RunHrsReading') > 0 ? r1((calc('compressor3LoadHrsReading') / calc('compressor3RunHrsReading')) * 100) : 0,
      };
    });
  }, [sortedAirCompressor]);

  const airCompressorPage = useMemo(() => airCompressorWithMetrics.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [airCompressorWithMetrics, page]);

  const handleSaveAirCompressor = () => {
    if (!formValues.month) { pushToast({ type: 'error', message: 'Month is required' }); return; }
    if (editRow) { pushToast({ type: 'info', message: 'Edit not supported — delete and re-add' }); }
    else { addMonthlyAirCompressor(formValues, userName); }
    closeForm();
  };

  // ── Solar ─────────────────────────────────────────────────────────────────
  const sortedSolar = useMemo(
    () => [...dailySolarGeneration].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [dailySolarGeneration]
  );

  const solarPage = useMemo(() => sortedSolar.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedSolar, page]);

  const handleSaveSolar = () => {
    if (!formValues.date) { pushToast({ type: 'error', message: 'Date is required' }); return; }
    if (editRow) { pushToast({ type: 'info', message: 'Edit not supported — delete and re-add' }); }
    else { addDailySolarGeneration(formValues, userName); }
    closeForm();
  };

  // ── Renewable ─────────────────────────────────────────────────────────────
  const renewableData = useMemo(() => {
    return computeRenewableSummary(dailyUtilityLog, dailySolarGeneration, energySettings, currentMK);
  }, [dailyUtilityLog, dailySolarGeneration, energySettings, currentMK]);

  // ── Settings ──────────────────────────────────────────────────────────────
  const handleSaveSettings = () => {
    upsertEnergySettings(formValues, userName);
    pushToast({ type: 'success', message: 'Energy settings saved' });
    closeForm();
  };

  // ── Reset page on tab change ──────────────────────────────────────────────
  const switchTab = useCallback((key) => {
    setActiveTab(key);
    setPage(0);
  }, []);

  // ── Form field configs ────────────────────────────────────────────────────
  const numberField = (key, label, step) => ({ key, label, type: 'number', step: step || '0.1' });

  const dailyUtilityFields = [
    { key: 'date', label: 'Date', type: 'date', required: true },
    numberField('u1ImportKwhReading', 'U1 Import kWh'),
    numberField('u1ImportKvahReading', 'U1 Import kVAh'),
    numberField('u1ExportKwhReading', 'U1 Export kWh'),
    numberField('u2ImportKwhReading', 'U2 Import kWh'),
    numberField('u2ImportKvahReading', 'U2 Import kVAh'),
    numberField('u2ExportKwhReading', 'U2 Export kWh'),
    numberField('dg380KwhReading', 'DG380 kWh'),
    numberField('dg380HourmeterReading', 'DG380 Hourmeter'),
    numberField('dg380HsdAddedLtr', 'DG380 HSD Added (L)'),
    numberField('dg500KwhReading', 'DG500 kWh'),
    numberField('dg500HourmeterReading', 'DG500 Hourmeter'),
    numberField('dg500HsdAddedLtr', 'DG500 HSD Added (L)'),
  ];

  const herbicideFields = [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    numberField('glyphosateM1MeterReading', 'Glyphosate M1'),
    numberField('maintenanceTopperM2MeterReading', 'Topper M2'),
    numberField('acmHerbicideM3MeterReading', 'ACM M3'),
    numberField('topperHerbicideM4MeterReading', 'Topper M4'),
    numberField('maintenancePrintingMeterReading', 'Printing'),
  ];

  const insecticideFields = [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    numberField('feeder2ScElectricRoomMeterReading', 'Feeder 2'),
    numberField('feeder3WaterbathMeterReading', 'Feeder 3'),
    numberField('feeder4JetmillMeterReading', 'Feeder 4'),
    numberField('feeder5CartapPlantMeterReading', 'Feeder 5'),
    numberField('feeder6EcFormulationMeterReading', 'Feeder 6'),
    numberField('feeder7SpareMeterReading', 'Feeder 7'),
    numberField('feeder8EcPackingMeterReading', 'Feeder 8'),
    numberField('feeder9AdminBlockMeterReading', 'Feeder 9'),
    numberField('acmInsecticideMeterReading', 'ACM'),
    numberField('airCompressor02IrMeterReading', 'Comp 02 (IR)'),
    numberField('airCompressor03AtlasMeterReading', 'Comp 03 (Atlas)'),
    numberField('airCompressor01IrAtlasMeterReading', 'Comp 01 (IR Atlas)'),
  ];

  const waterFields = [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    numberField('stpOutletMeterReading', 'STP Outlet'),
    numberField('roInletMeterReading', 'RO Inlet'),
    numberField('roRejectedMeterReading', 'RO Rejected'),
    numberField('piauWaterMeterReading', 'PIAU Water'),
  ];

  const airCompressorFields = [
    { key: 'month', label: 'Month (YYYY-MM)', type: 'text', required: true, placeholder: '2026-01' },
    numberField('compressor1RunHrsReading', 'Comp1 Run Hrs'),
    numberField('compressor1LoadHrsReading', 'Comp1 Load Hrs'),
    numberField('compressor2RunHrsReading', 'Comp2 Run Hrs'),
    numberField('compressor2LoadHrsReading', 'Comp2 Load Hrs'),
    numberField('compressor3RunHrsReading', 'Comp3 Run Hrs'),
    numberField('compressor3LoadHrsReading', 'Comp3 Load Hrs'),
  ];

  const solarFields = [
    { key: 'date', label: 'Date', type: 'date', required: true },
    numberField('u1Inv1Kwh', 'U1 Inv1 kWh'),
    numberField('u1Inv2Kwh', 'U1 Inv2 kWh'),
    numberField('u1Inv3Kwh', 'U1 Inv3 kWh'),
    numberField('u1Inv4Kwh', 'U1 Inv4 kWh'),
    numberField('u2Inv1Kwh', 'U2 Inv1 kWh'),
    numberField('u2Inv2Kwh', 'U2 Inv2 kWh'),
    numberField('u2Inv3Kwh', 'U2 Inv3 kWh'),
    numberField('dailyTotalKwh', 'Daily Total kWh', '0.1'),
  ];

  const settingsFields = [
    numberField('u1ImportExportCt', 'U1 Import/Export CT Ratio', '1'),
    numberField('u1SolarCt', 'U1 Solar CT Ratio', '1'),
    numberField('u2ImportExportCt', 'U2 Import/Export CT Ratio', '1'),
    numberField('u2SolarCt', 'U2 Solar CT Ratio', '1'),
    numberField('pfWarningThreshold', 'PF Warning Threshold', '0.01'),
    numberField('installedSolarCapacityKwp', 'Installed Solar Capacity (kWp)', '0.1'),
    numberField('gridCo2EmissionFactor', 'Grid CO2 Factor (kg/kWh)', '0.001'),
    numberField('avgPeakSunHoursPerDay', 'Avg Peak Sun Hours/Day', '0.1'),
  ];

  const formTitle = editRow ? `Edit ${activeTab}` : `Add ${activeTab.replace(/([A-Z])/g, ' $1').trim()}`;
  const formSubtitle = editRow ? `${editRow.date || editRow.month || ''}` : '';
  const formFieldsMap = {
    dailyUtility: dailyUtilityFields,
    herbicide: herbicideFields,
    insecticide: insecticideFields,
    water: waterFields,
    airCompressor: airCompressorFields,
    solar: solarFields,
    settings: settingsFields,
  };
  const formSaveMap = {
    dailyUtility: handleSaveDailyUtility,
    herbicide: handleSaveHerbicide,
    insecticide: handleSaveInsecticide,
    water: handleSaveWater,
    airCompressor: handleSaveAirCompressor,
    solar: handleSaveSolar,
    settings: handleSaveSettings,
  };

  const renderActionBtns = (row, onAdd, moduleKind) => (
    <>
      {isAdmin && (
        <>
          <button onClick={() => openAddForm(onAdd)} className="btn-primary inline-flex items-center gap-1.5 text-xs">
            <Plus size={13} /> Add {onAdd?.month ? 'Monthly' : 'Daily'} Reading
          </button>
          <button onClick={() => openUpload({ kind: 'bulk', module: moduleKind })} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
            <Upload size={13} /> Upload Excel
          </button>
          <button onClick={() => downloadTemplate(moduleKind)} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
            <Download size={13} /> Download Template
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── Page Header ── */}
      <div>
        <h2 className="text-page-title flex items-center gap-3">
          <Zap size={28} className="text-amber-400" /> Energy Management
        </h2>
        <p className="text-body mt-1.5">Track utility, herbicide, insecticide, water, air compressor, solar and renewable energy metrics across all plant domains.</p>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => switchTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap rounded-lg transition-colors ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}>
              <Icon size={13} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Daily Utility                                                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'dailyUtility' && (
        <div className="space-y-5">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Today's Grid Import", value: utilityKpis.gridImport, unit: 'kWh', color: 'text-cyan-300', bg: 'bg-cyan-500/[0.07] border-cyan-500/20' },
              { label: "Today's DG Generation", value: utilityKpis.dgGen, unit: 'kWh', color: 'text-amber-300', bg: 'bg-amber-500/[0.07] border-amber-500/20' },
              { label: "Today's Solar", value: utilityKpis.solar, unit: 'kWh', color: 'text-emerald-300', bg: 'bg-emerald-500/[0.07] border-emerald-500/20' },
              { label: 'Overall PF', value: utilityKpis.overallPf, unit: '', color: utilityKpis.overallPf < 0.9 ? 'text-red-300' : 'text-white', bg: utilityKpis.overallPf < 0.9 ? 'bg-red-500/[0.07] border-red-500/20' : 'bg-white/[0.04] border-white/[0.10]' },
            ].map((k) => (
              <div key={k.label} className={`rounded-control border p-4 ${k.bg}`}>
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5 leading-tight">{k.label}</p>
                <p className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</p>
                <p className="text-slate-500 text-xs mt-0.5">{k.unit}</p>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {renderActionBtns(null, { date: todayStr }, 'dailyUtilityLog')}
          </div>

          {/* Table */}
          <div className="glass-card overflow-hidden">
            {utilityPage.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No daily utility readings" description="Add daily meter readings to track grid import, DG generation, and fuel consumption." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full min-w-[1400px]">
                  <TableHeader columns={[
                    { key: 'date', label: 'Date' },
                    { key: 'u1ImportKwh', label: 'U1 Import kWh', className: 'text-cyan-400' },
                    { key: 'u1ImportKvah', label: 'U1 Import kVAh' },
                    { key: 'u1Pf', label: 'U1 PF' },
                    { key: 'u1ExportKwh', label: 'U1 Export kWh' },
                    { key: 'u2ImportKwh', label: 'U2 Import kWh', className: 'text-violet-400' },
                    { key: 'u2ImportKvah', label: 'U2 Import kVAh' },
                    { key: 'u2Pf', label: 'U2 PF' },
                    { key: 'u2ExportKwh', label: 'U2 Export kWh' },
                    { key: 'dg380Kwh', label: 'DG380 kWh', className: 'text-orange-400' },
                    { key: 'dg380Hrs', label: 'DG380 Hrs' },
                    { key: 'dg380Fuel', label: 'DG380 Fuel (L)' },
                    { key: 'dg500Kwh', label: 'DG500 kWh', className: 'text-amber-400' },
                    { key: 'dg500Hrs', label: 'DG500 Hrs' },
                    { key: 'dg500Fuel', label: 'DG500 Fuel (L)' },
                  ]} admin={isAdmin} />
                  <tbody>
                    {utilityPage.map((r) => {
                      const u1Pf = Number(r.u1ImportKvahReading) > 0 ? r1((Number(r.u1ImportKwhReading) || 0) / Number(r.u1ImportKvahReading)) : 0;
                      const u2Pf = Number(r.u2ImportKvahReading) > 0 ? r1((Number(r.u2ImportKwhReading) || 0) / Number(r.u2ImportKvahReading)) : 0;
                      return (
                        <tr key={r.id}>
                          <td className="text-slate-300 whitespace-nowrap">{r.date || '—'}</td>
                          <TableCell value={r.u1ImportKwhReading} className="text-cyan-300 tabular-nums" />
                          <TableCell value={r.u1ImportKvahReading} className="text-slate-300 tabular-nums" />
                          <TableCell value={u1Pf || '—'} className={u1Pf > 0 && u1Pf < 0.9 ? 'text-red-300 tabular-nums' : 'text-white tabular-nums'} />
                          <TableCell value={r.u1ExportKwhReading} className="text-slate-300 tabular-nums" />
                          <TableCell value={r.u2ImportKwhReading} className="text-violet-300 tabular-nums" />
                          <TableCell value={r.u2ImportKvahReading} className="text-slate-300 tabular-nums" />
                          <TableCell value={u2Pf || '—'} className={u2Pf > 0 && u2Pf < 0.9 ? 'text-red-300 tabular-nums' : 'text-white tabular-nums'} />
                          <TableCell value={r.u2ExportKwhReading} className="text-slate-300 tabular-nums" />
                          <TableCell value={r.dg380KwhReading} className="text-orange-300 tabular-nums" />
                          <TableCell value={r.dg380HourmeterReading} className="text-slate-300 tabular-nums" />
                          <TableCell value={r.dg380HsdAddedLtr} className="text-red-300 tabular-nums" />
                          <TableCell value={r.dg500KwhReading} className="text-amber-300 tabular-nums" />
                          <TableCell value={r.dg500HourmeterReading} className="text-slate-300 tabular-nums" />
                          <TableCell value={r.dg500HsdAddedLtr} className="text-red-300 tabular-nums" />
                          {isAdmin && (
                            <td className="text-right">
                              <ActionButtons
                                onEdit={() => openEditForm(r)}
                                onDelete={() => {
                                  if (window.confirm('Delete this daily utility reading?')) {
                                    deleteDailyUtilityLog(r.id, userName);
                                  }
                                }}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} total={sortedUtility.length} onChange={setPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Herbicide                                                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'herbicide' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {renderActionBtns(null, { month: currentMK }, 'herbicide')}
          </div>
          <div className="glass-card overflow-hidden">
            {herbicidePage.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No herbicide data" description="Add monthly herbicide section consumption readings." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full min-w-[900px]">
                  <TableHeader columns={[
                    { key: 'month', label: 'Month' },
                    { key: 'g1', label: 'Glyphosate M1', className: 'text-emerald-400' },
                    { key: 't2', label: 'Topper M2', className: 'text-cyan-400' },
                    { key: 'a3', label: 'ACM M3', className: 'text-violet-400' },
                    { key: 't4', label: 'Topper M4', className: 'text-amber-400' },
                    { key: 'pr', label: 'Printing', className: 'text-orange-400' },
                    { key: 'total', label: 'Total kWh', className: 'text-white font-semibold' },
                    { key: 'consumption', label: 'Consumption' },
                  ]} admin={isAdmin} />
                  <tbody>
                    {herbicidePage.map((r) => (
                      <tr key={r.id}>
                        <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                        <TableCell value={r._g1} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r._t2} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r._a3} className="text-violet-300 tabular-nums" />
                        <TableCell value={r._t4} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._pr} className="text-orange-300 tabular-nums" />
                        <TableCell value={r._total} className="text-white font-bold tabular-nums" />
                        <TableCell value={r._total} className="text-slate-200 tabular-nums" />
                        {isAdmin && (
                          <td className="text-right">
                            <ActionButtons onDelete={() => {
                              if (window.confirm('Delete this herbicide record?')) {
                                store.monthlyHerbicide = store.monthlyHerbicide.filter((e) => e.id !== r.id);
                              }
                            }} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} total={herbicideWithConsumption.length} onChange={setPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Insecticide                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'insecticide' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {renderActionBtns(null, { month: currentMK }, 'insecticide')}
          </div>
          <div className="glass-card overflow-hidden">
            {insecticidePage.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No insecticide data" description="Add monthly insecticide section consumption readings." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full min-w-[1200px]">
                  <TableHeader columns={[
                    { key: 'month', label: 'Month' },
                    { key: 'f2', label: 'F2 Elec Room', className: 'text-cyan-400' },
                    { key: 'f3', label: 'F3 Waterbath', className: 'text-cyan-400' },
                    { key: 'f4', label: 'F4 Jetmill', className: 'text-cyan-400' },
                    { key: 'f5', label: 'F5 Cartap', className: 'text-cyan-400' },
                    { key: 'f6', label: 'F6 EC Form', className: 'text-cyan-400' },
                    { key: 'f7', label: 'F7 Spare', className: 'text-cyan-400' },
                    { key: 'f8', label: 'F8 EC Pack', className: 'text-cyan-400' },
                    { key: 'f9', label: 'F9 Admin', className: 'text-cyan-400' },
                    { key: 'acm', label: 'ACM', className: 'text-violet-400' },
                    { key: 'c02', label: 'Comp 02', className: 'text-amber-400' },
                    { key: 'c03', label: 'Comp 03', className: 'text-amber-400' },
                    { key: 'c01', label: 'Comp 01', className: 'text-amber-400' },
                    { key: 'total', label: 'Total kWh', className: 'text-white font-semibold' },
                    { key: 'consumption', label: 'Consumption' },
                  ]} admin={isAdmin} />
                  <tbody>
                    {insecticidePage.map((r) => (
                      <tr key={r.id}>
                        <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                        {r._feeders.slice(0, 8).map((v, i) => (
                          <TableCell key={i} value={v} className="text-cyan-300 tabular-nums" />
                        ))}
                        <TableCell value={r._feeders[8]} className="text-violet-300 tabular-nums" />
                        <TableCell value={r._feeders[9]} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._feeders[10]} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._feeders[11]} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._total} className="text-white font-bold tabular-nums" />
                        <TableCell value={r._total} className="text-slate-200 tabular-nums" />
                        {isAdmin && (
                          <td className="text-right">
                            <ActionButtons onDelete={() => {
                              if (window.confirm('Delete this insecticide record?')) {
                                store.monthlyInsecticide = store.monthlyInsecticide.filter((e) => e.id !== r.id);
                              }
                            }} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} total={insecticideWithConsumption.length} onChange={setPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Water                                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'water' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {renderActionBtns(null, { month: currentMK }, 'water')}
          </div>
          <div className="glass-card overflow-hidden">
            {waterPage.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No water data" description="Add monthly water consumption readings (STP, RO, PIAU)." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full min-w-[800px]">
                  <TableHeader columns={[
                    { key: 'month', label: 'Month' },
                    { key: 'stp', label: 'STP Outlet', className: 'text-cyan-400' },
                    { key: 'roIn', label: 'RO Inlet', className: 'text-emerald-400' },
                    { key: 'roRej', label: 'RO Rejected', className: 'text-orange-400' },
                    { key: 'piau', label: 'PIAU Water', className: 'text-violet-400' },
                    { key: 'total', label: 'Total KL', className: 'text-white font-semibold' },
                    { key: 'consumption', label: 'Consumption' },
                  ]} admin={isAdmin} />
                  <tbody>
                    {waterPage.map((r) => (
                      <tr key={r.id}>
                        <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                        <TableCell value={r._vals[0]} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r._vals[1]} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r._vals[2]} className="text-orange-300 tabular-nums" />
                        <TableCell value={r._vals[3]} className="text-violet-300 tabular-nums" />
                        <TableCell value={r._total} className="text-white font-bold tabular-nums" />
                        <TableCell value={r._total} className="text-slate-200 tabular-nums" />
                        {isAdmin && (
                          <td className="text-right">
                            <ActionButtons onDelete={() => {
                              if (window.confirm('Delete this water record?')) {
                                store.monthlyWater = store.monthlyWater.filter((e) => e.id !== r.id);
                              }
                            }} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} total={waterWithConsumption.length} onChange={setPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Air Compressor                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'airCompressor' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {renderActionBtns(null, { month: currentMK }, 'airCompressor')}
          </div>
          <div className="glass-card overflow-hidden">
            {airCompressorPage.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No air compressor data" description="Add monthly compressor run/load/unload readings." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full min-w-[1100px]">
                  <TableHeader columns={[
                    { key: 'month', label: 'Month' },
                    { key: 'c1Run', label: 'C1 Run', className: 'text-cyan-400' },
                    { key: 'c1Load', label: 'C1 Load', className: 'text-cyan-400' },
                    { key: 'c1Unload', label: 'C1 Unload', className: 'text-cyan-400' },
                    { key: 'c1Pct', label: 'C1 Load%' },
                    { key: 'c2Run', label: 'C2 Run', className: 'text-emerald-400' },
                    { key: 'c2Load', label: 'C2 Load', className: 'text-emerald-400' },
                    { key: 'c2Unload', label: 'C2 Unload', className: 'text-emerald-400' },
                    { key: 'c2Pct', label: 'C2 Load%' },
                    { key: 'c3Run', label: 'C3 Run', className: 'text-amber-400' },
                    { key: 'c3Load', label: 'C3 Load', className: 'text-amber-400' },
                    { key: 'c3Unload', label: 'C3 Unload', className: 'text-amber-400' },
                    { key: 'c3Pct', label: 'C3 Load%' },
                  ]} admin={isAdmin} />
                  <tbody>
                    {airCompressorPage.map((r) => (
                      <tr key={r.id}>
                        <td className="text-slate-300 whitespace-nowrap">{r.month || '—'}</td>
                        <TableCell value={r._c1Run} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r._c1Load} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r._c1Unload} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r._c1Pct ? `${r._c1Pct}%` : '—'} className="text-slate-300 tabular-nums" />
                        <TableCell value={r._c2Run} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r._c2Load} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r._c2Unload} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r._c2Pct ? `${r._c2Pct}%` : '—'} className="text-slate-300 tabular-nums" />
                        <TableCell value={r._c3Run} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._c3Load} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._c3Unload} className="text-amber-300 tabular-nums" />
                        <TableCell value={r._c3Pct ? `${r._c3Pct}%` : '—'} className="text-slate-300 tabular-nums" />
                        {isAdmin && (
                          <td className="text-right">
                            <ActionButtons onDelete={() => {
                              if (window.confirm('Delete this air compressor record?')) {
                                store.monthlyAirCompressor = store.monthlyAirCompressor.filter((e) => e.id !== r.id);
                              }
                            }} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} total={airCompressorWithMetrics.length} onChange={setPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Solar                                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'solar' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            {renderActionBtns(null, { date: todayStr }, 'solar')}
          </div>
          <div className="glass-card overflow-hidden">
            {solarPage.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No solar generation data" description="Add daily inverter-level solar generation readings." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="enterprise-table w-full min-w-[900px]">
                  <TableHeader columns={[
                    { key: 'date', label: 'Date' },
                    { key: 'u1i1', label: 'U1 Inv1', className: 'text-emerald-400' },
                    { key: 'u1i2', label: 'U1 Inv2', className: 'text-emerald-400' },
                    { key: 'u1i3', label: 'U1 Inv3', className: 'text-emerald-400' },
                    { key: 'u1i4', label: 'U1 Inv4', className: 'text-emerald-400' },
                    { key: 'u2i1', label: 'U2 Inv1', className: 'text-cyan-400' },
                    { key: 'u2i2', label: 'U2 Inv2', className: 'text-cyan-400' },
                    { key: 'u2i3', label: 'U2 Inv3', className: 'text-cyan-400' },
                    { key: 'total', label: 'Daily Total kWh', className: 'text-white font-semibold' },
                  ]} admin={isAdmin} />
                  <tbody>
                    {solarPage.map((r) => (
                      <tr key={r.id}>
                        <td className="text-slate-300 whitespace-nowrap">{r.date || '—'}</td>
                        <TableCell value={r.u1Inv1Kwh} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r.u1Inv2Kwh} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r.u1Inv3Kwh} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r.u1Inv4Kwh} className="text-emerald-300 tabular-nums" />
                        <TableCell value={r.u2Inv1Kwh} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r.u2Inv2Kwh} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r.u2Inv3Kwh} className="text-cyan-300 tabular-nums" />
                        <TableCell value={r.dailyTotalKwh} className="text-white font-bold tabular-nums" />
                        {isAdmin && (
                          <td className="text-right">
                            <ActionButtons onDelete={() => {
                              if (window.confirm('Delete this solar record?')) {
                                store.dailySolarGeneration = store.dailySolarGeneration.filter((e) => e.id !== r.id);
                              }
                            }} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} total={sortedSolar.length} onChange={setPage} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Renewable Energy                                                 */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'renewable' && (
        <div className="space-y-5">
          {renewableData.warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-control px-4 py-3 flex items-center gap-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-amber-300 text-sm font-medium">Solar Metering Cross-Check Required</p>
                {renewableData.warnings.map((w, i) => <p key={i} className="text-amber-200/70 text-xs mt-0.5">{w}</p>)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Solar Generation (kWh)', value: renewableData.solarFromInverters, color: 'text-emerald-300', bg: 'bg-emerald-500/[0.07] border-emerald-500/20' },
              { label: 'Meter-Side Solar', value: renewableData.meterSideSolar, color: 'text-cyan-300', bg: 'bg-cyan-500/[0.07] border-cyan-500/20' },
              { label: 'Total Plant Consumption', value: renewableData.totalPlantConsumption, color: 'text-white', bg: 'bg-white/[0.04] border-white/[0.10]' },
              { label: 'Renewable Share %', value: `${renewableData.renewableSharePct}%`, color: 'text-emerald-300', bg: 'bg-emerald-500/[0.07] border-emerald-500/20' },
            ].map((k) => (
              <div key={k.label} className={`rounded-control border p-4 ${k.bg}`}>
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5 leading-tight">{k.label}</p>
                <p className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass-card p-5">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5">Performance Ratio</p>
              <p className="text-white text-2xl font-bold tabular-nums">{renewableData.performanceRatio}%</p>
              <p className="text-slate-500 text-xs mt-1">Expected vs actual solar output</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5">CO2 Avoided</p>
              <p className="text-emerald-300 text-2xl font-bold tabular-nums">{renewableData.co2AvoidedKg.toLocaleString()} kg</p>
              <p className="text-slate-500 text-xs mt-1">This month via solar generation</p>
            </div>
            <div className="glass-card p-5">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5">Solar Cross-Check</p>
              <p className={`text-2xl font-bold tabular-nums ${renewableData.solarCrossCheck > 10 ? 'text-red-300' : 'text-emerald-300'}`}>
                {renewableData.solarCrossCheck}%
              </p>
              <p className="text-slate-500 text-xs mt-1">{renewableData.solarCrossCheck > 10 ? 'Deviation exceeds 10% threshold' : 'Within acceptable range'}</p>
            </div>
          </div>

          {renewableData.solarCrossCheck > 10 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-control px-4 py-3 flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-300 text-sm font-medium">Solar Metering Cross-Check Failed</p>
                <p className="text-red-200/70 text-xs mt-0.5">
                  Inverter-side solar ({renewableData.solarFromInverters} kWh) deviates by {renewableData.solarCrossCheck}% from meter-side solar ({renewableData.meterSideSolar} kWh).
                  Verify CT ratios and meter calibrations.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: Settings                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'settings' && (
        <div className="space-y-5">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-card-title flex items-center gap-2">
                  <Settings size={14} className="text-cyan-400" /> Energy Configuration
                </h3>
                <p className="text-meta mt-0.5">CT ratios, thresholds, and solar parameters used in derived calculations.</p>
              </div>
              {isAdmin && (
                <button onClick={() => { setFormValues({ ...energySettings }); setFormOpen(true); }}
                  className="btn-primary inline-flex items-center gap-1.5 text-xs">
                  <Pencil size={13} /> Edit Settings
                </button>
              )}
            </div>
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
          </div>
        </div>
      )}

      {/* ── Form Modal ── */}
      {formOpen && (
        <FormModal
          title={formTitle}
          subtitle={formSubtitle}
          fields={formFieldsMap[activeTab] || []}
          values={formValues}
          onChange={setForm}
          onSave={formSaveMap[activeTab]}
          onClose={closeForm}
        />
      )}
    </div>
  );
}
