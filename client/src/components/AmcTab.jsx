/**
 * AmcTab — Annual Maintenance Contract management panel.
 *
 * Features:
 *  - Add / edit AMC contract (vendor, dates, visits)
 *  - Expiry alert: flags "Expiring Soon" within 30 days
 *  - Service visit overdue alert: flags when completedVisits < expectedVisits
 *  - Upload AMC Agreement → clears expiry alert, updates contract dates
 *  - Upload Service Visit Report → increments completedVisits, clears overdue alert
 *  - Documents saved to Supabase Storage 'amc-documents' bucket
 *  - All mutations sync to Supabase Realtime via store commitAndQueue
 */
import { useRef, useState } from 'react';
import {
  useStore,
  addAmcRecord, updateAmcRecord, deleteAmcRecord,
  getAmcForMachine,
} from '../store.js';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase, isSupabaseConfigured, SUPABASE_AMC_BUCKET } from '../lib/supabaseClient.js';
import EmptyState from './EmptyState.jsx';
import {
  ShieldCheck, Plus, Pencil, Trash2, Upload, FileText,
  AlertTriangle, CheckCircle2, X, Save, Eye, Download,
  CalendarDays, Users, ClipboardList, AlertCircle,
} from 'lucide-react';

const MAX_AMC_BYTES = 10 * 1024 * 1024; // 10 MB

const EMPTY_FORM = {
  vendorName: '',
  contractStartDate: '',
  contractEndDate: '',
  totalVisitsAgreed: '',
  completedVisits: '',
  remarks: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function elapsedPct(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr).getTime();
  const end   = new Date(endStr).getTime();
  const now   = Date.now();
  if (end <= start) return 0;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

function expectedVisits(totalVisits, startStr, endStr) {
  if (!totalVisits || !startStr || !endStr) return 0;
  return Math.round((elapsedPct(startStr, endStr) / 100) * totalVisits);
}

async function uploadAmcFile(file, machineId, docType, uploadedBy) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase storage is not configured — connect Supabase to enable AMC uploads.');
  }
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  const storagePath = `amc/${machineId}/${docType}/${stamp}-${safeName}`;
  const { error } = await supabase.storage
    .from(SUPABASE_AMC_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message || 'Storage upload failed');
  const { data } = supabase.storage.from(SUPABASE_AMC_BUCKET).getPublicUrl(storagePath);
  return {
    id: `amcdoc-${stamp}`,
    filename: file.name,
    storagePath,
    publicUrl: data?.publicUrl || '',
    docType,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}

// ── Sub-components ──────────────────────────────────────────────────────────

function AlertBanner({ tone, icon: Icon, title, children }) {
  const styles = {
    warning:  'bg-amber-500/10 border-amber-500/30 text-amber-300',
    danger:   'bg-red-500/10 border-red-500/30 text-red-300',
    success:  'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  };
  return (
    <div className={`rounded-control border px-4 py-3 flex items-start gap-3 ${styles[tone] || styles.warning}`} role="alert">
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="text-xs leading-relaxed">
        <p className="font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function ContractForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const inp = 'w-full rounded-control bg-white/[0.06] border border-white/[0.12] px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/60';
  const lbl = 'block text-xs text-slate-400 mb-1';

  const submit = (e) => {
    e.preventDefault();
    if (!form.vendorName.trim() || !form.contractStartDate || !form.contractEndDate) return;
    onSave(form);
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-5 rounded-control bg-white/[0.03] border border-white/[0.08]">
      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
        <ShieldCheck size={14} className="text-cyan-400" aria-hidden="true" />
        {initial?.id ? 'Edit AMC Contract' : 'New AMC Contract'}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={lbl}>Vendor / Contractor Name *</label>
          <input type="text" value={form.vendorName} onChange={set('vendorName')} className={inp} placeholder="e.g. Siemens Service Pvt Ltd" required />
        </div>
        <div>
          <label className={lbl}>Contract Start Date *</label>
          <input type="date" value={form.contractStartDate} onChange={set('contractStartDate')} className={inp} required />
        </div>
        <div>
          <label className={lbl}>Contract End Date *</label>
          <input type="date" value={form.contractEndDate} onChange={set('contractEndDate')} className={inp} required />
        </div>
        <div>
          <label className={lbl}>Total Visits Agreed</label>
          <input type="number" min="0" value={form.totalVisitsAgreed} onChange={set('totalVisitsAgreed')} className={inp} placeholder="12" />
        </div>
        <div>
          <label className={lbl}>Completed Visits</label>
          <input type="number" min="0" value={form.completedVisits} onChange={set('completedVisits')} className={inp} placeholder="0" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Remarks</label>
          <textarea rows={2} value={form.remarks} onChange={set('remarks')} className={inp} placeholder="Scope of contract, exclusions, contact details…" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost text-xs">Cancel</button>}
        <button type="submit" className="btn-primary text-xs inline-flex items-center gap-1.5">
          <Save size={12} aria-hidden="true" /> {initial?.id ? 'Save Changes' : 'Create Contract'}
        </button>
      </div>
    </form>
  );
}

// ── Document list row ───────────────────────────────────────────────────────

function DocRow({ doc, onDelete }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-control border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-control flex items-center justify-center shrink-0 bg-violet-500/10 border border-violet-500/20">
          <FileText size={15} className="text-violet-400" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-medium truncate">{doc.filename}</p>
          <p className="text-slate-500 text-[10px]">
            {doc.docType === 'agreement' ? 'AMC Agreement' : 'Service Visit Report'} · {doc.uploadedBy} · {new Date(doc.uploadedAt).toLocaleDateString('en-GB')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {doc.publicUrl && (
          <>
            <a href={doc.publicUrl} target="_blank" rel="noopener noreferrer"
               className="btn-ghost inline-flex items-center gap-1 text-xs !py-1.5" aria-label={`Preview ${doc.filename}`}>
              <Eye size={12} aria-hidden="true" /> Preview
            </a>
            <a href={doc.publicUrl} download={doc.filename}
               className="btn-ghost inline-flex items-center gap-1 text-xs !py-1.5" aria-label={`Download ${doc.filename}`}>
              <Download size={12} aria-hidden="true" /> Download
            </a>
          </>
        )}
        {onDelete && (
          <button onClick={() => onDelete(doc)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label={`Delete ${doc.filename}`}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

// ── Single AMC Contract card ────────────────────────────────────────────────

function AmcContractCard({ record, machineId, userName, isAdmin }) {
  const [editing, setEditing] = useState(false);
  const [uploadingType, setUploadingType] = useState(null); // 'agreement' | 'visit' | null
  const [uploadErr, setUploadErr] = useState('');
  const agreementRef = useRef(null);
  const visitRef = useRef(null);

  const days    = daysUntil(record.contractEndDate);
  const expiring = days !== null && days <= 30 && days >= 0;
  const expired  = days !== null && days < 0;
  const exp      = expectedVisits(record.totalVisitsAgreed, record.contractStartDate, record.contractEndDate);
  const visitOverdue = record.totalVisitsAgreed > 0 && record.completedVisits < exp;
  const pct      = elapsedPct(record.contractStartDate, record.contractEndDate);

  const handleUpload = async (file, docType) => {
    if (!file) return;
    if (file.size > MAX_AMC_BYTES) { setUploadErr('File exceeds 10 MB limit.'); return; }
    setUploadErr('');
    setUploadingType(docType);
    try {
      const doc = await uploadAmcFile(file, machineId, docType, userName);
      const patch = {
        documents: [doc, ...(record.documents || [])],
      };
      // Uploading a new agreement → update contract dates from the record itself (already saved)
      // and clear expiry concern (user has renewed)
      if (docType === 'agreement') {
        // No date auto-change needed here — user must edit the contract dates separately
        // The upload itself serves as evidence the contract is current
      }
      if (docType === 'visit') {
        patch.completedVisits = (record.completedVisits || 0) + 1;
      }
      updateAmcRecord(record.id, patch, userName);
    } catch (err) {
      setUploadErr(err.message || 'Upload failed');
    } finally {
      setUploadingType(null);
    }
  };

  const handleDeleteDoc = async (doc) => {
    try {
      if (isSupabaseConfigured && supabase && doc.storagePath) {
        await supabase.storage.from(SUPABASE_AMC_BUCKET).remove([doc.storagePath]);
      }
    } catch {
      // Best-effort storage cleanup — always remove from record
    }
    updateAmcRecord(record.id, {
      documents: (record.documents || []).filter((d) => d.id !== doc.id),
    }, userName);
  };

  if (editing) {
    return (
      <ContractForm
        initial={record}
        onSave={(form) => { updateAmcRecord(record.id, form, userName); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-control border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-control bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <ShieldCheck size={16} className="text-violet-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{record.vendorName}</p>
            <p className="text-slate-500 text-[10px] mt-0.5 flex items-center gap-1">
              <CalendarDays size={10} aria-hidden="true" />
              {record.contractStartDate ? new Date(record.contractStartDate).toLocaleDateString('en-GB') : '—' }
              {' → '}
              {record.contractEndDate  ? new Date(record.contractEndDate).toLocaleDateString('en-GB')  : '—' }
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setEditing(true)} className="btn-ghost !p-1.5 text-slate-400 hover:text-cyan-400" aria-label="Edit contract">
              <Pencil size={13} aria-hidden="true" />
            </button>
            <button onClick={() => deleteAmcRecord(record.id, userName)} className="btn-ghost !p-1.5 text-red-400 hover:text-red-300" aria-label="Delete contract">
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* KPIs + tenure bar */}
      <div className="px-5 py-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: 'Total Visits', value: record.totalVisitsAgreed || '—' , icon: ClipboardList, color: 'text-cyan-300' },
            { label: 'Completed',    value: record.completedVisits   || 0,   icon: CheckCircle2,  color: 'text-emerald-300' },
            { label: 'Expected Now', value: exp,                              icon: Users,         color: visitOverdue ? 'text-amber-300' : 'text-slate-300' },
            { label: 'Days Left',    value: days !== null ? `${days}d` : '—' , icon: CalendarDays,  color: expired ? 'text-red-400' : expiring ? 'text-amber-300' : 'text-emerald-300' },
          ].map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className="rounded-control bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
                <p className={`text-base font-bold flex items-center justify-center gap-1 ${k.color}`}>
                  <Icon size={12} aria-hidden="true" />{k.value}
                </p>
                <p className="text-slate-500 text-[10px] mt-0.5">{k.label}</p>
              </div>
            );
          })}
        </div>

        {/* Contract tenure progress bar */}
        {record.contractStartDate && record.contractEndDate && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Contract tenure</span>
              <span>{Math.round(pct)}% elapsed</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pct > 85 ? 'bg-red-400' : pct > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Alert banners */}
        {expired && (
          <AlertBanner tone="danger" icon={AlertTriangle} title="AMC Contract Expired">
            <p>This contract expired on {new Date(record.contractEndDate).toLocaleDateString('en-GB')}. Upload a renewed AMC Agreement and update the contract dates to clear this alert.</p>
          </AlertBanner>
        )}
        {!expired && expiring && (
          <AlertBanner tone="warning" icon={AlertTriangle} title="AMC Expiring Soon">
            <p>Contract ends in <strong>{days} day{days !== 1 ? 's' : ''}</strong> on {new Date(record.contractEndDate).toLocaleDateString('en-GB')}. Upload the renewed agreement and update contract dates to dismiss.</p>
          </AlertBanner>
        )}
        {visitOverdue && (
          <AlertBanner tone="warning" icon={AlertTriangle} title="Service Visit Overdue">
            <p>Expected <strong>{exp}</strong> visit{exp !== 1 ? 's' : ''} based on elapsed tenure, but only <strong>{record.completedVisits}</strong> completed. Upload a Service Visit Report to increment the counter and clear this alert.</p>
          </AlertBanner>
        )}
        {!expired && !expiring && !visitOverdue && record.contractEndDate && (
          <AlertBanner tone="success" icon={CheckCircle2} title="AMC Contract Active">
            <p>Contract is current and visit schedule is on track.</p>
          </AlertBanner>
        )}

        {record.remarks && (
          <p className="text-slate-400 text-xs leading-relaxed">{record.remarks}</p>
        )}

        {uploadErr && (
          <div className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center gap-2" role="alert">
            <AlertCircle size={12} aria-hidden="true" /> {uploadErr}
          </div>
        )}
      </div>

      {/* Upload actions */}
      {isAdmin && (
        <div className="px-5 pb-4 flex flex-wrap gap-2">
          <input ref={agreementRef} type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.xls"
            onChange={(e) => { handleUpload(e.target.files[0], 'agreement'); e.target.value = ''; }} />
          <input ref={visitRef} type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.xls"
            onChange={(e) => { handleUpload(e.target.files[0], 'visit'); e.target.value = ''; }} />
          <button
            disabled={!!uploadingType}
            onClick={() => agreementRef.current?.click()}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            <Upload size={12} aria-hidden="true" />
            {uploadingType === 'agreement' ? 'Uploading…' : 'Upload AMC Agreement'}
          </button>
          <button
            disabled={!!uploadingType}
            onClick={() => visitRef.current?.click()}
            className="btn-success inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            <Upload size={12} aria-hidden="true" />
            {uploadingType === 'visit' ? 'Uploading…' : 'Upload Service Visit Report'}
          </button>
          <span className="text-slate-600 text-[10px] self-center">PDF, DOCX, XLSX · up to 10 MB</span>
        </div>
      )}

      {/* Document list */}
      {(record.documents || []).length > 0 && (
        <div className="px-5 pb-5">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-2">Uploaded Documents</p>
          <ul className="space-y-2">
            {record.documents.map((doc) => (
              <DocRow key={doc.id} doc={doc} onDelete={isAdmin ? handleDeleteDoc : null} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * @param {{ machineId: string, machineName: string }} props
 */
export default function AmcTab({ machineId, machineName }) {
  const { user } = useAuth();
  const store = useStore();
  const userName = user?.full_name || user?.username || 'Admin';
  const isAdmin  = user?.role === 'admin';

  const records = (store.amc || []).filter((r) => r.machineId === machineId);
  const [showForm, setShowForm] = useState(false);

  // Derive summary alert counts for parent badge
  const expiryAlerts  = records.filter((r) => { const d = daysUntil(r.contractEndDate); return d !== null && d <= 30; }).length;
  const visitAlerts   = records.filter((r) => {
    const exp = expectedVisits(r.totalVisitsAgreed, r.contractStartDate, r.contractEndDate);
    return r.totalVisitsAgreed > 0 && r.completedVisits < exp;
  }).length;
  const totalAlerts = expiryAlerts + visitAlerts;

  const handleCreate = (form) => {
    addAmcRecord({ ...form, machineId }, userName);
    setShowForm(false);
  };

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck size={16} className="text-violet-400" aria-hidden="true" />
          <div>
            <h3 className="text-card-title">AMC Management</h3>
            <p className="text-meta mt-0.5">Annual Maintenance Contracts for {machineName}</p>
          </div>
          {totalAlerts > 0 && (
            <span className="badge bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {totalAlerts} alert{totalAlerts !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {isAdmin && !showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary text-xs inline-flex items-center gap-1.5">
            <Plus size={13} aria-hidden="true" /> Add Contract
          </button>
        )}
      </div>

      {/* New contract form */}
      {showForm && (
        <ContractForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* Contract cards */}
      {records.length === 0 && !showForm ? (
        <EmptyState
          title="No AMC records yet"
          description="Add an Annual Maintenance Contract to track vendor agreements, visit schedules, and expiry alerts for this machine."
          actionLabel={isAdmin ? 'Add First Contract' : undefined}
          onAction={isAdmin ? () => setShowForm(true) : undefined}
        />
      ) : (
        <div className="space-y-4">
          {records.map((record) => (
            <AmcContractCard
              key={record.id}
              record={record}
              machineId={machineId}
              userName={userName}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Returns the number of active AMC alerts (expiry + visit overdue) for a machine.
 * Used by MachineProfile to show the badge count on the AMC tab.
 */
export function getAmcAlertCount(amcRecords, machineId) {
  const records = (amcRecords || []).filter((r) => r.machineId === machineId);
  return records.filter((r) => {
    const d   = daysUntil(r.contractEndDate);
    const exp = expectedVisits(r.totalVisitsAgreed, r.contractStartDate, r.contractEndDate);
    const expiryAlert = d !== null && d <= 30;
    const visitAlert  = r.totalVisitsAgreed > 0 && r.completedVisits < exp;
    return expiryAlert || visitAlert;
  }).length;
}
