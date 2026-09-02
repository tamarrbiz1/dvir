import { workTypeName } from '../utils/field.js';
import { workHours } from '../utils/field.js';
// ============================================================
// "הרווחים שלי" — פילטר טווח + גרף + טבלה
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { formatMoney, formatNumber } from '../utils/format.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import { t } from '../i18n.js';

const fmt = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export default function WorkerEarnings({ api, worker }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month'); // month | week | day
  const [dFrom, setDFrom] = useState('');
  const [dTo, setDTo] = useState('');
  const [granularity, setGranularity] = useState('day'); // day | week | month

  useEffect(() => {
    api.get('עבודות עובדים', '?maxRecords=2000')
      .then((d) => setRecords(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const workerId = worker?.id || userRecordId();
  const mine = records.filter((r) => {
    const ref = r['עובד'];
    if (Array.isArray(ref)) return ref.some((x) => String(x.id || x) === String(workerId));
    return String(r['עובד'] || '') === String(workerId);
  });

  // חלון רף לפי בחירת ההגדרה
  const rangeRecs = useMemo(() => {
    const now = new Date();
    let start = null, end = now;
    if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === 'week') {
      const day = now.getDay(); // 0=ראשון
      start = new Date(now); start.setDate(now.getDate() - ((day + 1) % 7));
    } else if (range === 'day') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (dFrom) start = new Date(dFrom);
    if (dTo) end = new Date(dTo);

    return mine.filter((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return false;
      if (start && d < start) return false;
      if (d > end) return false;
      return true;
    });
  }, [mine, range, dFrom, dTo]);

  const totalEarned = rangeRecs.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);
  const totalHours = rangeRecs.reduce((s, r) => s + workHours(r), 0);
  const workDays = new Set(rangeRecs.map((r) => fmt(r['תאריך']))).size;
  const avgPerDay = workDays ? totalEarned / workDays : 0;

  // גרף לפי חלוקה (יום/שבוע/חודש)
  const chartData = useMemo(() => {
    const buckets = {};
    rangeRecs.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      let key;
      if (granularity === 'day') {
        key = `${d.getDate()}/${d.getMonth() + 1}`;
      } else if (granularity === 'week') {
        const start = new Date(d); start.setDate(d.getDate() - d.getDay());
        key = `${start.getDate()}/${start.getMonth() + 1}`;
      } else {
        key = `${d.getMonth() + 1}/${d.getFullYear()}`;
      }
      buckets[key] = (buckets[key] || 0) + (Number(r['סכום לתשלום']) || 0);
    });
    return Object.entries(buckets).map(([k, v]) => ({ label: k, סכום: Math.round(v) }));
  }, [rangeRecs, granularity]);

  return (
    <div>
      <div className="page-header"><h2>{t('w_myEarningsBtn')}</h2></div>

      {/* פילטרים */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <div className="form-group">
            <label>{t('w_from')}</label>
            <input type="date" className="input" value={dFrom} onChange={(e) => setDFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t('w_to')}</label>
            <input type="date" className="input" value={dTo} onChange={(e) => setDTo(e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t('w_show')}</label>
            <select className="select" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="month">{t('w_thisMonth')}</option>
              <option value="week">{t('w_thisWeek')}</option>
              <option value="day">{t('w_today')}</option>
              <option value="custom">{t('w_customRange')}</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <>
          {/* KPIs */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💰</div><span className="kpi-label">{t('w_earnedInRange')}</span></div>
              <div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(totalEarned)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--cartons-soft)' }}>⏱️</div><span className="kpi-label">{t('w_hours')}</span></div>
              <div className="kpi-value" style={{ color: 'var(--cartons)' }}>{formatNumber(totalHours)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--pallets-soft)' }}>📋</div><span className="kpi-label">{t('w_jobs')}</span></div>
              <div className="kpi-value" style={{ color: 'var(--pallets)' }}>{formatNumber(rangeRecs.length)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--profit-soft)' }}>📈</div><span className="kpi-label">{t('w_avgPerDay')}</span></div>
              <div className="kpi-value" style={{ color: 'var(--profit)' }}>{formatMoney(avgPerDay)}</div>
            </div>
          </div>

          {/* גרף */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('w_incomeOverTime')}</div>
            <div className="tabs" style={{ marginBottom: 12 }}>
              {['day', 'week', 'month'].map((g) => (
                <button key={g} className={`tab ${granularity === g ? 'active' : ''}`} onClick={() => setGranularity(g)}>
                  {g === 'day' ? t('w_day') : g === 'week' ? t('w_week') : t('w_month')}
                </button>
              ))}
            </div>
            <div style={{ direction: 'ltr' }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" {...xAxisProps(chartData.length, { rotate: true, maxLabels: 8 })} />
                  <YAxis {...yAxisProps({ money: true })} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                  <Bar dataKey="סכום" fill="#08A878" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* טבלה */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('w_detailList')}</div>
            {rangeRecs.length === 0 ? (
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
                    {rangeRecs.slice().reverse().map((r) => (
                      <tr key={r.id}>
                        <td>{fmt(r['תאריך'])}</td>
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

function structureName(v) {
  if (!v) return '—';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ');
  return v;
}
function userRecordId() {
  try { return sessionStorage.getItem('zite_user_recId') || ''; } catch { return ''; }
}
