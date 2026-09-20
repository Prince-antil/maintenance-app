import { useState } from 'react';
import { usePlant } from '../context/PlantContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store.js';
import { canManagePlants } from '../lib/plantAccess.js';
import { X, Building2, Plus, Edit3, Power, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { loadLS, saveLS } from '../utils.js';

export default function PlantManagement() {
  const { plants, refreshPlants, upsertPlant } = usePlant();
  const { user } = useAuth();
  const store = useStore();
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ plant_code: '', plant_name: '', location: '', description: '' });
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const canManage = canManagePlants(user?.role);

  const counts = (plantId) => {
    const f = (arr) => (arr||[]).filter((r)=>(r.plant_id||r.plantId)===plantId).length;
    return {
      machines: f(store.machines),
      breakdowns: f(store.machineBreakdownLogs),
      pm: f(store.machinePmRecords),
      users: 0,
    };
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.plant_code || !form.plant_name) {
      setMsg({ ok:false, text:'Plant code and name are required.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        plant_code: form.plant_code.trim().toUpperCase(),
        plant_name: form.plant_name.trim(),
        location: form.location.trim(),
        description: form.description.trim(),
        active: true,
      };
      if (editing?.id) payload.id = editing.id;
      await upsertPlant(payload);
      setMsg({ ok:true, text: editing ? 'Plant updated.' : 'Plant created.' });
      setEditing(null); setShowAdd(false);
      setForm({ plant_code:'', plant_name:'', location:'', description:'' });
    } catch (err) {
      setMsg({ ok:false, text: err.message });
    } finally { setSaving(false); }
  };

  const handleToggle = async (p) => {
    if (!canManage) return;
    // Deactivate instead of delete if has operational records
    const hasData = counts(p.id).machines > 0;
    if (hasData && p.active) {
      if (!confirm(`Deactivate ${p.plant_name}? It has operational records — use deactivate instead of delete.`)) return;
    }
    setSaving(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.from('plants').update({ active: !p.active, updated_at: new Date().toISOString() }).eq('id', p.id);
        if (error) throw error;
        await refreshPlants();
      } else {
        const cached = loadLS('ccpl_plants_cache', plants);
        const next = cached.map((x)=> x.id===p.id ? { ...x, active: !x.active } : x);
        saveLS('ccpl_plants_cache', next);
        await refreshPlants();
      }
      setMsg({ ok:true, text: `${p.plant_name} ${p.active ? 'deactivated' : 'activated'}.` });
    } catch (err) {
      setMsg({ ok:false, text: err.message });
    } finally { setSaving(false); }
  };

  const startEdit = (p) => {
    setEditing(p);
    setForm({ plant_code: p.plant_code, plant_name: p.plant_name, location: p.location||'', description: p.description||'' });
    setShowAdd(true);
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ plant_code:'', plant_name:'', location:'', description:'' });
    setShowAdd(true);
  };

  if (!canManage) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <Building2 size={28} className="text-slate-600 mx-auto mb-3" />
        <h2 className="text-white font-bold">Admin Only</h2>
        <p className="text-slate-400 text-sm mt-1">Plant Management is restricted to Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-2"><Building2 size={20} className="text-cyan-400"/> Plant Management</h2>
          <p className="text-body text-sm mt-1">Add, rename, or deactivate plants. Deactivate (not delete) when operational records exist.</p>
        </div>
        <button onClick={openAdd} className="btn-primary inline-flex items-center gap-2 text-xs"><Plus size={13}/> Add Plant</button>
      </div>

      {msg && (
        <div className={`rounded-control px-3 py-2 text-xs flex items-center gap-2 border ${msg.ok?'bg-emerald-500/10 border-emerald-500/30 text-emerald-400':'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {msg.ok ? <CheckCircle2 size={13}/> : <AlertCircle size={13}/>} {msg.text}
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="enterprise-table w-full min-w-[800px]">
            <thead>
              <tr>
                <th>Plant</th><th>Code</th><th>Location</th><th>Status</th><th>Machines</th><th>Last Update</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plants.map((p) => {
                const c = counts(p.id);
                return (
                  <tr key={p.id} className={!p.active ? 'opacity-60' : ''}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center"><Building2 size={12} className="text-cyan-400"/></div>
                        <div>
                          <p className="text-white text-xs font-semibold">{p.plant_name}</p>
                          <p className="text-slate-500 text-[10px] truncate max-w-[200px]">{p.description||'—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-cyan-300 font-mono text-xs">{p.plant_code}</td>
                    <td className="text-slate-300 text-xs">{p.location||'—'}</td>
                    <td><span className={`badge text-[10px] ${p.active?'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25':'bg-slate-500/15 text-slate-400 border border-slate-500/25'}`}>{p.active?'Active':'Inactive'}</span></td>
                    <td className="text-white font-semibold">{c.machines}</td>
                    <td className="text-slate-400 text-xs">{p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-GB') : '—'}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={()=>startEdit(p)} className="btn-ghost p-1.5" title="Edit"><Edit3 size={12}/></button>
                        <button onClick={()=>handleToggle(p)} disabled={saving} className="btn-ghost p-1.5" title={p.active?'Deactivate':'Activate'}><Power size={12} className={p.active?'text-amber-400':'text-emerald-400'}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget && setShowAdd(false)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-card-title">{editing ? 'Edit Plant' : 'Add Plant'}</h3>
              <button onClick={()=>setShowAdd(false)} className="btn-ghost p-1"><X size={14}/></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-meta block mb-1">Plant Code *</label>
                <input className="input-field w-full" value={form.plant_code} onChange={(e)=>setForm({...form, plant_code:e.target.value})} placeholder="e.g. PLANT4" required />
                <p className="text-slate-500 text-[10px] mt-1">Unique, uppercase. Used in exports.</p>
              </div>
              <div>
                <label className="text-meta block mb-1">Plant Name *</label>
                <input className="input-field w-full" value={form.plant_name} onChange={(e)=>setForm({...form, plant_name:e.target.value})} placeholder="e.g. Dahej Plant" required />
              </div>
              <div>
                <label className="text-meta block mb-1">Location</label>
                <input className="input-field w-full" value={form.location} onChange={(e)=>setForm({...form, location:e.target.value})} placeholder="City, State" />
              </div>
              <div>
                <label className="text-meta block mb-1">Description</label>
                <textarea className="input-field w-full" rows={2} value={form.description} onChange={(e)=>setForm({...form, description:e.target.value})} placeholder="Optional description" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={()=>setShowAdd(false)} className="btn-ghost text-xs">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary text-xs disabled:opacity-50">{saving?'Saving…': editing?'Update':'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
