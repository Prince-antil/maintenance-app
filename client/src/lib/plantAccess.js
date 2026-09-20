// ================================================================
// CCPL CMMS — Plant Access & Role Helpers
// ================================================================
// Single source of truth for role checks and plant-scoped filtering.
// Frontend filtering is UX only — security is enforced by Supabase RLS.
// ================================================================

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  CORPORATE_HEAD: 'corporate_head',
  PLANT_ADMIN: 'plant_admin',
  PLANT_USER: 'plant_user',
  // Backwards compat with existing roles
  ADMIN: 'admin',
  VIEWER: 'viewer',
};

export const ROLE_META = {
  super_admin:    { label: 'Super Admin', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', description: 'Full system access — all plants, users, configuration' },
  corporate_head: { label: 'Corporate Head', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/30', description: 'Consolidated dashboard, cross-plant comparison, drill-down' },
  plant_admin:    { label: 'Plant Admin', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', description: 'Full access within assigned plant' },
  plant_user:     { label: 'Plant User', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', description: 'Create/update permitted maintenance records within assigned plant' },
  admin:          { label: 'Administrator', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', description: 'Legacy admin — treated as Super Admin' },
  viewer:         { label: 'Viewer', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30', description: 'Read-only access' },
};

export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (['super_admin', 'superadmin', 'system_admin', 'systemadmin'].includes(r)) return ROLES.SUPER_ADMIN;
  if (['corporate_head', 'corporate', 'formulation_head', 'corp_head'].includes(r)) return ROLES.CORPORATE_HEAD;
  if (['plant_admin', 'plantadmin'].includes(r)) return ROLES.PLANT_ADMIN;
  if (['plant_user', 'plantuser', 'engineer', 'user'].includes(r)) return ROLES.PLANT_USER;
  if (r === 'admin') return ROLES.ADMIN;
  if (r === 'viewer') return ROLES.VIEWER;
  return ROLES.PLANT_USER;
}

export function isSuperAdmin(role) {
  const r = normalizeRole(role);
  return r === ROLES.SUPER_ADMIN || r === ROLES.ADMIN;
}

export function isCorporate(role) {
  const r = normalizeRole(role);
  return r === ROLES.CORPORATE_HEAD || r === ROLES.SUPER_ADMIN || r === ROLES.ADMIN;
}

export function isPlantAdmin(role) {
  const r = normalizeRole(role);
  return r === ROLES.PLANT_ADMIN || r === ROLES.SUPER_ADMIN || r === ROLES.ADMIN;
}

export function canManagePlants(role) {
  return isSuperAdmin(role);
}

export function canManageUsers(role) {
  return isSuperAdmin(role) || normalizeRole(role) === ROLES.PLANT_ADMIN;
}

export function canUpload(role) {
  const r = normalizeRole(role);
  return [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PLANT_ADMIN, ROLES.PLANT_USER].includes(r);
}

export function canDelete(role) {
  return isSuperAdmin(role) || isPlantAdmin(role);
}

export function canViewCorporateDashboard(role) {
  return isCorporate(role);
}

// ── Plant-scoped filtering (UX helpers — NOT security) ──────────────────────

/**
 * Filter an array of records by plant_id.
 * If currentPlantId is null/undefined, returns all (corporate view).
 * Returns empty array if records is not an array.
 */
export function filterByPlant(records, plantId) {
  if (!Array.isArray(records)) return [];
  if (!plantId) return records; // corporate — no filter
  return records.filter((r) => {
    const pid = r.plant_id || r.plantId || r.plantId === '' ? (r.plant_id || r.plantId) : null;
    // Backwards compat: records without plant_id belong to Nathupur
    if (!pid) return plantId === '00000000-0000-0000-0000-000000000001';
    return pid === plantId;
  });
}

/**
 * Ensure a record carries the correct plant_id before persistence.
 * NEVER trust plant_id from user input / Excel — always override.
 */
export function withPlantId(record, plantId) {
  if (!plantId) return record;
  return { ...record, plant_id: plantId, plantId };
}

export function withPlantIdBulk(records, plantId) {
  if (!Array.isArray(records) || !plantId) return records;
  return records.map((r) => withPlantId(r, plantId));
}

// ── Access helpers ───────────────────────────────────────────────────────────
export function getUserPlantIds(user) {
  if (!user) return [];
  if (Array.isArray(user.plantIds)) return user.plantIds;
  if (Array.isArray(user.plant_ids)) return user.plant_ids;
  if (Array.isArray(user.plants)) return user.plants.map((p) => p.id || p.plant_id || p);
  return [];
}

export function userCanAccessPlant(user, plantId) {
  if (!user || !plantId) return false;
  if (isSuperAdmin(user.role) || isCorporate(user.role)) return true;
  const ids = getUserPlantIds(user);
  if (!ids.length) {
    // No explicit mapping — default to Nathupur only (backwards compat)
    return plantId === '00000000-0000-0000-0000-000000000001';
  }
  return ids.includes(plantId);
}
