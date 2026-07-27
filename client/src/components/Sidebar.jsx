import { useNavigate, useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import {
  LayoutDashboard, BookOpen, ClipboardCheck, AlertTriangle, CheckSquare,
  Zap, Sun, Activity, Lightbulb, TrendingUp, ShieldCheck, X, Shield,
} from 'lucide-react';

// Professional icon set per module (replaces legacy colored dots)
const NAV_ITEMS = [
  { label: 'Executive Dashboard', icon: LayoutDashboard, to: '/', color: 'text-cyan-400' },
  { label: 'Operating Procedure for M/C', icon: BookOpen, to: '/machines', color: 'text-cyan-400' },
  { label: 'Monthly PM Report', icon: ClipboardCheck, to: '/category/Monthly%20PM%20Report', color: 'text-cyan-400' },
  { label: 'Plantwise Breakdown Report', icon: AlertTriangle, to: '/category/Plantwise%20Breakdown%20Report', color: 'text-amber-400' },
  { label: 'FAT (Factory Acceptance Test)', icon: CheckSquare, to: '/category/FAT%20(Factory%20Acceptance%20Test)', color: 'text-violet-400' },
  { label: 'Energy Report (DG 500 & 380KVA)', icon: Zap, to: '/category/Energy%20Report%20(DG%20500%20%26%20380KVA)', color: 'text-yellow-400' },
  { label: 'Energy Report (Solar)', icon: Sun, to: '/category/Energy%20Report%20(Solar)', color: 'text-emerald-400' },
  { label: 'Plantwise Energy Consumption', icon: Activity, to: '/category/Plantwise%20Energy%20Consumption', color: 'text-emerald-400' },
  { label: 'Kaizen', icon: Lightbulb, to: '/category/Kaizen', color: 'text-indigo-400' },
  { label: 'Improvement', icon: TrendingUp, to: '/category/Improvement', color: 'text-purple-400' },
  { label: 'ORM Data', icon: ShieldCheck, to: '/category/ORM%20Data%20(Operational%20Risk%20Management)', color: 'text-rose-400' },
];

export default function Sidebar() {
  const { sidebarCollapsed, sidebarMobileOpen, setSidebarMobileOpen } = useUI();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (to) => {
    if (to === '/') return location.pathname === '/';
    return decodeURIComponent(location.pathname) === decodeURIComponent(to)
      || location.pathname.startsWith(to.split('/category')[0] === '' ? to : to);
  };

  const go = (to) => {
    navigate(to);
    setSidebarMobileOpen(false);
  };

  const content = (collapsed) => (
    <nav
      className="flex flex-col h-full"
      aria-label="Main navigation"
    >
      {/* Mobile drawer header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
            <Shield size={15} className="text-white" aria-hidden="true" />
          </div>
          <span className="text-white text-sm font-semibold">CCPL Hub</span>
        </div>
        <button
          onClick={() => setSidebarMobileOpen(false)}
          className="text-slate-400 hover:text-white p-1.5"
          aria-label="Close menu"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-2.5 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <button
              key={item.to}
              onClick={() => go(item.to)}
              className={`sidebar-item relative w-full flex items-center gap-3 rounded-control px-3 py-2.5 text-[13px] font-medium transition-all text-left
                ${active
                  ? 'bg-cyan-500/10 text-white border border-cyan-500/25'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'}`}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? undefined : item.label}
            >
              <Icon size={17} className={`flex-shrink-0 ${active ? item.color : ''}`} aria-hidden="true" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && <span className="sidebar-tooltip" role="tooltip">{item.label}</span>}
            </button>
          );
        })}
      </div>

      {!collapsed && (
        <div className="px-4 py-4 border-t border-white/[0.06]">
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Crystal Crop Protection Ltd.<br />Nathupur Unit · CMMS v1.0
          </p>
        </div>
      )}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:block sticky top-[57px] h-[calc(100vh-57px)] flex-shrink-0 border-r border-white/[0.06] bg-slate-900/70 backdrop-blur-xl transition-all duration-300 ${
          sidebarCollapsed ? 'w-[68px]' : 'w-[264px]'
        }`}
      >
        {content(sidebarCollapsed)}
      </aside>

      {/* Mobile off-canvas drawer */}
      {sidebarMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 bottom-0 w-[280px] bg-slate-900 border-r border-white/[0.08] shadow-2xl animate-[slideInRight_0.2s_ease]">
            {content(false)}
          </div>
        </div>
      )}
    </>
  );
}
