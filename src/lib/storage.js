// Persistence for PulseDaily.
// The key and the existing v3 schema are kept as-is so current data loads.
// New fields are added by numbered, additive migrations: they only ever add
// keys with defaults and never rename or drop what is already there.

import { seedTraining } from '../train/data.js';

export const STORAGE_KEY = 'pulsedaily_flagship_v3';

// Keys that must never leave this device (excluded from backup exports).
const DEVICE_ONLY_KEYS = ['ai'];

// Each entry upgrades data from schema N-1 to N. Append only.
// `_schema` is absent on data saved by the original single-file app; treat it as 3.
const MIGRATIONS = {
  // 4: workout tracker (exercise library, Push/Pull/Legs routines, sessions, settings).
  4: (d) => ({ ...d, training: d.training ?? seedTraining(d.rituals || []) }),
};

export const CURRENT_SCHEMA = Math.max(3, ...Object.keys(MIGRATIONS).map(Number));

export function migrate(data) {
  if (!data || typeof data !== 'object') return data;
  let d = { ...data };
  let v = Number.isInteger(d._schema) ? d._schema : 3;
  while (v < CURRENT_SCHEMA) {
    v += 1;
    if (MIGRATIONS[v]) d = MIGRATIONS[v](d);
    d._schema = v;
  }
  return d;
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const migrated = migrate(parsed);
    if (migrated._schema !== parsed._schema) {
      // Keep a one-off copy of the pre-migration data, just in case.
      try { localStorage.setItem(`${STORAGE_KEY}__pre_v${migrated._schema}`, raw); } catch {}
      save(migrated);
    }
    return migrated;
  } catch (e) {
    console.error('Could not read saved data', e);
    return null;
  }
}

export function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, _schema: CURRENT_SCHEMA }));
}

// Backup export: everything except device-only secrets such as the AI key.
export function toBackup(data) {
  const copy = structuredClone(data);
  for (const k of DEVICE_ONLY_KEYS) delete copy[k];
  return copy;
}

// Backup import: accept any older schema and migrate it forward,
// but keep this device's own device-only settings.
export function fromBackup(imported, current) {
  const migrated = migrate(imported);
  for (const k of DEVICE_ONLY_KEYS) {
    delete migrated[k];
    if (current && current[k] !== undefined) migrated[k] = current[k];
  }
  return migrated;
}

// Ask iOS/Chrome not to evict our storage under pressure.
export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
