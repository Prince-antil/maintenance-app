import { useState, useRef } from 'react';
import { api } from '../api.js';
import { X, Upload, FileText, AlertCircle } from 'lucide-react';
import { CATEGORIES, PLANT_SECTIONS, MONTHS, YEARS, ALLOWED_EXT, EXT_META } from '../constants.js';

export default function UploadModal({ onClose, onSuccess, initialCategory = '' }) {
  const [form, setForm] = useState({
    category_name: initialCategory,
    reporting_month: '',
    reporting_year: '',
    plant_section: '',
  });
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      setError(`Invalid file type. Allowed: ${ALLOWED_EXT.join(', ')}`);
      return;
    }
    setError('');
    setFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.category_name || !form.reporting_month || !form.reporting_year || !form.plant_section) {
      setError('All fields are required');
      return;
    }
    if (!file) { setError('Please select a file'); return; }

    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category_name', form.category_name);
      fd.append('reporting_month', form.reporting_month);
      fd.append('reporting_year', form.reporting_year);
      fd.append('plant_section', form.plant_section);
      await api.uploadReport(fd);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fileExt = file ? '.' + file.name.split('.').pop().toLowerCase() : null;
  const fileMeta = fileExt ? EXT_META[fileExt] : null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Upload new report"
    >
      <div className="modal-content glass-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-card-title">Upload New Report</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor="up-category" className="block text-slate-400 text-xs font-medium mb-1.5">Category *</label>
              <select
                id="up-category"
                className="select-field"
                value={form.category_name}
                onChange={(e) => setForm({ ...form, category_name: e.target.value })}
              >
                <option value="">Select category...</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="up-month" className="block text-slate-400 text-xs font-medium mb-1.5">Reporting Month *</label>
              <select
                id="up-month"
                className="select-field"
                value={form.reporting_month}
                onChange={(e) => setForm({ ...form, reporting_month: e.target.value })}
              >
                <option value="">Month...</option>
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="up-year" className="block text-slate-400 text-xs font-medium mb-1.5">Reporting Year *</label>
              <select
                id="up-year"
                className="select-field"
                value={form.reporting_year}
                onChange={(e) => setForm({ ...form, reporting_year: e.target.value })}
              >
                <option value="">Year...</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor="up-section" className="block text-slate-400 text-xs font-medium mb-1.5">Plant Section * (21 sections)</label>
              <select
                id="up-section"
                className="select-field"
                value={form.plant_section}
                onChange={(e) => setForm({ ...form, plant_section: e.target.value })}
              >
                <option value="">Select section...</option>
                {PLANT_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* File Drop Zone */}
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5">File *</label>
            <div
              className={`border-2 border-dashed rounded-card p-6 text-center transition-all cursor-pointer ${
                dragOver
                  ? 'border-cyan-400 bg-cyan-400/5'
                  : file
                  ? 'border-emerald-400/50 bg-emerald-400/5'
                  : 'border-slate-600 hover:border-slate-500'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files[0]);
              }}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              aria-label="Select or drop a file"
            >
              <input
                ref={fileRef}
                type="file"
                accept={ALLOWED_EXT.join(',')}
                className="hidden"
                onChange={(e) => handleFile(e.target.files[0])}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-emerald-400">
                  <FileText size={18} aria-hidden="true" />
                  <span className="text-sm font-medium truncate max-w-xs">{file.name}</span>
                  {fileMeta && <span className={`badge ${fileMeta.badge}`}>{fileMeta.label}</span>}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Upload size={24} aria-hidden="true" />
                  <p className="text-sm">Drag & drop or click to select</p>
                  <p className="text-xs text-slate-500">Word, Excel, PowerPoint, PDF, CSV</p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-success flex items-center justify-center gap-2"
          >
            <Upload size={15} aria-hidden="true" />
            {loading ? 'Uploading...' : 'Upload Report'}
          </button>
        </form>
      </div>
    </div>
  );
}
