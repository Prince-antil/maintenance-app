import { useState, useEffect } from 'react';
import { usePlant } from '../context/PlantContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { canManageUsers, ROLE_META, normalizeRole } from '../lib/plantAccess.js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { Users, Shield, Building2, Edit3, X, CheckCircle2, AlertCircle, UserPlus } from 'lucide-react';

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'corporate_head', label: 'Corporate Head' },
  { value: 'plant_admin', label: 'Plant Admin' },
  { value: 'plant_user', label: 'Plant User' },
];

const FALLBACK_USERS = [
  { id: 'offline-admin', username: 'Prince', full_name: 'Prince', role: 'super_admin', active: true, plantIds: ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'], last_login: new Date().toISOString() },
  { id: 'offline-viewer', username: 'viewer', full_name: 'Read-Only Viewer', role: 'viewer', active: true, plantIds: ['00000000-0000-0000-0000-000000000001'], last_login: null },
];

export default function UserManagement() {
  const { plants } = usePlant();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ role: 'plant_user', plantIds: [], active: true });
  const [msg, setMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ username:'', full_name:'', role:'plant_user', plantIds:[] });

  const canManage = canManageUsers(currentUser?.role);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      if (isSupabaseConfigured && supabase) {
        try {
          const { data: profiles } = await supabase.from('user_profiles').select('*');
          const { data: access } = await supabase.from('user_plant_access').select('*');
          const byUser = {};
          (access||[]).forEach((a)=>{ if (!byUser[a.user_id]) byUser[a.user_id]=[]; byUser[a.user_id].push(a.plant_id); });
          const merged = (profiles||[]).map((p)=>({
            id: p.user_id,
            username: p.email || p.user_id.slice(0,8),
            full_name: p.name || p.email || 'User',
            role: p.role,
            active: p.active,
            plantIds: byUser[p.user_id] || [],
            last_login: p.updated_at,
          }));
          setUsers(merged.length? merged : FALLBACK_USERS);
        } catch {
          setUsers(FALLBACK_USERS);
        }
      } else {
        setUsers(FALLBACK_USERS);
      }
      setLoading(false);
    };
    fetchUsers();
  }, []);

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.from('user_profiles').upsert({ user_id: editing.id, role: form.role, active: form.active, updated_at: new Date().toISOString() }, { onConflict:'user_id' });
        // Replace plant access
        await supabase.from('user_plant_access').delete().eq('user_id', editing.id);
        if (form.plantIds.length) {
          await supabase.from('user_plant_access').insert(form.plantIds.map((pid)=>({ user_id: editing.id, plant_id: pid })));
        }
        setUsers((prev)=> prev.map((u)=> u.id===editing.id ? { ...u, role: form.role, plantIds: form.plantIds, active: form.active } : u));
      } else {
        setUsers((prev)=> prev.map((u)=> u.id===editing.id ? { ...u, role: form.role, plantIds: form.plantIds, active: form.active } : u));
      }
      setMsg({ ok:true, text:`Updated ${editing.username} — role ${form.role}, ${form.plantIds.length} plants.` });
      setEditing(null);
    } catch (e) {
      setMsg({ ok:false, text:e.message });
    }
  };

  const handleAdd = () => {
    if (!newUser.username || !newUser.full_name) { setMsg({ok:false,text:'Username and name required'}); return; }
    const rec = { id:`local-${Date.now()}`, username:newUser.username, full_name:newUser.full_name, role:newUser.role, active:true, plantIds:newUser.plantIds, last_login:null };
    setUsers((p)=>[rec,...p]);
    setMsg({ok:true,text:`Created ${newUser.username} (${newUser.role}) — configure password in Supabase Auth.`});
    setShowAdd(false);
    setNewUser({username:'',full_name:'',role:'plant_user', plantIds:[]});
  };

  const startEdit = (u) => {
    setEditing(u);
    setForm({ role: normalizeRole(u.role), plantIds: u.plantIds||[], active: u.active!==false });
  };

  const plantName = (id) => plants.find((p)=>p.id===id)?.plant_name || id.slice(0,8);

  if (!canManage) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16">
        <Users size={28} className="text-slate-600 mx-auto mb-3" />
        <h2 className="text-white font-bold">Admin Only</h2>
        <p className="text-slate-400 text-sm mt-1">User Management is restricted to Super Admin / Plant Admin.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-2"><Users size={20} className="text-cyan-400"/> User Management</h2>
          <p className="text-body text-sm mt-1">Manage roles and plant access. Users can have multiple plants if authorized.</p>
        </div>
        <button onClick={()=>setShowAdd(true)} className="btn-primary inline-flex items-center gap-2 text-xs"><UserPlus size={13}/> Add User</button>
      </div>

      {msg && (
        <div className={`rounded-control px-3 py-2 text-xs flex items-center gap-2 border ${msg.ok?'bg-emerald-500/10 border-emerald-500/30 text-emerald-400':'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {msg.ok?<CheckCircle2 size={13}/>:<AlertCircle size={13}/>} {msg.text}
        </div>
      )}

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading users…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="enterprise-table w-full min-w-[800px]">
              <thead>
                <tr><th>User</th><th>Role</th><th>Plant Access</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {users.map((u)=>{
                  const meta = ROLE_META[normalizeRole(u.role)] || ROLE_META.plant_user;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-white text-xs font-bold">{u.full_name.charAt(0).toUpperCase()}</div>
                          <div>
                            <p className="text-white text-xs font-semibold">{u.full_name}</p>
                            <p className="text-slate-500 text-[10px]">{u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td><span className={`badge text-[10px] border ${meta.bg} ${meta.color} ${meta.border}`}>{meta.label}</span></td>
                      <td>
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {(u.plantIds||[]).length===0 ? <span className="text-slate-500 text-xs">—</span> : u.plantIds.map((pid)=>(
                            <span key={pid} className="badge bg-cyan-500/10 text-cyan-300 text-[9px] border border-cyan-500/20 inline-flex items-center gap-1"><Building2 size={8}/>{plantName(pid)}</span>
                          ))}
                          {(u.plantIds||[]).length>=3 && <span className="badge bg-violet-500/10 text-violet-300 text-[9px]">All Plants</span>}
                        </div>
                      </td>
                      <td><span className={`badge text-[10px] ${u.active!==false?'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25':'bg-red-500/15 text-red-400 border border-red-500/25'}`}>{u.active!==false?'Active':'Inactive'}</span></td>
                      <td className="text-slate-400 text-xs">{u.last_login ? new Date(u.last_login).toLocaleDateString('en-GB') : '—'}</td>
                      <td><button onClick={()=>startEdit(u)} className="btn-ghost p-1.5" title="Edit"><Edit3 size={12}/></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget && setEditing(null)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-card-title flex items-center gap-2"><Shield size={14} className="text-cyan-400"/> Edit {editing.full_name}</h3>
              <button onClick={()=>setEditing(null)} className="btn-ghost p-1"><X size={14}/></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-meta block mb-1">Role</label>
                <select value={form.role} onChange={(e)=>setForm({...form, role:e.target.value})} className="select-field w-full">
                  {ROLE_OPTIONS.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="text-slate-500 text-[10px] mt-1">{ROLE_META[form.role]?.description||''}</p>
              </div>
              <div>
                <label className="text-meta block mb-2">Plant Access</label>
                <div className="space-y-1.5">
                  {plants.map((p)=>(
                    <label key={p.id} className="flex items-center gap-2 rounded-control border border-white/[0.06] px-3 py-2 cursor-pointer hover:bg-white/[0.03]">
                      <input type="checkbox" checked={form.plantIds.includes(p.id)} onChange={(e)=>{
                        setForm({...form, plantIds: e.target.checked ? [...form.plantIds, p.id] : form.plantIds.filter((id)=>id!==p.id)});
                      }} className="rounded" />
                      <Building2 size={12} className="text-cyan-400" />
                      <span className="text-white text-xs flex-1">{p.plant_name}</span>
                      <span className="text-slate-500 text-[10px]">{p.plant_code}</span>
                    </label>
                  ))}
                </div>
                <p className="text-slate-500 text-[10px] mt-1">Corporate Head / Super Admin typically has all plants.</p>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={(e)=>setForm({...form, active:e.target.checked})} />
                <span className="text-slate-300 text-xs">Active</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={()=>setEditing(null)} className="btn-ghost text-xs">Cancel</button>
                <button onClick={handleSaveEdit} className="btn-primary text-xs">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={(e)=>e.target===e.currentTarget && setShowAdd(false)} role="dialog" aria-modal="true">
          <div className="modal-content glass-card p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-card-title">Add User</h3>
              <button onClick={()=>setShowAdd(false)} className="btn-ghost p-1"><X size={14}/></button>
            </div>
            <div className="space-y-4">
              <input className="input-field w-full" placeholder="Username" value={newUser.username} onChange={(e)=>setNewUser({...newUser, username:e.target.value})} />
              <input className="input-field w-full" placeholder="Full Name" value={newUser.full_name} onChange={(e)=>setNewUser({...newUser, full_name:e.target.value})} />
              <select value={newUser.role} onChange={(e)=>setNewUser({...newUser, role:e.target.value})} className="select-field w-full">
                {ROLE_OPTIONS.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div>
                <p className="text-meta mb-1">Plant Access</p>
                {plants.map((p)=>(
                  <label key={p.id} className="flex items-center gap-2 py-1">
                    <input type="checkbox" checked={newUser.plantIds.includes(p.id)} onChange={(e)=>{
                      setNewUser({...newUser, plantIds: e.target.checked ? [...newUser.plantIds, p.id] : newUser.plantIds.filter((id)=>id!==p.id)});
                    }} />
                    <span className="text-slate-300 text-xs">{p.plant_name} ({p.plant_code})</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={()=>setShowAdd(false)} className="btn-ghost text-xs">Cancel</button>
                <button onClick={handleAdd} className="btn-primary text-xs">Create</button>
              </div>
            </div>
            <p className="text-slate-500 text-[10px] mt-3">In production, create the Supabase Auth user first, then assign role and plant access here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
