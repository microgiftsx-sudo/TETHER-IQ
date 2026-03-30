import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { translations } from '../translations';
import { createOrder, getPaymentDetails } from '../api';
import { getOrCreateVisitorId } from '../visitTracking';
import { saveOrderLocal } from '../lib/savedOrders';
import Header from '../components/Header';
import Footer from '../components/Footer';

function useCountdown(targetMs) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const remainingMs = Math.max(0, targetMs - now);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return { remainingMs, mm, ss };
}

export default function BuyPage() {
  const location = useLocation();
  const state = location.state || {};

  const [lang, setLang] = useState(state.lang || 'ar');
  const t = translations[lang];
  const isRtl = lang === 'ar';
  const toggleLang = () => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'));

  const usdtAmount = Number(state.usdtAmount || 0);
  const KYC_THRESHOLD = Number(import.meta.env.VITE_KYC_THRESHOLD_USDT) || 1500;
  const needsKyc = usdtAmount >= KYC_THRESHOLD;

  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(null);
  const RATE = useMemo(() => Number(details?.rate || 1320), [details?.rate]);
  const iqdAmount = useMemo(() => (usdtAmount * RATE).toLocaleString(), [usdtAmount, RATE]);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(state.paymentMethod || 'Zain Cash');
  const [stage, setStage] = useState(1);
  const [name, setName] = useState(state.name || '');
  const [usdtWallet, setUsdtWallet] = useState(state.wallet || '');
  const [walletNetwork, setWalletNetwork] = useState('TRC20');
  const [paymentDetail, setPaymentDetail] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [paymentProof, setPaymentProof] = useState(null);
  const [fastPayQrFailed, setFastPayQrFailed] = useState(false);
  const [zainQrFailed, setZainQrFailed] = useState(false);
  const [fibQrFailed, setFibQrFailed] = useState(false);
  const [mastercardQrFailed, setMastercardQrFailed] = useState(false);
  const [copied, setCopied] = useState('');
  const [orderId, setOrderId] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [kycAcknowledged, setKycAcknowledged] = useState(false);

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [isRtl, lang]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getPaymentDetails()
      .then((d) => mounted && setDetails(d))
      .catch((e) => mounted && setError(String(e?.message || e)))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const expiresAtMs = useMemo(() => {
    const mins = Number(details?.paymentExpiryMinutes || 15);
    return (state.createdAtMs || Date.now()) + mins * 60_000;
  }, [details?.paymentExpiryMinutes, state.createdAtMs]);

  const cd = useCountdown(expiresAtMs);

  const methodOrder = useMemo(
    () => [
      { key: 'fastPay', label: 'FastPay', labelAr: 'فاست باي' },
      { key: 'zainCash', label: 'Zain Cash', labelAr: 'زين كاش' },
      { key: 'fib', label: 'FIB', labelAr: 'المصرف الأول' },
      { key: 'mastercard', label: 'MasterCard', labelAr: 'ماستر كارد' },
      { key: 'asiaHawala', label: 'Asia Hawala', labelAr: 'آسيا حوالة' },
    ],
    []
  );

  const pm = details?.methods || {};

  const paymentMethodOptions = useMemo(() => {
    if (!details?.methods || typeof details.methods !== 'object') return [];
    return methodOrder.filter((o) => Object.prototype.hasOwnProperty.call(details.methods, o.key));
  }, [details?.methods, methodOrder]);

  useEffect(() => {
    if (!paymentMethodOptions.length) return;
    const ok = paymentMethodOptions.some((o) => o.label === paymentMethod);
    if (!ok) setPaymentMethod(paymentMethodOptions[0].label);
  }, [paymentMethod, paymentMethodOptions]);

  useEffect(() => { setFastPayQrFailed(false); }, [pm?.fastPay?.qrImage]);
  useEffect(() => { setZainQrFailed(false); }, [pm?.zainCash?.qrImage]);
  useEffect(() => { setFibQrFailed(false); }, [pm?.fib?.qrImage]);
  useEffect(() => { setMastercardQrFailed(false); }, [pm?.mastercard?.qrImage]);

  const normalizedWallet = usdtWallet.trim();
  const normalizedNetwork = walletNetwork.toUpperCase();
  const isEvmNetwork = normalizedNetwork === 'ERC20' || normalizedNetwork === 'BEP20';
  const walletValid = isEvmNetwork
    ? /^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)
    : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(normalizedWallet);
  const senderValid = !senderNumber || /^07\d{9}$/.test(senderNumber.trim());
  const canMoveToPayDetails = Boolean(paymentMethod && usdtWallet && walletNetwork && usdtAmount >= 5 && walletValid);
  const createdOrderId = useMemo(() => `ORD-${Date.now().toString(36).toUpperCase()}`, []);

  const copyText = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      // ignore
    }
  };

  const onConfirm = async () => {
    if (!name || !usdtWallet || !walletNetwork || usdtAmount < 5 || !walletValid || !senderValid) {
      setError(isRtl ? 'يرجى إكمال الحقول المطلوبة (الحد الأدنى 5 USDT).' : 'Please complete required fields (minimum 5 USDT).');
      return;
    }
    if (needsKyc && !kycAcknowledged) {
      setError(t.kycAckRequired);
      return;
    }
    setSending(true);
    setError('');
    try {
      let paymentProofBase64 = '';
      let paymentProofMime = '';
      if (paymentProof) {
        paymentProofBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(paymentProof);
        });
        paymentProofMime = paymentProof.type || 'image/jpeg';
      }
      const response = await createOrder({
        orderId: createdOrderId,
        visitorId: getOrCreateVisitorId(),
        name,
        wallet: normalizedWallet,
        walletNetwork: normalizedNetwork,
        usdtAmount,
        iqdAmount,
        paymentMethod,
        paymentDetail,
        senderNumber,
        paymentProofName: paymentProof?.name || '',
        paymentProofBase64,
        paymentProofMime,
        kycAcknowledged: !needsKyc || kycAcknowledged,
      });
      const oid = response?.orderId || createdOrderId;
      setOrderId(oid);
      saveOrderLocal({ orderId: oid, usdtAmount });
      setSent(true);
    } catch (e) {
      if (e?.code === 'ORDER_RATE_LIMIT') {
        setError(isRtl ? e.message : (e.errorEn || e.message));
      } else if (e?.code === 'KYC_ACK_REQUIRED') {
        setError(lang === 'en' ? (e.errorEn || e.message) : e.message);
      } else {
        setError(String(e?.message || e));
      }
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="page-shell">
        <Header t={t} lang={lang} toggleLang={toggleLang} />
        <main className="buy-page-main buy-page-executive">
          <section className="container py-10" style={{ maxWidth: 900 }}>
            <div className="glass-panel w-full text-center buy-success-card-executive" style={{ padding: '3rem 2rem', border: '2px solid var(--accent-primary)' }}>
              <div style={{ fontSize: '4rem', marginBottom: '1rem', lineHeight: 1 }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--accent-primary)' }}>
                  <path d="M20 7L9 18l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="text-accent mb-4">{t.successTitle}</h2>
              <p className="text-muted" style={{ fontSize: '1.1rem', lineHeight: 1.6 }}>{t.successMessage}</p>
              {!!orderId && (
                <p className="text-muted mt-4">
                  {isRtl ? 'رقم الطلب:' : 'Order ID:'} <span className="text-accent">{orderId}</span>
                </p>
              )}
              {!!orderId && (
                <p className="text-muted text-sm mt-3" style={{ maxWidth: 420, margin: '0 auto' }}>
                  {t.trackOrderHint}
                </p>
              )}
              {!!orderId && (
                <p className="text-muted text-sm mt-2" style={{ maxWidth: 440, margin: '0 auto' }}>
                  {t.successInvoiceHow}
                </p>
              )}
              <div className="mt-6" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
                {!!orderId && (
                  <Link to={`/track?order=${encodeURIComponent(orderId)}`} className="btn btn-primary">
                    {t.trackOrderOpen}
                  </Link>
                )}
                <Link to="/my-orders" className="btn btn-outline">{t.navMyOrders}</Link>
                <Link to="/" className="btn btn-outline">{t.navHome}</Link>
              </div>
            </div>
          </section>
        </main>
        <Footer t={t} lang={lang} />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <Header t={t} lang={lang} toggleLang={toggleLang} />
      <main className="buy-page-main buy-page-executive">
      <section className="container py-10 buy-executive-shell" style={{ maxWidth: 900 }}>
      <div className="glass-panel buy-panel buy-panel-executive" style={{ padding: '1.75rem', border: '1px solid var(--accent-primary)' }}>
            <div className="buy-header mb-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
          <div className="buy-title-wrap">
            <h2 className="text-accent mb-1">{isRtl ? 'تفاصيل الدفع' : 'Payment Details'}</h2>
            {details?.activeProfile?.nameAr && (
              <div className="text-muted text-sm mb-1" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                {isRtl ? 'حساب الاستلام:' : 'Receiving account:'}{' '}
                <span className="text-accent">{isRtl ? details.activeProfile.nameAr : (details.activeProfile.nameEn || details.activeProfile.nameAr)}</span>
              </div>
            )}
            <div className="text-muted text-sm buy-amount-line">
              <span dir="ltr" style={{ unicodeBidi: 'plaintext' }}>
                {usdtAmount} USDT ≈ {iqdAmount} IQD
              </span>
            </div>
          </div>
          <div className="text-center buy-timer" style={{ minWidth: 140 }}>
            <div className="text-muted text-sm">{isRtl ? 'الوقت المتبقي' : 'Time left'}</div>
            <div className="text-accent" style={{ fontWeight: 900, fontSize: '1.6rem' }}>
              {cd.mm}:{cd.ss}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-muted">{isRtl ? 'جاري التحميل...' : 'Loading...'}</div>
        ) : (
          <>
            {error && (
              <div className="text-error mb-4" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </div>
            )}

            <div className="buy-form-grid mb-2" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
              <div className="input-group" style={{ flex: 1, minWidth: '240px' }}>
                <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.selectPayment}</label>
                <select
                  className="input-control"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  disabled={!paymentMethodOptions.length}
                  style={{ textAlign: isRtl ? 'right' : 'left', appearance: 'none', cursor: 'pointer' }}
                >
                  {paymentMethodOptions.map((m) => (
                    <option key={m.key} value={m.label}>
                      {isRtl ? m.labelAr : m.label}
                    </option>
                  ))}
                </select>
                {!loading && !paymentMethodOptions.length && (
                  <p className="text-error text-sm mt-2" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                    {isRtl
                      ? 'لا توجد طرق دفع مفعّلة للبروفايل النشط. تحقّق من Chat ID والبيانات في لوحة البوت.'
                      : 'No payment methods are enabled for the active profile. Check Chat ID and payment data in the bot panel.'}
                  </p>
                )}
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '240px' }}>
                <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                  {isRtl ? 'عنوان محفظة USDT' : 'USDT Wallet Address'}
                </label>
                <input
                  className="input-control"
                  value={usdtWallet}
                  onChange={(e) => setUsdtWallet(e.target.value)}
                  placeholder={isRtl ? 'T... أو 0x...' : 'T... or 0x...'}
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                />
                {normalizedWallet && !walletValid && (
                  <div className="text-error text-sm mt-2" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                    {isRtl
                      ? (isEvmNetwork ? 'عنوان ERC20/BEP20 يجب أن يبدأ بـ 0x وطوله 42 حرف.' : 'عنوان TRC20 يجب أن يبدأ بـ T وصحيح.')
                      : (isEvmNetwork ? 'ERC20/BEP20 address must start with 0x and be 42 chars.' : 'TRC20 address must start with T and be valid.')}
                  </div>
                )}
              </div>
              <div className="input-group" style={{ flex: 1, minWidth: '240px' }}>
                <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                  {isRtl ? 'شبكة التحويل' : 'Network'}
                </label>
                <select
                  className="input-control"
                  value={walletNetwork}
                  onChange={(e) => setWalletNetwork(e.target.value)}
                  style={{ textAlign: isRtl ? 'right' : 'left', appearance: 'none', cursor: 'pointer' }}
                >
                  <option value="TRC20">TRC20</option>
                  <option value="ERC20">ERC20</option>
                  <option value="BEP20">BEP20</option>
                </select>
              </div>
            </div>
            <div className="text-muted text-sm mb-6" style={{ textAlign: isRtl ? 'right' : 'left' }}>
              {isRtl ? 'أقل مبلغ للتحويل هو 5 USDT' : 'Minimum transfer amount is 5 USDT'}
            </div>

            {stage === 2 && (
            <div className="instruction-card buy-instruction-card-executive" style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '12px', border: '1px dashed var(--accent-primary)', direction: isRtl ? 'rtl' : 'ltr' }}>
              <h3 className="text-accent mb-3" style={{ fontSize: '1rem' }}>{t.confirmPayment}</h3>

              {paymentMethod === 'FastPay' && (
                <div className="text-center">
                  <p className="text-sm mb-4">{t.fastPayInstructions}</p>
                  {pm?.fastPay?.qrImage && !fastPayQrFailed && (
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', display: 'inline-block', marginBottom: '1rem' }}>
                      <img
                        src={pm.fastPay.qrImage}
                        alt="FastPay QR"
                        onError={() => setFastPayQrFailed(true)}
                        style={{ width: '150px', height: '150px', objectFit: 'contain' }}
                      />
                    </div>
                  )}
                  {fastPayQrFailed && (
                    <p className="text-muted text-sm mb-4">
                      {isRtl ? 'تعذر تحميل صورة QR، استخدم الرقم مباشرة.' : 'QR image unavailable, use the number directly.'}
                    </p>
                  )}
                  {pm?.fastPay?.number && (
                    <div className="flex justify-center items-center gap-2 text-xl font-bold text-accent">
                      <span>{pm.fastPay.number}</span>
                      <button type="button" className="copy-btn" onClick={() => copyText(pm.fastPay.number, 'fastpay')} aria-label={isRtl ? 'نسخ الرقم' : 'Copy number'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                          <rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {copied === 'fastpay' && <div className="copy-toast">{isRtl ? 'تم النسخ' : 'Copied'}</div>}
                </div>
              )}

              {paymentMethod === 'Zain Cash' && (
                <div className="text-center">
                  <p className="text-sm mb-4">{t.zainInstructions}</p>
                  {pm?.zainCash?.qrImage && !zainQrFailed && (
                    <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', display: 'inline-block', marginBottom: '1rem' }}>
                      <img
                        src={pm.zainCash.qrImage}
                        alt="QR Code"
                        onError={() => setZainQrFailed(true)}
                        style={{ width: '150px', height: '150px', objectFit: 'contain' }}
                      />
                    </div>
                  )}
                  {zainQrFailed && (
                    <p className="text-muted text-sm mb-4">
                      {isRtl ? 'تعذر تحميل صورة QR، استخدم الرقم مباشرة.' : 'QR image unavailable, use the number directly.'}
                    </p>
                  )}
                  {pm?.zainCash?.number && (
                    <div className="flex justify-center items-center gap-2 text-xl font-bold text-accent">
                      <span>{pm.zainCash.number}</span>
                      <button type="button" className="copy-btn" onClick={() => copyText(pm.zainCash.number, 'zain')} aria-label={isRtl ? 'نسخ الرقم' : 'Copy number'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                          <rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {copied === 'zain' && <div className="copy-toast">{isRtl ? 'تم النسخ' : 'Copied'}</div>}
                </div>
              )}

              {paymentMethod === 'Asia Hawala' && (
                <div>
                  <p className="text-sm mb-4">{t.asiaInstructions}</p>
                  {pm?.asiaHawala?.number && (
                    <div className="flex justify-center items-center gap-2 text-xl font-bold text-accent mb-6">
                      <span>{pm.asiaHawala.number}</span>
                      <button type="button" className="copy-btn" onClick={() => copyText(pm.asiaHawala.number, 'asia')} aria-label={isRtl ? 'نسخ الرقم' : 'Copy number'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                          <rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <div className="input-group">
                    <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>{t.senderNumber}</label>
                    <input
                      type="tel"
                      className="input-control"
                      placeholder="07xxxxxxxxx"
                      value={senderNumber}
                      onChange={(e) => setSenderNumber(e.target.value)}
                      style={{ textAlign: 'left', direction: 'ltr' }}
                    />
                    {!!senderNumber && !senderValid && (
                      <div className="text-error text-sm mt-2" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                        {isRtl ? 'رقم الهاتف يجب أن يكون بصيغة 07xxxxxxxxx' : 'Phone should be in format 07xxxxxxxxx'}
                      </div>
                    )}
                  </div>
                  {copied === 'asia' && <div className="copy-toast">{isRtl ? 'تم النسخ' : 'Copied'}</div>}
                </div>
              )}

              {paymentMethod === 'FIB' && (
                <div>
                  <p className="text-sm mb-4">{t.genericInstructions}</p>
                  {pm?.fib?.qrImage && !fibQrFailed && (
                    <div className="text-center mb-4">
                      <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', display: 'inline-block' }}>
                        <img
                          src={pm.fib.qrImage}
                          alt="FIB QR Code"
                          onError={() => setFibQrFailed(true)}
                          style={{ width: '150px', height: '150px', objectFit: 'contain' }}
                        />
                      </div>
                    </div>
                  )}
                  {fibQrFailed && (
                    <p className="text-muted text-sm mb-4 text-center">
                      {isRtl ? 'تعذر تحميل صورة QR، استخدم بيانات الحساب مباشرة.' : 'QR image unavailable, use account details directly.'}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between p-2 bg-black/20 rounded">
                      <span className="text-muted">{isRtl ? 'رقم الحساب:' : 'Account:'}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{pm?.fib?.accountNumber || ''}</span>
                        {pm?.fib?.accountNumber && (
                          <button type="button" className="copy-btn" onClick={() => copyText(pm.fib.accountNumber, 'fib-acc')} aria-label={isRtl ? 'نسخ' : 'Copy'}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                              <rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between p-2 bg-black/20 rounded">
                      <span className="text-muted">{isRtl ? 'الاسم:' : 'Name:'}</span>
                      <span className="font-bold">{pm?.fib?.accountName || ''}</span>
                    </div>
                  </div>
                  {copied === 'fib-acc' && <div className="copy-toast">{isRtl ? 'تم النسخ' : 'Copied'}</div>}
                </div>
              )}

              {paymentMethod === 'MasterCard' && (
                <div>
                  <p className="text-sm mb-4">{t.genericInstructions}</p>
                  {pm?.mastercard?.qrImage && !mastercardQrFailed && (
                    <div className="text-center mb-4">
                      <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', display: 'inline-block' }}>
                        <img
                          src={pm.mastercard.qrImage}
                          alt="MasterCard QR Code"
                          onError={() => setMastercardQrFailed(true)}
                          style={{ width: '150px', height: '150px', objectFit: 'contain' }}
                        />
                      </div>
                    </div>
                  )}
                  {mastercardQrFailed && (
                    <p className="text-muted text-sm mb-4 text-center">
                      {isRtl ? 'تعذر تحميل صورة QR، استخدم بيانات البطاقة مباشرة.' : 'QR image unavailable, use card details directly.'}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between p-2 bg-black/20 rounded">
                      <span className="text-muted">{isRtl ? 'رقم البطاقة:' : 'Card #:'}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{pm?.mastercard?.cardNumber || ''}</span>
                        {pm?.mastercard?.cardNumber && (
                          <button type="button" className="copy-btn" onClick={() => copyText(pm.mastercard.cardNumber, 'mc-num')} aria-label={isRtl ? 'نسخ' : 'Copy'}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                              <rect x="2" y="2" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between p-2 bg-black/20 rounded">
                      <span className="text-muted">{isRtl ? 'اسم الحامل:' : 'Holder:'}</span>
                      <span className="font-bold">{pm?.mastercard?.cardHolder || ''}</span>
                    </div>
                  </div>
                  {copied === 'mc-num' && <div className="copy-toast">{isRtl ? 'تم النسخ' : 'Copied'}</div>}
                </div>
              )}
            </div>
            )}

            {stage === 2 && (
              <div className="buy-form-grid mt-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
                <div className="input-group buy-span-2">
                  <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                    {isRtl ? 'الاسم الكامل' : 'Full Name'}
                  </label>
                  <input
                    className="input-control"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={isRtl ? 'أحمد محمد' : 'Ahmed Mohammed'}
                    style={{ textAlign: isRtl ? 'right' : 'left' }}
                  />
                </div>
                <div className="input-group buy-span-2">
                  <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                    {isRtl ? 'ملاحظة/تفاصيل التحويل (اختياري)' : 'Transfer note/details (optional)'}
                  </label>
                  <input
                    className="input-control"
                    value={paymentDetail}
                    onChange={(e) => setPaymentDetail(e.target.value)}
                    placeholder={isRtl ? 'مثال: اسم المحول، رقم إيصال...' : 'e.g. sender name, receipt #...'}
                    style={{ textAlign: isRtl ? 'right' : 'left' }}
                  />
                </div>
                <div className="input-group buy-span-2">
                  <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                    {isRtl ? 'إرفاق دليل الدفع (اختياري)' : 'Attach Payment Proof (optional)'}
                  </label>
                  <input
                    type="file"
                    className="input-control file-input"
                    accept="image/*,.pdf"
                    onChange={(e) => setPaymentProof(e.target.files?.[0] || null)}
                  />
                  {paymentProof && (
                    <div className="text-muted text-sm mt-2" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                      {isRtl ? 'المرفق:' : 'Attached:'} {paymentProof.name}
                    </div>
                  )}
                </div>
                {needsKyc && (
                  <div
                    className="input-group buy-span-2"
                    style={{
                      marginTop: '0.25rem',
                      padding: '1rem',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 180, 0, 0.35)',
                      background: 'rgba(255, 180, 0, 0.06)',
                    }}
                  >
                    <div className="text-accent text-sm mb-2" style={{ fontWeight: 700 }}>{t.kycBoxTitle}</div>
                    <p className="text-muted text-sm mb-3" style={{ margin: 0, lineHeight: 1.6 }}>{t.kycBoxBody}</p>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        cursor: 'pointer',
                        textAlign: isRtl ? 'right' : 'left',
                        direction: isRtl ? 'rtl' : 'ltr',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={kycAcknowledged}
                        onChange={(e) => setKycAcknowledged(e.target.checked)}
                        style={{ marginTop: '0.2rem', flexShrink: 0 }}
                      />
                      <span className="text-sm" style={{ lineHeight: 1.5 }}>{t.kycCheckboxLabel}</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-4 mt-6 buy-actions" style={{ flexDirection: isRtl ? 'row-reverse' : 'row' }}>
              {stage === 1 ? (
                <Link to="/" className="btn btn-outline" style={{ flex: 1 }}>
                  {t.back}
                </Link>
              ) : (
                <button type="button" onClick={() => setStage(1)} className="btn btn-outline" style={{ flex: 1 }}>
                  {isRtl ? 'رجوع للخطوة السابقة' : 'Back to previous step'}
                </button>
              )}
              <button
                onClick={() => {
                  if (stage === 1) {
                    setStage(2);
                    return;
                  }
                  onConfirm();
                }}
                className="btn btn-primary"
                style={{ flex: 2, opacity: stage === 1 ? (canMoveToPayDetails ? 1 : 0.5) : (cd.remainingMs === 0 || usdtAmount < 5 ? 0.5 : 1) }}
                disabled={stage === 1 ? !canMoveToPayDetails : (sending || cd.remainingMs === 0 || usdtAmount < 5)}
              >
                {stage === 1
                  ? (isRtl ? 'متابعة' : 'Continue')
                  : (sending ? (isRtl ? 'جاري الإرسال...' : 'Sending...') : t.confirmAndSend)}
              </button>
            </div>

            {cd.remainingMs === 0 && (
              <div className="text-error mt-4">
                {isRtl ? 'انتهى وقت الدفع. ارجع للصفحة الرئيسية وابدأ طلب جديد.' : 'Payment time expired. Go back and start a new order.'}
              </div>
            )}
          </>
        )}
      </div>
    </section>
    </main>
    <Footer t={t} lang={lang} />
    </div>
  );
}

