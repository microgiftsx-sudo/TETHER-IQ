import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CheckoutForm({ t, lang, usdtAmount }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [wallet, setWallet] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Zain Cash');
  const isRtl = lang === 'ar';
  const RATE = 1320;

  const handleNextStep = (e) => {
    e.preventDefault();
    if (usdtAmount < 5) return;
    navigate('/buy', {
      state: {
        lang,
        createdAtMs: Date.now(),
        name,
        wallet,
        usdtAmount,
        paymentMethod,
      },
    });
  };

  const paymentMethods = [
    { id: 'zain', label: 'Zain Cash', labelAr: 'زين كاش' },
    { id: 'fib', label: 'FIB', labelAr: 'المصرف الأول' },
    { id: 'mastercard', label: 'MasterCard', labelAr: 'ماستر كارد' },
    { id: 'asia', label: 'Asia Hawala', labelAr: 'آسيا حوالة' },
  ];

  return (
    <section id="checkout-form" className="py-8 flex justify-center w-full">
      <div className="glass-panel w-full" style={{ maxWidth: '600px', border: '1px solid var(--accent-primary)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
        <h2 className="text-center text-accent mb-2">{t.secureCheckout}</h2>
        <p className="text-center text-muted text-sm mb-6">{t.checkoutDesc}</p>
        
        <form onSubmit={handleNextStep} className="flex flex-col gap-4">
          <div className="input-group">
            <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.namePlaceholder}</label>
            <input
              type="text"
              className="input-control"
              required
              placeholder={isRtl ? 'علي احمد' : 'Ali Ahmed'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ textAlign: isRtl ? 'right' : 'left' }}
            />
          </div>

          <div className="flex gap-4 flex-wrap">
            <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
              <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.selectPayment}</label>
              <select
                className="input-control"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                style={{ textAlign: isRtl ? 'right' : 'left', appearance: 'none', cursor: 'pointer' }}
              >
                {paymentMethods.map((m) => (
                  <option key={m.id} value={m.label}>{isRtl ? m.labelAr : m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.walletPlaceholder}</label>
            <input
              type="text"
              className="input-control"
              required
              placeholder={isRtl ? 'رقم المحفظة المستلمة' : 'Receiving Wallet/Account #'}
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              style={{ textAlign: isRtl ? 'right' : 'left' }}
            />
          </div>

          <div style={{
            background: 'rgba(0,229,255,0.05)',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid rgba(0,229,255,0.1)',
            marginTop: '0.5rem'
          }}>
            <div className="flex justify-between items-center" style={{ flexDirection: isRtl ? 'row-reverse' : 'row' }}>
              <span className="text-muted">{t.totalAmount}</span>
              <span className="text-accent" style={{ fontSize: '1.25rem', fontWeight: 800 }}>
                {usdtAmount} USDT ≈ {(usdtAmount * RATE).toLocaleString()} IQD
              </span>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary mt-4 w-full"
            style={{ padding: '0.9rem', opacity: usdtAmount < 5 ? 0.5 : 1 }}
            disabled={usdtAmount < 5}
          >
            {t.buyNow}
          </button>
          {usdtAmount < 5 && <p className="text-center text-error mt-2">{t.minAmountError}</p>}
        </form>

        {/* Security Badge */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', borderTop: '1px solid #333', paddingTop: '1rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#00FF64', fontSize: '0.75rem', fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            {t.securityBadge}
          </div>
        </div>
      </div>
    </section>
  );
}
