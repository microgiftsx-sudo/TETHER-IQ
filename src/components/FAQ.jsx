import React, { useState } from 'react';

export default function FAQ({ t, lang, faqData }) {
  const isAr = lang === 'ar';
  const faqs = faqData && faqData.length > 0
    ? faqData.map(f => ({ q: isAr ? f.qAr : f.qEn, a: isAr ? f.aAr : f.aEn }))
    : [{ q: t.faq1Q, a: t.faq1A }, { q: t.faq2Q, a: t.faq2A }];

  return (
    <section id="faq" className="py-8 w-full">
      <h2 className="text-center mb-8">{t.faqTitle}</h2>
      <div className="flex flex-col gap-4 mx-auto" style={{ maxWidth: '800px' }}>
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
      className="glass-panel"
      style={{ padding: '1rem 1.5rem', cursor: 'pointer', transition: 'all 0.3s' }}
      onClick={() => setIsOpen(!isOpen)}
    >
      <div className="flex justify-between items-center" style={{ flexDirection: isRtl ? 'row-reverse' : 'row' }}>
        <h3 className="text-accent" style={{ margin: 0, fontSize: '1.1rem', textAlign: isRtl ? 'right' : 'left' }}>
          {question}
        </h3>
        <svg
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s', flexShrink: 0 }}
          width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M6 9L12 15L18 9" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {isOpen && (
        <p className="text-muted mt-4" style={{ margin: '1rem 0 0 0', lineHeight: 1.6, textAlign: isRtl ? 'right' : 'left' }}>
          {answer}
        </p>
      )}
    </div>
  );
}
