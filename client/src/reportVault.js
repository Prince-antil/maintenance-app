import { loadLS, saveLS } from './utils.js';

const REPORT_INDEX_KEY = 'REPORT_REPOSITORY_INDEX';
const DB_NAME = 'ccpl-report-vault';
const STORE_NAME = 'reports';
const DB_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function openVault() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open report vault'));
  });
}

function runTransaction(mode, work) {
  return openVault().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = work(store);

    tx.oncomplete = () => {
      db.close();
      resolve(request?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || request?.error || new Error('Report vault transaction failed'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Report vault transaction aborted'));
    };
  }));
}

function loadIndex() {
  return loadLS(REPORT_INDEX_KEY, []);
}

function saveIndex(records) {
  saveLS(REPORT_INDEX_KEY, records);
}

function normalizeRecord(record) {
  return {
    id: record.id,
    filename: record.filename || 'Untitled file',
    category_name: record.category_name || '',
    reporting_month: record.reporting_month || '',
    reporting_year: Number(record.reporting_year) || new Date().getFullYear(),
    plant_section: record.plant_section || '',
    file_format: record.file_format || '',
    uploaded_at: record.uploaded_at || nowIso(),
    uploader_name: record.uploader_name || record.uploaded_by || 'System',
    localOnly: Boolean(record.localOnly),
    server_file_url: record.server_file_url || '',
    mime_type: record.mime_type || '',
    file_size: Number(record.file_size) || 0,
    source: record.source || 'local-vault',
  };
}

function sortByRecent(records) {
  return [...records].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
}

function filterRecords(records, filters = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  const limit = Number(filters.limit) || 0;

  const filtered = records.filter((record) => {
    if (filters.category && record.category_name !== filters.category) return false;
    if (filters.month && record.reporting_month !== filters.month) return false;
    if (filters.year && String(record.reporting_year) !== String(filters.year)) return false;
    if (filters.plant_section && record.plant_section !== filters.plant_section) return false;
    if (filters.file_format && record.file_format !== filters.file_format) return false;
    if (
      search &&
      ![
        record.filename,
        record.category_name,
        record.plant_section,
        record.reporting_month,
        record.uploader_name,
      ].some((value) => String(value || '').toLowerCase().includes(search))
    ) {
      return false;
    }
    return true;
  });

  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

export function listReportMetadata(filters = {}) {
  return filterRecords(sortByRecent(loadIndex().map(normalizeRecord)), filters);
}

export async function saveReportToVault({ file, report }) {
  const metadata = normalizeRecord({
    ...report,
    id: report.id || `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    filename: report.filename || file?.name,
    mime_type: report.mime_type || file?.type || '',
    file_size: report.file_size || file?.size || 0,
  });

  if (!file) {
    throw new Error('Missing file for persistent report save');
  }

  await runTransaction('readwrite', (store) => store.put({
    id: metadata.id,
    blob: file,
    filename: metadata.filename,
    file_format: metadata.file_format,
    uploaded_at: metadata.uploaded_at,
  }));

  const nextIndex = sortByRecent([
    metadata,
    ...loadIndex()
      .map(normalizeRecord)
      .filter((record) => record.id !== metadata.id),
  ]);

  saveIndex(nextIndex);
  return metadata;
}

export async function getReportBlob(id) {
  const result = await runTransaction('readonly', (store) => store.get(id));
  return result?.blob || null;
}

export async function getLocalReports(filters = {}) {
  const records = listReportMetadata(filters);
  const hydrated = await Promise.all(
    records.map(async (record) => {
      const blob = await getReportBlob(record.id);
      if (!blob) return null;
      return {
        ...record,
        file_url: URL.createObjectURL(blob),
        isLocalVault: true,
      };
    })
  );

  return hydrated.filter(Boolean);
}

export function revokeReportUrls(records = []) {
  records.forEach((record) => {
    if (record?.isLocalVault && typeof record.file_url === 'string' && record.file_url.startsWith('blob:')) {
      URL.revokeObjectURL(record.file_url);
    }
  });
}

export async function deleteReportFromVault(id) {
  await runTransaction('readwrite', (store) => store.delete(id));
  saveIndex(loadIndex().map(normalizeRecord).filter((record) => record.id !== id));
}

export async function clearReportVault() {
  await runTransaction('readwrite', (store) => store.clear());
  saveIndex([]);
}
