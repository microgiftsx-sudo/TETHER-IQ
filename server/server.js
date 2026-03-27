import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const PORT = Number(process.env.PORT || 5174);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'paymentDetails.json');
const SITE_CONFIG_PATH = path.join(DATA_DIR, 'siteConfig.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

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
    { src: path.join(__dirname, 'data', 'paymentDetails.json'), dest: DATA_PATH },
    { src: path.join(__dirname, 'data', 'siteConfig.json'),     dest: SITE_CONFIG_PATH },
  ];
  for (const { src, dest } of defaults) {
    try { await access(dest); } catch {
      try { await writeFile(dest, await readFile(src, 'utf8'), 'utf8'); } catch { /* ignore */ }
    }
  }
}

async function loadPaymentDetails() {
  const raw = await readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw);
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/site-config', async (_req, res) => {
  try {
    res.json(await loadSiteConfig());
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
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
    res.json({ ...details, rate });
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

    const safeOrderId = String(orderId || `ORD-${Date.now().toString(36).toUpperCase()}`);

    const lines = [
      '🚀 *طلب جديد (New Order)* 🚀',
      '━━━━━━━━━━━━━━━',
      `🧾 *رقم الطلب:* ${safeOrderId}`,
      `👤 *الاسم:* ${name}`,
      `💰 *المبلغ:* ${amountNum} USDT`,
      `💵 *المقابل:* ${iqdAmount} IQD`,
      `💳 *طريقة الدفع:* ${paymentMethod}`,
      paymentDetail ? `📱 *تفاصيل الدفع:* ${paymentDetail}` : null,
      `📥 *محفظة الاستلام:* ${walletTrim}`,
      `🕸️ *الشبكة:* ${normalizedNetwork}`,
      senderTrim ? `📞 *رقم المرسل:* ${senderTrim}` : null,
      paymentProofName ? `📎 *دليل الدفع:* ${paymentProofName}` : null,
      '━━━━━━━━━━━━━━━',
    ].filter(Boolean);

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
      }),
    });

    if (!tgRes.ok) {
      const text = await tgRes.text();
      return res.status(502).json({ error: 'Telegram send failed', details: text });
    }

    // Send payment proof image/document if provided
    if (paymentProofBase64) {
      try {
        const buf = Buffer.from(paymentProofBase64, 'base64');
        const mime = String(paymentProofMime || 'image/jpeg');
        const isPdf = mime === 'application/pdf';
        const ext = isPdf ? 'pdf' : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const filename = String(paymentProofName || `proof.${ext}`);
        const caption = `📎 دليل الدفع — طلب ${safeOrderId}`;
        const endpoint = isPdf ? 'sendDocument' : 'sendPhoto';
        const fieldName = isPdf ? 'document' : 'photo';

        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', caption);
        form.append(fieldName, new Blob([buf], { type: mime }), filename);

        await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
          method: 'POST',
          body: form,
        });
      } catch { /* don't fail the order if proof upload fails */ }
    }

    res.json({ ok: true, orderId: safeOrderId });
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
    '   qr zain      — باركود زين كاش',
    '   qr fib       — باركود المصرف الأول',
    '   qr mastercard — باركود ماستر كارد',
    '   qr asia      — باركود آسيا حوالة',
    '',
    '✏️ تعديل البيانات:',
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

async function botSend(text, extra = {}) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
    });
  } catch {
    // ignore
  }
}

async function answerCbq(id, text = '') {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
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
        { text: '✏️ تعديل البيانات', callback_data: 'menu_edit' },
        { text: '⏱️ وقت الانتهاء', callback_data: 'menu_timer' },
      ],
      [
        { text: '⚙️ إعدادات الموقع', callback_data: 'menu_site' },
      ],
    ],
  };
}

function backButton() {
  return { inline_keyboard: [[{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }]] };
}

async function sendMainMenu() {
  await botSend(
    '🛠️ <b>لوحة تحكم TETHER IQ</b>\n━━━━━━━━━━━━━━━\n\nاختر من القائمة:',
    { reply_markup: mainMenuKeyboard() }
  );
}

function cancelButton() {
  return { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_input' }]] };
}

async function showRateMenu() {
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
    ] } }
  );
}

async function showQrMenu() {
  await botSend(
    '📷 <b>إضافة باركود QR</b>\n━━━━━━━━━━━━━━━\nاختر طريقة الدفع:',
    { reply_markup: { inline_keyboard: [
      [{ text: '💚 زين كاش', callback_data: 'qr_zain' }, { text: '🏦 المصرف الأول', callback_data: 'qr_fib' }],
      [{ text: '💳 ماستر كارد', callback_data: 'qr_mc' }, { text: '🌐 آسيا حوالة', callback_data: 'qr_asia' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } }
  );
}

async function showEditMenu() {
  await botSend(
    '✏️ <b>تعديل البيانات</b>\n━━━━━━━━━━━━━━━\nاختر طريقة الدفع:',
    { reply_markup: { inline_keyboard: [
      [{ text: '💚 زين كاش', callback_data: 'edit_zain' }, { text: '🌐 آسيا حوالة', callback_data: 'edit_asia' }],
      [{ text: '🏦 المصرف الأول', callback_data: 'edit_fib' }, { text: '💳 ماستر كارد', callback_data: 'edit_mc' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } }
  );
}

async function showTimerMenu() {
  const details = await loadPaymentDetails();
  await botSend(
    `⏱️ <b>وقت انتهاء الدفع</b>\n━━━━━━━━━━━━━━━\nالوقت الحالي: <b>${details.paymentExpiryMinutes} دقيقة</b>\n\nاختر:`,
    { reply_markup: { inline_keyboard: [
      [{ text: '10 دق', callback_data: 'timer_10' }, { text: '15 دق', callback_data: 'timer_15' }, { text: '20 دق', callback_data: 'timer_20' }],
      [{ text: '30 دق', callback_data: 'timer_30' }, { text: '45 دق', callback_data: 'timer_45' }, { text: '⌨️ تخصيص', callback_data: 'timer_custom' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } }
  );
}

async function showSiteMenu() {
  const cfg = await loadSiteConfig();
  const maint = cfg.maintenance?.enabled ? '🔴 مفعّل' : '🟢 مطفأ';
  await botSend(
    `⚙️ <b>إعدادات الموقع</b>\n━━━━━━━━━━━━━━━\nوضع الصيانة: ${maint}`,
    { reply_markup: { inline_keyboard: [
      [{ text: '❓ الأسئلة الشائعة', callback_data: 'site_faq' }, { text: '🏠 نص الهيرو', callback_data: 'site_hero' }],
      [{ text: '🔗 الروابط', callback_data: 'site_links' }, { text: '🔧 وضع الصيانة', callback_data: 'site_maint' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_main' }],
    ] } }
  );
}

async function showFaqMenu() {
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
    { reply_markup: { inline_keyboard: rows } }
  );
}

async function showHeroMenu() {
  const cfg = await loadSiteConfig();
  const h = cfg.hero || {};
  await botSend(
    `🏠 <b>نص الهيرو</b>\n━━━━━━━━━━━━━━━\n<b>عنوان AR:</b> ${h.titleAr || '-'}\n<b>عنوان EN:</b> ${h.titleEn || '-'}\n<b>وصف AR:</b> ${(h.subtitleAr || '-').slice(0, 40)}...\n<b>إعلان AR:</b> ${(h.promoAr || '-').slice(0, 35)}...`,
    { reply_markup: { inline_keyboard: [
      [{ text: '✏️ عنوان عربي', callback_data: 'sf_hero_titleAr' }, { text: '✏️ عنوان إنجليزي', callback_data: 'sf_hero_titleEn' }],
      [{ text: '✏️ وصف عربي', callback_data: 'sf_hero_subtitleAr' }, { text: '✏️ وصف إنجليزي', callback_data: 'sf_hero_subtitleEn' }],
      [{ text: '✏️ إعلان عربي', callback_data: 'sf_hero_promoAr' }, { text: '✏️ إعلان إنجليزي', callback_data: 'sf_hero_promoEn' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_site' }],
    ] } }
  );
}

async function showLinksMenu() {
  const cfg = await loadSiteConfig();
  const l = cfg.links || {};
  await botSend(
    `🔗 <b>الروابط</b>\n━━━━━━━━━━━━━━━\n<b>BNB:</b> <code>${l.bnb || '-'}</code>\n<b>OKX:</b> <code>${l.okx || '-'}</code>\n<b>تواصل معنا:</b> <code>${l.contact || '-'}</code>`,
    { reply_markup: { inline_keyboard: [
      [{ text: '🔗 رابط BNB', callback_data: 'sf_link_bnb' }, { text: '🔗 رابط OKX', callback_data: 'sf_link_okx' }],
      [{ text: '📬 رابط التواصل', callback_data: 'sf_link_contact' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_site' }],
    ] } }
  );
}

async function showMaintenanceMenu() {
  const cfg = await loadSiteConfig();
  const enabled = cfg.maintenance?.enabled;
  await botSend(
    `🔧 <b>وضع الصيانة</b>\n━━━━━━━━━━━━━━━\nالحالة: ${enabled ? '🔴 مفعّل' : '🟢 مطفأ'}\n<b>رسالة AR:</b> ${cfg.maintenance?.messageAr || '-'}\n<b>رسالة EN:</b> ${cfg.maintenance?.messageEn || '-'}`,
    { reply_markup: { inline_keyboard: [
      [{ text: enabled ? '✅ تعطيل الصيانة' : '🔴 تفعيل الصيانة', callback_data: 'maint_toggle' }],
      [{ text: '✏️ رسالة عربية', callback_data: 'sf_maint_messageAr' }, { text: '✏️ رسالة إنجليزية', callback_data: 'sf_maint_messageEn' }],
      [{ text: '🔙 رجوع', callback_data: 'menu_site' }],
    ] } }
  );
}

async function handleCallbackQuery(data) {
  // ── Main navigation ─────────────────────────────────
  if (data === 'menu_main')  { pendingState = null; await sendMainMenu(); return; }
  if (data === 'cancel_input') { pendingState = null; await sendMainMenu(); return; }

  if (data === 'menu_pay') {
    const details = await loadPaymentDetails();
    const rate = await computeRate(details);
    const m = details.methods || {};
    await botSend(
      [
        '📋 <b>بيانات الدفع الحالية</b>', '━━━━━━━━━━━━━━━',
        `💱 السعر: <b>${rate} IQD/USDT</b>`,
        `⏱️ وقت الانتهاء: <b>${details.paymentExpiryMinutes} دقيقة</b>`,
        '', '🔷 <b>زين كاش:</b> ' + (m.zainCash?.number || '-'),
        '🔷 <b>آسيا حوالة:</b> ' + (m.asiaHawala?.number || '-'),
        '🔷 <b>المصرف الأول:</b> ' + (m.fib?.accountNumber || '-'),
        '🔷 <b>ماستر كارد:</b> ' + (m.mastercard?.cardNumber || '-'),
      ].join('\n'),
      { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_main' }]] } }
    );
    return;
  }

  if (data === 'menu_rate')  { await showRateMenu();  return; }
  if (data === 'menu_qr')    { await showQrMenu();    return; }
  if (data === 'menu_edit')  { await showEditMenu();  return; }
  if (data === 'menu_timer') { await showTimerMenu(); return; }

  // ── Rate ────────────────────────────────────────────
  if (data === 'rate_fixed') {
    pendingState = { action: 'rateFixed' };
    await botSend('💱 أرسل السعر الجديد بالدينار العراقي\nمثال: <code>1350</code>', { reply_markup: cancelButton() });
    return;
  }
  if (data === 'rate_float') {
    pendingState = { action: 'rateFloat' };
    await botSend('🔄 أرسل: <code>الأساس المكسب</code>\nمثال: <code>1310 40</code>\n(السعر = USDT × الأساس + المكسب)', { reply_markup: cancelButton() });
    return;
  }

  // ── QR ──────────────────────────────────────────────
  const qrMap = { qr_zain: ['zain','زين كاش','edit_zain'], qr_fib: ['fib','المصرف الأول','edit_fib'], qr_mc: ['mastercard','ماستر كارد','edit_mc'], qr_asia: ['asia','آسيا حوالة','edit_asia'] };
  if (qrMap[data]) {
    const [method, label, backTo] = qrMap[data];
    pendingState = { action: 'awaitPhoto', method, label, backTo };
    await botSend(`📷 أرسل صورة باركود <b>${label}</b> الآن`, { reply_markup: cancelButton() });
    return;
  }

  // ── Edit method selection ────────────────────────────
  if (data === 'edit_zain') {
    const d = await loadPaymentDetails();
    await botSend(
      `✏️ <b>زين كاش</b>\nالرقم: <code>${d.methods?.zainCash?.number || '-'}</code>\nالباركود: ${d.methods?.zainCash?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '📱 تغيير الرقم', callback_data: 'ef_zain_num' }, { text: '📷 تحديث الباركود', callback_data: 'qr_zain' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } }
    );
    return;
  }
  if (data === 'edit_asia') {
    const d = await loadPaymentDetails();
    await botSend(
      `✏️ <b>آسيا حوالة</b>\nالرقم: <code>${d.methods?.asiaHawala?.number || '-'}</code>\nالباركود: ${d.methods?.asiaHawala?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '📱 تغيير الرقم', callback_data: 'ef_asia_num' }, { text: '📷 تحديث الباركود', callback_data: 'qr_asia' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } }
    );
    return;
  }
  if (data === 'edit_fib') {
    const d = await loadPaymentDetails();
    await botSend(
      `✏️ <b>المصرف الأول (FIB)</b>\nرقم الحساب: <code>${d.methods?.fib?.accountNumber || '-'}</code>\nاسم الحساب: <code>${d.methods?.fib?.accountName || '-'}</code>\nالباركود: ${d.methods?.fib?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '🔢 رقم الحساب', callback_data: 'ef_fib_num' }, { text: '✍️ اسم الحساب', callback_data: 'ef_fib_name' }],
        [{ text: '📷 تحديث الباركود', callback_data: 'qr_fib' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } }
    );
    return;
  }
  if (data === 'edit_mc') {
    const d = await loadPaymentDetails();
    await botSend(
      `✏️ <b>ماستر كارد</b>\nرقم البطاقة: <code>${d.methods?.mastercard?.cardNumber || '-'}</code>\nاسم الحامل: <code>${d.methods?.mastercard?.cardHolder || '-'}</code>\nالباركود: ${d.methods?.mastercard?.qrImage ? '✅ موجود' : '❌ غير محدد'}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '💳 رقم البطاقة', callback_data: 'ef_mc_num' }, { text: '✍️ اسم الحامل', callback_data: 'ef_mc_holder' }],
        [{ text: '📷 تحديث الباركود', callback_data: 'qr_mc' }],
        [{ text: '🔙 رجوع', callback_data: 'menu_edit' }],
      ] } }
    );
    return;
  }

  // ── Edit fields (await text input) ──────────────────
  const fieldMap = {
    ef_zain_num:   ['methods.zainCash.number',       'رقم زين كاش',        'menu_edit'],
    ef_asia_num:   ['methods.asiaHawala.number',     'رقم آسيا حوالة',      'menu_edit'],
    ef_fib_num:    ['methods.fib.accountNumber',     'رقم حساب FIB',        'edit_fib'],
    ef_fib_name:   ['methods.fib.accountName',       'اسم حساب FIB',        'edit_fib'],
    ef_mc_num:     ['methods.mastercard.cardNumber', 'رقم بطاقة ماستر كارد','edit_mc'],
    ef_mc_holder:  ['methods.mastercard.cardHolder', 'اسم حامل البطاقة',    'edit_mc'],
  };
  if (fieldMap[data]) {
    const [path, label, backTo] = fieldMap[data];
    pendingState = { action: 'editField', path, label, backTo };
    await botSend(`✏️ أرسل <b>${label}</b> الجديد:`, { reply_markup: cancelButton() });
    return;
  }

  // ── Timer presets ────────────────────────────────────
  const timerPresets = { timer_10: 10, timer_15: 15, timer_20: 20, timer_30: 30, timer_45: 45 };
  if (timerPresets[data]) {
    const mins = timerPresets[data];
    const details = await loadPaymentDetails();
    await savePaymentDetails({ ...details, paymentExpiryMinutes: mins });
    await botSend(`✅ تم تعيين وقت الانتهاء: <b>${mins} دقيقة</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_timer' }]] } });
    return;
  }
  if (data === 'timer_custom') {
    pendingState = { action: 'setTimer' };
    await botSend('⏱️ أرسل عدد الدقائق (1-180):\nمثال: <code>25</code>', { reply_markup: cancelButton() });
    return;
  }

  // ── Site settings ────────────────────────────────────
  if (data === 'menu_site')   { await showSiteMenu();        return; }
  if (data === 'site_faq')    { await showFaqMenu();         return; }
  if (data === 'site_hero')   { await showHeroMenu();        return; }
  if (data === 'site_links')  { await showLinksMenu();       return; }
  if (data === 'site_maint')  { await showMaintenanceMenu(); return; }

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

async function handleAdminCommand(text) {
  const raw = String(text || '').trim();
  const trimmed = raw.toLowerCase();

  // ── Handle pending input state ──────────────────────
  if (pendingState) {
    const st = pendingState;
    pendingState = null;

    if (st.action === 'rateFixed') {
      const val = Number(raw);
      if (!Number.isFinite(val) || val < 100 || val > 100000) {
        await botSend('❌ رقم غير صالح. مثال: <code>1350</code>', { reply_markup: cancelButton() });
        pendingState = st;
        return;
      }
      const details = await loadPaymentDetails();
      if (!details.rateConfig) details.rateConfig = {};
      details.rateConfig.mode = 'fixed';
      details.rateConfig.fixedRate = val;
      await savePaymentDetails(details);
      await botSend(`✅ السعر الثابت: <b>${val} IQD/USDT</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 سعر الصرف', callback_data: 'menu_rate' }]] } });
      return;
    }

    if (st.action === 'rateFloat') {
      const parts = raw.split(/\s+/);
      const base = Number(parts[0]), offset = Number(parts[1] || 0);
      if (!Number.isFinite(base) || base < 100) {
        await botSend('❌ صيغة خاطئة. مثال: <code>1310 40</code>', { reply_markup: cancelButton() });
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
      await botSend(`✅ وضع عائم: Base=${base}, Offset=${offset}\nالسعر الحالي: <b>${effective} IQD/USDT</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 سعر الصرف', callback_data: 'menu_rate' }]] } });
      return;
    }

    if (st.action === 'setTimer') {
      const mins = Number(raw);
      if (!Number.isFinite(mins) || mins < 1 || mins > 180) {
        await botSend('❌ رقم غير صالح (1-180). مثال: <code>20</code>', { reply_markup: cancelButton() });
        pendingState = st;
        return;
      }
      const details = await loadPaymentDetails();
      await savePaymentDetails({ ...details, paymentExpiryMinutes: mins });
      await botSend(`✅ وقت الانتهاء: <b>${mins} دقيقة</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_timer' }]] } });
      return;
    }

    if (st.action === 'editField') {
      const details = await loadPaymentDetails();
      setByPath(details, st.path, raw);
      await savePaymentDetails(details);
      await botSend(`✅ تم تحديث <b>${st.label}</b>: <code>${raw}</code>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: st.backTo || 'menu_edit' }]] } });
      return;
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

    // unknown pending state - fall through
  }

  if (!trimmed.startsWith('/')) return;

  if (trimmed === '/help' || trimmed === '/start') {
    await sendMainMenu();
    return;
  }

  if (trimmed === '/pay' || trimmed === '/pay@' + (process.env.BOT_USERNAME || '').toLowerCase()) {
    const details = await loadPaymentDetails();
    await botSend(JSON.stringify(details, null, 2));
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
    await botSend(`💱 Rate Mode: ${modeText}\n\n📊 السعر الحالي: ${rate} IQD/USDT`);
    return;
  }

  if (trimmed.startsWith('/set ')) {
    const rest = trimmed.slice(5).trim();
    const firstSpace = rest.indexOf(' ');
    if (firstSpace === -1) {
      await botSend('Usage: /set <path> <value>');
      return;
    }
    const p = rest.slice(0, firstSpace).trim();
    const value = rest.slice(firstSpace + 1).trim();
    const details = await loadPaymentDetails();
    setByPath(details, p, value);
    await savePaymentDetails(details);
    await botSend(`✅ Updated ${p}`);
    return;
  }

  await sendMainMenu();
}

const QR_METHOD_MAP = {
  zain: 'methods.zainCash.qrImage',
  zaincash: 'methods.zainCash.qrImage',
  fib: 'methods.fib.qrImage',
  mastercard: 'methods.mastercard.qrImage',
  master: 'methods.mastercard.qrImage',
  asia: 'methods.asiaHawala.qrImage',
  asiahawala: 'methods.asiaHawala.qrImage',
};

async function savePhotoAsQr(msg, methodKey, label, backTo = 'menu_edit') {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const fieldPath = QR_METHOD_MAP[methodKey];
  if (!fieldPath) { await botSend(`❌ طريقة دفع غير معروفة: ${methodKey}`); return; }
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    if (!fileData?.ok || !fileData?.result?.file_path) throw new Error('getFile failed');
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const details = await loadPaymentDetails();
    setByPath(details, fieldPath, fileUrl);
    await savePaymentDetails(details);
    await botSend(`✅ تم حفظ باركود <b>${label || methodKey}</b> بنجاح!`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: backTo }]] } });
  } catch (e) {
    await botSend(`❌ فشل حفظ الصورة: ${e?.message || e}`);
  }
}

async function handlePhotoMessage(msg) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  // ── Check if we're awaiting a photo from button flow ──
  if (pendingState?.action === 'awaitPhoto') {
    const { method, label, backTo } = pendingState;
    pendingState = null;
    await savePhotoAsQr(msg, method, label, backTo || 'menu_edit');
    return;
  }

  // ── Fallback: caption-based ──────────────────────────
  const caption = String(msg.caption || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!caption.startsWith('qr ') && !Object.keys(QR_METHOD_MAP).includes(caption)) {
    await botSend('📷 لإضافة باركود اضغط الزر في القائمة أو أرسل صورة مع caption:\n<code>qr zain</code> / <code>qr fib</code> / <code>qr mastercard</code> / <code>qr asia</code>');
    return;
  }
  const key = caption.startsWith('qr ') ? caption.slice(3).trim().replace(/\s+/g, '') : caption;
  await savePhotoAsQr(msg, key, key);
}

async function pollTelegram() {
  if (isPolling) return;
  isPolling = true;
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
    url.searchParams.set('timeout', '30');
    url.searchParams.set('offset', String(updateOffset));

    const r = await fetch(url, { signal: AbortSignal.timeout(35000) });
    if (!r.ok) return;
    const data = await r.json();
    if (!data?.ok || !Array.isArray(data.result)) return;

    for (const u of data.result) {
      updateOffset = Math.max(updateOffset, (u.update_id || 0) + 1);

      // handle inline button taps
      if (u.callback_query) {
        const cbq = u.callback_query;
        await answerCbq(cbq.id);
        if (adminIds.has(String(cbq.from?.id))) {
          await handleCallbackQuery(cbq.data);
        }
        continue;
      }

      const msg = u.message;
      if (!msg) continue;
      if ((msg.date || 0) < SERVER_START_TS) continue;
      maybeAutoConfigureFromMessage(msg);
      if (!isAdminMessage(msg)) continue;
      if (msg.photo) {
        await handlePhotoMessage(msg);
      } else if (msg.text) {
        await handleAdminCommand(msg.text);
      }
    }
  } catch {
    // ignore
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
      const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
      url.searchParams.set('timeout', '0');
      url.searchParams.set('limit', '100');
      if (maxId > 0) url.searchParams.set('offset', String(maxId + 1));
      const r = await fetch(url);
      if (!r.ok) break;
      const data = await r.json();
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
  app.get(/.*/, (_req, res) => {
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

