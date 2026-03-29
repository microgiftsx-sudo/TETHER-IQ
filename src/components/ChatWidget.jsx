import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createChatSession, sendChatMessage, fetchChatMessages } from '../api';

const STORAGE_KEY = 'web_chat_session_id';
const NAME_KEY = 'web_chat_visitor_name';
const LOCK_KEY = 'web_chat_name_locked';

export default function ChatWidget({ t, lang }) {
  const isRtl = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [visitorName, setVisitorName] = useState(() => localStorage.getItem(NAME_KEY) || '');
  const [nameLocked, setNameLocked] = useState(() => localStorage.getItem(LOCK_KEY) === '1');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [lastId, setLastId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const pollRef = useRef(null);

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
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      incoming.forEach((m) => byId.set(m.id, m));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    const max = Math.max(...incoming.map((m) => m.id), 0);
    setLastId((x) => Math.max(x, max));
  }, []);

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
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current);
      return undefined;
    }
    pollRef.current = setInterval(() => {
      poll();
    }, 2800);
    poll();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, poll]);

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
      const { messages: initial } = await fetchChatMessages(newId, 0);
      setMessages(initial || []);
      const max = initial?.length ? Math.max(...initial.map((m) => m.id)) : 0;
      setLastId(max);
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
      await sendChatMessage(sid, text, nm);
      if (nm) lockName(nm);
      setInput('');
      await fetchChatMessages(sid, lastId).then(({ messages: incoming }) => mergeIncoming(incoming));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

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
                {m.text}
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
        </div>
      )}
    </>
  );
}
