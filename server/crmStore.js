/**
 * Lightweight CRM: page visits + order events (JSON files, capped).
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_VISITS = 20000;
const MAX_ORDERS = 10000;
const PRUNE_VISITS = 16000;
const PRUNE_ORDERS = 8000;

const visitDedupe = new Map(); // key -> lastMs

function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  ip = ip.replace(/^::ffff:/, '');
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  return ip;
}

function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^(10)\./.test(ip)) return true;
  if (/^(192)\.(168)\./.test(ip)) return true;
  if (/^(172)\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^(169)\.(254)\./.test(ip)) return true;
  if (/^(100)\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT
  if (/^(fc|fd|fe80):/i.test(ip)) return true;
  return false;
}

function parseForwardedHeader(val) {
  const s = String(val || '');
  if (!s) return [];
  const out = [];
  const parts = s.split(',');
  for (const p of parts) {
    const m = p.match(/for=([^;]+)/i);
    if (m?.[1]) out.push(normalizeIp(m[1].replace(/^"|"$/g, '')));
  }
  return out.filter(Boolean);
}

/** Real client IP (Cloudflare / reverse proxy). Express req.ip needs trust proxy. */
export function getClientIpFromRequest(req) {
  const headers = req?.headers || {};
  const candidates = [
    headers['cf-connecting-ip'],
    headers['x-real-ip'],
    headers['x-client-ip'],
    headers['x-forwarded-for'],
    ...parseForwardedHeader(headers.forwarded),
    req?.ip,
    req?.socket?.remoteAddress,
  ]
    .flatMap((v) => String(v || '').split(','))
    .map((v) => normalizeIp(v))
    .filter(Boolean);

  const publicIp = candidates.find((ip) => !isPrivateOrLocalIp(ip));
  if (publicIp) return publicIp;
  return candidates[0] || '';
}

export function classifyDevice(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return 'unknown';
  if (/tablet|ipad/.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod/.test(ua)) return 'mobile';
  return 'desktop';
}

/** Human-readable device / OS (for CRM). */
export function describeDeviceFromUa(ua) {
  const s = String(ua || '');
  if (!s.trim()) return 'unknown';
  const low = s.toLowerCase();
  const ios = s.match(/OS (\d+)[._](\d+)/);
  const iosVer = ios ? `iOS ${ios[1]}.${ios[2]}` : '';
  if (/iphone/.test(low)) return iosVer ? `iPhone · ${iosVer}` : 'iPhone';
  if (/ipad/.test(low)) return iosVer ? `iPad · ${iosVer}` : 'iPad';
  const and = s.match(/Android\s+([\d.]+)/i);
  const andVer = and ? `Android ${and[1]}` : '';
  if (/android/.test(low)) {
    const sm = s.match(/;\s*(SM-[A-Z0-9]+)/i);
    if (sm) return `Samsung ${sm[1]} · ${andVer || 'Android'}`;
    const m = s.match(/;\s*([^;)]+?)\s*(?:Build|\))/i);
    let model = m && m[1] ? m[1].trim() : '';
    if (/linux|android|mobile|sdk/i.test(model)) model = '';
    if (model && model.length > 2) return `${model.slice(0, 42)} · ${andVer || 'Android'}`;
    return andVer || 'Android';
  }
  if (/windows nt/i.test(s)) {
    const w = s.match(/Windows NT ([\d.]+)/i);
    return w ? `Windows ${w[1]}` : 'Windows';
  }
  if (/mac os x/i.test(s)) {
    const m = s.match(/Mac OS X ([\d_]+)/i);
    return m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  }
  if (/linux/.test(low)) return 'Linux';
  const c = classifyDevice(s);
  return c !== 'unknown' ? c : 'unknown';
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function shouldSkipVisitDedupe(visitorId, pagePath) {
  const key = `${String(visitorId || 'anon').slice(0, 64)}|${String(pagePath || '/').slice(0, 120)}`;
  const now = Date.now();
  const prev = visitDedupe.get(key) || 0;
  // Short window: avoid double-fires (React strict mode) but keep repeat visits visible
  if (now - prev < 45000) return true;
  visitDedupe.set(key, now);
  if (visitDedupe.size > 8000) {
    const cutoff = now - 120000;
    for (const [k, t] of visitDedupe) {
      if (t < cutoff) visitDedupe.delete(k);
    }
  }
  return false;
}

export async function loadVisits(filePath) {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function saveVisits(filePath, list) {
  await writeFile(filePath, JSON.stringify(list, null, 2), 'utf8');
}

function normalizeOrderRow(o) {
  if (!o || typeof o !== 'object') return o;
  return {
    ...o,
    status: o.status || 'received',
    updatedAt: o.updatedAt || o.at || '',
    deviceLabel: o.deviceLabel || '',
    visitorId: o.visitorId || '',
    wallet: o.wallet || '',
    iqdAmount: o.iqdAmount || '',
    paymentDetail: o.paymentDetail || '',
    senderNumber: o.senderNumber || '',
    ip: String(o.ip || '').slice(0, 45),
  };
}

export async function loadOrders(filePath) {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    return list.map(normalizeOrderRow);
  } catch {
    return [];
  }
}

export async function saveOrders(filePath, list) {
  await writeFile(filePath, JSON.stringify(list, null, 2), 'utf8');
}

function pruneVisits(list) {
  if (list.length <= MAX_VISITS) return list;
  return list.slice(list.length - PRUNE_VISITS);
}

function pruneOrders(list) {
  if (list.length <= MAX_ORDERS) return list;
  return list.slice(list.length - PRUNE_ORDERS);
}

/**
 * @param {object} body from client
 * @param {import('express').Request | null} req
 * @param {object} location { country, city }
 */
export function buildVisitRecord(body, req, location = {}) {
  // Strip query parameters for cleaner stats and reports
  let pathNorm = String(body?.path || '/').split('?')[0].split('#')[0];
  pathNorm = pathNorm.replace(/\/+$/, '') || '/';
  if (pathNorm.length > 200) pathNorm = pathNorm.slice(0, 200);
  const lang = String(body?.lang || '').slice(0, 12);
  const referrer = String(body?.referrer || '').slice(0, 300);
  const visitorId = String(body?.visitorId || '').slice(0, 80);
  const uaHeader = req?.get?.('user-agent') || '';
  const ip = getClientIpFromRequest(req);
  return {
    id: newId('v'),
    at: new Date().toISOString(),
    path: pathNorm,
    lang,
    referrer,
    visitorId: visitorId || 'anon',
    device: classifyDevice(uaHeader),
    deviceLabel: describeDeviceFromUa(uaHeader).slice(0, 120),
    country: String(location.country || 'Unknown').slice(0, 80),
    countryCode: String(location.countryCode || '').slice(0, 4),
    city: String(location.city || '').slice(0, 80),
    ua: String(uaHeader).slice(0, 220),
    ip: String(ip).slice(0, 45),
  };
}

export async function appendVisit(visitsPath, record) {
  const list = await loadVisits(visitsPath);
  list.push(record);
  await saveVisits(visitsPath, pruneVisits(list));
  return record;
}

export async function appendOrderEvent(ordersPath, rec) {
  const list = await loadOrders(ordersPath);
  const now = new Date().toISOString();
  const row = normalizeOrderRow({
    id: newId('o'),
    at: now,
    updatedAt: now,
    status: rec.status || 'received',
    orderId: String(rec.orderId || '').slice(0, 80),
    name: String(rec.name || '').slice(0, 100),
    usdtAmount: Number(rec.usdtAmount) || 0,
    paymentMethod: String(rec.paymentMethod || '').slice(0, 40),
    network: String(rec.network || '').slice(0, 20),
    visitorId: String(rec.visitorId || '').slice(0, 80),
    deviceLabel: String(rec.deviceLabel || '').slice(0, 120),
    iqdAmount: String(rec.iqdAmount ?? '').slice(0, 40),
    wallet: String(rec.wallet || '').slice(0, 120),
    paymentDetail: String(rec.paymentDetail || '').slice(0, 200),
    senderNumber: String(rec.senderNumber || '').slice(0, 20),
    ip: String(rec.ip || '').slice(0, 45),
  });
  list.push(row);
  await saveOrders(ordersPath, pruneOrders(list));
  return row;
}

export function countRecentOrdersByVisitor(orders, visitorId, windowMs) {
  const vid = String(visitorId || '').trim();
  if (!vid) return 0;
  const cutoff = Date.now() - windowMs;
  let n = 0;
  for (const o of orders) {
    const t = new Date(o.at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    if (String(o.visitorId || '') === vid) n += 1;
  }
  return n;
}

export function findOrderByBusinessId(orders, orderId) {
  const q = String(orderId || '').trim();
  if (!q) return null;
  return orders.find((o) => String(o.orderId) === q) || null;
}

export async function updateOrderStatus(ordersPath, crmId, status) {
  const list = await loadOrders(ordersPath);
  const idx = list.findIndex((o) => o.id === crmId);
  if (idx < 0) return { ok: false, error: 'not_found' };
  const next = {
    ...list[idx],
    status,
    updatedAt: new Date().toISOString(),
  };
  list[idx] = normalizeOrderRow(next);
  await saveOrders(ordersPath, pruneOrders(list));
  return { ok: true, order: list[idx] };
}

export async function updateOrderStatusByOrderId(ordersPath, orderId, status) {
  const list = await loadOrders(ordersPath);
  const q = String(orderId || '').trim();
  const idx = list.findIndex((o) => String(o.orderId) === q);
  if (idx < 0) return { ok: false, error: 'not_found' };
  const next = {
    ...list[idx],
    status,
    updatedAt: new Date().toISOString(),
  };
  list[idx] = normalizeOrderRow(next);
  await saveOrders(ordersPath, pruneOrders(list));
  return { ok: true, order: list[idx] };
}

export function maskWalletForPublic(wallet) {
  const w = String(wallet || '').trim();
  if (w.length <= 12) return w ? '***' : '';
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export function publicOrderTrackingPayload(o) {
  if (!o) return null;
  const st = String(o.status || 'received');
  const ar = {
    received: 'قيد المعالجة',
    completed: 'تم الإكمال',
    archived: 'مؤرشف',
    cancelled: 'ملغى',
  };
  const en = {
    received: 'Processing',
    completed: 'Completed',
    archived: 'Archived',
    cancelled: 'Cancelled',
  };
  return {
    orderId: o.orderId,
    status: st,
    statusLabelAr: ar[st] || st,
    statusLabelEn: en[st] || st,
    name: o.name,
    usdtAmount: o.usdtAmount,
    iqdAmount: o.iqdAmount,
    paymentMethod: o.paymentMethod,
    network: o.network,
    walletMasked: maskWalletForPublic(o.wallet),
    at: o.at,
    updatedAt: o.updatedAt || o.at,
  };
}

export function sanitizeVisitPublic(v) {
  return {
    at: v.at,
    path: v.path,
    device: v.device,
    lang: v.lang || '',
  };
}

export function sanitizeOrderPublic(o) {
  return {
    at: o.at,
    usdtAmount: o.usdtAmount,
    paymentMethod: o.paymentMethod,
  };
}

export function getRecentVisits(list, n) {
  return list.slice(-n).reverse();
}

export function getRecentOrders(list, n) {
  return list.slice(-n).reverse();
}

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function computeVisitStats(list) {
  const now = new Date();
  const day0 = startOfUtcDay(now).getTime();
  const week0 = day0 - 6 * 24 * 60 * 60 * 1000;
  let visitsToday = 0;
  let visitsWeek = 0;
  const visitorsWeek = new Set();
  const pathCounts = new Map();

  for (const v of list) {
    const t = new Date(v.at).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= day0) visitsToday += 1;
    if (t >= week0) {
      visitsWeek += 1;
      if (v.visitorId) visitorsWeek.add(v.visitorId);
    }
    const loc = v.country ? (v.city ? `${v.country}, ${v.city}` : v.country) : 'Unknown';
    const dev = v.device || 'unknown';
    const key = `${loc}|${dev}`; // Summarize by source (location + device)
    pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
  }

  const topSources = [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [location, device] = key.split('|');
      return { location, device, count };
    });

  return {
    total: list.length,
    visitsToday,
    visitsWeek,
    uniqueVisitorsWeek: visitorsWeek.size,
    topSources,
  };
}

export function computeOrderStats(list) {
  const now = new Date();
  const day0 = startOfUtcDay(now).getTime();
  const week0 = day0 - 6 * 24 * 60 * 60 * 1000;
  let ordersToday = 0;
  let ordersWeek = 0;
  let volumeWeek = 0;
  let volumeToday = 0;

  for (const o of list) {
    const t = new Date(o.at).getTime();
    if (Number.isNaN(t)) continue;
    const amt = Number(o.usdtAmount) || 0;
    if (t >= day0) {
      ordersToday += 1;
      volumeToday += amt;
    }
    if (t >= week0) {
      ordersWeek += 1;
      volumeWeek += amt;
    }
  }

  return {
    total: list.length,
    ordersToday,
    ordersWeek,
    volumeToday: Math.round(volumeToday * 100) / 100,
    volumeWeek: Math.round(volumeWeek * 100) / 100,
  };
}

export async function buildFullCrmSummary(visitsPath, ordersPath, marketingStats) {
  const visits = await loadVisits(visitsPath);
  const orders = await loadOrders(ordersPath);
  return {
    visits: computeVisitStats(visits),
    orders: computeOrderStats(orders),
    marketing: marketingStats || null,
    generatedAt: new Date().toISOString(),
  };
}

export function visitsToCsv(rows) {
  const header = ['id', 'at', 'path', 'lang', 'device', 'deviceLabel', 'country', 'countryCode', 'city', 'visitorId', 'referrer', 'ip', 'ua'];
  const esc = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => esc(r[h])).join(','));
  }
  return lines.join('\n');
}

export function ordersToCsv(rows) {
  const header = ['id', 'at', 'updatedAt', 'status', 'orderId', 'name', 'usdtAmount', 'paymentMethod', 'network', 'visitorId', 'deviceLabel'];
  const esc = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => esc(r[h])).join(','));
  }
  return lines.join('\n');
}

export function buildPrintableHtmlReport(summary, visitSlice, orderSlice) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const vRows = visitSlice.map((v) => {
    const loc = v.country ? (v.city ? `${v.country}, ${v.city}` : v.country) : '—';
    const dev = v.deviceLabel || v.device || '—';
    return `<tr><td>${esc(v.at)}</td><td class="path-col">${esc(v.path)}</td><td>${esc(loc)}</td><td>${esc(dev)}</td><td>${esc(v.lang)}</td><td>${esc(v.ip)}</td></tr>`;
  }).join('');
  const oRows = orderSlice.map((o) => `<tr><td>${esc(o.at)}</td><td>${esc(o.orderId)}</td><td>${esc(o.status || 'received')}</td><td>${esc(o.name)}</td><td>${esc(o.usdtAmount)}</td><td>${esc(o.paymentMethod)}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <title>CRM Report — TETHER IQ</title>
  <style>
    body { font-family: system-ui, Segoe UI, Tahoma, sans-serif; margin: 24px; color: #111; background: #f8fafc; }
    h1 { font-size: 1.5rem; color: #0f172a; border-bottom: 2px solid #00E5FF; padding-bottom: 8px; }
    h2 { font-size: 1.1rem; margin-top: 30px; color: #1e293b; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 0.82rem; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: right; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
    .path-col { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; text-align: left; font-family: monospace; color: #0284c7; }
    .meta { color: #64748b; font-size: 0.9rem; margin-bottom: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #fff; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .stat-val { font-size: 1.25rem; font-weight: 700; color: #00E5FF; }
    @media print { body { margin: 0; background: #fff; } .stat-card { border: 1px solid #eee; } }
  </style>
</head>
<body>
  <h1>تقرير CRM — زيارات وطلبات</h1>
  <div class="meta">أنشئ في: ${esc(summary.generatedAt)}</div>
  <h2>ملخص</h2>
  <ul>
    <li>إجمالي الزيارات المسجّلة: ${summary.visits.total}</li>
    <li>زيارات اليوم: ${summary.visits.visitsToday}</li>
    <li>زيارات آخر 7 أيام: ${summary.visits.visitsWeek}</li>
    <li>زوّار مميّزون (7 أيام): ${summary.visits.uniqueVisitorsWeek}</li>
    <li>إجمالي الطلبات المسجّلة: ${summary.orders.total}</li>
    <li>طلبات اليوم: ${summary.orders.ordersToday}</li>
    <li>طلبات 7 أيام: ${summary.orders.ordersWeek}</li>
    <li>حجم USDT (7 أيام): ${summary.orders.volumeWeek}</li>
  </ul>
  <h2>آخر الزيارات (حتى 200)</h2>
  <table><thead><tr><th>وقت</th><th>المسار</th><th>الموقع</th><th>الجهاز</th><th>اللغة</th><th>IP</th></tr></thead><tbody>${vRows || '<tr><td colspan="6">—</td></tr>'}</tbody></table>
  <h2>آخر الطلبات (حتى 200)</h2>
  <table><thead><tr><th>وقت</th><th>رقم الطلب</th><th>الحالة</th><th>الاسم</th><th>USDT</th><th>طريقة الدفع</th></tr></thead><tbody>${oRows || '<tr><td colspan="6">—</td></tr>'}</tbody></table>
  <p style="margin-top:24px;font-size:0.85rem;color:#666">للحفظ كـ PDF: استخدم الطباعة من المتصفح ← اختر «Save as PDF».</p>
</body>
</html>`;
}

export function defaultDataPaths(dataDir) {
  return {
    visits: path.join(dataDir, 'visits.json'),
    orders: path.join(dataDir, 'ordersLog.json'),
  };
}
