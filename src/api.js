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
    let msg = text;
    try {
      const j = JSON.parse(text);
      if (j.error) msg = j.error;
    } catch {
      /* keep text */
    }
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function getPaymentDetails() {
  return jsonFetch('/api/payment-details');
}

export async function createOrder(payload) {
  const res = await fetch(`${API_BASE}/api/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(DEFAULT_FETCH_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    let code;
    let errorEn;
    try {
      const j = JSON.parse(text);
      if (j.error) msg = j.error;
      if (j.code) code = j.code;
      if (j.errorEn) errorEn = j.errorEn;
      if (j.telegramDescription) {
        msg = msg ? `${msg} — ${j.telegramDescription}` : j.telegramDescription;
      }
      if (j.hint) {
        msg = msg ? `${msg}\n\n${j.hint}` : j.hint;
      }
    } catch {
      /* use text */
    }
    const err = new Error(msg || `Request failed: ${res.status}`);
    if (code) err.code = code;
    if (errorEn) err.errorEn = errorEn;
    throw err;
  }
  return JSON.parse(text);
}

export function fetchOrderStatus(orderId) {
  return jsonFetch(`/api/order-status?orderId=${encodeURIComponent(orderId)}`);
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

export function createChatSession() {
  return jsonFetch('/api/chat/session', { method: 'POST', body: '{}' });
}

export function sendChatMessage(sessionId, text, visitorName = '') {
  return jsonFetch('/api/chat/message', {
    method: 'POST',
    body: JSON.stringify({ sessionId, text, visitorName }),
  });
}

export function fetchChatMessages(sessionId, after = 0) {
  return jsonFetch(`/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}&after=${after}`);
}

