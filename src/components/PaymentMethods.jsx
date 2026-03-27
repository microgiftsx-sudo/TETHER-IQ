export default function PaymentMethods({ t, lang }) {
  const isRtl = lang === 'ar';
  const methods = [
    {
      name: 'Zain Cash',
      nameAr: 'زين كاش',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="#E31E24"/>
          <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold" fontFamily="Arial">Z</text>
        </svg>
      ),
    },
    {
      name: 'MasterCard',
      nameAr: 'ماستر كارد',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="19" cy="24" r="13" fill="#EB001B"/>
          <circle cx="29" cy="24" r="13" fill="#F79E1B" fillOpacity="0.9"/>
          <path d="M24 13.5a13 13 0 0 1 0 21A13 13 0 0 1 24 13.5z" fill="#FF5F00"/>
        </svg>
      ),
    },
    {
      name: 'FIB',
      nameAr: 'المصرف الأول',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="#00A651"/>
          <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial">FIB</text>
        </svg>
      ),
    },
    {
      name: 'Asia Hawala',
      nameAr: 'آسيا حوالة',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="12" fill="#0057A8"/>
          <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold" fontFamily="Arial">ASIA</text>
        </svg>
      ),
    },
  ];

  return (
    <section id="payment-methods" className="py-8 w-full">
      <h2 className="text-center mb-8">{t.paymentTitle}</h2>
      <p className="text-center text-muted mb-8" style={{ fontSize: '1rem', maxWidth: '600px', margin: '0 auto 2rem' }}>
        {t.paymentSubtitle}
      </p>
      <div className="payment-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1.5rem',
        maxWidth: '900px',
        margin: '0 auto',
      }}>
        {methods.map((m) => (
          <div key={m.name}
            className="glass-panel payment-card"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '0.75rem', padding: '1.75rem 1rem',
              transition: 'transform 0.3s, box-shadow 0.3s',
              cursor: 'default',
              borderColor: 'rgba(0,229,255,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(0,229,255,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
          >
            {m.icon}
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
              {isRtl ? m.nameAr : m.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
