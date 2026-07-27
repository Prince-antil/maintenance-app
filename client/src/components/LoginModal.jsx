import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { X, LogIn, Eye, EyeOff, ShieldCheck, AlertCircle } from 'lucide-react';

export default function LoginModal({ onClose }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      sessionStorage.removeItem('ccpl_entered');
      await login(username, password);
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
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-control bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
              <ShieldCheck size={16} className="text-cyan-400" aria-hidden="true" />
            </div>
            <h2 className="text-card-title">Sign In</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="login-username" className="block text-slate-400 text-xs font-medium mb-1.5">Username</label>
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

          <p className="text-meta text-center">
            Viewers have read-only access — contact the maintenance admin for credentials.
          </p>
        </form>
      </div>
    </div>
  );
}
