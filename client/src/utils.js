// ================================================================
// CCPL CMMS — Shared UI Utilities
// ================================================================

export function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr.endsWith?.('Z') ? dateStr : dateStr + 'Z');
  if (isNaN(d)) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatExt(ext) {
  return ext?.replace('.', '').toUpperCase() || '';
}

export function formatDateLong(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export const cleanText = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/┬À/g, '•')
    .replace(/┬—/g, '—')
    .replace(/ÔÇÖ/g, "'")
    .replace(/ÔÇ/g, "'")
    .replace(/fæï/g, '')
    .replace(/'ö/g, ' — ')
    .replace(/ö/g, '—')
    .replace(/[\u007F-\u009F\u00AD]/g, '')
    .replace(/\s*•\s*/g, ' • ')
    .replace(/\s*—\s*/g, ' — ');
};

// localStorage helpers with JSON safety
export function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

// Export an array of row objects to CSV (opens in Excel)
export function exportToCSV(rows, columns, filename = 'export.csv') {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((c) => `"${String(c.value ? c.value(row) : row[c.key] ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
