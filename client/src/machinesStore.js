// ================================================================
// Machine Directory Store — client-side persistence (localStorage).
// The backend API is intentionally untouched (execution constraint),
// so machine profiles & attached documents live in the browser vault.
// ================================================================
import { loadLS, saveLS } from './utils.js';

const KEY = 'ccpl_machines_v1';

const SEED_MACHINES = [
  { id: 'm-jetmill-1', name: 'Jet Mill #1', section: 'JET MILL FORMULATION INSEC', status: 'running', docs: [], createdAt: '2026-01-10T08:00:00Z' },
  { id: 'm-acm-1', name: 'ACM-1', section: 'ACM-1 INSEC Formulation', status: 'running', docs: [], createdAt: '2026-01-10T08:05:00Z' },
  { id: 'm-liquid-filler', name: '8-Head Liquid Filler', section: 'Herbi EC Packaging', status: 'maintenance', docs: [], createdAt: '2026-01-12T09:00:00Z' },
  { id: 'm-ffs-a', name: 'FFS Line A', section: 'CARTAP PACKAGING INSEC', status: 'running', docs: [], createdAt: '2026-01-15T10:00:00Z' },
  { id: 'm-sigma-mixer', name: 'Sigma Mixer', section: 'Formulation Park', status: 'running', docs: [], createdAt: '2026-01-18T11:00:00Z' },
];

export function getMachines() {
  const stored = loadLS(KEY, null);
  if (stored) return stored;
  saveLS(KEY, SEED_MACHINES);
  return SEED_MACHINES;
}

export function getMachine(id) {
  return getMachines().find((m) => m.id === id) || null;
}

export function addMachine({ name, section, status = 'running' }) {
  const machines = getMachines();
  const machine = {
    id: `m-${Date.now().toString(36)}`,
    name: name.trim(),
    section,
    status,
    docs: [],
    createdAt: new Date().toISOString(),
  };
  saveLS(KEY, [machine, ...machines]);
  return machine;
}

export function updateMachine(id, patch) {
  const machines = getMachines().map((m) => (m.id === id ? { ...m, ...patch } : m));
  saveLS(KEY, machines);
  return machines.find((m) => m.id === id);
}

export function deleteMachine(id) {
  saveLS(KEY, getMachines().filter((m) => m.id !== id));
}

// docs: { id, tab, filename, file_format, file_url (dataURL), uploadedAt, uploadedBy }
export function addMachineDoc(machineId, doc) {
  const machines = getMachines().map((m) =>
    m.id === machineId
      ? { ...m, docs: [{ id: `d-${Date.now().toString(36)}`, uploadedAt: new Date().toISOString(), ...doc }, ...(m.docs || [])] }
      : m
  );
  saveLS(KEY, machines);
  return machines.find((m) => m.id === machineId);
}

export function removeMachineDoc(machineId, docId) {
  const machines = getMachines().map((m) =>
    m.id === machineId ? { ...m, docs: (m.docs || []).filter((d) => d.id !== docId) } : m
  );
  saveLS(KEY, machines);
  return machines.find((m) => m.id === machineId);
}
