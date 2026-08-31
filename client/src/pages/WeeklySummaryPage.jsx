import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatMoney, formatDate } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import { BarChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps, yCategoryProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';

const TABS = ['סקירה', 'לפי ימים', 'זנים', 'מבנים', 'ק"ג בפועל', 'התאמות'];
const PIE = ['#08A878', '#2878D0', '#8B5CF6', '#F59E0B', '#F04444', '#09A7B2', '#10A66A', '#6366F1'];

export default function WeeklySummaryPage() {
  const app = useApp();
  const [weeks, setWeeks] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    Promise.all([
      app.api.get('סיכום שבועי', '?maxRecords=200'),
      app.api.get('הוצאות', '?maxRecords=400'),
    ])
      .then(([w, e]) => {
        setWeeks(Array.isArray(w) ? w : []);
        setExpenses(Array.isArray(e) ? e : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ------ חישובים ------
  const num = (v) => Number(v) || 0;
  const totalNeto = weeks.reduce((s, w) => s + num(w['סכום נטוRollup (from חשבוניות)']), 0);
  const totalWeight = weeks.reduce((s, w) => s + num(w['משקל Rollup (from חשבוניות)']), 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e['סכום כולל-AI']), 0);

  // חלוקת הוצאות לשבועות לפי טווח תאריכים
  function getWeekForDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    for (const w of weeks) {
      const s = new Date(w['תאריך התחלה']);
      const e = new Date(w['תאריך סיום']);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && d >= s && d <= e) {
        return w['קוד שבוע'];
      }
    }
    // fallback: try by week number pattern
    return null;
  }

  const weeklyExpenses = useMemo(() => {
    const map = {};
    expenses.forEach((exp) => {
      const d = exp['תאריך חשבונית-AI'] || exp['תאריך העלאת החשבונית'] || exp['תאריך'];
      const wk = getWeekForDate(d);
      const key = wk || 'ללא שבוע';
      map[key] = (map[key] || 0) + num(exp['סכום כולל-AI']);
    });
    return map;
  }, [expenses, weeks]);

  const chartData = useMemo(() => {
    const sorted = [...weeks].sort((a, b) => {
      const da = new Date(a['תאריך התחלה']);
      const db = new Date(b['תאריך התחלה']);
      return (Number.isNaN(da.getTime()) ? 0 : da) - (Number.isNaN(db.getTime()) ? 0 : db);
    });
    return sorted.map((w) => {
      const code = w['קוד שבוע'];
      return {
        name: code || '?',
        'פדיון': Math.round(num(w['סכום נטוRollup (from חשבוניות)'])),
        'הוצאות': Math.round(weeklyExpenses[code] || 0),
        'משקל': Math.round(num(w['משקל Rollup (from חשבוניות)'])),
      };
    });
  }, [weeks, weeklyExpenses]);

  return (
    <div>
      <PageHeader icon="📆" title="סיכום שבועי" />
      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <>
          {/* ------ KPI Cards ------ */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💰</div><span className="kpi-label">סה"כ פדיון נטו</span></div>
              <div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(totalNeto)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--expense-soft)' }}>🧾</div><span className="kpi-label">סה"כ הוצאות</span></div>
              <div className="kpi-value" style={{ color: 'var(--expense)' }}>{formatMoney(totalExpenses)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--profit-soft)' }}>📈</div><span className="kpi-label">רווח</span></div>
              <div className="kpi-value" style={{ color: 'var(--profit)' }}>{formatMoney(totalNeto - totalExpenses)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--harvest-soft)' }}>🧺</div><span className="kpi-label">סה"כ משקל קטיף</span></div>
              <div className="kpi-value" style={{ color: 'var(--harvest)' }}>{formatNumber(totalWeight)} ק"ג</div>
            </div>
          </div>

          {/* ------ Bar Charts ------ */}
          {(chartData.length > 0) && (
            <>
              <div className="card" style={{ marginTop: 20 }}>
                <div className="section-title" style={{ marginTop: 0 }}>הכנסות לפי שבוע</div>
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="name" {...xAxisProps(chartData.length, { rotate: chartData.length > 8 })} />
                      <YAxis {...yAxisProps({ money: true })} />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                      <Bar dataKey="פדיון" fill="#08A878" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי שבוע</div>
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="name" {...xAxisProps(chartData.length, { rotate: chartData.length > 8 })} />
                      <YAxis {...yAxisProps({ money: true })} />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                      <Bar dataKey="הוצאות" fill="#F04444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card" style={{ marginTop: 14 }}>
                <div className="section-title" style={{ marginTop: 0 }}>ק"ג קטיף לפי שבוע</div>
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="name" {...xAxisProps(chartData.length, { rotate: chartData.length > 8 })} />
                      <YAxis {...yAxisProps()} />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v)} ק"ג`} />
                      <Bar dataKey="משקל" fill="#6366F1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

          {/* ------ Weekly Breakdown Table ------ */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>פירוט שבועי</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>שבוע</th><th>מתאריך</th><th>עד תאריך</th><th>פדיון ברוטו</th><th>פדיון נטו</th><th>משקל</th><th>סטטוס מסמכים</th><th>סטטוס קטיף</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.slice(0, 60).map((w) => (
                    <tr key={w.id} onClick={() => setDrawer(w)} style={{ cursor: 'pointer' }}>
                      <td><b>{displayName(w['קוד שבוע'])}</b></td>
                      <td>{formatDate(w['תאריך התחלה'])}</td>
                      <td>{formatDate(w['תאריך סיום'])}</td>
                      <td>{formatMoney(w['סכום ברוטו Rollup (from חשבוניות)'])}</td>
                      <td>{formatMoney(w['סכום נטוRollup (from חשבוניות)'])}</td>
                      <td>{formatNumber(w['משקל Rollup (from חשבוניות)'])}</td>
                      <td><StatusBadge v={displayName(w['סטטוס התאמה'])} /></td>
                      <td><StatusBadge v={displayName(w['סטטוס התאמת קטיף'])} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {drawer && <WeekTabs week={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function StatusBadge({ v }) {
  if (!v) return <span className="badge badge-warn">לא זמין</span>;
  const ok = ['תקין', 'פעיל', 'אין', 'עבר', '✓'].some((k) => String(v).includes(k));
  return <span className={`badge ${ok ? 'badge-ok' : 'badge-error'}`}>{v}</span>;
}

// ============================================================
// כרטיס שבוע — טאבים
// ============================================================
function WeekTabs({ week, onClose }) {
  useEscapeClose(onClose); // סגירה במקש Escape
  const [tab, setTab] = useState('סקירה');
  const code = week['קוד שבוע'];
  const num = (v) => Number(v) || 0;
  const neto = num(week['סכום נטוRollup (from חשבוניות)']);
  const bruto = num(week['סכום ברוטו Rollup (from חשבוניות)']);
  const weight = num(week['משקל Rollup (from חשבוניות)']);

  // פרסור נקי
  const days = useMemo(() => parseDays(week['JSON לפי ימים מאוחד']), [week]);
  const incomeByStruct = useMemo(() => parseStructIncome(week['JSON הכנסה לפי מבנים']), [week]);
  const cartonsByStruct = useMemo(() => parseMapList(week['JSON סיכום קטיף לפי מבנים'], ['קרטונים', 'cartons']), [week]);
  const yieldDays = useMemo(() => parseDaily(week['JSON קג בפועל לפי ימים ומבנים']).days, [week]);

  const sumCartons = Math.round(num(week['קרטונים']) || days.reduce((s, d) => s + num(d.cartons), 0));

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer stru-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>שבוע {code}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>

        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', sticky: 'sticky', position: 'sticky', top: 0, background: '#fff', zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'active' : ''}`} style={{ fontSize: 12, padding: '6px 10px' }}>{t}</button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'סקירה' && <OverviewTab bruto={bruto} neto={neto} weight={weight} cartons={sumCartons} week={week} />}
          {tab === 'לפי ימים' && <DaysTab days={days} />}
          {tab === 'זנים' && <VarietiesTab week={week} />}
          {tab === 'מבנים' && <StructIncomeTab income={incomeByStruct} cartons={cartonsByStruct} />}
          {tab === 'ק"ג בפועל' && <YieldTab yieldDays={yieldDays} />}
          {tab === 'התאמות' && <MatchTab week={week} />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ bruto, neto, weight, cartons, week }) {
  const pallets = Math.round(Number(week['משטחים']) || 0);
  const kpis = [
    { l: 'פדיון ברוטו', v: formatMoney(bruto), c: 'var(--revenue)' },
    { l: 'פדיון נטו', v: formatMoney(neto), c: 'var(--profit)' },
    { l: 'משקל', v: `${formatNumber(weight)} ק"ג`, c: 'var(--weight)' },
    { l: 'קרטונים', v: formatNumber(cartons), c: 'var(--cartons)' },
    { l: 'משטחים', v: formatNumber(pallets), c: 'var(--pallets)' },
  ];
  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        {kpis.map((k) => (
          <div key={k.l} className="kpi-card" style={{ padding: '14px 14px 0' }}>
            <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{k.l}</span></div>
            <div className="kpi-value" style={{ fontSize: 17, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>סיכום</div>
        <Row l="סטטוס מסמכים" v={<StatusBadge v={week['סטטוס התאמה']} />} />
        <Row l="הערות התאמה" v={week['רשימת הערות התאמה'] ? arrToStr(week['רשימת הערות התאמה']) : '—'} />
        <Row l="סטטוס קטיף" v={<StatusBadge v={week['סטטוס התאמת קטיף']} />} />
      </div>
    </div>
  );
}

function DaysTab({ days }) {
  if (!days.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  const chart = days.map((d) => ({ label: shortDate(d.date), קרטונים: num(d.cartons), משקל: Math.round(num(d.weight)), פדיון: Math.round(num(d.value)) }));
  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>תאריך</th><th>קרטונים</th><th>משקל</th><th>פדיון</th><th>משטחים</th></tr></thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={i}>
                  <td>{formatDate(d.date)}</td>
                  <td>{formatNumber(d.cartons)}</td>
                  <td>{formatNumber(d.weight)}</td>
                  <td>{formatMoney(d.value)}</td>
                  <td>{formatNumber(d.pallets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>פדיון לפי יום</div>
        <div style={{ direction: 'ltr' }}>
          <ResponsiveContainer width="100%" height={200}>
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
    </div>
  );
}

function VarietiesTab({ week }) {
  const v = useMemo(() => {
    const daily = parseDaily(week['JSON קג בפועל לפי ימים ומבנים']);
    const byVar = {};
    (daily.varieties || []).forEach((x) => {
      const k = x.variety || x['זן'];
      byVar[k] = byVar[k] || { weight: 0, cartons: 0 };
      byVar[k].weight += num(x.delivery_weight ?? x.allocated_weight);
      byVar[k].cartons += num(x.delivery_cartons ?? x.allocated_cartons);
    });
    return Object.entries(byVar).map(([k, v]) => ({ name: k, ...v }));
  }, [week]);
  if (!v.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>זן</th><th>קרטונים</th><th>משקל</th></tr></thead>
            <tbody>
              {v.map((x, i) => (
                <tr key={i}><td>{x.name}</td><td>{formatNumber(x.cartons)}</td><td>{formatNumber(x.weight)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>ק"ג לפי זן</div>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={v} dataKey="weight" nameKey="name" innerRadius={50} outerRadius={75}>
              {v.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(val) => `${formatNumber(val)} ק"ג`} />
            <Legend wrapperStyle={LEGEND_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StructIncomeTab({ income, cartons }) {
  if (!income.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>מבנה</th><th>הכנסה נטו</th><th>חלק יחסי</th><th>קרטונים</th></tr></thead>
            <tbody>
              {income.map((r, i) => {
                const total = income.reduce((s, x) => s + num(x.value), 0);
                const c = cartons.find((x) => x.name === r.name);
                return (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{formatMoney(r.value)}</td>
                    <td>{(total ? (num(r.value) / total) * 100 : 0).toFixed(1)}%</td>
                    <td>{formatNumber(c?.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>הכנסה לפי מבנה</div>
        <div style={{ direction: 'ltr' }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={income.map((r) => ({ name: r.name, value: Math.round(num(r.value)) }))}
              layout="vertical" margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis type="number" {...xAxisProps(0)} />
              <YAxis dataKey="name" {...yCategoryProps({ width: 104 })} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
              <Bar dataKey="value" fill="#2878D0" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function YieldTab({ yieldDays }) {
  if (!yieldDays || !yieldDays.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  const chart = yieldDays.map((d) => ({ label: shortDate(d.date), מלא: Math.round(num(d.allocated_weight)), החלטה: Math.round(num(d.allocated_cartons)) }));
  const totalWeight = yieldDays.reduce((s, d) => s + num(d.allocated_weight), 0);
  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">סה"כ ק"ג בפועל</span></div><div className="kpi-value" style={{ fontSize: 18, color: 'var(--harvest)' }}>{formatNumber(totalWeight)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">ימים פעילים</span></div><div className="kpi-value" style={{ fontSize: 18 }}>{yieldDays.length}</div></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>ק"ג בפועל לפי יום</div>
        <div style={{ direction: 'ltr' }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chart} margin={CHART_MARGIN_ROTATED}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: chart.length > 7 })} />
              <YAxis {...yAxisProps()} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v)} ק"ג`} />
              <Line type="monotone" dataKey="מלא" stroke="#2E9B62" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function MatchTab({ week }) {
  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>התאמת מסמכים</div>
        <Row l="סטטוס" v={<StatusBadge v={week['סטטוס התאמה']} />} />
        <Row l="הערות" v={week['רשימת הערות התאמה'] ? arrToStr(week['רשימת הערות התאמה']) : '—'} />
      </div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>התאמת קטיף</div>
        <Row l="סטטוס" v={<StatusBadge v={week['סטטוס התאמת קטיף']} />} />
        <Row l="הערות קטיף" v={week['הערות התאמת קטיף'] || '—'} />
      </div>
      {week['שגיאת חישוב קג לפי מבנים'] && (
        <div className="badge badge-error" style={{ marginTop: 12, width: '100%' }}>⚠️ שגיאת חישוב: {week['שגיאת חישוב קג לפי מבנים']}</div>
      )}
    </div>
  );
}

// Helpers
function Row({ l, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><b>{v}</b></div>;
}
function num(v) { return Number(v) || 0; }
function arrToStr(v) {
  if (Array.isArray(v)) return v.join(', ');
  try { const p = JSON.parse(v); return Array.isArray(p) ? p.join(', ') : v; } catch { return v; }
}
function shortDate(d) { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d).slice(0, 5) : `${x.getDate()}/${x.getMonth() + 1}`; }

function parseDays(json) {
  if (!json) return [];
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    const arr = Array.isArray(p.days) ? p.days : (Array.isArray(p) ? p : []);
    return arr.map((d) => ({
      date: d.date || d['תאריך'],
      cartons: d.cartons ?? d['קרטונים'],
      weight: d.weight ?? d['משקל'],
      value: d.value ?? d['פדיון'],
      pallets: d.pallets ?? d['משטחים'],
    }));
  } catch { return []; }
}

function parseStructIncome(json) {
  if (!json) return [];
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    const arr = Array.isArray(p) ? p : (Array.isArray(p.items) ? p.items : []);
    return arr.map((x) => ({
      name: x.structure || x['מבנה'] || x.name || 'מבנה',
      value: num(x.neto ?? x['נטו'] ?? x.revenue ?? x['הכנסה'] ?? x.value),
    }));
  } catch { return []; }
}

function parseMapList(json, keys) {
  if (!json) return [];
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    const arr = Array.isArray(p) ? p : [];
    return arr.map((x) => ({
      name: x.structure || x['מבנה'] || x.name || 'מבנה',
      value: keys.reduce((s, k) => (x[k] != null ? x[k] : s), x.cartons ?? 0),
    }));
  } catch { return []; }
}

function parseDaily(json) {
  if (!json) return { days: [], varieties: [] };
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    return { days: Array.isArray(p.days) ? p.days : [], varieties: Array.isArray(p.varieties) ? p.varieties : [] };
  } catch { return { days: [], varieties: [] }; }
}
