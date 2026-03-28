import React, { useEffect, useState } from 'react';
import { getRecentActivity } from '../api';

function relTime(iso, isRtl) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return isRtl ? 'الآن' : 'Just now';
  if (s < 3600) return isRtl ? `منذ ${Math.floor(s / 60)} د` : `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return isRtl ? `منذ ${Math.floor(s / 3600)} س` : `${Math.floor(s / 3600)}h ago`;
  return isRtl ? `منذ ${Math.floor(s / 86400)} يوم` : `${Math.floor(s / 86400)}d ago`;
}

function pathLabel(p, isRtl) {
  if (p === '/' || p === '') return isRtl ? 'الرئيسية' : 'Home';
  if (p.startsWith('/buy')) return isRtl ? 'شراء' : 'Buy';
  return p.length > 28 ? `${p.slice(0, 26)}…` : p;
}

function deviceLabel(d, t) {
  const x = String(d || '').toLowerCase();
  if (x === 'mobile') return t.deviceMobile;
  if (x === 'tablet') return t.deviceTablet;
  if (x === 'desktop') return t.deviceDesktop;
  return t.deviceUnknown;
}

export default function RecentSiteActivity({ t, lang }) {
  const isRtl = lang === 'ar';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let on = true;
    getRecentActivity(5)
      .then((d) => on && setData(d))
      .catch((e) => on && setErr(String(e?.message || e)));
    return () => { on = false; };
  }, []);

  if (err || !data) return null;

  const visits = data.visits || [];
  const orders = data.orders || [];
  if (!visits.length && !orders.length) return null;

  return (
    <section className="recent-site-activity py-8 w-full" dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 900, margin: '0 auto' }}>
      <h3 className="text-center text-accent mb-2" style={{ fontSize: '1.15rem', fontWeight: 800 }}>
        {t.siteActivityTitle}
      </h3>
      <p className="text-center text-muted text-sm mb-4" style={{ maxWidth: 520, margin: '0 auto' }}>
        {t.siteActivityDisclaimer}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(0,229,255,0.2)' }}>
          <h4 className="text-sm text-muted mb-3" style={{ fontWeight: 700 }}>{t.siteActivityVisits}</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {visits.length === 0 ? (
              <li className="text-muted text-sm">—</li>
            ) : visits.map((v, i) => (
              <li key={`${v.at}-${i}`} className="text-sm" style={{ borderBottom: i < visits.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', paddingBottom: i < visits.length - 1 ? '0.65rem' : 0 }}>
                <div style={{ fontWeight: 600 }}>{pathLabel(v.path, isRtl)}</div>
                <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
                  {deviceLabel(v.device, t)} · {relTime(v.at, isRtl)}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid rgba(0,229,255,0.2)' }}>
          <h4 className="text-sm text-muted mb-3" style={{ fontWeight: 700 }}>{t.siteActivityOrders}</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {orders.length === 0 ? (
              <li className="text-muted text-sm">—</li>
            ) : orders.map((o, i) => (
              <li key={`${o.at}-${i}`} className="text-sm" style={{ borderBottom: i < orders.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', paddingBottom: i < orders.length - 1 ? '0.65rem' : 0 }}>
                <div style={{ fontWeight: 600, direction: 'ltr', textAlign: isRtl ? 'right' : 'left', unicodeBidi: 'plaintext' }}>
                  {o.usdtAmount} USDT · {o.paymentMethod}
                </div>
                <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
                  {relTime(o.at, isRtl)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
