import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { buildNotifications } from '../analytics.js';
import { timeAgo, formatDateLong, loadLS, saveLS } from '../utils.js';
import { listReportMetadata } from '../reportVault.js';
import { UNIT_BADGE } from '../constants.js';
import {
  Menu, Shield, Search, Bell, ChevronDown, LogIn, LogOut,
  Plus, Upload, User, Clock, FileText, CalendarDays, Cog,
  AlertOctagon, ClipboardCheck, Zap, Settings, AlertTriangle, Info,
} from 'lucide-react';

const RECENT_KEY = 'ccpl_recent_searches';
const NOTIF_SEEN_KEY = 'ccpl_notif_seen_at';

const NOTIF_META = {
  danger: { icon: AlertOctagon, cls: 'text-red-400 bg-red-400/10' },
  warning: { icon: AlertTriangle, cls: 'text-amber-400 bg-amber-400/10' },
  info: { icon: Info, cls: 'text-cyan-400 bg-cyan-400/10' },
  upload: { icon: Upload, cls: 'text-emerald-400 bg-emerald-400/10' },
};

const RESULT_ICONS = {
  machine: Cog, breakdown: AlertOctagon, pm: ClipboardCheck, energy: Zap, doc: FileText,
};

export default function TopNavbar() {
  const { user, logout } = useAuth();
  const { toggleSidebar, openUpload, openLogin, openAddMachine, refreshKey } = useUI();
  const navigate = useNavigate();
  const store = useStore();

  // Instant search
  const [query, setQuery] = useState('');
  const [serverResults, setServerResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => loadLS(RECENT_KEY, []));
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Notifications
  const [uploadNotifs, setUploadNotifs] = useState([]);
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

  // Server upload feed → notification entries
  useEffect(() => {
    Promise.allSettled([api.getRecent(), Promise.resolve(listReportMetadata({ limit: 6 }))])
      .then(([remoteResult, localResult]) => {
        const remote = remoteResult.status === 'fulfilled' ? remoteResult.value || [] : [];
        const local = localResult.status === 'fulfilled' ? localResult.value || [] : [];
        const merged = [...local, ...remote.filter((item) => !local.some((record) => record.id === item.id))];
        setUploadNotifs(merged);
      })
      .catch(() => setUploadNotifs([]));
  }, [refreshKey]);

  // Derived notification centre: pending PM summaries, monthly
  // breakdown logs, low health/availability (live) + new uploads
  const notifications = useMemo(() => {
    const derived = buildNotifications(store);
    const uploads = uploadNotifs.slice(0, 6).map((n) => ({
      id: `up-${n.id}`,
      type: 'upload',
      title: 'Report Uploaded',
      detail: `${n.uploader_name || 'System'} uploaded ${n.filename} · ${n.category_name}${n.localOnly ? ' · saved in local vault' : ''}`,
      ts: (n.uploaded_at || '').endsWith('Z') ? n.uploaded_at : n.uploaded_at + 'Z',
    }));
    return [...derived, ...uploads].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12);
  }, [store, uploadNotifs]);

  const unread = notifications.filter((n) => new Date(n.ts).getTime() > seenAt).length;

  const markNotifsSeen = () => {
    const now = Date.now();
    setSeenAt(now);
    saveLS(NOTIF_SEEN_KEY, now);
  };

  // Local instant search across the whole CMMS store (sync, zero latency)
  const localResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    store.machines.forEach((m) => {
      if (m.name.toLowerCase().includes(q) || (m.machineCode || '').toLowerCase().includes(q) || m.section.toLowerCase().includes(q)) {
        out.push({ kind: 'machine', title: m.name, sub: `Machine · ${m.section}`, to: `/machines/${m.id}` });
      }
      (m.docs || []).forEach((d) => {
        if (d.filename.toLowerCase().includes(q)) {
          out.push({ kind: 'doc', title: d.filename, sub: `${(d.tab || 'doc').toUpperCase()} · ${m.name}`, to: `/machines/${m.id}` });
        }
      });
    });
    store.breakdowns.forEach((b) => {
      const period = b.period ? new Date(`${b.period}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
      if (b.section.toLowerCase().includes(q) || period.toLowerCase().includes(q) || String(b.breakdownCount).includes(q)) {
        out.push({ kind: 'breakdown', title: `${b.section} — ${period}`, sub: `Breakdown · ${b.breakdownCount} count · ${b.downtimeHours || 0}h`, to: '/breakdowns' });
      }
    });
    store.pms.forEach((p) => {
      const period = p.period ? new Date(`${p.period}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
      if (p.section.toLowerCase().includes(q) || period.toLowerCase().includes(q) || String(p.plannedCount).includes(q)) {
        out.push({ kind: 'pm', title: `${p.section} — ${period}`, sub: `PM · ${p.doneCount || 0}/${p.plannedCount || 0} done · ${p.pendingCount || 0} pending`, to: '/pm' });
      }
    });
    store.energy.forEach((e) => {
      if ((e.source || '').toLowerCase().includes(q)) {
        out.push({ kind: 'energy', title: `${e.source} · ${e.kwh} kWh`, sub: `Energy · ${new Date(e.date).toLocaleDateString('en-GB')}`, to: '/energy' });
      }
    });
    return out.slice(0, 6);
  }, [query, store]);

  // Debounced server-side report search
  const runSearch = useCallback((q) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setServerResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.getReports({ search: q.trim(), limit: 5 });
        setServerResults(res.data || []);
      } catch { setServerResults([]); }
    }, 250);
  }, []);

  const commitSearch = (q) => {
    const term = q.trim();
    if (!term) return;
    const next = [term, ...recentSearches.filter((s) => s !== term)].slice(0, 5);
    setRecentSearches(next);
    saveLS(RECENT_KEY, next);
  };

  const openLocal = (r) => {
    commitSearch(query);
    setSearchOpen(false);
    setQuery('');
    navigate(r.to);
  };

  const openResult = (r) => {
    commitSearch(query);
    setSearchOpen(false);
    setQuery('');
    navigate(`/category/${encodeURIComponent(r.category_name)}`);
  };

  const noMatches = query && localResults.length === 0 && serverResults.length === 0;

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

        {/* Instant global search */}
        <div className="flex-1 max-w-xl mx-auto relative" ref={searchRef}>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              className="input-field pl-9 !py-2 text-[13px]"
              placeholder="Search machines, breakdowns, PM, SOPs, reports..."
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
              {localResults.length > 0 && (
                <ul role="listbox" aria-label="CMMS results">
                  <li className="px-4 pt-2 pb-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Maintenance Records</li>
                  {localResults.map((r, i) => {
                    const Icon = RESULT_ICONS[r.kind] || FileText;
                    return (
                      <li key={`${r.kind}-${i}`}>
                        <button onClick={() => openLocal(r)} className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-cyan-500/8 text-left transition-colors">
                          <Icon size={13} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-white text-xs font-medium truncate">{r.title}</p>
                            <p className="text-slate-500 text-[10px] truncate">{r.sub}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {query && serverResults.length > 0 && (
                <ul role="listbox" aria-label="Document results">
                  <li className="px-4 pt-2 pb-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider border-t border-white/[0.05]">Report Documents</li>
                  {serverResults.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => openResult(r)} className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-cyan-500/8 text-left transition-colors">
                        <FileText size={13} className="text-emerald-400 flex-shrink-0" aria-hidden="true" />
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
              {noMatches && (
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
              <button onClick={() => openUpload({ kind: 'bulk' })} className="btn-success !py-2 !px-3.5 text-xs inline-flex items-center gap-1.5">
                <Upload size={13} aria-hidden="true" /> Upload Excel / Bulk Import
              </button>
            </div>
          )}

          {/* Current date */}
          <span className="hidden lg:inline-flex items-center gap-1.5 text-slate-400 text-xs font-medium px-2.5 py-1.5 rounded-control border border-white/[0.08]">
            <CalendarDays size={13} className="text-cyan-400" aria-hidden="true" />
            {formatDateLong()}
          </span>

          {/* Notification centre */}
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
              <div className="absolute right-0 top-full mt-2 w-[340px] glass-card !rounded-xl overflow-hidden shadow-2xl">
                <p className="px-4 py-2.5 text-xs font-semibold text-white border-b border-white/[0.06]">Notification Centre</p>
                {notifications.length === 0 ? (
                  <p className="px-4 py-4 text-slate-500 text-xs">All clear — pending PM summaries, monthly breakdown logs, and low health warnings will surface here automatically.</p>
                ) : (
                  <ul className="max-h-80 overflow-y-auto">
                    {notifications.map((n) => {
                      const meta = NOTIF_META[n.type] || NOTIF_META.info;
                      const Icon = meta.icon;
                      return (
                        <li key={n.id} className="flex gap-2.5 px-4 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.03]">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${meta.cls}`}>
                            <Icon size={13} aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-xs font-semibold">{n.title}</p>
                            <p className="text-slate-400 text-[11px] leading-snug mt-0.5">{n.detail}</p>
                            <p className="text-slate-600 text-[10px] mt-0.5">{timeAgo(n.ts)}</p>
                          </div>
                        </li>
                      );
                    })}
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
                    <Cog size={13} aria-hidden="true" /> Machine Register
                  </button>
                  <button
                    onClick={() => { setProfileOpen(false); navigate('/settings'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-slate-300 hover:bg-white/[0.04] transition-colors"
                  >
                    <Settings size={13} aria-hidden="true" /> Settings
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
