import { useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, ChevronDown, ClipboardCheck, Eye, FileText, Package,
  Pencil, ShieldAlert, Trash2, TriangleAlert, Wrench, X,
} from 'lucide-react';
import {
  archiveMachine, restoreMachine, purgeMachine, getMachinePurgeSummary,
} from '../store.js';
import { canArchiveMachine, canPurgeMachine, normalizeRole } from '../lib/plantAccess.js';

const fmtDate = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Per-machine Actions menu — View / Edit / Archive / Purge with permission
 * gating and destructive styling reserved for the permanent purge.
 */
export function MachineActionsMenu({ machine, user, onView, onEdit, onArchive, onPurge, compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const role = normalizeRole(user?.role);
  const canManage = canArchiveMachine(role);
  const canPurge = canPurgeMachine(role);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canManage && !canPurge) return null;

  const item = (icon, label, onClick, opts = {}) => (
    <button
      onClick={() => { setOpen(false); onClick(); }}
      disabled={opts.disabled}
      title={opts.tooltip}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${
        opts.danger
          ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className={compact ? '' : 'relative'} ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-control border border-white/10 text-slate-300 hover:text-white hover:border-white/25 text-xs transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Machine actions"
      >
        Actions <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-48 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur shadow-xl shadow-black/50 p-1.5 space-y-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {item(<Eye size={13} />, 'View Machine', onView, { tooltip: 'Open machine profile' })}
          {item(<Pencil size={13} />, 'Edit Machine', onEdit, { tooltip: 'Edit machine specifications' })}
          {canManage && !machine.archived && item(
            <Archive size={13} className="text-amber-400" />, 'Archive Machine', onArchive,
            { tooltip: 'Hide from active register — history preserved' },
          )}
          {canManage && machine.archived && item(
            <ArchiveRestore size={13} className="text-emerald-400" />, 'Restore Machine', onArchive,
            { tooltip: 'Return machine to the active register' },
          )}
          {canPurge && item(
            <Trash2 size={13} />, 'Purge Machine', onPurge,
            { danger: true, tooltip: 'Permanently delete machine and its records' },
          )}
        </div>
      )}
    </div>
  );
}

/** Archive / Restore confirmation — records the machine intact, nothing is deleted. */
export function ArchiveMachineModal({ machine, userName, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const isArchived = machine.archived === true;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const updated = isArchived ? restoreMachine(machine.id, userName) : archiveMachine(machine.id, userName, reason.trim());
      onDone?.(updated, isArchived ? 'restored' : 'archived');
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={isArchived ? 'Restore machine' : 'Archive machine'}>
      <div className="modal-content glass-card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-card-title flex items-center gap-2">
            {isArchived
              ? <><ArchiveRestore size={16} className="text-emerald-400" aria-hidden="true" /> Restore Machine</>
              : <><Archive size={16} className="text-amber-400" aria-hidden="true" /> Archive Machine</>}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={16} aria-hidden="true" /></button>
        </div>
        <p className="text-body mb-4">
          {isArchived ? (
            <>
              <span className="text-white font-medium">{machine.name}</span> will return to the active register with all records intact.
            </>
          ) : (
            <>
              <span className="text-white font-medium">{machine.name}</span> will be removed from the active register and marked archived.
              PM history, breakdown logs, AMC records, certificates and documents are <span className="text-emerald-400">preserved</span> and can be restored at any time.
            </>
          )}
        </p>
        {!isArchived && (
          <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="archive-reason">Reason (optional)</label>
        )}
        {!isArchived && (
          <textarea
            id="archive-reason"
            className="input-field text-xs mb-5"
            rows={2}
            placeholder="e.g. Machine decommissioned, asset sold, duplicate entry…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
          <button onClick={submit} disabled={busy} className={`${isArchived ? 'btn-success' : 'btn-primary'} text-xs inline-flex items-center gap-1.5 disabled:opacity-50`}>
            {busy ? 'Working…' : isArchived ? <><ArchiveRestore size={12} /> Restore</> : <><Archive size={12} /> Archive Machine</>}
          </button>
        </div>
      </div>
    </div>
  );
}

const DEP_ROWS = [
  { key: 'pm_records', label: 'PM records', icon: <ClipboardCheck size={13} className="text-emerald-400" /> },
  { key: 'breakdown_logs', label: 'Breakdown records', icon: <Wrench size={13} className="text-red-400" /> },
  { key: 'amc_records', label: 'AMC records', icon: <Package size={13} className="text-cyan-400" /> },
  { key: 'testing_certificates', label: 'Machine certificates', icon: <ShieldAlert size={13} className="text-amber-400" /> },
  { key: 'machine_documents', label: 'Documents / attachments', icon: <FileText size={13} className="text-slate-300" /> },
];

/**
 * Permanent purge confirmation — full dependency summary, machine-code
 * confirmation, second confirmation step, duplicate-request prevention,
 * loading state and a clear success/failure result.
 */
export function PurgeMachineModal({ machine, userName, plantId, onClose, onPurged }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [ack, setAck] = useState(false);
  const [armed, setArmed] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState(null);
  const purgingRef = useRef(false);

  const expectedCode = String(machine.machineCode || machine.id || '');
  const hasHistory =
    summary &&
    (summary.pm_records + summary.breakdown_logs + summary.amc_records + summary.testing_certificates) > 0;
  const codeMatches = code.trim() === expectedCode && expectedCode !== '';
  const canConfirm = codeMatches && (!hasHistory || ack);

  useEffect(() => {
    let alive = true;
    getMachinePurgeSummary(machine.id).then((s) => { if (alive) { setSummary(s); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [machine.id]);

  const execute = async () => {
    if (purgingRef.current) return;
    purgingRef.current = true;
    setPurging(true);
    try {
      const res = await purgeMachine(machine.id, {
        reason: 'Purged from Machines module after confirmation',
        userName,
        plantId: plantId || machine.plant_id || machine.plantId || null,
        force: true,
      });
      setResult(res);
      if (res.success) onPurged?.(res);
    } catch (err) {
      setResult({ success: false, error: err?.message || 'Purge failed' });
    } finally {
      purgingRef.current = false;
      setPurging(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !purging && onClose()} role="dialog" aria-modal="true" aria-label="Purge machine">
      <div className="modal-content glass-card p-6 w-full max-w-lg max-h-[88vh] overflow-y-auto border-red-500/30">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-card-title flex items-center gap-2 text-red-400">
            <Trash2 size={16} aria-hidden="true" /> Purge Machine Permanently
          </h3>
          {!purging && <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X size={16} aria-hidden="true" /></button>}
        </div>
        <p className="text-xs text-red-400/90 font-semibold mb-4 flex items-center gap-1.5">
          <TriangleAlert size={13} aria-hidden="true" /> This operation is permanent and cannot be undone.
        </p>

        {/* Result banner */}
        {result && (result.success ? (
          <div className="rounded-control border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4 text-xs text-emerald-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><Archive size={13} /> Machine permanently purged from the database.</p>
            <p>Dependent records deleted: {result.counts?.pm_records || 0} PM · {result.counts?.breakdown_logs || 0} breakdown · {result.counts?.amc_records || 0} AMC · {result.counts?.testing_certificates || 0} certificates</p>
            <p>Storage files removed: {result.storage?.removed ?? 0}{result.orphans?.length ? ` · ${result.orphans.length} orphaned file reference(s) logged for controlled cleanup` : ''}</p>
          </div>
        ) : (
          <div className="rounded-control border border-red-500/30 bg-red-500/10 p-3 mb-4 text-xs text-red-200">
            <p className="font-semibold">Purge failed — the machine was retained.</p>
            <p className="mt-1">{result.error || 'Unknown database error.'}</p>
          </div>
        ))}
        {result?.success && (
          <div className="flex justify-end"><button onClick={onClose} className="btn-ghost text-xs">Close</button></div>
        )}

        {!result && (
          <>
            {/* Machine identity */}
            <div className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3.5 mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><span className="text-slate-500">Machine Name:</span> <span className="text-white font-medium">{machine.name}</span></div>
              <div><span className="text-slate-500">Machine Code:</span> <span className="text-cyan-400 font-mono">{machine.machineCode || machine.id}</span></div>
              <div><span className="text-slate-500">Plant / Section:</span> <span className="text-slate-200">{machine.section || '—'}</span></div>
              <div><span className="text-slate-500">Department:</span> <span className="text-slate-200">{machine.department || '—'}</span></div>
              <div><span className="text-slate-500">Type / Model:</span> <span className="text-slate-200">{machine.model || machine.manufacturer || '—'}</span></div>
              <div><span className="text-slate-500">Registration Date:</span> <span className="text-slate-200">{fmtDate(machine.createdAt)}</span></div>
            </div>

            {/* Dependency summary */}
            <h4 className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider">Dependency Summary</h4>
            {loading ? (
              <div className="rounded-control border border-white/10 p-3 mb-4 text-xs text-slate-400 flex items-center gap-2">
                <span className="animate-pulse">Querying database for linked records…</span>
              </div>
            ) : (
              <div className="rounded-control border border-white/10 p-3 mb-4 space-y-1.5">
                {DEP_ROWS.map((row) => (
                  <div key={row.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-300">{row.icon}{row.label}</span>
                    <span className={(summary?.[row.key] || 0) > 0 ? 'text-red-400 font-semibold' : 'text-slate-600'}>
                      {(summary?.[row.key] || 0) > 0 ? `${summary[row.key]} record${summary[row.key] === 1 ? '' : 's'} — will be permanently deleted` : 'None — nothing to delete'}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-500 pt-1 border-t border-white/5">
                  {summary?.source === 'server' ? 'Counts verified against the live database.' : 'Counts from local data — live database totals may differ.'}
                  {' '}Shared records, documents of other machines and unrelated plant data are never touched.
                </p>
              </div>
            )}

            {/* Case B — history warning + recommended alternative */}
            {!loading && hasHistory && (
              <div className="rounded-control border border-amber-500/30 bg-amber-500/10 p-3 mb-4 text-xs text-amber-200 space-y-1">
                <p className="font-semibold flex items-center gap-1.5"><TriangleAlert size={12} /> Operational history exists.</p>
                <p>Historical PM, breakdown, AMC or certificate records belong to this machine. <span className="font-semibold text-white">Archive Machine is the recommended action</span> — it preserves all history and keeps the record auditable.</p>
              </div>
            )}
            {!loading && !hasHistory && (
              <div className="rounded-control border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4 text-xs text-emerald-200">
                No operational history found — safe to purge this incorrectly created machine.
              </div>
            )}

            {/* Elevated confirmation */}
            <label className="flex items-start gap-2 text-xs text-slate-300 mb-3 cursor-pointer">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-red-500" />
              <span>I understand that all listed dependent records will be permanently deleted from the database and cannot be recovered.</span>
            </label>
            <label className="block text-slate-400 text-xs font-medium mb-1.5" htmlFor="purge-code">
              Type the exact Machine Code <span className="text-cyan-400 font-mono">{expectedCode}</span> to enable confirmation
            </label>
            <input
              id="purge-code"
              type="text"
              className={`input-field text-xs font-mono mb-4 ${code && !codeMatches ? 'border-red-500/50' : ''}`}
              placeholder={expectedCode}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} disabled={purging} className="btn-ghost text-xs disabled:opacity-50">Cancel</button>
              {!armed ? (
                <button
                  onClick={() => setArmed(true)}
                  disabled={!canConfirm || purging}
                  className="btn-ghost text-xs border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Confirm Purge
                </button>
              ) : (
                <button
                  onClick={execute}
                  disabled={purging}
                  className="btn-danger text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {purging ? (
                    <><span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" /> Purging…</>
                  ) : (
                    <><Trash2 size={12} /> Permanently Purge Machine</>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Banner shown on an archived machine's profile page. */
export function MachineArchivedBanner({ machine, user, onRestore }) {
  const canManage = canArchiveMachine(normalizeRole(user?.role));
  return (
    <div className="glass-card p-4 border-amber-500/30 bg-amber-500/[0.06] flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1">
        <Archive size={18} className="text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-300">Archived machine</p>
          <p className="text-xs text-amber-200/70 mt-0.5">
            Hidden from the active register, dashboards and selection lists.
            {machine.archivedBy ? ` Archived by ${machine.archivedBy}` : ''}
            {machine.archivedAt ? ` on ${fmtDate(machine.archivedAt)}` : ''}
            {machine.archiveReason ? ` — ${machine.archiveReason}` : ''}.
            All PM history, breakdowns, AMC records, certificates and documents are preserved.
          </p>
        </div>
      </div>
      {canManage && onRestore && (
        <button onClick={onRestore} className="btn-success text-xs inline-flex items-center gap-1.5 whitespace-nowrap">
          <ArchiveRestore size={13} aria-hidden="true" /> Restore Machine
        </button>
      )}
    </div>
  );
}
