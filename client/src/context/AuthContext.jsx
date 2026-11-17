import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api.js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { notifyRealtimeAuthChange } from '../store.js';
import { normalizeRole, ROLES } from '../lib/plantAccess.js';

const AuthContext = createContext(null);

const OFFLINE_SESSION_KEY = 'ccpl_offline_session';
// Marker set when the user authenticated via the Express API (/api/auth/login
// or a successful api.me() restore). writeToCloudNow() in store.js treats the
// presence of either key as "logged into the app" so imports are attempted
// and verified instead of being refused upfront.
const API_SESSION_KEY = 'ccpl_api_session';

function markApiSession(username) {
  try {
    sessionStorage.setItem(API_SESSION_KEY, JSON.stringify({ username, ts: Date.now() }));
  } catch {}
}

function clearApiSession() {
  try {
    sessionStorage.removeItem(API_SESSION_KEY);
  } catch {}
}
const NATHUPUR_ID = '00000000-0000-0000-0000-000000000001';

function enrichUser(raw) {
  if (!raw) return raw;
  const role = normalizeRole(raw.role);
  // Ensure plantIds always present for UI filtering (server-side RLS is real security)
  const plantIds = raw.plantIds || raw.plant_ids || raw.plant_ids === null ? (raw.plantIds || raw.plant_ids) : null;
  let resolvedIds = plantIds;
  if (!Array.isArray(resolvedIds) || !resolvedIds.length) {
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CORPORATE_HEAD].includes(role)) {
      resolvedIds = ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
    } else {
      resolvedIds = [NATHUPUR_ID];
    }
  }
  return { ...raw, role, plantIds: resolvedIds, plant_ids: resolvedIds };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Supabase auth state listener ────────────────────────────────────────
  // This is the most reliable way to keep the Realtime JWT current.
  // onAuthStateChange fires for: SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT.
  // We forward the access_token to the Realtime WebSocket each time.
  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        notifyRealtimeAuthChange(session?.access_token ?? null);
      }
    );

    // Also grab the current session immediately in case it was already
    // restored from localStorage before this effect ran.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        notifyRealtimeAuthChange(session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── App-level session restore (API only) ──────────────────────────────────
  useEffect(() => {
    api.me()
      .then((d) => {
        setUser(enrichUser(d.user));
        markApiSession(d.user?.username);
      })
      .catch(() => {
        setUser(null);
        clearApiSession();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const d = await api.login(username, password);
    sessionStorage.removeItem(OFFLINE_SESSION_KEY);
    markApiSession(d.user?.username || username);
    const enriched = enrichUser(d.user);
    setUser(enriched);
    return { ...d, user: enriched };
  };

  const logout = async () => {
    sessionStorage.removeItem(OFFLINE_SESSION_KEY);
    clearApiSession();
    await api.logout().catch(() => {});
    // Tear down the Realtime channel — notifyRealtimeAuthChange(null)
    // is also called by onAuthStateChange(SIGNED_OUT) if using Supabase Auth.
    notifyRealtimeAuthChange(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}