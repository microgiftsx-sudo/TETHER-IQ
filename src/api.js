const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function jsonFetch(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
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

export function getStats() {
  return jsonFetch('/api/stats');
}

export function getTestimonials() {
  return jsonFetch('/api/testimonials');
}

