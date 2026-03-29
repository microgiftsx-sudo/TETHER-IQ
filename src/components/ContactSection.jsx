export default function ContactSection({ t, lang, contactLink }) {
  const isRtl = lang === 'ar';
  const tgLink = contactLink || 'https://t.me/TETHER_IQ';

  const contacts = [
    {
      label: isRtl ? 'تيليغرام' : 'Telegram',
      value: isRtl ? 'راسلنا على تيليغرام' : 'Message us on Telegram',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12C22 6.477 17.523 2 12 2ZM16.578 8.5L14.763 17.105C14.632 17.676 14.288 17.82 13.808 17.55L11.058 15.527L9.737 16.797C9.594 16.94 9.472 17.062 9.202 17.062L9.394 14.265L14.444 9.715C14.664 9.523 14.395 9.413 14.1 9.605L7.828 13.537L5.116 12.694C4.557 12.522 4.545 12.141 5.237 11.871L15.827 7.647C16.295 7.474 16.709 7.744 16.578 8.5Z"
            fill="#2CA5E0"
          />
        </svg>
      ),
      action: () => window.open(tgLink, '_blank', 'noopener,noreferrer'),
    },
  ];

  return (
    <section id="contact" className="contact-section">
      <h2 className="home-section-title">{t.contactTitle}</h2>
      <p className="home-section-lead">{t.contactSubtitle}</p>
      <div className="contact-grid">
        {contacts.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.action}
            className={`glass-panel contact-card ${isRtl ? 'contact-card--rtl' : 'contact-card--ltr'}`}
          >
            <div className="contact-card__icon-wrap">{c.icon}</div>
            <div>
              <div className="contact-card__label">{c.label}</div>
              <div className="contact-card__hint">{c.value}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
