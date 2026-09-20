import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Search, Upload, Eye, ExternalLink, CalendarDays, Award, ShieldCheck, AlertTriangle, Clock, FileText } from 'lucide-react';
import { timeAgo } from '../utils.js';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'amc', label: 'AMC Contracts' },
  { id: 'cert', label: 'Testing & Statutory Certificates' },
  { id: 'service', label: 'Service Visits' },
];

function daysLeftBadge(days) {
  if (days == null) return { label: '—', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, cls: 'bg-red-500/15 text-red-400 border-red-500/30' };
  if (days === 0) return { label: 'Today', cls: 'bg-red-500/15 text-red-400 border-red-500/30' };
  if (days < 7) return { label: `${days}d left`, cls: 'bg-red-500/15 text-red-400 border-red-500/30' };
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  return { label: `${days}d left`, cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
}

export default function AlertsDrawer({ isOpen, onClose, alerts = [], machines = [] }) {
  const [activeTab, setActiveTab] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = alerts;
    if (activeTab !== 'all') {
      list = list.filter((a) => a.category === activeTab || (activeTab === 'service' && a.category === 'service'));
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((a) =>
        (a.machineName || '').toLowerCase().includes(q) ||
        (a.asset || '').toLowerCase().includes(q) ||
        (a.vendor || '').toLowerCase().includes(q) ||
        (a.detail || '').toLowerCase().includes(q) ||
        (a.title || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [alerts, activeTab, query]);

  const navigate = useNavigate();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="w-full max-w-[560px] bg-slate-900 border-l border-white/[0.08] shadow-2xl flex flex-col max-h-screen">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] sticky top-0 bg-slate-900 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold text-[15px]">Plant Compliance & Service Expiries</h2>
            <button onClick={onClose} className="w-8 h-8 rounded-control bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          {/* Category Switcher */}
          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${activeTab === t.id ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:border-white/[0.12]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Search */}
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by machine tag, vendor, or building section"
              className="w-full pl-9 pr-3 py-2 rounded-control bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/50"
            />
          </div>
          <p className="text-slate-500 text-[11px] mt-2">{filtered.length} of {alerts.length} records • sorted by days until expiry</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <FileText size={28} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 text-xs">No expiring records in this category</p>
            </div>
          ) : (
            filtered.map((alert) => {
              const badge = daysLeftBadge(alert.daysLeft);
              const isCert = alert.category === 'cert';
              const isAmc = alert.category === 'amc';
              return (
                <div key={alert.id} className="rounded-control border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center border text-[12px] ${alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/20 text-red-400' : alert.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'}`}>
                          {isCert ? '📜' : isAmc ? '🛡️' : '🔧'}
                        </span>
                        <p className="text-white text-sm font-semibold truncate">{alert.machineName || alert.asset || 'Unknown Machine'}</p>
                        <span className="text-slate-500 text-[11px] truncate">{alert.machineId || ''}</span>
                      </div>
                      <p className="text-slate-400 text-xs mt-1 truncate">{isCert ? alert.certificateType || 'Testing Certificate' : isAmc ? 'Annual Maintenance Contract' : 'Service Visit'} • {alert.vendor || '—'}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-slate-400"><CalendarDays size={11} /> {alert.expiryDate ? new Date(alert.expiryDate).toLocaleDateString('en-GB') : timeAgo(alert.ts)} <span className={`ml-1 px-1.5 py-0.5 rounded-full border text-[10px] ${badge.cls}`}>{badge.label}</span></span>
                        {alert.expectedVisits != null && (
                          <span className="inline-flex items-center gap-1 text-slate-400"><Clock size={11} /> {alert.completedVisits ?? 0} / {alert.expectedVisits} Visits Completed</span>
                        )}
                        {isCert && alert.certificateNumber && (
                          <span className="text-slate-500 font-mono text-[11px]">#{alert.certificateNumber}</span>
                        )}
                      </div>
                    </div>
                    <span className={`hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border ${alert.type === 'danger' ? 'bg-red-500/10 border-red-500/30 text-red-300' : alert.type === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'}`}>
                      <AlertTriangle size={11} /> {alert.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => {
                        if (alert.machineId) navigate(`/machines/${alert.machineId}`);
                        if (alert.category === 'cert') navigate(`/machines/${alert.machineId}?tab=certs`);
                        if (alert.category === 'amc') navigate(`/machines/${alert.machineId}?tab=amc`);
                      }}
                      className="flex-1 py-1.5 rounded-control bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-xs font-medium hover:bg-cyan-500/25 inline-flex items-center justify-center gap-1.5"
                    >
                      <Eye size={12} /> View Details
                    </button>
                    <button
                      onClick={() => {
                        if (alert.machineId) navigate(`/machines/${alert.machineId}`);
                      }}
                      className="flex-1 py-1.5 rounded-control bg-white/[0.06] text-slate-300 border border-white/[0.08] text-xs font-medium hover:bg-white/[0.10] inline-flex items-center justify-center gap-1.5"
                    >
                      <Upload size={12} /> Update Certificate
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-white/[0.06] bg-slate-900 sticky bottom-0">
          <p className="text-slate-500 text-[11px] text-center">Data updates in realtime via Supabase — renew a contract to clear its alert automatically</p>
        </div>
      </div>
    </div>
  );
}
