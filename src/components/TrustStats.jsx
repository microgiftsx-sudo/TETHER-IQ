import React, { useEffect, useRef, useState } from 'react';
import { getStats } from '../api';
import { DEFAULT_STATS } from '../../shared/statsNormalize.js';

const ICONS = {
  customers: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  transactions: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  years: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  ),
  satisfaction: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C4A008" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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
      const t0 = safe;
      if (t0 === 0) {
        setVal(0);
        return;
      }
      const duration = 2200;
      const steps = 80;
      const start = Math.max(0, t0 * 0.1);
      const inc = (t0 - start) / steps;
      let cur = start;
      setVal(Math.floor(start));
      timerRef.current = setInterval(() => {
        cur += inc;
        if (cur >= t0) {
          setVal(t0);
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
  { key: 'customers', iconKey: 'customers', suffix: '+', labelKey: 'statsCustomers' },
  { key: 'transactions', iconKey: 'transactions', suffix: '+', labelKey: 'statsTransactions' },
  { key: 'years', iconKey: 'years', suffix: '+', labelKey: 'statsYears' },
  { key: 'satisfaction', iconKey: 'satisfaction', suffix: '%', labelKey: 'statsSatisfaction' },
];

export default function TrustStats({ t }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getStats().then((d) => {
        if (!cancelled) setData(d);
      });
    };
    load();
    const interval = setInterval(load, 30000);
    const onVis = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <section className="trust-stats-section">
      <div className="trust-stats-grid">
        {STAT_KEYS.map((s) => (
          <div key={s.key} className="trust-stat-card">
            <div className="trust-stat-card__icon">{ICONS[s.iconKey]}</div>
            <div className="trust-stat-card__value text-accent">
              {data === null ? (
                <span className="trust-stat-skeleton" aria-hidden />
              ) : (
                <CountUp key={`${s.key}-${data[s.key]}`} target={data[s.key] ?? DEFAULT_STATS[s.key]} suffix={s.suffix} />
              )}
            </div>
            <div className="trust-stat-card__label">{t[s.labelKey]}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
