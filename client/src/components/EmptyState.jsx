/**
 * SVG-assisted empty state with a primary CTA.
 */
export default function EmptyState({ title = 'No reports uploaded yet', description, actionLabel, onAction, icon: Icon }) {
  return (
    <div className="glass-card p-10 sm:p-14 flex flex-col items-center text-center">
      {/* Inline SVG illustration — empty folder with docs */}
      <svg width="120" height="90" viewBox="0 0 120 90" fill="none" aria-hidden="true" className="mb-5">
        <rect x="18" y="26" width="84" height="54" rx="8" fill="#1E293B" stroke="rgba(255,255,255,0.1)" />
        <path d="M18 34c0-4.4 3.6-8 8-8h20l8 8h40c4.4 0 8 3.6 8 8v0H18v-8z" fill="#334155" />
        <rect x="34" y="10" width="40" height="26" rx="4" fill="#0F172A" stroke="rgba(6,182,212,0.4)" />
        <line x1="40" y1="18" x2="68" y2="18" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        <line x1="40" y1="24" x2="60" y2="24" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <line x1="40" y1="30" x2="64" y2="30" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <circle cx="96" cy="20" r="10" fill="none" stroke="#10B981" strokeWidth="2" strokeDasharray="3 3" opacity="0.6" />
        <path d="M92 20h8M96 16v8" stroke="#10B981" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      </svg>

      {Icon && <Icon size={28} className="text-slate-600 mb-3" aria-hidden="true" />}
      <h3 className="text-card-title mb-1.5">{title}</h3>
      {description && <p className="text-body max-w-sm mb-5">{description}</p>}
      {actionLabel && onAction && (
        <button onClick={onAction} className="btn-primary">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
