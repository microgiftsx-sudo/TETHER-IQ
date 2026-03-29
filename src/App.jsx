import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import BuyPage from './pages/BuyPage';
import OrderTrackPage from './pages/OrderTrackPage';
import MyOrdersPage from './pages/MyOrdersPage';
import LegalPage from './pages/LegalPage';
import AdminCrmPage from './pages/AdminCrmPage';
import VisitTracker from './components/VisitTracker';
import ChatWidget from './components/ChatWidget';
import { getSiteConfig } from './api';
import { translations } from './translations';

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

export default function App() {
  const [siteConfig, setSiteConfig] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'ar');
  const t = translations[lang];

  useEffect(() => {
    const handler = (e) => setLang(e.detail || localStorage.getItem('lang') || 'ar');
    window.addEventListener('lang-changed', handler);
    return () => window.removeEventListener('lang-changed', handler);
  }, []);

  useEffect(() => {
    getSiteConfig()
      .then(cfg => { setSiteConfig(cfg); setConfigLoaded(true); })
      .catch(() => setConfigLoaded(true));
  }, []);

  if (!configLoaded) {
    return (
      <div className="app-root" role="status" aria-live="polite" aria-busy="true" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        <span className="app-shell-loading-spinner" aria-label="Loading" />
      </div>
    );
  }

  const maintenance = siteConfig?.maintenance;

  if (maintenance?.enabled) {
    return (
      <div className="app-root">
        <MaintenancePage messageAr={maintenance.messageAr} messageEn={maintenance.messageEn} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <VisitTracker />
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
        <Route path="*" element={<HomePage />} />
      </Routes>
      <ChatWidget t={t} lang={lang} />
    </div>
  );
}
