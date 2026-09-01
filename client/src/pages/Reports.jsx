import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, updateBreakdown, deleteBreakdown, updatePM, deletePM } from '../store.js';
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
  monthlyPMCompletion,
  mtbfTrend,
  mttrTrend,
  paretoTop10,
  paretoTop10Machines,
  pmStats,
  summaryMonthKey,
  failureCausePareto,
  machineBreakdownRegister,
  amcOverallStats,
  currentlyUnderBreakdown,
} from '../analytics.js';
import { api } from '../api.js';
import EmptyState from '../components/EmptyState.jsx';
import { exportToCSV } from '../utils.js';
import { COMPANY_NAME } from '../constants.js';
import {
  AlertCircle, AlertOctagon, Award, CalendarDays, CalendarRange, ClipboardCheck, Download,
  Factory, FileBarChart2, FileSpreadsheet, FileText, Gauge, Lightbulb,
  Pencil, Printer, ShieldCheck, Timer, TimerReset, Trash2, TrendingUp, X,
  ChevronDown, Eye, ExternalLink, Clock,
} from 'lucide-react';
import { PieDonutChart, ChartCard } from '../components/AnalyticsCharts.jsx';

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

const fmtDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB') : '—' );

function certDaysLeft(expiryDate) {
  if (!expiryDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(expiryDate); expiry.setHours(0,0,0,0);
  return Math.ceil((expiry - today) / (1000*60*60*24));
}
function certStatus(expiryDate) {
  const d = certDaysLeft(expiryDate);
  if (d == null) return { status: 'UNKNOWN', daysLeft: null, tone: 'info' };
  if (d <= 0) return { status: 'EXPIRED', daysLeft: d, tone: 'danger' };
  if (d >= 1 && d <= 30) return { status: 'EXPIRING SOON', daysLeft: d, tone: 'warning' };
  return { status: 'VALID', daysLeft: d, tone: 'success' };
}

// Reports where rows have real store IDs and can be edited / deleted
const EDITABLE_REPORTS = new Set(['pm', 'breakdown', 'availability']);

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
    if (reportId === 'availability') {
      return {
        availability_override: row.value != null ? String(Math.round(row.value * 10) / 10) : '',
      };
    }
    return {};
  }, [reportId, row]);

  const [form, setForm] = useState(initialState);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overlayRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = (e) => {
    e.preventDefault();
    // Convert availability_override: empty string → null (auto mode)
    const payload = { ...form };
    if (reportId === 'breakdown' || reportId === 'availability') {
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

          {/* ── Availability section ── */}
          {reportId === 'availability' && (
            <>
              <div>
                <label className={labelCls}>
                  Availability Override %
                  <span className="ml-1.5 text-slate-500 text-[10px] font-normal">(blank = auto-calculate from downtime)</span>
                </label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={form.availability_override}
                  onChange={set('availability_override')}
                  placeholder="e.g. 95.5 — leave blank for auto"
                  className={`${inputCls} ${form.availability_override !== '' ? 'border-amber-400/50 focus:border-amber-400/80' : ''}`}
                />
              </div>
              {form.availability_override !== '' && (
                <div className="flex items-start gap-2 rounded-control border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-300">
                  <Gauge size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  Override active — availability charts and KPIs will use <strong className="ml-1">{form.availability_override}%</strong> for this period instead of the calculated value.
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between pt-1">
            {reportId !== 'availability' && (
              !confirmDelete ? (
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
              )
            )}
            {reportId === 'availability' && <div />}
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
  const navigate = useNavigate();
  const { machines, breakdowns, pms } = store;
  const [active, setActive] = useState('equipment');
  const [serverDocs, setServerDocs] = useState([]);
  const [editRow, setEditRow] = useState(null); // { reportId, row }
  const [amcSectionFilter, setAmcSectionFilter] = useState('');
  const [amcVendorFilter, setAmcVendorFilter] = useState('');
  const [amcStatusFilter, setAmcStatusFilter] = useState('');
  const [certSectionFilter, setCertSectionFilter] = useState('');
  const [certTypeFilter, setCertTypeFilter] = useState('');
  const [certStatusFilter, setCertStatusFilter] = useState('');

  const isAdmin = user?.role === 'admin';
  const userName = user?.full_name || user?.username || 'Admin';

  const handleEdit = (reportId, row) => setEditRow({ reportId, row });
  const handleCloseEdit = () => setEditRow(null);

  const handleSaveEdit = (form) => {
    if (!editRow) return;
    const { reportId, row } = editRow;
    if (reportId === 'pm') updatePM(row.id, form, userName);
    else if (reportId === 'breakdown') updateBreakdown(row.id, form, userName);
    else if (reportId === 'availability' && row.monthKey) {
      const monthBreakdowns = breakdowns.filter((b) => summaryMonthKey(b) === row.monthKey);
      monthBreakdowns.forEach((b) => updateBreakdown(b.id, { availability_override: form.availability_override }, userName));
    }
    setEditRow(null);
  };

  const handleDeleteRow = () => {
    if (!editRow) return;
    const { reportId, row } = editRow;
    if (reportId === 'pm') deletePM(row.id, userName);
    else if (reportId === 'breakdown') deleteBreakdown(row.id, userName);
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
        ],
        rows: [...new Set([
          ...breakdowns.map((row) => String(row.year)),
          ...pms.map((row) => String(row.year)),
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
        id: 'failure-cause-pareto',
        label: 'Failure Cause Pareto',
        icon: AlertOctagon,
        desc: 'Breakdown causes ranked by frequency',
        columns: [
          { key: 'label', label: 'Failure Cause' },
          { key: 'count', label: 'Breakdowns' },
          { key: 'downtime', label: 'Downtime (hrs)' },
          { label: '% of Total', value: (row) => `${row.percent || 0}%` },
          { label: 'Cumulative %', value: (row) => `${row.cumulative}%` },
        ],
        rows: failureCausePareto(store.machineBreakdownLogs),
      },
      {
        id: 'monthly-machine-register',
        label: 'Monthly Machine Breakdown Register',
        icon: CalendarDays,
        desc: 'Machine-wise breakdown register by month',
        columns: [
          { key: 'period', label: 'Month' },
          { key: 'machineCode', label: 'Machine ID' },
          { key: 'machineName', label: 'Machine' },
          { key: 'plantSection', label: 'Section' },
          { key: 'breakdownCount', label: 'Breakdowns' },
          { key: 'downtimeHours', label: 'Downtime (hrs)' },
          { key: 'mainFailureCause', label: 'Main Failure Cause' },
          { key: 'status', label: 'Status' },
        ],
        rows: machineBreakdownRegister(store.machineBreakdownLogs),
      },
      {
        id: 'active-breakdowns',
        label: 'Currently Under Breakdown',
        icon: AlertCircle,
        desc: 'Active breakdown incidents without CLOSED status',
        columns: [
          { key: 'machineCode', label: 'Machine ID' },
          { key: 'machineName', label: 'Machine' },
          { key: 'plantSection', label: 'Section' },
          { key: 'date', label: 'Date' },
          { key: 'downtimeHours', label: 'Downtime (hrs)' },
          { key: 'failureCause', label: 'Failure Cause' },
          { key: 'status', label: 'Status' },
        ],
        rows: currentlyUnderBreakdown(store.machineBreakdownLogs),
      },
      {
        id: 'amc-overview',
        label: 'AMC Overview',
        icon: ShieldCheck,
        desc: 'Annual maintenance contract management overview',
        columns: [
          { key: 'machineCode', label: 'Machine ID' },
          { key: 'machineName', label: 'Machine' },
          { key: 'machineSection', label: 'Section' },
          { key: 'vendorName', label: 'Vendor' },
          { key: 'contractStartDate', label: 'AMC Start' },
          { key: 'contractEndDate', label: 'AMC End' },
          { label: 'Days Remaining', value: (row) => row.daysRemaining != null ? String(row.daysRemaining) : '—' },
          { key: 'totalVisitsAgreed', label: 'Total Visits' },
          { key: 'completedVisits', label: 'Completed Visits' },
          { label: 'Expected Visits', value: (row) => String(row.expectedVisits || 0) },
          { label: 'Status', value: (row) => row.calculatedStatus || 'ACTIVE' },
        ],
        rows: amcOverallStats(store.amc, store.machines).records.filter((r) =>
          (!amcSectionFilter || r.machineSection === amcSectionFilter) &&
          (!amcVendorFilter || r.vendorName === amcVendorFilter) &&
          (!amcStatusFilter || r.calculatedStatus === amcStatusFilter)
        ),
      },
      {
        id: 'testing-certificates',
        label: 'Testing Certificates',
        icon: Award,
        desc: 'Statutory safety testing certificate compliance across 413 assets',
        columns: [
          { key: 'machineCode', label: 'Machine Code' },
          { key: 'machineName', label: 'Machine Name' },
          { key: 'plantSection', label: 'Plant Section' },
          { key: 'certificateType', label: 'Certificate Type' },
          { key: 'certificateNumber', label: 'Cert Number' },
          { key: 'agencyName', label: 'Testing Agency' },
          { label: 'Issue Date', value: (row) => row.issueDate ? new Date(row.issueDate).toLocaleDateString('en-GB') : '—' },
          { label: 'Expiry Date', value: (row) => row.expiryDate ? new Date(row.expiryDate).toLocaleDateString('en-GB') : '—' },
          { key: 'frequency', label: 'Frequency' },
          { label: 'Status', value: (row) => certStatus(row.expiryDate).status },
          { label: 'Days Left', value: (row) => { const d = certDaysLeft(row.expiryDate); return d==null ? '—' : d<=0 ? 'EXPIRED' : `${d}d`; } },
          { label: 'Document', value: (row) => row.document?.filename || row.documentName || (row.documentUrl ? 'View' : '—' ) },
        ],
        rows: (store.testingCertificates || []).filter((r) => {
          if (certSectionFilter && r.plantSection !== certSectionFilter) return false;
          if (certTypeFilter && r.certificateType !== certTypeFilter) return false;
          if (certStatusFilter) {
            const st = certStatus(r.expiryDate).status;
            if (st !== certStatusFilter) return false;
          }
          return true;
        }),
      },
    ];
  }, [store, serverDocs, machines, breakdowns, pms, amcSectionFilter, amcVendorFilter, amcStatusFilter, certSectionFilter, certTypeFilter, certStatusFilter]);

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

      {/* ── AMC Overview KPIs, Charts & Filters ── */}
      {active === 'amc-overview' && (() => {
        const { records: amcRecords, stats: amcStats } = amcOverallStats(store.amc, store.machines);
        const totalCompletedVisits = amcRecords.reduce((s, r) => s + (r.completedVisits || 0), 0);
        const totalExpectedVisits = amcRecords.reduce((s, r) => s + (r.expectedVisits || 0), 0);
        const totalPendingVisits = Math.max(0, totalExpectedVisits - totalCompletedVisits);
        const vendors = [...new Set(amcRecords.map((r) => r.vendorName).filter(Boolean))];
        const sections = [...new Set(amcRecords.map((r) => r.machineSection).filter(Boolean))];
        const statusData = [
          { label: 'Active', value: amcStats.active, color: '#10B981' },
          { label: 'Expiring Soon', value: amcStats.expiringSoon, color: '#F59E0B' },
          { label: 'Expired', value: amcStats.expired, color: '#EF4444' },
          { label: 'Visit Overdue', value: amcStats.visitOverdue, color: '#8B5CF6' },
        ].filter((d) => d.value > 0);

        const filteredAmcRecords = amcRecords.filter((r) =>
          (!amcSectionFilter || r.machineSection === amcSectionFilter) &&
          (!amcVendorFilter || r.vendorName === amcVendorFilter) &&
          (!amcStatusFilter || r.calculatedStatus === amcStatusFilter)
        );

        const AMC_KPI = [
          { label: 'Total Contracts', value: amcStats.total, color: 'text-cyan-400', bg: 'bg-cyan-400/10 border-cyan-400/25' },
          { label: 'Active', value: amcStats.active, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/25' },
          { label: 'Expiring Soon', value: amcStats.expiringSoon, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/25' },
          { label: 'Expired', value: amcStats.expired, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/25' },
          { label: 'Visit Overdue', value: amcStats.visitOverdue, color: 'text-violet-400', bg: 'bg-violet-400/10 border-violet-400/25' },
          { label: 'Visits Completed', value: totalCompletedVisits, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/25' },
          { label: 'Visits Pending', value: totalPendingVisits, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/25' },
        ];

        return (
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {AMC_KPI.map((kpi) => (
                <div key={kpi.label} className={`rounded-control border p-3 text-center ${kpi.bg}`}>
                  <p className={`text-xl font-bold leading-none ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-slate-400 text-[10px] mt-1.5 leading-tight">{kpi.label}</p>
                </div>
              ))}
            </div>

            {/* Charts + Filters row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ChartCard title="AMC Status Distribution" subtitle="Contract status breakdown" height={220} empty={statusData.length === 0}>
                <PieDonutChart data={statusData} donut centerLabel={amcStats.total} centerSub="Contracts" />
              </ChartCard>

              {/* Filters */}
              <div className="glass-card p-5 flex flex-col justify-center">
                <h4 className="text-card-title mb-3">Filters</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-meta block mb-1">Section</label>
                    <select value={amcSectionFilter} onChange={(e) => setAmcSectionFilter(e.target.value)} className="input-field text-xs w-full">
                      <option value="">All Sections</option>
                      {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-meta block mb-1">Vendor</label>
                    <select value={amcVendorFilter} onChange={(e) => setAmcVendorFilter(e.target.value)} className="input-field text-xs w-full">
                      <option value="">All Vendors</option>
                      {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-meta block mb-1">Status</label>
                    <select value={amcStatusFilter} onChange={(e) => setAmcStatusFilter(e.target.value)} className="input-field text-xs w-full">
                      <option value="">All Statuses</option>
                      <option value="ACTIVE">Active</option>
                      <option value="EXPIRING SOON">Expiring Soon</option>
                      <option value="EXPIRED">Expired</option>
                      <option value="VISIT OVERDUE">Visit Overdue</option>
                    </select>
                  </div>
                  {(amcSectionFilter || amcVendorFilter || amcStatusFilter) && (
                    <button onClick={() => { setAmcSectionFilter(''); setAmcVendorFilter(''); setAmcStatusFilter(''); }} className="btn-ghost text-xs w-full">Clear Filters</button>
                  )}
                </div>
                <p className="text-slate-500 text-[10px] mt-3">{filteredAmcRecords.length} of {amcRecords.length} contracts shown</p>
              </div>

              {/* Expiry Timeline summary */}
              <div className="glass-card p-5 flex flex-col">
                <h4 className="text-card-title mb-3">Expiry Timeline</h4>
                <div className="space-y-2 flex-1">
                  {amcRecords
                    .filter((r) => r.daysRemaining != null)
                    .sort((a, b) => a.daysRemaining - b.daysRemaining)
                    .slice(0, 6)
                    .map((r) => {
                      const pct = r.totalVisitsAgreed > 0 ? Math.round((r.completedVisits / r.totalVisitsAgreed) * 100) : 0;
                      const daysCls = r.daysRemaining < 0 ? 'text-red-400' : r.daysRemaining <= 30 ? 'text-amber-400' : 'text-emerald-400';
                      return (
                        <div key={r.id} className="flex items-center gap-2 text-xs">
                          <span className={`font-semibold w-16 text-right ${daysCls}`}>{r.daysRemaining}d</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white truncate">{r.machineName}</p>
                            <div className="w-full bg-white/10 rounded-full h-1.5 mt-0.5">
                              <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <span className="text-slate-500 w-10 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  {amcRecords.filter((r) => r.daysRemaining != null).length === 0 && (
                    <p className="text-slate-500 text-xs">No contracts with expiry dates</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Testing Certificates Overview ── */}
      {active === 'testing-certificates' && (() => {
        const certs = store.testingCertificates || [];
        const total = certs.length;
        const valid = certs.filter((c) => certStatus(c.expiryDate).status === 'VALID').length;
        const expiring = certs.filter((c) => certStatus(c.expiryDate).status === 'EXPIRING SOON').length;
        const expired = certs.filter((c) => certStatus(c.expiryDate).status === 'EXPIRED').length;
        const compliance = total > 0 ? Math.round((valid / total) * 1000) / 10 : 0;
        const statusData = [
          { label: 'Valid', value: valid, color: '#10B981' },
          { label: 'Expiring Soon', value: expiring, color: '#F59E0B' },
          { label: 'Expired', value: expired, color: '#EF4444' },
        ].filter((d) => d.value > 0);
        const timeline = [...certs]
          .filter((c) => c.expiryDate)
          .map((c) => ({ ...c, daysLeft: certDaysLeft(c.expiryDate), status: certStatus(c.expiryDate).status }))
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .slice(0, 8);
        const sections = [...new Set(certs.map((c) => c.plantSection).filter(Boolean))].sort();
        const types = [...new Set(certs.map((c) => c.certificateType).filter(Boolean))].sort();
        const filteredForStats = certs.filter((r) => {
          if (certSectionFilter && r.plantSection !== certSectionFilter) return false;
          if (certTypeFilter && r.certificateType !== certTypeFilter) return false;
          if (certStatusFilter && certStatus(r.expiryDate).status !== certStatusFilter) return false;
          return true;
        });
        const handleExportTestingCSV = () => {
          const rows = filteredForStats;
          const cols = [
            { key: 'machineCode', label: 'Machine Code' },
            { key: 'machineName', label: 'Machine Name' },
            { key: 'plantSection', label: 'Plant Section' },
            { key: 'certificateType', label: 'Certificate Type' },
            { key: 'certificateNumber', label: 'Cert Number' },
            { key: 'agencyName', label: 'Testing Agency' },
            { label: 'Issue Date', value: (r) => r.issueDate ? new Date(r.issueDate).toLocaleDateString('en-GB') : '' },
            { label: 'Expiry Date', value: (r) => r.expiryDate ? new Date(r.expiryDate).toLocaleDateString('en-GB') : '' },
            { key: 'frequency', label: 'Frequency' },
            { label: 'Status', value: (r) => certStatus(r.expiryDate).status },
            { label: 'Days Left', value: (r) => { const d = certDaysLeft(r.expiryDate); return d==null?'': d<=0?'EXPIRED': `${d}d`; } },
          ];
          exportToCSV(rows, cols, `testing-certificates-${new Date().toISOString().slice(0,10)}.csv`);
        };
        return (
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Total Certificates', value: total, color: 'text-cyan-400', bg: 'bg-cyan-400/10 border-cyan-400/25' },
                { label: 'Valid / Active', value: valid, color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/25' },
                { label: 'Expiring Soon', value: expiring, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/25' },
                { label: 'Expired', value: expired, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/25' },
                { label: 'Compliance Rate', value: `${compliance}%`, color: compliance >= 90 ? 'text-emerald-400' : compliance >= 75 ? 'text-amber-400' : 'text-red-400', bg: compliance >= 90 ? 'bg-emerald-400/10 border-emerald-400/25' : compliance >= 75 ? 'bg-amber-400/10 border-amber-400/25' : 'bg-red-400/10 border-red-400/25' },
              ].map((kpi) => (
                <div key={kpi.label} className={`rounded-control border p-3 text-center ${kpi.bg}`}>
                  <p className={`text-xl font-bold leading-none ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-slate-400 text-[10px] mt-1.5 leading-tight">{kpi.label}</p>
                </div>
              ))}
            </div>
            {/* Charts + Timeline + Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ChartCard title="Status Distribution" subtitle="Valid vs Expiring Soon vs Expired" height={220} empty={statusData.length === 0}>
                <PieDonutChart data={statusData} donut centerLabel={total} centerSub="Certs" />
              </ChartCard>
              <div className="glass-card p-5 flex flex-col">
                <h4 className="text-card-title mb-3">Expiry Timeline</h4>
                <div className="space-y-2 flex-1">
                  {timeline.length === 0 ? (
                    <p className="text-slate-500 text-xs">No certificates with expiry dates</p>
                  ) : timeline.map((c) => {
                    const daysCls = c.daysLeft < 0 || c.daysLeft === 0 ? 'text-red-400' : c.daysLeft <= 30 ? 'text-amber-400' : 'text-emerald-400';
                    const label = c.daysLeft <= 0 ? 'EXPIRED' : `${c.daysLeft}d`;
                    return (
                      <div key={c.id} className="flex items-center gap-2 text-xs">
                        <span className={`font-semibold w-16 text-right ${daysCls}`}>{label}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white truncate">{c.machineName || c.machineCode || c.machineId} — {c.certificateType}</p>
                          <p className="text-slate-500 truncate">{c.agencyName} · {c.expiryDate ? new Date(c.expiryDate).toLocaleDateString('en-GB') : ''}</p>
                        </div>
                        <span className={`badge text-[10px] px-1.5 py-0.5 rounded-full ${c.status === 'VALID' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : c.status === 'EXPIRING SOON' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>{c.status}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="glass-card p-5 flex flex-col justify-center">
                <h4 className="text-card-title mb-3">Filters</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-meta block mb-1">Plant Section</label>
                    <select value={certSectionFilter} onChange={(e) => setCertSectionFilter(e.target.value)} className="input-field text-xs w-full">
                      <option value="">All Sections</option>
                      {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-meta block mb-1">Certificate Type</label>
                    <select value={certTypeFilter} onChange={(e) => setCertTypeFilter(e.target.value)} className="input-field text-xs w-full">
                      <option value="">All Types</option>
                      {types.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-meta block mb-1">Status</label>
                    <select value={certStatusFilter} onChange={(e) => setCertStatusFilter(e.target.value)} className="input-field text-xs w-full">
                      <option value="">All</option>
                      <option value="VALID">Valid</option>
                      <option value="EXPIRING SOON">Expiring Soon</option>
                      <option value="EXPIRED">Expired</option>
                    </select>
                  </div>
                  {(certSectionFilter || certTypeFilter || certStatusFilter) && (
                    <button onClick={() => { setCertSectionFilter(''); setCertTypeFilter(''); setCertStatusFilter(''); }} className="btn-ghost text-xs w-full">Clear Filters</button>
                  )}
                </div>
                <p className="text-slate-500 text-[10px] mt-3">{filteredForStats.length} of {total} certificates shown</p>
                <button onClick={handleExportTestingCSV} disabled={!filteredForStats.length} className="btn-success text-xs mt-3 inline-flex items-center gap-1.5 justify-center disabled:opacity-40">
                  <Download size={13} /> Export Testing Report CSV
                </button>
              </div>
            </div>
            {/* Data Table with Actions */}
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto max-h-[520px]">
                <table className="enterprise-table w-full min-w-[1200px]">
                  <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
                    <tr>
                      <th>Machine Code</th>
                      <th>Machine Name</th>
                      <th>Plant Section</th>
                      <th>Certificate Type</th>
                      <th>Cert Number</th>
                      <th>Testing Agency</th>
                      <th>Issue Date</th>
                      <th>Expiry Date</th>
                      <th>Frequency</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredForStats.slice(0, 100).map((row) => {
                      const st = certStatus(row.expiryDate);
                      const badgeCls = st.status === 'VALID' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : st.status === 'EXPIRING SOON' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30';
                      const docUrl = row.document?.publicUrl || row.documentUrl || row.document?.dataUrl || '';
                      return (
                        <tr key={row.id}>
                          <td className="font-mono text-xs text-cyan-400">{row.machineCode || row.machineId || '—' }</td>
                          <td className="text-white text-xs font-medium max-w-[140px] truncate" title={row.machineName}>{row.machineName || '—' }</td>
                          <td className="text-slate-300 text-xs max-w-[120px] truncate">{row.plantSection || '—' }</td>
                          <td className="text-white text-xs">{row.certificateType || '—' }</td>
                          <td className="font-mono text-xs text-slate-300">{row.certificateNumber || '—' }</td>
                          <td className="text-slate-300 text-xs max-w-[140px] truncate" title={row.agencyName}>{row.agencyName || '—' }</td>
                          <td className="text-slate-300 text-xs whitespace-nowrap">{row.issueDate ? new Date(row.issueDate).toLocaleDateString('en-GB') : '—' }</td>
                          <td className="text-slate-300 text-xs whitespace-nowrap">{row.expiryDate ? new Date(row.expiryDate).toLocaleDateString('en-GB') : '—' }</td>
                          <td className="text-slate-400 text-xs">{row.frequency || '—' }</td>
                          <td><span className={`badge text-[10px] px-2 py-0.5 rounded-full font-bold ${badgeCls}`}>{st.status}</span></td>
                          <td className="whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {docUrl ? (
                                <a href={docUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost !p-1.5 text-cyan-400 hover:text-cyan-300" title="View Document"><Eye size={13} /></a>
                              ) : <span className="text-slate-600 p-1.5"><Eye size={13} /></span>}
                              {row.machineId ? (
                                <button onClick={() => navigate(`/machines/${row.machineId}`)} className="btn-ghost !p-1.5 text-slate-400 hover:text-white" title="Open Machine"><ExternalLink size={13} /></button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredForStats.length === 0 && (
                  <div className="p-6 text-center">
                    <p className="text-slate-500 text-xs">No certificates match the current filters.</p>
                  </div>
                )}
                {filteredForStats.length > 100 && (
                  <p className="px-5 py-3 text-meta">Preview limited to 100 rows — exports include all {filteredForStats.length} rows.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {active !== 'testing-certificates' && (
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
                        {cellValue(col, row) || '—' }
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
      )}

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
