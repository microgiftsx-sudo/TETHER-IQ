import React, { useEffect, useMemo, useState } from 'react';
import { getPaymentDetails } from '../api';

import logoFastpay from '../assets/payment-logos/fastpay.png';
import logoFastpayWebp from '../assets/payment-logos/fastpay.webp';
import logoZaincash from '../assets/payment-logos/zaincash.png';
import logoZaincashWebp from '../assets/payment-logos/zaincash.webp';
import logoMastercard from '../assets/payment-logos/mastercard.svg';
import logoFib from '../assets/payment-logos/fib.png';
import logoFibWebp from '../assets/payment-logos/fib.webp';
import logoAsia from '../assets/payment-logos/asia-hawala.jpg';
import logoAsiaWebp from '../assets/payment-logos/asia-hawala.webp';

/** شعارات حقيقية — مستوردة عبر Vite (مسار مضمون في dev والإنتاج) */
const LOGO_RASTER = {
  fastPay: { webp: logoFastpayWebp, fallback: logoFastpay, mime: 'image/png' },
  zainCash: { webp: logoZaincashWebp, fallback: logoZaincash, mime: 'image/png' },
  fib: { webp: logoFibWebp, fallback: logoFib, mime: 'image/png' },
  asiaHawala: { webp: logoAsiaWebp, fallback: logoAsia, mime: 'image/jpeg' },
};

const ALL = [
  { key: 'fastPay', name: 'FastPay', nameAr: 'فاست باي' },
  { key: 'zainCash', name: 'Zain Cash', nameAr: 'زين كاش' },
  { key: 'mastercard', name: 'MasterCard', nameAr: 'ماستر كارد' },
  { key: 'fib', name: 'FIB', nameAr: 'المصرف الأول' },
  { key: 'asiaHawala', name: 'Asia Hawala', nameAr: 'آسيا حوالة' },
];

export default function PaymentMethods({ t, lang }) {
  const isRtl = lang === 'ar';
  const [apiMethods, setApiMethods] = useState(null);

  useEffect(() => {
    let ok = true;
    getPaymentDetails()
      .then((d) => ok && setApiMethods(d?.methods || {}))
      .catch(() => ok && setApiMethods({}));
    return () => {
      ok = false;
    };
  }, []);

  /** إذا كان الـ API لا يعيد methods أو يعيد {} أو مفاتيح لا تطابق ALL، كانت القائمة تصبح فارغة ولا يظهر أي صف — نعرض كل الطرق كاحتياطي */
  const visible = useMemo(() => {
    if (apiMethods == null) return ALL;
    const keys = typeof apiMethods === 'object' && apiMethods !== null ? Object.keys(apiMethods) : [];
    if (keys.length === 0) return ALL;
    const filtered = ALL.filter((m) => Object.prototype.hasOwnProperty.call(apiMethods, m.key));
    return filtered.length > 0 ? filtered : ALL;
  }, [apiMethods]);

  return (
    <section id="payment-methods" className="home-section">
      <h2 className="home-section-title">{t.paymentTitle}</h2>
      <p className="home-section-lead">{t.paymentSubtitle}</p>
      <div className="payment-grid">
        {visible.map((m) => (
          <div key={m.key} className="glass-panel payment-card">
            <div className="payment-card__logo">
              {m.key === 'mastercard' ? (
                <img
                  className="payment-card__img"
                  src={logoMastercard}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={120}
                  height={120}
                />
              ) : (
                <picture>
                  <source type="image/webp" srcSet={LOGO_RASTER[m.key].webp} />
                  <img
                    className="payment-card__img"
                    src={LOGO_RASTER[m.key].fallback}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={120}
                    height={120}
                  />
                </picture>
              )}
            </div>
            <span className="payment-card__label">{isRtl ? m.nameAr : m.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
