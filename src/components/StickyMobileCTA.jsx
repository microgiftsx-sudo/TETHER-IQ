import { useNavigate } from 'react-router-dom';

function LightningIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  );
}

export default function StickyMobileCTA({ t, lang, rate, usdtAmount }) {
  const navigate = useNavigate();
  const isRtl = lang === 'ar';

  const go = () => {
    navigate('/buy', { state: { lang, usdtAmount: usdtAmount || 100, createdAtMs: Date.now() } });
  };

  return (
    <>
      <div className="sticky-mobile-cta" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 990,
        background: 'rgba(3,7,18,0.97)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(0,229,255,0.2)',
        padding: '0.75rem 1rem max(0.75rem, env(safe-area-inset-bottom, 0px))',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.65rem',
        maxWidth: '100vw',
        boxSizing: 'border-box',
      }}>
        {/* Rate info */}
        <div className="sticky-mobile-cta-rate" style={{
          textAlign: isRtl ? 'right' : 'left',
          flex: '1 1 auto',
          minWidth: 0,
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 500, letterSpacing: '0.02em' }}>
            {t.stickyRate}
          </div>
          <div style={{
            fontSize: 'clamp(0.8rem, 3.2vw, 0.95rem)',
            fontWeight: 800,
            color: 'var(--accent-primary)',
            lineHeight: 1.25,
            wordBreak: 'break-word',
          }}>
            1 USDT = {Number(rate || 1320).toLocaleString()} IQD
          </div>
        </div>

        {/* CTA button */}
        <button type="button" onClick={go} className="sticky-mobile-cta-btn" style={{
          flex: '0 1 auto',
          minWidth: 0,
          maxWidth: 'min(220px, 46vw)',
          background: 'linear-gradient(135deg,var(--accent-primary),#0077FF)',
          color: '#030712', fontWeight: 800, fontSize: 'clamp(0.8rem, 3.5vw, 0.95rem)',
          padding: '0.65rem 0.75rem', borderRadius: '10px',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 0 16px rgba(0,229,255,0.35)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem',
        }}>
          <LightningIcon size={17} />
          <span style={{ lineHeight: 1.2 }}>{t.stickyBuy}</span>
        </button>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .sticky-mobile-cta { display: flex !important; }
          body { padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
        }
        /* iPhone / narrow logical width — avoid squeezed one-row layout */
        @media (max-width: 430px) {
          .sticky-mobile-cta {
            flex-direction: column;
            align-items: stretch;
            gap: 0.5rem;
            padding-left: 0.85rem;
            padding-right: 0.85rem;
            padding-bottom: max(0.65rem, env(safe-area-inset-bottom, 0px));
          }
          .sticky-mobile-cta-rate {
            display: flex;
            flex-direction: row;
            align-items: baseline;
            justify-content: space-between;
            gap: 0.75rem;
            width: 100%;
          }
          [dir="rtl"] .sticky-mobile-cta-rate { flex-direction: row-reverse; }
          .sticky-mobile-cta-rate > div:first-child { flex-shrink: 0; }
          .sticky-mobile-cta-rate > div:last-child { text-align: end !important; min-width: 0; }
          [dir="rtl"] .sticky-mobile-cta-rate > div:last-child { text-align: start !important; }
          .sticky-mobile-cta-btn {
            max-width: none !important;
            width: 100%;
            min-height: 48px;
          }
          body { padding-bottom: calc(128px + env(safe-area-inset-bottom, 0px)); }
        }
      `}</style>
    </>
  );
}
