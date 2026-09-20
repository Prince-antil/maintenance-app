import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { loadLS, saveLS } from '../utils.js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { useAuth } from './AuthContext.jsx';

const PlantContext = createContext(null);

const PLANT_LS_KEY = 'ccpl_current_plant_id';
const PLANTS_LS_KEY = 'ccpl_plants_cache';

// ── Fallback plants (local / offline mode) ──────────────────────────────────
export const FALLBACK_PLANTS = [
  { id: '00000000-0000-0000-0000-000000000001', plant_code: 'NATHUPUR', plant_name: 'Nathupur Plant', location: 'Nathupur, Haryana', description: 'Crystal Crop Protection Ltd. — Nathupur Formulation Plant', active: true },
  { id: '00000000-0000-0000-0000-000000000002', plant_code: 'PLANT2', plant_name: 'Plant 2', location: '', description: 'Configurable — rename from Plant Management', active: true },
  { id: '00000000-0000-0000-0000-000000000003', plant_code: 'PLANT3', plant_name: 'Plant 3', location: '', description: 'Configurable — rename from Plant Management', active: true },
];

export const NATHUPUR_PLANT_ID = FALLBACK_PLANTS[0].id;

// ── Helpers ─────────────────────────────────────────────────────────────────
function plantsFromCache() {
  const cached = loadLS(PLANTS_LS_KEY, null);
  if (Array.isArray(cached) && cached.length) return cached;
  return FALLBACK_PLANTS;
}

function currentIdFromCache(plants) {
  const saved = loadLS(PLANT_LS_KEY, null);
  if (saved && plants.some((p) => p.id === saved)) return saved;
  return plants[0]?.id || NATHUPUR_PLANT_ID;
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function PlantProvider({ children }) {
  const { user } = useAuth();
  const [plants, setPlants] = useState(() => plantsFromCache());
  const [currentPlantId, setCurrentPlantId] = useState(() => currentIdFromCache(plantsFromCache()));
  const [loading, setLoading] = useState(false);

  // Fetch plants from Supabase when configured
  const fetchPlants = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('plants')
        .select('*')
        .eq('active', true)
        .order('plant_code', { ascending: true });
      if (error) throw error;
      if (Array.isArray(data) && data.length) {
        setPlants(data);
        saveLS(PLANTS_LS_KEY, data);
        // If current selection is no longer valid, reset to first
        const ids = new Set(data.map((p) => p.id));
        if (!ids.has(currentPlantId)) {
          const fallback = data[0].id;
          setCurrentPlantId(fallback);
          saveLS(PLANT_LS_KEY, fallback);
        }
      }
    } catch (e) {
      console.warn('[PlantContext] fetch failed, using cache:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [currentPlantId]);

  useEffect(() => {
    fetchPlants();
  }, [fetchPlants]);

  // Also re-fetch when user changes (different access may expose different plants)
  useEffect(() => {
    if (user) fetchPlants();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist current plant to LS + set on change
  const setCurrentPlant = useCallback((plantId) => {
    if (!plantId) return;
    // Security: verify user has access to this plant before switching
    // Corporate / super_admin bypass handled in selector UI; still enforce here
    const target = plants.find((p) => p.id === plantId);
    if (!target) return;
    setCurrentPlantId(plantId);
    saveLS(PLANT_LS_KEY, plantId);
  }, [plants]);

  // Derived: current plant object
  const currentPlant = useMemo(
    () => plants.find((p) => p.id === currentPlantId) || plants[0] || FALLBACK_PLANTS[0],
    [plants, currentPlantId]
  );

  // Plants the current user is authorized to see (client-side UX filtering only;
  // real security is enforced server-side via RLS — this just controls dropdown)
  const authorizedPlants = useMemo(() => {
    if (!user) return plants;
    const role = user.role || 'plant_user';
    // Super admin / corporate sees all plants
    if (['super_admin', 'corporate_head', 'admin'].includes(role)) return plants;
    // Plant-scoped users: filter by user_plant_access if available
    const allowedIds = user.plantIds || user.plant_ids || null;
    if (Array.isArray(allowedIds) && allowedIds.length) {
      return plants.filter((p) => allowedIds.includes(p.id));
    }
    // No explicit mapping — fall back to Nathupur only (safe default)
    // For backwards compat with existing viewer/admin that has no plant mapping
    return plants.filter((p) => p.id === NATHUPUR_PLANT_ID);
  }, [plants, user]);

  // Ensure currentPlant is authorized — if not, auto-switch to first authorized
  useEffect(() => {
    if (!authorizedPlants.length) return;
    const isAuthorized = authorizedPlants.some((p) => p.id === currentPlantId);
    if (!isAuthorized) {
      const fallback = authorizedPlants[0].id;
      setCurrentPlantId(fallback);
      saveLS(PLANT_LS_KEY, fallback);
    }
  }, [authorizedPlants, currentPlantId]);

  // Refresh plants list (called after admin creates/renames a plant)
  const refreshPlants = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      await fetchPlants();
    } else {
      const cached = loadLS(PLANTS_LS_KEY, FALLBACK_PLANTS);
      setPlants(cached);
    }
  }, [fetchPlants]);

  // Create/update plant (admin)
  const upsertPlant = useCallback(async (payload) => {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from('plants').upsert(payload, { onConflict: 'plant_code' }).select().single();
      if (error) throw error;
      await refreshPlants();
      return data;
    }
    // Offline: persist to LS cache
    const next = [...plants];
    const idx = next.findIndex((p) => p.plant_code === payload.plant_code || p.id === payload.id);
    const record = { id: payload.id || `local-${Date.now()}`, active: true, ...payload };
    if (idx >= 0) next[idx] = { ...next[idx], ...record };
    else next.push(record);
    setPlants(next);
    saveLS(PLANTS_LS_KEY, next);
    return record;
  }, [plants, refreshPlants]);

  const value = useMemo(() => ({
    plants,
    authorizedPlants,
    currentPlant,
    currentPlantId,
    setCurrentPlant,
    loading,
    refreshPlants,
    upsertPlant,
    isNathupur: currentPlantId === NATHUPUR_PLANT_ID,
  }), [plants, authorizedPlants, currentPlant, currentPlantId, setCurrentPlant, loading, refreshPlants, upsertPlant]);

  return (
    <PlantContext.Provider value={value}>
      {children}
    </PlantContext.Provider>
  );
}

export function usePlant() {
  const ctx = useContext(PlantContext);
  if (!ctx) throw new Error('usePlant must be used within PlantProvider');
  return ctx;
}

export default PlantContext;
