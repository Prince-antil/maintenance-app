// =============================================================================
// Compliance document storage — private Supabase bucket with public fallback.
// New uploads prefer the private `compliance-documents` bucket created by
// 20261113_compliance_upgrade.sql and are read back through short-lived signed
// URLs. If that bucket is unavailable (pre-migration project), the existing
// public buckets remain as a safe fallback. Offline / unconfigured projects
// store a local data URL so nothing is lost.
// =============================================================================
import {
  SUPABASE_COMPLIANCE_BUCKET, SUPABASE_CERT_BUCKET, SUPABASE_DOCUMENT_BUCKET,
  isSupabaseConfigured, supabase,
} from './supabaseClient.js';

export const COMPLIANCE_DOC_MAX_BYTES = 10 * 1024 * 1024;
const SIGN_TTL_SECONDS = 3600;
const PRIVATE_FALLBACK_BUCKETS = [SUPABASE_COMPLIANCE_BUCKET, SUPABASE_CERT_BUCKET, SUPABASE_DOCUMENT_BUCKET];

function sanitizeSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

function sanitizeName(filename) {
  const dot = String(filename || '').lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  const base = (dot >= 0 ? filename.slice(0, dot) : filename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'certificate';
  return `${base}${ext}`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function publicUrlFrom(bucket, storagePath) {
  try {
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return data?.publicUrl || '';
  } catch { return ''; }
}

/**
 * Resolve a stored compliance document reference to a usable URL. Private
 * bucket objects get a short-lived signed URL; public and offline documents
 * return their stored URL directly. Returns '' when the document cannot be
 * resolved.
 */
export async function resolveComplianceDocumentUrl(documentRef) {
  if (!documentRef || typeof documentRef !== 'object') return '';
  if (documentRef.dataUrl) return documentRef.dataUrl;
  if (documentRef.publicUrl) return documentRef.publicUrl;
  const storagePath = documentRef.storagePath || documentRef.storage_path || '';
  if (!storagePath || !isSupabaseConfigured || !supabase) return '';
  const buckets = [documentRef.bucket, ...PRIVATE_FALLBACK_BUCKETS].filter(Boolean);
  for (const bucket of [...new Set(buckets)]) {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, SIGN_TTL_SECONDS);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch { /* try next bucket */ }
    // Public fallback (e.g. testing-certificates) does not need signing.
    const url = publicUrlFrom(bucket, storagePath);
    if (url && (documentRef.publicUrl || bucket !== SUPABASE_COMPLIANCE_BUCKET)) return url;
  }
  return '';
}

/**
 * Upload a compliance inspection/certificate document. Returns a stable
 * document reference suitable for JSONB storage. Throws with a clear message
 * when Supabase is configured but every cloud upload fails.
 */
export async function uploadComplianceDoc(file, plantId, equipmentId, eventId, uploadedBy) {
  if (!file) throw new Error('No document selected');
  if (file.size > COMPLIANCE_DOC_MAX_BYTES) {
    throw new Error('Document exceeds the 10 MB limit');
  }
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const baseDir = `compliance/${sanitizeSegment(plantId)}/${sanitizeSegment(equipmentId)}/${sanitizeSegment(eventId)}`;
  const storagePath = `${baseDir}/${stamp}-${sanitizeName(file.name)}`;
  const uploadedAt = new Date().toISOString();
  const meta = {
    filename: file.name,
    size: file.size,
    contentType: file.type || '',
    storagePath,
    publicUrl: '',
    dataUrl: '',
    uploadedAt,
    uploadedBy: uploadedBy || 'System',
  };

  if (isSupabaseConfigured && supabase) {
    const uploadOptions = { cacheControl: '3600', upsert: false, contentType: file.type || undefined };
    for (const bucket of PRIVATE_FALLBACK_BUCKETS) {
      try {
        const { error } = await supabase.storage.from(bucket).upload(storagePath, file, uploadOptions);
        if (!error) {
          return {
            ...meta,
            bucket,
            private: bucket === SUPABASE_COMPLIANCE_BUCKET,
            publicUrl: bucket === SUPABASE_COMPLIANCE_BUCKET ? '' : publicUrlFrom(bucket, storagePath),
          };
        }
      } catch { /* try the next bucket */ }
    }
    // Supabase is configured but every bucket rejected the upload — fail loudly
    // instead of silently storing a data URL that could later vanish.
    throw new Error('Failed to upload compliance document to Supabase storage');
  }

  meta.dataUrl = await readAsDataUrl(file);
  return meta;
}

export default {
  uploadComplianceDoc,
  resolveComplianceDocumentUrl,
  COMPLIANCE_DOC_MAX_BYTES,
};
