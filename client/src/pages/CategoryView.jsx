import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { api } from '../api.js';
import EnterpriseTable from '../components/EnterpriseTable.jsx';
import { CATEGORY_META, PLANT_SECTIONS, MONTHS, YEARS, EXT_META, ALLOWED_EXT } from '../constants.js';
import { getDocumentUrl, toPreviewDocument } from '../lib/documentLinks.js';
import { timeAgo } from '../utils.js';
import { deleteReportFromVault, getLocalReports, revokeReportUrls } from '../reportVault.js';
import {
  ArrowLeft, Download, Trash2, Upload, Eye, AlertTriangle, FileText,
} from 'lucide-react';

export default function CategoryView() {
  const { categoryName } = useParams();
  const decodedName = decodeURIComponent(categoryName);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openUpload, openPreview, refreshKey } = useUI();

  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [filters, setFilters] = useState({
    reporting_month: '',
    reporting_year: '',
    plant_section: '',
    file_format: '',
  });

  const meta = CATEGORY_META[decodedName] || { icon: FileText, color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20' };
  const Icon = meta.icon;

  const loadReports = async () => {
    setLoading(true);
    try {
      const params = { category: decodedName, limit: 500 };
      if (filters.reporting_month) params.month = filters.reporting_month;
      if (filters.reporting_year) params.year = filters.reporting_year;
      // "Overall" master view aggregates all sections — skip section filter
      if (filters.plant_section && filters.plant_section !== PLANT_SECTIONS[0]) {
        params.plant_section = filters.plant_section;
      }
      if (filters.file_format) params.file_format = filters.file_format;

      const [remoteResult, localResult] = await Promise.allSettled([
        api.getReports(params),
        getLocalReports({
          category: decodedName,
          month: filters.reporting_month,
          year: filters.reporting_year,
          plant_section: filters.plant_section && filters.plant_section !== PLANT_SECTIONS[0] ? filters.plant_section : '',
          file_format: filters.file_format,
        }),
      ]);

      const remoteReports = remoteResult.status === 'fulfilled' ? remoteResult.value.data || [] : [];
      const localReports = localResult.status === 'fulfilled' ? localResult.value || [] : [];
      const merged = [...localReports, ...remoteReports.filter((report) => !localReports.some((local) => local.id === report.id))];

      setReports(merged);
      setTotal(merged.length);
    } catch (e) {
      console.error(e);
      setReports([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReports(); }, [categoryName, filters, refreshKey]);
  useEffect(() => () => revokeReportUrls(reports), [reports]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      let remoteError = null;

      if (!deleteTarget.localOnly) {
        try {
          await api.deleteReport(deleteTarget.id);
        } catch (err) {
          remoteError = err;
        }
      }

      if (deleteTarget.isLocalVault) {
        await deleteReportFromVault(deleteTarget.id);
      }

      if (remoteError && !deleteTarget.isLocalVault) {
        throw remoteError;
      }

      setDeleteTarget(null);
      loadReports();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: 'filename',
      label: 'Filename',
      sortable: true,
      render: (r) => {
        const extMeta = EXT_META[r.file_format];
        return (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${extMeta?.badge || 'bg-slate-700 text-slate-400'}`}>
              <FileText size={14} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-[13px] font-medium truncate max-w-[220px]" title={r.filename}>{r.filename}</p>
              {extMeta && <span className={`badge ${extMeta.badge} mt-0.5`}>{extMeta.label}</span>}
            </div>
          </div>
        );
      },
    },
    { key: 'reporting_month', label: 'Period', sortable: true, hideBelow: 'hidden sm:table-cell', render: (r) => `${r.reporting_month} ${r.reporting_year}`, value: (r) => `${r.reporting_month} ${r.reporting_year}` },
    { key: 'plant_section', label: 'Plant Section', sortable: true, hideBelow: 'hidden md:table-cell' },
    { key: 'uploader_name', label: 'Uploaded By', sortable: true, hideBelow: 'hidden lg:table-cell', render: (r) => r.uploader_name || '—' },
    { key: 'uploaded_at', label: 'Uploaded', sortable: true, render: (r) => timeAgo(r.uploaded_at), value: (r) => r.uploaded_at || '' },
    {
      key: '_actions',
      label: 'Actions',
      render: (r) => {
        const fileUrl = getDocumentUrl(r);
        return (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileUrl && openPreview(toPreviewDocument(r))}
              disabled={!fileUrl}
              className="btn-ghost inline-flex items-center gap-1 text-[11px] !py-1 !px-2.5 disabled:opacity-40"
              aria-label={`Preview ${r.filename}`}
            >
              <Eye size={11} aria-hidden="true" /> Preview
            </button>
            <a
              href={fileUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={`btn-ghost inline-flex items-center gap-1 text-[11px] !py-1 !px-2.5 text-cyan-400 hover:text-cyan-300 ${fileUrl ? '' : 'pointer-events-none opacity-40'}`}
              aria-label={`Download ${r.filename}`}
            >
              <Download size={11} aria-hidden="true" /> Download
            </a>
            {user?.role === 'admin' && (
              <button
                onClick={() => setDeleteTarget(r)}
                className="btn-ghost inline-flex items-center gap-1 text-[11px] !py-1 !px-2.5 text-red-400 hover:text-red-300"
                aria-label={`Delete ${r.filename}`}
              >
                <Trash2 size={11} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      },
      value: () => '',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate('/')}
          className="mt-1.5 w-9 h-9 rounded-control border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-white/25 transition-all flex-shrink-0"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-11 h-11 rounded-control ${meta.bg} ${meta.border} border flex items-center justify-center flex-shrink-0`}>
            <Icon size={20} className={meta.color} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-section-heading leading-tight truncate">{decodedName}</h2>
            <p className="text-meta mt-0.5">{total} report{total !== 1 ? 's' : ''} in repository</p>
          </div>
        </div>
        {user?.role === 'admin' && (
          <button
            onClick={() => openUpload(decodedName)}
            className="btn-success inline-flex items-center gap-1.5 text-sm whitespace-nowrap"
          >
            <Upload size={14} aria-hidden="true" /> Upload Report
          </button>
        )}
      </div>

      {/* Enterprise table with filters, sort, search, pagination, export */}
      <EnterpriseTable
        columns={columns}
        rows={reports}
        loading={loading}
        searchKeys={['filename', 'plant_section', 'reporting_month', 'uploader_name']}
        exportName={decodedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
        filters={[
          { key: 'month', label: 'All Months', options: MONTHS, value: filters.reporting_month, onChange: (v) => setFilters({ ...filters, reporting_month: v }) },
          { key: 'year', label: 'All Years', options: YEARS.map(String), value: filters.reporting_year, onChange: (v) => setFilters({ ...filters, reporting_year: v }) },
          { key: 'section', label: 'All Plant Sections', options: PLANT_SECTIONS, value: filters.plant_section, onChange: (v) => setFilters({ ...filters, plant_section: v }) },
          { key: 'type', label: 'All File Types', options: ALLOWED_EXT.map((f) => ({ value: f, label: f.replace('.', '').toUpperCase() })), value: filters.file_format, onChange: (v) => setFilters({ ...filters, file_format: v }) },
        ]}
        emptyTitle="No reports uploaded yet"
        emptyDescription={`Reports for "${decodedName}" will appear here once uploaded.`}
        emptyActionLabel={user?.role === 'admin' ? 'Upload First Report' : undefined}
        onEmptyAction={user?.role === 'admin' ? () => openUpload(decodedName) : undefined}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)} role="dialog" aria-modal="true" aria-label="Delete report confirmation">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-control bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <AlertTriangle size={18} className="text-red-400" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-card-title">Delete Report</h3>
                <p className="text-meta">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-body mb-5 break-words">
              Are you sure you want to delete <span className="text-white font-medium">"{deleteTarget.filename}"</span>?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="btn-danger text-xs flex items-center gap-1.5">
                <Trash2 size={12} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
