export default function PaymentMethods({ t, lang }) {
  const isRtl = lang === 'ar';
  const methods = [
    {
      name: 'Zain Cash',
      nameAr: 'زين كاش',
      color: '#E31E24',
      image: '/logo/zaincash.png',
    },
    {
      name: 'MasterCard',
      nameAr: 'ماستر كارد',
      color: '#EB001B',
      icon: (
        <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
          <circle cx="18" cy="24" r="14" fill="#EB001B"/>
          <circle cx="30" cy="24" r="14" fill="#F79E1B" fillOpacity="0.9"/>
          <path d="M24 13.3a14 14 0 0 1 0 21.4A14 14 0 0 1 24 13.3z" fill="#FF5F00"/>
        </svg>
      ),
    },
    {
      name: 'FIB',
      nameAr: 'المصرف الأول',
      color: '#00A651',
      image: '/logo/fip.png',
    },
    {
      name: 'Asia Hawala',
      nameAr: 'آسيا حوالة',
      color: '#0057A8',
      image: '/logo/asia.jpg',
    },
  ];

  return (
    <section id="payment-methods" className="py-8 w-full">
      <h2 className="text-center mb-8">{t.paymentTitle}</h2>
      <p className="text-center text-muted mb-8" style={{ fontSize: '1rem', maxWidth: '600px', margin: '0 auto 2rem' }}>
        {t.paymentSubtitle}
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1.5rem',
        maxWidth: '900px',
        margin: '0 auto',
      }}>
        {methods.map((m) => (
          <div key={m.name}
            className="glass-panel"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '0.75rem', padding: '1.75rem 1rem',
              transition: 'transform 0.3s, box-shadow 0.3s',
              cursor: 'default',
              borderColor: `${m.color}33`,
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 12px 30px ${m.color}22`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
          >
            {m.image ? (
              <img src={m.image} alt={m.name} style={{ width: '48px', height: '48px', objectFit: 'contain', borderRadius: '8px' }} />
            ) : m.icon}
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
              {isRtl ? m.nameAr : m.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
