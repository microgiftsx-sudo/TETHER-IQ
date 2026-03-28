import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageVisit } from '../visitTracking';

export default function VisitTracker() {
  const loc = useLocation();
  useEffect(() => {
    const lang = localStorage.getItem('lang') || 'ar';
    trackPageVisit(`${loc.pathname}${loc.search || ''}`, lang);
  }, [loc.pathname, loc.search]);
  return null;
}
