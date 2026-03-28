import { normalizeStats, DEFAULT_STATS } from '../shared/statsNormalize.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const DEFAULT_FETCH_MS = 22000;

async function jsonFetch(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(DEFAULT_FETCH_MS),
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function getPaymentDetails() {
  return jsonFetch('/api/payment-details');
}

export function createOrder(payload) {
  return jsonFetch('/api/order', { method: 'POST', body: JSON.stringify(payload) });
}

export function getSiteConfig() {
  return jsonFetch('/api/site-config');
}

export async function getStats() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await jsonFetch('/api/stats');
      return normalizeStats(raw);
    } catch {
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  return { ...DEFAULT_STATS };
}

export function getTestimonials() {
  return jsonFetch('/api/testimonials');
}

export function getRecentActivity(limit = 5) {
  return jsonFetch(`/api/activity/recent?limit=${encodeURIComponent(limit)}`);
}

