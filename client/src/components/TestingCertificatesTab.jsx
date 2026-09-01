/**
 * TestingCertificatesTab — Statutory Testing & Safety Certificate tracking
 * Features:
 *  - List statutory test certificates for a machine
 *  - Certificate Type, Number, Agency, Issue/Expiry, Frequency, Days Left, Document
 *  - Status badges: VALID (>30), EXPIRING SOON (1-30), EXPIRED (<=0)
 *  - Add/Edit modal, document upload (PDF/Image), Supabase storage fallback to dataUrl
 *  - Sync via store commitAndQueue (localStorage + Supabase Realtime)
 */
import { useRef, useState } from 'react';
import {
  useStore,
  addTestingCertificate,
  updateTestingCertificate,
  deleteTestingCertificate,
  getTestingCertificateStatus,
} from '../store.js';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase, isSupabaseConfigured, SUPABASE_CERT_BUCKET } from '../lib/supabaseClient.js';
import EmptyState from './EmptyState.jsx';
import {
  ShieldCheck, Plus, Pencil, Trash2, Upload, FileText,
  AlertTriangle, CheckCircle2, X, Save, Eye, Download,
  CalendarDays, Award, ClipboardList, AlertCircle, Clock,
} from 'lucide-react';

const MAX_CERT_BYTES = 10 * 1024 * 1024;

const CERTIFICATE_TYPES = [
  'Pressure Vessel Test',
  'Lifting Tackles / Crane Inspection',
  'Fire Safety',
  'Calibration',
  'ETP Compliance',
  'Electrical Safety',
  'Boiler Inspection',
  'Air Receiver Test',
  'Safety Valve Test',
  'Earth Pit Test',
  'Other',
];

const FREQUENCIES = ['6 Months', '1 Year', '2 Years', '3 Years', '5 Years', 'Custom'];

const EMPTY_FORM = {
  certificateType: 'Pressure Vessel Test',
  certificateNumber: '',
  agencyName: '',
  issueDate: '',
  expiryDate: '',
  frequency: '1 Year',
  remarks: '',
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(dateStr); expiry.setHours(0,0,0,0);
  return Math.ceil((expiry - today) / (1000*60*60*24));
}

function statusMeta(expiryDate) {
  return getTestingCertificateStatus(expiryDate);
}

async function uploadCertFile(file, machineId, certId, uploadedBy) {
  // Try Supabase storage first, fallback to dataUrl
  if (isSupabaseConfigured && supabase) {
    try {
      const bucket = SUPABASE_CERT_BUCKET;
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
      const storagePath = `certs/${machineId}/${certId}/${stamp}-${safeName}`;
      // Attempt bucket upload; if bucket missing, it will throw and fallback
      const { error } = await supabase.storage.from(bucket).upload(storagePath, file, { cacheControl: '3600', upsert: false });
      if (!error) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        return {
          filename: file.name,
          storagePath,
          publicUrl: data?.publicUrl || '',
          uploadedAt: new Date().toISOString(),
          uploadedBy,
        };
      }
      // If bucket error, try fallback bucket
      const fallbackBucket = 'maintenance-documents';
      const { error: fbErr } = await supabase.storage.from(fallbackBucket).upload(storagePath, file, { cacheControl: '3600', upsert: false });
      if (!fbErr) {
        const { data } = supabase.storage.from(fallbackBucket).getPublicUrl(storagePath);
        return {
          filename: file.name,
          storagePath,
          publicUrl: data?.publicUrl || '',
          uploadedAt: new Date().toISOString(),
          uploadedBy,
        };
      }
    } catch {
      // fall through to dataUrl
    }
  }
  // Fallback: dataUrl (local only)
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
  return {
    filename: file.name,
    dataUrl,
    storagePath: '',
    publicUrl: dataUrl,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}

function StatusBadge({ expiryDate }) {
  const { status, tone } = statusMeta(expiryDate);
  const styles = {
    success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    danger: 'bg-red-500/15 text-red-400 border border-red-500/30',
    info: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
  };
  return <span className={`badge text-[10px] px-2 py-0.5 rounded-full font-bold ${styles[tone] || styles.info}`}>{status}</span>;
}

function CertificateForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [docFile, setDocFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const inp = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const lbl = 'block text-xs text-slate-400 mb-1';

  const submit = async (e) => {
    e.preventDefault();
    if (!form.certificateType.trim() || !form.certificateNumber.trim() || !form.expiryDate) return;
    setUploading(true);
    try {
      let document = initial?.document || null;
      if (docFile) {
        // Will be handled by parent after save; store file for parent to upload
        // For now pass file via special key
        onSave({ ...form, _docFile: docFile });
        return;
      }
      onSave(form);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-5 rounded-control bg-white/[0.03] border border-white/[0.08]">
      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
        <Award size={14} className="text-cyan-400" aria-hidden="true" />
        {initial?.id ? 'Edit Safety Certificate' : 'Add Safety Certificate'}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Certificate Type *</label>
          <select value={form.certificateType} onChange={set('certificateType')} className={inp} required>
            {CERTIFICATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Certificate / License Number *</label>
          <input type="text" value={form.certificateNumber} onChange={set('certificateNumber')} className={inp} placeholder="e.g. PV-2024-001" required />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Testing Agency / Inspector Name *</label>
          <input type="text" value={form.agencyName} onChange={set('agencyName')} className={inp} placeholder="e.g. TUV India, Inspector Name" required />
        </div>
        <div>
          <label className={lbl}>Issue Date (Start Date) *</label>
          <input type="date" value={form.issueDate} onChange={set('issueDate')} className={inp} required />
        </div>
        <div>
          <label className={lbl}>Expiry Date (End Date) *</label>
          <input type="date" value={form.expiryDate} onChange={set('expiryDate')} className={inp} required />
        </div>
        <div>
          <label className={lbl}>Frequency</label>
          <select value={form.frequency} onChange={set('frequency')} className={inp}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Document (PDF/Image)</label>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={(e) => setDocFile(e.target.files?.[0] || null)} className="w-full text-xs text-slate-400 file:mr-3 file:rounded-control file:border-0 file:bg-cyan-500 file:text-white file:px-3 file:py-1.5 file:text-xs hover:file:bg-cyan-600" />
          {form.document?.filename && !docFile && <p className="text-[10px] text-slate-500 mt-1">Current: {form.document.filename}</p>}
          {docFile && <p className="text-[10px] text-emerald-400 mt-1">Selected: {docFile.name} ({Math.round(docFile.size/1024)} KB)</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Remarks</label>
          <textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inp} placeholder="Optional notes" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-xs">Cancel</button>}
        <button type="submit" disabled={uploading} className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save size={12} aria-hidden="true" /> {uploading ? 'Saving...' : (initial?.id ? 'Save Changes' : 'Create Certificate')}
        </button>
      </div>
    </form>
  );
}

function CertificateRow({ cert, onEdit, onDelete, machineId }) {
  const { status, daysLeft, tone } = statusMeta(cert.expiryDate);
  const doc = cert.document;
  const docUrl = doc?.publicUrl || doc?.dataUrl || cert.documentUrl || '';
  const docName = doc?.filename || cert.documentName || '';

  return (
    <tr>
      <td className="text-white text-xs font-medium">{cert.certificateType || '—' }</td>
      <td className="font-mono text-xs text-cyan-300">{cert.certificateNumber || '—' }</td>
      <td className="text-slate-300 text-xs">{cert.agencyName || '—' }</td>
      <td className="text-slate-300 text-xs whitespace-nowrap">{cert.issueDate ? new Date(cert.issueDate).toLocaleDateString('en-GB') : '—' }</td>
      <td className="text-slate-300 text-xs whitespace-nowrap">{cert.expiryDate ? new Date(cert.expiryDate).toLocaleDateString('en-GB') : '—' }</td>
      <td className="text-slate-400 text-xs">{cert.frequency || '—' }</td>
      <td className={`text-xs font-bold ${daysLeft == null ? 'text-slate-500' : daysLeft <=0 ? 'text-red-400' : daysLeft <=30 ? 'text-amber-400' : 'text-emerald-400'}`}>
        {daysLeft == null ? '—' : daysLeft <0 ? `${daysLeft}d` : `${daysLeft}d`}
      </td>
      <td>
        {docUrl ? (
          <a href={docUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300" title={docName}>
            <FileText size={12} /> {docName ? (docName.length > 18 ? docName.slice(0,18)+'…' : docName) : 'View'}
          </a>
        ) : <span className="text-slate-600 text-xs"> — </span>}
      </td>
      <td><StatusBadge expiryDate={cert.expiryDate} /></td>
      <td className="whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(cert)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label={`Edit ${cert.certificateNumber}`}><Pencil size={12} /></button>
          <button onClick={() => onDelete(cert)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label={`Delete ${cert.certificateNumber}`}><Trash2 size={12} /></button>
        </div>
      </td>
    </tr>
  );
}

export default function TestingCertificatesTab({ machineId, machineName }) {
  const { user } = useAuth();
  const store = useStore();
  const userName = user?.full_name || user?.username || 'Admin';
  const isAdmin = user?.role === 'admin';

  const records = (store.testingCertificates || []).filter((r) => r.machineId === machineId);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all'); // all | valid | expiring | expired
  const [uploadErr, setUploadErr] = useState('');

  const filtered = records.filter((r) => {
    const { status } = statusMeta(r.expiryDate);
    if (filter === 'valid') return status === 'VALID';
    if (filter === 'expiring') return status === 'EXPIRING SOON';
    if (filter === 'expired') return status === 'EXPIRED';
    return true;
  }).sort((a,b) => {
    const da = daysUntil(a.expiryDate) ?? 9999;
    const db = daysUntil(b.expiryDate) ?? 9999;
    return da - db;
  });

  const counts = {
    total: records.length,
    valid: records.filter((r) => statusMeta(r.expiryDate).status === 'VALID').length,
    expiring: records.filter((r) => statusMeta(r.expiryDate).status === 'EXPIRING SOON').length,
    expired: records.filter((r) => statusMeta(r.expiryDate).status === 'EXPIRED').length,
  };

  const handleCreate = async (form) => {
    setUploadErr('');
    try {
      let doc = null;
      if (form._docFile) {
        doc = await uploadCertFile(form._docFile, machineId, `cert-${Date.now()}`, userName);
        delete form._docFile;
      }
      const payload = { ...form, machineId, machineCode: store.machines.find((m) => m.id === machineId)?.machineCode || machineId, machineName, plantSection: store.machines.find((m) => m.id === machineId)?.section || '', document: doc };
      addTestingCertificate(payload, userName);
      setShowForm(false);
    } catch (err) {
      setUploadErr(err.message || 'Failed to create certificate');
    }
  };

  const handleUpdate = async (id, form) => {
    setUploadErr('');
    try {
      let doc = filtered.find((r) => r.id === id)?.document || null;
      if (form._docFile) {
        doc = await uploadCertFile(form._docFile, machineId, id, userName);
        delete form._docFile;
      } else if (form.document) {
        doc = form.document;
      }
      updateTestingCertificate(id, { ...form, document: doc, documentName: doc?.filename || '', documentUrl: doc?.publicUrl || doc?.dataUrl || '', documentPath: doc?.storagePath || '' }, userName);
      setEditing(null);
    } catch (err) {
      setUploadErr(err.message || 'Failed to update');
    }
  };

  const handleDelete = (cert) => {
    if (!window.confirm(`Delete certificate ${cert.certificateType} — ${cert.certificateNumber}?`)) return;
    deleteTestingCertificate(cert.id, userName);
  };

  // For parent badge
  const totalAlerts = counts.expiring + counts.expired;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Award size={16} className="text-cyan-400" aria-hidden="true" />
          <div>
            <h3 className="text-card-title">Testing Certificates</h3>
            <p className="text-meta mt-0.5">Statutory test certificates for {machineName}</p>
          </div>
          {totalAlerts > 0 && <span className="badge bg-amber-500/15 text-amber-300 border border-amber-500/30">{totalAlerts} alert{totalAlerts!==1?'s':''}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px]">
            <span className="badge bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">VALID {counts.valid}</span>
            <span className="badge bg-amber-500/15 text-amber-400 border border-amber-500/30">EXPIRING {counts.expiring}</span>
            <span className="badge bg-red-500/15 text-red-400 border border-red-500/30">EXPIRED {counts.expired}</span>
          </div>
          {isAdmin && !showForm && !editing && (
            <button onClick={() => setShowForm(true)} className="btn-primary text-xs inline-flex items-center gap-1.5">
              <Plus size={13} /> Add Safety Certificate
            </button>
          )}
        </div>
      </div>

      {uploadErr && (
        <div className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center gap-2" role="alert">
          <AlertCircle size={12} /> {uploadErr}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: `All (${counts.total})` },
          { id: 'valid', label: `Valid (${counts.valid})` },
          { id: 'expiring', label: `Expiring Soon (${counts.expiring})` },
          { id: 'expired', label: `Expired (${counts.expired})` },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-xs px-3 py-1.5 rounded-control border transition-colors ${filter===f.id ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:border-white/[0.12]'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showForm && (
        <CertificateForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}
      {editing && (
        <CertificateForm initial={editing} onSave={(form) => handleUpdate(editing.id, form)} onCancel={() => setEditing(null)} />
      )}

      {filtered.length === 0 && !showForm && !editing ? (
        <EmptyState
          title={records.length === 0 ? 'No certificates yet' : 'No certificates match filter'}
          description={records.length === 0 ? 'Add statutory test certificates to track Pressure Vessel, Crane, Fire Safety, Calibration, ETP compliance and more.' : 'Try a different filter.'}
          actionLabel={isAdmin && records.length === 0 ? 'Add First Certificate' : undefined}
          onAction={isAdmin && records.length === 0 ? () => setShowForm(true) : undefined}
        />
      ) : filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="enterprise-table w-full min-w-[1100px]">
            <thead>
              <tr>
                <th>Certificate Type</th>
                <th>Certificate No.</th>
                <th>Agency / Inspector</th>
                <th>Issue Date</th>
                <th>Expiry Date</th>
                <th>Frequency</th>
                <th>Days Left</th>
                <th>Document</th>
                <th>Status</th>
                <th className="w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cert) => (
                <CertificateRow key={cert.id} cert={cert} onEdit={setEditing} onDelete={handleDelete} machineId={machineId} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function getTestingCertificateAlertCountForMachine(certificates, machineId) {
  const list = (certificates || []).filter((r) => r.machineId === machineId);
  return list.filter((r) => {
    const { status } = getTestingCertificateStatus(r.expiryDate);
    return status === 'EXPIRED' || status === 'EXPIRING SOON';
  }).length;
}
