import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, updateBreakdown, deleteBreakdown, updatePM, deletePM, updateEnergyLog, deleteEnergyLog } from '../store.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  availabilityTrend,
  breakdownByDepartment,
  computeKPIs,
  equipmentWiseBreakdown,
  formatPeriodKey,
  healthBand,
  lastNMonths,
  machineHealth,
  monthlyBreakdownTrend,
  monthlyEnergy,
  monthlyPMCompletion,
  mtbfTrend,
  mttrTrend,
  paretoTop10,
  paretoTop10Machines,
  pmStats,
  summaryMonthKey,
} from '../analytics.js';
import { api } from '../api.js';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import { COMPANY_NAME } from '../constants.js';
import {
  AlertOctagon, CalendarDays, CalendarRange, ClipboardCheck, Download,
  Factory, FileBarChart2, FileSpreadsheet, FileText, Gauge, Lightbulb,
  Pencil, Printer, ShieldCheck, Timer, TimerReset, Trash2, TrendingUp, X, Zap,
} from 'lucide-react';

const cellValue = (col, row) => String(col.value ? col.value(row) : row[col.key] ?? '');

function tableHTML(title, columns, rows) {
  const head = columns.map((col) => `<th>${col.label}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${columns.map((col) => `<td>${cellValue(col, row).replace(/</g, '&lt;')}</td>`).join('')}</tr>`)
    .join('');
  return `
    <h2 style="font-family:Arial;margin-bottom:2px;">${title}</h2>
    <p style="font-family:Arial;font-size:11px;color:#555;margin-top:0;">${COMPANY_NAME} — Nathupur Unit · Generated ${new Date().toLocaleString('en-GB')}</p>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:12px;width:100%;">
      <thead style="background:#0F766E;color:#fff;"><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function exportExcel(title, columns, rows, filename) {
  const blob = new Blob(
    ['\uFEFF<html><head><meta charset="utf-8" /></head><body>' + tableHTML(title, columns, rows) + '</body></html>'],
    { type: 'application/vnd.ms-excel' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(title, columns, rows) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(
    `<html><head><title>${title}</title><style>@media print { @page { size: landscape; margin: 12mm; } } tr:nth-child(even){background:#f4f7f7;}</style></head><body>` +
    tableHTML(title, columns, rows) +
    '</body></html>'
  );
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

const fmtDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB') : '—');

// Reports where rows have real store IDs and can be edited / deleted
const EDITABLE_REPORTS = new Set(['pm', 'breakdown', 'energy']);

const SOURCES = ['DG 500 kVA', 'DG 380 kVA', 'Solar Generation', 'Grid / HT Supply', 'Plant SEC'];

// ---------- Edit Modal ----------
function EditModal({ reportId, row, onSave, onDelete, onClose }) {
  const initialState = useMemo(() => {
    if (reportId === 'pm') {
      return {
        plannedCount: String(row.plannedCount ?? ''),
        doneCount: String(row.doneCount ?? ''),
        pendingCount: String(row.pendingCount ?? ''),
        compliancePct: String(row.compliancePct ?? ''),
        remarks: row.remarks || '',
      };
    }
    if (reportId === 'breakdown') {
      return {
        breakdownCount: String(row.breakdownCount ?? ''),
        downtimeHours: String(row.downtimeHours ?? ''),
        operatingHours: String(row.operatingHours ?? ''),
        mttr: String(row.mttr ?? ''),
        mtbf: String(row.mtbf ?? ''),
        // availability_override: stored as null when absent; show empty string in the field
        availability_override: row.availability_override != null ? String(row.availability_override) : '',
        remarks: row.remarks || '',
      };
    }
    // energy
    return {
      date: row.date ? String(row.date).slice(0, 10) : '',
      source: row.source || SOURCES[0],
      kwh: String(row.kwh ?? ''),
      fuelConsumedLitres: String(row.fuelConsumedLitres ?? ''),
      solarGenerationKwh: String(row.solarGenerationKwh ?? ''),
      dg500RunHours: String(row.dg500RunHours ?? ''),
      dg380RunHours: String(row.dg380RunHours ?? ''),
      plantSection: row.plantSection || '',
      remarks: row.remarks || '',
    };
  }, [reportId, row]);

  const [form, setForm] = useState(initialState);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overlayRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = (e) => {
    e.preventDefault();
    // Convert availability_override: empty string → null (auto mode)
    const payload = { ...form };
    if (reportId === 'breakdown') {
      payload.availability_override =
        payload.availability_override !== '' && payload.availability_override != null
          ? Number(payload.availability_override)
          : null;
    }
    onSave(payload);
  };

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const inputCls = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const labelCls = 'block text-xs text-slate-400 mb-1';

  const periodLabel = row.period
    ? new Date(`${row.period}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : row.date
      ? new Date(row.date).toLocaleDateString('en-GB')
      : '';

  // Live compliance auto-preview for PM
  const liveCompliance = useMemo(() => {
    if (reportId !== 'pm') return null;
    const planned = Number(form.plannedCount);
    const done = Number(form.doneCount);
    if (!planned) return null;
    return Math.round((done / planned) * 1000) / 10;
  }, [reportId, form.plannedCount, form.doneCount]);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit record"
    >
      <div className="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-card-title">Edit Record</h3>
            {periodLabel && <p className="text-meta mt-0.5">{periodLabel}{row.section ? ` · ${row.section}` : ''}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          {/* ── PM section ── */}
          {reportId === 'pm' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Planned PM</label>
                  <input type="number" min="0" value={form.plannedCount} onChange={set('plannedCount')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Done PM</label>
                  <input type="number" min="0" value={form.doneCount} onChange={set('doneCount')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Pending PM</label>
                  <input type="number" min="0" value={form.pendingCount} onChange={set('pendingCount')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>
                    Compliance %
                    {liveCompliance !== null && (
                      <span className="ml-2 text-cyan-400 text-[10px] font-normal">auto: {liveCompliance}%</span>
                    )}
                  </label>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={form.compliancePct}
                    onChange={set('compliancePct')}
                    className={inputCls}
                    placeholder={liveCompliance !== null ? `Auto: ${liveCompliance}` : 'Leave blank to auto-calc'}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Remarks</label>
                <textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inputCls} />
              </div>
            </>
          )}

          {/* ── Breakdown section ── */}
          {reportId === 'breakdown' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Breakdown Count</label>
                  <input type="number" min="0" value={form.breakdownCount} onChange={set('breakdownCount')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Downtime (hrs)</label>
                  <input type="number" min="0" step="0.1" value={form.downtimeHours} onChange={set('downtimeHours')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Operating Hours</label>
                  <input type="number" min="0" step="0.1" value={form.operatingHours} onChange={set('operatingHours')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>MTTR (hrs)</label>
                  <input type="number" min="0" step="0.01" value={form.mttr} onChange={set('mttr')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>MTBF (hrs)</label>
                  <input type="number" min="0" step="0.01" value={form.mtbf} onChange={set('mtbf')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>
                    Availability Override %
                    <span className="ml-1.5 text-slate-500 text-[10px] font-normal">(blank = auto-calculate)</span>
                  </label>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={form.availability_override}
                    onChange={set('availability_override')}
                    placeholder="e.g. 94.5 — leave blank for auto"
                    className={`${inputCls} ${form.availability_override !== '' ? 'border-amber-400/50 focus:border-amber-400/80' : ''}`}
                  />
                </div>
              </div>
              {form.availability_override !== '' && (
                <div className="flex items-start gap-2 rounded-control border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-300">
                  <Gauge size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Override active — availability charts and KPIs will use <strong className="ml-1">{form.availability_override}%</strong> instead of the calculated value for this section/period.
                </div>
              )}
              <div>
                <label className={labelCls}>Remarks</label>
                <textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inputCls} />
              </div>
            </>
          )}

          {/* ── Energy section ── */}
          {reportId === 'energy' && (
            <>
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
                  <input type="text" value={form.plantSection} onChange={set('plantSection')} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Remarks</label>
                <textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inputCls} />
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-1">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="btn-danger text-xs inline-flex items-center gap-1.5"
              >
                <Trash2 size={13} /> Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Sure?</span>
                <button type="button" onClick={onDelete} className="btn-danger text-xs px-3 py-1">Yes, delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost text-xs px-3 py-1">Cancel</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
              <button type="submit" className="btn-primary text-xs">Save Changes</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Reports() {
  const store = useStore();
  const { user } = useAuth();
  const { machines, breakdowns, pms, energy } = store;
  const [active, setActive] = useState('equipment');
  const [serverDocs, setServerDocs] = useState([]);
  const [editRow, setEditRow] = useState(null); // { reportId, row }

  const isAdmin = user?.role === 'admin';
  const userName = user?.full_name || user?.username || 'Admin';

  const handleEdit = (reportId, row) => setEditRow({ reportId, row });
  const handleCloseEdit = () => setEditRow(null);

  const handleSaveEdit = (form) => {
    if (!editRow) return;
    const { reportId, row } = editRow;
    if (reportId === 'pm') updatePM(row.id, form, userName);
    else if (reportId === 'breakdown') updateBreakdown(row.id, form, userName);
    else if (reportId === 'energy') updateEnergyLog(row.id, form, userName);
    setEditRow(null);
  };

  const handleDeleteRow = () => {
    if (!editRow) return;
    const { reportId, row } = editRow;
    if (reportId === 'pm') deletePM(row.id, userName);
    else if (reportId === 'breakdown') deleteBreakdown(row.id, userName);
    else if (reportId === 'energy') deleteEnergyLog(row.id, userName);
    setEditRow(null);
  };

  useEffect(() => {
    api.getReports({ limit: 500 }).then((response) => setServerDocs(response.data || [])).catch(() => {});
  }, []);

  const REPORTS = useMemo(() => {
    const stats = pmStats(pms);
    const kpi = computeKPIs(store, serverDocs.length);
    const docRows = (category) => serverDocs
      .filter((doc) => doc.category_name === category)
      .map((doc) => ({
        filename: doc.filename,
        section: doc.plant_section,
        month: `${doc.reporting_month} ${doc.reporting_year}`,
        by: doc.uploader_name,
        on: fmtDate(doc.uploaded_at),
      }));

    const DOC_COLS = [
      { key: 'filename', label: 'Document' },
      { key: 'section', label: 'Plant Section' },
      { key: 'month', label: 'Reporting Period' },
      { key: 'by', label: 'Uploaded By' },
      { key: 'on', label: 'Uploaded On' },
    ];

    const TREND_COLS = (label) => [
      { key: 'label', label: 'Month' },
      { key: 'value', label },
    ];

    const monthlyRows = lastNMonths(12).map((month) => {
      const bdRows = breakdowns.filter((row) => summaryMonthKey(row) === month.key);
      const pmRows = pms.filter((row) => summaryMonthKey(row) === month.key);
      const breakdownCount = bdRows.reduce((sum, row) => sum + (row.breakdownCount || 0), 0);
      const downtimeHours = bdRows.reduce((sum, row) => sum + (row.downtimeHours || 0), 0);
      const plannedCount = pmRows.reduce((sum, row) => sum + (row.plannedCount || 0), 0);
      const doneCount = pmRows.reduce((sum, row) => sum + (row.doneCount || 0), 0);
      return {
        month: month.full,
        breakdowns: breakdownCount,
        downtime: Math.round(downtimeHours * 10) / 10,
        pmPlanned: plannedCount,
        pmDone: doneCount,
        pmPending: pmRows.reduce((sum, row) => sum + (row.pendingCount || 0), 0),
        compliance: plannedCount ? `${Math.round((doneCount / plannedCount) * 1000) / 10}%` : '0%',
        energy: Math.round(energy.filter((entry) => summaryMonthKey({ createdAt: entry.date || entry.createdAt }) === month.key).reduce((sum, entry) => sum + (entry.kwh || 0), 0)),
      };
    });

    return [
      {
        id: 'equipment',
        label: 'Equipment Report',
        icon: Factory,
        desc: 'Machine master seeded from the updated asset register',
        columns: [
          { key: 'machineCode', label: 'Machine ID' },
          { key: 'name', label: 'Machine' },
          { key: 'section', label: 'Section' },
          { key: 'status', label: 'Status' },
          { label: 'Health %', value: (machine) => machineHealth(machine, breakdowns, pms) },
          { label: 'Health Band', value: (machine) => healthBand(machineHealth(machine, breakdowns, pms)) },
        ],
        rows: machines,
      },
      {
        id: 'pm',
        label: 'PM Summary Report',
        icon: ClipboardCheck,
        desc: `Current month compliance ${stats.compliance}%`,
        columns: [
          { label: 'Period', value: (row) => formatPeriodKey(row.period, true) },
          { key: 'section', label: 'Plant Section' },
          { key: 'plannedCount', label: 'Planned PM' },
          { key: 'doneCount', label: 'Done PM' },
          { key: 'pendingCount', label: 'Pending PM' },
          { label: 'Compliance %', value: (row) => row.compliancePct != null ? `${row.compliancePct}%` : '—' },
          { key: 'remarks', label: 'Remarks' },
        ],
        rows: pms,
      },
      {
        id: 'breakdown',
        label: 'Breakdown Summary Report',
        icon: AlertOctagon,
        desc: 'Monthly section-wise reliability summaries',
        columns: [
          { label: 'Period', value: (row) => formatPeriodKey(row.period, true) },
          { key: 'section', label: 'Plant Section' },
          { key: 'breakdownCount', label: 'Breakdown Count' },
          { key: 'downtimeHours', label: 'Downtime Hours' },
          { key: 'mttr', label: 'MTTR (hrs)' },
          { key: 'mtbf', label: 'MTBF (hrs)' },
          { key: 'operatingHours', label: 'Operating Hours' },
          { label: 'Availability Override %', value: (row) => row.availability_override != null ? String(row.availability_override) : '—' },
          { key: 'remarks', label: 'Remarks' },
        ],
        rows: breakdowns,
      },
      {
        id: 'energy',
        label: 'Energy Report',
        icon: Zap,
        desc: 'DG / solar / grid consumption logs',
        columns: [
          { label: 'Date', value: (entry) => fmtDate(entry.date) },
          { key: 'source', label: 'Source' },
          { key: 'kwh', label: 'kWh' },
          { key: 'fuelConsumedLitres', label: 'Fuel (L)' },
          { key: 'solarGenerationKwh', label: 'Solar (kWh)' },
          { key: 'plantSection', label: 'Section' },
          { key: 'remarks', label: 'Remarks' },
        ],
        rows: energy,
      },
      {
        id: 'downtime',
        label: 'Section Downtime Report',
        icon: Timer,
        desc: 'Breakdown count and downtime by plant section',
        columns: [
          { key: 'label', label: 'Plant Section' },
          { key: 'count', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
        ],
        rows: equipmentWiseBreakdown(breakdowns),
      },
      {
        id: 'availability',
        label: 'Availability Report',
        icon: Gauge,
        desc: `Current month ${kpi.availability}%`,
        columns: TREND_COLS('Availability %'),
        rows: availabilityTrend(breakdowns, machines.length, 12),
      },
      {
        id: 'mtbf',
        label: 'MTBF Report',
        icon: TrendingUp,
        desc: `Current month ${kpi.mtbf} hrs`,
        columns: TREND_COLS('MTBF (hrs)'),
        rows: mtbfTrend(breakdowns, machines.length, 12),
      },
      {
        id: 'mttr',
        label: 'MTTR Report',
        icon: TimerReset,
        desc: `Current month ${kpi.mttr} hrs`,
        columns: TREND_COLS('MTTR (hrs)'),
        rows: mttrTrend(breakdowns, 12),
      },
      {
        id: 'top10',
        label: 'Top Breakdown Sections',
        icon: FileBarChart2,
        desc: 'Pareto ranking of plant sections by breakdown count',
        columns: [
          { key: 'label', label: 'Plant Section' },
          { key: 'count', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
          { label: 'Cumulative %', value: (row) => `${row.cumulative}%` },
        ],
        rows: paretoTop10(breakdowns),
      },
      {
        id: 'top10-machines',
        label: 'Top 10 Machine Breakdowns',
        icon: AlertOctagon,
        desc: 'Pareto ranking of individual machines by breakdown count',
        columns: [
          { key: 'label', label: 'Machine' },
          { key: 'count', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
          { label: 'Cumulative %', value: (row) => `${row.cumulative}%` },
        ],
        rows: paretoTop10Machines(store.machineBreakdownLogs),
      },
      {
        id: 'section-split',
        label: 'Breakdown by Section',
        icon: AlertOctagon,
        desc: 'Failure distribution across plant sections',
        columns: [
          { key: 'label', label: 'Plant Section' },
          { key: 'value', label: 'Breakdowns' },
        ],
        rows: breakdownByDepartment(breakdowns),
      },
      {
        id: 'monthly',
        label: 'Monthly Report',
        icon: CalendarDays,
        desc: 'Consolidated month-by-month summary',
        columns: [
          { key: 'month', label: 'Period' },
          { key: 'breakdowns', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
          { key: 'pmPlanned', label: 'Planned PM' },
          { key: 'pmDone', label: 'Done PM' },
          { key: 'pmPending', label: 'Pending PM' },
          { key: 'compliance', label: 'Compliance' },
          { key: 'energy', label: 'Energy (kWh)' },
        ],
        rows: monthlyRows,
      },
      {
        id: 'yearly',
        label: 'Yearly Report',
        icon: CalendarRange,
        desc: 'Annual consolidated summary',
        columns: [
          { key: 'year', label: 'Year' },
          { key: 'breakdowns', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
          { key: 'pmPlanned', label: 'Planned PM' },
          { key: 'pmDone', label: 'Done PM' },
          { key: 'pmPending', label: 'Pending PM' },
          { key: 'energy', label: 'Energy (kWh)' },
        ],
        rows: [...new Set([
          ...breakdowns.map((row) => String(row.year)),
          ...pms.map((row) => String(row.year)),
          ...energy.map((entry) => String(new Date(entry.date || entry.createdAt).getFullYear())),
        ])]
          .filter(Boolean)
          .sort((a, b) => b.localeCompare(a))
          .map((year) => ({
            year,
            breakdowns: breakdowns.filter((row) => String(row.year) === year).reduce((sum, row) => sum + (row.breakdownCount || 0), 0),
            downtime: Math.round(breakdowns.filter((row) => String(row.year) === year).reduce((sum, row) => sum + (row.downtimeHours || 0), 0) * 10) / 10,
            pmPlanned: pms.filter((row) => String(row.year) === year).reduce((sum, row) => sum + (row.plannedCount || 0), 0),
            pmDone: pms.filter((row) => String(row.year) === year).reduce((sum, row) => sum + (row.doneCount || 0), 0),
            pmPending: pms.filter((row) => String(row.year) === year).reduce((sum, row) => sum + (row.pendingCount || 0), 0),
            energy: Math.round(energy.filter((entry) => String(new Date(entry.date || entry.createdAt).getFullYear()) === year).reduce((sum, entry) => sum + (entry.kwh || 0), 0)),
          })),
      },
      {
        id: 'breakdown-trend',
        label: 'Breakdown Trend Report',
        icon: AlertOctagon,
        desc: 'Monthly breakdown, downtime, MTTR, and MTBF trend rows',
        columns: [
          { key: 'label', label: 'Month' },
          { key: 'count', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
          { key: 'mttr', label: 'MTTR (hrs)' },
          { key: 'mtbf', label: 'MTBF (hrs)' },
        ],
        rows: monthlyBreakdownTrend(breakdowns, 12),
      },
      {
        id: 'pm-trend',
        label: 'PM Trend Report',
        icon: ClipboardCheck,
        desc: 'Monthly planned/done/pending PM performance',
        columns: [
          { key: 'label', label: 'Month' },
          { key: 'planned', label: 'Planned PM' },
          { key: 'completed', label: 'Done PM' },
          { key: 'pending', label: 'Pending PM' },
          { key: 'compliance', label: 'Compliance %' },
        ],
        rows: monthlyPMCompletion(pms, 12),
      },
      {
        id: 'machine-docs',
        label: 'Machine Import Docs',
        icon: Factory,
        desc: 'Raw machine register files stored in repository',
        columns: DOC_COLS,
        rows: docRows('Machine Asset Register'),
      },
      {
        id: 'kaizen',
        label: 'Kaizen Report',
        icon: Lightbulb,
        desc: 'Continuous improvement submissions',
        columns: DOC_COLS,
        rows: docRows('Kaizen'),
      },
      {
        id: 'orm',
        label: 'ORM Report',
        icon: ShieldCheck,
        desc: 'Operational risk management records',
        columns: DOC_COLS,
        rows: docRows('ORM Data (Operational Risk Management)'),
      },
      {
        id: 'energy-trend',
        label: 'Energy Trend Report',
        icon: Zap,
        desc: 'Month-by-month energy consumption',
        columns: [
          { key: 'label', label: 'Month' },
          { key: 'kwh', label: 'Energy (kWh)' },
        ],
        rows: monthlyEnergy(energy, 12),
      },
    ];
  }, [store, serverDocs, machines, breakdowns, pms, energy]);

  const report = REPORTS.find((item) => item.id === active) || REPORTS[0];
  const filename = report.label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-page-title flex items-center gap-3">
          <FileBarChart2 size={28} className="text-cyan-400" aria-hidden="true" />
          Analytics Reports
        </h2>
        <p className="text-body mt-1.5">Monthly aggregate reporting packs for equipment, breakdown, PM, energy, and repository records</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-2.5">
        {REPORTS.map((item) => {
          const Icon = item.icon;
          const activeCls = item.id === active
            ? 'border-cyan-400/60 bg-cyan-500/10 text-white'
            : 'border-white/[0.07] bg-white/[0.02] text-slate-400 hover:text-white hover:border-white/[0.18]';
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={`rounded-control border p-3 text-left transition-all ${activeCls}`}
              aria-pressed={item.id === active}
            >
              <Icon size={16} className={item.id === active ? 'text-cyan-400' : ''} aria-hidden="true" />
              <p className="text-[11px] font-semibold mt-1.5 leading-tight">{item.label}</p>
            </button>
          );
        })}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-card-title">{report.label}</h3>
            <p className="text-meta mt-0.5">{report.desc} · {report.rows.length} rows</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportExcel(report.label, report.columns, report.rows, `${filename}.xls`)}
              disabled={!report.rows.length}
              className="btn-success text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <FileSpreadsheet size={13} aria-hidden="true" /> Excel
            </button>
            <button
              onClick={() => exportPDF(report.label, report.columns, report.rows)}
              disabled={!report.rows.length}
              className="btn-danger text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Printer size={13} aria-hidden="true" /> PDF
            </button>
            <button
              onClick={() => exportToCSV(report.rows, report.columns, `${filename}.csv`)}
              disabled={!report.rows.length}
              className="btn-ghost text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Download size={13} aria-hidden="true" /> CSV
            </button>
          </div>
        </div>

        {report.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No data for this report yet"
              description="This report generates automatically as machines, monthly breakdown summaries, PM summaries, energy logs, and uploaded documents are added."
            />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[520px]">
            <table className="enterprise-table w-full min-w-[720px]">
              <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                <tr>
                  {report.columns.map((col) => <th key={col.label}>{col.label}</th>)}
                  {isAdmin && EDITABLE_REPORTS.has(report.id) && <th className="w-16">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {report.rows.slice(0, 200).map((row, index) => (
                  <tr key={row.id || index}>
                    {report.columns.map((col) => (
                      <td key={col.label} className="text-slate-300 max-w-[240px] truncate" title={cellValue(col, row)}>
                        {cellValue(col, row) || '—'}
                      </td>
                    ))}
                    {isAdmin && EDITABLE_REPORTS.has(report.id) && (
                      <td>
                        <button
                          onClick={() => handleEdit(report.id, row)}
                          className="btn-ghost p-1.5 text-slate-400 hover:text-cyan-400"
                          aria-label="Edit row"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {report.rows.length > 200 && (
              <p className="px-5 py-3 text-meta">Preview limited to 200 rows — exports include all {report.rows.length} rows.</p>
            )}
          </div>
        )}
      </div>

      <p className="text-meta flex items-center gap-1.5">
        <FileText size={12} aria-hidden="true" />
        Exports carry the {COMPANY_NAME} letterhead with generation timestamp. PDF opens the print dialog — choose "Save as PDF".
      </p>

      {editRow && (
        <EditModal
          reportId={editRow.reportId}
          row={editRow.row}
          onSave={handleSaveEdit}
          onDelete={handleDeleteRow}
          onClose={handleCloseEdit}
        />
      )}
    </div>
  );
}
