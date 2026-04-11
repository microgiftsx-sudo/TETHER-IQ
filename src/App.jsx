import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import VisitTracker from './components/VisitTracker';
import { getSiteConfig } from './api';
import { translations } from './translations';
import { SiteConfigContext } from './context/SiteConfigContext';

const BuyPage = lazy(() => import('./pages/BuyPage'));
const OrderTrackPage = lazy(() => import('./pages/OrderTrackPage'));
const MyOrdersPage = lazy(() => import('./pages/MyOrdersPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const AdminCrmPage = lazy(() => import('./pages/AdminCrmPage'));
const SellerPage = lazy(() => import('./pages/SellerPage'));
const ChatWidget = lazy(() => import('./components/ChatWidget'));

function MaintenancePage({ messageAr, messageEn }) {
  const [lang, setLang] = useState('ar');
  const msg = lang === 'ar' ? messageAr : messageEn;
  return (
    <div className="maintenance-page" style={{
      direction: lang === 'ar' ? 'rtl' : 'ltr',
      color: '#f8fafc',
    }}>
      <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(0,229,255,0.1)', border: '2px solid rgba(0,229,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      </div>
      <h1 style={{ color: 'var(--accent-primary,#00E5FF)', fontSize: '2rem', margin: 0 }}>
        {lang === 'ar' ? 'الموقع تحت الصيانة' : 'Under Maintenance'}
      </h1>
      <p style={{ color: 'rgba(248,250,252,0.65)', fontSize: '1.1rem', maxWidth: '500px', lineHeight: 1.6 }}>
        {msg || (lang === 'ar' ? 'نعود قريباً.' : 'We\'ll be back soon.')}
      </p>
      <button onClick={() => setLang(l => l === 'ar' ? 'en' : 'ar')}
        style={{ background: 'transparent', border: '1px solid rgba(0,229,255,0.35)', color: '#00E5FF',
          borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.9rem' }}>
        {lang === 'ar' ? 'English' : 'العربية'}
      </button>
    </div>
  );
}

function RouteFallback() {
  return (
    <div
      className="app-root"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
      }}
    >
      <span className="app-shell-loading-spinner" aria-label="Loading" />
    </div>
  );
}

export default function App() {
  const [siteConfig, setSiteConfig] = useState(null);
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const [chatReady, setChatReady] = useState(false);
  const t = translations[lang];

  useEffect(() => {
    const handler = (e) => setLang(e.detail || localStorage.getItem('lang') || 'ar');
    window.addEventListener('lang-changed', handler);
    return () => window.removeEventListener('lang-changed', handler);
  }, []);

  useEffect(() => {
    getSiteConfig()
      .then(setSiteConfig)
      .catch(() => setSiteConfig(null));
  }, []);

  useEffect(() => {
    if (siteConfig?.maintenance?.enabled) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) setChatReady(true);
    };
    let id;
    const useRic = typeof requestIdleCallback !== 'undefined';
    if (useRic) {
      id = requestIdleCallback(run, { timeout: 2000 });
    } else {
      id = setTimeout(run, 0);
    }
    return () => {
      cancelled = true;
      if (useRic) cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [siteConfig?.maintenance?.enabled]);

  if (siteConfig?.maintenance?.enabled) {
    return (
      <div className="app-root">
        <MaintenancePage messageAr={siteConfig.maintenance.messageAr} messageEn={siteConfig.maintenance.messageEn} />
      </div>
    );
  }

  return (
    <SiteConfigContext.Provider value={siteConfig}>
      <div className="app-root">
        <VisitTracker />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/buy" element={<BuyPage />} />
            <Route path="/track" element={<OrderTrackPage />} />
            <Route path="/my-orders" element={<MyOrdersPage />} />
            <Route path="/privacy" element={<LegalPage doc="privacy" />} />
            <Route path="/terms" element={<LegalPage doc="terms" />} />
            <Route path="/disclaimer" element={<LegalPage doc="disclaimer" />} />
            <Route path="/about" element={<LegalPage doc="about" />} />
            <Route path="/admin/crm" element={<AdminCrmPage />} />
            <Route path="/seller" element={<SellerPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Suspense>
        {chatReady ? (
          <Suspense fallback={null}>
            <ChatWidget t={t} lang={lang} />
          </Suspense>
        ) : null}
      </div>
    </SiteConfigContext.Provider>
  );
}
