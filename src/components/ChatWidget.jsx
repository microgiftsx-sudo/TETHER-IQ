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
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          left: isRtl ? '1.5rem' : 'auto',
          right: isRtl ? 'auto' : '1.5rem',
          zIndex: 1001,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 55%, #00E5FF 160%)',
          color: '#fff',
          border: '1px solid rgba(0,229,255,0.45)',
          borderRadius: '50px',
          padding: '0.65rem 1.1rem 0.65rem 0.85rem',
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: '0.88rem',
          boxShadow: '0 6px 28px rgba(0, 229, 255, 0.35)',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="tg-float-label">{t.chatOpen}</span>
      </button>

      {open && (
        <div
          className="web-chat-panel glass-panel"
          dir={isRtl ? 'rtl' : 'ltr'}
          style={{
            position: 'fixed',
            bottom: '5.5rem',
            left: isRtl ? '1rem' : 'auto',
            right: isRtl ? 'auto' : '1rem',
            width: 'min(400px, calc(100vw - 2rem))',
            maxHeight: 'min(520px, calc(100vh - 7rem))',
            zIndex: 1002,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--border-radius-lg)',
            overflow: 'hidden',
            boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
          }}
        >
          <div
            style={{
              padding: '0.75rem 1rem',
              background: 'linear-gradient(90deg, rgba(0,229,255,0.12), rgba(3,105,161,0.2))',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, color: 'var(--accent-primary)', fontSize: '0.95rem' }}>{t.chatTitle}</div>
              <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 2, lineHeight: 1.35 }}>{t.chatSubtitle}</div>
              <div className="text-muted" style={{ fontSize: '0.68rem', marginTop: 3, lineHeight: 1.35, opacity: 0.9 }}>{t.chatTicketHint}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
              <button
                type="button"
                onClick={newTicket}
                disabled={loading}
                className="text-muted"
                title={t.chatNewTicket}
                style={{
                  background: 'rgba(0,229,255,0.12)',
                  border: '1px solid rgba(0,229,255,0.25)',
                  color: 'var(--accent-primary)',
                  cursor: loading ? 'wait' : 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.35rem 0.5rem',
                  borderRadius: '8px',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.chatNewTicket}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  padding: '0.25rem',
                  lineHeight: 1,
                }}
                aria-label={t.chatMinimize}
                title={t.chatMinimize}
              >
                ×
              </button>
            </div>
          </div>

          {!nameLocked ? (
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
            <div
              style={{
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ flexShrink: 0, opacity: 0.85 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{t.chatYourName}:</span>
              <strong style={{ color: 'var(--accent-primary)' }}>{visitorName}</strong>
            </div>
          )}

          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0.75rem',
              minHeight: 220,
              maxHeight: 320,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {messages.length === 0 && !error && (
              <p className="text-muted text-sm" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                {t.chatWelcome}
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user'
                    ? (isRtl ? 'flex-start' : 'flex-end')
                    : (isRtl ? 'flex-end' : 'flex-start'),
                  maxWidth: '88%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '12px',
                  fontSize: '0.88rem',
                  lineHeight: 1.45,
                  background: m.role === 'user' ? 'rgba(0,229,255,0.12)' : 'rgba(148,163,184,0.15)',
                  border: `1px solid ${m.role === 'user' ? 'rgba(0,229,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
                  textAlign: isRtl ? 'right' : 'left',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {m.text}
              </div>
            ))}
            {error && <div className="text-error text-sm" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
          </div>

          <form onSubmit={onSend} style={{ padding: '0.65rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: '0.5rem' }}>
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
