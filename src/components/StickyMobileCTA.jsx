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

  const go = () => {
    navigate('/buy', { state: { lang, usdtAmount: usdtAmount || 100, createdAtMs: Date.now() } });
  };

  const rateNum = Number(rate || 1320).toLocaleString();

  return (
    <div className="sticky-mobile-cta">
      <div className="sticky-mobile-cta-rate">
        <div className="sticky-mobile-cta-rate-label">{t.stickyRate}</div>
        <div className="sticky-mobile-cta-rate-value">
          1 USDT = <span className="accent">{rateNum}</span> IQD
        </div>
      </div>
      <button type="button" onClick={go} className="sticky-mobile-cta-btn">
        <LightningIcon size={17} />
        <span style={{ lineHeight: 1.2 }}>{t.stickyBuy}</span>
      </button>
    </div>
  );
}
