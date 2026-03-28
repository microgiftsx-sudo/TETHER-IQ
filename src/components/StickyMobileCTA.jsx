import { useNavigate } from 'react-router-dom';

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
        padding: '0.75rem 1.25rem',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
      }}>
        {/* Rate info */}
        <div style={{ textAlign: isRtl ? 'right' : 'left', flexShrink: 0 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {t.stickyRate}
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
            1 USDT = {Number(rate || 1320).toLocaleString()} IQD
          </div>
        </div>

        {/* CTA button */}
        <button onClick={go} style={{
          flex: 1, maxWidth: '220px',
          background: 'linear-gradient(135deg,var(--accent-primary),#0077FF)',
          color: '#030712', fontWeight: 800, fontSize: '0.95rem',
          padding: '0.7rem 1rem', borderRadius: '10px',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 0 16px rgba(0,229,255,0.35)',
          whiteSpace: 'nowrap',
        }}>
          {t.stickyBuy} ⚡
        </button>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .sticky-mobile-cta { 
            display: flex !important; 
            padding: 0.6rem 1rem !important;
            height: 65px;
          }
          /* Push footer content above sticky bar */
          body { padding-bottom: 65px; }
        }
        @media (max-width: 450px) {
          .sticky-mobile-cta button { font-size: 0.85rem !important; padding: 0.6rem 0.8rem !important; }
          .sticky-mobile-cta div div:first-child { font-size: 0.65rem !important; }
          .sticky-mobile-cta div div:last-child { font-size: 0.85rem !important; }
        }
      `}</style>
    </>
  );
}
