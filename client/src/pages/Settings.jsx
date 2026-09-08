import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { useStore, updateSettings, exportBackup, importBackup, logActivity, resetPersistentData, getEnergySettings, upsertEnergySettings } from '../store.js';
import { clearReportVault, listReportMetadata } from '../reportVault.js';
import { APP_VERSION, COMPANY_NAME, UNIT_BADGE } from '../constants.js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { sendTestNotification } from '../lib/notificationService.js';
import {
  Settings as SettingsIcon, Factory, User, Shield, Database,
  DownloadCloud, UploadCloud, CheckCircle2, AlertCircle, Info,
  Cog, AlertOctagon, ClipboardCheck, Zap, History, Trash2, Bell, Mail, MessageSquare,
} from 'lucide-react';

const NOTIF_STORAGE_KEY = 'ccpl_notification_settings';

export default function Settings() {
  const { user } = useAuth();
  const { pushToast } = useUI();
  const store = useStore();
  const [plantName, setPlantName] = useState(store.settings.plantName || '');
  const [saved, setSaved] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null); // { ok, text }
  const [resetMsg, setResetMsg] = useState(null); // { ok, text }
  const fileRef = useRef(null);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifWhatsApp, setNotifWhatsApp] = useState(false);
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifPrimaryEmail, setNotifPrimaryEmail] = useState('');
  const [notifAdditionalEmails, setNotifAdditionalEmails] = useState('');
  const [notifWhatsAppNumbers, setNotifWhatsAppNumbers] = useState('');
  const [notifAmcExpiry, setNotifAmcExpiry] = useState(true);
  const [notifAmcOverdue, setNotifAmcOverdue] = useState(true);
  const [notifAmcExpired, setNotifAmcExpired] = useState(true);
  const [notifPmOverdue, setNotifPmOverdue] = useState(true);
  const [notifBreakdownOpen, setNotifBreakdownOpen] = useState(true);
  const [notifSafetyExpiry, setNotifSafetyExpiry] = useState(true);
  const [notifSafetyExpired, setNotifSafetyExpired] = useState(true);
  const [notifReminderDays, setNotifReminderDays] = useState('30,15,7,1');
  const [notifSaved, setNotifSaved] = useState(false);
  const [notifTestMsg, setNotifTestMsg] = useState(null);

  // ── Load persisted notification settings on mount (localStorage + Supabase) ──
  useEffect(() => {
    let cancelled = false;
    function applyNotifPayload(payload) {
      if (!payload || typeof payload !== 'object') return;
      if (typeof payload.enabled === 'boolean') setNotifEnabled(payload.enabled);
      if (payload.channels && typeof payload.channels === 'object') {
        if (typeof payload.channels.inApp === 'boolean') setNotifInApp(payload.channels.inApp);
        if (typeof payload.channels.email === 'boolean') setNotifEmail(payload.channels.email);
        if (typeof payload.channels.whatsapp === 'boolean') setNotifWhatsApp(payload.channels.whatsapp);
      }
      if (payload.recipients && typeof payload.recipients === 'object') {
        if (payload.recipients.primaryEmail != null) setNotifPrimaryEmail(String(payload.recipients.primaryEmail));
        if (payload.recipients.additionalEmails != null) setNotifAdditionalEmails(String(payload.recipients.additionalEmails));
        if (payload.recipients.whatsappNumbers != null) setNotifWhatsAppNumbers(String(payload.recipients.whatsappNumbers));
      } else {
        // backwards compat: flat keys
        if (payload.primaryEmail != null) setNotifPrimaryEmail(String(payload.primaryEmail));
        if (payload.additionalEmails != null) setNotifAdditionalEmails(String(payload.additionalEmails));
        if (payload.whatsappNumbers != null) setNotifWhatsAppNumbers(String(payload.whatsappNumbers));
      }
      if (payload.reminderDays != null) setNotifReminderDays(String(payload.reminderDays));
      if (payload.types && typeof payload.types === 'object') {
        if (typeof payload.types.amcExpiry === 'boolean') setNotifAmcExpiry(payload.types.amcExpiry);
        if (typeof payload.types.amcOverdue === 'boolean') setNotifAmcOverdue(payload.types.amcOverdue);
        if (typeof payload.types.amcExpired === 'boolean') setNotifAmcExpired(payload.types.amcExpired);
        if (typeof payload.types.pmOverdue === 'boolean') setNotifPmOverdue(payload.types.pmOverdue);
        if (typeof payload.types.breakdownOpen === 'boolean') setNotifBreakdownOpen(payload.types.breakdownOpen);
        if (typeof payload.types.safetyExpiry === 'boolean') setNotifSafetyExpiry(payload.types.safetyExpiry);
        if (typeof payload.types.safetyExpired === 'boolean') setNotifSafetyExpired(payload.types.safetyExpired);
      }
      // legacy flat booleans for safety types
      if (typeof payload.safetyExpiry === 'boolean') setNotifSafetyExpiry(payload.safetyExpiry);
      if (typeof payload.safetyExpired === 'boolean') setNotifSafetyExpired(payload.safetyExpired);
    }

    // 1. localStorage
    try {
      const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        applyNotifPayload(parsed);
      }
    } catch {}

    // 2. Supabase — try notification_settings and user_settings (best-effort)
    (async () => {
      if (!isSupabaseConfigured || !supabase) return;
      try {
        const { data } = await supabase.from('notification_settings').select('*').eq('id', 'default').maybeSingle();
        if (data && !cancelled) {
          // Map Supabase columns to local payload shape where possible
          const supaPayload = {};
          if (Array.isArray(data.recipients)) {
            const emails = data.recipients.filter((r) => r && r.includes('@'));
            const phones = data.recipients.filter((r) => r && !r.includes('@'));
            if (emails.length) {
              supaPayload.recipients = {
                primaryEmail: emails[0] || '',
                additionalEmails: emails.slice(1).join(', '),
                whatsappNumbers: phones.join(', '),
              };
            }
          }
          if (typeof data.enabled === 'boolean') supaPayload.enabled = data.enabled;
          if (Array.isArray(data.reminder_days)) supaPayload.reminderDays = data.reminder_days.join(',');
          // AMC and safety flags if columns exist
          supaPayload.types = {};
          if (typeof data.amc_expiry_30d === 'boolean') supaPayload.types.amcExpiry = data.amc_expiry_30d;
          if (typeof data.amc_visit_overdue === 'boolean') supaPayload.types.amcOverdue = data.amc_visit_overdue;
          if (typeof data.pm_overdue === 'boolean') supaPayload.types.pmOverdue = data.pm_overdue;
          if (typeof data.safety_expiry_warning === 'boolean') supaPayload.types.safetyExpiry = data.safety_expiry_warning;
          if (typeof data.safety_expired === 'boolean') supaPayload.types.safetyExpired = data.safety_expired;
          if (Object.keys(supaPayload).length) applyNotifPayload(supaPayload);
        }
      } catch {}
      try {
        const uid = user?.id || 'default';
        const { data: udata } = await supabase.from('user_settings').select('*').eq('id', uid).maybeSingle();
        if (udata && !cancelled) {
          const candidate = udata.settings || udata.ccpl_notification_settings || udata.notification_settings || udata.data;
          if (candidate) {
            const parsed = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
            applyNotifPayload(parsed);
          } else if (udata.ccpl_notification_settings) {
            applyNotifPayload(udata.ccpl_notification_settings);
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const currentEnergy = getEnergySettings();
  const [energyEditing, setEnergyEditing] = useState(false);
  const [energyForm, setEnergyForm] = useState({
    u1ImportExportCt: currentEnergy.u1ImportExportCt ?? '',
    u1SolarCt: currentEnergy.u1SolarCt ?? '',
    u2ImportExportCt: currentEnergy.u2ImportExportCt ?? '',
    u2SolarCt: currentEnergy.u2SolarCt ?? '',
    pfWarningThreshold: currentEnergy.pfWarningThreshold ?? '',
    installedSolarCapacityKwp: currentEnergy.installedSolarCapacityKwp ?? '',
    gridCo2EmissionFactor: currentEnergy.gridCo2EmissionFactor ?? '',
    avgPeakSunHoursPerDay: currentEnergy.avgPeakSunHoursPerDay ?? '',
  });
  const [energySaved, setEnergySaved] = useState(false);

  const userName = user?.full_name || 'Admin';
  const isAdmin = user?.role === 'admin';

  const savePlant = (e) => {
    e.preventDefault();
    updateSettings({ plantName: plantName.trim() || 'Nathupur Formulation Plant' });
    logActivity(userName, 'updated plant settings', plantName.trim(), 'info');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleBackup = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ccpl-cmms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logActivity(userName, 'exported CMMS backup', '', 'info');
  };

  const handleRestore = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importBackup(reader.result);
        setRestoreMsg({ ok: true, text: 'Backup restored — all dashboards refreshed automatically.' });
        logActivity(userName, 'restored CMMS backup', file.name, 'info');
      } catch {
        setRestoreMsg({ ok: false, text: 'Invalid backup file. Please select a valid CMMS JSON export.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleReset = async () => {
    const confirmed = window.confirm('Clear all locally saved equipment records, breakdown logs, PM logs, uploads, and backups from this browser and restore the default machine master?');
    if (!confirmed) return;

    try {
      await clearReportVault();
      resetPersistentData();
      setPlantName('Nathupur Formulation Plant');
      setResetMsg({ ok: true, text: 'Persistent data cleared. The app has been restored to the default machine master and empty monthly logs.' });
    } catch {
      setResetMsg({ ok: false, text: 'Data reset could not complete. Please refresh and try again.' });
      return;
    }

    logActivity(userName, 'cleared persistent browser data', 'Restored default machine master and cleared monthly logs', 'warning');
  };

  const saveEnergy = () => {
    const numericForm = {};
    for (const [k, v] of Object.entries(energyForm)) {
      numericForm[k] = v === '' ? null : Number(v);
    }
    upsertEnergySettings(numericForm, userName);
    setEnergyEditing(false);
    setEnergySaved(true);
    setTimeout(() => setEnergySaved(false), 2500);
  };

  const DATA_ROWS = [
    { icon: Cog, label: 'Machines registered', value: store.machines.length, cls: 'text-cyan-400' },
    { icon: AlertOctagon, label: 'Breakdown summaries', value: store.breakdowns.length, cls: 'text-red-400' },
    { icon: ClipboardCheck, label: 'PM summaries', value: store.pms.length, cls: 'text-emerald-400' },
    { icon: Zap, label: 'Daily utility readings', value: store.dailyUtilityLog.length, cls: 'text-amber-400' },
    { icon: History, label: 'Activity records', value: store.activity.length, cls: 'text-violet-400' },
    { icon: DownloadCloud, label: 'Saved uploads', value: listReportMetadata().length, cls: 'text-cyan-400' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-page-title flex items-center gap-3">
          <SettingsIcon size={28} className="text-cyan-400" aria-hidden="true" />
          Settings
        </h2>
        <p className="text-body mt-1.5">Plant configuration, profile and data management</p>
      </div>

      {/* Plant profile */}
      <div className="glass-card p-5">
        <h3 className="text-card-title flex items-center gap-2 mb-4">
          <Factory size={15} className="text-cyan-400" aria-hidden="true" /> Plant Profile
        </h3>
        <form onSubmit={savePlant} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="set-plant" className="text-meta block mb-1.5">Plant Name</label>
              <input
                id="set-plant"
                type="text"
                className="input-field"
                value={plantName}
                onChange={(e) => setPlantName(e.target.value)}
                placeholder="e.g. Nathupur Formulation Plant"
                disabled={!isAdmin}
              />
              <p className="text-slate-500 text-[10px] mt-1.5">Shown in the dashboard welcome banner.</p>
            </div>
            <div>
              <label className="text-meta block mb-1.5">Company</label>
              <input type="text" className="input-field opacity-60" value={COMPANY_NAME} readOnly aria-label="Company name" />
              <p className="text-slate-500 text-[10px] mt-1.5">{UNIT_BADGE}</p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary text-xs">Save Changes</button>
              {saved && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs" role="status">
                  <CheckCircle2 size={13} aria-hidden="true" /> Saved — dashboard updated
                </span>
              )}
            </div>
          )}
        </form>
      </div>

      {/* Profile */}
      <div className="glass-card p-5">
        <h3 className="text-card-title flex items-center gap-2 mb-4">
          <User size={15} className="text-emerald-400" aria-hidden="true" /> Profile
        </h3>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-1 flex-1">
            <div>
              <p className="text-meta">Name</p>
              <p className="text-white text-sm font-semibold">{userName}</p>
            </div>
            <div>
              <p className="text-meta">Role</p>
              <p className="text-white text-sm font-semibold capitalize inline-flex items-center gap-1.5">
                <Shield size={12} className="text-cyan-400" aria-hidden="true" />
                {user?.role === 'admin' ? 'Administrator' : 'Viewer'}
              </p>
            </div>
            <div>
              <p className="text-meta">Department</p>
              <p className="text-white text-sm font-semibold">Maintenance & Reliability</p>
            </div>
          </div>
        </div>
      </div>

      {/* Data management */}
      <div className="glass-card p-5">
        <h3 className="text-card-title flex items-center gap-2 mb-4">
          <Database size={15} className="text-violet-400" aria-hidden="true" /> Data Management
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
          {DATA_ROWS.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.label} className="rounded-control bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <Icon size={16} className={`${r.cls} mx-auto mb-1.5`} aria-hidden="true" />
                <p className="text-white text-lg font-bold leading-none">{r.value}</p>
                <p className="text-slate-500 text-[10px] mt-1 leading-tight">{r.label}</p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleBackup} className="btn-primary inline-flex items-center gap-2 text-xs">
            <DownloadCloud size={14} aria-hidden="true" /> Export Backup (JSON)
          </button>
          {isAdmin && (
            <>
              <button onClick={() => fileRef.current?.click()} className="btn-ghost inline-flex items-center gap-2 text-xs">
                <UploadCloud size={14} aria-hidden="true" /> Restore Backup
              </button>
              <button onClick={handleReset} className="btn-danger inline-flex items-center gap-2 text-xs">
                <Trash2 size={14} aria-hidden="true" /> Reset / Clear Data
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleRestore} aria-label="Restore backup file" />
            </>
          )}
        </div>
        {restoreMsg && (
          <div
            className={`mt-3 rounded-control px-3 py-2 text-xs flex items-center gap-2 border ${
              restoreMsg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
            role="alert"
          >
            {restoreMsg.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
            {restoreMsg.text}
          </div>
        )}
        {resetMsg && (
          <div
            className={`mt-3 rounded-control px-3 py-2 text-xs flex items-center gap-2 border ${
              resetMsg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
            role="alert"
          >
            {resetMsg.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
            {resetMsg.text}
          </div>
        )}
        <p className="text-slate-500 text-[10px] mt-3 flex items-start gap-1.5">
          <Info size={11} className="mt-px flex-shrink-0" aria-hidden="true" />
          Equipment master data, monthly logs, and uploaded files are stored in persistent browser storage. They remain available after reloads and browser restarts until you clear them here. The JSON backup covers operational records; uploaded report files stay in the browser vault on this device.
        </p>
      </div>

      {/* Energy Configuration */}
      <div className="glass-card p-5">
        <h3 className="text-card-title flex items-center gap-2 mb-4">
          <Zap size={15} className="text-amber-400" aria-hidden="true" /> Energy Configuration
        </h3>
        {energyEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-meta block mb-1.5">U1 Import/Export CT Ratio</label>
                <input
                  type="number"
                  className="input-field text-xs w-full"
                  value={energyForm.u1ImportExportCt}
                  onChange={(e) => setEnergyForm({ ...energyForm, u1ImportExportCt: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">U1 Solar CT Ratio</label>
                <input
                  type="number"
                  className="input-field text-xs w-full"
                  value={energyForm.u1SolarCt}
                  onChange={(e) => setEnergyForm({ ...energyForm, u1SolarCt: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">U2 Import/Export CT Ratio</label>
                <input
                  type="number"
                  className="input-field text-xs w-full"
                  value={energyForm.u2ImportExportCt}
                  onChange={(e) => setEnergyForm({ ...energyForm, u2ImportExportCt: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">U2 Solar CT Ratio</label>
                <input
                  type="number"
                  className="input-field text-xs w-full"
                  value={energyForm.u2SolarCt}
                  onChange={(e) => setEnergyForm({ ...energyForm, u2SolarCt: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">PF Warning Threshold (0–1)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  className="input-field text-xs w-full"
                  value={energyForm.pfWarningThreshold}
                  onChange={(e) => setEnergyForm({ ...energyForm, pfWarningThreshold: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">Installed Solar Capacity (kWp)</label>
                <input
                  type="number"
                  className="input-field text-xs w-full"
                  value={energyForm.installedSolarCapacityKwp}
                  onChange={(e) => setEnergyForm({ ...energyForm, installedSolarCapacityKwp: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">Grid CO2 Emission Factor</label>
                <input
                  type="number"
                  step="0.01"
                  className="input-field text-xs w-full"
                  value={energyForm.gridCo2EmissionFactor}
                  onChange={(e) => setEnergyForm({ ...energyForm, gridCo2EmissionFactor: e.target.value })}
                />
              </div>
              <div>
                <label className="text-meta block mb-1.5">Avg Peak Sun Hours per Day</label>
                <input
                  type="number"
                  step="0.1"
                  className="input-field text-xs w-full"
                  value={energyForm.avgPeakSunHoursPerDay}
                  onChange={(e) => setEnergyForm({ ...energyForm, avgPeakSunHoursPerDay: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={saveEnergy} className="btn-primary text-xs inline-flex items-center gap-2">
                <CheckCircle2 size={13} aria-hidden="true" /> Save Energy Settings
              </button>
              <button onClick={() => setEnergyEditing(false)} className="btn-ghost text-xs">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
              {[
                { label: 'U1 Import/Export CT Ratio', value: currentEnergy.u1ImportExportCt },
                { label: 'U1 Solar CT Ratio', value: currentEnergy.u1SolarCt },
                { label: 'U2 Import/Export CT Ratio', value: currentEnergy.u2ImportExportCt },
                { label: 'U2 Solar CT Ratio', value: currentEnergy.u2SolarCt },
                { label: 'PF Warning Threshold', value: currentEnergy.pfWarningThreshold },
                { label: 'Installed Solar Capacity (kWp)', value: currentEnergy.installedSolarCapacityKwp },
                { label: 'Grid CO2 Emission Factor', value: currentEnergy.gridCo2EmissionFactor },
                { label: 'Avg Peak Sun Hours per Day', value: currentEnergy.avgPeakSunHoursPerDay },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between rounded-control bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                  <span className="text-slate-400 text-xs">{row.label}</span>
                  <span className="text-white text-sm font-semibold">{row.value ?? '—' }</span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="flex items-center gap-3 pt-1">
                <button onClick={() => setEnergyEditing(true)} className="btn-ghost text-xs inline-flex items-center gap-2">
                  <Cog size={13} aria-hidden="true" /> Edit
                </button>
                {energySaved && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs" role="status">
                    <CheckCircle2 size={13} aria-hidden="true" /> Saved
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notification Settings */}
      <div className="glass-card p-5">
        <h3 className="text-card-title flex items-center gap-2 mb-4">
          <Bell size={15} className="text-amber-400" aria-hidden="true" /> Notification Settings
        </h3>
        <div className="space-y-5">
          {/* Channels */}
          <div>
            <p className="text-meta mb-2">Channels</p>
            <div className="flex flex-wrap gap-3">
              {[
                { label: 'In-App', checked: notifInApp, onChange: setNotifInApp, icon: Bell },
                { label: 'Email', checked: notifEmail, onChange: setNotifEmail, icon: Mail },
                { label: 'WhatsApp', checked: notifWhatsApp, onChange: setNotifWhatsApp, icon: MessageSquare },
              ].map((ch) => (
                <label key={ch.label} className="flex items-center gap-2 rounded-control border border-white/[0.1] px-3 py-2 cursor-pointer hover:bg-white/[0.03] transition-colors">
                  <input type="checkbox" checked={ch.checked} onChange={(e) => ch.onChange(e.target.checked)} className="sr-only" />
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${ch.checked ? 'bg-cyan-500 border-cyan-500' : 'border-slate-500'}`}>
                    {ch.checked && <CheckCircle2 size={10} className="text-white" />}
                  </div>
                  <ch.icon size={13} className={ch.checked ? 'text-cyan-400' : 'text-slate-500'} />
                  <span className="text-xs text-slate-300">{ch.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Recipients */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-meta block mb-1">Primary Email</label>
              <input type="email" className="input-field text-xs w-full" value={notifPrimaryEmail} onChange={(e) => setNotifPrimaryEmail(e.target.value)} placeholder="admin@ccpl.com" />
            </div>
            <div>
              <label className="text-meta block mb-1">Additional Emails (comma-separated)</label>
              <input type="text" className="input-field text-xs w-full" value={notifAdditionalEmails} onChange={(e) => setNotifAdditionalEmails(e.target.value)} placeholder="user1@ccpl.com, user2@ccpl.com" />
            </div>
            <div>
              <label className="text-meta block mb-1">WhatsApp Numbers (comma-separated)</label>
              <input type="text" className="input-field text-xs w-full" value={notifWhatsAppNumbers} onChange={(e) => setNotifWhatsAppNumbers(e.target.value)} placeholder="+91-9876543210, +91-9123456780" />
            </div>
            <div>
              <label className="text-meta block mb-1">Reminder Windows (days before expiry)</label>
              <input type="text" className="input-field text-xs w-full" value={notifReminderDays} onChange={(e) => setNotifReminderDays(e.target.value)} placeholder="30,15,7,1" />
            </div>
          </div>

          {/* Notification Types */}
          <div>
            <p className="text-meta mb-2">Notification Types</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { label: 'AMC Expiry Warning', checked: notifAmcExpiry, onChange: setNotifAmcExpiry },
                { label: 'AMC Visit Overdue', checked: notifAmcOverdue, onChange: setNotifAmcOverdue },
                { label: 'AMC Expired', checked: notifAmcExpired, onChange: setNotifAmcExpired },
                { label: 'PM Overdue', checked: notifPmOverdue, onChange: setNotifPmOverdue },
                { label: 'Long-Running Breakdown', checked: notifBreakdownOpen, onChange: setNotifBreakdownOpen },
                { label: 'Safety Certificate Expiry Warning (30, 15, 7, 1 days prior)', checked: notifSafetyExpiry, onChange: setNotifSafetyExpiry },
                { label: 'Safety Certificate Expired', checked: notifSafetyExpired, onChange: setNotifSafetyExpired },
              ].map((nt) => (
                <label key={nt.label} className="flex items-center gap-2 rounded-control border border-white/[0.06] px-3 py-2 cursor-pointer hover:bg-white/[0.03] transition-colors">
                  <input type="checkbox" checked={nt.checked} onChange={(e) => nt.onChange(e.target.checked)} className="sr-only" />
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${nt.checked ? 'bg-cyan-500 border-cyan-500' : 'border-slate-500'}`}>
                    {nt.checked && <CheckCircle2 size={10} className="text-white" />}
                  </div>
                  <span className="text-xs text-slate-300">{nt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/[0.06]">
            <button
              onClick={async () => {
                const payload = {
                  enabled: notifEnabled,
                  channels: { inApp: notifInApp, email: notifEmail, whatsapp: notifWhatsApp },
                  recipients: {
                    primaryEmail: notifPrimaryEmail,
                    additionalEmails: notifAdditionalEmails,
                    whatsappNumbers: notifWhatsAppNumbers,
                  },
                  reminderDays: notifReminderDays,
                  types: {
                    amcExpiry: notifAmcExpiry,
                    amcOverdue: notifAmcOverdue,
                    amcExpired: notifAmcExpired,
                    pmOverdue: notifPmOverdue,
                    breakdownOpen: notifBreakdownOpen,
                    safetyExpiry: notifSafetyExpiry,
                    safetyExpired: notifSafetyExpired,
                  },
                };
                try {
                  localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(payload));
                } catch {}
                // Persist to Supabase notification_settings (best-effort)
                if (isSupabaseConfigured && supabase) {
                  try {
                    const recipientsArr = [notifPrimaryEmail, ...notifAdditionalEmails.split(',').map((s) => s.trim()).filter(Boolean), ...notifWhatsAppNumbers.split(',').map((s) => s.trim()).filter(Boolean)].filter(Boolean);
                    const reminderArr = notifReminderDays.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
                    await supabase.from('notification_settings').upsert({
                      id: 'default',
                      enabled: notifEnabled,
                      recipients: recipientsArr,
                      amc_expiry_30d: notifAmcExpiry,
                      amc_expiry_15d: notifAmcExpiry,
                      amc_expiry_7d: notifAmcExpiry,
                      amc_expiry_today: notifAmcExpiry,
                      amc_visit_overdue: notifAmcOverdue,
                      pm_overdue: notifPmOverdue,
                      breakdown_open_hours: notifBreakdownOpen ? 24 : 0,
                      reminder_days: reminderArr,
                      safety_expiry_warning: notifSafetyExpiry,
                      safety_expired: notifSafetyExpired,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'id' });
                  } catch {}
                  // Also persist to user_settings per spec (best-effort via RPC or upsert)
                  try {
                    const uid = user?.id || 'default';
                    await supabase.from('user_settings').upsert({
                      id: uid,
                      settings: payload,
                      ccpl_notification_settings: payload,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'id' });
                  } catch {}
                  // Fallback: try generic KV table if user_settings schema differs
                  try {
                    const uid2 = user?.id || 'default';
                    await supabase.from('user_settings').upsert({
                      id: uid2,
                      data: payload,
                    }, { onConflict: 'id' });
                  } catch {}
                }
                logActivity(userName, 'updated notification settings', `Enabled: ${notifEnabled}`, 'info');
                setNotifSaved(true);
                setTimeout(() => setNotifSaved(false), 2500);
              }}
              className="btn-primary text-xs inline-flex items-center gap-2"
            >
              <CheckCircle2 size={13} aria-hidden="true" /> Save Settings
            </button>
            <button
              onClick={async () => {
                const settings = {
                  notifEnabled,
                  notifInApp,
                  notifEmail,
                  notifWhatsApp,
                  notifPrimaryEmail,
                  notifAdditionalEmails,
                  notifWhatsAppNumbers,
                  notifReminderDays,
                };
                setNotifTestMsg({ ok: true, text: 'Dispatching test notification...' });
                try {
                  await sendTestNotification(settings, { pushToast });
                  setNotifTestMsg({ ok: true, text: 'Test notification queued. Check your configured channels.' });
                } catch (err) {
                  setNotifTestMsg({ ok: false, text: `Test failed: ${err.message || 'Unknown error'}` });
                }
                setTimeout(() => setNotifTestMsg(null), 5000);
              }}
              className="btn-ghost text-xs inline-flex items-center gap-2"
            >
              <Bell size={13} aria-hidden="true" /> Test Notification
            </button>
            {notifSaved && (
              <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs" role="status">
                <CheckCircle2 size={13} aria-hidden="true" /> Settings saved
              </span>
            )}
          </div>
          {notifTestMsg && (
            <div className={`rounded-control px-3 py-2 text-xs flex items-center gap-2 border ${
              notifTestMsg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`} role="alert">
              {notifTestMsg.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
              {notifTestMsg.text}
            </div>
          )}
          <p className="text-slate-500 text-[10px] flex items-start gap-1.5">
            <Info size={11} className="mt-px flex-shrink-0" aria-hidden="true" />
            Notifications are generated client-side from AMC, PM, and breakdown data. Email and WhatsApp delivery requires a configured Supabase Edge Function with provider credentials. In-app notifications appear on the Dashboard.
          </p>
        </div>
      </div>

      {/* About */}
      <div className="glass-card p-5">
        <h3 className="text-card-title flex items-center gap-2 mb-3">
          <Info size={15} className="text-slate-400" aria-hidden="true" /> About
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-meta">Application</p>
            <p className="text-white font-semibold mt-0.5">CCPL Maintenance Hub</p>
          </div>
          <div>
            <p className="text-meta">Version</p>
            <p className="text-white font-semibold mt-0.5">v{APP_VERSION}</p>
          </div>
          <div>
            <p className="text-meta">Modules</p>
            <p className="text-white font-semibold mt-0.5">Assets · WO · PM · Energy</p>
          </div>
          <div>
            <p className="text-meta">Analytics</p>
            <p className="text-white font-semibold mt-0.5">MTTR · MTBF · Availability</p>
          </div>
        </div>
      </div>
    </div>
  );
}
