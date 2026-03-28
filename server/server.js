import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import FormData from 'form-data';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { normalizeStats, DEFAULT_STATS } from '../shared/statsNormalize.js';
import {
  tgPostJson,
  tgPostMultipart,
  tgGetUpdates,
  tgGetFile,
  tgAnswerCallbackQuery,
  escapeTelegramHtml,
} from './telegramClient.js';
import {
  METHOD_KEYS,
  migratePaymentDetails,
  getActiveProfile,
  getProfileById,
  buildPublicPaymentPayload,
  profileIndex,
  newProfileId,
  normalizeProfile,
  defaultEmptyMethods,
  defaultMethodEnabled,
} from './paymentProfiles.js';
import {
  defaultDataPaths,
  shouldSkipVisitDedupe,
  buildVisitRecord,
  appendVisit,
  appendOrderEvent,
  loadVisits,
  loadOrders,
  getRecentVisits,
  getRecentOrders,
  buildFullCrmSummary,
  visitsToCsv,
  ordersToCsv,
  buildPrintableHtmlReport,
  computeVisitStats,
  computeOrderStats,
} from './crmStore.js';

const PAYMENT_METHOD_LABEL_TO_KEY = {
  'Zain Cash': 'zainCash',
  FastPay: 'fastPay',
  FIB: 'fib',
  MasterCard: 'mastercard',
  'Asia Hawala': 'asiaHawala',
};

const adminProfileContext = new Map(); // chatId -> { profileId }

function resolveEditingProfileId(details, chatId) {
  const pid = adminProfileContext.get(String(chatId))?.profileId;
  if (pid && getProfileById(details, pid)) return pid;
  return details.currentProfileId;
}

function setEditingProfile(chatId, profileId) {
  adminProfileContext.set(String(chatId), { profileId });
}

function getEditingProfile(details, chatId) {
  return getProfileById(details, resolveEditingProfileId(details, chatId));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const PORT = Number(process.env.PORT || 5174);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'paymentDetails.json');
const SITE_CONFIG_PATH = path.join(DATA_DIR, 'siteConfig.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const TESTIMONIALS_PATH = path.join(DATA_DIR, 'testimonials.json');
const { visits: VISITS_PATH, orders: ORDERS_CRM_PATH } = defaultDataPaths(DATA_DIR);

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '15mb' }));

function adminCrmToken() {
  return String(process.env.ADMIN_CRM_TOKEN || '').trim();
}

function checkAdminCrmAuth(req) {
  const t = adminCrmToken();
  if (!t) return false;
  const header = req.headers['x-admin-crm-token'] || req.headers['x-admin-token'];
  const q = req.query?.token;
  return header === t || q === t;
}

if (IS_PROD) {
  const distPath = path.join(PROJECT_ROOT, 'dist');
  app.use(express.static(distPath));
}
const ALLOWED_NETWORKS = new Set(['TRC20', 'ERC20', 'BEP20']);

function envRequired(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function initDataFiles() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
  const defaults = [
    { src: path.join(__dirname, 'data', 'paymentDetails.json'),  dest: DATA_PATH },
    { src: path.join(__dirname, 'data', 'siteConfig.json'),      dest: SITE_CONFIG_PATH },
    { src: path.join(__dirname, 'data', 'stats.json'),           dest: STATS_PATH },
    { src: path.join(__dirname, 'data', 'testimonials.json'),    dest: TESTIMONIALS_PATH },
    { src: path.join(__dirname, 'data', 'visits.json'),          dest: VISITS_PATH },
    { src: path.join(__dirname, 'data', 'ordersLog.json'),       dest: ORDERS_CRM_PATH },
  ];
  for (const { src, dest } of defaults) {
    try { await access(dest); } catch {
      try { await writeFile(dest, await readFile(src, 'utf8'), 'utf8'); } catch { /* ignore */ }
    }
  }
}

async function loadPaymentDetails() {
  let rawText;
  try {
    rawText = await readFile(DATA_PATH, 'utf8');
  } catch {
    rawText = '{}';
  }
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    raw = {};
  }
  const { details, migrated } = migratePaymentDetails(raw);
  if (migrated) {
    await savePaymentDetails(details);
  }
  return details;
}

async function savePaymentDetails(details) {
  const next = {
    ...details,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(DATA_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function loadSiteConfig() {
  try {
    const raw = await readFile(SITE_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { maintenance: { enabled: false }, hero: {}, links: {}, faq: [] };
  }
}

async function saveSiteConfig(cfg) {
  await writeFile(SITE_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

async function loadStats() {
  try {
    const raw = JSON.parse(await readFile(STATS_PATH, 'utf8'));
    return normalizeStats(raw);
  } catch {
    return { ...DEFAULT_STATS };
  }
}
async function saveStats(data) {
  const next = normalizeStats(data);
  await writeFile(STATS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function loadTestimonials() {
  try { return JSON.parse(await readFile(TESTIMONIALS_PATH, 'utf8')); }
  catch { return []; }
}
async function saveTestimonials(data) {
  await writeFile(TESTIMONIALS_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/site-config', async (_req, res) => {
  try {
    res.json(await loadSiteConfig());
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/stats', async (_req, res) => {
  try { res.json(await loadStats()); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

app.get('/api/testimonials', async (_req, res) => {
  try { res.json(await loadTestimonials()); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

async function fetchGeoIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return { country: 'Local', city: '' };
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`, {
      signal: AbortSignal.timeout(3000),
    });
    const d = await res.json();
    if (d.status === 'success') return { country: d.country, city: d.city };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('GeoIP fetch failed', e?.message || e);
  }
  return { country: 'Unknown', city: '' };
}

app.post('/api/track-visit', async (req, res) => {
  try {
    const body = req.body || {};
    const visitorId = String(body.visitorId || '');
    const pagePath = String(body.path || '/');
    if (shouldSkipVisitDedupe(visitorId, pagePath)) {
      return res.json({ ok: true, skipped: true });
    }
    const ip = req.ip || req.socket?.remoteAddress || '';
    const location = await fetchGeoIp(ip.replace(/^::ffff:/, ''));
    const rec = buildVisitRecord(body, req, location);
    await appendVisit(VISITS_PATH, rec);
    res.json({ ok: true, id: rec.id });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/admin/crm/summary', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).json({
        error: adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN in .env',
      });
    }
    const marketing = await loadStats();
    const summary = await buildFullCrmSummary(VISITS_PATH, ORDERS_CRM_PATH, marketing);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/admin/crm/visits', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).json({
        error: adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN in .env',
      });
    }
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const all = await loadVisits(VISITS_PATH);
    const newestFirst = [...all].reverse();
    const slice = newestFirst.slice(offset, offset + limit);
    res.json({ total: all.length, offset, limit, items: slice });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/admin/crm/orders', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).json({
        error: adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN in .env',
      });
    }
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const all = await loadOrders(ORDERS_CRM_PATH);
    const newestFirst = [...all].reverse();
    const slice = newestFirst.slice(offset, offset + limit);
    res.json({ total: all.length, offset, limit, items: slice });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/admin/crm/export/visits.csv', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).send(adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN');
    }
    const all = await loadVisits(VISITS_PATH);
    const csv = visitsToCsv(all);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="visits.csv"');
    res.send('\ufeff' + csv);
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

app.get('/api/admin/crm/export/orders.csv', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).send(adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN');
    }
    const all = await loadOrders(ORDERS_CRM_PATH);
    const csv = ordersToCsv(all);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send('\ufeff' + csv);
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

app.get('/api/admin/crm/report.html', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).send(adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN');
    }
    const marketing = await loadStats();
    const summary = await buildFullCrmSummary(VISITS_PATH, ORDERS_CRM_PATH, marketing);
    const visits = await loadVisits(VISITS_PATH);
    const orders = await loadOrders(ORDERS_CRM_PATH);
    const vSl = getRecentVisits(visits, 200);
    const oSl = getRecentOrders(orders, 200);
    const html = buildPrintableHtmlReport(summary, vSl, oSl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

async function fetchUsdtUsdPrice() {
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBUSD', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error('binance fail');
    const d = await r.json();
    const price = parseFloat(d?.price);
    if (Number.isFinite(price) && price > 0) return price;
  } catch {
    // fallback
  }
  return 1.0;
}

async function computeRate(details) {
  const cfg = details?.rateConfig || {};
  if (cfg.mode === 'float') {
    const base = Number(cfg.floatBase || 1310);
    const offset = Number(cfg.floatOffset || 0);
    const usdtPrice = await fetchUsdtUsdPrice();
    return Math.round(usdtPrice * base + offset);
  }
  return Number(cfg.fixedRate || 1320);
}

app.get('/api/payment-details', async (_req, res) => {
  try {
    const details = await loadPaymentDetails();
    const rate = await computeRate(details);
    res.json(buildPublicPaymentPayload(details, rate));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/order', async (req, res) => {
  try {
    const botToken = envRequired('TELEGRAM_BOT_TOKEN');
    const chatId = envRequired('TELEGRAM_CHAT_ID');

    const {
      orderId,
      name,
      wallet,
      walletNetwork,
      usdtAmount,
      iqdAmount,
      paymentMethod,
      paymentDetail,
      senderNumber,
      paymentProofName,
      paymentProofBase64,
      paymentProofMime,
    } = req.body || {};

    if (!name || !wallet || !walletNetwork || !usdtAmount || !iqdAmount || !paymentMethod) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const amountNum = Number(usdtAmount);
    const normalizedNetwork = String(walletNetwork || '').toUpperCase();
    const walletTrim = String(wallet || '').trim();
    const senderTrim = String(senderNumber || '').trim();

    if (!Number.isFinite(amountNum) || amountNum < 5) {
      return res.status(400).json({ error: 'Minimum amount is 5 USDT' });
    }
    if (!ALLOWED_NETWORKS.has(normalizedNetwork)) {
      return res.status(400).json({ error: 'Unsupported network' });
    }

    const isEvm = normalizedNetwork === 'ERC20' || normalizedNetwork === 'BEP20';
    const walletOk = isEvm ? /^0x[a-fA-F0-9]{40}$/.test(walletTrim) : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletTrim);
    if (!walletOk) {
      return res.status(400).json({ error: 'Invalid wallet format for selected network' });
    }
    if (paymentMethod === 'Asia Hawala' && senderTrim && !/^07\d{9}$/.test(senderTrim)) {
      return res.status(400).json({ error: 'Invalid sender phone number format' });
    }

    const detailsFull = await loadPaymentDetails();
    const rateNum = await computeRate(detailsFull);
    const publicPm = buildPublicPaymentPayload(detailsFull, rateNum);
    const pmKey = PAYMENT_METHOD_LABEL_TO_KEY[paymentMethod];
    if (!pmKey || !publicPm.methods?.[pmKey]) {
      return res.status(400).json({ error: 'Payment method not available for the active profile' });
    }

    const safeOrderId = String(orderId || `ORD-${Date.now().toString(36).toUpperCase()}`);
    const activeProf = getActiveProfile(detailsFull);
    const profileLine = activeProf
      ? `<b>👤 بروفايل المنصة:</b> ${escapeTelegramHtml(activeProf.nameAr)} (${escapeTelegramHtml(activeProf.nameEn)})`
      : null;

    const lines = [
      '🚀 <b>طلب جديد (New Order)</b> 🚀',
      '━━━━━━━━━━━━━━━',
      profileLine,
      `<b>🧾 رقم الطلب:</b> ${escapeTelegramHtml(safeOrderId)}`,
      `<b>👤 الاسم:</b> ${escapeTelegramHtml(name)}`,
      `<b>💰 المبلغ:</b> ${escapeTelegramHtml(String(amountNum))} USDT`,
      `<b>💵 المقابل:</b> ${escapeTelegramHtml(String(iqdAmount))} IQD`,
      `<b>💳 طريقة الدفع:</b> ${escapeTelegramHtml(paymentMethod)}`,
      paymentDetail ? `<b>📱 تفاصيل الدفع:</b> ${escapeTelegramHtml(paymentDetail)}` : null,
      `<b>📥 محفظة الاستلام:</b> <code>${escapeTelegramHtml(walletTrim)}</code>`,
      `<b>🕸️ الشبكة:</b> ${escapeTelegramHtml(normalizedNetwork)}`,
      senderTrim ? `<b>📞 رقم المرسل:</b> ${escapeTelegramHtml(senderTrim)}` : null,
      paymentProofName ? `<b>📎 دليل الدفع:</b> ${escapeTelegramHtml(paymentProofName)}` : null,
      '━━━━━━━━━━━━━━━',
    ].filter(Boolean);

    const { data: tgOrder } = await tgPostJson(botToken, 'sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
    });

    if (!tgOrder?.ok) {
      return res.status(502).json({
        error: 'Telegram send failed',
        details: JSON.stringify(tgOrder || {}),
      });
    }

    // Send payment proof image/document if provided (multipart — reliable in Node)
    let proofSent = false;
    if (paymentProofBase64 && String(paymentProofBase64).length > 0) {
      const buf = Buffer.from(paymentProofBase64, 'base64');
      if (buf.length === 0) {
        return res.status(400).json({ error: 'Invalid payment proof data' });
      }
      const mime = String(paymentProofMime || 'image/jpeg').toLowerCase();
      const extFromName = String(paymentProofName || '').split('.').pop();
      const ext = mime === 'application/pdf'
        ? 'pdf'
        : (extFromName && extFromName.length <= 5 ? extFromName : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg'));
      const filename = String(paymentProofName || `proof-${safeOrderId}.${ext}`);
      const caption = `دليل الدفع — طلب ${safeOrderId}`;

      const photoMime = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
      const usePhoto = photoMime.has(mime);
      const method = usePhoto ? 'sendPhoto' : 'sendDocument';
      const field = usePhoto ? 'photo' : 'document';

      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', caption);
      form.append(field, buf, { filename, contentType: mime });

      const { data: proofTg } = await tgPostMultipart(botToken, method, form);
      if (!proofTg?.ok) {
        // eslint-disable-next-line no-console
        console.error('Telegram proof send failed:', JSON.stringify(proofTg));
        return res.status(502).json({
          error: 'Telegram could not receive payment proof',
          details: JSON.stringify(proofTg || {}),
          orderId: safeOrderId,
        });
      }
      proofSent = true;
    }

    try {
      await appendOrderEvent(ORDERS_CRM_PATH, {
        orderId: safeOrderId,
        name,
        usdtAmount: amountNum,
        paymentMethod,
        network: normalizedNetwork,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CRM] order log failed', err?.message || err);
    }

    res.json({ ok: true, orderId: safeOrderId, proofSent });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- Telegram bot polling for admin updates ---
const adminIds = new Set(String(process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean));

let updateOffset = 0;
let isPolling = false;
const SERVER_START_TS = Math.floor(Date.now() / 1000);
let pendingState = null; // { action, path?, label?, method? }

function isAdminMessage(msg) {
  const fromId = msg?.from?.id;
  return fromId && adminIds.has(String(fromId));
}

function helpText() {
  return [
    '🛠️ أوامر الإدارة - TETHER IQ',
    '━━━━━━━━━━━━━━━',
    '',
    '📋 عرض البيانات:',
    '/pay — عرض بيانات الدفع الحالية',
    '/ratemode — عرض وضع سعر الصرف الحالي',
    '',
    '⏱️ توقيت انتهاء الدفع:',
    '/timer 15 — تعيين وقت الانتهاء بالدقائق',
    '   مثال: /timer 20',
    '',
    '💱 سعر الصرف:',
    '/rate 1350 — سعر ثابت (1350 دينار لكل USDT)',
    '/ratefloat 1310 40 — سعر عائم (سعر Binance × 1310 + 40)',
    '',
    '📷 باركود QR (أرسل صورة مع caption):',
    '   qr fastpay   — باركود FastPay',
    '   qr zain      — باركود زين كاش',
    '   qr fib       — باركود المصرف الأول',
    '   qr mastercard — باركود ماستر كارد',
    '   qr asia      — باركود آسيا حوالة',
    '',
    '📈 CRM (زيارات وطلبات):',
    'من القائمة: زر «CRM» — أو افتح /admin/crm على الموقع مع ADMIN_CRM_TOKEN.',
    '',
    '✏️ تعديل البيانات:',
    '/set methods.fastPay.number 07...',
    '/set methods.zainCash.number 07714740129',
    '/set methods.fib.accountNumber 1234567890',
    '/set methods.fib.accountName TetherIQ Exchange',
    '/set methods.mastercard.cardNumber 4444 5555 6666 7777',
    '/set methods.mastercard.cardHolder TetherIQ',
    '/set methods.asiaHawala.number 07700000000',
    '━━━━━━━━━━━━━━━',
  ].join('\n');
}

function setByPath(obj, p, value) {
  const parts = p.split('.').filter(Boolean);
  if (!parts.length) return false;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return true;
}

async function botSend(text, extra = {}, forceChatId = null) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const defaultChatId = process.env.TELEGRAM_CHAT_ID;
    const finalChatId = forceChatId || extra.chat_id || defaultChatId;

    if (!botToken || !finalChatId) return;

    const { chat_id: _ignoreChat, ...restExtra } = extra;
    const { data } = await tgPostJson(botToken, 'sendMessage', {
      chat_id: finalChatId,
      text,
      parse_mode: 'HTML',
      ...restExtra,
    });

    if (!data?.ok) {
      // eslint-disable-next-line no-console
      console.error(`Bot: sendMessage failed for ${finalChatId}:`, JSON.stringify(data));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Bot: botSend exception:', err);
  }
}

async function sendCrmDocument(chatId, filename, buffer, caption = '') {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken || !chatId) return;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption.slice(0, 1000));
    const mime = filename.endsWith('.csv') ? 'text/csv' : 'text/html';
    form.append('document', buffer, { filename, contentType: mime });
    const { data } = await tgPostMultipart(botToken, 'sendDocument', form);
    if (!data?.ok) {
      // eslint-disable-next-line no-console
      console.error('Bot: sendDocument failed:', JSON.stringify(data));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Bot: sendCrmDocument exception:', err);
  }
}

async function showCrmHome(forceChatId = null) {
  const visits = await loadVisits(VISITS_PATH);
  const orders = await loadOrders(ORDERS_CRM_PATH);
  const vSt = computeVisitStats(visits);
  const oSt = computeOrderStats(orders);

  // Clean top paths display with location and device
  const topPaths = vSt.topPaths
    .map((p) => `• <code>${p.path}</code> (${p.location} · ${p.device}) : ${p.count}`)
    .join('\n') || '—';

  const text = [
    '📈 <b>CRM — ملخص النشاط</b>',
    '━━━━━━━━━━━━━━━',
    `👥 <b>الزيارات:</b> ${vSt.visitsToday} اليوم · ${vSt.visitsWeek} أسبوعياً`,
    `✨ <b>زوّار مميّز (7 أيام):</b> ${vSt.uniqueVisitorsWeek}`,
    '',
    `🛒 <b>الطلبات:</b> ${oSt.ordersToday} اليوم · ${oSt.ordersWeek} أسبوعياً`,
    `💰 <b>حجم التداول (7 أيام):</b> ${oSt.volumeWeek} USDT`,
    '',
    '🔥 <b>الأكثر زيارة:</b>',
    topPaths,
    '',
    '🌐 <b>لوحة الويب:</b> <code>/admin/crm</code>',
  ].join('\n');

  await botSend(text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔎 آخر 5 زيارات', callback_data: 'crm_v5' }, { text: '🛒 آخر 5 طلبات', callback_data: 'crm_o5' }],
        [{ text: '📥 CSV زيارات', callback_data: 'crm_csv_v' }, { text: '📥 CSV طلبات', callback_data: 'crm_csv_o' }],
        [{ text: '📄 تقرير HTML (لـPDF)', callback_data: 'crm_html' }],
        [{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }],
      ],
    },
  }, forceChatId);
}

async function answerCbq(id, text = '') {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;
    await tgAnswerCallbackQuery(botToken, id, text);
  } catch { /* ignore */ }
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 بيانات الدفع', callback_data: 'menu_pay' },
        { text: '💱 سعر الصرف', callback_data: 'menu_rate' },
      ],
      [
        { text: '👤 البروفايلات', callback_data: 'menu_profiles' },
        { text: '✏️ تعديل البيانات', callback_data: 'menu_edit' },
      ],
      [
        { text: '⏱️ وقت الانتهاء', callback_data: 'menu_timer' },
        { text: '⚙️ إعدادات الموقع', callback_data: 'menu_site' },
      ],
      [
        { text: '⭐ التقييمات', callback_data: 'menu_testimonials' },
        { text: '📊 الإحصائيات', callback_data: 'menu_stats' },
      ],
      [
        { text: '📈 CRM — زيارات وطلبات', callback_data: 'menu_crm' },
      ],
    ],
  };
}

function backButton() {
  return { inline_keyboard: [[{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }]] };
}

async function sendMainMenu(forceChatId = null) {
  await botSend(
    '🛠️ <b>لوحة تحكم TETHER IQ</b>\n━━━━━━━━━━━━━━━\n\nاختر من القائمة:',
    { reply_markup: mainMenuKeyboard() },
    forceChatId
  );
}

function cancelButton() {
  return { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_input' }]] };
}

async function showRateMenu(forceChatId = null) {
  const details = await loadPaymentDetails();
  const cfg = details?.rateConfig || {};
  const rate = await computeRate(details);
  const modeAr = cfg.mode === 'float' ? '🔄 عائم' : '📌 ثابت';
  const info = cfg.mode === 'float' ? `(${cfg.floatBase} × USDT + ${cfg.floatOffset})` : '';
  await botSend(
    `💱 <b>سعر الصرف</b>\n━━━━━━━━━━━━━━━\nالوضع: ${modeAr}\nالسعر الحالي: <b>${rate} IQD/USDT</b>${info ? '\n' + info : ''}\n\nاختر:`,
    { reply_markup: { inline_keyboard: [
      [{ text: '📌 تعيين سعر ثابت', callback_data: 'rate_fixed' }, { text: '🔄 وضع عائم', callback_data: 'rate_float' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } },
    forceChatId
  );
}

async function showQrMenu(forceChatId = null) {
  await botSend(
    '📷 <b>إضافة باركود QR</b>\nيتم الحفظ للبروفايل الذي تعدّله حالياً.\n━━━━━━━━━━━━━━━\nاختر طريقة الدفع:',
    { reply_markup: { inline_keyboard: [
      [{ text: '⚡ FastPay', callback_data: 'qr_fastpay' }, { text: '💚 زين كاش', callback_data: 'qr_zain' }],
      [{ text: '🏦 المصرف الأول', callback_data: 'qr_fib' }, { text: '💳 ماستر كارد', callback_data: 'qr_mc' }],
      [{ text: '🌐 آسيا حوالة', callback_data: 'qr_asia' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } },
    forceChatId
  );
}

async function showEditProfilePicker(forceChatId = null) {
  const details = await loadPaymentDetails();
  const rows = details.profiles.map((p, i) => [
    { text: `✏️ ${p.nameAr || p.nameEn || p.id}`, callback_data: `prof_edit_go_${i}` },
  ]);
  rows.push([{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }]);
  await botSend(
    '✏️ <b>اختر البروفايل لتعديل بيانات الدفع</b>\n(كل مدير له حساباته الخاصة)',
    { reply_markup: { inline_keyboard: rows } },
    forceChatId
  );
}

async function showProfilesMenu(forceChatId = null) {
  const details = await loadPaymentDetails();
  const active = details.currentProfileId;
  const rows = details.profiles.map((p, i) => {
    const mark = p.id === active ? ' 🌐' : '';
    return [{ text: `${p.nameAr || p.nameEn}${mark}`, callback_data: `prof_sum_${i}` }];
  });
  rows.push([{ text: '➕ بروفايل جديد', callback_data: 'prof_add' }]);
  rows.push([{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }]);
  await botSend(
    '👤 <b>البروفايلات</b>\n🌐 = البروفايل <b>النشط على الموقع</b> (يظهر للعملاء).\nاضغط لعرض الخيارات.',
    { reply_markup: { inline_keyboard: rows } },
    forceChatId
  );
}

async function showMethodToggleMenu(profileIndex, forceChatId = null) {
  const details = await loadPaymentDetails();
  const p = details.profiles[profileIndex];
  if (!p) return;
  const labels = {
    fastPay: '⚡ FastPay',
    zainCash: '💚 زين كاش',
    asiaHawala: '🌐 آسيا حوالة',
    fib: '🏦 FIB',
    mastercard: '💳 ماستر كارد',
  };
  const rows = METHOD_KEYS.map((key) => {
    const on = p.methodEnabled[key] !== false;
    return [{ text: `${on ? '✅' : '⛔'} ${labels[key]}`, callback_data: `prof_mten_${profileIndex}_${key}` }];
  });
  rows.push([{ text: '🔙 رجوع', callback_data: `prof_sum_${profileIndex}` }]);
  await botSend(
    `⚙️ <b>ظهور طرق الدفع على الموقع</b>\nالبروفايل: <b>${p.nameAr}</b>\n✅ ظاهرة للعملاء — ⛔ مخفية\n(تُطبَّق عندما يكون هذا البروفايل هو 🌐 النشط على المنصة)`,
    { reply_markup: { inline_keyboard: rows } },
    forceChatId
  );
}

async function showEditMenu(forceChatId = null) {
  const details = await loadPaymentDetails();
  const pid = resolveEditingProfileId(details, forceChatId);
  const p = getProfileById(details, pid);
  await botSend(
    `✏️ <b>تعديل البيانات</b>\nالبروفايل: <b>${p.nameAr}</b>\n━━━━━━━━━━━━━━━\nاختر طريقة الدفع:`,
    { reply_markup: { inline_keyboard: [
      [{ text: '⚡ FastPay', callback_data: 'edit_fastpay' }, { text: '💚 زين كاش', callback_data: 'edit_zain' }],
      [{ text: '🌐 آسيا حوالة', callback_data: 'edit_asia' }, { text: '🏦 المصرف الأول', callback_data: 'edit_fib' }],
      [{ text: '💳 ماستر كارد', callback_data: 'edit_mc' }],
      [{ text: '🔙 اختيار بروفايل آخر', callback_data: 'menu_edit' }],
      [{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }],
    ] } },
    forceChatId
  );
}

async function showTimerMenu(forceChatId = null) {
  const details = await loadPaymentDetails();
  await botSend(
    `⏱️ <b>وقت انتهاء الدفع</b>\n━━━━━━━━━━━━━━━\nالوقت الحالي: <b>${details.paymentExpiryMinutes} دقيقة</b>\n\nاختر:`,
    { reply_markup: { inline_keyboard: [
      [{ text: '10 دق', callback_data: 'timer_10' }, { text: '15 دق', callback_data: 'timer_15' }, { text: '20 دق', callback_data: 'timer_20' }],
      [{ text: '30 دق', callback_data: 'timer_30' }, { text: '45 دق', callback_data: 'timer_45' }, { text: '⌨️ تخصيص', callback_data: 'timer_custom' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } },
    forceChatId
  );
}

async function showSiteMenu(forceChatId = null) {
  const cfg = await loadSiteConfig();
  const maint = cfg.maintenance?.enabled ? '🔴 مفعّل' : '🟢 مطفأ';
  await botSend(
    `⚙️ <b>إعدادات الموقع</b>\n━━━━━━━━━━━━━━━\nوضع الصيانة: ${maint}`,
    { reply_markup: { inline_keyboard: [
      [{ text: '❓ الأسئلة الشائعة', callback_data: 'site_faq' }, { text: '🏠 نص الهيرو', callback_data: 'site_hero' }],
      [{ text: '🔗 الروابط', callback_data: 'site_links' }, { text: '🔧 وضع الصيانة', callback_data: 'site_maint' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } },
    forceChatId
  );
}

async function showFaqMenu(forceChatId = null) {
  const cfg = await loadSiteConfig();
  const faqs = cfg.faq || [];
  const rows = faqs.map((f, i) => [
    { text: `${i + 1}. ${f.qAr.slice(0, 25)}...`, callback_data: `faq_view_${f.id}` },
    { text: '🗑️', callback_data: `faq_del_${f.id}` },
  ]);
  rows.push([{ text: '➕ إضافة سؤال جديد', callback_data: 'faq_add' }]);
  rows.push([{ text: '🔙 رجوع', callback_data: 'menu_site' }]);
  await botSend(
    `❓ <b>الأسئلة الشائعة</b>\n━━━━━━━━━━━━━━━\nعدد الأسئلة: ${faqs.length}`,
    { reply_markup: { inline_keyboard: rows } },
    forceChatId
  );
}

async function showHeroMenu(forceChatId = null) {
  const cfg = await loadSiteConfig();
  const h = cfg.hero || {};
  await botSend(
    `🏠 <b>نص الهيرو</b>\n━━━━━━━━━━━━━━━\n<b>عنوان AR:</b> ${h.titleAr || '-'}\n<b>عنوان EN:</b> ${h.titleEn || '-'}\n<b>وصف AR:</b> ${(h.subtitleAr || '-').slice(0, 40)}...\n<b>إعلان AR:</b> ${(h.promoAr || '-').slice(0, 35)}...`,
    { reply_markup: { inline_keyboard: [
      [{ text: '✏️ عنوان عربي', callback_data: 'sf_hero_titleAr' }, { text: '✏️ عنوان إنجليزي', callback_data: 'sf_hero_titleEn' }],
      [{ text: '✏️ وصف عربي', callback_data: 'sf_hero_subtitleAr' }, { text: '✏️ وصف إنجليزي', callback_data: 'sf_hero_subtitleEn' }],
      [{ text: '✏️ إعلان عربي', callback_data: 'sf_hero_promoAr' }, { text: '✏️ إعلان إنجليزي', callback_data: 'sf_hero_promoEn' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_site' }],
    ] } },
    forceChatId
  );
}

async function showLinksMenu(forceChatId = null) {
  const cfg = await loadSiteConfig();
  const l = cfg.links || {};
  await botSend(
    `🔗 <b>الروابط</b>\n━━━━━━━━━━━━━━━\n<b>BNB:</b> <code>${l.bnb || '-'}</code>\n<b>OKX:</b> <code>${l.okx || '-'}</code>\n<b>تواصل معنا:</b> <code>${l.contact || '-'}</code>`,
    { reply_markup: { inline_keyboard: [
      [{ text: '🔗 رابط BNB', callback_data: 'sf_link_bnb' }, { text: '🔗 رابط OKX', callback_data: 'sf_link_okx' }],
      [{ text: '📬 رابط التواصل', callback_data: 'sf_link_contact' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_site' }],
    ] } },
    forceChatId
  );
}

async function showMaintenanceMenu(forceChatId = null) {
  const cfg = await loadSiteConfig();
  const enabled = cfg.maintenance?.enabled;
  await botSend(
    `🔧 <b>وضع الصيانة</b>\n━━━━━━━━━━━━━━━\nالحالة: ${enabled ? '🔴 مفعّل' : '🟢 مطفأ'}\n<b>رسالة AR:</b> ${cfg.maintenance?.messageAr || '-'}\n<b>رسالة EN:</b> ${cfg.maintenance?.messageEn || '-'}`,
    { reply_markup: { inline_keyboard: [
      [{ text: enabled ? '✅ تعطيل الصيانة' : '🔴 تفعيل الصيانة', callback_data: 'maint_toggle' }],
      [{ text: '✏️ رسالة عربية', callback_data: 'sf_maint_messageAr' }, { text: '✏️ رسالة إنجليزية', callback_data: 'sf_maint_messageEn' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_site' }],
    ] } },
    forceChatId
  );
}

async function showTestimonialsMenu(forceChatId = null) {
  const list = await loadTestimonials();
  const rows = list.map((r, i) => [
    { text: `${i + 1}. ${r.nameAr} — ${'⭐'.repeat(r.stars)}`, callback_data: `rev_view_${r.id}` },
    { text: '🗑️', callback_data: `rev_del_${r.id}` },
  ]);
  rows.push([{ text: '➕ إضافة تقييم جديد', callback_data: 'rev_add' }]);
  rows.push([{ text: '🔙 رجوع', callback_data: 'menu_main' }]);
  await botSend(
    `⭐ <b>التقييمات</b>\n━━━━━━━━━━━━━━━\nعدد التقييمات: ${list.length}`,
    { reply_markup: { inline_keyboard: rows } },
    forceChatId
  );
}

async function showStatsMenu(forceChatId = null) {
  const s = await loadStats();
  await botSend(
    `📊 <b>الإحصائيات</b>\n━━━━━━━━━━━━━━━\n👥 العملاء: <b>${s.customers.toLocaleString()}</b>\n✅ العمليات: <b>${s.transactions.toLocaleString()}</b>\n🏆 سنوات الخبرة: <b>${s.years}</b>\n⭐ نسبة الرضا: <b>${s.satisfaction}%</b>\n\nاختر ما تريد تعديله:`,
    { reply_markup: { inline_keyboard: [
      [{ text: '👥 تعديل عدد العملاء', callback_data: 'stat_customers' }],
      [{ text: '✅ تعديل عدد العمليات', callback_data: 'stat_transactions' }],
      [{ text: '🏆 تعديل سنوات الخبرة', callback_data: 'stat_years' }],
      [{ text: '⭐ تعديل نسبة الرضا', callback_data: 'stat_satisfaction' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } },
    forceChatId
  );
}

async function handleCallbackQuery(data, incomingChatId) {
  // ── Main navigation ─────────────────────────────────
  if (data === 'menu_main')  { pendingState = null; await sendMainMenu(incomingChatId); return; }
  if (data === 'cancel_input') { pendingState = null; await sendMainMenu(incomingChatId); return; }

  if (data === 'menu_profiles') {
    await showProfilesMenu(incomingChatId);
    return;
  }

  if (data === 'prof_add') {
    pendingState = { action: 'addProfile', step: 0 };
    await botSend('👤 أرسل <b>اسم البروفايل بالعربية</b> (مثال: علي عدنان):', { reply_markup: cancelButton() }, incomingChatId);
    return;
  }

  if (/^prof_sum_\d+$/.test(data)) {
    const i = Number(data.slice('prof_sum_'.length));
    const details = await loadPaymentDetails();
    const p = details.profiles[i];
    if (!p) return;
    const active = details.currentProfileId === p.id;
    const rows = [
      [{ text: '✏️ تعديل بيانات هذا البروفايل', callback_data: `prof_edit_go_${i}` }],
      [{ text: '⚙️ تفعيل/إيقاف طرق على الموقع', callback_data: `prof_methods_${i}` }],
      [{ text: '🌐 جعله البروفايل النشط للموقع', callback_data: `prof_platform_${i}` }],
    ];
    if (details.profiles.length > 1) {
      rows.push([{ text: '🗑️ حذف هذا البروفايل', callback_data: `prof_del_ask_${i}` }]);
    }
    rows.push([{ text: '🔙 البروفايلات', callback_data: 'menu_profiles' }]);
    await botSend(
      [
        `👤 <b>${p.nameAr}</b>`,
        `<i>${p.nameEn || ''}</i>`,
        '',
        active ? '✅ <b>نشط على الموقع</b> 🌐 (العملاء يرون حسابات هذا البروفايل)' : 'ℹ️ غير نشط على الموقع — استخدم «جعله النشط» للتبديل.',
      ].join('\n'),
      { reply_markup: { inline_keyboard: rows } },
      incomingChatId
    );
    return;
  }

  if (/^prof_del_ask_\d+$/.test(data)) {
    const i = Number(data.slice('prof_del_ask_'.length));
    const details = await loadPaymentDetails();
    const p = details.profiles[i];
    if (!p) return;
    if (details.profiles.length <= 1) {
      await botSend('❌ لا يمكن حذف <b>آخر بروفايل</b>. أنشئ بروفايلاً آخراً أولاً ثم احذف هذا.', { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: `prof_sum_${i}` }]] } }, incomingChatId);
      return;
    }
    await botSend(
      `🗑️ <b>تأكيد الحذف</b>\nسيتم حذف البروفايل «<b>${escapeTelegramHtml(p.nameAr)}</b>» وجميع حساباته المرتبطة به نهائياً.\nهل أنت متأكد؟`,
      { reply_markup: { inline_keyboard: [
        [{ text: '✅ نعم، احذف', callback_data: `prof_del_yes_${i}` }],
        [{ text: '❌ إلغاء', callback_data: `prof_sum_${i}` }],
      ] } },
      incomingChatId
    );
    return;
  }

  if (/^prof_del_yes_\d+$/.test(data)) {
    const i = Number(data.slice('prof_del_yes_'.length));
    const details = await loadPaymentDetails();
    if (details.profiles.length <= 1) {
      await botSend('❌ لا يمكن حذف آخر بروفايل.', {}, incomingChatId);
      return;
    }
    const victim = details.profiles[i];
    if (!victim) return;
    const victimId = victim.id;
    const nextProfiles = details.profiles.filter((_, idx) => idx !== i);
    let nextCurrent = details.currentProfileId;
    if (details.currentProfileId === victimId) {
      nextCurrent = nextProfiles[0]?.id;
    }
    for (const [cid, ctx] of [...adminProfileContext.entries()]) {
      if (ctx.profileId === victimId) adminProfileContext.delete(cid);
    }
    await savePaymentDetails({ ...details, profiles: nextProfiles, currentProfileId: nextCurrent });
    await botSend(
      `✅ تم حذف البروفايل <b>${escapeTelegramHtml(victim.nameAr)}</b>.`,
      { reply_markup: { inline_keyboard: [[{ text: '👤 البروفايلات', callback_data: 'menu_profiles' }]] } },
      incomingChatId
    );
    return;
  }

  if (/^prof_edit_go_\d+$/.test(data)) {
    const i = Number(data.slice('prof_edit_go_'.length));
    const details = await loadPaymentDetails();
    const p = details.profiles[i];
    if (!p) return;
    setEditingProfile(incomingChatId, p.id);
    await showEditMenu(incomingChatId);
    return;
  }

  if (/^prof_platform_\d+$/.test(data)) {
    const i = Number(data.slice('prof_platform_'.length));
    const details = await loadPaymentDetails();
    const p = details.profiles[i];
    if (!p) return;
    await savePaymentDetails({ ...details, currentProfileId: p.id });
    await botSend(
      `✅ البروفايل النشط على <b>الموقع</b> أصبح:\n<b>${p.nameAr}</b>\nعند الشراء، تظهر للعميل حسابات هذا البروفايل فقط (مع احترام طرق الدفع المفعّلة).`,
      { reply_markup: { inline_keyboard: [[{ text: '🔙 البروفايلات', callback_data: 'menu_profiles' }]] } },
      incomingChatId
    );
    return;
  }

  if (/^prof_methods_\d+$/.test(data)) {
    const i = Number(data.slice('prof_methods_'.length));
    await showMethodToggleMenu(i, incomingChatId);
    return;
  }

  if (/^prof_mten_\d+_/.test(data)) {
    const m = data.match(/^prof_mten_(\d+)_(.+)$/);
    if (!m) return;
    const i = Number(m[1]);
    const methodKey = m[2];
    if (!METHOD_KEYS.includes(methodKey)) return;
    const details = await loadPaymentDetails();
    const prof = details.profiles[i];
    if (!prof) return;
    const curOn = prof.methodEnabled[methodKey] !== false;
    const profiles = [...details.profiles];
    profiles[i] = {
      ...prof,
      methodEnabled: { ...prof.methodEnabled, [methodKey]: !curOn },
    };
    await savePaymentDetails({ ...details, profiles });
    await showMethodToggleMenu(i, incomingChatId);
    return;
  }

  if (data === 'menu_pay') {
    const details = await loadPaymentDetails();
    const rate = await computeRate(details);
    const active = getActiveProfile(details);
    const m = active?.methods || {};
    await botSend(
      [
        '📋 <b>بيانات الدفع (النشط على الموقع)</b>',
        `👤 <b>البروفايل:</b> ${active?.nameAr || '-'} (${active?.nameEn || ''})`,
        '━━━━━━━━━━━━━━━',
        `💱 السعر: <b>${rate} IQD/USDT</b>`,
        `⏱️ وقت الانتهاء: <b>${details.paymentExpiryMinutes} دقيقة</b>`,
        '', '🔷 <b>FastPay:</b> ' + (m.fastPay?.number || '-'),
        '🔷 <b>زين كاش:</b> ' + (m.zainCash?.number || '-'),
        '🔷 <b>آسيا حوالة:</b> ' + (m.asiaHawala?.number || '-'),
        '🔷 <b>المصرف الأول:</b> ' + (m.fib?.accountNumber || '-'),
        '🔷 <b>ماستر كارد:</b> ' + (m.mastercard?.cardNumber || '-'),
      ].join('\n'),
      { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_main' }]] } },
      incomingChatId
    );
    return;
  }

  if (data === 'menu_rate')  { await showRateMenu(incomingChatId);  return; }
  if (data === 'menu_qr')    { await showQrMenu(incomingChatId);    return; }
  if (data === 'menu_edit')  { await showEditProfilePicker(incomingChatId);  return; }
  if (data === 'menu_timer') { await showTimerMenu(incomingChatId); return; }

  // ── Rate ────────────────────────────────────────────
  if (data === 'rate_fixed') {
    pendingState = { action: 'rateFixed' };
    await botSend('💱 أرسل السعر الجديد بالدينار العراقي\nمثال: <code>1350</code>', { reply_markup: cancelButton() }, incomingChatId);
    return;
  }
  if (data === 'rate_float') {
    pendingState = { action: 'rateFloat' };
    await botSend('🔄 أرسل: <code>الأساس المكسب</code>\nمثال: <code>1310 40</code>\n(السعر = USDT × الأساس + المكسب)', { reply_markup: cancelButton() }, incomingChatId);
    return;
  }

  // ── QR ──────────────────────────────────────────────
  const qrMap = {
    qr_fastpay: ['fastpay', 'FastPay', 'edit_fastpay'],
    qr_zain: ['zain', 'زين كاش', 'edit_zain'],
    qr_fib: ['fib', 'المصرف الأول', 'edit_fib'],
    qr_mc: ['mastercard', 'ماستر كارد', 'edit_mc'],
    qr_asia: ['asia', 'آسيا حوالة', 'edit_asia'],
  };
  if (qrMap[data]) {
    const [method, label, backTo] = qrMap[data];
    const details = await loadPaymentDetails();
    const pid = resolveEditingProfileId(details, incomingChatId);
    pendingState = { action: 'awaitPhoto', method, label, backTo, profileId: pid };
    await botSend(`📷 أرسل صورة باركود <b>${label}</b> الآن`, { reply_markup: cancelButton() }, incomingChatId);
    return;
  }

  // ── Edit method selection ────────────────────────────
  if (data === 'edit_fastpay') {
    const details = await loadPaymentDetails();
    const d = getEditingProfile(details, incomingChatId);
    if (!d?.methods) return;
    await botSend(
      `✏️ <b>FastPay</b>\nالرقم: <code>${d.methods?.fastPay?.number || '-'}</code>\nالباركود: ${d.methods?.fastPay?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '📱 تغيير الرقم', callback_data: 'ef_fastpay_num' }, { text: '📷 تحديث الباركود', callback_data: 'qr_fastpay' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } },
      incomingChatId
    );
    return;
  }
  if (data === 'edit_zain') {
    const details = await loadPaymentDetails();
    const d = getEditingProfile(details, incomingChatId);
    if (!d?.methods) return;
    await botSend(
      `✏️ <b>زين كاش</b>\nالرقم: <code>${d.methods?.zainCash?.number || '-'}</code>\nالباركود: ${d.methods?.zainCash?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '📱 تغيير الرقم', callback_data: 'ef_zain_num' }, { text: '📷 تحديث الباركود', callback_data: 'qr_zain' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } },
      incomingChatId
    );
    return;
  }
  if (data === 'edit_asia') {
    const details = await loadPaymentDetails();
    const d = getEditingProfile(details, incomingChatId);
    if (!d?.methods) return;
    await botSend(
      `✏️ <b>آسيا حوالة</b>\nالرقم: <code>${d.methods?.asiaHawala?.number || '-'}</code>\nالباركود: ${d.methods?.asiaHawala?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '📱 تغيير الرقم', callback_data: 'ef_asia_num' }, { text: '📷 تحديث الباركود', callback_data: 'qr_asia' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } },
      incomingChatId
    );
    return;
  }
  if (data === 'edit_fib') {
    const details = await loadPaymentDetails();
    const d = getEditingProfile(details, incomingChatId);
    if (!d?.methods) return;
    await botSend(
      `✏️ <b>المصرف الأول (FIB)</b>\nرقم الحساب: <code>${d.methods?.fib?.accountNumber || '-'}</code>\nاسم الحساب: <code>${d.methods?.fib?.accountName || '-'}</code>\nالباركود: ${d.methods?.fib?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '🔢 رقم الحساب', callback_data: 'ef_fib_num' }, { text: '✍️ اسم الحساب', callback_data: 'ef_fib_name' }],
        [{ text: '📷 تحديث الباركود', callback_data: 'qr_fib' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } },
      incomingChatId
    );
    return;
  }
  if (data === 'edit_mc') {
    const details = await loadPaymentDetails();
    const d = getEditingProfile(details, incomingChatId);
    if (!d?.methods) return;
    await botSend(
      `✏️ <b>ماستر كارد</b>\nرقم البطاقة: <code>${d.methods?.mastercard?.cardNumber || '-'}</code>\nاسم الحامل: <code>${d.methods?.mastercard?.cardHolder || '-'}</code>\nالباركود: ${d.methods?.mastercard?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '💳 رقم البطاقة', callback_data: 'ef_mc_num' }, { text: '✍️ اسم الحامل', callback_data: 'ef_mc_holder' }],
        [{ text: '📷 تحديث الباركود', callback_data: 'qr_mc' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } },
      incomingChatId
    );
    return;
  }

  // ── Edit fields (await text input) ──────────────────
  const fieldMap = {
    ef_fastpay_num: ['fastPay.number',       'رقم FastPay',         'menu_edit'],
    ef_zain_num:   ['zainCash.number',       'رقم زين كاش',        'menu_edit'],
    ef_asia_num:   ['asiaHawala.number',     'رقم آسيا حوالة',      'menu_edit'],
    ef_fib_num:    ['fib.accountNumber',     'رقم حساب FIB',        'edit_fib'],
    ef_fib_name:   ['fib.accountName',       'اسم حساب FIB',        'edit_fib'],
    ef_mc_num:     ['mastercard.cardNumber', 'رقم بطاقة ماستر كارد','edit_mc'],
    ef_mc_holder:  ['mastercard.cardHolder', 'اسم حامل البطاقة',    'edit_mc'],
  };
  if (fieldMap[data]) {
    const details = await loadPaymentDetails();
    const profileId = resolveEditingProfileId(details, incomingChatId);
    const [path, label, backTo] = fieldMap[data];
    pendingState = { action: 'editField', path, label, backTo, profileId };
    await botSend(`✏️ أرسل <b>${label}</b> الجديد:`, { reply_markup: cancelButton() }, incomingChatId);
    return;
  }

  // ── Timer presets ────────────────────────────────────
  const timerPresets = { timer_10: 10, timer_15: 15, timer_20: 20, timer_30: 30, timer_45: 45 };
  if (timerPresets[data]) {
    const mins = timerPresets[data];
    const details = await loadPaymentDetails();
    await savePaymentDetails({ ...details, paymentExpiryMinutes: mins });
    await botSend(`✅ تم تعيين وقت الانتهاء: <b>${mins} دقيقة</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_timer' }]] } }, incomingChatId);
    return;
  }
  if (data === 'timer_custom') {
    pendingState = { action: 'setTimer' };
    await botSend('⏱️ أرسل عدد الدقائق (1-180):\nمثال: <code>25</code>', { reply_markup: cancelButton() }, incomingChatId);
    return;
  }

  // ── Site settings ────────────────────────────────────
  if (data === 'menu_site')         { await showSiteMenu(incomingChatId);         return; }
  if (data === 'site_faq')          { await showFaqMenu(incomingChatId);          return; }
  if (data === 'site_hero')         { await showHeroMenu(incomingChatId);         return; }
  if (data === 'site_links')        { await showLinksMenu(incomingChatId);        return; }
  if (data === 'site_maint')        { await showMaintenanceMenu(incomingChatId);  return; }
  if (data === 'menu_testimonials') { await showTestimonialsMenu(incomingChatId); return; }
  if (data === 'menu_stats')        { await showStatsMenu(incomingChatId);        return; }

  if (data === 'menu_crm') {
    await showCrmHome(incomingChatId);
    return;
  }

  if (data === 'crm_v5') {
    const visits = await loadVisits(VISITS_PATH);
    const last = getRecentVisits(visits, 5);
    const body = last.length
      ? last.map((v) => `• ${v.at}\n  ${v.path} · ${v.device} · ${v.ip || '-'} · ${v.lang || ''}`).join('\n\n')
      : 'لا توجد زيارات بعد.';
    await botSend(`🔎 <b>آخر 5 زيارات</b>\n<pre>${escapeTelegramHtml(body)}</pre>`, {}, incomingChatId);
    return;
  }

  if (data === 'crm_o5') {
    const orders = await loadOrders(ORDERS_CRM_PATH);
    const last = getRecentOrders(orders, 5);
    const body = last.length
      ? last.map((o) => `• ${o.orderId}\n  ${o.name} · ${o.usdtAmount} USDT · ${o.paymentMethod}`).join('\n\n')
      : 'لا طلبات مسجّلة بعد.';
    await botSend(`🛒 <b>آخر 5 طلبات</b>\n<pre>${escapeTelegramHtml(body)}</pre>`, {}, incomingChatId);
    return;
  }

  if (data === 'crm_csv_v') {
    const all = await loadVisits(VISITS_PATH);
    const csv = visitsToCsv(all);
    await sendCrmDocument(incomingChatId, 'visits-export.csv', Buffer.from('\ufeff' + csv, 'utf8'), `تصدير ${all.length} زيارة`);
    return;
  }

  if (data === 'crm_csv_o') {
    const all = await loadOrders(ORDERS_CRM_PATH);
    const csv = ordersToCsv(all);
    await sendCrmDocument(incomingChatId, 'orders-export.csv', Buffer.from('\ufeff' + csv, 'utf8'), `تصدير ${all.length} طلب`);
    return;
  }

  if (data === 'crm_html') {
    const marketing = await loadStats();
    const summary = await buildFullCrmSummary(VISITS_PATH, ORDERS_CRM_PATH, marketing);
    const visits = await loadVisits(VISITS_PATH);
    const orders = await loadOrders(ORDERS_CRM_PATH);
    const vSl = getRecentVisits(visits, 200);
    const oSl = getRecentOrders(orders, 200);
    const html = buildPrintableHtmlReport(summary, vSl, oSl);
    await sendCrmDocument(
      incomingChatId,
      'crm-report.html',
      Buffer.from(html, 'utf8'),
      'افتح الملف في المتصفح ← طباعة / حفظ PDF',
    );
    return;
  }

  // ── Maintenance toggle ───────────────────────────────
  if (data === 'maint_toggle') {
    const cfg = await loadSiteConfig();
    if (!cfg.maintenance) cfg.maintenance = {};
    cfg.maintenance.enabled = !cfg.maintenance.enabled;
    await saveSiteConfig(cfg);
    const st = cfg.maintenance.enabled ? '🔴 مفعّل' : '🟢 مطفأ';
    await botSend(`✅ وضع الصيانة: <b>${st}</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'site_maint' }]] } });
    return;
  }

  // ── FAQ view / delete ────────────────────────────────
  if (data.startsWith('faq_view_')) {
    const id = Number(data.replace('faq_view_', ''));
    const cfg = await loadSiteConfig();
    const f = (cfg.faq || []).find(x => x.id === id);
    if (!f) { await botSend('❌ السؤال غير موجود'); return; }
    await botSend(
      `❓ <b>السؤال #${id}</b>\n\n�� <b>${f.qAr}</b>\n${f.aAr}\n\n🇬🇧 <b>${f.qEn}</b>\n${f.aEn}`,
      { reply_markup: { inline_keyboard: [[{ text: '🗑️ حذف', callback_data: `faq_del_${id}` }, { text: '🔙 رجوع', callback_data: 'site_faq' }]] } }
    );
    return;
  }
  if (data.startsWith('faq_del_')) {
    const id = Number(data.replace('faq_del_', ''));
    const cfg = await loadSiteConfig();
    cfg.faq = (cfg.faq || []).filter(x => x.id !== id);
    await saveSiteConfig(cfg);
    await botSend('✅ تم حذف السؤال', { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'site_faq' }]] } });
    return;
  }
  if (data === 'faq_add') {
    pendingState = { action: 'addFaq', step: 0, data: {} };
    await botSend('❓ أرسل <b>السؤال بالعربية:</b>', { reply_markup: cancelButton() });
    return;
  }

  // ── Testimonials ──────────────────────────────────────
  if (data.startsWith('rev_view_')) {
    const id = Number(data.replace('rev_view_', ''));
    const list = await loadTestimonials();
    const r = list.find(x => x.id === id);
    if (!r) { await botSend('❌ التقييم غير موجود'); return; }
    await botSend(
      `⭐ <b>تقييم #${id}</b>\n👤 ${r.nameAr} / ${r.nameEn}\n📍 ${r.cityAr} / ${r.cityEn}\n${'⭐'.repeat(r.stars)}\n\n🇸🇦 ${r.textAr}\n🇬🇧 ${r.textEn}`,
      { reply_markup: { inline_keyboard: [[{ text: '🗑️ حذف', callback_data: `rev_del_${id}` }, { text: '🔙 رجوع', callback_data: 'menu_testimonials' }]] } }
    );
    return;
  }
  if (data.startsWith('rev_del_')) {
    const id = Number(data.replace('rev_del_', ''));
    const list = await loadTestimonials();
    await saveTestimonials(list.filter(x => x.id !== id));
    await botSend('✅ تم حذف التقييم', { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_testimonials' }]] } });
    return;
  }
  if (data === 'rev_add') {
    pendingState = { action: 'addReview', step: 0, data: {} };
    await botSend('👤 أرسل <b>الاسم بالعربية:</b>', { reply_markup: cancelButton() });
    return;
  }

  // ── Stats ─────────────────────────────────────────────
  const statFieldMap = {
    stat_customers:    ['customers',    'عدد العملاء',      'menu_stats'],
    stat_transactions: ['transactions', 'عدد العمليات',     'menu_stats'],
    stat_years:        ['years',        'سنوات الخبرة',     'menu_stats'],
    stat_satisfaction: ['satisfaction', 'نسبة الرضا (%)',   'menu_stats'],
  };
  if (statFieldMap[data]) {
    const [field, label, backTo] = statFieldMap[data];
    pendingState = { action: 'setStat', field, label, backTo };
    await botSend(`📊 أرسل القيمة الجديدة لـ <b>${label}</b> (رقم فقط):`, { reply_markup: cancelButton() });
    return;
  }

  // ── Site field edit (hero / links / maintenance messages) ──
  const siteFieldMap = {
    sf_hero_titleAr:    ['hero.titleAr',              'العنوان العربي',      'site_hero'],
    sf_hero_titleEn:    ['hero.titleEn',              'العنوان الإنجليزي',   'site_hero'],
    sf_hero_subtitleAr: ['hero.subtitleAr',           'الوصف العربي',       'site_hero'],
    sf_hero_subtitleEn: ['hero.subtitleEn',           'الوصف الإنجليزي',    'site_hero'],
    sf_hero_promoAr:    ['hero.promoAr',              'الإعلان العربي',     'site_hero'],
    sf_hero_promoEn:    ['hero.promoEn',              'الإعلان الإنجليزي',  'site_hero'],
    sf_link_bnb:        ['links.bnb',                 'رابط BNB',           'site_links'],
    sf_link_okx:        ['links.okx',                 'رابط OKX',           'site_links'],
    sf_link_contact:    ['links.contact',             'رابط التواصل',       'site_links'],
    sf_maint_messageAr: ['maintenance.messageAr',     'رسالة الصيانة AR',   'site_maint'],
    sf_maint_messageEn: ['maintenance.messageEn',     'رسالة الصيانة EN',   'site_maint'],
  };
  if (siteFieldMap[data]) {
    const [dotPath, label, backTo] = siteFieldMap[data];
    pendingState = { action: 'editSiteField', dotPath, label, backTo };
    await botSend(`✏️ أرسل <b>${label}</b> الجديد:`, { reply_markup: cancelButton() });
    return;
  }
}

async function persistEnvKey(key, value) {
  const envPath = path.join(PROJECT_ROOT, '.env');
  let content = '';
  try {
    content = await readFile(envPath, 'utf8');
  } catch {
    content = '';
  }

  const lines = content.split(/\r?\n/);
  const nextLines = [];
  let replaced = false;

  for (const line of lines) {
    if (!line) {
      nextLines.push(line);
      continue;
    }
    if (line.startsWith(`${key}=`)) {
      nextLines.push(`${key}=${value}`);
      replaced = true;
    } else {
      nextLines.push(line);
    }
  }

  if (!replaced) nextLines.push(`${key}=${value}`);
  await writeFile(envPath, nextLines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
}

function maybeAutoConfigureFromMessage(msg) {
  const fromId = msg?.from?.id;
  if (!fromId) return;

  if (!process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE') {
    process.env.TELEGRAM_CHAT_ID = String(fromId);
    persistEnvKey('TELEGRAM_CHAT_ID', String(fromId)).catch(() => {});
    // eslint-disable-next-line no-console
    console.log(`Auto-config: TELEGRAM_CHAT_ID set to ${process.env.TELEGRAM_CHAT_ID} (saved to .env)`);
  }

  if (adminIds.size === 0) {
    const id = String(fromId);
    adminIds.add(id);
    persistEnvKey('TELEGRAM_ADMIN_IDS', id).catch(() => {});
    // eslint-disable-next-line no-console
    console.log(`Auto-config: TELEGRAM_ADMIN_IDS set to ${id} (saved to .env)`);
  }
}

async function handleAdminCommand(text, incomingChatId) {
  const raw = String(text || '').trim();
  const trimmed = raw.toLowerCase();

  // eslint-disable-next-line no-console
  console.log(`Bot Command Received: "${raw}" from Chat: ${incomingChatId}`);

  // ── Handle pending input state ──────────────────────
  if (pendingState) {
    const st = pendingState;
    pendingState = null;

    if (st.action === 'rateFixed') {
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 100 || val > 100000) {
        await botSend('❌ رقم غير صالح. مثال: <code>1350</code>', { reply_markup: cancelButton() }, incomingChatId);
        pendingState = st;
        return;
      }
      const details = await loadPaymentDetails();
      if (!details.rateConfig) details.rateConfig = {};
      details.rateConfig.mode = 'fixed';
      details.rateConfig.fixedRate = val;
      await savePaymentDetails(details);
      await botSend(`✅ السعر الثابت: <b>${val} IQD/USDT</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 سعر الصرف', callback_data: 'menu_rate' }]] } }, incomingChatId);
      return;
    }

    if (st.action === 'rateFloat') {
      const parts = raw.split(/\s+/);
      const base = Number(parts[0]), offset = Number(parts[1] || 0);
      if (!Number.isFinite(base) || base < 100) {
        await botSend('❌ صيغة خاطئة. مثال: <code>1310 40</code>', { reply_markup: cancelButton() }, incomingChatId);
        pendingState = st;
        return;
      }
      const details = await loadPaymentDetails();
      if (!details.rateConfig) details.rateConfig = {};
      details.rateConfig.mode = 'float';
      details.rateConfig.floatBase = base;
      details.rateConfig.floatOffset = Number.isFinite(offset) ? offset : 0;
      await savePaymentDetails(details);
      const effective = await computeRate(details);
      await botSend(`✅ وضع عائم: Base=${base}, Offset=${offset}\nالسعر الحالي: <b>${effective} IQD/USDT</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 سعر الصرف', callback_data: 'menu_rate' }]] } }, incomingChatId);
      return;
    }

    if (st.action === 'setTimer') {
      const mins = Number(raw);
      if (!Number.isFinite(mins) || mins < 1 || mins > 180) {
        await botSend('❌ رقم غير صالح (1-180). مثال: <code>20</code>', { reply_markup: cancelButton() }, incomingChatId);
        pendingState = st;
        return;
      }
      const details = await loadPaymentDetails();
      await savePaymentDetails({ ...details, paymentExpiryMinutes: mins });
      await botSend(`✅ وقت الانتهاء: <b>${mins} دقيقة</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_timer' }]] } }, incomingChatId);
      return;
    }

    if (st.action === 'editField') {
      const details = await loadPaymentDetails();
      const pid = st.profileId || resolveEditingProfileId(details, incomingChatId);
      const idx = profileIndex(details, pid);
      if (idx < 0) {
        await botSend('❌ بروفايل غير موجود.', {}, incomingChatId);
        return;
      }
      const profiles = [...details.profiles];
      const prof = { ...profiles[idx], methods: JSON.parse(JSON.stringify(profiles[idx].methods)) };
      setByPath(prof.methods, st.path, raw);
      profiles[idx] = prof;
      await savePaymentDetails({ ...details, profiles });
      pendingState = null;
      await botSend(`✅ تم تحديث <b>${st.label}</b> للبروفايل <b>${prof.nameAr}</b>: <code>${raw}</code>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: st.backTo || 'menu_edit' }]] } }, incomingChatId);
      return;
    }

    if (st.action === 'addProfile') {
      const d = st.data || {};
      if (st.step === 0) {
        pendingState = { action: 'addProfile', step: 1, data: { nameAr: raw } };
        await botSend('أرسل <b>الاسم بالإنجليزية</b> (اختياري — يمكن إرسال نفس العربي):', { reply_markup: cancelButton() }, incomingChatId);
        return;
      }
      if (st.step === 1) {
        const details = await loadPaymentDetails();
        const id = newProfileId();
        const nameEn = raw.trim() || d.nameAr;
        const newP = normalizeProfile({
          id,
          nameAr: d.nameAr,
          nameEn,
          methodEnabled: defaultMethodEnabled(),
          methods: defaultEmptyMethods(),
        });
        await savePaymentDetails({ ...details, profiles: [...details.profiles, newP] });
        pendingState = null;
        await botSend(`✅ تم إنشاء البروفايل:\n<b>${newP.nameAr}</b>\nاضغط «البروفايلات» لجعله نشطاً على الموقع أو تعديل حساباته.`, { reply_markup: { inline_keyboard: [[{ text: '👤 البروفايلات', callback_data: 'menu_profiles' }]] } }, incomingChatId);
        return;
      }
    }

    if (st.action === 'editSiteField') {
      const cfg = await loadSiteConfig();
      setByPath(cfg, st.dotPath, raw);
      await saveSiteConfig(cfg);
      await botSend(`✅ تم تحديث <b>${st.label}</b>: <code>${raw.slice(0, 60)}</code>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: st.backTo || 'menu_site' }]] } });
      return;
    }

    if (st.action === 'addFaq') {
      const d = st.data || {};
      if (st.step === 0) {
        pendingState = { action: 'addFaq', step: 1, data: { qAr: raw } };
        await botSend('✍️ أرسل <b>الجواب بالعربية:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 1) {
        pendingState = { action: 'addFaq', step: 2, data: { ...d, aAr: raw } };
        await botSend('🇬🇧 أرسل <b>السؤال بالإنجليزية:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 2) {
        pendingState = { action: 'addFaq', step: 3, data: { ...d, qEn: raw } };
        await botSend('✍️ أرسل <b>الجواب بالإنجليزية:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 3) {
        const cfg = await loadSiteConfig();
        const newId = Date.now();
        cfg.faq = [...(cfg.faq || []), { id: newId, qAr: d.qAr, aAr: d.aAr, qEn: d.qEn, aEn: raw }];
        await saveSiteConfig(cfg);
        await botSend(`✅ تمت إضافة السؤال:\n🇸🇦 <b>${d.qAr}</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 الأسئلة الشائعة', callback_data: 'site_faq' }]] } });
        return;
      }
    }

    if (st.action === 'addReview') {
      const d = st.data || {};
      if (st.step === 0) { pendingState = { action: 'addReview', step: 1, data: { nameAr: raw } }; await botSend(' أرسل <b>المدينة بالعربية:</b>', { reply_markup: cancelButton() }); return; }
      if (st.step === 1) { pendingState = { action: 'addReview', step: 2, data: { ...d, cityAr: raw } }; await botSend('⭐ أرسل <b>عدد النجوم (1-5):</b>', { reply_markup: cancelButton() }); return; }
      if (st.step === 2) {
        const stars = Math.min(5, Math.max(1, Number(raw) || 5));
        pendingState = { action: 'addReview', step: 3, data: { ...d, stars } };
        await botSend('✍️ أرسل <b>نص التقييم:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 3) {
        const list = await loadTestimonials();
        const newItem = { id: Date.now(), nameAr: d.nameAr, nameEn: d.nameAr, cityAr: d.cityAr, cityEn: d.cityAr, stars: d.stars, textAr: raw, textEn: raw };
        await saveTestimonials([...list, newItem]);
        await botSend(`✅ تمت إضافة التقييم:\n⭐ <b>${d.nameAr}</b> — ${'⭐'.repeat(d.stars)}`, { reply_markup: { inline_keyboard: [[{ text: '🔙 التقييمات', callback_data: 'menu_testimonials' }]] } });
        return;
      }
    }

    if (st.action === 'setStat') {
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 0) {
        await botSend('❌ أرسل رقماً صحيحاً موجباً.', { reply_markup: cancelButton() }, incomingChatId);
        pendingState = st;
        return;
      }
      const stats = await loadStats();
      stats[st.field] = val;
      await saveStats(stats);
      await botSend(`✅ تم تحديث <b>${st.label}</b>: <code>${val}</code>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 الإحصائيات', callback_data: 'menu_stats' }]] } }, incomingChatId);
      return;
    }

    // unknown pending state - fall through
  }

  if (!trimmed.startsWith('/')) return;

  if (trimmed === '/help' || trimmed === '/start') {
    await sendMainMenu(incomingChatId);
    return;
  }

  if (trimmed === '/pay' || trimmed === '/pay@' + (process.env.BOT_USERNAME || '').toLowerCase()) {
    const details = await loadPaymentDetails();
    const rate = await computeRate(details);
    const pub = buildPublicPaymentPayload(details, rate);
    const overview = {
      publicSitePayload: pub,
      profiles: details.profiles.map((p) => ({
        id: p.id,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        activeOnSite: p.id === details.currentProfileId,
        methodEnabled: p.methodEnabled,
      })),
    };
    await botSend(`<pre>${escapeTelegramHtml(JSON.stringify(overview, null, 2))}</pre>`, {}, incomingChatId);
    return;
  }

  if (trimmed.startsWith('/timer ')) {
    const mins = Number(trimmed.slice(7).trim());
    if (!Number.isFinite(mins) || mins <= 0 || mins > 180) {
      await botSend('Invalid minutes. Use 1..180');
      return;
    }
    const details = await loadPaymentDetails();
    const saved = await savePaymentDetails({ ...details, paymentExpiryMinutes: mins });
    await botSend(`✅ Updated paymentExpiryMinutes = ${saved.paymentExpiryMinutes}`);
    return;
  }

  if (trimmed.startsWith('/rate ')) {
    const val = Number(trimmed.slice(6).trim());
    if (!Number.isFinite(val) || val < 100 || val > 100000) {
      await botSend('❌ Invalid rate. Use e.g. /rate 1350');
      return;
    }
    const details = await loadPaymentDetails();
    if (!details.rateConfig) details.rateConfig = {};
    details.rateConfig.mode = 'fixed';
    details.rateConfig.fixedRate = val;
    await savePaymentDetails(details);
    await botSend(`✅ Rate set to FIXED: ${val} IQD/USDT`);
    return;
  }

  if (trimmed.startsWith('/ratefloat')) {
    const parts = trimmed.slice(10).trim().split(/\s+/);
    const base = Number(parts[0]);
    const offset = Number(parts[1] || 0);
    if (!Number.isFinite(base) || base < 100) {
      await botSend('❌ Usage: /ratefloat <iqdBase> <offset>\nمثال: /ratefloat 1310 40');
      return;
    }
    const details = await loadPaymentDetails();
    if (!details.rateConfig) details.rateConfig = {};
    details.rateConfig.mode = 'float';
    details.rateConfig.floatBase = base;
    details.rateConfig.floatOffset = Number.isFinite(offset) ? offset : 0;
    await savePaymentDetails(details);
    await botSend(`✅ Rate set to FLOAT: base=${base} IQD/USD, offset=${details.rateConfig.floatOffset}\nالسعر = (سعر USDT بالدولار × ${base}) + ${details.rateConfig.floatOffset}`);
    return;
  }

  if (trimmed === '/ratemode') {
    const details = await loadPaymentDetails();
    const cfg = details?.rateConfig || {};
    const rate = await computeRate(details);
    const modeText = cfg.mode === 'float'
      ? `🔄 عائم (Float)\nBase: ${cfg.floatBase} IQD/USD\nOffset: ${cfg.floatOffset}`
      : `📌 ثابت (Fixed): ${cfg.fixedRate} IQD/USDT`;
    await botSend(`💱 Rate Mode: ${modeText}\n\n📊 السعر الحالي: ${rate} IQD/USDT`, {}, incomingChatId);
    return;
  }

  if (trimmed.startsWith('/set ')) {
    const rest = trimmed.slice(5).trim();
    const firstSpace = rest.indexOf(' ');
    if (firstSpace === -1) {
      await botSend('Usage: /set methods.zainCash.number 077... (يُطبَّق على البروفايل النشط للموقع)', {}, incomingChatId);
      return;
    }
    const p = rest.slice(0, firstSpace).trim();
    const value = rest.slice(firstSpace + 1).trim();
    const details = await loadPaymentDetails();
    if (p.startsWith('methods.')) {
      const pid = details.currentProfileId;
      const idx = profileIndex(details, pid);
      if (idx < 0) {
        await botSend('❌ لا يوجد بروفايل نشط.', {}, incomingChatId);
        return;
      }
      const inner = p.slice('methods.'.length);
      const profiles = [...details.profiles];
      const prof = { ...profiles[idx], methods: JSON.parse(JSON.stringify(profiles[idx].methods)) };
      setByPath(prof.methods, inner, value);
      profiles[idx] = prof;
      await savePaymentDetails({ ...details, profiles });
      await botSend(`✅ Updated ${p} على البروفايل النشط`, {}, incomingChatId);
      return;
    }
    setByPath(details, p, value);
    await savePaymentDetails(details);
    await botSend(`✅ Updated ${p}`, {}, incomingChatId);
    return;
  }

  await sendMainMenu(incomingChatId);
}

const QR_METHOD_MAP = {
  fastpay: 'fastPay.qrImage',
  fast: 'fastPay.qrImage',
  zain: 'zainCash.qrImage',
  zaincash: 'zainCash.qrImage',
  fib: 'fib.qrImage',
  mastercard: 'mastercard.qrImage',
  master: 'mastercard.qrImage',
  asia: 'asiaHawala.qrImage',
  asiahawala: 'asiaHawala.qrImage',
};

async function savePhotoAsQr(msg, methodKey, label, backTo = 'menu_edit', profileId = null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat?.id;
  const fieldPath = QR_METHOD_MAP[methodKey];
  if (!fieldPath) { await botSend(`❌ طريقة دفع غير معروفة: ${methodKey}`, {}, chatId); return; }
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  try {
    const { data: fileData } = await tgGetFile(botToken, fileId);
    if (!fileData?.ok || !fileData?.result?.file_path) throw new Error('getFile failed');
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const details = await loadPaymentDetails();
    const pid = profileId || details.currentProfileId;
    const idx = profileIndex(details, pid);
    if (idx < 0) throw new Error('profile not found');
    const profiles = [...details.profiles];
    const prof = { ...profiles[idx], methods: JSON.parse(JSON.stringify(profiles[idx].methods)) };
    setByPath(prof.methods, fieldPath, fileUrl);
    profiles[idx] = prof;
    await savePaymentDetails({ ...details, profiles });
    await botSend(`✅ تم حفظ باركود <b>${label || methodKey}</b> لبروفايل <b>${prof.nameAr}</b>!`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: backTo }]] } }, chatId);
  } catch (e) {
    await botSend(`❌ فشل حفظ الصورة: ${e?.message || e}`, {}, chatId);
  }
}

async function handlePhotoMessage(msg) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  // ── Check if we're awaiting a photo from button flow ──
  if (pendingState?.action === 'awaitPhoto') {
    const { method, label, backTo, profileId } = pendingState;
    pendingState = null;
    await savePhotoAsQr(msg, method, label, backTo || 'menu_edit', profileId);
    return;
  }

  // ── Fallback: caption-based ──────────────────────────
  const caption = String(msg.caption || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!caption.startsWith('qr ') && !Object.keys(QR_METHOD_MAP).includes(caption)) {
    await botSend('📷 لإضافة باركود اضغط الزر في القائمة أو أرسل صورة مع caption:\n<code>qr fastpay</code> / <code>qr zain</code> / <code>qr fib</code> / <code>qr mastercard</code> / <code>qr asia</code>', {}, msg.chat?.id);
    return;
  }
  const key = caption.startsWith('qr ') ? caption.slice(3).trim().replace(/\s+/g, '') : caption;
  const details = await loadPaymentDetails();
  const pid = resolveEditingProfileId(details, msg.chat?.id);
  await savePhotoAsQr(msg, key, key, 'menu_edit', pid);
}

async function pollTelegram() {
  if (isPolling) return;
  isPolling = true;
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const { res, data } = await tgGetUpdates(botToken, {
      timeout: 30,
      offset: updateOffset,
    });
    if (!res.ok) return;
    if (!data?.ok || !Array.isArray(data.result)) return;

    for (const u of data.result) {
      updateOffset = Math.max(updateOffset, (u.update_id || 0) + 1);

      // handle inline button taps
      if (u.callback_query) {
        const cbq = u.callback_query;
        await answerCbq(cbq.id);
        if (adminIds.has(String(cbq.from?.id))) {
          await handleCallbackQuery(cbq.data, cbq.message?.chat?.id);
        } else {
          // eslint-disable-next-line no-console
          console.log(`Bot: Unauthorized callback attempt from ${cbq.from?.id} in chat ${cbq.message?.chat?.id}`);
        }
        continue;
      }

      const msg = u.message;
      if (!msg) continue;
      if ((msg.date || 0) < SERVER_START_TS) continue;
      maybeAutoConfigureFromMessage(msg);
      if (!isAdminMessage(msg)) {
        // eslint-disable-next-line no-console
        console.log(`Bot: Non-admin message from ${msg.from?.id} (${msg.from?.username}) in chat ${msg.chat?.id}`);
        continue;
      }
      if (msg.photo) {
        await handlePhotoMessage(msg);
      } else if (msg.text) {
        await handleAdminCommand(msg.text, msg.chat.id);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Telegram poll]', e?.message || e);
  } finally {
    isPolling = false;
  }
}

async function drainPendingUpdates() {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;
    let maxId = 0;
    let fetched = 0;
    // fetch all pending batches until none remain
    for (let i = 0; i < 10; i++) {
      const params = { timeout: 0, limit: 100 };
      if (maxId > 0) params.offset = maxId + 1;
      const { res, data } = await tgGetUpdates(botToken, params);
      if (!res.ok) break;
      if (!data?.ok || !Array.isArray(data.result) || data.result.length === 0) break;
      for (const u of data.result) {
        if ((u.update_id || 0) > maxId) maxId = u.update_id;
        fetched++;
      }
      if (data.result.length < 100) break;
    }
    if (maxId > 0) {
      updateOffset = maxId + 1;
      // eslint-disable-next-line no-console
      console.log(`Telegram drain: skipped ${fetched} pending update(s), offset=${updateOffset}`);
    }
  } catch {
    // ignore
  }
}

if (IS_PROD) {
  const distPath = path.join(PROJECT_ROOT, 'dist');
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API running on http://localhost:${PORT}`);
  initDataFiles().then(() => drainPendingUpdates()).then(() => {
    const loopPoll = () => pollTelegram().finally(() => setImmediate(loopPoll));
    loopPoll();
    // eslint-disable-next-line no-console
    console.log('Telegram polling enabled. Send any message to the bot, then use /help.');
  });
});

