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
  }, [lang]);

  if (!popup) return null;

  const isRtl = lang === 'ar';

  return (
    <div className="live-activity-toast">
      <div className="live-activity-toast__icon" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
            fill="currentColor"
          />
          <path d="M12 8L12 12L14 14" stroke="#030712" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ textAlign: isRtl ? 'right' : 'left' }}>
        <p className="live-activity-toast__text">
          {t.purchased} {popup.amount} USDT
        </p>
        <p className="live-activity-toast__meta">
          {popup.city} • {t.justNow}
        </p>
      </div>
    </div>
  );
}
