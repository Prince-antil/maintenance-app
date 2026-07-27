import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Cog, Plus, AlertCircle } from 'lucide-react';
import { PLANT_SECTIONS } from '../constants.js';
import { addMachine } from '../machinesStore.js';
import { useUI } from '../context/UIContext.jsx';

/**
 * Admin modal — dynamically create a new machine profile.
 */
export default function MachineModal({ onClose }) {
  const navigate = useNavigate();
  const { signalRefresh } = useUI();
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [status, setStatus] = useState('running');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !section) {
      setError('Machine name and plant section are required');
      return;
    }
    const machine = addMachine({ name, section, status });
    signalRefresh();
    onClose();
    navigate(`/machines/${machine.id}`);
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Add new machine"
    >
      <div className="modal-content glass-card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-control bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
              <Cog size={16} className="text-cyan-400" aria-hidden="true" />
            </div>
            <h2 className="text-card-title">Add New Machine</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="machine-name" className="block text-slate-400 text-xs font-medium mb-1.5">Machine Name *</label>
            <input
              id="machine-name"
              type="text"
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "Jet Mill #1", "8-Head Liquid Filler"'
            />
          </div>
          <div>
            <label htmlFor="machine-section" className="block text-slate-400 text-xs font-medium mb-1.5">Plant Section *</label>
            <select
              id="machine-section"
              className="select-field"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Select plant section...</option>
              {PLANT_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="machine-status" className="block text-slate-400 text-xs font-medium mb-1.5">Current Status</label>
            <select
              id="machine-status"
              className="select-field"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="running">Running</option>
              <option value="maintenance">Under Maintenance</option>
              <option value="breakdown">Breakdown</option>
              <option value="standby">Standby</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-control px-3 py-2 text-red-400 text-xs flex items-center gap-2" role="alert">
              <AlertCircle size={13} aria-hidden="true" /> {error}
            </div>
          )}

          <button type="submit" className="btn-primary flex items-center justify-center gap-2">
            <Plus size={15} aria-hidden="true" /> Create Machine Profile
          </button>
        </form>
      </div>
    </div>
  );
}
