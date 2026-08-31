import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatWeight, formatDate } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';

export default function HarvestsPage() {
  const app = useApp();
  const [harvests, setHarvests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    app.api.get('קטיפים', '?maxRecords=300')
      .then((d) => setHarvests(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalKg = harvests.reduce((s, h) => s + (Number(h['כמות ק"ג']) || 0), 0);
  const totalCartons = harvests.reduce((s, h) => s + (Number(h['מספר קרטונים']) || 0), 0);
  const totalPallets = harvests.reduce((s, h) => s + (Number(h['מספר משטחים']) || 0), 0);

  // נתונים לגרף לפי תאריך
  const byDate = {};
  harvests.forEach((h) => {
    const d = formatDate(h['תאריך']);
    byDate[d] = (byDate[d] || 0) + (Number(h['כמות ק"ג']) || 0);
  });
  const chartData = Object.entries(byDate).slice(-14).map(([k, v]) => ({ date: k, kg: Math.round(v) }));

  return (
    <div>
      <PageHeader icon="🧺" title="קטיפים" />

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--harvest-soft)' }}>🧺</div><span className="kpi-label">סה"כ ק"ג</span></div>
          <div className="kpi-value" style={{ color: 'var(--harvest)' }}>{formatNumber(totalKg)}</div>
          <div className="kpi-footer" style={{ background: 'var(--harvest)' }}>קטיף</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--cartons-soft)' }}>📦</div><span className="kpi-label">קרטונים</span></div>
          <div className="kpi-value" style={{ color: 'var(--cartons)' }}>{formatNumber(totalCartons)}</div>
          <div className="kpi-footer" style={{ background: 'var(--cartons)' }}>קרטונים</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--pallets-soft)' }}>🛒</div><span className="kpi-label">משטחים</span></div>
          <div className="kpi-value" style={{ color: 'var(--pallets)' }}>{formatNumber(totalPallets)}</div>
          <div className="kpi-footer" style={{ background: 'var(--pallets)' }}>משטחים</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="section-title" style={{ marginTop: 0 }}>ק"ג לאורך זמן</div>
        <div style={{ direction: 'ltr' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" {...xAxisProps(chartData.length, { rotate: chartData.length > 8 })} />
              <YAxis {...yAxisProps()} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatWeight(v)} />
              <Bar dataKey="kg" fill="#2E9B62" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="section-title" style={{ marginTop: 0 }}>רשימת קטיפים</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>תאריך</th><th>מבנה</th><th>סוג קטיף</th><th>ק"ג</th><th>קרטונים</th>
              </tr>
            </thead>
            <tbody>
              {harvests.slice(0, 25).map((h) => (
                <tr key={h.id}>
                  <td>{formatDate(h['תאריך'])}</td>
                  <td>{displayName(h['מבנה'], 'לא זמין')}</td>
                  <td>{h['סוג קטיף'] || 'לא זמין'}</td>
                  <td>{formatNumber(h['כמות ק"ג'])}</td>
                  <td>{formatNumber(h['מספר קרטונים'])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
