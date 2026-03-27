export default function ContactSection({ t, lang, contactLink }) {
  const isRtl = lang === 'ar';
  const tgLink = contactLink || 'https://t.me/TETHER_IQ';

  const contacts = [
    {
      label: isRtl ? 'تيليغرام' : 'Telegram',
      value: isRtl ? 'راسلنا على تيليغرام' : 'Message us on Telegram',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12C22 6.477 17.523 2 12 2ZM16.578 8.5L14.763 17.105C14.632 17.676 14.288 17.82 13.808 17.55L11.058 15.527L9.737 16.797C9.594 16.94 9.472 17.062 9.202 17.062L9.394 14.265L14.444 9.715C14.664 9.523 14.395 9.413 14.1 9.605L7.828 13.537L5.116 12.694C4.557 12.522 4.545 12.141 5.237 11.871L15.827 7.647C16.295 7.474 16.709 7.744 16.578 8.5Z" fill="#2CA5E0"/>
        </svg>
      ),
      color: '#2CA5E0',
      action: () => window.open(tgLink, '_blank'),
    },
  ];

  return (
    <section id="contact" className="py-8 w-full">
      <h2 className="text-center mb-8">{t.contactTitle}</h2>
      <p className="text-center text-muted mb-8" style={{ maxWidth: '600px', margin: '0 auto 2rem', fontSize: '1rem' }}>
        {t.contactSubtitle}
      </p>
      <div style={{
        display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap',
      }}>
        {contacts.map((c) => (
          <button key={c.label} onClick={c.action}
            className="glass-panel"
            style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              padding: '1.5rem 2rem', cursor: 'pointer',
              border: `1px solid ${c.color}40`,
              transition: 'all 0.3s', minWidth: '240px',
              flexDirection: isRtl ? 'row-reverse' : 'row',
              textAlign: isRtl ? 'right' : 'left',
              background: 'var(--bg-glass)',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 30px ${c.color}30`; e.currentTarget.style.transform = 'translateY(-4px)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: `${c.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {c.icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>{c.label}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>{c.value}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
