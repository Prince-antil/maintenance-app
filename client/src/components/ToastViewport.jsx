import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const META = {
  success: { icon: CheckCircle2, cls: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' },
  error: { icon: AlertTriangle, cls: 'border-red-400/30 bg-red-500/10 text-red-300' },
  info: { icon: Info, cls: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-300' },
};

export default function ToastViewport({ toasts, dismissToast }) {
  if (!toasts.length) return null;

  return (
    <div className="fixed right-4 top-20 z-[120] flex w-[min(92vw,380px)] flex-col gap-3">
      {toasts.map((toast) => {
        const meta = META[toast.type] || META.info;
        const Icon = meta.icon;
        return (
          <div key={toast.id} className={`glass-card flex items-start gap-3 border p-3.5 shadow-2xl animate-[slideInRight_0.2s_ease] ${meta.cls}`}>
            <Icon size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{toast.title}</p>
              {toast.message && <p className="mt-1 text-xs text-slate-300">{toast.message}</p>}
            </div>
            <button onClick={() => dismissToast(toast.id)} className="rounded-control p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Dismiss notification">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
