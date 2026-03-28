/**
 * Telegram Bot API helpers: timeouts, retries on 429/5xx, consistent JSON handling.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_JSON_TIMEOUT_MS = 28000;
const LONG_POLL_TIMEOUT_MS = 45000;
const MULTIPART_TIMEOUT_MS = 120000;
const MAX_ATTEMPTS = 4;

function parseTelegramResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, description: text?.slice(0, 500) || 'invalid json' };
  }
}

/**
 * POST JSON to api.telegram.org/bot<token>/<method>
 */
export async function tgPostJson(botToken, method, payload, options = {}) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_JSON_TIMEOUT_MS;
  let lastErr;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const data = parseTelegramResponse(text);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const retryAfterSec = Number(data?.parameters?.retry_after) || 0;
        const wait = Math.min(9000, 700 * (attempt + 1) + retryAfterSec * 1000);
        await sleep(wait);
        continue;
      }

      return { res, data };
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }

  throw lastErr ?? new Error(`Telegram ${method} failed`);
}

/**
 * Multipart (sendPhoto, sendDocument) — FormData with form-data package getHeaders()
 */
export async function tgPostMultipart(botToken, method, form, options = {}) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const timeoutMs = options.timeoutMs ?? MULTIPART_TIMEOUT_MS;
  let lastErr;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const data = parseTelegramResponse(text);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const retryAfterSec = Number(data?.parameters?.retry_after) || 0;
        await sleep(Math.min(8000, 600 * (attempt + 1) + retryAfterSec * 1000));
        continue;
      }

      return { res, data };
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastErr ?? new Error(`Telegram ${method} (multipart) failed`);
}

/**
 * Long-polling getUpdates
 */
export async function tgGetUpdates(botToken, params) {
  const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url, { signal: AbortSignal.timeout(LONG_POLL_TIMEOUT_MS) });
  const text = await res.text();
  const data = parseTelegramResponse(text);
  return { res, data };
}

/**
 * GET getFile (small JSON response)
 */
export async function tgGetFile(botToken, fileId) {
  const url = new URL(`https://api.telegram.org/bot${botToken}/getFile`);
  url.searchParams.set('file_id', String(fileId));
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  const data = parseTelegramResponse(text);
  return { res, data };
}

export async function tgAnswerCallbackQuery(botToken, callbackQueryId, text = '') {
  return tgPostJson(botToken, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 200),
  });
}

/** Escape for Telegram HTML parse_mode */
export function escapeTelegramHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
