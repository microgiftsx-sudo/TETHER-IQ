import React, { useEffect, useMemo, useState } from 'react';
import { getPaymentDetails } from '../api';

const ALL = [
  {
    key: 'fastPay',
    name: 'FastPay',
    nameAr: 'فاست باي',
    image: '/fastpay.png'
  },
  { key: 'zainCash', name: 'Zain Cash', nameAr: 'زين كاش', image: '/zaincash.png' },
  {
    key: 'mastercard',
    name: 'MasterCard',
    nameAr: 'ماستر كارد',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="19" cy="24" r="13" fill="#EB001B" />
        <circle cx="29" cy="24" r="13" fill="#F79E1B" fillOpacity="0.9" />
        <path d="M24 13.5a13 13 0 0 1 0 21A13 13 0 0 1 24 13.5z" fill="#FF5F00" />
      </svg>
    ),
  },
  { key: 'fib', name: 'FIB', nameAr: 'المصرف الأول', image: '/fip.png' },
  { key: 'asiaHawala', name: 'Asia Hawala', nameAr: 'آسيا حوالة', image: '/asia.jpg' },
];

export default function PaymentMethods({ t, lang }) {
  const isRtl = lang === 'ar';
  const [apiMethods, setApiMethods] = useState(null);

  useEffect(() => {
    let ok = true;
    getPaymentDetails()
      .then((d) => ok && setApiMethods(d?.methods || {}))
      .catch(() => ok && setApiMethods({}));
    return () => { ok = false; };
  }, []);

  const visible = useMemo(() => {
    if (!apiMethods) return ALL;
    return ALL.filter((m) => Object.prototype.hasOwnProperty.call(apiMethods, m.key));
  }, [apiMethods]);

  return (
    <section id="payment-methods" className="py-8 w-full">
      <h2 className="text-center mb-8">{t.paymentTitle}</h2>
      <p className="text-center text-muted mb-8" style={{ fontSize: '1rem', maxWidth: '600px', margin: '0 auto 2rem' }}>
        {t.paymentSubtitle}
      </p>
      <div className="payment-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1.5rem',
        maxWidth: '900px',
        margin: '0 auto',
      }}
      >
        {visible.map((m) => (
          <div key={m.key}
            className="glass-panel payment-card"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '0.75rem', padding: '1.75rem 1rem',
              transition: 'transform 0.3s, box-shadow 0.3s',
              cursor: 'default',
              borderColor: 'rgba(0,229,255,0.3)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(0,229,255,0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
          >
            <div style={{ width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {m.image
                ? <img src={m.image} alt={m.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                : m.icon}
            </div>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
              {isRtl ? m.nameAr : m.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
