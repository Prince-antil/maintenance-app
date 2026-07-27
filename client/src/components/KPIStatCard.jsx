import { TrendingUp, TrendingDown } from 'lucide-react';

/**
 * Reusable executive KPI summary card.
 * tone: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'
 */
const TONES = {
  accent:  { icon: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20', value: 'text-white', glow: 'hover:shadow-cyan-500/10' },
  success: { icon: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', value: 'text-emerald-400', glow: 'hover:shadow-emerald-500/10' },
  warning: { icon: 'text-amber-400 bg-amber-400/10 border-amber-400/20', value: 'text-amber-400', glow: 'hover:shadow-amber-500/10' },
  danger:  { icon: 'text-red-400 bg-red-400/10 border-red-400/20', value: 'text-red-400', glow: 'hover:shadow-red-500/10' },
  neutral: { icon: 'text-slate-400 bg-slate-400/10 border-slate-400/20', value: 'text-white', glow: '' },
};

export default function KPIStatCard({ icon: Icon, label, value, sub, trend, trendUp = true, tone = 'accent', pulse = false }) {
  const t = TONES[tone] || TONES.accent;
  return (
    <div className={`glass-card glass-card-hover p-5 relative overflow-hidden ${t.glow} hover:shadow-lg`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-control border flex items-center justify-center ${t.icon} ${pulse ? 'animate-pulse' : ''}`}>
          <Icon size={18} aria-hidden="true" />
        </div>
        {trend && (
          <span
            className={`status-pill text-[11px] ${trendUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
            aria-label={`Trend: ${trend}`}
          >
            {trendUp ? <TrendingUp size={11} aria-hidden="true" /> : <TrendingDown size={11} aria-hidden="true" />}
            {trend}
          </span>
        )}
      </div>
      <p className={`text-[26px] font-bold leading-none tracking-tight ${t.value}`}>{value}</p>
      <p className="text-slate-400 text-xs font-medium mt-2">{label}</p>
      {sub && <p className="text-slate-500 text-[11px] mt-0.5">{sub}</p>}
    </div>
  );
}
