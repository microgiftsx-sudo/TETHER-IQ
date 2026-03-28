import React, { useEffect, useState } from 'react';
import { getPaymentDetails, getSiteConfig } from '../api';
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
      <Header t={t} lang={lang} toggleLang={toggleLang} links={siteConfig?.links} />

      <main className="page-main container py-8">
        <Hero t={t} lang={lang} usdtAmount={usdtAmount} setUsdtAmount={setUsdtAmount} hero={siteConfig?.hero} />
        <TrustStats t={t} lang={lang} />
        <Steps t={t} lang={lang} />
        <PaymentMethods t={t} lang={lang} />
        <Testimonials t={t} lang={lang} />
        <FAQ t={t} lang={lang} faqData={siteConfig?.faq} />
        <ContactSection t={t} lang={lang} contactLink={siteConfig?.links?.contact} />
      </main>

      <StickyMobileCTA t={t} lang={lang} rate={rate} usdtAmount={usdtAmount} />
      <LiveActivity t={t} lang={lang} />
      <Footer t={t} lang={lang} />
    </div>
  );
}

