/**
 * useEnergyStore - Global In-Memory Caching Hook
 * Provides instant client-side caching for energy data with 5-minute TTL
 * Eliminates page/tab switching latency
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { processUtilityRow, processSolarRow } from '../lib/energyEngine.js';

// Global cache storage (persists across component mounts)
const energyDataCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generates a cache key from table name and filter params
 */
function generateCacheKey(tableName, dateFilter) {
  const { startDate, endDate, period, ...rest } = dateFilter || {};
  return `${tableName}_${period || 'custom'}_${startDate || ''}_${endDate || ''}_${JSON.stringify(rest)}`;
}

/**
 * Checks if cached data is still valid
 */
function isCacheValid(cacheEntry) {
  if (!cacheEntry) return false;
  return Date.now() - cacheEntry.timestamp < CACHE_TTL_MS;
}

/**
 * Processes raw database rows based on table type
 */
function processRows(tableName, rows) {
  if (!rows || rows.length === 0) return [];
  
  if (tableName === 'daily_utility_log') {
    return rows.map(r => processUtilityRow({
      ...r,
      u1_import_kwh: r.u1_import_kwh_reading,
      u1_import_kvah: r.u1_import_kvah_reading,
      u1_export_kwh: r.u1_export_kwh_reading,
      u1_export_kvah: r.u1_export_kvah_reading,
      u1_solar_kwh: r.u1_solar_kwh_reading,
      u1_solar_kvah: r.u1_solar_kvah_reading,
      u2_import_kwh: r.u2_import_kwh_reading,
      u2_import_kvah: r.u2_import_kvah_reading,
      u2_export_kwh: r.u2_export_kwh_reading,
      u2_export_kvah: r.u2_export_kvah_reading,
      u2_solar_kwh: r.u2_solar_kwh_reading,
      u2_solar_kvah: r.u2_solar_kvah_reading,
      dg380_kwh: r.dg380_kwh_reading,
      dg380_hours: r.dg380_hourmeter_reading,
      dg380_hsd: r.dg380_hsd_added_ltr,
      dg380_def_pct: r.dg380_def_added_pct,
      dg500_kwh: r.dg500_kwh_reading,
      dg500_hours: r.dg500_hourmeter_reading,
      dg500_hsd: r.dg500_hsd_added_ltr,
      dg500_def_pct: r.dg500_def_added_pct
    }));
  } else if (tableName === 'daily_solar_generation') {
    return rows.map(r => processSolarRow(r));
  }
  return rows;
}

/**
 * Custom hook for cached energy data fetching
 * @param {string} tableName - Supabase table name ('daily_utility_log', 'daily_solar_generation', etc.)
 * @param {Object} dateFilter - Date filter { startDate, endDate, period }
 * @returns {Object} { data, loading, error, invalidateCache, refetch }
 */
export function useEnergyStore(tableName, dateFilter = {}) {
  const filterKey = generateCacheKey(tableName, dateFilter);
  const [data, setData] = useState(() => {
    // Initialize from cache if available
    const cached = energyDataCache.get(filterKey);
    return isCacheValid(cached) ? cached.data : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = energyDataCache.get(filterKey);
    return !isCacheValid(cached);
  });
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const fetchAbortRef = useRef(null);

  const fetchData = useCallback(async () => {
    const cached = energyDataCache.get(filterKey);
    if (isCacheValid(cached)) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      // Build Supabase query
      let query = supabase.from(tableName).select('*').order('date', { ascending: false });

      if (dateFilter.startDate && dateFilter.endDate) {
        query = query.gte('date', dateFilter.startDate).lte('date', dateFilter.endDate);
      } else if (dateFilter.period && dateFilter.period !== 'all') {
        // period is in format 'YYYY-MM'
        const start = `${dateFilter.period}-01`;
        const [year, month] = dateFilter.period.split('-').map(Number);
        const end = new Date(year, month, 0).toISOString().split('T')[0];
        query = query.gte('date', start).lte('date', end);
      }

      // Use abort signal for cleanup
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      const { data: dbData, error: dbError } = await query.abortSignal(controller.signal);

      if (!mountedRef.current) return;

      if (dbError) throw dbError;

      // Process rows through energy engine
      const processed = processRows(tableName, dbData || []);
      
      // Update cache
      energyDataCache.set(filterKey, {
        data: processed,
        timestamp: Date.now()
      });
      
      if (mountedRef.current) {
        setData(processed);
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // Ignore aborted requests
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch data');
        // Don't clear existing data on error - keep showing cached data
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [tableName, filterKey, dateFilter]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => {
      mountedRef.current = false;
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }
    };
  }, [fetchData]);

  // Invalidate cache for this filter key
  const invalidateCache = useCallback(() => {
    energyDataCache.delete(filterKey);
    fetchData();
  }, [filterKey, fetchData]);

  // Invalidate ALL energy caches (useful after data mutations)
  const invalidateAllCache = useCallback(() => {
    energyDataCache.clear();
    fetchData();
  }, [fetchData]);

  // Manual refetch
  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    invalidateCache,
    invalidateAllCache,
    refetch,
    cacheKey: filterKey
  };
}

/**
 * Hook for fetching multiple energy tables at once
 * @param {Array} queries - Array of { tableName, dateFilter }
 * @returns {Object} { dataMap, loading, errors, invalidateAll }
 */
export function useMultiEnergyStore(queries) {
  const [dataMap, setDataMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const newDataMap = {};
    const newErrors = {};

    await Promise.all(queries.map(async ({ tableName, dateFilter }) => {
      const filterKey = generateCacheKey(tableName, dateFilter);
      const cached = energyDataCache.get(filterKey);
      
      if (isCacheValid(cached)) {
        newDataMap[filterKey] = cached.data;
        return;
      }

      try {
        let query = supabase.from(tableName).select('*').order('date', { ascending: false });
        
        if (dateFilter.startDate && dateFilter.endDate) {
          query = query.gte('date', dateFilter.startDate).lte('date', dateFilter.endDate);
        } else if (dateFilter.period && dateFilter.period !== 'all') {
          const start = `${dateFilter.period}-01`;
          const [year, month] = dateFilter.period.split('-').map(Number);
          const end = new Date(year, month, 0).toISOString().split('T')[0];
          query = query.gte('date', start).lte('date', end);
        }

        const { data: dbData, error: dbError } = await query;
        
        if (dbError) throw dbError;
        
        const processed = processRows(tableName, dbData || []);
        energyDataCache.set(filterKey, { data: processed, timestamp: Date.now() });
        newDataMap[filterKey] = processed;
      } catch (err) {
        newErrors[filterKey] = err.message || 'Failed to fetch';
      }
    }));

    setDataMap(newDataMap);
    setErrors(newErrors);
    setLoading(false);
  }, [queries]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const invalidateAll = useCallback(() => {
    energyDataCache.clear();
    fetchAll();
  }, [fetchAll]);

  return { dataMap, loading, errors, invalidateAll };
}

/**
 * Preloads data into cache without rendering
 * @param {string} tableName - Supabase table name
 * @param {Object} dateFilter - Date filter
 */
export async function preloadEnergyData(tableName, dateFilter = {}) {
  const filterKey = generateCacheKey(tableName, dateFilter);
  const cached = energyDataCache.get(filterKey);
  
  if (isCacheValid(cached)) return cached.data;

  let query = supabase.from(tableName).select('*').order('date', { ascending: false });
  
  if (dateFilter.startDate && dateFilter.endDate) {
    query = query.gte('date', dateFilter.startDate).lte('date', dateFilter.endDate);
  } else if (dateFilter.period && dateFilter.period !== 'all') {
    const start = `${dateFilter.period}-01`;
    const [year, month] = dateFilter.period.split('-').map(Number);
    const end = new Date(year, month, 0).toISOString().split('T')[0];
    query = query.gte('date', start).lte('date', end);
  }

  const { data: dbData, error } = await query;
  if (error) throw error;

  const processed = processRows(tableName, dbData || []);
  energyDataCache.set(filterKey, { data: processed, timestamp: Date.now() });
  return processed;
}