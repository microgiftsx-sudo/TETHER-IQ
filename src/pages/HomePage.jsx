import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPaymentDetails, getSiteConfig } from '../api';
import { getSavedOrders } from '../lib/savedOrders';
import { translations } from '../translations';
import Header from '../components/Header';
import Hero from '../components/Hero';
import Steps from '../components/Steps';
import PaymentMethods from '../components/PaymentMethods';
import FAQ from '../components/FAQ';
import ContactSection from '../components/ContactSection';
import Footer from '../components/Footer';
import LiveActivity from '../components/LiveActivity';
import TrustStats from '../components/TrustStats';
import Testimonials from '../components/Testimonials';
import StickyMobileCTA from '../components/StickyMobileCTA';

function SavedOrdersCue({ t, lang }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const refresh = () => setVisible(getSavedOrders().length > 0);
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('exchange-iq-saved-orders-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('exchange-iq-saved-orders-changed', refresh);
    };
  }, []);
  if (!visible) return null;
  return (
    <div className="page-section">
      <div
        className="glass-panel container"
        style={{
          padding: '0.85rem 1.25rem',
          textAlign: lang === 'ar' ? 'right' : 'left',
          border: '1px solid rgba(0,229,255,0.2)',
        }}
      >
        <Link to="/my-orders" style={{ color: 'var(--accent-primary)', fontWeight: 700, textDecoration: 'none' }}>
          {t.savedOrdersCue}
        </Link>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.add('has-sticky-mobile-cta');
    return () => document.documentElement.classList.remove('has-sticky-mobile-cta');
  }, []);

  const toggleLang = () => {
    const next = lang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', next);
    setLang(next);
    window.dispatchEvent(new CustomEvent('lang-changed', { detail: next }));
  };

  const [usdtAmount, setUsdtAmount] = useState(100);
  const [rate, setRate] = useState(1320);
  const [siteConfig, setSiteConfig] = useState(null);

  useEffect(() => {
    getPaymentDetails()
      .then((d) => { if (d?.rate) setRate(Number(d.rate)); })
      .catch(() => {});
    getSiteConfig()
      .then(setSiteConfig)
      .catch(() => {});
  }, []);

  return (
    <div className="page-shell">
      <a href="#main-content" className="skip-to-content">
        {t.skipToContent}
      </a>
      <Header t={t} lang={lang} toggleLang={toggleLang} links={siteConfig?.links} />

      <main id="main-content" className="page-main container py-8" tabIndex={-1}>
        <div className="page-section page-section--flush">
          <Hero t={t} lang={lang} usdtAmount={usdtAmount} setUsdtAmount={setUsdtAmount} hero={siteConfig?.hero} />
        </div>
        <SavedOrdersCue t={t} lang={lang} />
        <div className="page-section">
          <TrustStats t={t} lang={lang} />
        </div>
        <div className="page-section">
          <Steps t={t} lang={lang} />
        </div>
        <div className="page-section">
          <PaymentMethods t={t} lang={lang} />
        </div>
        <div className="page-section">
          <Testimonials t={t} lang={lang} />
        </div>
        <div className="page-section">
          <FAQ t={t} lang={lang} faqData={siteConfig?.faq} />
        </div>
        <div className="page-section">
          <ContactSection t={t} lang={lang} contactLink={siteConfig?.links?.contact} />
        </div>
      </main>

      <StickyMobileCTA t={t} lang={lang} rate={rate} usdtAmount={usdtAmount} />
      <LiveActivity t={t} lang={lang} />
      <Footer t={t} lang={lang} />
    </div>
  );
}

