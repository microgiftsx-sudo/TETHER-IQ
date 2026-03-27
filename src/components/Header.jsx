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
        background: 'linear-gradient(90deg,rgba(0,229,255,0.08),rgba(0,119,255,0.18),rgba(0,229,255,0.08))',
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
        {/* ───── Desktop Row ───── */}
        {/*
          Layout strategy — avoids all RTL flex-direction hacks:
          We use a single LTR flex row with three named regions,
          but we swap the DOM order of Logo vs Actions based on lang,
          so that in the rendered HTML:
            LTR: [Logo][Nav][Actions]  → logo LEFT,  actions RIGHT  ✓
            RTL: [Actions][Nav][Logo]  → actions LEFT, logo RIGHT   ✓
          Both cases use flex-direction:row (no reversal needed).
        */}
        <div
          className="header-inner"
          style={{
            maxWidth: '1200px', margin: '0 auto', padding: '0 1.25rem',
            height: '62px', display: 'flex', alignItems: 'center',
            gap: '1rem',
          }}
        >
          {/* ── Logo ── */}
          <Logo navigate={navigate} />

          {/* ── Nav Links ── */}
          <div className="header-desktop-nav" style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {navLinks.map((link) => (
              <button key={link.label} onClick={() => scrollTo(link.href)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(248,250,252,0.72)', fontSize: '0.88rem', fontWeight: 500,
                  padding: '0.4rem 0.78rem', borderRadius: '6px',
                  fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(0,229,255,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(248,250,252,0.72)'; e.currentTarget.style.background = 'none'; }}
              >{link.label}</button>
            ))}
          </div>

          {/* ── Actions ── */}
          <ActionsGroup t={t} lang={lang} toggleLang={toggleLang} scrollTo={scrollTo} rate={rate} links={links} />

          {/* Hamburger (mobile only) */}
          <button className="header-hamburger" onClick={() => setMobileOpen(o => !o)}
            style={{ 
              background: 'none', border: 'none', cursor: 'pointer', 
              color: 'var(--text-primary)', padding: '0.25rem', display: 'none'
            }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              {mobileOpen
                ? <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>}
            </svg>
          </button>
        </div>

        {/* ── Mobile Menu ── */}
        {mobileOpen && (
          <div style={{
            borderTop: '1px solid rgba(0,229,255,0.1)',
            padding: '0.75rem 1rem',
            background: 'rgba(3,7,18,0.98)',
            display: 'flex', flexDirection: 'column',
          }}>
            {navLinks.map(link => (
              <button key={link.label} onClick={() => scrollTo(link.href)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(248,250,252,0.8)', fontSize: '1rem', fontWeight: 500,
                padding: '0.75rem 0.5rem', textAlign: isRtl ? 'right' : 'left',
                fontFamily: 'inherit', borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>{link.label}</button>
            ))}
          </div>
        )}
      </nav>

      <style>{`
        @media (max-width: 900px) {
          .header-desktop-nav { display: none !important; }
          .rate-pill { display: none !important; }
          .header-hamburger { display: flex !important; }
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
        style={{ height: '52px', width: 'auto', display: 'block', flexShrink: 0 }}
      />
    </button>
  );
}

/* ── Actions sub-component (pills + lang + CTA) ── */
function ActionsGroup({ t, lang, toggleLang, scrollTo, rate = 1320, links }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>

      {/* BNB Pill */}
      <a href={links?.bnb || 'https://www.binance.com/en/trade/USDT_BUSD'} target="_blank" rel="noreferrer"
        className="rate-pill"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem',
          background: 'rgba(240,192,32,0.13)', border: '1px solid rgba(240,192,32,0.4)',
          borderRadius: '20px', padding: '0.28rem 0.7rem',
          fontSize: '0.75rem', fontWeight: 700, color: '#f0c020',
          textDecoration: 'none', cursor: 'pointer', transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,192,32,0.22)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(240,192,32,0.2)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(240,192,32,0.13)'; e.currentTarget.style.boxShadow = 'none'; }}
      >
        {/* Binance-style B circle */}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="#f0c020">
          <polygon points="8,1 10.1,6.1 16,6.9 12,10.8 12.9,16 8,13.3 3.1,16 4,10.8 0,6.9 5.9,6.1"/>
        </svg>
        <span>BNB</span>
        <span style={{ opacity: 0.4 }}>◆</span>
        <span>{Number(rate).toLocaleString()}</span>
      </a>

      {/* OKX Pill */}
      <a href={links?.okx || 'https://www.okx.com/trade-spot/usdt-usdc'} target="_blank" rel="noreferrer"
        className="rate-pill"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.35rem',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '20px', padding: '0.28rem 0.7rem',
          fontSize: '0.75rem', fontWeight: 700, color: 'rgba(248,250,252,0.85)',
          textDecoration: 'none', cursor: 'pointer', transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
      >
        <span style={{ fontWeight: 900, fontSize: '0.78rem', letterSpacing: '-0.5px' }}>OKX</span>
        <span style={{ opacity: 0.35 }}>◆</span>
        <span>{Number(rate).toLocaleString()}</span>
      </a>

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
