import React, { useEffect, useState } from 'react';
import { getTestimonials } from '../api';

const FALLBACK = [
  { id:1, nameAr:'أحمد الموسى', nameEn:'Ahmed Al-Mousa', cityAr:'بغداد', cityEn:'Baghdad', stars:5, textAr:'خدمة ممتازة وسريعة جداً! حولت 500 USDT خلال دقيقتين فقط.', textEn:'Excellent and very fast service! Transferred 500 USDT in just 2 minutes.' },
  { id:2, nameAr:'سارة الخزاعي', nameEn:'Sara Al-Khuzai', cityAr:'البصرة', cityEn:'Basra', stars:5, textAr:'أول مرة أستخدم المنصة وكانت التجربة رائعة. الفريق محترف ومساعد جداً.', textEn:'First time using the platform and it was a great experience. The team is professional.' },
  { id:3, nameAr:'كريم النجار', nameEn:'Kareem Al-Najjar', cityAr:'أربيل', cityEn:'Erbil', stars:5, textAr:'أفضل منصة للعملات المشفرة في العراق. أسعار تنافسية وتحويل فوري.', textEn:'Best crypto exchange in Iraq. Competitive rates and instant transfer.' },
];

function StarRow({ count }) {
  return (
    <div style={{ display: 'flex', gap: '3px' }}>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="#F0B90B">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </div>
  );
}

export default function Testimonials({ t, lang }) {
  const [reviews, setReviews] = useState(FALLBACK);
  const isRtl = lang === 'ar';

  useEffect(() => {
    getTestimonials().then(data => { if (Array.isArray(data) && data.length) setReviews(data); }).catch(() => {});
  }, []);

  return (
    <section className="py-8 w-full" dir="rtl">
      <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>{t.testimonialsTitle}</h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '1.25rem', maxWidth: '1000px', margin: '0 auto',
      }}>
        {reviews.map((r) => {
          const name = r.nameAr;
          const city = r.cityAr;
          const text = r.textAr;
          return (
            <div key={r.id} className="glass-panel" style={{
              padding: '1.5rem', borderColor: 'rgba(0,229,255,0.2)',
              display: 'flex', flexDirection: 'column', gap: '0.75rem',
            }}>
              <StarRow count={r.stars} />

              <p style={{
                color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.7,
                margin: 0, flex: 1,
              }}>
                "{text}"
              </p>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg,var(--accent-primary),#0077FF)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#000', fontWeight: 800, fontSize: '0.85rem',
                  }}>
                    {name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{city}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
