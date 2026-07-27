/**
 * Status pill component.
 * Running = Emerald · Maintenance = Amber · Breakdown = Rose · Standby = Slate
 */
const STATUS_STYLES = {
  running:     { cls: 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/30', dot: 'bg-emerald-400', label: 'Running' },
  maintenance: { cls: 'bg-amber-500/12 text-amber-400 border border-amber-500/30', dot: 'bg-amber-400', label: 'Under Maintenance' },
  breakdown:   { cls: 'bg-rose-500/12 text-rose-400 border border-rose-500/30', dot: 'bg-rose-400', label: 'Breakdown' },
  standby:     { cls: 'bg-slate-500/12 text-slate-400 border border-slate-500/30', dot: 'bg-slate-400', label: 'Standby' },
};

export default function StatusBadge({ status = 'running', label, pulse = false }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.standby;
  return (
    <span className={`status-pill ${s.cls}`} role="status" aria-label={label || s.label}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      {label || s.label}
    </span>
  );
}
