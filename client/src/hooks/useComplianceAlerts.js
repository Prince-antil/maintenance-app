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

export function useComplianceAlerts() {
  const store = useStore();
  const [directAmc, setDirectAmc] = useState(null);
  const [directCerts, setDirectCerts] = useState(null);

  // Direct Supabase fetch for amc_subscriptions / testing_certificates (spec) with realtime sync
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    const fetchDirect = async () => {
      try {
        // Try spec table names first, fallback to existing store tables
        const amcTables = ['amc_subscriptions', 'amc_logs', 'amc_records'];
        for (const tbl of amcTables) {
          try {
            const { data, error } = await supabase.from(tbl).select('*').limit(1);
            if (!error && data) {
              const { data: full } = await supabase.from(tbl).select('*');
              if (!cancelled && full && full.length > 0) setDirectAmc(full);
              else if (!cancelled) setDirectAmc(null);
              break;
            }
          } catch {}
        }
        const certTables = ['testing_certificates', 'testing_certificates'];
        for (const tbl of certTables) {
          try {
            const { data, error } = await supabase.from(tbl).select('*').limit(1);
            if (!error && data) {
              const { data: full } = await supabase.from(tbl).select('*');
              if (!cancelled && full && full.length > 0) setDirectCerts(full);
              else if (!cancelled) setDirectCerts(null);
              break;
            }
          } catch {}
        }
      } catch {}
    };
    fetchDirect();
    // Realtime subscription for amc and certs
    const channel = supabase.channel('compliance-alerts-hook');
    ['amc_records', 'amc_subscriptions', 'amc_logs', 'testing_certificates'].forEach((tbl) => {
      try {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, () => fetchDirect());
      } catch {}
    });
    channel.subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch {}
    };
  }, []);

  const amcSource = (directAmc && directAmc.length > 0) ? directAmc : store.amc;
  const certSource = (directCerts && directCerts.length > 0) ? directCerts : store.testingCertificates;
  const machines = store.machines || [];
  const pms = store.pms || [];

  const amcAlerts = useMemo(() => {
    // Use direct source with fallback to store, without over-filtering at query level
    const source = (amcSource && amcSource.length > 0) ? amcSource : store.amc;
    // Include all entries where Days Remaining <=30 or status Overdue/Due Soon via buildAMCNotifications
    // Fallback: if buildAMCNotifications returns empty due to strict status, compute directly
    let raws = buildAMCNotifications(source, machines);
    if (raws.length === 0 && source && source.length > 0) {
      // Fallback: manually include all where daysRemaining <=30 or overdue
      const today = new Date(); today.setHours(0,0,0,0);
      raws = source.filter((r) => {
        const expiry = r.contractEndDate || r.expiryDate || r.expiry_date;
        if (!expiry) return false;
        const days = Math.ceil((new Date(expiry).setHours(0,0,0,0) - today.getTime()) / 86400000);
        return days <= 30;
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
        // Prefer expiryDate if available, else parse detail
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
        return days <= 30;
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
    const currentKey = new Date().toISOString().slice(0, 7);
    const pending = (pms || []).filter((r) => (r.pendingCount || 0) > 0);
    const overdue = pending.filter((r) => {
      const k = summaryMonthKey(r);
      return k && k < currentKey;
    });
    const list = (overdue.length ? overdue : pending).slice(0, 5);
    return list.map((r) => ({
      id: `pm-${r.id}`,
      category: 'pm',
      type: 'warning',
      severity: 'warning',
      title: 'PM Overdue',
      detail: `${r.section} • ${r.pendingCount} pending — ${r.period || currentKey}`,
      asset: r.section,
      vendor: '',
      expiryDate: r.period,
      daysLeft: 5,
      ts: r.updatedAt || r.createdAt,
    }));
  }, [pms]);

  const allAlerts = useMemo(() => {
    const combined = [...amcAlerts, ...certAlerts, ...pmAlerts];
    return combined.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || new Date(b.ts) - new Date(a.ts));
  }, [amcAlerts, certAlerts, pmAlerts]);

  const counts = useMemo(() => ({
    total: allAlerts.length,
    amc: amcAlerts.length,
    cert: certAlerts.length,
    pm: pmAlerts.length,
    critical: allAlerts.filter((a) => a.daysLeft != null && a.daysLeft < 7).length,
  }), [allAlerts, amcAlerts, certAlerts, pmAlerts]);

  return {
    allAlerts,
    amcAlerts,
    certAlerts,
    pmAlerts,
    counts,
    machines,
    amcSource,
    certSource,
  };
}

export default useComplianceAlerts;
