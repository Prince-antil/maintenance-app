import { useMemo, useState, useEffect } from 'react';
import { useStore } from '../store.js';
import { buildAMCNotifications, buildTestingCertificateNotifications, aggregatePMRecords, summaryMonthKey } from '../analytics.js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';

function daysUntilExpiry(dateStr) {
  if (!dateStr) return 9999;
  const today = new Date(); today.setHours(0,0,0,0);
  const expiry = new Date(dateStr); expiry.setHours(0,0,0,0);
  return Math.ceil((expiry - today) / (1000*60*60*24));
}

function isIntervalVisible(daysLeft) {
  if (daysLeft == null) return false;
  if (daysLeft < 0) return true; // expired always visible
  if (daysLeft === 60) return true;
  if (daysLeft === 30) return true;
  if (daysLeft === 15) return true;
  if (daysLeft >= 0 && daysLeft <= 7) return true; // 7-day window
  return false;
}

function isBellVisible(daysLeft) {
  if (daysLeft == null) return false;
  // Bell shows every time if 45 or less (including expired)
  return daysLeft <= 45;
}

export function useComplianceAlerts() {
  const store = useStore();
  const [machineAlerts, setMachineAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [directAmc, setDirectAmc] = useState(null);
  const [directCerts, setDirectCerts] = useState(null);

  // Unified fetch per MASTER SPEC: query existing machines table, fallback to local, no 404s for missing amc_* tables
  useEffect(() => {
    let cancelled = false;
    const fetchAlerts = async () => {
      try {
        // Try Supabase machines table (exists) — per spec example, filter amc_expiry/testing_due_date
        if (isSupabaseConfigured && supabase) {
          try {
            const { data: machinesData, error } = await supabase.from('machines').select('*');
            if (!error && machinesData) {
              const today = new Date();
              const activeAlerts = (machinesData || [])
                .filter((m) => m.amc_expiry || m.testing_due_date || m.amcExpiry || m.testingDueDate)
                .map((m) => {
                  const expiryRaw = m.amc_expiry || m.testing_due_date || m.amcExpiry || m.testingDueDate;
                  const expiryDate = new Date(expiryRaw);
                  const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                  return {
                    id: m.id,
                    title: `AMC / Testing Due: ${m.name || m.code || m.machineCode || m.id}`,
                    type: m.amc_expiry || m.amcExpiry ? 'AMC' : 'Testing',
                    daysUntilExpiry,
                    daysLeft: daysUntilExpiry,
                    status: daysUntilExpiry <= 7 ? 'critical' : 'warning',
                    expiryDate: expiryRaw,
                    machineId: m.id,
                    ts: m.updated_at || m.created_at,
                  };
                })
                .filter((item) => item.daysUntilExpiry <= 45);
              if (!cancelled && activeAlerts.length > 0) {
                setMachineAlerts(activeAlerts);
                setDirectAmc(activeAlerts);
              } else if (!cancelled) {
                setMachineAlerts([]);
              }
            }
          } catch (err) {
            console.warn('Fallback compliance calculation:', err.message);
          }
        }
        // Also try valid Supabase tables amc_records/testing_certificates as secondary (no 404 for missing amc_subscriptions/logs)
        if (isSupabaseConfigured && supabase) {
          try {
            const { data: amcData } = await supabase.from('amc_records').select('*');
            if (!cancelled && amcData && amcData.length > 0) setDirectAmc(amcData);
          } catch {}
          try {
            const { data: certData } = await supabase.from('testing_certificates').select('*');
            if (!cancelled && certData && certData.length > 0) setDirectCerts(certData);
          } catch {}
        }
      } catch (err) {
        console.warn('Fallback compliance calculation:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAlerts();
    // Realtime for valid tables only
    if (isSupabaseConfigured && supabase) {
      const channel = supabase.channel('compliance-alerts-hook-v2');
      ['amc_records', 'testing_certificates', 'machines'].forEach((tbl) => {
        try {
          channel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, () => fetchAlerts());
        } catch {}
      });
      channel.subscribe();
      return () => {
        cancelled = true;
        try { supabase.removeChannel(channel); } catch {}
      };
    }
    setLoading(false);
    return () => { cancelled = true; };
  }, []);

  const amcSource = (directAmc && Array.isArray(directAmc) && directAmc.length > 0 && directAmc[0]?.contractEndDate) ? directAmc : store.amc;
  const certSource = (directCerts && directCerts.length > 0) ? directCerts : store.testingCertificates;
  const machines = store.machines || [];
  const pms = store.pms || [];

  const amcAlerts = useMemo(() => {
    const source = (amcSource && amcSource.length > 0) ? amcSource : store.amc;
    let raws = buildAMCNotifications(source, machines);
    if (raws.length === 0 && source && source.length > 0) {
      const today = new Date(); today.setHours(0,0,0,0);
      raws = source.filter((r) => {
        const expiry = r.contractEndDate || r.expiryDate || r.expiry_date;
        if (!expiry) return false;
        const days = Math.ceil((new Date(expiry).setHours(0,0,0,0) - today.getTime()) / 86400000);
        return days <= 45;
      }).map((r) => {
        const expiry = r.contractEndDate || r.expiryDate;
        const days = daysUntilExpiry(expiry);
        const machine = machines.find((m) => m.id === r.machineId);
        const machineName = machine?.name || r.machineId;
        return {
          id: `amc-fallback-${r.id}`,
          type: days < 0 ? 'danger' : days <= 7 ? 'danger' : 'warning',
          title: days < 0 ? 'AMC Expired' : `AMC Due in ${Math.abs(days)} Days`,
          detail: `AMC for ${machineName} ${days < 0 ? `expired ${Math.abs(days)} days ago` : `expires in ${days} days`}`,
          ts: r.updatedAt || r.createdAt,
          daysLeft: days,
          expiryDate: expiry,
        };
      });
    }
    return raws.map((n) => ({
      ...n,
      category: n.title?.includes('Visit') ? 'service' : 'amc',
      daysLeft: n.daysLeft ?? (() => {
        const expiry = n.expiryDate || n.detail?.match(/(\d{4}-\d{2}-\d{2})/)?.[0];
        if (expiry) return daysUntilExpiry(expiry);
        const m = n.detail?.match(/(\d+) days/);
        if (n.detail?.includes('expired')) return -1;
        if (n.detail?.includes('today')) return 0;
        return m ? Number(m[1]) : daysUntilExpiry(n.ts);
      })(),
      severity: n.type === 'danger' ? 'critical' : n.type === 'warning' ? 'warning' : 'info',
      expiryDate: n.expiryDate || n.ts,
    }));
  }, [amcSource, machines, store.amc]);

  const certAlerts = useMemo(() => {
    const source = (certSource && certSource.length > 0) ? certSource : store.testingCertificates;
    let raws = buildTestingCertificateNotifications(source, machines);
    if (raws.length === 0 && source && source.length > 0) {
      const today = new Date(); today.setHours(0,0,0,0);
      raws = source.filter((c) => {
        const expiry = c.expiryDate || c.expiry_date;
        if (!expiry) return false;
        const days = Math.ceil((new Date(expiry).setHours(0,0,0,0) - today.getTime()) / 86400000);
        return days <= 45;
      }).map((c) => {
        const expiry = c.expiryDate || c.expiry_date;
        const days = daysUntilExpiry(expiry);
        const machine = machines.find((m) => m.id === c.machineId);
        const machineName = machine?.name || c.machineName || c.machineId;
        return {
          id: `cert-fallback-${c.id}`,
          type: days < 0 ? 'danger' : days <= 7 ? 'danger' : 'warning',
          title: days < 0 ? 'Safety Certificate Expired' : `Safety Certificate Due in ${Math.abs(days)} Days`,
          detail: `${c.certificateType || 'Certificate'} (${c.certificateNumber || ''}) for ${machineName} ${days < 0 ? `expired ${Math.abs(days)} days ago` : `expires in ${days} days`}`,
          ts: c.updatedAt || c.createdAt,
          daysLeft: days,
          expiryDate: expiry,
        };
      });
    }
    return raws.map((n) => ({
      ...n,
      category: 'cert',
      severity: n.type === 'danger' ? 'critical' : n.type === 'warning' ? 'warning' : 'info',
    }));
  }, [certSource, machines, store.testingCertificates]);

  const pmAlerts = useMemo(() => {
    // Universal: show all PM pending across all months, not just current month
    const pendingAll = (pms || []).filter((r) => (r.pendingCount || 0) > 0);
    // Sort by period descending (most recent first) to show relevant overdue first
    const sorted = [...pendingAll].sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    const list = sorted.slice(0, 10);
    return list.map((r) => {
      const isOverdue = (() => {
        const k = summaryMonthKey(r);
        const cur = new Date().toISOString().slice(0, 7);
        return k && k < cur;
      })();
      return {
        id: `pm-${r.id}`,
        category: 'pm',
        type: isOverdue ? 'danger' : 'warning',
        severity: isOverdue ? 'critical' : 'warning',
        title: isOverdue ? 'PM Overdue' : 'PM Pending',
        detail: `${r.section} • ${r.pendingCount} pending — ${r.period || 'Unknown'}`,
        asset: r.section,
        vendor: '',
        expiryDate: r.period,
        daysLeft: isOverdue ? -1 : 10,
        ts: r.updatedAt || r.createdAt,
      };
    });
  }, [pms]);

  const allAlerts = useMemo(() => {
    const combined = [...amcAlerts, ...certAlerts, ...pmAlerts, ...machineAlerts];
    return combined.sort((a, b) => (a.daysLeft ?? a.daysUntilExpiry ?? 999) - (b.daysLeft ?? b.daysUntilExpiry ?? 999) || new Date(b.ts) - new Date(a.ts));
  }, [amcAlerts, certAlerts, pmAlerts, machineAlerts]);

  // Bell shows every time if 45 or less (including expired) — universal
  const bellAlerts = useMemo(() => allAlerts.filter((a) => isBellVisible(a.daysLeft ?? a.daysUntilExpiry)), [allAlerts]);
  // Pop-up / dropdown visible on intervals: 60,30,15, 7-day window, expired always
  const intervalAlerts = useMemo(() => allAlerts.filter((a) => isIntervalVisible(a.daysLeft ?? a.daysUntilExpiry)), [allAlerts]);

  const counts = useMemo(() => ({
    total: bellAlerts.length,
    amc: bellAlerts.filter((a) => a.category === 'amc' || a.type === 'AMC').length,
    cert: bellAlerts.filter((a) => a.category === 'cert').length,
    pm: bellAlerts.filter((a) => a.category === 'pm').length,
    critical: bellAlerts.filter((a) => (a.daysLeft ?? a.daysUntilExpiry) != null && (a.daysLeft ?? a.daysUntilExpiry) < 7).length,
    intervalTotal: intervalAlerts.length,
  }), [bellAlerts, intervalAlerts]);

  return {
    allAlerts: bellAlerts,
    alerts: bellAlerts,
    intervalAlerts,
    bellAlerts,
    amcAlerts,
    certAlerts,
    pmAlerts,
    counts,
    activeCount: bellAlerts.length,
    intervalCount: intervalAlerts.length,
    loading,
    machines,
    amcSource,
    certSource,
  };
}

export default useComplianceAlerts;
