import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Header({ t, lang, toggleLang, links }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isRtl = lang === 'ar';
  const navigate = useNavigate();

  const navLinks = [
    { label: t.navHome, href: '#hero' },
    { label: t.navRate, href: '#hero' },
    { label: t.navPayment, href: '#payment-methods' },
    { label: t.navFAQ, href: '#faq' },
    { label: t.navContact, href: '#contact' },
    { label: t.navMyOrders, href: '/my-orders' },
  ];

  const scrollTo = (href) => {
    if (href.startsWith('/') && href.length > 1) {
      navigate(href);
      setMobileOpen(false);
      return;
    }
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/' + href);
    }
    setMobileOpen(false);
  };

  return (
    <header className="header-sticky">
      <div className="header-announcement">
        {t.announcement}
      </div>

      <nav className="header-bar">
        <div className="header-inner">
          <Logo navigate={navigate} />

          <div className="header-nav-links">
            {navLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                className="header-nav-link"
                onClick={() => scrollTo(link.href)}
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="header-nav-actions">
            <ActionsGroup t={t} lang={lang} toggleLang={toggleLang} scrollTo={scrollTo} links={links} />
          </div>

          <div className="header-mobile-actions">
            <button type="button" className="header-lang-btn" onClick={toggleLang}>
              {lang === 'ar' ? t.langEn : t.langAr}
            </button>
            <button type="button" className="header-cta" onClick={() => scrollTo('#checkout-form')}>
              {t.buyNow}
            </button>
            <button
              type="button"
              className={`header-icon-btn${mobileOpen ? ' header-icon-btn--open' : ''}`}
              onClick={() => setMobileOpen((o) => !o)}
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                {mobileOpen
                  ? <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>}
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="header-mobile-sheet">
            <div className="header-mobile-pills">
              <ExchangePills links={links} />
            </div>
            {navLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                className="header-nav-link header-nav-link--stack"
                style={{ textAlign: isRtl ? 'right' : 'left' }}
                onClick={() => scrollTo(link.href)}
              >
                {link.label}
              </button>
            ))}
          </div>
        )}
      </nav>
    </header>
  );
}

function Logo({ navigate }) {
  return (
    <button
      type="button"
      onClick={() => navigate('/')}
      className="header-logo"
      aria-label="TETHER IQ - Home"
    >
      <img
        src="/logo.png"
        alt="TETHER IQ"
        style={{ height: '48px', width: 'auto', display: 'block', flexShrink: 0 }}
      />
    </button>
  );
}

function ExchangePills({ links }) {
  const bnbHref = links?.bnb || 'https://www.binance.com';
  const okxHref = links?.okx || 'https://www.okx.com';

  const iconStyle = { display: 'block', flexShrink: 0, width: '20px', height: '20px' };

  return (
    <>
      <a
        href={bnbHref}
        target="_blank"
        rel="noreferrer"
        className="exchange-pill exchange-pill-binance"
        aria-label="Binance"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          background: '#F0B90B',
          borderRadius: '20px',
          padding: '0.3rem 0.85rem',
          fontSize: '0.8rem',
          fontWeight: 800,
          color: '#000',
          textDecoration: 'none',
          letterSpacing: '0.01em',
          transition: 'all 0.2s',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#d4a30a';
          e.currentTarget.style.boxShadow = '0 0 12px rgba(240,185,11,0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#F0B90B';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <img src="/binance.svg" alt="" width={20} height={20} style={iconStyle} />
        Binance
      </a>
      <a
        href={okxHref}
        target="_blank"
        rel="noreferrer"
        className="exchange-pill exchange-pill-okx"
        aria-label="OKX"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          background: '#111',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '20px',
          padding: '0.3rem 0.85rem',
          fontSize: '0.8rem',
          fontWeight: 800,
          color: '#fff',
          textDecoration: 'none',
          letterSpacing: '0.01em',
          transition: 'all 0.2s',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)';
          e.currentTarget.style.boxShadow = '0 0 10px rgba(255,255,255,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <img src="/okx.svg" alt="" width={20} height={20} style={iconStyle} />
        OKX
      </a>
    </>
  );
}

function ActionsGroup({ t, lang, toggleLang, scrollTo, links }) {
  return (
    <>
      <ExchangePills links={links} />
      <button type="button" className="header-lang-btn" onClick={toggleLang}>
        {lang === 'ar' ? t.langEn : t.langAr}
      </button>
      <button type="button" className="header-cta" onClick={() => scrollTo('#checkout-form')}>
        {t.buyNow}
      </button>
    </>
  );
}
