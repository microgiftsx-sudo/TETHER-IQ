import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPaymentDetails } from '../api';

export default function Hero({ t, lang, usdtAmount, setUsdtAmount, hero }) {
  const navigate = useNavigate();
  const [RATE, setRATE] = useState(1320);
  const [iqdEditing, setIqdEditing] = useState(false);
  const [iqdDraft, setIqdDraft] = useState('');
  const isRtl = lang === 'ar';
  const isAr = lang === 'ar';
  const heroTitle    = hero ? (isAr ? hero.titleAr    : hero.titleEn)    || t.heroTitle    : t.heroTitle;
  const heroSubtitle = hero ? (isAr ? hero.subtitleAr : hero.subtitleEn) || t.heroSubtitle : t.heroSubtitle;

  useEffect(() => {
    getPaymentDetails()
      .then((d) => { if (d?.rate) setRATE(Number(d.rate)); })
      .catch(() => {});
  }, []);

  const handleUsdtChange = (e) => {
    setIqdEditing(false);
    const val = parseFloat(e.target.value) || 0;
    setUsdtAmount(val);
  };

  const iqdTotal = Math.max(0, Math.round(usdtAmount * RATE));

  const handleIqdFocus = () => {
    setIqdEditing(true);
    setIqdDraft(String(iqdTotal));
  };

  const handleIqdBlur = () => {
    setIqdEditing(false);
  };

  const handleIqdChange = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setIqdDraft(raw);
    const iqd = parseInt(raw, 10) || 0;
    if (RATE <= 0) return;
    const usdt = iqd / RATE;
    const rounded = Math.round(usdt * 100) / 100;
    setUsdtAmount(Math.min(1e8, Math.max(0, rounded)));
  };

  const goToBuy = () => {
    if (usdtAmount < 5) return;
    navigate('/buy', {
      state: {
        lang,
        usdtAmount,
        createdAtMs: Date.now(),
      },
    });
  };

  return (
    <section id="hero" className="hero hero-section py-8 flex flex-col items-center justify-center text-center gap-6">
      <div className="hero-content" style={{ maxWidth: '800px' }}>
        <h1 className="hero-title-vip">
          {heroTitle} <br /> <span className="hero-usdt-mark">USDT</span>
        </h1>
        <p className="hero-lead">
          {heroSubtitle}
        </p>
      </div>

      <div id="checkout-form" className="calculator hero-calc glass-panel w-full" style={{ maxWidth: '500px', textAlign: isRtl ? 'right' : 'left', padding: '2rem' }}>
        <div className="flex justify-between items-center mb-4 text-sm" style={{ flexDirection: isRtl ? 'row-reverse' : 'row' }}>
          <span className="text-muted">{t.rateLabel}</span>
          <span className="text-accent" style={{ fontWeight: 'bold' }}>1 USDT = {RATE.toLocaleString()} IQD</span>
        </div>

        <div className="input-group">
          <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.youGet}</label>
          <div style={{ position: 'relative' }}>
            <input 
              type="number" 
              className="input-control" 
              value={usdtAmount} 
              onChange={handleUsdtChange} 
              min="1"
              style={{ 
                fontSize: '1.5rem', fontWeight: 'bold', 
                paddingLeft: isRtl ? '1rem' : '3.5rem',
                paddingRight: isRtl ? '3.5rem' : '1rem'
              }}
            />
            <span style={{ 
              position: 'absolute', 
              left: isRtl ? 'auto' : '1.2rem', 
              right: isRtl ? '1.2rem' : 'auto', 
              top: '50%', transform: 'translateY(-50%)', 
              color: 'var(--accent-primary)', fontWeight: 'bold', fontSize: '1.2rem' 
            }}>₮</span>
          </div>
        </div>

        <div className="flex justify-center my-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.5 }}>
            <path d="M12 4V20M12 20L18 14M12 20L6 14" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div className="input-group">
          <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.youSend}</label>
          <div style={{ position: 'relative' }}>
            <input 
              type="text" 
              inputMode="numeric"
              className="input-control" 
              value={iqdEditing ? iqdDraft : iqdTotal.toLocaleString()} 
              onChange={handleIqdChange}
              onFocus={handleIqdFocus}
              onBlur={handleIqdBlur}
              style={{ 
                fontSize: '1.5rem', fontWeight: 'bold', 
                backgroundColor: 'rgba(0,0,0,0.3)',
                paddingLeft: isRtl ? '1rem' : '4rem',
                paddingRight: isRtl ? '4rem' : '1rem'
              }}
            />
            <span style={{ 
              position: 'absolute', 
              left: isRtl ? 'auto' : '1.2rem', 
              right: isRtl ? '1.2rem' : 'auto', 
              top: '50%', transform: 'translateY(-50%)', 
              color: 'var(--text-secondary)', fontWeight: 'bold', fontSize: '0.8rem' 
            }}>IQD</span>
          </div>
        </div>

        <button 
          className="btn btn-primary w-full mt-6" 
          style={{ 
            padding: '1rem', fontSize: '1.2rem',
            opacity: usdtAmount < 5 ? 0.5 : 1,
            cursor: usdtAmount < 5 ? 'not-allowed' : 'pointer'
          }} 
          onClick={goToBuy}
          disabled={usdtAmount < 5}
        >
          {t.buyNow}
        </button>
        {usdtAmount < 5 && (
          <p className="form-hint-warn" role="status">
            {t.minAmountError}
          </p>
        )}
      </div>
    </section>
  );
}
