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
  const isAbout = doc === 'about';

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
      <main id="main-content" className="container py-10 static-content-page" tabIndex={-1}>
        <article
          className={`glass-panel static-content-card${isAbout ? ' static-content-card--about' : ''}`}
          style={{ direction: isRtl ? 'rtl' : 'ltr' }}
        >
          <h1 className="static-content-card__title">{content.title}</h1>
          {content.sections.map((sec, i) => (
            <section
              key={i}
              className={`legal-section mb-5${isAbout && i === 0 ? ' about-section--brand' : ''}`}
            >
              <h2
                className={`mb-2${isAbout && i === 0 ? '' : ' text-muted'}`}
                style={{ marginTop: i === 0 && isAbout ? '0.5rem' : 0 }}
              >
                {sec.h}
              </h2>
              <p>{sec.p}</p>
            </section>
          ))}
          <div className="static-content-actions">
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
