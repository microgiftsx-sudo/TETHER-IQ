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

export async function notifyTelegram(order) {
  const token = import.meta.env.VITE_TELEGRAM_TOKEN;
  const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // تخطى إذا لم تكن المتغيرات مضبوطة

  const paymentMethodEmoji = {
    'Zain Cash':   '📱',
    'FIB':         '🏦',
    'MasterCard':  '💳',
    'Asia Hawala': '🏪',
  }[order.paymentMethod] || '💰';

  const msg =
    `🔔 <b>طلب شراء جديد!</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🆔 رقم الطلب: <code>${order.orderId}</code>\n` +
    `👤 الاسم: <b>${order.name}</b>\n` +
    `💵 المبلغ: <b>${order.usdtAmount} USDT</b>\n` +
    `💰 بالدينار: <b>${order.iqdAmount} IQD</b>\n` +
    `${paymentMethodEmoji} طريقة الدفع: <b>${order.paymentMethod}</b>\n` +
    `🔗 الشبكة: <b>${order.walletNetwork}</b>\n` +
    `👛 المحفظة: <code>${order.wallet}</code>\n` +
    (order.senderNumber ? `📞 رقم المرسل: <b>${order.senderNumber}</b>\n` : '') +
    (order.paymentDetail ? `📝 ملاحظة: ${order.paymentDetail}\n` : '') +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🕐 ${new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' })}`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
    });
  } catch {
    // لا توقف العملية إذا فشل إرسال الإشعار
  }
}

