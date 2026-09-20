// ================================================================
// CCPL CMMS — Audit Log (plant-aware)
// ================================================================
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { loadLS, saveLS } from '../utils.js';

const AUDIT_LS_KEY = 'ccpl_audit_log_v1';
const MAX_LOCAL = 500;

function loadLocal() {
  try {
    const raw = loadLS(AUDIT_LS_KEY, []);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function saveLocal(entries) {
  saveLS(AUDIT_LS_KEY, entries.slice(0, MAX_LOCAL));
}

export function logAudit({ user, plantId, action, module, recordId, details }) {
  const entry = {
    id: `audit-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    user_id: user?.id || null,
    user_name: user?.full_name || user?.username || 'System',
    plant_id: plantId || null,
    action: String(action || '').trim(),
    module: String(module || '').trim(),
    record_id: String(recordId || '').trim(),
    details: details || {},
    created_at: new Date().toISOString(),
  };

  // Local persistence (immediate)
  const local = loadLocal();
  local.unshift(entry);
  saveLocal(local);

  // Cloud persistence (fire-and-forget)
  if (isSupabaseConfigured && supabase) {
    supabase.from('audit_log').insert({
      user_id: entry.user_id,
      user_name: entry.user_name,
      plant_id: entry.plant_id,
      action: entry.action,
      module: entry.module,
      record_id: entry.record_id,
      details: entry.details,
    }).then(({ error }) => {
      if (error) console.warn('[Audit] cloud insert failed:', error.message);
    });
  }
  return entry;
}

export function getAuditLog({ plantId, limit = 100 } = {}) {
  const all = loadLocal();
  const filtered = plantId ? all.filter((e) => !e.plant_id || e.plant_id === plantId) : all;
  return filtered.slice(0, limit);
}

export async function fetchAuditLogCloud({ plantId, limit = 100 } = {}) {
  if (!isSupabaseConfigured || !supabase) return getAuditLog({ plantId, limit });
  let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (plantId) q = q.eq('plant_id', plantId);
  const { data, error } = await q;
  if (error) {
    console.warn('[Audit] cloud fetch failed:', error.message);
    return getAuditLog({ plantId, limit });
  }
  return data || [];
}
