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

export default function HomePage() {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const toggleLang = () => setLang((prev) => {
    const next = prev === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', next);
    return next;
  });

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
    <div className="flex flex-col" style={{ minHeight: '100vh', justifyContent: 'space-between' }}>
      <Header t={t} lang={lang} toggleLang={toggleLang} rate={rate} links={siteConfig?.links} />

      <main className="container flex-col gap-6 py-8" style={{ flex: 1, display: 'flex' }}>
        <Hero t={t} lang={lang} usdtAmount={usdtAmount} setUsdtAmount={setUsdtAmount} hero={siteConfig?.hero} />
        <Steps t={t} lang={lang} />
        <PaymentMethods t={t} lang={lang} />
        <FAQ t={t} lang={lang} faqData={siteConfig?.faq} />
        <ContactSection t={t} lang={lang} contactLink={siteConfig?.links?.contact} />
      </main>

      <LiveActivity t={t} lang={lang} />
      <Footer t={t} lang={lang} />
    </div>
  );
}

