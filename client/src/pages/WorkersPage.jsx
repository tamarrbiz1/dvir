import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatMoney, formatNumber, formatDate } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

const SHORT_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

export default function WorkersPage() {
  const app = useApp();
  const [workers, setWorkers] = useState([]);
  const [workRecords, setWorkRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    Promise.all([
      app.api.get('עובדים', '?maxRecords=200'),
      app.api.get('עבודות עובדים', '?maxRecords=2000'),
    ])
      .then(([w, wr]) => {
        setWorkers(Array.isArray(w) ? w : []);
        setWorkRecords(Array.isArray(wr) ? wr : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // סיוע: שעות וסכום
  const hoursOf = (arr) => arr.reduce((s, r) => s + (Number(r['סכום שעות'] ?? r['שעות']) || 0), 0);
  const paidOf = (arr) => arr.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);

  // עבודות עובד ספציפי
  const recordsFor = (w) => workRecords.filter((r) => {
    const ref = r['עובד'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === String(w.id));
    return String(r['עובד'] ?? '') === String(w.id);
  });

  const inMonth = (r, monthOffset) => {
    const d = new Date(r['תאריך']);
    if (Number.isNaN(d.getTime())) return false;
    const t = new Date();
    const tgt = new Date(t.getFullYear(), t.getMonth() + monthOffset, 1);
    return d.getFullYear() === tgt.getFullYear() && d.getMonth() === tgt.getMonth();
  };

  return (
    <div>
      <div className="page-header"><h2>עובדים ועבודות</h2></div>

      {loading ? (
        <div className="grid">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div className="grid">
          {workers.map((w) => {
            const name = `${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || 'עובד';
            const recs = recordsFor(w);
            const cur = recs.filter((r) => inMonth(r, 0));
            const prev = recs.filter((r) => inMonth(r, -1));
            return (
              <div key={w.id} className="card clickable" onClick={() => setDrawer(w)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--workers-soft)', color: 'var(--workers)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
                    {name[0] || '👤'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{w['סוג עובד'] ?? 'לא זמין'}</div>
                  </div>
                  <span className={`badge ${w['סטטוס'] === 'פעיל' ? 'badge-ok' : 'badge-warn'}`}>{w['סטטוס'] || 'לא זמין'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>שעות החודש: </span><b>{formatNumber(hoursOf(cur))}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>עבודות: </span><b>{cur.length}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>הרוויח החודש: </span><b style={{ color: 'var(--revenue)' }}>{formatMoney(paidOf(cur))}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>חודש קודם: </span><b style={{ color: 'var(--workers)' }}>{formatMoney(paidOf(prev))}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {drawer && <WorkerDetails worker={drawer} records={recordsFor(drawer)} onClose={() => setDrawer(null)} />}
    </div>
  );
}

// ============================================================
// כרטיס עובד מפורט — KPI + פילטר + 6 גרפים (סעיף 12)
// ============================================================
function WorkerDetails({ worker, records, onClose }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const name = `${worker['שם פרטי'] || ''} ${worker['שם משפחה'] || ''}`.trim() || 'עובד';

  // פילטרים
  const filtered = useMemo(() => records.filter((r) => {
    const d = new Date(r['תאריך']);
    if (Number.isNaN(d.getTime())) return true;
    if (from && d < new Date(from)) return false;
    if (to) { const end = new Date(to); end.setHours(23, 59, 59); if (d > end) return false; }
    return true;
  }), [records, from, to]);

  const totalHours = filtered.reduce((s, r) => s + (Number(r['סכום שעות'] ?? r['שעות']) || 0), 0);
  const totalPaid = filtered.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);
  const workDays = new Set(filtered.map((r) => (r['תאריך'] ? new Date(r['תאריך']).toDateString() : 'x'))).size;
  const avgPerDay = workDays ? totalPaid / workDays : 0;

  // KPI ראשי — יום/שבוע/חודש נוכחי
  const now = new Date();
  const dayRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d.toDateString() === now.toDateString(); });
  const monthRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const weeksStart = new Date(now); weeksStart.setDate(now.getDate() - now.getDay());
  const weekRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d >= weeksStart; });
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth(); });

  const sumField = (arr, f) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);

  // גרפים
  const lineBy = (field, grouper) => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const k = grouper(d);
      b[k] = (b[k] || 0) + (Number(r[field]) || 0);
    });
    return Object.entries(b).sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const byDays = () => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const k = `${d.getDate()}/${d.getMonth() + 1}`;
      b[k] = (b[k] || 0) + (Number(r['סכום לתשלום']) || 0);
    });
    return Object.entries(b).sort((a, b) => a[0] > b[0] ? 1 : -1).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const hourDays = () => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const k = `${d.getDate()}/${d.getMonth() + 1}`;
      b[k] = (b[k] || 0) + (Number(r['סכום שעות'] ?? r['שעות']) || 0);
    });
    return Object.entries(b).sort((a, b) => a[0] > b[0] ? 1 : -1).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const byMonth = (field) => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const k = (field === 'hours' ? d.getMonth() : d.getMonth());
      const label = SHORT_MONTHS[d.getMonth()];
      b[label] = (b[label] || 0) + (Number(r[field === 'hours' ? 'סכום שעות' : 'סכום לתשלום']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const byWorkType = (field) => {
    const b = {};
    filtered.forEach((r) => {
      const k = r['סוג עבודה (from תמחור עבודות)'] ?? 'אחר';
      b[k] = (b[k] || 0) + (Number(r[field === 'hours' ? 'סכום שעות' : 'סכום לתשלום']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: Math.round(v) }));
  };
  const byStructure = () => {
    const b = {};
    filtered.forEach((r) => {
      let nm = r['מבנה'];
      if (Array.isArray(nm)) nm = displayName(nm);
      b[nm || 'אחר'] = (b[nm || 'אחר'] || 0) + 1;
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: v }));
  };

  const incomeChart = byDays();
  const hoursChart = hourDays();
  const monthIncome = byMonth('income');
  const monthHours = byMonth('hours');
  const typeIncome = byWorkType('income');
  const typeHours = byWorkType('hours');
  const structChart = byStructure();

  const kpis = [
    { label: 'שעות היום', value: formatNumber(sumField(dayRecs, 'סכום שעות')), color: 'var(--hours)' },
    { label: 'שעות השבוע', value: formatNumber(sumField(weekRecs, 'סכום שעות')), color: 'var(--weight)' },
    { label: 'שעות החודש', value: formatNumber(sumField(monthRecs, 'סכום שעות')), color: 'var(--cartons)' },
    { label: 'הכנסה החודש', value: formatMoney(sumField(monthRecs, 'סכום לתשלום')), color: 'var(--revenue)' },
    { label: 'הכנסה חודש קודם', value: formatMoney(sumField(prevMonthRecs, 'סכום לתשלום')), color: 'var(--workers)' },
    { label: 'מספר עבודות', value: formatNumber(filtered.length), color: 'var(--pallets)' },
  ];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer worker-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>👤 {name}</span>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">

          {/* KPI */}
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {kpis.map((k) => (
              <div key={k.label} className="kpi-card" style={{ padding: '14px 14px 0' }}>
                <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{k.label}</span></div>
                <div className="kpi-value" style={{ fontSize: 18, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* פילטר טווח */}
          <div className="card" style={{ marginTop: 16, background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="form-group"><label>מתאריך</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="form-group"><label>עד תאריך</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>
              סה"כ בתקופה: {formatNumber(totalHours)} שעות · {formatMoney(totalPaid)} · {formatNumber(filtered.length)} עבודות · ממוצע ליום {formatMoney(avgPerDay)}
            </div>
          </div>

          {/* גרף 1: שעות לאורך זמן */}
          <Chart title="שעות לאורך זמן" data={hoursChart} barColor="var(--hours)" />
          {/* גרף 2: הכנסה לאורך זמן */}
          <Chart title="הכנסה לאורך זמן" data={incomeChart} barColor="var(--revenue)" money />

          {/* גרפים לפי חודש */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>הכנסה לפי חודש</div>
            <PieChartWrap data={monthIncome.map((x) => ({ name: x.label, value: x.value }))} />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>שעות לפי סוג עבודה</div>
            <PieChartWrap data={typeHours} />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>הכנסה לפי סוג עבודה</div>
            <PieChartWrap data={typeIncome} money />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>עבודות לפי מבנה</div>
            <PieChartWrap data={structChart} />
          </div>

        </div>
      </div>
    </div>
  );
}

function Chart({ title, data, barColor, money }) {
  if (!data || !data.length) return <div className="card" style={{ marginTop: 16 }}><div className="section-title" style={{ marginTop: 0 }}>{title}</div><div className="empty-state">אין נתונים לתקופה זו</div></div>;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <div style={{ direction: 'ltr' }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...xAxisProps(data.length, { rotate: true })} />
            <YAxis {...yAxisProps({ money })} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => money ? formatMoney(v) : formatNumber(v)} />
            <Bar dataKey="value" fill={barColor} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const PIE_COLORS = ['#08A878', '#2878D0', '#8B5CF6', '#F59E0B', '#F04444', '#09A7B2', '#10A66A'];
function PieChartWrap({ data, money }) {
  if (!data || !data.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        {/* השמות במקרא בלבד — תוויות על הפלחים נדרסו זו על ידי זו */}
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75}>
          {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
        </Pie>
        <Tooltip {...TOOLTIP_STYLE} formatter={(v) => money ? formatMoney(v) : formatNumber(v)} />
        <Legend wrapperStyle={LEGEND_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}
