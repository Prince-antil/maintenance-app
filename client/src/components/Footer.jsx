import { Shield } from 'lucide-react';
import { APP_VERSION, COMPANY_NAME } from '../constants.js';

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] mt-auto">
      <div className="px-4 lg:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-meta flex items-center gap-1.5 text-center">
          <Shield size={12} className="text-emerald-500/70" aria-hidden="true" />
          Maintenance Management System | Version {APP_VERSION} — © 2026 {COMPANY_NAME} All Rights Reserved.
        </p>
        <p className="text-[11px] text-slate-600">Nathupur Unit · Engineering & Reliability Division</p>
      </div>
    </footer>
  );
}
