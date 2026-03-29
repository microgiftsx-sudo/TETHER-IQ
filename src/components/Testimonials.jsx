import React, { useEffect, useState } from 'react';
import { getTestimonials } from '../api';

const PER_PAGE = 3;

const FALLBACK = [
  { id: 1, nameAr: 'أحمد الموسى', cityAr: 'بغداد', stars: 5, textAr: 'خدمة ممتازة وسريعة جداً! حولت 500 USDT خلال دقيقتين فقط. سعر أفضل من أي مكان آخر جربته في العراق.' },
  { id: 2, nameAr: 'سارة الخزاعي', cityAr: 'البصرة', stars: 5, textAr: 'أول مرة أستخدم المنصة وكانت التجربة رائعة. الفريق محترف ومساعد جداً. بالتأكيد سأعود مرة أخرى.' },
  { id: 3, nameAr: 'كريم النجار', cityAr: 'أربيل', stars: 5, textAr: 'أفضل منصة للعملات المشفرة في العراق. أسعار تنافسية وتحويل فوري. أنصح بها للجميع.' },
];

function StarRow({ count }) {
  return (
    <div className="testimonials-stars" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width="15" height="15" viewBox="0 0 24 24" fill="#C4A008">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

function NavBtn({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      className="testimonials-nav__btn"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function Testimonials({ t, lang }) {
  const [reviews, setReviews] = useState(FALLBACK);
  const [page, setPage] = useState(0);
  const isAr = lang === 'ar';

  useEffect(() => {
    getTestimonials()
      .then((data) => {
        if (Array.isArray(data) && data.length) setReviews(data);
      })
      .catch(() => {});
  }, []);

  const totalPages = Math.ceil(reviews.length / PER_PAGE);
  const slice = reviews.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const prev = () => setPage((p) => Math.max(0, p - 1));
  const next = () => setPage((p) => Math.min(totalPages - 1, p + 1));

  const from = page * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE + PER_PAGE, reviews.length);
  const total = reviews.length;
  const counterText = isAr
    ? `${from} - ${to} من ${total} تقييم`
    : `${from}–${to} of ${total} reviews`;

  return (
    <section className="testimonials-section">
      <h2 className="home-section-title">{t.testimonialsTitle}</h2>

      <div className="testimonials-grid">
        {slice.map((r) => (
          <div key={r.id} className="glass-panel testimonials-card">
            <StarRow count={r.stars} />
            <p className="testimonials-quote">
              &ldquo;{r.textAr}&rdquo;
            </p>
            <div className="testimonials-footer">
              <div className="testimonials-user">
                <div className="testimonials-avatar">{r.nameAr.charAt(0)}</div>
                <div>
                  <div className="testimonials-name">{r.nameAr}</div>
                  <div className="testimonials-city">{r.cityAr}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
        {Array.from({ length: PER_PAGE - slice.length }).map((_, i) => (
          <div key={`placeholder-${i}`} className="testimonials-placeholder" style={{ visibility: 'hidden' }} aria-hidden="true" />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="testimonials-nav">
          <NavBtn onClick={prev} disabled={page === 0}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </NavBtn>

          <div className="testimonials-dots">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                className={`testimonials-dot${i === page ? ' testimonials-dot--active' : ''}`}
                onClick={() => setPage(i)}
                aria-label={isAr ? `الصفحة ${i + 1}` : `Page ${i + 1}`}
              />
            ))}
          </div>

          <NavBtn onClick={next} disabled={page === totalPages - 1}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </NavBtn>
        </div>
      )}

      {totalPages > 1 && (
        <p className="testimonials-counter">{counterText}</p>
      )}
    </section>
  );
}
