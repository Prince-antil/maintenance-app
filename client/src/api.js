const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  logout: () => request('/auth/logout', { method: 'POST' }),

  me: () => request('/auth/me'),

  getReports: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports${qs ? '?' + qs : ''}`);
  },

  getCategories: () => request('/reports/categories'),

  getRecent: () => request('/reports/recent'),

  getMeta: () => request('/reports/meta'),

  getReport: (id) => request(`/reports/${id}`),

  uploadReport: (formData) =>
    fetch(`${BASE}/reports`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data;
    }),

  updateReport: (id, body) =>
    request(`/reports/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteReport: (id) =>
    request(`/reports/${id}`, { method: 'DELETE' }),
};
