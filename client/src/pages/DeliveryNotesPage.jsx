import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatDate, formatWeight } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';

// העמודות בפועל בטבלת "תעודות משלוח":
// תאריך תעודה · משווק/משווק-AI · מבנה · כמות קרטונים · משקל כולל · משקל ממוצע לקרטון · סיכום יומי ...

export default function DeliveryNotesPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    app.api.get('תעודות משלוח', '?maxRecords=400')
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalWeight = items.reduce((s, i) => s + num(i, ['משקל כולל', 'משקל']), 0);
  const totalCartons = items.reduce((s, i) => s + num(i, ['כמות קרטונים', 'קרטונים']), 0);

  return (
    <div>
      <PageHeader icon="📄" title="תעודות משלוח" />

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--weight-soft)' }}>⚖️</div><span className="kpi-label">סה"כ משקל</span></div><div className="kpi-value" style={{ color: 'var(--weight)' }}>{formatWeight(totalWeight)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--cartons-soft)' }}>📦</div><span className="kpi-label">סה"כ קרטונים</span></div><div className="kpi-value" style={{ color: 'var(--cartons)' }}>{formatNumber(totalCartons)}</div></div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>תאריך</th><th>משווק</th><th>מבנה</th><th>קרטונים</th><th>משקל</th><th>משקל ממוצע לקרטון</th></tr>
            </thead>
            <tbody>
              {items.slice(0, 60).map((n) => (
                <tr key={n.id} onClick={() => setDrawer(n)}>
                  <td>{formatDate(pick(n, ['תאריך תעודה', 'תאריך העלאת קובץ', 'תאריך']))}</td>
                  <td>{marketer(n)}</td>
                  <td>{linkSel(n['מבנה'])}</td>
                  <td>{formatNumber(num(n, ['כמות קרטונים', 'קרטונים']))}</td>
                  <td>{formatNumber(num(n, ['משקל כולל', 'משקל']))}</td>
                  <td>{formatNumber(num(n, ['משקל ממוצע לקרטון']))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && <DeliveryDrawer note={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function marketer(n) {
  const v = pick(n, ['משווק', 'משווק-AI', 'שם משווק']);
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ');
  return v ?? 'לא זמין';
}
function linkSel(v) {
  if (!v) return 'לא זמין';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ');
  return v;
}

function DeliveryDrawer({ note, onClose }) {
  useEscapeClose(onClose); // סגירה במקש Escape
  const total = useMemo(() => parseDaily(note['סיכום יומי']), [note]);
  const weight = num(note, ['משקל כולל', 'משקל']);
  const cartons = num(note, ['כמות קרטונים', 'קרטונים']);

  const daysChart = total.days.map((d) => ({
    label: shortDate(d.date),
    משקל: Math.round(Number(d.weight ?? d['משקל']) || 0),
    קרטונים: Math.round(Number(d.cartons ?? d['קרטונים']) || 0),
    משטחים: Math.round(Number(d.pallets ?? d['משטחים']) || 0),
  }));
  const byZan = Object.entries(total.products).map(([k, v]) => ({
    name: k,
    משקל: Math.round(Number(v.weight) || 0),
    קרטונים: Math.round(Number(v.cartons) || 0),
    משטחים: Math.round(Number(v.pallets ?? v['משטחים']) || 0),
  }));
  const byZanPie = (key) => byZan.map((x) => ({ name: x.name, value: x[key] })).filter((x) => x.value > 0);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>תעודת משלוח</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>פרטים</div>
            <Row l="משווק" v={marketer(note)} />
            <Row l="מבנה" v={linkSel(note['מבנה'])} />
            <Row l="תאריך" v={formatDate(pick(note, ['תאריך תעודה', 'תאריך העלאת קובץ', 'תאריך']))} />
            <Row l="קרטונים" v={formatNumber(cartons)} />
            <Row l="משקל" v={formatWeight(weight)} />
            <Row l="משקל ממוצע לקרטון" v={note['משקל ממוצע לקרטון'] != null ? formatNumber(note['משקל ממוצע לקרטון']) : '—'} />
            <Row l="סטייה מממוצע" v={note['סטייה מממוצע 12.3'] != null ? formatNumber(note['סטייה מממוצע 12.3']) : '—'} />
            <Row l="בדיקת משקל" v={note['בדיקת חריגת משקל'] || '—'} />
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>סיכום יומי</div>
            {total.days.length === 0 && !byZan.length ? (
              <div className="empty-state">אין נתונים לתקופה זו</div>
            ) : (
              <>
                {total.days.length > 0 && (
                  <>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead><tr><th>תאריך</th><th>קרטונים</th><th>משקל</th></tr></thead>
                        <tbody>
                          {total.days.map((d, i) => (
                            <tr key={i}>
                              <td>{formatDate(d.date)}</td>
                              <td>{formatNumber(d.cartons)}</td>
                              <td>{formatNumber(d.weight)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 12, marginTop: 14 }}>
                      <div>
                        <div className="section-title" style={{ marginTop: 0 }}>משקל לפי יום</div>
                        <div style={{ direction: 'ltr' }}>
                          <ResponsiveContainer width="100%" height={170}>
                            <BarChart data={daysChart} margin={CHART_MARGIN_ROTATED}>
                              <CartesianGrid {...GRID_PROPS} />
                              <XAxis dataKey="label" {...xAxisProps(daysChart.length, { rotate: daysChart.length > 7 })} />
                              <YAxis {...yAxisProps()} />
                              <Tooltip {...TOOLTIP_STYLE} />
                              <Bar dataKey="משקל" fill="#2878D0" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div>
                        <div className="section-title" style={{ marginTop: 0 }}>קרטונים לפי יום</div>
                        <div style={{ direction: 'ltr' }}>
                          <ResponsiveContainer width="100%" height={170}>
                            <BarChart data={daysChart} margin={CHART_MARGIN_ROTATED}>
                              <CartesianGrid {...GRID_PROPS} />
                              <XAxis dataKey="label" {...xAxisProps(daysChart.length, { rotate: daysChart.length > 7 })} />
                              <YAxis {...yAxisProps()} />
                              <Tooltip {...TOOLTIP_STYLE} />
                              <Bar dataKey="קרטונים" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {(byZanPie('משקל').length > 0 || byZanPie('קרטונים').length > 0) && (
                  <>
                    <div className="section-title" style={{ marginTop: 14 }}>משקל לפי זן</div>
                    {byZanPie('משקל').length ? (
                      <ResponsiveContainer width="100%" height={170}>
                        <PieChart>
                          <Pie data={byZanPie('משקל')} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65}>
                            {byZan.map((_, i) => <Cell key={i} fill={['#2878D0', '#09A7B2', '#8B5CF6', '#F59E0B', '#F04444'][i % 5]} />)}
                          </Pie>
                          <Tooltip {...TOOLTIP_STYLE} />
                          <Legend wrapperStyle={LEGEND_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="empty-state">אין נתונים</div>}
                    <div className="section-title" style={{ marginTop: 14 }}>קרטונים לפי זן</div>
                    {byZanPie('קרטונים').length ? (
                      <ResponsiveContainer width="100%" height={170}>
                        <PieChart>
                          <Pie data={byZanPie('קרטונים')} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65}>
                            {byZan.map((_, i) => <Cell key={i} fill={['#09A7B2', '#8B5CF6', '#F59E0B', '#F04444', '#2878D0'][i % 5]} />)}
                          </Pie>
                          <Tooltip {...TOOLTIP_STYLE} />
                          <Legend wrapperStyle={LEGEND_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="empty-state">אין נתונים</div>}
                    {byZanPie('משטחים').length > 0 && (
                      <>
                        <div className="section-title" style={{ marginTop: 14 }}>משטחים לפי זן</div>
                        <ResponsiveContainer width="100%" height={170}>
                          <PieChart>
                            <Pie data={byZanPie('משטחים')} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65}>
                              {byZan.map((_, i) => <Cell key={i} fill={['#F59E0B', '#F04444', '#09A7B2', '#2878D0', '#8B5CF6'][i % 5]} />)}
                            </Pie>
                            <Tooltip {...TOOLTIP_STYLE} />
                            <Legend wrapperStyle={LEGEND_STYLE} />
                          </PieChart>
                        </ResponsiveContainer>
                      </>
                    )}
                  </>
                )}
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
  const empty = { days: [], products: {} };
  if (!json) return empty;
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    const products = {};
    (Array.isArray(p.products) ? p.products : []).forEach((pr) => {
      const name = pr.var ?? pr.variety ?? pr['זן'] ?? 'אחר';
      if (!products[name]) products[name] = { weight: 0, cartons: 0 };
      products[name].weight += Number(pr.weight ?? pr['משקל']) || 0;
      products[name].cartons += Number(pr.cartons ?? pr['קרטונים']) || 0;
    });
    return {
      days: Array.isArray(p.days) ? p.days.map((d) => (typeof d === 'object' ? d : { date: d })) : [],
      products,
    };
  } catch { return empty; }
}
