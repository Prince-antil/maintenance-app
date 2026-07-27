import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { Zap, Upload, Plus, ClipboardCheck, Activity, Lightbulb, X, BookOpen } from 'lucide-react';

/**
 * Floating right-pinned Quick Actions panel (admin only).
 */
export default function QuickActionsPanel() {
  const { user } = useAuth();
  const { openUpload, openAddMachine } = useUI();
  const [open, setOpen] = useState(false);

  if (user?.role !== 'admin') return null;

  const actions = [
    { label: '+ Upload SOP', icon: BookOpen, run: () => openUpload('Monthly PM Report') },
    { label: '+ Add Machine', icon: Plus, run: () => openAddMachine() },
    { label: '+ Upload PM / Breakdown Report', icon: ClipboardCheck, run: () => openUpload('Plantwise Breakdown Report') },
    { label: '+ Add Energy Log', icon: Activity, run: () => openUpload('Plantwise Energy Consumption') },
    { label: '+ Create Kaizen Entry', icon: Lightbulb, run: () => openUpload('Kaizen') },
  ];

  return (
    <div className="fixed right-4 bottom-6 z-[70] flex flex-col items-end gap-2.5">
      {open && (
        <div className="glass-card p-2 w-64 shadow-2xl animate-[slideUp_0.2s_ease]" role="menu" aria-label="Quick actions">
          <p className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Quick Actions</p>
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                onClick={() => { a.run(); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-control text-[13px] text-slate-300 hover:text-white hover:bg-cyan-500/10 transition-colors text-left"
                role="menuitem"
              >
                <Icon size={15} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
                {a.label}
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-13 h-13 p-4 rounded-full shadow-xl transition-all duration-300 flex items-center justify-center ${
          open
            ? 'bg-slate-700 rotate-90'
            : 'bg-gradient-to-br from-cyan-500 to-emerald-500 hover:shadow-cyan-500/40 hover:scale-105'
        }`}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
        aria-expanded={open}
      >
        {open ? <X size={20} className="text-white" aria-hidden="true" /> : <Zap size={20} className="text-white" aria-hidden="true" />}
      </button>
    </div>
  );
}
