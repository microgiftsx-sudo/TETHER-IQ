import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

export default function Header({ t, lang, toggleLang, links }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [announcementProgress, setAnnouncementProgress] = useState(0);
  const [announcementHeight, setAnnouncementHeight] = useState(56);
  const isRtl = lang === 'ar';
  const navigate = useNavigate();
  const announceHeightRef = useRef(56);

  useEffect(() => {
    const root = document.documentElement;
    if (mobileOpen) root.classList.add('has-mobile-menu-open');
    else root.classList.remove('has-mobile-menu-open');
    return () => root.classList.remove('has-mobile-menu-open');
  }, [announcementHeight, mobileOpen]);

  useEffect(() => {
    const MOBILE_BREAKPOINT = 900;
    const onResize = () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = Math.max(0, window.scrollY || 0);
        const h = Math.max(40, announceHeightRef.current || announcementHeight || 56);
        const p = Math.max(0, Math.min(1, y / h));
        setAnnouncementProgress(p);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [announcementHeight, mobileOpen]);

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

  const effectiveAnnouncementHidden = mobileOpen;
  const safeAnnouncementHeight = Math.max(40, announcementHeight || 56);
  // When mobile menu is open, do NOT translate .header-bar: transform creates a containing block
  // and breaks position:fixed for .header-mobile-sheet (collapses to ~25px height).
  const announcementOffsetPx = mobileOpen ? 0 : announcementProgress * safeAnnouncementHeight;

  const mobileMenuPortal =
    mobileOpen && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div
              className="header-mobile-backdrop"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <div
              className="header-mobile-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={isRtl ? 'القائمة' : 'Menu'}
            >
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
          </>,
          document.body,
        )
      : null;

  return (
    <>
    <header className="header-sticky">
      <div
        className={`header-announcement${effectiveAnnouncementHidden ? ' header-announcement--hidden' : ''}`}
        ref={(el) => {
          if (!el) return;
          announceHeightRef.current = el.offsetHeight || announceHeightRef.current;
          setAnnouncementHeight(announceHeightRef.current);
        }}
        style={
          effectiveAnnouncementHidden
            ? undefined
            : {
              transform: `translateY(-${announcementProgress * 100}%)`,
              opacity: `${1 - (announcementProgress * 0.95)}`,
            }
        }
      >
        {t.announcement}
      </div>

      <nav
        className="header-bar"
        style={announcementOffsetPx ? { transform: `translateY(-${announcementOffsetPx}px)` } : undefined}
      >
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
      </nav>
    </header>
    {mobileMenuPortal}
    </>
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
        width={160}
        height={48}
        style={{ height: '48px', width: 'auto', maxWidth: '160px', objectFit: 'contain', display: 'block', flexShrink: 0 }}
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
