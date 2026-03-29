const STORAGE_KEY = 'exchange_iq_saved_orders_v1';
const MAX_ITEMS = 50;

/**
 * حفظ رقم طلب محلياً للمتابعة من «طلباتي» (لا يستبدل حساباً خادمياً).
 */
export function saveOrderLocal({ orderId, usdtAmount }) {
  if (typeof window === 'undefined' || !orderId) return;
  let list = [];
  try {
    list = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  const entry = {
    orderId: String(orderId).slice(0, 80),
    at: Date.now(),
    usdt: Number(usdtAmount) || 0,
  };
  list = [entry, ...list.filter((x) => x.orderId !== entry.orderId)].slice(0, MAX_ITEMS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent('exchange-iq-saved-orders-changed'));
}

export function getSavedOrders() {
  if (typeof window === 'undefined') return [];
  try {
    const list = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearSavedOrders() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
