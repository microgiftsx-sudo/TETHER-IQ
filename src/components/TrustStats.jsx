import React, { useEffect, useRef, useState } from 'react';
import { getStats } from '../api';
import { DEFAULT_STATS } from '../../shared/statsNormalize.js';

const ICONS = {
  customers: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  transactions: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  years: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6"/>
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
    </svg>
  ),
  satisfaction: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
};

function CountUp({ target, suffix = '' }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);
  const timerRef = useRef(null);
  const safe = Number.isFinite(Number(target)) ? Math.max(0, Math.floor(Number(target))) : 0;

  useEffect(() => {
    started.current = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      const t = safe;
      if (t === 0) {
        setVal(0);
        return;
      }
      const duration = 2200;
      const steps = 80;
      const start = Math.max(0, t * 0.1);
      const inc = (t - start) / steps;
      let cur = start;
      setVal(Math.floor(start));
      timerRef.current = setInterval(() => {
        cur += inc;
        if (cur >= t) {
          setVal(t);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
        } else {
          setVal(Math.floor(cur));
        }
      }, duration / steps);
    }, { threshold: 0.2, rootMargin: '40px' });
    const el = ref.current;
    if (el) observer.observe(el);
    return () => {
      observer.disconnect();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [safe]);

  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

const STAT_KEYS = [
  { key: 'customers',    iconKey: 'customers',    suffix: '+', labelKey: 'statsCustomers' },
  { key: 'transactions', iconKey: 'transactions', suffix: '+', labelKey: 'statsTransactions' },
  { key: 'years',        iconKey: 'years',        suffix: '+', labelKey: 'statsYears' },
  { key: 'satisfaction', iconKey: 'satisfaction', suffix: '%', labelKey: 'statsSatisfaction' },
];

export default function TrustStats({ t }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getStats().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="trust-stats-section" style={{ width: '100%', maxWidth: '100%', padding: '1.5rem 0', minWidth: 0 }}>
      <div className="trust-stats-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem',
      }}>
        {STAT_KEYS.map((s) => (
          <div key={s.key} style={{
            background: 'rgba(0,229,255,0.04)',
            border: '1px solid rgba(0,229,255,0.15)',
            borderRadius: '14px', padding: '1.4rem 0.75rem',
            textAlign: 'center', transition: 'transform 0.3s, border-color 0.3s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'rgba(0,229,255,0.15)'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.6rem' }}>
              {ICONS[s.iconKey]}
            </div>
            <div style={{ fontSize: '1.55rem', fontWeight: 800, color: 'var(--accent-primary)', lineHeight: 1, minHeight: '1.8rem' }}>
              {data === null
                ? <span style={{ display: 'inline-block', width: '60px', height: '1.4rem', borderRadius: '6px', background: 'rgba(0,229,255,0.1)', animation: 'pulse 1.4s ease-in-out infinite' }} />
                : <CountUp key={`${s.key}-${data[s.key]}`} target={data[s.key] ?? DEFAULT_STATS[s.key]} suffix={s.suffix} />
              }
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.4rem', fontWeight: 500 }}>
              {t[s.labelKey]}
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @media (max-width: 640px) {
          .trust-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 0.75rem !important; }
          .trust-stats-section { padding-left: 0 !important; padding-right: 0 !important; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.9; }
        }
      `}</style>
    </section>
  );
}
