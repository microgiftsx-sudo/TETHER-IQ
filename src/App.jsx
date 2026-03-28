import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import BuyPage from './pages/BuyPage';
import { getSiteConfig } from './api';

function TelegramFloat({ contactLink }) {
  const [lang, setLang] = React.useState(() => localStorage.getItem('lang') || 'ar');
  const isRtl = lang === 'ar';

  React.useEffect(() => {
    const handler = (e) => setLang(e.detail || localStorage.getItem('lang') || 'ar');
    window.addEventListener('lang-changed', handler);
    return () => window.removeEventListener('lang-changed', handler);
  }, []);

  return (
    <a
      href={contactLink || 'https://t.me/TETHER_IQ'}
      target="_blank"
      rel="noreferrer"
      className="tg-float"
      title={isRtl ? 'تواصل معنا على تيليغرام' : 'Contact us on Telegram'}
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        left: isRtl ? '1.5rem' : 'auto',
        right: isRtl ? 'auto' : '1.5rem',
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'linear-gradient(135deg,#229ED9,#1a7ab5)',
        color: '#fff',
        borderRadius: '50px',
        padding: '0.6rem 1rem 0.6rem 0.7rem',
        textDecoration: 'none',
        fontWeight: 700,
        fontSize: '0.88rem',
        boxShadow: '0 4px 20px rgba(34,158,217,0.45)',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'scale(1.06)';
        e.currentTarget.style.boxShadow = '0 6px 28px rgba(34,158,217,0.65)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(34,158,217,0.45)';
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.67l-2.95-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.537-.194 1.006.131.973.887z"/>
      </svg>
      <span className="tg-float-label">{isRtl ? 'تواصل معنا' : 'Contact Us'}</span>
    </a>
  );
}

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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/buy" element={<BuyPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
      <TelegramFloat contactLink={siteConfig?.links?.contact} />
    </div>
  );
}
