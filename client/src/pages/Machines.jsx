import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { getMachines, deleteMachine } from '../machinesStore.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { MACHINE_DOC_TABS } from '../constants.js';
import { Plus, Search, Cog, MapPin, FileText, ChevronRight, Trash2, BookOpen } from 'lucide-react';

/**
 * Machine Operating Procedures — dynamic machine directory (SOP / MOP / WI module).
 */
export default function Machines() {
  const { user } = useAuth();
  const { openAddMachine, refreshKey } = useUI();
  const navigate = useNavigate();
  const [machines, setMachines] = useState([]);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    setMachines(getMachines());
  }, [refreshKey]);

  const filtered = machines.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.section.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMachine(deleteTarget.id);
    setMachines(getMachines());
    setDeleteTarget(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <BookOpen size={28} className="text-cyan-400" aria-hidden="true" />
            Machine Operating Procedures
          </h2>
          <p className="text-body mt-1.5">
            SOP · MOP · Work Instructions · Circuit Diagrams · Training Media for the machine fleet
          </p>
        </div>
        {user?.role === 'admin' && (
          <button onClick={openAddMachine} className="btn-primary inline-flex items-center gap-2 whitespace-nowrap">
            <Plus size={15} aria-hidden="true" /> New Machine
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input
          type="search"
          className="input-field pl-9"
          placeholder="Search machines or plant sections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search machines"
        />
      </div>

      {/* Machine grid */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No machines found"
          description={search ? `No machine matches "${search}".` : 'Create the first machine profile to organise SOPs, MOPs and schematics.'}
          actionLabel={user?.role === 'admin' && !search ? '+ Add Machine' : undefined}
          onAction={user?.role === 'admin' ? openAddMachine : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
          {filtered.map((m) => {
            const docCount = (m.docs || []).length;
            return (
              <div key={m.id} className="glass-card glass-card-hover p-5 group relative">
                <button
                  onClick={() => navigate(`/machines/${m.id}`)}
                  className="w-full text-left"
                  aria-label={`Open machine profile: ${m.name}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-11 h-11 rounded-control bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Cog size={20} className="text-cyan-400" aria-hidden="true" />
                    </div>
                    <ChevronRight size={15} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all mt-1" aria-hidden="true" />
                  </div>
                  <h3 className="text-card-title leading-tight mb-1.5">{m.name}</h3>
                  <p className="text-slate-400 text-xs flex items-center gap-1.5 mb-3">
                    <MapPin size={11} aria-hidden="true" /> {m.section}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={m.status} pulse={m.status === 'breakdown'} />
                    <span className="badge bg-slate-700/60 text-slate-300">
                      <FileText size={10} aria-hidden="true" /> {docCount} docs
                    </span>
                  </div>
                </button>
                {user?.role === 'admin' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(m); }}
                    className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-400/10 transition-all"
                    aria-label={`Delete machine ${m.name}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tab legend */}
      <div className="glass-card p-5">
        <p className="text-meta uppercase tracking-wider mb-3">Each machine profile contains categorised document tabs</p>
        <div className="flex flex-wrap gap-2">
          {MACHINE_DOC_TABS.map((t) => (
            <span key={t.id} className="status-pill bg-white/[0.04] text-slate-300 border border-white/[0.08]">{t.label}</span>
          ))}
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-sm">
            <h3 className="text-card-title mb-2">Delete Machine</h3>
            <p className="text-body mb-5">
              Delete <span className="text-white font-medium">"{deleteTarget.name}"</span> and all its attached documents? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handleDelete} className="btn-danger text-xs inline-flex items-center gap-1.5">
                <Trash2 size={12} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
