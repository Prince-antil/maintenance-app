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

  // Direct Supabase fetch for AMC/testing certificates with fallback and no 404 console errors
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    const fetchDirect = async () => {
      try {
        // Fetch AMC from existing valid table only to avoid 404s (amc_subscriptions/amc_logs do not exist)
        const fetchAmcAlerts = async () => {
          try {
            const { data, error } = await supabase.from('amc_records').select('*');
            if (error) throw error;
            if (!cancelled && data && data.length > 0) setDirectAmc(data);
            else if (!cancelled) setDirectAmc(null);
            return;
          } catch (err) {
            console.warn('Fallback to local/machines schema for AMC data:', err.message);
            // Fallback: try machines table as per spec example (no 404)
            try {
              const { data: mData, error: mErr } = await supabase.from('machines').select('*').limit(5);
              if (!mErr && mData) {
                // No AMC data in machines, just use local store
                if (!cancelled) setDirectAmc(null);
              }
            } catch {}
            if (!cancelled) setDirectAmc(null);
          }
        };
        const fetchCerts = async () => {
          try {
            const { data, error } = await supabase.from('testing_certificates').select('*');
            if (error) throw error;
            if (!cancelled && data && data.length > 0) setDirectCerts(data);
            else if (!cancelled) setDirectCerts(null);
          } catch (err) {
            console.warn('Fallback to local store for Testing Certificates:', err.message);
            if (!cancelled) setDirectCerts(null);
          }
        };
        await Promise.all([fetchAmcAlerts(), fetchCerts()]);
      } catch {}
    };
    fetchDirect();
    // Realtime subscription only for existing tables to avoid 404s
    const channel = supabase.channel('compliance-alerts-hook');
    ['amc_records', 'testing_certificates'].forEach((tbl) => {
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
