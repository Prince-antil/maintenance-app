import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');

const ENV_FILES = [
  path.join(APP_ROOT, '.env'),
  path.join(APP_ROOT, '.env.local'),
  path.join(APP_ROOT, 'client', '.env'),
  path.join(APP_ROOT, 'client', '.env.local'),
];

let cachedEnv = null;
let cachedClient = null;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
      if (!match) return acc;
      const [, key, rawValue] = match;
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      acc[key] = value;
      return acc;
    }, {});
}

function loadEnvCache() {
  if (cachedEnv) return cachedEnv;

  cachedEnv = ENV_FILES.reduce((acc, filePath) => ({
    ...acc,
    ...parseEnvFile(filePath),
  }), {});

  return cachedEnv;
}

function envValue(...keys) {
  const fileEnv = loadEnvCache();
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
    if (fileEnv[key]) return fileEnv[key];
  }
  return '';
}

export const SUPABASE_URL =
  envValue('SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');

export const SUPABASE_ANON_KEY =
  envValue('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

export const SUPABASE_SERVICE_ROLE_KEY =
  envValue('SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY');

export const SUPABASE_DOCUMENT_BUCKET =
  envValue('SUPABASE_DOCUMENT_BUCKET', 'VITE_SUPABASE_DOCUMENT_BUCKET') || 'maintenance-documents';

export const hasSupabaseServerConfig = Boolean(SUPABASE_URL && (SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY));

export function getSupabaseServerClient() {
  if (!hasSupabaseServerConfig) {
    throw new Error('Supabase server configuration is missing');
  }

  if (!cachedClient) {
    cachedClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
  }

  return cachedClient;
}
