export default function Steps({ t }) {
  const steps = [
    { num: 1, title: t.step1Title, desc: t.step1Desc },
    { num: 2, title: t.step2Title, desc: t.step2Desc },
    { num: 3, title: t.step3Title, desc: t.step3Desc }
  ];

  return (
    <section className="py-8 w-full">
      <h2 className="text-center mb-8" style={{ textShadow: '0 0 10px rgba(255,255,255,0.1)' }}>{t.stepsTitle}</h2>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
        gap: '2rem' 
      }}>
        {steps.map((step, idx) => (
          <div key={idx} className="glass-panel text-center flex flex-col items-center" style={{ transition: 'transform 0.3s ease' }} 
               onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
               onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <div style={{ 
              width: '56px', height: '56px', borderRadius: '50%', 
              background: 'linear-gradient(135deg, var(--accent-primary), #0077FF)',
              color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', 
              fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem',
              boxShadow: '0 4px 15px rgba(0, 229, 255, 0.4)'
            }}>
              {step.num}
            </div>
            <h3 className="text-accent" style={{ fontSize: '1.3rem' }}>{step.title}</h3>
            <p className="text-muted text-sm mt-2" style={{ lineHeight: 1.6 }}>{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
