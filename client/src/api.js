const BASE = '/api';

async function parseResponseBody(res) {
  if (res.status === 204) {
    return null;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }

  return res.text();
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await parseResponseBody(res);

  if (!res.ok) {
    const message = typeof data === 'string' ? data : data?.error;
    throw new Error(message || `HTTP ${res.status}`);
  }

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

  uploadReport: async (formData, options = {}) => {
    const res = await fetch(`${BASE}/reports`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      let message = `Upload failed (${res.status})`;

      try {
        const parsed = JSON.parse(errorText);
        message = parsed?.error || message;
      } catch {
        message = errorText || message;
      }

      throw new Error(message);
    }

    options.onProgress?.(100);
    return parseResponseBody(res);
  },

  updateReport: (id, body) =>
    request(`/reports/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteReport: (id) =>
    request(`/reports/${id}`, { method: 'DELETE' }),
};
