import { useNavigate, useLocation } from 'react-router-dom';
import { useUI } from '../context/UIContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePlant } from '../context/PlantContext.jsx';
import { canViewCorporateDashboard, isSuperAdmin } from '../lib/plantAccess.js';
import PlantSwitcher from './PlantSwitcher.jsx';
import {
  LayoutDashboard, Cog, AlertOctagon, ClipboardCheck, BookOpen,
  Zap, ShieldCheck, Lightbulb, FileBarChart2, Settings,
  AlertTriangle, CheckSquare, Sun, Activity, TrendingUp, X, Shield,
  Layers, Building2, Users,
} from 'lucide-react';

// Enterprise CMMS navigation — core modules first, document archive below
const NAV_GROUPS = [
  {
    title: 'Maintenance',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/', color: 'text-cyan-400' },
      { label: 'Machines', icon: Cog, to: '/machines', color: 'text-cyan-400' },
      { label: 'Breakdowns', icon: AlertOctagon, to: '/breakdowns', color: 'text-red-400' },
      { label: 'Preventive Maintenance', icon: ClipboardCheck, to: '/pm', color: 'text-emerald-400' },
      { label: 'SOP Library', icon: BookOpen, to: '/sop', color: 'text-violet-400' },
      { label: 'Energy', icon: Zap, to: '/energy', color: 'text-amber-400' },
      { label: 'ORM', icon: ShieldCheck, to: '/category/ORM%20Data%20(Operational%20Risk%20Management)', color: 'text-rose-400' },
      { label: 'Kaizen', icon: Lightbulb, to: '/category/Kaizen', color: 'text-indigo-400' },
      { label: 'Reports & Analytics', icon: FileBarChart2, to: '/reports', color: 'text-teal-400' },
      { label: 'Settings', icon: Settings, to: '/settings', color: 'text-slate-300' },
    ],
  },
  {
    title: 'Document Library',
    items: [
      { label: 'Monthly PM Report', icon: ClipboardCheck, to: '/category/Monthly%20PM%20Report', color: 'text-cyan-400' },
      { label: 'Plantwise Breakdown Report', icon: AlertTriangle, to: '/category/Plantwise%20Breakdown%20Report', color: 'text-amber-400' },
      { label: 'FAT (Factory Acceptance Test)', icon: CheckSquare, to: '/category/FAT%20(Factory%20Acceptance%20Test)', color: 'text-violet-400' },
      { label: 'Energy Report (DG 500 & 380KVA)', icon: Zap, to: '/category/Energy%20Report%20(DG%20500%20%26%20380KVA)', color: 'text-yellow-400' },
      { label: 'Energy Report (Solar)', icon: Sun, to: '/category/Energy%20Report%20(Solar)', color: 'text-emerald-400' },
      { label: 'Plantwise Energy Consumption', icon: Activity, to: '/category/Plantwise%20Energy%20Consumption', color: 'text-emerald-400' },
      { label: 'Improvement', icon: TrendingUp, to: '/category/Improvement', color: 'text-purple-400' },
    ],
  },
];

function getCorporateGroups(user) {
  const groups = [];
  if (canViewCorporateDashboard(user?.role)) {
    groups.push({
      title: 'Corporate',
      items: [
        { label: 'Corporate Dashboard', icon: Layers, to: '/corporate', color: 'text-violet-400' },
      ],
    });
  }
  if (isSuperAdmin(user?.role)) {
    groups.push({
      title: 'Administration',
      items: [
        { label: 'Plant Management', icon: Building2, to: '/admin/plants', color: 'text-cyan-400' },
        { label: 'User Management', icon: Users, to: '/admin/users', color: 'text-emerald-400' },
      ],
    });
  }
  return groups;
}

export default function Sidebar() {
  const { sidebarCollapsed, sidebarMobileOpen, setSidebarMobileOpen } = useUI();
  const { user } = useAuth();
  const { currentPlant } = usePlant();
  const navigate = useNavigate();
  const location = useLocation();
  const corporateGroups = getCorporateGroups(user);

  const isActive = (to) => {
    const path = decodeURIComponent(location.pathname);
    const target = decodeURIComponent(to);
    if (target === '/') return path === '/';
    if (target.startsWith('/category/')) return path === target;
    return path === target || path.startsWith(`${target}/`);
  };

  const go = (to) => {
    navigate(to);
    setSidebarMobileOpen(false);
  };

  const content = (collapsed) => (
    <nav className="flex flex-col h-full" aria-label="Main navigation">
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

      <div className="flex-1 overflow-y-auto py-4 px-2.5 space-y-4">
        {/* Current plant badge */}
        {!collapsed && currentPlant && (
          <div className="mx-2 rounded-control bg-cyan-500/8 border border-cyan-500/20 px-3 py-2">
            <p className="text-cyan-400 text-[10px] font-semibold tracking-wider">CURRENT PLANT</p>
            <p className="text-white text-xs font-semibold truncate">{currentPlant.plant_name}</p>
            <p className="text-slate-500 text-[10px]">{currentPlant.plant_code} {currentPlant.location ? `· ${currentPlant.location}` : ''}</p>
          </div>
        )}
        {/* Plant switcher in collapsed mode shows icon only */}
        {collapsed && (
          <div className="flex justify-center py-1">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Building2 size={14} className="text-cyan-400" />
            </div>
          </div>
        )}

        {[...corporateGroups, ...NAV_GROUPS].map((group) => (
          <div key={group.title} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
                {group.title}
              </p>
            )}
            {collapsed && <div className="mx-3 border-t border-white/[0.06]" aria-hidden="true" />}
            {group.items.map((item) => {
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
        ))}
      </div>

      {!collapsed && (
        <div className="px-4 py-4 border-t border-white/[0.06] space-y-2">
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Crystal Crop Protection Ltd.<br />{currentPlant?.plant_name || 'Nathupur Plant'} · CMMS v1.0
          </p>
          <p className="text-[9px] text-slate-600">
            {canViewCorporateDashboard(user?.role) ? 'Corporate · All Plants' : `Plant: ${currentPlant?.plant_code || 'NATHUPUR'}`}
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
