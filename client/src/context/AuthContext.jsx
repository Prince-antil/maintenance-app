import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

const OFFLINE_SESSION_KEY = 'ccpl_offline_session';

// Offline sign-in directory — passwords stored as SHA-256 digests only,
// used solely when the auth API is unreachable (local dev without the
// backend, or a serverless cold-start failure). Wrong credentials are
// still rejected exactly like the server would.
const OFFLINE_USERS = {
  Prince: {
    hash: 'c0cb49d041d606acd89be67025d26d8f7a87eae113d803d47c6fe31cb64c8a34',
    user: { id: 'offline-admin', username: 'Prince', role: 'admin', full_name: 'Prince' },
  },
  viewer: {
    hash: '65375049b9e4d7cad6c9ba286fdeb9394b28135a3e84136404cfccfdcc438894',
    user: { id: 'offline-viewer', username: 'viewer', role: 'viewer', full_name: 'Read-Only Viewer' },
  },
};

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

  useEffect(() => {
    api.me()
      .then((d) => setUser(d.user))
      .catch(() => {
        // Restore an offline session if one is active
        try {
          const saved = JSON.parse(sessionStorage.getItem(OFFLINE_SESSION_KEY));
          setUser(saved?.username && OFFLINE_USERS[saved.username] ? saved : null);
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
      setUser(d.user);
      return d;
    } catch (err) {
      if (!isServerUnreachable(err)) throw err;
      // API down — verify against the offline directory instead
      const entry = OFFLINE_USERS[username];
      if (!entry || (await sha256Hex(password)) !== entry.hash) {
        throw new Error('Invalid credentials');
      }
      sessionStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(entry.user));
      setUser(entry.user);
      return { user: entry.user };
    }
  };

  const logout = async () => {
    sessionStorage.removeItem(OFFLINE_SESSION_KEY);
    await api.logout().catch(() => {});
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
