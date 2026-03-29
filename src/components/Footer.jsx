import { Link } from 'react-router-dom';

export default function Footer({ t, lang = 'ar' }) {
  const isRtl = lang === 'ar';

  return (
    <footer
      className="glass-panel site-footer text-center"
      style={{
        borderRadius: 0,
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
      }}
    >
      <div className="container">
        <div className="site-footer__inner">
          <h2 className="site-footer__brand">TETHER IQ</h2>

          <p className="site-footer__notice" dir={isRtl ? 'rtl' : 'ltr'}>
            {t.regulatoryStrip}
          </p>

          <nav
            className="site-footer__nav"
            style={{ direction: isRtl ? 'rtl' : 'ltr' }}
            aria-label={isRtl ? 'تذييل الموقع' : 'Site footer'}
          >
            <div className="site-footer__cluster">
              <Link to="/privacy" className="site-footer__link">
                {t.navPrivacy}
              </Link>
              <span className="site-footer__sep" aria-hidden>·</span>
              <Link to="/terms" className="site-footer__link">
                {t.navTerms}
              </Link>
              <span className="site-footer__sep" aria-hidden>·</span>
              <Link to="/disclaimer" className="site-footer__link">
                {t.navDisclaimer}
              </Link>
              <span className="site-footer__sep" aria-hidden>·</span>
              <Link to="/about" className="site-footer__link">
                {t.navAbout}
              </Link>
            </div>
            <div className="site-footer__cluster site-footer__cluster--orders">
              <span className="site-footer__sep site-footer__sep--pipe" aria-hidden>
                |
              </span>
              <Link to="/my-orders" className="site-footer__link site-footer__link--emphasis">
                {t.navMyOrders}
              </Link>
            </div>
          </nav>

          <p className="site-footer__copyright">{t.footerText}</p>
        </div>
      </div>
    </footer>
  );
}
