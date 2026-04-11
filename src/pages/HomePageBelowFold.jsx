import React from 'react';
import Steps from '../components/Steps';
import PaymentMethods from '../components/PaymentMethods';
import FAQ from '../components/FAQ';
import ContactSection from '../components/ContactSection';
import LiveActivity from '../components/LiveActivity';
import TrustStats from '../components/TrustStats';
import Testimonials from '../components/Testimonials';

/**
 * أقسام أسفل الطية — حزمة منفصلة لتقليل JS/التحليل في أول إطار (FCP/LCP على الجوال).
 */
export default function HomePageBelowFold({ t, lang, siteConfig }) {
  return (
    <>
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
      <LiveActivity t={t} lang={lang} />
    </>
  );
}
