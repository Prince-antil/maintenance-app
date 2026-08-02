import { SUPABASE_DOCUMENT_BUCKET, isSupabaseConfigured, supabase } from './supabaseClient.js';

function sanitizeName(filename) {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  const base = (dot >= 0 ? filename.slice(0, dot) : filename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document';
  return `${base}${ext}`;
}

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function buildMachineStoragePath(machineId, filename) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `machines/${machineId}/${stamp}-${sanitizeName(filename)}`;
}

export async function uploadMachineAttachment({ file, machineId, plantSection, tab, uploadedBy }) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase storage is not configured');
  }

  const storagePath = buildMachineStoragePath(machineId, file.name);
  const { error: uploadError } = await supabase.storage
    .from(SUPABASE_DOCUMENT_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload document to Supabase');
  }

  const { data } = supabase.storage.from(SUPABASE_DOCUMENT_BUCKET).getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    await removeStoredDocument(storagePath);
    throw new Error('Supabase did not return a public URL for the uploaded document');
  }
  const uploadedAt = new Date().toISOString();

  return {
    id: `doc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    machine_id: machineId,
    plant_section: plantSection || '',
    tab,
    filename: file.name,
    file_format: extensionOf(file.name),
    file_url: data.publicUrl,
    public_url: data.publicUrl,
    storage_path: storagePath,
    uploadedAt,
    uploaded_at: uploadedAt,
    uploadedBy: uploadedBy || 'System',
    uploaded_by: uploadedBy || 'System',
  };
}

export async function removeStoredDocument(storagePath) {
  if (!storagePath || !isSupabaseConfigured || !supabase) return;

  const { error } = await supabase.storage
    .from(SUPABASE_DOCUMENT_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw new Error(error.message || 'Failed to remove document from Supabase');
  }
}
