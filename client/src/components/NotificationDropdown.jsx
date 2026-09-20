import { Settings, CheckCheck, Eye } from 'lucide-react';
import { timeAgo } from '../utils.js';

const FILTERS = [
  { id: 'all', label: 'All Alerts' },
  { id: 'amc', label: 'AMC Expiries' },
  { id: 'cert', label: 'Testing Certificates' },
  { id: 'pm', label: 'PM Overdue' },
];

function severityMeta(alert) {
  const days = alert.daysLeft;
  if (days != null && days < 7) return { icon: '🔴', cls: 'text-red-400 bg-red-400/10 border-red-400/25' };
  if (days != null && days <= 30) return { icon: '🟡', cls: 'text-amber-400 bg-amber-400/10 border-amber-400/25' };
  if (alert.type === 'danger') return { icon: '🔴', cls: 'text-red-400 bg-red-400/10 border-red-400/25' };
  if (alert.type === 'warning') return { icon: '🟡', cls: 'text-amber-400 bg-amber-400/10 border-amber-400/25' };
  return { icon: '🔵', cls: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/25' };
}

export default function NotificationDropdown({
  alerts = [],
  counts = { total: 0 },
  activeFilter = 'all',
  onFilterChange,
  onMarkAllRead,
  onViewDetails,
  onViewAll,
  onSettings,
}) {
  const filtered = activeFilter === 'all' ? alerts : alerts.filter((a) => a.category === activeFilter);

  return (
    <div className="w-[380px] glass-card !rounded-xl overflow-hidden shadow-2xl border border-white/[0.08]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div>
          <h3 className="text-white text-sm font-semibold">Notifications</h3>
          <p className="text-slate-400 text-[11px]">{counts.total} active • {alerts.filter((a) => a.daysLeft != null && a.daysLeft < 7).length} critical</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onMarkAllRead} className="text-[11px] px-2.5 py-1 rounded-control bg-white/[0.06] text-slate-300 hover:bg-white/[0.10] border border-white/[0.08] inline-flex items-center gap-1">
            <CheckCheck size={12} /> Mark All as Read
          </button>
          <button onClick={onSettings} className="w-7 h-7 rounded-control bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white" aria-label="Notification settings">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.06] overflow-x-auto">
        {FILTERS.map((f) => {
          const isActive = activeFilter === f.id;
          const count = f.id === 'all' ? counts.total : f.id === 'amc' ? counts.amc : f.id === 'cert' ? counts.cert : counts.pm;
          return (
            <button
              key={f.id}
              onClick={() => onFilterChange?.(f.id)}
              className={`text-[11px] px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${isActive ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:border-white/[0.12] hover:text-white'}`}
            >
              {f.label} {count > 0 && <span className={`ml-1 px-1 py-0.5 rounded text-[10px] ${isActive ? 'bg-cyan-500/20' : 'bg-white/[0.06]'}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Alert List */}
      <div className="max-h-[380px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-slate-500 text-xs">No alerts in this category</p>
            <p className="text-slate-600 text-[11px] mt-1">All clear — new expiries will appear here automatically</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {filtered.slice(0, 20).map((alert) => {
              const meta = severityMeta(alert);
              const daysText = alert.daysLeft != null ? (alert.daysLeft < 0 ? `${Math.abs(alert.daysLeft)}d overdue` : alert.daysLeft === 0 ? 'Today' : `${alert.daysLeft}d left`) : '';
              return (
                <li key={alert.id} className="flex gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border text-[13px] ${meta.cls}`}>
                    {meta.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-xs font-semibold leading-tight truncate">{alert.title}</p>
                    <p className="text-slate-400 text-[11px] leading-snug truncate">{alert.detail}</p>
                    <p className="text-slate-500 text-[11px] mt-0.5 truncate">{alert.asset || alert.machineName || ''} {alert.vendor ? `• ${alert.vendor}` : ''}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${meta.cls}`}>{daysText || timeAgo(alert.ts)}</span>
                      <span className="text-slate-600 text-[10px]">{timeAgo(alert.ts)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onViewDetails?.(alert)}
                    className="self-center text-[11px] px-2.5 py-1 rounded-control bg-white/[0.06] text-slate-300 hover:bg-cyan-500/15 hover:text-cyan-300 border border-white/[0.08] hover:border-cyan-500/30 whitespace-nowrap inline-flex items-center gap-1"
                  >
                    <Eye size={11} /> View Details
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/[0.06] bg-slate-900/50">
        <button
          onClick={onViewAll}
          className="w-full py-2.5 rounded-control bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-xs font-semibold hover:bg-cyan-500/25 transition-colors"
        >
          View All Expiring Contracts & Certificates →
        </button>
      </div>
    </div>
  );
}
