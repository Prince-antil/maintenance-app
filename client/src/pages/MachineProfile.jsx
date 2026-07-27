import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { getMachine, addMachineDoc, removeMachineDoc, updateMachine } from '../machinesStore.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { MACHINE_DOC_TABS, EXT_META, ALLOWED_EXT } from '../constants.js';
import { timeAgo } from '../utils.js';
import {
  ArrowLeft, Cog, MapPin, Upload, Eye, Download, Trash2, FileText, AlertCircle,
} from 'lucide-react';

const MEDIA_EXT = ['.mp4', '.webm', '.mov'];
const MAX_DOC_BYTES = 4 * 1024 * 1024; // browser vault limit

/**
 * Machine profile — categorised file tabs with document count badges.
 */
export default function MachineProfile() {
  const { machineId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openPreview } = useUI();

  const [machine, setMachine] = useState(null);
  const [tab, setTab] = useState('sop');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setMachine(getMachine(machineId));
  }, [machineId]);

  if (!machine) {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState
          title="Machine not found"
          description="This machine profile may have been removed."
          actionLabel="Back to Machine Directory"
          onAction={() => navigate('/machines')}
        />
      </div>
    );
  }

  const docs = (machine.docs || []).filter((d) => d.tab === tab);
  const tabCounts = Object.fromEntries(
    MACHINE_DOC_TABS.map((t) => [t.id, (machine.docs || []).filter((d) => d.tab === t.id).length])
  );

  const acceptExt = tab === 'media' ? [...MEDIA_EXT, ...ALLOWED_EXT] : ALLOWED_EXT;

  const handleFile = (f) => {
    if (!f) return;
    setError('');
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!acceptExt.includes(ext)) {
      setError(`Invalid file type. Allowed: ${acceptExt.join(', ')}`);
      return;
    }
    if (f.size > MAX_DOC_BYTES) {
      setError('File exceeds the 4 MB machine-vault limit. Upload large files via a report category instead.');
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      addMachineDoc(machine.id, {
        tab,
        filename: f.name,
        file_format: ext,
        file_url: reader.result,
        uploadedBy: user?.full_name || 'Admin',
      });
      setMachine(getMachine(machine.id));
      setUploading(false);
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setUploading(false);
    };
    reader.readAsDataURL(f);
  };

  const handleStatusChange = (status) => {
    updateMachine(machine.id, { status });
    setMachine(getMachine(machine.id));
  };

  const handleRemoveDoc = (docId) => {
    removeMachineDoc(machine.id, docId);
    setMachine(getMachine(machine.id));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => navigate('/machines')}
          className="mt-1.5 w-9 h-9 rounded-control border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-white/25 transition-all flex-shrink-0"
          aria-label="Back to machine directory"
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-page-title flex items-center gap-3 flex-wrap">
            <Cog size={26} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
            {machine.name}
          </h2>
          <p className="text-body mt-1 flex items-center gap-1.5">
            <MapPin size={12} aria-hidden="true" /> {machine.section}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {user?.role === 'admin' ? (
            <select
              className="select-field !w-auto text-xs"
              value={machine.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              aria-label="Machine status"
            >
              <option value="running">Running</option>
              <option value="maintenance">Under Maintenance</option>
              <option value="breakdown">Breakdown</option>
              <option value="standby">Standby</option>
            </select>
          ) : (
            <StatusBadge status={machine.status} pulse={machine.status === 'breakdown'} />
          )}
        </div>
      </div>

      {/* Categorised file tabs with count badges */}
      <div className="glass-card overflow-hidden">
        <div className="flex overflow-x-auto border-b border-white/[0.06]" role="tablist" aria-label="Document categories">
          {MACHINE_DOC_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => { setTab(t.id); setError(''); }}
              className={`flex items-center gap-2 px-4 lg:px-5 py-3.5 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-cyan-400 text-white bg-cyan-500/5'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
              <span className={`badge ${tab === t.id ? 'bg-cyan-500/15 text-cyan-400' : 'bg-slate-700/60 text-slate-400'}`}>
                {tabCounts[t.id]}
              </span>
            </button>
          ))}
        </div>

        <div className="p-4 lg:p-5">
          {/* Admin upload strip */}
          {user?.role === 'admin' && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
              <input
                ref={fileRef}
                type="file"
                accept={acceptExt.join(',')}
                className="hidden"
                onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="btn-success inline-flex items-center gap-2 text-xs whitespace-nowrap"
              >
                <Upload size={13} aria-hidden="true" />
                {uploading ? 'Attaching...' : `Upload ${MACHINE_DOC_TABS.find((t) => t.id === tab)?.label}`}
              </button>
              <p className="text-meta">Word, Excel, PowerPoint, PDF{tab === 'media' ? ', MP4' : ''} · up to 4 MB per document</p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2 mb-4" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}

          {/* Docs list */}
          {docs.length === 0 ? (
            <EmptyState
              title={`No ${MACHINE_DOC_TABS.find((t) => t.id === tab)?.label} uploaded yet`}
              description="Attach the controlled document for this machine so operators and technicians can access it instantly."
              actionLabel={user?.role === 'admin' ? 'Upload First Document' : undefined}
              onAction={user?.role === 'admin' ? () => fileRef.current?.click() : undefined}
            />
          ) : (
            <ul className="grid gap-2.5">
              {docs.map((d) => {
                const extMeta = EXT_META[d.file_format];
                return (
                  <li key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-control border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-9 h-9 rounded-control flex items-center justify-center flex-shrink-0 ${extMeta?.badge || 'bg-slate-700 text-slate-400'}`}>
                        <FileText size={16} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">{d.filename}</p>
                        <p className="text-meta">
                          {extMeta?.label || d.file_format} · {d.uploadedBy} · {timeAgo(d.uploadedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => openPreview(d)}
                        className="btn-ghost inline-flex items-center gap-1.5 text-xs !py-1.5"
                        aria-label={`Preview ${d.filename}`}
                      >
                        <Eye size={12} aria-hidden="true" /> Preview
                      </button>
                      <a
                        href={d.file_url}
                        download={d.filename}
                        className="btn-ghost inline-flex items-center gap-1.5 text-xs !py-1.5 text-cyan-400 hover:text-cyan-300"
                        aria-label={`Download ${d.filename}`}
                      >
                        <Download size={12} aria-hidden="true" /> Download
                      </a>
                      {user?.role === 'admin' && (
                        <button
                          onClick={() => handleRemoveDoc(d.id)}
                          className="btn-ghost inline-flex items-center gap-1.5 text-xs !py-1.5 text-red-400 hover:text-red-300"
                          aria-label={`Delete ${d.filename}`}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
