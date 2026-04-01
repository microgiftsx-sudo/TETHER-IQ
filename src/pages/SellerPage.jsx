import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPaymentDetails, postAdminFixedRate } from '../api';
import { translations } from '../translations';

const TOKEN_KEY = 'seller_admin_crm_token';

export default function SellerPage() {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];
  const isRtl = lang === 'ar';

  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [isRtl, lang]);

  useEffect(() => {
    getPaymentDetails()
      .then((d) => {
        if (d?.rate != null) setDraft(String(d.rate));
      })
      .catch(() => {});
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setMsg('');
    setErr('');
    const tok = token.trim();
    if (!tok) {
      setErr(t.sellerNeedToken);
      return;
    }
    const v = Number(String(draft).replace(/,/g, ''));
    if (!Number.isFinite(v) || v < 1) {
      setErr(t.sellerInvalidRate);
      return;
    }
    try {
      const r = await postAdminFixedRate(tok, v);
      try {
        sessionStorage.setItem(TOKEN_KEY, tok);
      } catch {
        /* ignore */
      }
      setDraft(String(r.rate ?? r.fixedRate ?? v));
      setMsg(t.sellerSaved);
    } catch (e2) {
      setErr(String(e2?.message || e2));
    }
  };

  return (
    <div className="page-shell">
      <main className="container py-10" style={{ maxWidth: 440 }}>
        <div
          className="glass-panel"
          style={{
            padding: '1.25rem 1.35rem',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <h1 className="text-accent mb-1" style={{ fontSize: '1.15rem', fontWeight: 700 }}>
            {t.sellerTitle}
          </h1>
          <p className="text-muted text-sm mb-4" style={{ lineHeight: 1.45 }}>
            {t.sellerHint}
          </p>

          <form onSubmit={onSave} className="flex flex-col gap-3">
            <div className="input-group">
              <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                {t.sellerToken}
              </label>
              <input
                type="password"
                className="input-control"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                dir="ltr"
                style={{ textAlign: 'left' }}
              />
            </div>
            <div className="input-group">
              <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                {t.sellerRate}
              </label>
              <input
                type="text"
                inputMode="decimal"
                className="input-control"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                dir="ltr"
                style={{ textAlign: 'left' }}
              />
            </div>
            {err && (
              <div className="text-error text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                {err}
              </div>
            )}
            {msg && <div className="text-sm" style={{ color: 'var(--success, #22c55e)' }}>{msg}</div>}
            <button type="submit" className="btn btn-primary">
              {t.sellerSave}
            </button>
          </form>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm" style={{ justifyContent: isRtl ? 'flex-end' : 'flex-start' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
            onClick={() => {
              const next = lang === 'ar' ? 'en' : 'ar';
              localStorage.setItem('lang', next);
              setLang(next);
            }}
          >
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
          <Link to="/" className="text-muted" style={{ alignSelf: 'center' }}>
            {t.navHome}
          </Link>
        </div>
      </main>
    </div>
  );
}
