import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Cog, Plus, AlertCircle } from 'lucide-react';
import { PLANT_SECTIONS } from '../constants.js';
import { addMachine } from '../store.js';
import { useAuth } from '../context/AuthContext.jsx';

const EMPTY = {
  name: '', section: '', status: 'running', machineCode: '', department: '',
  area: '', manufacturer: '', model: '', serialNumber: '', installDate: '',
  powerRating: '', voltage: '', current: '', runningHours: '',
};

/**
 * Admin modal — create a machine asset with full nameplate specifications.
 */
function Field({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-slate-400 text-xs font-medium mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default function MachineModal({ onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.section) {
      setError('Machine name and plant section are required');
      return;
    }
    const machine = addMachine(
      { ...form, runningHours: Number(form.runningHours) || 0 },
      user?.full_name || 'Admin'
    );
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
      <div className="modal-content glass-card p-6 w-full max-w-2xl max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-control bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
              <Cog size={16} className="text-cyan-400" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-card-title">Add New Machine</h2>
              <p className="text-meta">Complete asset registration — all fields editable later</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Machine Name *" id="m-name">
              <input id="m-name" type="text" className="input-field" value={form.name} onChange={set('name')} placeholder='e.g. "8-Head Liquid Filler"' />
            </Field>
            <Field label="Machine ID / Code" id="m-code">
              <input id="m-code" type="text" className="input-field" value={form.machineCode} onChange={set('machineCode')} placeholder="e.g. NTP-FIL-008" />
            </Field>
            <Field label="Plant Section *" id="m-section">
              <select id="m-section" className="select-field" value={form.section} onChange={set('section')}>
                <option value="">Select plant section...</option>
                {PLANT_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Department" id="m-dept">
              <input id="m-dept" type="text" className="input-field" value={form.department} onChange={set('department')} placeholder="e.g. Packaging / Formulation / Utility" />
            </Field>
            <Field label="Area / Location" id="m-area">
              <input id="m-area" type="text" className="input-field" value={form.area} onChange={set('area')} placeholder="e.g. Block B — Ground Floor" />
            </Field>
            <Field label="Current Status" id="m-status">
              <select id="m-status" className="select-field" value={form.status} onChange={set('status')}>
                <option value="running">Running</option>
                <option value="maintenance">Under Maintenance</option>
                <option value="breakdown">Breakdown</option>
                <option value="standby">Standby</option>
              </select>
            </Field>
            <Field label="Manufacturer" id="m-mfr">
              <input id="m-mfr" type="text" className="input-field" value={form.manufacturer} onChange={set('manufacturer')} placeholder="e.g. Alfa Laval" />
            </Field>
            <Field label="Model" id="m-model">
              <input id="m-model" type="text" className="input-field" value={form.model} onChange={set('model')} placeholder="e.g. LF-8000X" />
            </Field>
            <Field label="Serial Number" id="m-serial">
              <input id="m-serial" type="text" className="input-field" value={form.serialNumber} onChange={set('serialNumber')} placeholder="e.g. SN-2024-11-0455" />
            </Field>
            <Field label="Installation Date" id="m-install">
              <input id="m-install" type="date" className="input-field" value={form.installDate} onChange={set('installDate')} />
            </Field>
            <Field label="Power Rating" id="m-power">
              <input id="m-power" type="text" className="input-field" value={form.powerRating} onChange={set('powerRating')} placeholder="e.g. 15 kW" />
            </Field>
            <Field label="Voltage" id="m-volt">
              <input id="m-volt" type="text" className="input-field" value={form.voltage} onChange={set('voltage')} placeholder="e.g. 415 V" />
            </Field>
            <Field label="Full-Load Current" id="m-curr">
              <input id="m-curr" type="text" className="input-field" value={form.current} onChange={set('current')} placeholder="e.g. 28 A" />
            </Field>
            <Field label="Running Hours" id="m-hours">
              <input id="m-hours" type="number" min="0" className="input-field" value={form.runningHours} onChange={set('runningHours')} placeholder="e.g. 12400" />
            </Field>
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
