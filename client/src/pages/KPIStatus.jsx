import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, upsertKpiFySheet } from '../store.js';
import { aggregateBreakdownRecords, aggregatePMRecords, computeAvailability, formatPeriodKey } from '../analytics.js';
import { downloadTemplate } from '../bulkImport.js';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import {
  Activity, Download, Upload, Save, Pencil, Trash2, AlertTriangle, CheckCircle2, Info, Eye,
} from 'lucide-react';

// ── FY 2026-27 months in order Apr-Mar ─────────────────────────────────────
const FY_MONTHS = [
  { key: 'apr', label: 'Apr', period: '2026-04' },
  { key: 'may', label: 'May', period: '2026-05' },
  { key: 'jun', label: 'Jun', period: '2026-06' },
  { key: 'jul', label: 'Jul', period: '2026-07' },
  { key: 'aug', label: 'Aug', period: '2026-08' },
  { key: 'sep', label: 'Sep', period: '2026-09' },
  { key: 'oct', label: 'Oct', period: '2026-10' },
  { key: 'nov', label: 'Nov', period: '2026-11' },
  { key: 'dec', label: 'Dec', period: '2026-12' },
  { key: 'jan', label: 'Jan', period: '2027-01' },
  { key: 'feb', label: 'Feb', period: '2027-02' },
  { key: 'mar', label: 'Mar', period: '2027-03' },
];

// Template rows are defined in store.js KPI_FY_TEMPLATE_ROWS and normalized via normalizeKpiFySheet
// We reuse that via store.kpiFySheet[0].data — no hardcoding here to keep single source of truth

function parseNumericMaybe(val) {
  if (val === '' || val == null) return null;
  const s = String(val).trim();
  if (s.toLowerCase() === 'na' || s.toLowerCase() === 'n/a') return null;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function computeYtdAvg(row) {
  const vals = FY_MONTHS.map((m) => parseNumericMaybe(row[m.key])).filter((n) => n !== null);
  if (vals.length === 0) return '';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return String(Math.round(avg * 10) / 10);
}

// Auto-calculate monthly actual from existing app data where applicable
function getAutoMonthlyValue(sn, period, store) {
  // period is YYYY-MM like 2026-04
  const { breakdowns, machines, machineBreakdownLogs, pms, machinePmRecords, dailyUtilityLog } = store;
  const section = null; // plant-level
  switch (sn) {
    case 1: { // Asset / Equipment Availability – Plant
      // Use existing computeAvailability logic: (Available Hours - Breakdown Hours)/Available Hours *100
      // For plant-level, available hours = machines.length * 720
      const mCount = machines?.length || 1;
      const bdRows = (breakdowns || []).filter((r) => r.period === period);
      if (bdRows.length > 0) {
        // Reuse exact value if already calculated
        const hasOverride = bdRows.every((r) => r.availability_override != null);
        if (hasOverride) {
          const avg = bdRows.reduce((s, r) => s + Number(r.availability_override), 0) / bdRows.length;
          return String(Math.round(avg * 10) / 10);
        }
        const totalHours = bdRows.reduce((s, r) => s + Number(r.downtimeHours || 0), 0);
        const opHours = bdRows.reduce((s, r) => s + Number(r.operatingHours || 0), 0) || mCount * 720;
        const avail = opHours > 0 ? Math.max(0, Math.round(((opHours - totalHours) / opHours) * 1000) / 10) : 100;
        return String(avail);
      }
      // Fallback to machine logs aggregated
      const logs = (machineBreakdownLogs || []).filter((r) => (r.date || '').slice(0, 7) === period);
      if (logs.length > 0) {
        const totalHours = logs.reduce((s, r) => s + Number(r.downtimeHours || 0), 0);
        const opHours = mCount * 720;
        const avail = opHours > 0 ? Math.max(0, Math.round(((opHours - totalHours) / opHours) * 1000) / 10) : 100;
        return String(avail);
      }
      return '';
    }
    case 2: { // PM Schedule Adherence – Plant
      const pmRows = (pms || []).filter((r) => r.period === period);
      const machineRecs = (machinePmRecords || []).filter((r) => (r.pmDate || '').slice(0, 7) === period);
      if (machineRecs.length > 0) {
        const done = machineRecs.filter((r) => String(r.status || '').toLowerCase() === 'completed' || r.completed === true).length;
        const pct = machineRecs.length > 0 ? Math.round((done / machineRecs.length) * 1000) / 10 : 0;
        return String(pct);
      }
      if (pmRows.length > 0) {
        const planned = pmRows.reduce((s, r) => s + Number(r.plannedCount || 0), 0);
        const done = pmRows.reduce((s, r) => s + Number(r.doneCount || 0), 0);
        const pct = planned > 0 ? Math.round((done / planned) * 1000) / 10 : 0;
        return String(pct);
      }
      return '';
    }
    case 3: { // Breakdown Frequency Reduction (MTBF improvement) % improve
      // Use MTBF for this month vs previous month or vs baseline. If no baseline, show MTBF value as reference
      // We will show MTBF improvement % if we have previous month MTBF, otherwise show MTBF itself and let user interpret
      const mCount = machines?.length || 1;
      const curr = aggregateBreakdownRecords(breakdowns || [], period);
      const currMtbf = curr.mtbf || 0;
      if (!currMtbf) return '';
      // Try previous month
      const [y, m] = period.split('-').map(Number);
      const prevD = new Date(y, m - 2, 1);
      const prevPeriod = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
      const prev = aggregateBreakdownRecords(breakdowns || [], prevPeriod);
      const prevMtbf = prev.mtbf || 0;
      if (prevMtbf > 0) {
        const improve = Math.round(((currMtbf - prevMtbf) / prevMtbf) * 1000) / 10;
        return String(improve);
      }
      // No previous, return MTBF itself as actual (user can see improvement vs target)
      return String(currMtbf);
    }
    case 4: { // MTTR – Mean Time to Repair Reduction % improve
      const curr = aggregateBreakdownRecords(breakdowns || [], period);
      const currMttr = curr.mttr || 0;
      if (!currMttr) return '';
      const [y, m] = period.split('-').map(Number);
      const prevD = new Date(y, m - 2, 1);
      const prevPeriod = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
      const prev = aggregateBreakdownRecords(breakdowns || [], prevPeriod);
      const prevMttr = prev.mttr || 0;
      if (prevMttr > 0) {
        const improve = Math.round(((prevMttr - currMttr) / prevMttr) * 1000) / 10; // reduction
        return String(improve);
      }
      return String(currMttr);
    }
    case 11: { // Energy Cost Reduction – Plant % vs LY
      // Use Energy module where sufficient data exists: total energy consumption for this month vs same month last year
      // If not enough data, return blank for manual
      const curMonthRows = (store.energy || []).filter((e) => (e.date || '').slice(0, 7) === period);
      if (curMonthRows.length === 0) {
        // Try dailyUtilityLog
        const curUtil = (dailyUtilityLog || []).filter((r) => (r.date || '').slice(0, 7) === period);
        if (curUtil.length === 0) return '';
      }
      // For now, if we have current month data but no LY, return blank to allow manual (as spec: otherwise manual)
      const [y, m] = period.split('-').map(Number);
      const lyPeriod = `${y - 1}-${String(m).padStart(2, '0')}`;
      const lyRows = (store.energy || []).filter((e) => (e.date || '').slice(0, 7) === lyPeriod);
      const curTotal = curMonthRows.reduce((s, e) => s + Number(e.totalKwh || e.kwh || 0), 0);
      const lyTotal = lyRows.reduce((s, e) => s + Number(e.totalKwh || e.kwh || 0), 0);
      if (curTotal > 0 && lyTotal > 0) {
        const reduction = Math.round(((lyTotal - curTotal) / lyTotal) * 1000) / 10;
        return String(reduction);
      }
      return '';
    }
    default:
      return '';
  }
}

export default function KPIStatus() {
  const { user } = useAuth();
  const { pushToast } = useUI();
  const store = useStore();
  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';

  // FY sheet is single record with fy='2026-27'
  const sheet = useMemo(() => {
    const raw = (store.kpiFySheet && store.kpiFySheet[0]) ? store.kpiFySheet[0] : { fy: '2026-27', data: [] };
    // Ensure data is normalized (store does, but also handle empty)
    if (!raw.data || raw.data.length === 0) {
      // Fallback to template via store helper (if store hasn't initialized yet)
      // We will let store's normalize handle, but provide empty to avoid crash
      return raw;
    }
    return raw;
  }, [store.kpiFySheet]);

  const rows = useMemo(() => {
    const data = Array.isArray(sheet.data) ? sheet.data : [];
    // Sort by Sn
    return [...data].sort((a, b) => Number(a.sn) - Number(b.sn));
  }, [sheet]);

  // Local edit state for monthly cells: { `${sn}-${monthKey}`: value }
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // When store updates (e.g., Realtime or auto), clear local edits that are now synced
  useEffect(() => {
    setEdits({});
  }, [sheet.updatedAt]);

  const handleCellChange = (sn, monthKey, value) => {
    const k = `${sn}-${monthKey}`;
    setEdits((prev) => ({ ...prev, [k]: value }));
  };

  const handleQuarterChange = (sn, qKey, value) => {
    const k = `${sn}-${qKey}`;
    setEdits((prev) => ({ ...prev, [k]: value }));
  };

  const handleSave = async () => {
    if (!isAdmin) { pushToast({ type: 'error', title: 'Not allowed', message: 'Only admin can edit KPI sheet' }); return; }
    setSaving(true);
    try {
      const newData = rows.map((row) => {
        const sn = row.sn;
        const updated = { ...row };
        let changed = false;
        // Quarterly
        ['q1', 'q2', 'q3', 'q4'].forEach((q) => {
          const k = `${sn}-${q}`;
          if (k in edits) {
            updated[q] = edits[k];
            updated[`isManual${q.charAt(0).toUpperCase()}${q.slice(1)}`] = edits[k] !== '';
            changed = true;
          }
        });
        // Monthly
        FY_MONTHS.forEach((m) => {
          const k = `${sn}-${m.key}`;
          if (k in edits) {
            updated[m.key] = edits[k];
            const manualKey = `isManual${m.key.charAt(0).toUpperCase()}${m.key.slice(1)}`;
            updated[manualKey] = edits[k] !== '';
            changed = true;
          }
        });
        // Recompute YTD
        if (changed) {
          const vals = FY_MONTHS.map((mm) => updated[mm.key]).filter((v) => v !== '' && String(v).toLowerCase() !== 'na').map((v) => Number(String(v).replace(/[^0-9.\-]/g, ''))).filter((n) => Number.isFinite(n));
          const ytd = vals.length ? String(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10) : '';
          updated.ytdAvg = ytd;
        }
        return updated;
      });
      const updatedSheet = { ...sheet, data: newData, updatedAt: new Date().toISOString() };
      upsertKpiFySheet(updatedSheet, userName);
      pushToast({ type: 'success', title: 'KPI FY 2026-27 saved', message: `${newData.length} KPIs updated` });
      setEdits({});
    } catch (e) {
      pushToast({ type: 'error', title: 'Save failed', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    // Export exactly 27 columns in order specified
    const headers = ['Sn','Focus Pillar','KPI / Metric','UoM','KPI Wt %','Pillar Wt %','Annual Target (Rating 3)','Rating 4','Rating 5','Parent Target','Q1 Apr–Jun','Q2 Jul–Sep','Q3 Oct–Dec','Q4 Jan–Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','YTD Avg'];
    const exportRows = rows.map((r) => ({
      'Sn': r.sn,
      'Focus Pillar': r.focusPillar,
      'KPI / Metric': r.kpiMetric,
      'UoM': r.uom,
      'KPI Wt %': r.kpiWt,
      'Pillar Wt %': r.pillarWt,
      'Annual Target (Rating 3)': r.annualTarget,
      'Rating 4': r.rating4,
      'Rating 5': r.rating5,
      'Parent Target': r.parentTarget,
      'Q1 Apr–Jun': r.q1,
      'Q2 Jul–Sep': r.q2,
      'Q3 Oct–Dec': r.q3,
      'Q4 Jan–Mar': r.q4,
      'Apr': r.apr,
      'May': r.may,
      'Jun': r.jun,
      'Jul': r.jul,
      'Aug': r.aug,
      'Sep': r.sep,
      'Oct': r.oct,
      'Nov': r.nov,
      'Dec': r.dec,
      'Jan': r.jan,
      'Feb': r.feb,
      'Mar': r.mar,
      'YTD Avg': r.ytdAvg,
    }));
    exportToCSV(exportRows, headers.map((h) => ({ key: h, label: h })), `KPI_FY2026-27_Goal_Cascade_${new Date().toISOString().slice(0,10)}.csv`);
  };

  const handleImportReset = async () => {
    if (!isAdmin) return;
    const updatedSheet = { ...sheet, data: sheet.data.map((r) => {
      // For auto KPIs, recalculate monthly actuals from current source data where blank and not manual
      const autoSns = [1,2,3,4,11];
      if (!autoSns.includes(Number(r.sn))) return r;
      const updated = { ...r };
      FY_MONTHS.forEach((m) => {
        const manualKey = `isManual${m.key.charAt(0).toUpperCase()}${m.key.slice(1)}`;
        if (!updated[manualKey] && (updated[m.key] === '' || updated[m.key] == null)) {
          const autoVal = getAutoMonthlyValue(Number(r.sn), m.period, store);
          if (autoVal !== '') {
            updated[m.key] = autoVal;
          }
        }
      });
      const vals = FY_MONTHS.map((mm) => updated[mm.key]).filter((v) => v !== '' && String(v).toLowerCase() !== 'na').map((v) => Number(String(v).replace(/[^0-9.\-]/g, ''))).filter((n) => Number.isFinite(n));
      const ytd = vals.length ? String(Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10) : '';
      updated.ytdAvg = ytd;
      return updated;
    }) };
    upsertKpiFySheet(updatedSheet, userName);
    pushToast({ type: 'success', title: 'Auto values refreshed', message: 'Monthly actuals recalculated from PM/Breakdown/Energy where available' });
  };

  if (rows.length === 0) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <EmptyState title="No KPI data available." description="FY 2026-27 PQSCDM Goal Cascade sheet will appear here. Import the KPI template or wait for auto-generation from PM/Breakdown records." />
      </div>
    );
  }

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <Activity size={28} className="text-emerald-400" aria-hidden="true" /> KPI Status
          </h2>
          <p className="text-body mt-1.5">Plant Engineering KPI — FY 2026-27 PQSCDM Goal Cascade</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleExport} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap"><Download size={13} aria-hidden="true" /> Export CSV (27-col)</button>
          <button onClick={() => downloadTemplate('kpi')} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap"><Download size={13} aria-hidden="true" /> KPI Template (27-col)</button>
          {isAdmin && (
            <>
              <button onClick={handleImportReset} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap" title="Recalculate auto monthly values from current PM/Breakdown/Energy data"><Activity size={13} aria-hidden="true" /> Refresh Auto</button>
              <button onClick={() => setConfirmReset(true)} className="btn-ghost inline-flex items-center gap-2 text-xs whitespace-nowrap text-amber-400 hover:text-amber-300 border border-amber-500/20"><Trash2 size={13} aria-hidden="true" /> Reset Sheet</button>
            </>
          )}
        </div>
      </div>

      {/* FY Header */}
      <div className="glass-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-card-title text-base flex items-center gap-2">
              <span className="text-emerald-400">◆</span> FY 2026-27 ◆ PQSCDM Goal Cascade ◆ Plant Engg Manager
            </h3>
            <p className="text-meta mt-1 text-xs">Plant Engineering / Maintenance Manager | Reports to Engg Head | Plant-specific | FY 2026-27</p>
            <p className="text-slate-500 text-[11px] mt-1">P = 37 &nbsp; Q = 12 &nbsp; S = 20 &nbsp; C = 23 &nbsp; D = 5 &nbsp; M = 4 &nbsp; | &nbsp; Total KPI Wt = 100 (Pillar Wt shown on first row of each pillar)</p>
          </div>
          <div className="flex items-center gap-2">
            {hasEdits && <span className="text-amber-400 text-xs flex items-center gap-1"><AlertTriangle size={12} /> Unsaved changes</span>}
            <button onClick={handleSave} disabled={!hasEdits || saving || !isAdmin} className="btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-40"><Save size={13} aria-hidden="true" /> {saving ? 'Saving…' : 'Save FY Sheet'}</button>
          </div>
        </div>
        <p className="text-slate-500 text-[11px] mt-3 flex items-start gap-1.5">
          <Info size={11} className="mt-px flex-shrink-0" aria-hidden="true" />
          Quarterly targets inherit <span className="text-white">Annual Target (Rating 3)</span> unless manually edited. Monthly actuals <span className="text-white">Apr–Mar</span> are editable — blank means no entry (ignored in YTD Avg, not zero). <span className="text-cyan-400">Auto</span> = calculated from existing PM/Breakdown/Energy data; <span className="text-amber-400">Manual</span> = you typed it. YTD Avg = average of available monthly actuals (ignores blank/“NA”).
        </p>
      </div>

      {/* KPI Table — 27 columns, horizontal scroll */}
      <div className="glass-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="enterprise-table w-full min-w-[1800px] text-xs">
            <thead className="sticky top-0 bg-slate-900/95 backdrop-blur z-10">
              <tr>
                <th className="sticky left-0 bg-slate-900 z-20 min-w-[40px]">Sn</th>
                <th className="sticky left-[40px] bg-slate-900 z-20 min-w-[140px]">Focus Pillar</th>
                <th className="min-w-[260px]">KPI / Metric</th>
                <th>UoM</th>
                <th>KPI Wt %</th>
                <th>Pillar Wt %</th>
                <th className="min-w-[110px]">Annual Target (Rating 3)</th>
                <th>Rating 4</th>
                <th>Rating 5</th>
                <th className="min-w-[140px]">Parent Target</th>
                <th className="bg-cyan-500/5">Q1 Apr–Jun</th>
                <th className="bg-cyan-500/5">Q2 Jul–Sep</th>
                <th className="bg-cyan-500/5">Q3 Oct–Dec</th>
                <th className="bg-cyan-500/5">Q4 Jan–Mar</th>
                <th className="bg-emerald-500/5">Apr</th>
                <th className="bg-emerald-500/5">May</th>
                <th className="bg-emerald-500/5">Jun</th>
                <th className="bg-emerald-500/5">Jul</th>
                <th className="bg-emerald-500/5">Aug</th>
                <th className="bg-emerald-500/5">Sep</th>
                <th className="bg-emerald-500/5">Oct</th>
                <th className="bg-emerald-500/5">Nov</th>
                <th className="bg-emerald-500/5">Dec</th>
                <th className="bg-emerald-500/5">Jan</th>
                <th className="bg-emerald-500/5">Feb</th>
                <th className="bg-emerald-500/5">Mar</th>
                <th className="bg-violet-500/10 font-bold">YTD Avg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // Determine if this row is auto-sourced
                const isAutoKpi = [1,2,3,4,11,12].includes(Number(row.sn));
                return (
                  <tr key={row.sn} className="hover:bg-white/[0.03]">
                    <td className="sticky left-0 bg-slate-900/95 text-slate-300 font-semibold">{row.sn}</td>
                    <td className="sticky left-[40px] bg-slate-900/95 text-slate-300 max-w-[140px] truncate" title={row.focusPillar}>{row.focusPillar}</td>
                    <td className="text-white font-medium max-w-[260px] truncate" title={row.kpiMetric}>{row.kpiMetric}</td>
                    <td className="text-slate-400 whitespace-nowrap">{row.uom}</td>
                    <td className="text-slate-300 tabular-nums">{row.kpiWt}</td>
                    <td className="text-slate-300 tabular-nums">{row.pillarWt}</td>
                    <td className="text-emerald-300 tabular-nums font-medium">{row.annualTarget}</td>
                    <td className="text-slate-300 tabular-nums">{row.rating4}</td>
                    <td className="text-slate-300 tabular-nums">{row.rating5}</td>
                    <td className="text-slate-400 max-w-[140px] truncate" title={row.parentTarget}>{row.parentTarget}</td>
                    {/* Quarterly — editable, default to Annual Target */}
                    {['q1','q2','q3','q4'].map((q) => {
                      const k = `${row.sn}-${q}`;
                      const displayVal = k in edits ? edits[k] : row[q];
                      const isManual = row[`isManual${q.charAt(0).toUpperCase()+q.slice(1)}`];
                      return (
                        <td key={q} className="bg-cyan-500/[0.03] p-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={displayVal}
                              onChange={(e)=>handleQuarterChange(row.sn, q, e.target.value)}
                              disabled={!isAdmin}
                              placeholder={row.annualTarget}
                              className="w-[70px] rounded bg-white/[0.06] border border-white/[0.12] px-1.5 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60 disabled:opacity-60"
                            />
                            {isManual ? <span className="text-[8px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">M</span> : <span className="text-[8px] px-1 py-0 rounded bg-slate-500/10 text-slate-400 border border-white/10">—</span>}
                          </div>
                        </td>
                      );
                    })}
                    {/* Monthly Apr-Mar — editable, Auto where applicable */}
                    {FY_MONTHS.map((m) => {
                      const k = `${row.sn}-${m.key}`;
                      const storedVal = row[m.key];
                      const editedVal = k in edits ? edits[k] : storedVal;
                      // Auto value if blank and isAutoKpi
                      const autoVal = isAutoKpi && (storedVal === '' || storedVal == null) && !(k in edits) ? getAutoMonthlyValue(Number(row.sn), m.period, store) : '';
                      const displayVal = editedVal !== '' ? editedVal : (autoVal !== '' ? autoVal : '');
                      const isManual = row[`isManual${m.key.charAt(0).toUpperCase()+m.key.slice(1)}`] || (!!editedVal && editedVal !== autoVal);
                      const isAutoDisplay = autoVal !== '' && editedVal === '' && !(k in edits);
                      return (
                        <td key={m.key} className="bg-emerald-500/[0.03] p-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={k in edits ? edits[k] : (displayVal)}
                              onChange={(e)=>handleCellChange(row.sn, m.key, e.target.value)}
                              disabled={!isAdmin}
                              placeholder={isAutoDisplay ? `Auto:${autoVal}` : '—'}
                              className={`w-[60px] rounded border px-1.5 py-1 text-[11px] placeholder-slate-500 focus:outline-none disabled:opacity-60 ${isAutoDisplay ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300' : 'bg-white/[0.06] border-white/[0.12] text-white focus:border-emerald-400/60'}`}
                              title={isAutoDisplay ? `Auto calculated from ${row.kpiMetric} for ${m.label} ${m.period}` : ''}
                            />
                            {isAutoDisplay ? <span className="text-[8px] px-1 py-0 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30" title="Auto from PM/Breakdown/Energy">A</span> : isManual ? <span className="text-[8px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">M</span> : <span className="text-[8px] px-1 py-0 rounded bg-slate-500/10 text-slate-400 border border-white/10">—</span>}
                          </div>
                        </td>
                      );
                    })}
                    <td className="bg-violet-500/10 text-violet-300 font-bold tabular-nums">{row.ytdAvg}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-white/[0.06] flex items-center justify-between">
          <p className="text-slate-500 text-[11px]">Horizontal scroll — 27 columns. Pillar Wt % shown only on first row per pillar (P 37, Q 12, S 20, C 23, D 5, M 4). Blank monthly cell = no actual (ignored in YTD Avg, not zero). “NA” also ignored.</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">A Auto</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">M Manual</span>
          </div>
        </div>
      </div>

      {/* Import/Export note */}
      <div className="glass-card p-4">
        <h4 className="text-card-title text-sm mb-2 flex items-center gap-2"><Upload size={14} className="text-cyan-400" /> KPI Import / Export — 27-column FY 2026-27 Template</h4>
        <p className="text-meta text-xs leading-relaxed">
          Use <span className="text-white">KPI Template (27-col)</span> for bulk import — headers must be exactly: <code className="bg-white/[0.06] px-1 py-0.5 rounded text-[10px]">Sn | Focus Pillar | KPI / Metric | UoM | KPI Wt % | Pillar Wt % | Annual Target (Rating 3) | Rating 4 | Rating 5 | Parent Target | Q1 Apr–Jun | Q2 Jul–Sep | Q3 Oct–Dec | Q4 Jan–Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Jan | Feb | Mar | YTD Avg</code>. YTD Avg is auto-calculated on import. Master Import sheet “KPI_Status” uses same structure. Existing PM/Breakdown/Energy/Master templates unchanged.
        </p>
        <div className="flex gap-2 mt-3">
          <button onClick={()=>downloadTemplate('kpi')} className="btn-ghost text-xs inline-flex items-center gap-1.5"><Download size={13} /> Download KPI FY26-27 Template</button>
          <button onClick={()=>{ const s=store.kpiFySheet && store.kpiFySheet[0]; if(s) { const headers=['Sn','Focus Pillar','KPI / Metric','UoM','KPI Wt %','Pillar Wt %','Annual Target (Rating 3)','Rating 4','Rating 5','Parent Target','Q1 Apr–Jun','Q2 Jul–Sep','Q3 Oct–Dec','Q4 Jan–Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','YTD Avg']; const rows=s.data.map((r)=>({ 'Sn':r.sn, 'Focus Pillar':r.focusPillar, 'KPI / Metric':r.kpiMetric, 'UoM':r.uom, 'KPI Wt %':r.kpiWt, 'Pillar Wt %':r.pillarWt, 'Annual Target (Rating 3)':r.annualTarget, 'Rating 4':r.rating4, 'Rating 5':r.rating5, 'Parent Target':r.parentTarget, 'Q1 Apr–Jun':r.q1, 'Q2 Jul–Sep':r.q2, 'Q3 Oct–Dec':r.q3, 'Q4 Jan–Mar':r.q4, 'Apr':r.apr, 'May':r.may, 'Jun':r.jun, 'Jul':r.jul, 'Aug':r.aug, 'Sep':r.sep, 'Oct':r.oct, 'Nov':r.nov, 'Dec':r.dec, 'Jan':r.jan, 'Feb':r.feb, 'Mar':r.mar, 'YTD Avg':r.ytdAvg })); exportToCSV(rows, headers.map((h)=>({key:h,label:h})), `KPI_FY2026-27_Export_${new Date().toISOString().slice(0,10)}.csv`); } }} className="btn-ghost text-xs inline-flex items-center gap-1.5"><Download size={13} /> Export Current Sheet CSV</button>
        </div>
      </div>

      {/* Reset modal */}
      {confirmReset && (
        <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget&&setConfirmReset(false)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Reset FY 2026-27 Sheet</h3>
            <p className="text-body mb-5">Reset all quarterly and monthly actuals to blank (Annual Target retained, YTD cleared)? This will keep the 16 KPI definitions but clear Apr–Mar and Q1–Q4 edits.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setConfirmReset(false)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={()=>{
                const resetData = rows.map((r)=>({ ...r, q1: r.annualTarget, q2: r.annualTarget, q3: r.annualTarget, q4: r.annualTarget, apr:'',may:'',jun:'',jul:'',aug:'',sep:'',oct:'',nov:'',dec:'',jan:'',feb:'',mar:'', ytdAvg:'', isManualQ1:false,isManualQ2:false,isManualQ3:false,isManualQ4:false, isManualApr:false,isManualMay:false,isManualJun:false,isManualJul:false,isManualAug:false,isManualSep:false,isManualOct:false,isManualNov:false,isManualDec:false,isManualJan:false,isManualFeb:false,isManualMar:false }));
                const updated = { ...sheet, data: resetData, updatedAt: new Date().toISOString() };
                upsertKpiFySheet(updated, userName);
                setConfirmReset(false);
                pushToast({ type:'success', title:'Sheet reset', message:'FY 2026-27 monthly actuals cleared' });
              }} className="btn-danger text-xs inline-flex items-center gap-1.5"><Trash2 size={12} /> Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
