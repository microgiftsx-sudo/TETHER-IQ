import React, { useState, useEffect } from 'react';

export default function LiveActivity({ t, lang }) {
  const [popup, setPopup] = useState(null);

  useEffect(() => {
    const amounts = [500, 1000, 250, 100, 2000, 1500, 300, 450];
    const citiesAr = ['بغداد', 'البصرة', 'أربيل', 'النجف', 'الموصل', 'كربلاء'];
    const citiesEn = ['Baghdad', 'Basra', 'Erbil', 'Najaf', 'Mosul', 'Karbala'];

    const showRandomActivity = () => {
      const amount = amounts[Math.floor(Math.random() * amounts.length)];
      const cityIdx = Math.floor(Math.random() * citiesAr.length);
      const isRtl = lang === 'ar';
      const city = isRtl ? citiesAr[cityIdx] : citiesEn[cityIdx];

      setPopup({ amount, city, id: Date.now() });

      setTimeout(() => {
        setPopup(null);
      }, 4000);
    };

    const getRandomInterval = () => Math.random() * 7000 + 8000;

    let timeoutId;
    const schedule = () => {
      timeoutId = setTimeout(() => {
        showRandomActivity();
        schedule();
      }, getRandomInterval());
    };
    schedule();

    return () => clearTimeout(timeoutId);
  }, [lang]); // re-register when lang changes so city names update

  if (!popup) return null;

  const isRtl = lang === 'ar';

  return (
    <div className="live-activity-toast" style={{
      position: 'fixed',
      bottom: '20px',
      left: isRtl ? 'auto' : '20px',
      right: isRtl ? '20px' : 'auto',
      zIndex: 1000,
      animation: 'slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      backgroundColor: 'var(--bg-glass)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid var(--border-primary)',
      borderRadius: '12px',
      padding: '1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      maxWidth: 'min(280px, calc(100vw - 24px))',
    }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        /* Stay above sticky mobile CTA (Home) */
        @media (max-width: 900px) {
          .live-activity-toast {
            bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
            left: 12px !important;
            right: 12px !important;
            max-width: none !important;
          }
        }
        @media (max-width: 430px) {
          .live-activity-toast {
            bottom: calc(138px + env(safe-area-inset-bottom, 0px)) !important;
          }
        }
      `}</style>
      <div style={{
        width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(0,229,255,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)',
        flexShrink: 0,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" fill="#00E5FF"/>
          <path d="M12 8L12 12L14 14" stroke="#030712" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ textAlign: isRtl ? 'right' : 'left' }}>
        <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
          {t.purchased} {popup.amount} USDT
        </p>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {popup.city} • {t.justNow}
        </p>
      </div>
    </div>
  );
}
