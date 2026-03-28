const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function getOrCreateVisitorId() {
  try {
    let id = localStorage.getItem('visitor_id');
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem('visitor_id', id);
    }
    return id;
  } catch {
    return `sess_${Date.now()}`;
  }
}

export function trackPageVisit(pagePath, lang) {
  const payload = {
    path: String(pagePath || '/').slice(0, 200),
    lang: String(lang || '').slice(0, 12),
    visitorId: getOrCreateVisitorId(),
    referrer: typeof document !== 'undefined' ? (document.referrer || '').slice(0, 300) : '',
  };
  fetch(`${API_BASE}/api/track-visit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  }).catch(() => {});
}
