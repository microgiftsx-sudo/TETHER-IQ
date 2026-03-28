/**
 * Single source of truth for trust stats defaults + normalization.
 * Used by the API handler and the client so missing/invalid JSON never shows as blank or NaN.
 */
export const DEFAULT_STATS = {
  customers: 1200,
  transactions: 3500,
  years: 3,
  satisfaction: 99,
};

const KEYS = ['customers', 'transactions', 'years', 'satisfaction'];

function pick(raw, key) {
  const fallback = DEFAULT_STATS[key];
  const n = Number(raw?.[key]);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** Merge with defaults; replace invalid/missing fields. */
export function normalizeStats(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_STATS };
  }
  const out = {};
  for (const key of KEYS) {
    out[key] = pick(raw, key);
  }
  return out;
}
