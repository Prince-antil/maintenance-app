/**
 * useEnergyCache - In-memory caching hook for energy data
 * Eliminates re-fetching on tab switches by caching data per module + period
 * Uses stale-while-revalidate pattern with 5-minute TTL
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '../store.js';

// In-memory cache with 5-minute TTL
const CACHE_TTL_MS = 5 * 60 * 1000;
const energyCache = new Map();

function getCacheKey(module, periodFilter) {
  return `${module}_${periodFilter || 'all'}`;
}

function isCacheValid(entry) {
  return entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS;
}

export function useEnergyCache() {
  const store = useStore();
  const [cacheState, setCacheState] = useState(() => {
    // Initialize with empty cache
    return { data: null, loading: false, error: null };
  });
  
  const loadingRef = useRef(false);
  const cacheKeyRef = useRef(null);

  const getCachedData = useCallback((module, periodFilter) => {
    const key = `${module}_${periodFilter || 'all'}`;
    const entry = energyCache.get(key);
    if (isCacheValid(entry)) {
      return entry.data;
    }
    return null;
  }, []);

  const setCachedData = useCallback((module, periodFilter, data) => {
    const key = `${module}_${periodFilter || 'all'}`;
    energyCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }, []);

  const invalidateCache = useCallback((module, periodFilter) => {
    if (module && periodFilter) {
      energyCache.delete(`${module}_${periodFilter}`);
    } else if (module) {
      // Invalidate all periods for this module
      for (const key of energyCache.keys()) {
        if (key.startsWith(`${module}_`)) {
          energyCache.delete(key);
        }
      }
    } else {
      // Invalidate all
      energyCache.clear();
    }
  }, []);

  const fetchWithCache = useCallback(async (module, periodFilter, fetcher) => {
    const key = `${module}_${periodFilter || 'all'}`;
    
    // Return cached data immediately if valid
    const cached = energyCache.get(key);
    if (isCacheValid(cached)) {
      return cached.data;
    }

    // Check if already fetching
    if (loadingRef.current && cacheKeyRef.current === key) {
      // Wait for ongoing fetch
      return new Promise(resolve => {
        const checkInterval = setInterval(() => {
          const entry = energyCache.get(key);
          if (entry && !loadingRef.current) {
            clearInterval(checkInterval);
            resolve(entry.data);
          }
        }, 50);
      });
    }

    loadingRef.current = true;
    cacheKeyRef.current = key;

    try {
      const data = await fetcher();
      energyCache.set(key, {
        data,
        timestamp: Date.now()
      });
      loadingRef.current = false;
      return data;
    } catch (error) {
      loadingRef.current = false;
      throw error;
    }
  }, []);

  return {
    getCachedData,
    setCachedData,
    invalidateCache,
    fetchWithCache
  };
}

// Memoized selectors for expensive aggregations
export function useMemoizedAggregations() {
  // These are pure functions that can be memoized at the module level
  // Actual memoization happens via useMemo in components
  return {
    // Solar aggregations
    solarTotals: (rows) => {
      if (!rows?.length) return { u1Total: 0, u2Total: 0, grandTotal: 0 };
      return rows.reduce((acc, row) => {
        const u1 = (row.u1Inv1Kwh || 0) + (row.u1Inv2Kwh || 0) + (row.u1Inv3Kwh || 0) + (row.u1Inv4Kwh || 0);
        const u2 = (row.u2Inv1Kwh || 0) + (row.u2Inv2Kwh || 0) + (row.u2Inv3Kwh || 0);
        return {
          u1Total: acc.u1Total + u1,
          u2Total: acc.u2Total + u2,
          grandTotal: acc.grandTotal + u1 + u2
        };
      }, { u1Total: 0, u2Total: 0, grandTotal: 0 });
    },

    // DG totals
    dgTotals: (rows) => {
      if (!rows?.length) return { dg380Total: 0, dg500Total: 0, totalDg: 0, totalHsd: 0 };
      return rows.reduce((acc, row) => ({
        dg380Total: acc.dg380Total + (row.dg380KwhReading || row.dg380 || 0),
        dg500Total: acc.dg500Total + (row.dg500KwhReading || row.dg500 || 0),
        totalDg: acc.totalDg + (row.dg380KwhReading || row.dg380 || 0) + (row.dg500KwhReading || row.dg500 || 0),
        totalHsd: acc.totalHsd + (row.dg380HsdAddedLtr || row.dg380Fuel || 0) + (row.dg500HsdAddedLtr || row.dg500Fuel || 0)
      }), { dg380Total: 0, dg500Total: 0, totalDg: 0, totalHsd: 0 });
    },

    // Grid totals
    gridTotals: (rows) => {
      if (!rows?.length) return { u1Import: 0, u2Import: 0, u1Export: 0, u2Export: 0, gridNet: 0 };
      return rows.reduce((acc, row) => ({
        u1Import: acc.u1Import + (row.u1ImportKwhReading || row.u1Import || 0),
        u2Import: acc.u2Import + (row.u2ImportKwhReading || row.u2Import || 0),
        u1Export: acc.u1Export + (row.u1ExportKwhReading || row.u1Export || 0),
        u2Export: acc.u2Export + (row.u2ExportKwhReading || row.u2Export || 0),
        gridNet: acc.gridNet + 
          (row.u1ImportKwhReading || row.u1Import || 0) - (row.u1ExportKwhReading || row.u1Export || 0) +
          (row.u2ImportKwhReading || row.u2Import || 0) - (row.u2ExportKwhReading || row.u2Export || 0)
      }), { u1Import: 0, u2Import: 0, u1Export: 0, u2Export: 0, gridNet: 0 });
    },

    // PF averages (weighted)
    pfAverages: (rows) => {
      if (!rows?.length) return { u1Pf: 0, u2Pf: 0, combinedPf: 0 };
      let u1Weighted = 0, u1ImportTotal = 0;
      let u2Weighted = 0, u2ImportTotal = 0;
      let combinedWeighted = 0, totalImport = 0;

      rows.forEach(row => {
        const u1Import = row.u1ImportKwhReading || row.u1Import || 0;
        const u2Import = row.u2ImportKwhReading || row.u2Import || 0;
        const u1Pf = row.u1Pf || 0;
        const u2Pf = row.u2Pf || 0;
        const combinedPf = row.combined_pf || row.avgPf || 0;

        if (u1Import > 0 && u1Pf > 0) { u1Weighted += u1Import * u1Pf; u1ImportTotal += u1Import; }
        if (u2Import > 0 && u2Pf > 0) { u2Weighted += u2Import * u2Pf; u2ImportTotal += u2Import; }
        if ((u1Import + u2Import) > 0 && combinedPf > 0) { 
          combinedWeighted += (u1Import + u2Import) * combinedPf; 
          totalImport += (u1Import + u2Import);
        }
      });

      return {
        u1Pf: u1ImportTotal > 0 ? u1Weighted / u1ImportTotal : 0,
        u2Pf: u2ImportTotal > 0 ? u2Weighted / u2ImportTotal : 0,
        combinedPf: totalImport > 0 ? combinedWeighted / totalImport : 0
      };
    }
  };
}

// Export memoized aggregation functions for direct use
export const memoizedAggregations = {
  solarTotals: (rows) => {
    if (!rows?.length) return { u1Total: 0, u2Total: 0, grandTotal: 0 };
    return rows.reduce((acc, row) => {
      const u1 = (row.u1Inv1Kwh || 0) + (row.u1Inv2Kwh || 0) + (row.u1Inv3Kwh || 0) + (row.u1Inv4Kwh || 0);
      const u2 = (row.u2Inv1Kwh || 0) + (row.u2Inv2Kwh || 0) + (row.u2Inv3Kwh || 0);
      return { u1Total: acc.u1Total + u1, u2Total: acc.u2Total + u2, grandTotal: acc.grandTotal + u1 + u2 };
    }, { u1Total: 0, u2Total: 0, grandTotal: 0 });
  },

  dgTotals: (rows) => {
    if (!rows?.length) return { dg380Total: 0, dg500Total: 0, totalDg: 0, totalHsd: 0 };
    return rows.reduce((acc, row) => ({
      dg380Total: acc.dg380Total + (row.dg380KwhReading || row.dg380 || 0),
      dg500Total: acc.dg500Total + (row.dg500KwhReading || row.dg500 || 0),
      totalDg: acc.totalDg + (row.dg380KwhReading || row.dg380 || 0) + (row.dg500KwhReading || row.dg500 || 0),
      totalHsd: acc.totalHsd + (row.dg380HsdAddedLtr || row.dg380Fuel || 0) + (row.dg500HsdAddedLtr || row.dg500Fuel || 0)
    }), { dg380Total: 0, dg500Total: 0, totalDg: 0, totalHsd: 0 });
  },

  gridTotals: (rows) => {
    if (!rows?.length) return { u1Import: 0, u2Import: 0, u1Export: 0, u2Export: 0, gridNet: 0 };
    return rows.reduce((acc, row) => ({
      u1Import: acc.u1Import + (row.u1ImportKwhReading || row.u1Import || 0),
      u2Import: acc.u2Import + (row.u2ImportKwhReading || row.u2Import || 0),
      u1Export: acc.u1Export + (row.u1ExportKwhReading || row.u1Export || 0),
      u2Export: acc.u2Export + (row.u2ExportKwhReading || row.u2Export || 0),
      gridNet: acc.gridNet + 
        (row.u1ImportKwhReading || row.u1Import || 0) - (row.u1ExportKwhReading || row.u1Export || 0) +
        (row.u2ImportKwhReading || row.u2Import || 0) - (row.u2ExportKwhReading || row.u2Export || 0)
    }), { u1Import: 0, u2Import: 0, u1Export: 0, u2Export: 0, gridNet: 0 });
  },

  pfAverages: (rows) => {
    if (!rows?.length) return { u1Pf: 0, u2Pf: 0, combinedPf: 0 };
    let u1Weighted = 0, u1ImportTotal = 0;
    let u2Weighted = 0, u2ImportTotal = 0;
    let combinedWeighted = 0, totalImport = 0;

    rows.forEach(row => {
      const u1Import = row.u1ImportKwhReading || row.u1Import || 0;
      const u2Import = row.u2ImportKwhReading || row.u2Import || 0;
      const u1Pf = row.u1Pf || 0;
      const u2Pf = row.u2Pf || 0;
      const combinedPf = row.combined_pf || row.avgPf || 0;

      if (u1Import > 0 && u1Pf > 0) { u1Weighted += u1Import * u1Pf; u1ImportTotal += u1Import; }
      if (u2Import > 0 && u2Pf > 0) { u2Weighted += u2Import * u2Pf; u2ImportTotal += u2Import; }
      if ((u1Import + u2Import) > 0 && combinedPf > 0) { 
        combinedWeighted += (u1Import + u2Import) * combinedPf; 
        totalImport += (u1Import + u2Import);
      }
    });

    return {
      u1Pf: u1ImportTotal > 0 ? u1Weighted / u1ImportTotal : 0,
      u2Pf: u2ImportTotal > 0 ? u2Weighted / u2ImportTotal : 0,
      combinedPf: totalImport > 0 ? combinedWeighted / totalImport : 0
    };
  }
};