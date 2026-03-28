import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Header({ t, lang, toggleLang, rate = 1320, links }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isRtl = lang === 'ar';
  const navigate = useNavigate();

  const navLinks = [
    { label: t.navHome,    href: '#hero' },
    { label: t.navRate,    href: '#hero' },
    { label: t.navPayment, href: '#payment-methods' },
    { label: t.navFAQ,     href: '#faq' },
    { label: t.navContact, href: '#contact' },
  ];

  const scrollTo = (href) => {
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/' + href);
    }
    setMobileOpen(false);
  };

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 100 }}>

      {/* ── Announcement Bar ── */}
      <div style={{
        background: '#0a1628',
        borderBottom: '1px solid rgba(0,229,255,0.2)',
        color: 'var(--accent-primary)', textAlign: 'center',
        padding: '0.45rem 1rem', fontSize: '0.85rem', fontWeight: 700,
      }}>
        {t.announcement}
      </div>

      {/* ── Main Nav ── */}
      <nav style={{
        background: 'rgba(3,7,18,0.95)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(0,229,255,0.12)',
      }}>
        {/* ───── Top Row ───── */}
        <div className="header-inner" style={{
          maxWidth: '1200px', margin: '0 auto', padding: '0 1.25rem',
          height: '60px', display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          <Logo navigate={navigate} />

          {/* Desktop nav */}
          <div className="header-desktop-nav" style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '0.1rem' }}>
            {navLinks.map((link) => (
              <button key={link.label} onClick={() => scrollTo(link.href)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(248,250,252,0.7)', fontSize: '0.88rem', fontWeight: 500,
                padding: '0.4rem 0.75rem', borderRadius: '6px',
                fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.2s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(0,229,255,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(248,250,252,0.7)'; e.currentTarget.style.background = 'none'; }}
              >{link.label}</button>
            ))}
          </div>

          {/* Desktop actions */}
          <div className="header-desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <ActionsGroup t={t} lang={lang} toggleLang={toggleLang} scrollTo={scrollTo} rate={rate} links={links} />
          </div>

          {/* Mobile right side: lang + hamburger */}
          <div className="header-mobile-actions" style={{ display: 'none', alignItems: 'center', gap: '0.6rem', marginInlineStart: 'auto' }}>
            {/* Lang toggle - only show on larger mobile screens if needed, otherwise hide */}
            <button className="hide-on-very-small" onClick={toggleLang} style={{
              background: 'transparent', border: '1px solid rgba(0,229,255,0.3)',
              color: 'var(--accent-primary)', borderRadius: '6px',
              padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>{lang === 'ar' ? t.langEn : t.langAr}</button>

            <button className="hide-on-small" onClick={() => scrollTo('#checkout-form')} style={{
              background: 'linear-gradient(135deg,var(--accent-primary),#0077FF)',
              color: '#030712', fontWeight: 700, fontSize: '0.8rem',
              padding: '0.4rem 0.8rem', borderRadius: '8px',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>{t.buyNow}</button>

            <button onClick={() => setMobileOpen(o => !o)} style={{
              background: mobileOpen ? 'rgba(0,229,255,0.1)' : 'none',
              border: '1px solid rgba(0,229,255,0.25)',
              borderRadius: '8px', cursor: 'pointer',
              color: 'var(--text-primary)', padding: '0.45rem',
              display: 'flex', alignItems: 'center', transition: 'all 0.2s',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                {mobileOpen
                  ? <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>}
              </svg>
            </button>
          </div>
        </div>

        {/* ── Mobile Dropdown Menu ── */}
        {mobileOpen && (
          <div style={{
            background: 'rgba(3,7,18,0.99)',
            borderTop: '1px solid rgba(0,229,255,0.15)',
            padding: '0.5rem 1.25rem 1rem',
          }}>
            {/* Rate pills row */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '0.25rem' }}>
              <a href={links?.bnb || 'https://www.binance.com/en/trade/USDT_BUSD'} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(240,192,32,0.1)', border: '1px solid rgba(240,192,32,0.3)', borderRadius: '20px', padding: '0.25rem 0.65rem', fontSize: '0.78rem', fontWeight: 700, color: '#f0c020', textDecoration: 'none' }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="#f0c020"><polygon points="8,1 10.1,6.1 16,6.9 12,10.8 12.9,16 8,13.3 3.1,16 4,10.8 0,6.9 5.9,6.1"/></svg>
                BNB · {Number(rate).toLocaleString()}
              </a>
              <a href={links?.okx || 'https://www.okx.com/trade-spot/usdt-usdc'} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '20px', padding: '0.25rem 0.65rem', fontSize: '0.78rem', fontWeight: 700, color: 'rgba(248,250,252,0.8)', textDecoration: 'none' }}>
                OKX · {Number(rate).toLocaleString()}
              </a>
              <button onClick={toggleLang} style={{
                marginInlineStart: 'auto', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.3)',
                borderRadius: '12px', padding: '0.25rem 0.75rem', fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent-primary)',
                cursor: 'pointer', fontFamily: 'inherit'
              }}>{lang === 'ar' ? 'English' : 'العربية'}</button>
            </div>
            {/* Nav links */}
            {navLinks.map(link => (
              <button key={link.label} onClick={() => scrollTo(link.href)} style={{
                background: 'none', border: 'none', cursor: 'pointer', width: '100%',
                color: 'rgba(248,250,252,0.85)', fontSize: '1rem', fontWeight: 500,
                padding: '0.8rem 0.25rem', textAlign: isRtl ? 'right' : 'left',
                fontFamily: 'inherit', borderBottom: '1px solid rgba(255,255,255,0.05)',
                transition: 'color 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-primary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(248,250,252,0.85)'}
              >{link.label}</button>
            ))}
          </div>
        )}
      </nav>

      <style>{`
        @media (max-width: 900px) {
          .header-desktop-nav { display: none !important; }
          .header-mobile-actions { display: flex !important; }
          .logo-img { height: 44px !important; }
        }
        @media (max-width: 600px) {
          .hide-on-small { display: none !important; }
        }
        @media (max-width: 440px) {
          .hide-on-very-small { display: none !important; }
        }
      `}</style>
    </header>
  );
}

/* ── Logo sub-component ── */
function Logo({ navigate }) {
  return (
    <button
      onClick={() => navigate('/')}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.55rem',
        flexShrink: 0, background: 'none', border: 'none',
        cursor: 'pointer', padding: '0.2rem 0.3rem', borderRadius: '8px',
        transition: 'opacity 0.2s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      aria-label="TETHER IQ - Home"
    >
      <img
        src="/logo.png"
        alt="TETHER IQ"
        className="logo-img"
        style={{ height: '52px', width: 'auto', display: 'block', flexShrink: 0, transition: 'height 0.2s' }}
      />
    </button>
  );
}

/* ── Actions sub-component (pills + lang + CTA) ── */
function ActionsGroup({ t, lang, toggleLang, scrollTo, rate = 1320, links }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>

      {/* Binance Pill */}
      <a href={links?.bnb || 'https://www.binance.com'} target="_blank" rel="noreferrer"
        className="rate-pill"
        style={{
          display: 'flex', alignItems: 'center',
          background: '#F0B90B', borderRadius: '20px', padding: '0.3rem 0.85rem',
          fontSize: '0.8rem', fontWeight: 800, color: '#000',
          textDecoration: 'none', letterSpacing: '0.01em', transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#d4a30a'; e.currentTarget.style.boxShadow = '0 0 12px rgba(240,185,11,0.4)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#F0B90B'; e.currentTarget.style.boxShadow = 'none'; }}
      >Binance</a>

      {/* OKX Pill */}
      <a href={links?.okx || 'https://www.okx.com'} target="_blank" rel="noreferrer"
        className="rate-pill"
        style={{
          display: 'flex', alignItems: 'center',
          background: '#111', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '20px', padding: '0.3rem 0.85rem',
          fontSize: '0.8rem', fontWeight: 800, color: '#fff',
          textDecoration: 'none', letterSpacing: '0.01em', transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.boxShadow = 'none'; }}
      >OKX</a>

      {/* Lang Toggle */}
      <button onClick={toggleLang} style={{
        background: 'transparent', border: '1px solid rgba(0,229,255,0.35)',
        color: 'var(--accent-primary)', borderRadius: '6px',
        padding: '0.3rem 0.65rem', fontSize: '0.8rem', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', whiteSpace: 'nowrap',
      }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,229,255,0.1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >{lang === 'ar' ? t.langEn : t.langAr}</button>

      {/* CTA */}
      <button onClick={() => scrollTo('#checkout-form')} style={{
        background: 'linear-gradient(135deg,var(--accent-primary),#0077FF)',
        color: '#030712', fontWeight: 700, fontSize: '0.9rem',
        padding: '0.45rem 1.1rem', borderRadius: '8px',
        boxShadow: '0 0 14px rgba(0,229,255,0.35)',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        transition: 'box-shadow 0.2s', whiteSpace: 'nowrap',
      }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 22px rgba(0,229,255,0.55)'}
        onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 14px rgba(0,229,255,0.35)'}
      >{t.buyNow}</button>
    </div>
  );
}
