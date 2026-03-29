import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { translations } from '../translations';
import { legalDocs } from '../content/legalDocs';
import Header from '../components/Header';
import Footer from '../components/Footer';

export default function LegalPage({ doc }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];
  const isRtl = lang === 'ar';
  const toggleLang = () => {
    const next = lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', next);
    setLang(next);
    window.dispatchEvent(new CustomEvent('lang-changed', { detail: next }));
  };

  const content = legalDocs[lang]?.[doc];

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [isRtl, lang]);

  if (!content) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page-shell">
      <Header t={t} lang={lang} toggleLang={toggleLang} />
      <main id="main-content" className="container py-10" style={{ maxWidth: 720 }} tabIndex={-1}>
        <article
          className="glass-panel"
          style={{
            padding: '2rem',
            border: '1px solid rgba(0,229,255,0.2)',
            direction: isRtl ? 'rtl' : 'ltr',
          }}
        >
          <h1 className="text-accent mb-6" style={{ fontSize: '1.75rem', marginTop: 0 }}>
            {content.title}
          </h1>
          {content.sections.map((sec, i) => (
            <section key={i} className="mb-5">
              <h2 className="text-muted mb-2" style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                {sec.h}
              </h2>
              <p style={{ lineHeight: 1.75, color: 'var(--text-primary)', margin: 0 }}>{sec.p}</p>
            </section>
          ))}
          <div className="mt-8">
            <Link to="/" className="btn btn-outline">
              {t.legalBackHome}
            </Link>
          </div>
        </article>
      </main>
      <Footer t={t} lang={lang} />
    </div>
  );
}
