import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchOrderStatus } from '../api';
import { translations } from '../translations';
import Header from '../components/Header';
import Footer from '../components/Footer';
import {
  IconInvoiceHash,
  IconInvoiceUser,
  IconInvoiceCoin,
  IconInvoiceBank,
  IconInvoiceCard,
  IconInvoiceLink,
  IconInvoiceWallet,
  IconInvoiceClock,
} from '../components/InvoiceLineIcons';

function formatTrackDate(iso, lang) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(lang === 'ar' ? 'ar-IQ' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function badgeClass(status) {
  switch (status) {
    case 'completed':
      return 'order-track-badge order-track-badge--completed';
    case 'cancelled':
      return 'order-track-badge order-track-badge--cancelled';
    case 'archived':
      return 'order-track-badge order-track-badge--archived';
    default:
      return 'order-track-badge order-track-badge--processing';
  }
}

function InvoiceRow({ icon: Icon, label, children, mono }) {
  return (
    <div className="order-track-row">
      <span className="order-track-row-label">
        <Icon className="order-track-icon" />
        {label}
      </span>
      <span className={mono ? 'order-track-value-mono order-track-row-value' : 'order-track-row-value'}>{children}</span>
    </div>
  );
}

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
  const [notifyPerm, setNotifyPerm] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [deniedFlash, setDeniedFlash] = useState(false);

  const prevStatusRef = useRef(null);

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

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setNotifyPerm(Notification.permission);
  }, []);

  useEffect(() => {
    if (!data?.status || !data?.orderId) return;
    const prev = prevStatusRef.current;
    if (prev === null) {
      prevStatusRef.current = data.status;
      return;
    }
    if (prev === data.status) return;
    prevStatusRef.current = data.status;

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!['completed', 'cancelled', 'archived'].includes(data.status)) return;

    const tid = data.orderId;
    let title;
    let body;
    if (data.status === 'completed') {
      title = t.trackNotifCompletedTitle;
      body = `${t.trackNotifCompletedBody} (${tid})`;
    } else if (data.status === 'cancelled') {
      title = t.trackNotifCancelledTitle;
      body = `${t.trackNotifCancelledBody} (${tid})`;
    } else {
      title = t.trackNotifArchivedTitle;
      body = `${t.trackNotifArchivedBody} (${tid})`;
    }
    try {
      const n = new Notification(title, {
        body,
        tag: `tether-order-${tid}-${data.status}`,
      });
      void n;
    } catch {
      /* ignore */
    }
  }, [data, t]);

  const statusLabel = (o) => (lang === 'ar' ? o.statusLabelAr : o.statusLabelEn);

  const requestNotify = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const p = await Notification.requestPermission();
      setNotifyPerm(p);
      if (p === 'denied') {
        setDeniedFlash(true);
        window.setTimeout(() => setDeniedFlash(false), 12000);
      }
    } catch {
      setNotifyPerm('denied');
      setDeniedFlash(true);
      window.setTimeout(() => setDeniedFlash(false), 12000);
    }
  };

  return (
    <div className="page-shell">
      <div className="no-print">
        <Header t={t} lang={lang} toggleLang={toggleLang} />
      </div>
      <main className="buy-page-main">
        <section className="container py-10">
          <div
            className="order-track-card glass-panel order-invoice-shell"
            id="order-invoice"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            {data && (
              <div className="only-print invoice-pro-print">
                <div className="invoice-pro-print-head">
                  <img src="/logo.png" alt="" className="invoice-pro-logo" />
                  <div className="invoice-pro-print-text">
                    <div className="invoice-pro-site">TETHER IQ</div>
                    <div className="invoice-pro-doc">{t.trackInvoicePrintTitle}</div>
                    <div className="invoice-pro-id mono">{data.orderId}</div>
                  </div>
                  <div className={`${badgeClass(data.status)} invoice-pro-badge`}>{statusLabel(data)}</div>
                </div>
                <div className="invoice-pro-rule" />
              </div>
            )}

            <div className="no-print invoice-screen-head">
              <div className="invoice-card-brand">
                <img src="/logo.png" alt="" width={44} height={44} style={{ objectFit: 'contain' }} />
                <div>
                  <div className="invoice-card-brand-name">TETHER IQ</div>
                  <div className="invoice-card-brand-sub text-muted text-sm">{t.trackInvoicePrintTitle}</div>
                </div>
              </div>
              <div className="order-track-top">
                <div className="order-track-title-block">
                  <h1 className="order-track-title">{t.trackOrderTitle}</h1>
                  <p className="order-track-subtitle">{t.trackOrderSubtitle}</p>
                </div>
                {data && (
                  <div className={badgeClass(data.status)} role="status" aria-live="polite">
                    {statusLabel(data)}
                  </div>
                )}
              </div>
            </div>

            {orderId && typeof Notification !== 'undefined' && notifyPerm === 'default' && (
              <div className="order-track-notify no-print">
                <span style={{ flex: '1 1 200px' }}>{t.trackNotifyPrompt}</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={requestNotify}>
                  {t.trackNotifyButton}
                </button>
              </div>
            )}
            {orderId && notifyPerm === 'granted' && (
              <div className="order-track-notify no-print" style={{ borderColor: 'rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.08)' }}>
                {t.trackNotifyActive}
              </div>
            )}
            {orderId && deniedFlash && (
              <div className="order-track-notify no-print" style={{ borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)' }}>
                {t.trackNotifyDenied}
              </div>
            )}

            {!orderId && <p className="text-muted">{t.trackOrderMissing}</p>}

            {orderId && loading && !data && !err && (
              <p className="text-muted">{t.trackOrderLoading}</p>
            )}

            {orderId && err && !data && (
              <p className="text-error" style={{ whiteSpace: 'pre-wrap' }}>{err}</p>
            )}

            {data && (
              <div className="order-track-details">
                <InvoiceRow icon={IconInvoiceHash} label={t.trackOrderId} mono>
                  {data.orderId}
                </InvoiceRow>
                <InvoiceRow icon={IconInvoiceUser} label={t.trackName}>
                  {data.name}
                </InvoiceRow>
                <InvoiceRow icon={IconInvoiceCoin} label={t.trackUsdt}>
                  {data.usdtAmount} USDT
                </InvoiceRow>
                <InvoiceRow icon={IconInvoiceBank} label={t.trackIqd}>
                  {data.iqdAmount}
                </InvoiceRow>
                <InvoiceRow icon={IconInvoiceCard} label={t.trackPayment}>
                  {data.paymentMethod}
                </InvoiceRow>
                <InvoiceRow icon={IconInvoiceLink} label={t.trackNetwork}>
                  {data.network}
                </InvoiceRow>
                {data.walletMasked ? (
                  <InvoiceRow icon={IconInvoiceWallet} label={t.trackWallet} mono>
                    {data.walletMasked}
                  </InvoiceRow>
                ) : null}
                <div className="order-track-meta">
                  <span className="order-track-meta-inner">
                    <IconInvoiceClock className="order-track-icon order-track-icon--meta" />
                    {t.trackUpdated}: {formatTrackDate(data.updatedAt, lang)}
                  </span>
                </div>
              </div>
            )}

            {data && (
              <div className="no-print" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => window.print()}
                >
                  {t.trackInvoicePrint}
                </button>
                <p className="text-muted text-xs mt-2" style={{ maxWidth: 360, margin: '0.5rem auto 0' }}>
                  {t.trackInvoicePrintHint}
                </p>
              </div>
            )}

            <div className="order-track-actions no-print">
              <Link to="/" className="btn btn-primary">{t.navHome}</Link>
              <Link to="/buy" className="btn btn-outline">{t.buyNow}</Link>
            </div>
          </div>
        </section>
      </main>
      <div className="no-print">
        <Footer t={t} lang={lang} />
      </div>
    </div>
  );
}
