/**
 * Web chat sessions + Telegram message_id → session binding for staff replies.
 */

import { readFile, writeFile } from 'node:fs/promises';

const MAX_MESSAGES_PER_SESSION = 500;
const MAX_SESSIONS = 2000;

export function newSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadChatStore(filePath) {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      sessions: typeof raw.sessions === 'object' && raw.sessions !== null ? raw.sessions : {},
      telegramBindings: typeof raw.telegramBindings === 'object' && raw.telegramBindings !== null
        ? raw.telegramBindings
        : {},
    };
  } catch {
    return { sessions: {}, telegramBindings: {} };
  }
}

export async function saveChatStore(filePath, store) {
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

export function ensureSession(store, sessionId, visitorName = '') {
  if (!sessionId) return null;
  if (!store.sessions[sessionId]) {
    store.sessions[sessionId] = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      visitorName: String(visitorName || '').slice(0, 80),
      messages: [],
      nextMsgId: 1,
    };
  }
  return store.sessions[sessionId];
}

function pruneSessionMessages(sess) {
  if (sess.messages.length <= MAX_MESSAGES_PER_SESSION) return;
  sess.messages = sess.messages.slice(-MAX_MESSAGES_PER_SESSION);
}

function pruneOldSessions(store) {
  const ids = Object.keys(store.sessions);
  if (ids.length <= MAX_SESSIONS) return;
  ids.sort((a, b) => {
    const ta = new Date(store.sessions[a].createdAt || 0).getTime();
    const tb = new Date(store.sessions[b].createdAt || 0).getTime();
    return ta - tb;
  });
  const drop = ids.length - MAX_SESSIONS;
  for (let i = 0; i < drop; i++) {
    delete store.sessions[ids[i]];
  }
}

export function appendUserMessage(store, sessionId, text, visitorName, extra = {}) {
  const sess = ensureSession(store, sessionId, visitorName);
  if (!sess) return null;
  if (visitorName && !sess.visitorName) sess.visitorName = String(visitorName).slice(0, 80);
  const id = sess.nextMsgId++;
  const msg = {
    id,
    role: 'user',
    text: String(text || '').slice(0, 4000),
    at: new Date().toISOString(),
    ...(extra && typeof extra === 'object' ? {
      mediaUrl: extra.mediaUrl ? String(extra.mediaUrl).slice(0, 500) : undefined,
      mediaType: extra.mediaType ? String(extra.mediaType).slice(0, 120) : undefined,
      mediaName: extra.mediaName ? String(extra.mediaName).slice(0, 180) : undefined,
    } : {}),
  };
  sess.messages.push(msg);
  pruneSessionMessages(sess);
  pruneOldSessions(store);
  return msg;
}

export function appendStaffMessage(store, sessionId, text, extra = {}) {
  const sess = store.sessions[sessionId];
  if (!sess) return null;
  const id = sess.nextMsgId++;
  const msg = {
    id,
    role: 'staff',
    text: String(text || '').slice(0, 4000),
    at: new Date().toISOString(),
    ...(extra && typeof extra === 'object' ? {
      mediaUrl: extra.mediaUrl ? String(extra.mediaUrl).slice(0, 500) : undefined,
      mediaType: extra.mediaType ? String(extra.mediaType).slice(0, 120) : undefined,
      mediaName: extra.mediaName ? String(extra.mediaName).slice(0, 180) : undefined,
    } : {}),
  };
  sess.messages.push(msg);
  pruneSessionMessages(sess);
  return msg;
}

export function bindTelegramMessage(store, telegramMessageId, sessionId) {
  store.telegramBindings[String(telegramMessageId)] = sessionId;
  const keys = Object.keys(store.telegramBindings);
  if (keys.length > 15000) {
    const drop = keys.length - 12000;
    keys.sort((a, b) => Number(a) - Number(b));
    for (let i = 0; i < drop; i++) delete store.telegramBindings[keys[i]];
  }
}

export function getMessagesAfter(store, sessionId, afterId) {
  const sess = store.sessions[sessionId];
  if (!sess) return [];
  const after = Number(afterId) || 0;
  return sess.messages.filter((m) => m.id > after);
}

export function parseSessionIdFromTelegramText(text) {
  const s = String(text || '');
  const m = s.match(/sess_[a-z0-9_]+/i);
  return m ? m[0] : null;
}
