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
              if (!cancelled && full) setDirectAmc(full);
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
              if (!cancelled && full) setDirectCerts(full);
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

  const amcSource = directAmc ?? store.amc;
  const certSource = directCerts ?? store.testingCertificates;
  const machines = store.machines || [];
  const pms = store.pms || [];

  const amcAlerts = useMemo(() => {
    const raws = buildAMCNotifications(amcSource, machines);
    return raws.map((n) => ({
      ...n,
      category: n.title?.includes('Visit') ? 'service' : 'amc',
      daysLeft: (() => {
        const m = n.detail?.match(/(\d+) days/);
        if (n.detail?.includes('expired')) return -1;
        if (n.detail?.includes('today')) return 0;
        return m ? Number(m[1]) : daysUntilExpiry(n.ts);
      })(),
      severity: n.type === 'danger' ? 'critical' : n.type === 'warning' ? 'warning' : 'info',
    }));
  }, [amcSource, machines]);

  const certAlerts = useMemo(() => {
    const raws = buildTestingCertificateNotifications(certSource, machines);
    return raws.map((n) => ({
      ...n,
      category: 'cert',
      severity: n.type === 'danger' ? 'critical' : n.type === 'warning' ? 'warning' : 'info',
    }));
  }, [certSource, machines]);

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
