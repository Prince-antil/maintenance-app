import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Zap, Wrench, FileText, Lightbulb, ArrowRight,
  Shield, Factory, Gauge, ChevronRight
} from 'lucide-react';

const QUICK_CARDS = [
  {
    icon: Zap,
    title: 'Utilities & Energy',
    desc: 'DG 500 & 380kVA performance, Solar PV generation, Plantwise energy consumption audits',
    color: 'from-emerald-500 to-teal-400',
    glow: 'shadow-emerald-500/20',
    border: 'border-emerald-500/30',
    categories: ['Energy Report (DG 500 & 380KVA)', 'Energy Report (Solar)', 'Plantwise Energy Consumption'],
  },
  {
    icon: Wrench,
    title: 'Maintenance & Breakdowns',
    desc: 'Monthly PMs, 21 plant section breakdown RCA, FAT inspections, MTBF/MTTR tracking',
    color: 'from-cyan-500 to-blue-400',
    glow: 'shadow-cyan-500/20',
    border: 'border-cyan-500/30',
    categories: ['Monthly PM Report', 'Plantwise Breakdown Report', 'FAT (Factory Acceptance Test)'],
  },
  {
    icon: FileText,
    title: 'Machine SOPs & MOPs',
    desc: 'Dynamic machine operating procedures, filling line SOPs, reactor MOPs, safety checklists',
    color: 'from-amber-500 to-orange-400',
    glow: 'shadow-amber-500/20',
    border: 'border-amber-500/30',
    categories: ['Monthly PM Report'],
  },
  {
    icon: Lightbulb,
    title: 'Improvement & Kaizen',
    desc: 'ORM risk data, engineering upgrades, cost-saving projects, review presentations',
    color: 'from-purple-500 to-indigo-400',
    glow: 'shadow-purple-500/20',
    border: 'border-purple-500/30',
    categories: ['Kaizen', 'Improvement', 'ORM Data (Operational Risk Management)'],
  },
];

export default function WelcomePage({ onEnterDashboard }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleEnterDashboard = () => {
    if (onEnterDashboard) {
      onEnterDashboard();
    } else {
      sessionStorage.setItem('ccpl_entered', 'true');
      navigate('/');
    }
  };

  const handleCardClick = (card) => {
    sessionStorage.setItem('ccpl_entered', 'true');
    if (card.categories.length === 1) {
      navigate(`/category/${encodeURIComponent(card.categories[0])}`);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-32 w-80 h-80 bg-cyan-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-64 h-64 bg-indigo-500/6 rounded-full blur-3xl" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 sm:py-12">
        {/* Top Badge */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/80 border border-slate-700/50 backdrop-blur-sm">
            <Shield size={14} className="text-emerald-400" />
            <span className="text-xs font-medium text-slate-300 tracking-wide">
              Crystal Crop Protection Limited (CCPL)
            </span>
          </div>
        </div>

        {/* Division Badge */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <Factory size={13} className="text-cyan-400" />
          <span className="text-xs text-cyan-400/80 font-medium tracking-wider uppercase">
            Nathupur Sonepat Unit — Engineering & Reliability Division
          </span>
        </div>

        {/* Hero Section */}
        <div className="text-center mb-12">
          {/* Glowing logo mark */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 mb-6 relative">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-400/10 to-cyan-400/10 blur-xl" />
            <Gauge size={36} className="text-emerald-400 relative z-10" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 leading-tight">
            CCPL Centralized Maintenance
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent">
              & Utilities Portal
            </span>
          </h1>

          <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed mt-4">
            Operational Excellence Hub for Preventive Maintenance, Utility Energy Audits,
            Breakdown RCA, and Machine SOP Management.
          </p>

          {/* User greeting */}
          {user && (
            <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/60 border border-slate-700/40">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm text-slate-300">
                Welcome back, <span className="text-white font-semibold">{user.full_name}</span>
              </span>
            </div>
          )}
        </div>

        {/* Quick Navigation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {QUICK_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.title}
                onClick={() => handleCardClick(card)}
                className={`group glass-card p-5 text-left transition-all duration-300 hover:scale-[1.02] hover:${card.glow} hover:shadow-lg ${card.border} hover:border-opacity-60 relative overflow-hidden`}
              >
                {/* Card glow on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${card.color} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-300`} />

                <div className="relative z-10">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${card.color} bg-opacity-15 flex items-center justify-center`}
                      style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))` }}
                    >
                      <Icon size={20} className={`bg-gradient-to-br ${card.color} bg-clip-text`} style={{ color: card.color.includes('emerald') ? '#10B981' : card.color.includes('cyan') ? '#06B6D4' : card.color.includes('amber') ? '#F59E0B' : '#8B5CF6' }} />
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <h3 className="text-white font-semibold text-base mb-1.5">{card.title}</h3>
                  <p className="text-slate-400 text-xs leading-relaxed">{card.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Enter Dashboard CTA */}
        <div className="text-center">
          <button
            onClick={handleEnterDashboard}
            className="group inline-flex items-center gap-3 px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold text-base shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-[1.02] transition-all duration-300"
          >
            Enter Operational Dashboard
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Footer stats */}
        <div className="mt-12 flex items-center justify-center gap-6 sm:gap-10 text-center">
          <div>
            <p className="text-2xl font-bold text-white">9</p>
            <p className="text-slate-500 text-xs mt-0.5">Report Categories</p>
          </div>
          <div className="w-px h-8 bg-slate-700" />
          <div>
            <p className="text-2xl font-bold text-white">3</p>
            <p className="text-slate-500 text-xs mt-0.5">Operational Modules</p>
          </div>
          <div className="w-px h-8 bg-slate-700" />
          <div>
            <p className="text-2xl font-bold text-emerald-400">24/7</p>
            <p className="text-slate-500 text-xs mt-0.5">Monitoring</p>
          </div>
        </div>
      </div>
    </div>
  );
}
