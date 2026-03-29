import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchOrderStatus } from '../api';
import { translations } from '../translations';
import Header from '../components/Header';
import Footer from '../components/Footer';

export default function OrderTrackPage() {
  const [params] = useSearchParams();
  const orderId = String(params.get('order') || '').trim();

  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];
  const isRtl = lang === 'ar';
  const toggleLang = () => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'));

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [isRtl, lang]);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setErr('');
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchOrderStatus(orderId);
        if (!cancelled && res?.order) setData(res.order);
        if (!cancelled) setErr('');
      } catch (e) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId]);

  const statusLabel = (o) => (lang === 'ar' ? o.statusLabelAr : o.statusLabelEn);

  return (
    <div className="page-shell">
      <Header t={t} lang={lang} toggleLang={toggleLang} />
      <main className="buy-page-main">
        <section className="container py-10" style={{ maxWidth: 640 }}>
          <div className="glass-panel" style={{ padding: '1.75rem', border: '1px solid rgba(0,229,255,0.2)' }}>
            <h1 className="text-accent mb-2" style={{ fontSize: '1.25rem' }}>{t.trackOrderTitle}</h1>
            <p className="text-muted text-sm mb-6">{t.trackOrderSubtitle}</p>

            {!orderId && <p className="text-muted">{t.trackOrderMissing}</p>}

            {orderId && loading && !data && !err && (
              <p className="text-muted">{t.trackOrderLoading}</p>
            )}

            {orderId && err && !data && (
              <p className="text-error" style={{ whiteSpace: 'pre-wrap' }}>{err}</p>
            )}

            {data && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div
                  style={{
                    display: 'inline-block',
                    alignSelf: isRtl ? 'flex-end' : 'flex-start',
                    padding: '0.35rem 0.75rem',
                    borderRadius: 999,
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    background:
                      data.status === 'completed'
                        ? 'rgba(34,197,94,0.2)'
                        : data.status === 'cancelled'
                          ? 'rgba(248,113,113,0.15)'
                          : data.status === 'archived'
                            ? 'rgba(148,163,184,0.2)'
                            : 'rgba(0,229,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  {statusLabel(data)}
                </div>
                <div className="text-sm" style={{ lineHeight: 1.65 }}>
                  <div><span className="text-muted">{t.trackOrderId}</span>{' '}
                    <span className="text-accent" style={{ fontFamily: 'monospace' }}>{data.orderId}</span>
                  </div>
                  <div><span className="text-muted">{t.trackName}</span> {data.name}</div>
                  <div><span className="text-muted">{t.trackUsdt}</span> {data.usdtAmount} USDT</div>
                  <div><span className="text-muted">{t.trackIqd}</span> {data.iqdAmount}</div>
                  <div><span className="text-muted">{t.trackPayment}</span> {data.paymentMethod}</div>
                  <div><span className="text-muted">{t.trackNetwork}</span> {data.network}</div>
                  {data.walletMasked ? (
                    <div><span className="text-muted">{t.trackWallet}</span> {data.walletMasked}</div>
                  ) : null}
                  <div className="text-muted text-xs mt-2">{t.trackUpdated}: {data.updatedAt?.slice(0, 19)?.replace('T', ' ')}</div>
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/" className="btn btn-primary">{t.navHome}</Link>
              <Link to="/buy" className="btn btn-outline">{t.buyNow}</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer t={t} lang={lang} />
    </div>
  );
}
