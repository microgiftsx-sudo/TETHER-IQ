import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChatSession, sendChatMessage, fetchChatMessages, uploadChatMedia } from '../api';
import { getOrCreateVisitorId } from '../visitTracking';

const STORAGE_KEY = 'web_chat_session_id';
const NAME_KEY = 'web_chat_visitor_name';
const LOCK_KEY = 'web_chat_name_locked';
const SEEN_KEY_PREFIX = 'web_chat_seen_msg_id_';

export default function ChatWidget({ t, lang }) {
  const isRtl = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [visitorName, setVisitorName] = useState(() => localStorage.getItem(NAME_KEY) || '');
  const [nameLocked, setNameLocked] = useState(() => localStorage.getItem(LOCK_KEY) === '1');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [lastId, setLastId] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const pollRef = useRef(null);
  const lastIdRef = useRef(0);
  const seenIdRef = useRef(0);
  const audioCtxRef = useRef(null);

  const seenKeyFor = useCallback((sid) => `${SEEN_KEY_PREFIX}${sid}`, []);
  const readSeenId = useCallback((sid) => {
    const key = seenKeyFor(sid);
    const n = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(n) ? n : 0;
  }, [seenKeyFor]);
  const writeSeenId = useCallback((sid, id) => {
    const safe = Number.isFinite(Number(id)) ? Number(id) : 0;
    seenIdRef.current = safe;
    try {
      localStorage.setItem(seenKeyFor(sid), String(safe));
    } catch {
      // ignore storage failures
    }
  }, [seenKeyFor]);

  useEffect(() => {
    lastIdRef.current = lastId;
  }, [lastId]);

  useEffect(() => {
    const sid = sessionId || localStorage.getItem(STORAGE_KEY);
    if (!sid) return;
    seenIdRef.current = readSeenId(sid);
  }, [sessionId, readSeenId]);

  const playNotificationTone = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const tone = (startAt, freq, gainVal) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(gainVal, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.16);
      };
      tone(now, 880, 0.05);
      tone(now + 0.18, 1240, 0.04);
    } catch {
      // ignore sound errors
    }
  }, []);

  const scrollBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const lockName = useCallback((name) => {
    const n = String(name || '').trim();
    if (!n) return;
    try {
      localStorage.setItem(NAME_KEY, n);
      localStorage.setItem(LOCK_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisitorName(n);
    setNameLocked(true);
  }, []);

  const ensureSession = useCallback(async () => {
    let sid = localStorage.getItem(STORAGE_KEY);
    if (sid) {
      setSessionId(sid);
      return sid;
    }
    const { sessionId: newId } = await createChatSession();
    sid = newId;
    localStorage.setItem(STORAGE_KEY, sid);
    setSessionId(sid);
    return sid;
  }, []);

  const mergeIncoming = useCallback((incoming) => {
    if (!incoming?.length) return;
    const minId = Math.max(Number(lastIdRef.current || 0), Number(seenIdRef.current || 0));
    const newSinceLast = incoming.filter((m) => Number(m.id) > minId);
    const newStaff = newSinceLast.filter((m) => m.role === 'staff');
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      incoming.forEach((m) => byId.set(m.id, m));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    const max = Math.max(...incoming.map((m) => m.id), 0);
    setLastId((x) => Math.max(x, max));
    if (newStaff.length) {
      if (!open) setUnreadCount((x) => x + newStaff.length);
      if (!open || document.hidden) playNotificationTone();
    }
  }, [open, playNotificationTone]);

  const poll = useCallback(async () => {
    const sid = sessionId || localStorage.getItem(STORAGE_KEY);
    if (!sid) return;
    try {
      const { messages: incoming } = await fetchChatMessages(sid, lastId);
      mergeIncoming(incoming);
    } catch {
      // ignore transient errors
    }
  }, [sessionId, lastId, mergeIncoming]);

  useEffect(() => {
    if (!open) return undefined;
    scrollBottom();
    return undefined;
  }, [open, messages]);

  useEffect(() => {
    const sid = sessionId || localStorage.getItem(STORAGE_KEY);
    if (!sid) return undefined;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      poll();
    }, open ? 2800 : 4200);
    poll();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, poll, sessionId]);

  const onOpen = async () => {
    setError('');
    try {
      if (localStorage.getItem(LOCK_KEY) === '1') {
        const n = localStorage.getItem(NAME_KEY);
        if (n) setVisitorName(n);
        setNameLocked(true);
      }
      await ensureSession();
      const sid = localStorage.getItem(STORAGE_KEY);
      setSessionId(sid || '');
      const { messages: initial } = await fetchChatMessages(sid, 0);
      setMessages(initial || []);
      const max = initial?.length ? Math.max(...initial.map((m) => m.id)) : 0;
      setLastId(max);
      setUnreadCount(0);
      writeSeenId(sid, max);
      setOpen(true);
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const newTicket = async () => {
    setError('');
    setLoading(true);
    try {
      localStorage.removeItem(STORAGE_KEY);
      const { sessionId: newId } = await createChatSession();
      localStorage.setItem(STORAGE_KEY, newId);
      setSessionId(newId);
      setMessages([]);
      setLastId(0);
      writeSeenId(newId, 0);
      setUnreadCount(0);
      const { messages: initial } = await fetchChatMessages(newId, 0);
      setMessages(initial || []);
      const max = initial?.length ? Math.max(...initial.map((m) => m.id)) : 0;
      setLastId(max);
      writeSeenId(newId, max);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const onSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setLoading(true);
    setError('');
    try {
      const sid = sessionId || (await ensureSession());
      const nm = visitorName.trim();
      const visitorId = getOrCreateVisitorId();
      await sendChatMessage(sid, text, nm, visitorId);
      if (nm) lockName(nm);
      setInput('');
      await fetchChatMessages(sid, lastId).then(({ messages: incoming }) => mergeIncoming(incoming));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const onSendMedia = async () => {
    if (!mediaFile || loading) return;
    setLoading(true);
    setError('');
    try {
      const sid = sessionId || (await ensureSession());
      const nm = visitorName.trim();
      const visitorId = getOrCreateVisitorId();
      const dataUrl = await fileToDataUrl(mediaFile);
      await uploadChatMedia(sid, dataUrl, mediaFile.name || '', input.trim(), nm, visitorId);
      if (nm) lockName(nm);
      setInput('');
      setMediaFile(null);
      await fetchChatMessages(sid, lastId).then(({ messages: incoming }) => mergeIncoming(incoming));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const sid = sessionId || localStorage.getItem(STORAGE_KEY);
    if (!sid || !messages.length) return;
    const max = Math.max(...messages.map((m) => Number(m.id) || 0), 0);
    setUnreadCount(0);
    writeSeenId(sid, max);
  }, [open, messages, sessionId, writeSeenId]);

  return (
    <>
      <button
        type="button"
        className="tg-float web-chat-float"
        aria-expanded={open}
        aria-label={isRtl ? 'فتح الدردشة' : 'Open chat'}
        onClick={() => (open ? setOpen(false) : void onOpen())}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="tg-float-label">{t.chatOpen}</span>
        {!open && unreadCount > 0 && (
          <span className="web-chat-unread-dot" aria-label={isRtl ? 'رسالة جديدة' : 'New message'} />
        )}
      </button>

      {open && (
        <div className="web-chat-panel glass-panel" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="web-chat-panel__head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="web-chat-panel__title">{t.chatTitle}</div>
              <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2, lineHeight: 1.35 }}>{t.chatSubtitle}</div>
              <div className="text-muted" style={{ fontSize: '0.68rem', marginTop: 3, lineHeight: 1.35, opacity: 0.9 }}>{t.chatTicketHint}</div>
            </div>
            <div className="web-chat-panel__actions">
              <button
                type="button"
                onClick={newTicket}
                disabled={loading}
                className="web-chat-panel__btn-secondary"
                title={t.chatNewTicket}
              >
                {t.chatNewTicket}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="web-chat-panel__btn-close"
                aria-label={t.chatMinimize}
                title={t.chatMinimize}
              >
                ×
              </button>
            </div>
          </div>

          {!nameLocked ? (
            <div className="web-chat-panel__name-row">
              <input
                type="text"
                className="input-control"
                placeholder={t.chatNamePlaceholder}
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                style={{ fontSize: '0.85rem', padding: '0.45rem 0.6rem' }}
              />
            </div>
          ) : (
            <div className="web-chat-panel__name-locked">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ flexShrink: 0, opacity: 0.85 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{t.chatYourName}:</span>
              <strong className="text-accent">{visitorName}</strong>
            </div>
          )}

          <div ref={listRef} className="web-chat-panel__messages">
            {messages.length === 0 && !error && (
              <p className="text-muted text-sm" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                {t.chatWelcome}
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`web-chat-msg ${m.role === 'user' ? 'web-chat-msg--user' : 'web-chat-msg--staff'}`}
              >
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                {m.mediaUrl && String(m.mediaType || '').startsWith('image/') ? (
                  <a href={m.mediaUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8 }}>
                    <img src={m.mediaUrl} alt={m.mediaName || 'media'} style={{ maxWidth: 190, maxHeight: 160, borderRadius: 10, border: '1px solid rgba(148,163,184,.35)' }} />
                  </a>
                ) : m.mediaUrl ? (
                  <a href={m.mediaUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, textDecoration: 'underline' }}>
                    {m.mediaName || (isRtl ? 'فتح الملف المرفق' : 'Open attached file')}
                  </a>
                ) : null}
              </div>
            ))}
            {error && <div className="text-error text-sm" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
          </div>

          <form onSubmit={onSend} className="web-chat-panel__form">
            <input
              className="input-control"
              placeholder={t.chatPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              style={{ flex: 1, fontSize: '0.9rem' }}
            />
            <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()} style={{ padding: '0.5rem 1rem' }}>
              {loading ? '…' : t.chatSend}
            </button>
          </form>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <input
              type="file"
              onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
              disabled={loading}
              style={{ flex: 1, fontSize: '0.8rem' }}
            />
            <button
              type="button"
              className="btn btn-outline"
              onClick={onSendMedia}
              disabled={loading || !mediaFile}
              style={{ padding: '0.45rem 0.8rem' }}
            >
              {isRtl ? 'رفع الوسائط' : 'Upload'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
