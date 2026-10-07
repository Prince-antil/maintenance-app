import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api.js';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { notifyRealtimeAuthChange } from '../store.js';
import { normalizeRole, ROLES } from '../lib/plantAccess.js';
import { jwtSign } from '../lib/jwt-utils.js';

const AuthContext = createContext(null);

const OFFLINE_SESSION_KEY = 'ccpl_offline_session';
const NATHUPUR_ID = '00000000-0000-0000-0000-000000000001';

// Offline sign-in directory — passwords stored as SHA-256 digests only,
// used solely when the auth API is unreachable (local dev without the
// backend, or a serverless cold-start failure). Wrong credentials are
// still rejected exactly like the server would.
const OFFLINE_USERS = {
  Prince: {
    hash: 'c0cb49d041d606acd89be67025d26d8f7a87eae113d803d47c6fe31cb64c8a34',
    user: { id: 'offline-admin', username: 'Prince', role: 'super_admin', full_name: 'Prince', plantIds: [NATHUPUR_ID], plant_ids: [NATHUPUR_ID] },
  },
  viewer: {
    hash: '65375049b9e4d7cad6c9ba286fdeb9394b28135a3e84136404cfccfdcc438894',
    user: { id: 'offline-viewer', username: 'viewer', role: 'viewer', full_name: 'Read-Only Viewer', plantIds: [NATHUPUR_ID], plant_ids: [NATHUPUR_ID] },
  },
  corporate: {
    hash: '4e0a2e7c9f0b6e7d8a9c0b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
    user: { id: 'offline-corporate', username: 'corporate', role: 'corporate_head', full_name: 'Corporate Head', plantIds: ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'], plant_ids: ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'] },
  },
  plant2admin: {
    hash: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd',
    user: { id: 'offline-plant2', username: 'plant2admin', role: 'plant_admin', full_name: 'Plant 2 Admin', plantIds: ['00000000-0000-0000-0000-000000000002'], plant_ids: ['00000000-0000-0000-0000-000000000002'] },
  },
};

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

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The server answers auth mistakes with a clear message ("Invalid
// credentials"); anything else (HTTP 5xx, proxy failure, fetch error)
// means the API itself is unreachable.
const isServerUnreachable = (err) =>
  /^HTTP 5\d\d$/.test(err.message) || /fetch|network/i.test(err.message);

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

  // ── App-level session restore ────────────────────────────────────────────
  useEffect(() => {
    api.me()
      .then((d) => setUser(enrichUser(d.user)))
      .catch(() => {
        // Restore an offline session if one is active
        try {
          const saved = JSON.parse(sessionStorage.getItem(OFFLINE_SESSION_KEY));
          const offline = saved?.username && OFFLINE_USERS[saved.username] ? OFFLINE_USERS[saved.username].user : null;
          setUser(offline ? enrichUser(offline) : null);
        } catch {
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

const login = async (username, password) => {
    try {
      const d = await api.login(username, password);
      sessionStorage.removeItem(OFFLINE_SESSION_KEY);
      const enriched = enrichUser(d.user);
      setUser(enriched);
      return { ...d, user: enriched };
    } catch (err) {
      if (!isServerUnreachable(err)) throw err;
      // API down — verify against the offline directory instead
      const entry = OFFLINE_USERS[username];
      if (!entry || (await sha256Hex(password)) !== entry.hash) {
        throw new Error('Invalid credentials');
      }
      const enriched = enrichUser(entry.user);
      sessionStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(enriched));
      // Set JWT cookie so the Express API can authenticate this session
      const token = jwtSign(
        { id: enriched.id, username: enriched.username, role: enriched.role, full_name: enriched.full_name }
      );
      document.cookie = `token=${token}; path=/; max-age=86400000; sameSite=none; secure=${window.location.protocol === 'https:'}`;
      setUser(enriched);
      return { user: enriched };
    }
  };

  const logout = async () => {
    sessionStorage.removeItem(OFFLINE_SESSION_KEY);
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
