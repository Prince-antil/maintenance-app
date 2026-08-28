// ================================================================
// CCPL CMMS — Shared Domain Constants
// ================================================================
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import CheckSquare from 'lucide-react/dist/esm/icons/check-square';
import Zap from 'lucide-react/dist/esm/icons/zap';
import Sun from 'lucide-react/dist/esm/icons/sun';
import Activity from 'lucide-react/dist/esm/icons/activity';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';

// Report categories (must match backend whitelist — do not modify)
export const CATEGORIES = [
  'Monthly PM Report',
  'Plantwise Breakdown Report',
  'Machine Asset Register',
  'FAT (Factory Acceptance Test)',
  'Energy Report (DG 500 & 380KVA)',
  'Energy Report (Solar)',
  'Plantwise Energy Consumption',
  'Kaizen',
  'Improvement',
  'ORM Data (Operational Risk Management)',
];

// Professional icon + color mapping per category
export const CATEGORY_META = {
  'Operating Procedure for M/C': { icon: BookOpen, color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  'Monthly PM Report': { icon: ClipboardCheck, color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  'Plantwise Breakdown Report': { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  'Machine Asset Register': { icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  'FAT (Factory Acceptance Test)': { icon: CheckSquare, color: 'text-violet-400', bg: 'bg-violet-400/10', border: 'border-violet-400/20' },
  'Energy Report (DG 500 & 380KVA)': { icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' },
  'Energy Report (Solar)': { icon: Sun, color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  'Plantwise Energy Consumption': { icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  'Kaizen': { icon: Lightbulb, color: 'text-indigo-400', bg: 'bg-indigo-400/10', border: 'border-indigo-400/20' },
  'Improvement': { icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20' },
  'ORM Data (Operational Risk Management)': { icon: ShieldCheck, color: 'text-rose-400', bg: 'bg-rose-400/10', border: 'border-rose-400/20' },
};

// Complete 21 plant sections (includes master combined view)
export const PLANT_SECTIONS = [
  'Overall Nathupur Maintenance Formulation Plant (Master Combined View)',
  'Formulation Park',
  'Herbi ACM Formulation',
  'Herbi EC Packaging',
  'EC Herbi Formulation',
  'SC Herbicide Formulation',
  'SC Herbicide Packaging',
  'Topper Formulation Herbi',
  'Herbi Packaging',
  'ACM-1 INSEC Formulation',
  'EC INSEC Packaging',
  'EC INSEC FORMULATION',
  'Finish Goods',
  'CARTAP FORMULATION INSEC',
  'CARTAP PACKAGING INSEC',
  'JET MILL FORMULATION INSEC',
  'PRINTING SECTION EC',
  'SC INSEC FORMULATION',
  'Acephate/Zivora Packaging INSEC',
  'STORE',
  'Utility Section',
];

export const MASTER_PLANT_SECTION = PLANT_SECTIONS[0];

export function sortPlantSections(sections = []) {
  const unique = [...new Set((sections || []).filter(Boolean))];
  return unique.sort((a, b) => {
    const aIndex = PLANT_SECTIONS.indexOf(a);
    const bIndex = PLANT_SECTIONS.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

export function getOperationalSections(machines = []) {
  const sectionSet = new Set(
    (machines || [])
      .map((machine) => machine.section)
      .filter(Boolean)
  );
  return sortPlantSections([...sectionSet].filter((section) => section !== MASTER_PLANT_SECTION));
}

/**
 * Returns all available sections: hardcoded PLANT_SECTIONS + any
 * user-added dynamic sections (from the store). Duplicates are removed
 * and the master section is always first.
 */
export function getAllSections(dynamicSections = []) {
  const names = dynamicSections.map((s) => (typeof s === 'string' ? s : s.name || ''));
  const combined = [...PLANT_SECTIONS, ...names];
  const unique = [...new Set(combined.filter(Boolean))];
  return unique.sort((a, b) => {
    const aIndex = PLANT_SECTIONS.indexOf(a);
    const bIndex = PLANT_SECTIONS.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const YEARS = [2024, 2025, 2026, 2027];

// Full file support: Word, Excel, PowerPoint, PDF (+ CSV legacy)
export const ALLOWED_EXT = ['.doc', '.docx', '.xlsx', '.xls', '.csv', '.ppt', '.pptx', '.pdf'];

// Color-coded file badges: DOCX Blue, XLSX Green, PPTX Orange, PDF Red
export const EXT_META = {
  '.doc':  { badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30', label: 'DOC' },
  '.docx': { badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30', label: 'DOCX' },
  '.xlsx': { badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', label: 'XLSX' },
  '.xls':  { badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', label: 'XLS' },
  '.csv':  { badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', label: 'CSV' },
  '.pptx': { badge: 'bg-orange-500/15 text-orange-400 border border-orange-500/30', label: 'PPTX' },
  '.ppt':  { badge: 'bg-orange-500/15 text-orange-400 border border-orange-500/30', label: 'PPT' },
  '.pdf':  { badge: 'bg-red-500/15 text-red-400 border border-red-500/30', label: 'PDF' },
};

// Machine profile document tabs (AMC tab added last)
export const MACHINE_DOC_TABS = [
  { id: 'sop',     label: 'SOP' },
  { id: 'mop',     label: 'MOP' },
  { id: 'wi',      label: 'Work Instructions & Manuals' },
  { id: 'circuit', label: 'Circuit Diagrams & Schematics' },
  { id: 'media',   label: 'Training Videos / Media' },
  { id: 'amc',     label: 'AMC Management' },
];

export const APP_VERSION = '1.0';
export const COMPANY_NAME = 'Crystal Crop Protection Ltd.';
export const UNIT_BADGE = 'NATHUPUR UNIT — MAINTENANCE & RELIABILITY HUB';
