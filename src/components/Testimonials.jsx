import React, { useEffect, useState } from 'react';
import { getTestimonials } from '../api';

const PER_PAGE = 3;

const FALLBACK = [
  { id:1, nameAr:'أحمد الموسى',   cityAr:'بغداد',  stars:5, textAr:'خدمة ممتازة وسريعة جداً! حولت 500 USDT خلال دقيقتين فقط. سعر أفضل من أي مكان آخر جربته في العراق.' },
  { id:2, nameAr:'سارة الخزاعي', cityAr:'البصرة', stars:5, textAr:'أول مرة أستخدم المنصة وكانت التجربة رائعة. الفريق محترف ومساعد جداً. بالتأكيد سأعود مرة أخرى.' },
  { id:3, nameAr:'كريم النجار',   cityAr:'أربيل',  stars:5, textAr:'أفضل منصة للعملات المشفرة في العراق. أسعار تنافسية وتحويل فوري. أنصح بها للجميع.' },
];

function StarRow({ count }) {
  return (
    <div style={{ display: 'flex', gap: '3px' }}>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width="15" height="15" viewBox="0 0 24 24" fill="#F0B90B">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </div>
  );
}

function NavBtn({ onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '38px', height: '38px', borderRadius: '50%', border: '1.5px solid',
      borderColor: disabled ? 'rgba(255,255,255,0.1)' : 'rgba(0,229,255,0.45)',
      background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(0,229,255,0.07)',
      color: disabled ? 'rgba(255,255,255,0.2)' : 'var(--accent-primary)',
      cursor: disabled ? 'default' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s', flexShrink: 0,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(0,229,255,0.15)'; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'rgba(0,229,255,0.07)'; }}
    >
      {children}
    </button>
  );
}

export default function Testimonials({ t }) {
  const [reviews, setReviews] = useState(FALLBACK);
  const [page, setPage] = useState(0);

  useEffect(() => {
    getTestimonials()
      .then(data => { if (Array.isArray(data) && data.length) setReviews(data); })
      .catch(() => {});
  }, []);

  const totalPages = Math.ceil(reviews.length / PER_PAGE);
  const slice = reviews.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const prev = () => setPage(p => Math.max(0, p - 1));
  const next = () => setPage(p => Math.min(totalPages - 1, p + 1));

  return (
    <section className="py-8 w-full" dir="rtl">
      <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>{t.testimonialsTitle}</h2>

      {/* Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '1.25rem', maxWidth: '1000px', margin: '0 auto',
      }}>
        {slice.map((r) => (
          <div key={r.id} className="glass-panel" style={{
            padding: '1.5rem', borderColor: 'rgba(0,229,255,0.2)',
            display: 'flex', flexDirection: 'column', gap: '0.75rem',
          }}>
            <StarRow count={r.stars} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.7, margin: 0, flex: 1 }}>
              "{r.textAr}"
            </p>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg,var(--accent-primary),#0077FF)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#000', fontWeight: 800, fontSize: '0.85rem',
                }}>
                  {r.nameAr.charAt(0)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{r.nameAr}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{r.cityAr}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination - only show if more than one page */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '0.75rem', marginTop: '1.75rem',
        }}>
          {/* Prev */}
          <NavBtn onClick={prev} disabled={page === 0}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </NavBtn>

          {/* Dots */}
          <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setPage(i)} style={{
                width: i === page ? '22px' : '9px',
                height: '9px',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.3s',
                background: i === page ? 'var(--accent-primary)' : 'rgba(255,255,255,0.2)',
                padding: 0,
              }} />
            ))}
          </div>

          {/* Next */}
          <NavBtn onClick={next} disabled={page === totalPages - 1}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </NavBtn>
        </div>
      )}

      {/* Page counter */}
      {totalPages > 1 && (
        <p style={{ textAlign: 'center', marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {`${page * PER_PAGE + 1} - ${Math.min(page * PER_PAGE + PER_PAGE, reviews.length)} من ${reviews.length} تقييم`}
        </p>
      )}
    </section>
  );
}
