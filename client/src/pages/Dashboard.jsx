// =============================================================================
// File: pages/Dashboard.jsx
// =============================================================================
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { computeEnergySnapshot } from '../lib/energyEngine.js';
import { EnergySnapshotCard } from '../components/dashboard/EnergySnapshotCard.jsx';

export default function Dashboard() {
  const [utilityRows, setUtilityRows] = useState([]);
  const [solarRows, setSolarRows] = useState([]);
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        let uData = [];
        let sData = [];
        // Try local storage cache first (safe, no window.supabase)
        try {
          const uCache = localStorage.getItem('daily_utility_log');
          if (uCache) uData = JSON.parse(uCache);
        } catch {}
        try {
          const sCache = localStorage.getItem('daily_solar_generation');
          if (sCache) sData = JSON.parse(sCache);
        } catch {}
        // Also try CCPL keys for backwards compat
        if (uData.length === 0) {
          try {
            const alt = localStorage.getItem('CCPL_DAILY_UTILITY_LOG_V1');
            if (alt) {
              const parsed = JSON.parse(alt);
              if (Array.isArray(parsed) && parsed.length > 0) uData = parsed;
            }
          } catch {}
        }
        if (sData.length === 0) {
          try {
            const alt = localStorage.getItem('CCPL_DAILY_SOLAR_GENERATION_V1');
            if (alt) {
              const parsed = JSON.parse(alt);
              if (Array.isArray(parsed) && parsed.length > 0) sData = parsed;
            }
          } catch {}
        }
        // Fetch from Supabase if client exists (imported instance, not window.supabase)
        if (supabase) {
          try {
            const { data: uRes } = await supabase.from('daily_utility_log').select('*');
            if (uRes && uRes.length > 0) uData = uRes;
          } catch {}
          try {
            const { data: sRes } = await supabase.from('daily_solar_generation').select('*');
            if (sRes && sRes.length > 0) sData = sRes;
          } catch {}
        }
        if (isMounted) {
          setUtilityRows(uData);
          setSolarRows(sData);
        }
      } catch (err) {
        console.error('Failed loading dashboard energy data:', err);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);
  const snapshotMetrics = computeEnergySnapshot(utilityRows, solarRows);
  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-screen text-slate-100">
      <EnergySnapshotCard snapshotMetrics={snapshotMetrics} />
    </div>
  );
}
