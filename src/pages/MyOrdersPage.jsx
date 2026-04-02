import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { translations } from '../translations';
import { getSavedOrders } from '../lib/savedOrders';
import Header from '../components/Header';
import Footer from '../components/Footer';

function formatSavedAt(ts, lang) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(lang === 'ar' ? 'ar-IQ' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EmptyOrdersIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export default function MyOrdersPage() {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];
  const isRtl = lang === 'ar';
  const [orders, setOrders] = useState(() => getSavedOrders());

  const toggleLang = () => {
    const next = lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', next);
    setLang(next);
    window.dispatchEvent(new CustomEvent('lang-changed', { detail: next }));
  };

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [isRtl, lang]);

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  }, []);

  useEffect(() => {
    const refresh = () => setOrders(getSavedOrders());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return (
    <div className="page-shell">
      <Header t={t} lang={lang} toggleLang={toggleLang} />
      <main id="main-content" className="container py-10 static-content-page my-orders-page-executive my-orders-page-shell" tabIndex={-1}>
        <div className="my-orders-page__intro" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
          <h1 className="my-orders-page__title">{t.myOrdersTitle}</h1>
          <p className="text-muted text-sm" style={{ margin: '0.35rem 0 0' }}>{t.myOrdersSubtitle}</p>
        </div>

        <div className="glass-panel static-content-card my-orders-card my-orders-card-executive">
          {!orders.length ? (
            <div className="my-orders-empty-state" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
              <div className="my-orders-empty-state__icon" aria-hidden>
                <EmptyOrdersIcon />
              </div>
              <p>{t.myOrdersEmpty}</p>
            </div>
          ) : (
            <ul className="my-orders-list-executive" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {orders.map((o) => (
                <li key={o.orderId} className="my-orders-list__row" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
                  <div className="my-orders-row-info">
                    <div className="text-accent my-orders-row-id" style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                      {o.orderId}
                    </div>
                    <div className="text-muted text-sm my-orders-row-meta">
                      {o.usdt ? `${o.usdt} USDT · ` : ''}{t.myOrdersSavedAt}: {formatSavedAt(o.at, lang)}
                    </div>
                  </div>
                  <Link
                    to={`/track?order=${encodeURIComponent(o.orderId)}`}
                    className="btn btn-primary my-orders-track-btn"
                    style={{ fontSize: '0.9rem', padding: '0.45rem 1rem' }}
                  >
                    {t.myOrdersTrack}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 my-orders-home-action" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
          <Link to="/" className="btn btn-outline">{t.legalBackHome}</Link>
        </div>
      </main>
      <Footer t={t} lang={lang} />
    </div>
  );
}
