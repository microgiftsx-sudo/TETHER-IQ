import React, { useState } from 'react';

export default function FAQ({ t, lang, faqData }) {
  const isAr = lang === 'ar';
  const faqs = faqData && faqData.length > 0
    ? faqData.map((f) => ({ q: isAr ? f.qAr : f.qEn, a: isAr ? f.aAr : f.aEn }))
    : [{ q: t.faq1Q, a: t.faq1A }, { q: t.faq2Q, a: t.faq2A }];

  return (
    <section id="faq" className="home-section">
      <h2 className="home-section-title">{t.faqTitle}</h2>
      <div className="faq-stack">
        {faqs.map((faq, idx) => (
          <FAQItem key={idx} question={faq.q} answer={faq.a} lang={lang} />
        ))}
      </div>
    </section>
  );
}

function FAQItem({ question, answer, lang }) {
  const [isOpen, setIsOpen] = useState(false);
  const isRtl = lang === 'ar';

  return (
    <div
      className="glass-panel faq-item"
      onClick={() => setIsOpen(!isOpen)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsOpen((o) => !o);
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="faq-item__row">
        {isRtl && (
          <svg
            className="faq-item__chevron"
            data-open={isOpen ? 'true' : 'false'}
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <h3 className="faq-item__question" style={{ textAlign: isRtl ? 'right' : 'left' }}>
          {question}
        </h3>
        {!isRtl && (
          <svg
            className="faq-item__chevron"
            data-open={isOpen ? 'true' : 'false'}
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {isOpen && (
        <p className="faq-item__answer" style={{ textAlign: isRtl ? 'right' : 'left' }}>
          {answer}
        </p>
      )}
    </div>
  );
}
