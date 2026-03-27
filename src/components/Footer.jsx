export default function Footer({ t }) {
  return (
    <footer className="glass-panel text-center" style={{ borderRadius: 0, borderBottom: 0, borderLeft: 0, borderRight: 0, padding: '2rem 0', marginTop: '2rem' }}>
      <div className="container flex-col items-center gap-4">
         <div className="logo flex items-center justify-center gap-2 mb-4">
            <h2 style={{ margin: 0, color: 'var(--accent-primary)', textShadow: '0 0 10px rgba(0,229,255,0.3)' }}>TETHER IQ</h2>
         </div>
         <p className="text-muted text-sm">{t.footerText}</p>
      </div>
    </footer>
  );
}
