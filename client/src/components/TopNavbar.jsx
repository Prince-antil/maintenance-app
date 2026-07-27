import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { api } from '../api.js';
import { timeAgo, formatDateLong, loadLS, saveLS } from '../utils.js';
import { UNIT_BADGE } from '../constants.js';
import {
  Menu, Shield, Search, Bell, ChevronDown, LogIn, LogOut,
  Plus, Upload, User, Clock, FileText, CalendarDays, Cog,
} from 'lucide-react';

const RECENT_KEY = 'ccpl_recent_searches';
const NOTIF_SEEN_KEY = 'ccpl_notif_seen_at';

export default function TopNavbar() {
  const { user, logout } = useAuth();
  const { toggleSidebar, openUpload, openLogin, openAddMachine } = useUI();
  const navigate = useNavigate();

  // Instant search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => loadLS(RECENT_KEY, []));
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Notifications
  const [notifs, setNotifs] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => loadLS(NOTIF_SEEN_KEY, 0));
  const notifRef = useRef(null);

  // Profile dropdown
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Notification feed from recent uploads
  useEffect(() => {
    api.getRecent().then(setNotifs).catch(() => {});
  }, []);

  const unread = notifs.filter((n) => new Date((n.uploaded_at || '') + 'Z').getTime() > seenAt).length;

  const markNotifsSeen = () => {
    const now = Date.now();
    setSeenAt(now);
    saveLS(NOTIF_SEEN_KEY, now);
  };

  // Debounced auto-complete
  const runSearch = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.getReports({ search: q.trim(), limit: 6 });
        setResults(res.data || []);
      } catch { setResults([]); }
    }, 250);
  }, []);

  const commitSearch = (q) => {
    const term = q.trim();
    if (!term) return;
    const next = [term, ...recentSearches.filter((s) => s !== term)].slice(0, 5);
    setRecentSearches(next);
    saveLS(RECENT_KEY, next);
  };

  const openResult = (r) => {
    commitSearch(query);
    setSearchOpen(false);
    setQuery('');
    navigate(`/category/${encodeURIComponent(r.category_name)}`);
  };

  return (
    <header className="sticky top-0 z-[80] border-b border-white/[0.08] bg-slate-900/85 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 lg:px-6 h-[57px]">
        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="w-9 h-9 rounded-control flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={18} aria-hidden="true" />
        </button>

        {/* Brand header */}
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 group flex-shrink-0" aria-label="Go to dashboard">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
            <Shield size={16} className="text-white" aria-hidden="true" />
          </div>
          <div className="hidden md:block text-left">
            <h1 className="text-white font-bold text-[13px] leading-tight tracking-tight group-hover:text-emerald-400 transition-colors">
              CRYSTAL CROP PROTECTION LTD.
            </h1>
            <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-px rounded-full bg-emerald-500/10 border border-emerald-500/30 emerald-badge-glow">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
              <span className="text-emerald-400 text-[9px] font-semibold tracking-wider">{UNIT_BADGE}</span>
            </span>
          </div>
        </button>

        {/* Instant search */}
        <div className="flex-1 max-w-xl mx-auto relative" ref={searchRef}>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              className="input-field pl-9 !py-2 text-[13px]"
              placeholder="Search machines, SOPs, reports, drawings..."
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); runSearch(e.target.value); }}
              onKeyDown={(e) => e.key === 'Enter' && commitSearch(query)}
              aria-label="Global search"
              role="combobox"
              aria-expanded={searchOpen}
            />
          </div>
          {searchOpen && (query || recentSearches.length > 0) && (
            <div className="absolute top-full mt-2 left-0 right-0 glass-card !rounded-xl overflow-hidden shadow-2xl">
              {query && results.length > 0 && (
                <ul role="listbox" aria-label="Search results">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => openResult(r)}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-cyan-500/8 text-left transition-colors"
                      >
                        <FileText size={13} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-xs font-medium truncate">{r.filename}</p>
                          <p className="text-slate-500 text-[10px] truncate">{r.category_name} · {r.plant_section}</p>
                        </div>
                        <span className="text-slate-600 text-[10px] flex-shrink-0">{timeAgo(r.uploaded_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query && results.length === 0 && (
                <p className="px-4 py-3 text-slate-500 text-xs">No matches for "{query}"</p>
              )}
              {!query && recentSearches.length > 0 && (
                <div className="py-1.5">
                  <p className="px-4 py-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Recent searches</p>
                  {recentSearches.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setQuery(s); runSearch(s); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-white/[0.04] text-left text-xs text-slate-300 transition-colors"
                    >
                      <Clock size={12} className="text-slate-500" aria-hidden="true" /> {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-1.5 lg:gap-2.5 flex-shrink-0">
          {/* Primary CTAs (admin only) */}
          {user?.role === 'admin' && (
            <div className="hidden xl:flex items-center gap-2">
              <button onClick={openAddMachine} className="btn-primary !py-2 !px-3.5 text-xs inline-flex items-center gap-1.5">
                <Plus size={13} aria-hidden="true" /> New Machine
              </button>
              <button onClick={() => openUpload()} className="btn-success !py-2 !px-3.5 text-xs inline-flex items-center gap-1.5">
                <Upload size={13} aria-hidden="true" /> Upload Report
              </button>
            </div>
          )}

          {/* Current date */}
          <span className="hidden lg:inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium px-2.5 py-1.5 rounded-control border border-white/[0.08]">
            <CalendarDays size={13} className="text-cyan-400" aria-hidden="true" />
            {formatDateLong()}
          </span>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) markNotifsSeen(); }}
              className="relative w-9 h-9 rounded-control flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
            >
              <Bell size={17} aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 glass-card !rounded-xl overflow-hidden shadow-2xl">
                <p className="px-4 py-2.5 text-xs font-semibold text-white border-b border-white/[0.06]">Notifications</p>
                {notifs.length === 0 ? (
                  <p className="px-4 py-4 text-slate-500 text-xs">No notifications yet.</p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto">
                    {notifs.slice(0, 8).map((n) => (
                      <li key={n.id} className="px-4 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03]">
                        <p className="text-slate-200 text-xs">
                          <span className="text-cyan-400 font-medium">{n.uploader_name || 'System'}</span> uploaded{' '}
                          <span className="text-white font-medium">{n.filename}</span>
                        </p>
                        <p className="text-slate-500 text-[10px] mt-0.5">{n.category_name} · {timeAgo(n.uploaded_at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Profile / login */}
          {user ? (
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-control hover:bg-white/5 transition-colors"
                aria-label="User menu"
                aria-expanded={profileOpen}
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center flex-shrink-0">
                  <User size={14} className="text-white" aria-hidden="true" />
                </div>
                <div className="hidden lg:block text-left">
                  <p className="text-white text-xs font-semibold leading-tight">{user.full_name}</p>
                  <p className="text-slate-500 text-[10px]">Maintenance Engineer</p>
                </div>
                <ChevronDown size={13} className="text-slate-500 hidden lg:block" aria-hidden="true" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 glass-card !rounded-xl overflow-hidden shadow-2xl">
                  <div className="px-4 py-3 border-b border-white/[0.06]">
                    <p className="text-white text-sm font-semibold">{user.full_name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">Maintenance Engineer</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">Electrical & Plant Maintenance</p>
                    <span className="badge bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 mt-2">
                      {user.role === 'admin' ? 'Administrator' : 'Viewer · Read-Only'}
                    </span>
                  </div>
                  <button
                    onClick={() => { setProfileOpen(false); navigate('/machines'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-slate-300 hover:bg-white/[0.04] transition-colors"
                  >
                    <Cog size={13} aria-hidden="true" /> Machine Directory
                  </button>
                  <button
                    onClick={async () => {
                      setProfileOpen(false);
                      await logout();
                      sessionStorage.removeItem('ccpl_entered');
                      navigate('/');
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-red-400 hover:bg-red-500/8 transition-colors"
                  >
                    <LogOut size={13} aria-hidden="true" /> Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={openLogin} className="btn-ghost inline-flex items-center gap-1.5 text-xs !py-2">
              <LogIn size={13} aria-hidden="true" /> Login
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
