import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'admin_crm_token';

async function adminFetch(path, token, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Crm-Token': token,
      ...(options.headers || {}),
    },
    signal: options.signal ?? AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}

export default function AdminCrmPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [saved, setSaved] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [summary, setSummary] = useState(null);
  const [visits, setVisits] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vTotal, setVTotal] = useState(0);
  const [oTotal, setOTotal] = useState(0);
  const [vOff, setVOff] = useState(0);
  const [oOff, setOOff] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const limit = 30;

  const loadAll = useCallback(async (tok) => {
    if (!tok) return;
    setLoading(true);
    setErr('');
    try {
      const s = await adminFetch('/api/admin/crm/summary', tok);
      setSummary(s);
      const v = await adminFetch(`/api/admin/crm/visits?offset=0&limit=${limit}`, tok);
      setVisits(v.items || []);
      setVTotal(v.total || 0);
      setVOff(0);
      const o = await adminFetch(`/api/admin/crm/orders?offset=0&limit=${limit}`, tok);
      setOrders(o.items || []);
      setOTotal(o.total || 0);
      setOOff(0);
    } catch (e) {
      setErr(String(e?.message || e));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (saved && token) loadAll(token);
  }, [saved, token, loadAll]);

  const persistToken = () => {
    sessionStorage.setItem(TOKEN_KEY, token.trim());
    setSaved(true);
    loadAll(token.trim());
  };

  const fetchVisitPage = async (nextOff) => {
    if (!token) return;
    setLoading(true);
    try {
      const v = await adminFetch(`/api/admin/crm/visits?offset=${nextOff}&limit=${limit}`, token);
      setVisits(v.items || []);
      setVOff(nextOff);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderPage = async (nextOff) => {
    if (!token) return;
    setLoading(true);
    try {
      const o = await adminFetch(`/api/admin/crm/orders?offset=${nextOff}&limit=${limit}`, token);
      setOrders(o.items || []);
      setOOff(nextOff);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async (kind) => {
    if (!token) return;
    const path = kind === 'visits' ? '/api/admin/crm/export/visits.csv' : '/api/admin/crm/export/orders.csv';
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'X-Admin-Crm-Token': token },
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      setErr(await res.text().catch(() => 'Export failed'));
      return;
    }
    const blob = await res.blob();
    downloadBlob(blob, kind === 'visits' ? 'visits.csv' : 'orders.csv');
  };

  const openPrintReport = () => {
    if (!token) return;
    const u = `${window.location.origin}${API_BASE}/api/admin/crm/report.html?token=${encodeURIComponent(token)}`;
    window.open(u, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="page-shell" style={{ minHeight: '100vh', padding: '1.5rem', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.35rem', color: '#00E5FF' }}>CRM — TETHER IQ</h1>
          <Link to="/" style={{ color: '#94a3b8', fontSize: '0.9rem' }}>← الرئيسية / Home</Link>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.25rem', border: '1px solid rgba(0,229,255,0.25)' }}>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#00E5FF' }}>الدخول للوحة التحكم</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="password"
              className="input-control"
              placeholder="Admin CRM token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 1, minWidth: 220, maxWidth: 420, padding: '0.5rem 0.75rem' }}
            />
            <button type="button" className="btn btn-primary" onClick={persistToken} disabled={!token.trim()}>
              {saved ? 'تحديث البيانات' : 'دخول'}
            </button>
          </div>
        </div>

        {err && (
          <div style={{ color: '#fca5a5', marginBottom: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{err}</div>
        )}

        {loading && !summary && <p className="text-muted">جاري التحميل…</p>}

        {summary && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {[
                ['زيارات اليوم', summary.visits?.visitsToday],
                ['زيارات 7 أيام', summary.visits?.visitsWeek],
                ['زوّار مميّز (7d)', summary.visits?.uniqueVisitorsWeek],
                ['طلبات اليوم', summary.orders?.ordersToday],
                ['طلبات 7 أيام', summary.orders?.ordersWeek],
                ['USDT (7 أيام)', summary.orders?.volumeWeek],
              ].map(([k, v]) => (
                <div key={k} className="glass-panel" style={{ padding: '1rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 6 }}>{k}</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#00E5FF' }}>{v ?? '—'}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <button type="button" className="btn btn-primary" onClick={() => exportCsv('visits')} disabled={loading}>تصدير CSV زيارات</button>
              <button type="button" className="btn btn-primary" onClick={() => exportCsv('orders')} disabled={loading}>تصدير CSV طلبات</button>
              <button type="button" className="btn btn-primary" onClick={openPrintReport} disabled={loading}>تقرير HTML (طباعة PDF)</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
              <div className="glass-panel" style={{ padding: '1rem', overflow: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <strong>الزيارات</strong>
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>إجمالي {vTotal}</span>
                </div>
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                      <th style={{ padding: '0.35rem' }}>وقت</th>
                      <th style={{ padding: '0.35rem' }}>مسار</th>
                      <th style={{ padding: '0.35rem' }}>جهاز</th>
                      <th style={{ padding: '0.35rem' }}>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '0.35rem', whiteSpace: 'nowrap' }}>{v.at?.slice(5, 16)}</td>
                        <td style={{ padding: '0.35rem' }}>{v.path}</td>
                        <td style={{ padding: '0.35rem' }}>{v.device}</td>
                        <td style={{ padding: '0.35rem' }}>{v.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button type="button" className="btn btn-primary" disabled={loading || vOff + limit >= vTotal} onClick={() => fetchVisitPage(vOff + limit)}>الأقدم ←</button>
                  <button type="button" className="btn btn-primary" disabled={loading || vOff <= 0} onClick={() => fetchVisitPage(Math.max(0, vOff - limit))}>→ الأحدث</button>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '1rem', overflow: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <strong>الطلبات</strong>
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>إجمالي {oTotal}</span>
                </div>
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#94a3b8' }}>
                      <th style={{ padding: '0.35rem' }}>وقت</th>
                      <th style={{ padding: '0.35rem' }}>طلب</th>
                      <th style={{ padding: '0.35rem' }}>اسم</th>
                      <th style={{ padding: '0.35rem' }}>USDT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '0.35rem', whiteSpace: 'nowrap' }}>{o.at?.slice(5, 16)}</td>
                        <td style={{ padding: '0.35rem' }}>{o.orderId}</td>
                        <td style={{ padding: '0.35rem' }}>{o.name}</td>
                        <td style={{ padding: '0.35rem' }}>{o.usdtAmount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button type="button" className="btn btn-primary" disabled={loading || oOff + limit >= oTotal} onClick={() => fetchOrderPage(oOff + limit)}>الأقدم ←</button>
                  <button type="button" className="btn btn-primary" disabled={loading || oOff <= 0} onClick={() => fetchOrderPage(Math.max(0, oOff - limit))}>→ الأحدث</button>
                </div>
              </div>
            </div>

            {summary.marketing && (
              <p className="text-muted text-sm mt-4">
                أرقام العرض في الواجهة: عملاء {summary.marketing.customers} · عمليات {summary.marketing.transactions}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
