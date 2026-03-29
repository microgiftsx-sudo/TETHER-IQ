export default function Steps({ t }) {
  const steps = [
    { num: 1, title: t.step1Title, desc: t.step1Desc },
    { num: 2, title: t.step2Title, desc: t.step2Desc },
    { num: 3, title: t.step3Title, desc: t.step3Desc },
  ];

  return (
    <section className="home-section">
      <h2 className="home-section-title">{t.stepsTitle}</h2>
      <div className="steps-grid">
        {steps.map((step, idx) => (
          <div key={idx} className="glass-panel step-card flex flex-col items-center text-center">
            <div className="step-card__badge">{step.num}</div>
            <h3 className="step-card__title">{step.title}</h3>
            <p className="text-muted text-sm mt-2 step-card__desc">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
