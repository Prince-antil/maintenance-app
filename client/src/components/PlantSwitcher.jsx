import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Check, Shield, Layers } from 'lucide-react';
import { usePlant } from '../context/PlantContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { canViewCorporateDashboard } from '../lib/plantAccess.js';

export default function PlantSwitcher({ compact = false }) {
  const { authorizedPlants, currentPlant, setCurrentPlant, currentPlantId } = usePlant();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const canSwitch = authorizedPlants.length > 1;
  const showCorporate = canViewCorporateDashboard(user?.role);

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400" ref={ref}>
        <Building2 size={12} className="text-cyan-400" />
        <span className="font-semibold text-cyan-300">{currentPlant?.plant_name}</span>
        <span className="text-slate-600 text-[10px]">({currentPlant?.plant_code})</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => canSwitch && setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-control border transition-all text-xs ${
          canSwitch
            ? 'bg-white/[0.06] border-white/[0.10] hover:bg-white/[0.09] hover:border-white/[0.15] cursor-pointer'
            : 'bg-white/[0.03] border-white/[0.06] cursor-default'
        }`}
        aria-label="Switch plant"
        aria-expanded={open}
        disabled={!canSwitch}
      >
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
          <Building2 size={12} className="text-white" />
        </div>
        <div className="text-left hidden sm:block">
          <p className="text-white text-xs font-semibold leading-none">{currentPlant?.plant_name}</p>
          <p className="text-slate-400 text-[10px] leading-none">{currentPlant?.plant_code} · {currentPlant?.location || 'CCPL'}</p>
        </div>
        <div className="sm:hidden text-white text-xs font-semibold">{currentPlant?.plant_code}</div>
        {canSwitch && <ChevronDown size={13} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && canSwitch && (
        <div className="absolute left-0 top-full mt-2 w-64 glass-card !rounded-xl overflow-hidden shadow-2xl z-50">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
            <Layers size={12} className="text-cyan-400" />
            <p className="text-white text-xs font-semibold">Select Plant</p>
            {showCorporate && <span className="ml-auto badge bg-violet-500/15 text-violet-300 text-[9px]">Corporate access</span>}
          </div>
          <div className="py-1">
            {authorizedPlants.map((p) => {
              const active = p.id === currentPlantId;
              return (
                <button
                  key={p.id}
                  onClick={() => { setCurrentPlant(p.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${active ? 'bg-cyan-500/10' : 'hover:bg-white/[0.04]'}`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-cyan-500/20 border border-cyan-500/30' : 'bg-white/[0.04] border border-white/[0.06]'}`}>
                    {active ? <Check size={12} className="text-cyan-400" /> : <Building2 size={12} className="text-slate-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold truncate ${active ? 'text-cyan-300' : 'text-white'}`}>{p.plant_name}</p>
                    <p className="text-slate-500 text-[10px] truncate">{p.plant_code} {p.location ? `· ${p.location}` : ''}</p>
                  </div>
                  {active && <span className="badge bg-cyan-500/15 text-cyan-400 text-[9px] border border-cyan-500/25">Active</span>}
                </button>
              );
            })}
          </div>
          {showCorporate && (
            <div className="px-3 py-2 border-t border-white/[0.06] bg-violet-500/[0.04]">
              <p className="text-violet-300 text-[10px] flex items-center gap-1.5">
                <Shield size={10} /> Corporate users can switch to any authorized plant
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
