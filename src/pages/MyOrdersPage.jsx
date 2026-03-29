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
      <main id="main-content" className="container py-10" style={{ maxWidth: 640 }} tabIndex={-1}>
        <div className="mb-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
          <h1 className="text-accent mb-2" style={{ marginTop: 0 }}>{t.myOrdersTitle}</h1>
          <p className="text-muted text-sm" style={{ margin: 0 }}>{t.myOrdersSubtitle}</p>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid rgba(0,229,255,0.2)' }}>
          {!orders.length ? (
            <p className="text-muted" style={{ margin: 0, direction: isRtl ? 'rtl' : 'ltr' }}>{t.myOrdersEmpty}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {orders.map((o) => (
                <li
                  key={o.orderId}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.85rem 0',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    direction: isRtl ? 'rtl' : 'ltr',
                  }}
                >
                  <div>
                    <div className="text-accent" style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                      {o.orderId}
                    </div>
                    <div className="text-muted text-sm">
                      {o.usdt ? `${o.usdt} USDT · ` : ''}{t.myOrdersSavedAt}: {formatSavedAt(o.at, lang)}
                    </div>
                  </div>
                  <Link
                    to={`/track?order=${encodeURIComponent(o.orderId)}`}
                    className="btn btn-primary"
                    style={{ fontSize: '0.9rem', padding: '0.45rem 1rem' }}
                  >
                    {t.myOrdersTrack}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6">
          <Link to="/" className="btn btn-outline">{t.legalBackHome}</Link>
        </div>
      </main>
      <Footer t={t} lang={lang} />
    </div>
  );
}
