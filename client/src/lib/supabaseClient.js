import { createClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://example.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'supabase-anon-key-placeholder';
const FALLBACK_DOCUMENT_BUCKET = 'maintenance-documents';

const envUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL;
const envAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  FALLBACK_SUPABASE_ANON_KEY;
export const SUPABASE_DOCUMENT_BUCKET =
  import.meta.env.VITE_SUPABASE_DOCUMENT_BUCKET ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_DOCUMENT_BUCKET ||
  FALLBACK_DOCUMENT_BUCKET;

const hasRealSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
  envUrl !== FALLBACK_SUPABASE_URL &&
  envAnonKey !== FALLBACK_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = hasRealSupabaseConfig;
export const supabaseConfig = {
  url: envUrl,
  anonKey: envAnonKey,
  bucket: SUPABASE_DOCUMENT_BUCKET,
};

export const supabase = hasRealSupabaseConfig
  ? createClient(envUrl, envAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
