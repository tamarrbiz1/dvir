import { workHours , workTypeName } from '../utils/field.js';
// ============================================================
// מסך בית לעובד — כרטיסי רווחים
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useAutoRefresh } from '../utils/live.js';
import { formatMoney, formatNumber } from '../utils/format.js';
import { t } from '../i18n.js';

export default function WorkerHome({ api, worker }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('עבודות עובדים', '?maxRecords=1000')
    .then((d) => { setRecords(Array.isArray(d) ? d : []); setError(''); })
    .catch(() => setError(t('w_loadError'))), [api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load); // הדיווחים מתעדכנים אוטומטית

  // מסנן רק את העבודות של העובד המחובר
  const workerId = worker?.id || userRecordId();
  const mine = records.filter((r) => {
    const ref = r['עובד'];
    if (Array.isArray(ref)) return ref.some((x) => String(x.id || x) === String(workerId));
    return String(r['עובד'] || '') === String(workerId);
  });

  // נקודת זמן — חודש נוכחי / קודם
  const now = new Date();
  const inMonth = (r, monthOffset) => {
    const d = new Date(r['תאריך']);
    if (Number.isNaN(d.getTime())) return false;
    const tgt = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    return d.getFullYear() === tgt.getFullYear() && d.getMonth() === tgt.getMonth();
  };

  const monthRecs = mine.filter((r) => inMonth(r, 0));
  const prevRecs = mine.filter((r) => inMonth(r, -1));

  const hours = (arr) => arr.reduce((s, r) => s + workHours(r), 0);
  const paid = (arr) => arr.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);

  const cards = [
    { icon: '💰', label: t('w_thisMonth'), value: formatMoney(paid(monthRecs)), color: 'var(--revenue)' },
    { icon: '🕰️', label: t('w_lastMonth'), value: formatMoney(paid(prevRecs)), color: 'var(--profit)' },
    { icon: '⏱️', label: t('w_hours'), value: formatNumber(hours(monthRecs)), color: 'var(--cartons)' },
    { icon: '📋', label: t('w_jobs'), value: formatNumber(monthRecs.length), color: 'var(--pallets)' },
  ];

  return (
    <div>
      <div className="worker-greeting">{t('w_myEarnings')}</div>

      {error && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}

      {loading ? (
        <div className="grid">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            {cards.map((c) => (
              <div key={c.label} className="kpi-card">
                <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--bg-secondary)' }}>{c.icon}</div><span className="kpi-label">{c.label}</span></div>
                <div className="kpi-value" style={{ color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('w_recentJobs')}</div>
            {mine.length === 0 ? (
              <div className="empty-state">{t('w_noData')}</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('w_date')}</th>
                      <th>{t('w_workType')}</th>
                      <th>{t('w_structure')}</th>
                      <th>{t('w_amount')}</th>
                      <th>{t('w_hours')}</th>
                      <th>{t('w_sum')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.slice(-15).reverse().map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r['תאריך'])}</td>
                        <td>{workTypeName(r, '—')}</td>
                        <td>{structureName(r['מבנה'])}</td>
                        <td>{formatNumber(r['כמות'])}</td>
                        <td>{formatNumber(r['סכום שעות'])}</td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(r['סכום לתשלום'])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function structureName(v) {
  if (!v) return '—';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ');
  return v;
}
function userRecordId() {
  try {
    return sessionStorage.getItem('zite_user_recId') || '';
  } catch { return ''; }
}
