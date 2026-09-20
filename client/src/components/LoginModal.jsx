import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlant, FALLBACK_PLANTS } from '../context/PlantContext.jsx';
import { X, LogIn, Eye, EyeOff, ShieldCheck, AlertCircle, Building2, Layers } from 'lucide-react';

export default function LoginModal({ onClose }) {
  const { login } = useAuth();
  const { plants } = usePlant();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPlant, setSelectedPlant] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const plantOptions = plants.length ? plants : FALLBACK_PLANTS;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      sessionStorage.removeItem('ccpl_entered');
      const result = await login(username, password);
      // Plant selection is UX hint only — real access is checked server-side via RLS
      // Store the user's preferred plant if they selected one and have access
      const userPlantIds = result?.user?.plantIds || result?.user?.plant_ids || [];
      if (selectedPlant) {
        const hasAccess = !userPlantIds.length || userPlantIds.includes(selectedPlant) || ['super_admin','corporate_head','admin'].includes(result?.user?.role);
        if (hasAccess) {
          localStorage.setItem('ccpl_current_plant_id', JSON.stringify(selectedPlant));
        } else {
          // Silently ignore — PlantContext will auto-correct to authorized plant
        }
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
    >
      <div className="modal-content glass-card p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-control bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
              <ShieldCheck size={16} className="text-cyan-400" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-card-title leading-none">Sign In</h2>
              <p className="text-slate-500 text-[10px] leading-none mt-1">CRYSTAL CROP PROTECTION LTD.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="text-center mb-4">
          <p className="text-white text-xs font-semibold">Maintenance & Reliability Hub</p>
          <p className="text-slate-500 text-[10px]">Select plant before signing in</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Plant selector — UX only, security is server-side */}
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5 flex items-center gap-1.5">
              <Building2 size={11} className="text-cyan-400" /> Select Plant
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {plantOptions.slice(0,3).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlant(p.id)}
                  className={`rounded-control border p-2.5 text-center transition-all ${
                    selectedPlant===p.id
                      ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                      : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:border-white/[0.15] hover:text-white'
                  }`}
                >
                  <Building2 size={14} className="mx-auto mb-1" />
                  <p className="text-[11px] font-semibold leading-tight truncate">{p.plant_code}</p>
                  <p className="text-[9px] leading-tight truncate">{p.plant_name}</p>
                </button>
              ))}
            </div>
            <select
              value={selectedPlant}
              onChange={(e)=>setSelectedPlant(e.target.value)}
              className="select-field w-full mt-2 text-xs"
              aria-label="Select plant"
            >
              <option value="">Auto (your authorized plant)</option>
              {plantOptions.map((p)=>(
                <option key={p.id} value={p.id}>{p.plant_name} — {p.plant_code}</option>
              ))}
            </select>
            <p className="text-slate-500 text-[10px] mt-1 flex items-center gap-1">
              <Layers size={9}/> Corporate users can access all authorized plants after login
            </p>
          </div>

          <div>
            <label htmlFor="login-username" className="block text-slate-400 text-xs font-medium mb-1.5">Username / Email</label>
            <input
              id="login-username"
              type="text"
              className="input-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-slate-400 text-xs font-medium mb-1.5">Password</label>
            <div className="relative">
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                className="input-field pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
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
            className="btn-primary flex items-center justify-center gap-2 mt-1"
          >
            <LogIn size={15} aria-hidden="true" />
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="text-center space-y-1">
            <p className="text-meta text-center text-[11px]">
              Viewers have read-only access — contact the maintenance admin for credentials.
            </p>
            <p className="text-slate-600 text-[10px]">Demo: Prince / Prince123 · viewer / viewer123 · corporate / corporate123</p>
          </div>

          <p className="text-slate-600 text-[10px] text-center border-t border-white/[0.06] pt-3">
            Plant selection here is for convenience only. Access is enforced server-side — you will only see data for plants you are authorized to access.
          </p>
        </form>
      </div>
    </div>
  );
}
