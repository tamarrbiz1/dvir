import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatDate, formatMoney, formatPercent } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

export default function InvoicesPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    app.api.get('חשבוניות', '?maxRecords=400')
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalNet = items.reduce((s, i) => s + num(i, ['סכום נטו', 'סכום נטוRollup (from חשבוניות)', 'נטו']), 0);
  const totalGross = items.reduce((s, i) => s + num(i, ['סכום ברוטו', 'סכום ברוטו Rollup (from חשבוניות)', 'ברוטו']), 0);
  const totalWeight = items.reduce((s, i) => s + num(i, ['משקל', 'משקל Rollup (from חשבוניות)']), 0);

  return (
    <div>
      <div className="page-header"><h2>חשבוניות</h2></div>

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💵</div><span className="kpi-label">סה"כ ברוטו</span></div><div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(totalGross)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--profit-soft)' }}>💸</div><span className="kpi-label">סה"כ נטו</span></div><div className="kpi-value" style={{ color: 'var(--profit)' }}>{formatMoney(totalNet)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--weight-soft)' }}>⚖️</div><span className="kpi-label">סה"כ משקל</span></div><div className="kpi-value" style={{ color: 'var(--weight)' }}>{formatNumber(totalWeight)}</div></div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>משווק</th><th>תאריך</th><th>נטו</th><th>ברוטו</th><th>משקל</th><th>קרטונים</th><th>סטטוס</th></tr>
            </thead>
            <tbody>
              {items.slice(0, 60).map((inv) => (
                <tr key={inv.id} onClick={() => setDrawer(inv)}>
                  <td>{Array.isArray(inv['משווק']) ? inv['משווק'][0] : (inv['משווק'] || inv['שם משווק'] || 'לא זמין')}</td>
                  <td>{formatDate(inv['תאריך-AI'] || inv['תאריך העלאת קובץ'])}</td>
                  <td>{formatMoney(inv['סכום נטו'])}</td>
                  <td>{formatMoney(inv['סכום ברוטו'])}</td>
                  <td>{formatNumber(inv['משקל'])}</td>
                  <td>{formatNumber(inv['כמות קרטונים'])}</td>
                  <td><span className="badge badge-ok">{inv['סטטוס תשלום'] || 'לא זמין'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && <InvoiceDrawer inv={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function InvoiceDrawer({ inv, onClose }) {
  const net = num(inv, ['סכום נטו', 'נטו', 'פדיון נטו']);
  const gross = num(inv, ['סכום ברוטו', 'ברוטו', 'פדיון ברוטו']);
  const weight = num(inv, ['משקל']);
  const cartons = num(inv, ['כמות קרטונים', 'קרטונים']);
  const pallets = num(inv, ['מספר משטחים', 'משטחים']);
  const discount = num(inv, ['ניכוי משווק בפועל', 'ניכוי משווק']);
  const transport = num(inv, ['עלות הובלה', 'עלות הובלה-AI']);

  // פירוק "סיכום יומי"
  const daily = useMemo(() => parseDaily(inv['סיכום יומי'] || inv['סיכום יומי-AI']), [inv]);
  const chart = daily.map((d) => ({ label: shortDate(d.date ?? d['תאריך']), קרטונים: Number(d.cartons ?? d['קרטונים']) || 0, משקל: Number(d.weight ?? d['משקל']) || 0, פדיון: Math.round(Number(d.value ?? d['פדיון']) || 0) }));

  const byZan = useMemo(() => {
    const b = {};
    daily.forEach((d) => {
      const z = d.var ?? d['זן'] ?? 'אחר';
      b[z] = b[z] || { weight: 0, revenue: 0, cartons: 0 };
      b[z].weight += (Number(d.weight ?? d['משקל']) || 0);
      b[z].revenue += (Number(d.value ?? d['פדיון']) || 0);
      b[z].cartons += (Number(d.cartons ?? d['קרטונים']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, ...v }));
  }, [daily]);

  const kpis = [
    { l: 'ברוטו', v: formatMoney(gross), c: 'var(--revenue)' },
    { l: 'נטו', v: formatMoney(net), c: 'var(--profit)' },
    { l: 'משקל', v: `${formatNumber(weight)} ק"ג`, c: 'var(--weight)' },
    { l: 'קרטונים', v: formatNumber(cartons), c: 'var(--cartons)' },
    { l: 'משטחים', v: formatNumber(pallets), c: 'var(--pallets)' },
    { l: 'ניכוי', v: formatMoney(discount), c: 'var(--expense)' },
    { l: 'הובלה', v: formatMoney(transport), c: 'var(--text-secondary)' },
  ];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>חשבונית</span>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            {kpis.map((k) => (
              <div key={k.l} className="kpi-card" style={{ padding: '14px 14px 0' }}>
                <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{k.l}</span></div>
                <div className="kpi-value" style={{ fontSize: 17, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>פרטי חשבונית</div>
            <Row l="משווק" v={Array.isArray(inv['משווק']) ? inv['משווק'][0] : (inv['משווק'] || 'לא זמין')} />
            <Row l="סטטוס תשלום" v={inv['סטטוס תשלום'] || 'לא זמין'} />
            <Row l={'מחיר נטו לק"ג'} v={inv['מחיר נטו לק"ג'] != null ? formatNumber(inv['מחיר נטו לק"ג']) : '—'} />
            <Row l="משקל ממוצע לקרטון" v={inv['משקל ממוצע לקרטון'] != null ? formatNumber(inv['משקל ממוצע לקרטון']) : '—'} />
            <Row l="ניכוי משווק בפועל" v={inv['ניכוי משווק בפועל'] != null ? formatMoney(inv['ניכוי משווק בפועל']) : 'לא זמין'} />
            <Row l="ניכוי משווק צפוי" v={inv['ניכוי משווק צפוי'] != null ? formatMoney(inv['ניכוי משווק צפוי']) : 'לא זמין'} />
            <Row l="אחוז ניכוי בפועל" v={inv['אחוז ניכוי בפועל'] != null ? formatPercent(inv['אחוז ניכוי בפועל']) : 'לא זמין'} />
            <Row l="עלות הובלה" v={inv['עלות הובלה'] != null ? formatMoney(inv['עלות הובלה']) : '—'} />
          </div>

          {/* סיכום יומי */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>סיכום יומי</div>
            {daily.length === 0 ? (
              <div className="empty-state">אין נתונים לתקופה זו</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>תאריך</th><th>זן</th><th>קרטונים</th><th>משקל</th><th>פדיון</th></tr></thead>
                    <tbody>
                      {daily.map((d, i) => (
                        <tr key={i}>
                          <td>{formatDate(d.date ?? d['תאריך'])}</td>
                          <td>{d.var ?? d['זן'] ?? '—'}</td>
                          <td>{formatNumber(d.cartons ?? d['קרטונים'])}</td>
                          <td>{formatNumber(d.weight ?? d['משקל'])}</td>
                          <td>{formatMoney(d.value ?? d['פדיון'])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 12 }}>
                  <div>
                    <div className="section-title">פדיון לפי יום</div>
                    <div style={{ direction: 'ltr' }}>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={chart} margin={CHART_MARGIN_ROTATED}>
                          <CartesianGrid {...GRID_PROPS} />
                          <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: chart.length > 7 })} />
                          <YAxis {...yAxisProps({ money: true })} />
                          <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                          <Bar dataKey="פדיון" fill="#08A878" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <div className="section-title">משקל לפי יום</div>
                    <div style={{ direction: 'ltr' }}>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={chart} margin={CHART_MARGIN_ROTATED}>
                          <CartesianGrid {...GRID_PROPS} />
                          <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: chart.length > 7 })} />
                          <YAxis {...yAxisProps()} />
                          <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v)} ק"ג`} />
                          <Bar dataKey="משקל" fill="#2878D0" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <div className="section-title">קרטונים לפי יום</div>
                    <div style={{ direction: 'ltr' }}>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={chart} margin={CHART_MARGIN_ROTATED}>
                          <CartesianGrid {...GRID_PROPS} />
                          <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: chart.length > 7 })} />
                          <YAxis {...yAxisProps()} />
                          <Tooltip {...TOOLTIP_STYLE} />
                          <Bar dataKey="קרטונים" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
                <div className="section-title">פדיון לפי זן</div>
                {byZan.length ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={byZan} dataKey="revenue" nameKey="name" innerRadius={40} outerRadius={65}>
                        {byZan.map((_, i) => <Cell key={i} fill={['#2878D0', '#09A7B2', '#8B5CF6', '#F59E0B', '#F04444'][i % 5]} />)}
                      </Pie>
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                      <Legend wrapperStyle={LEGEND_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="empty-state">אין נתונים</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ l, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><b>{v}</b></div>;
}
function shortDate(d) { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d).slice(0, 5) : `${x.getDate()}/${x.getMonth() + 1}`; }
function parseDaily(json) {
  if (!json) return [];
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    const arr = Array.isArray(p.days) ? p.days : (Array.isArray(p) ? p : []);
    return arr.map((d) => (typeof d === 'object' ? d : { date: d, value: null }));
  } catch { return []; }
}
