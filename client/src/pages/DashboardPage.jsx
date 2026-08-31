import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatMoney, formatNumber } from '../utils/format.js';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid
} from 'recharts';
import {
  CHART_MARGIN, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps,
} from '../utils/chart.js';

export default function DashboardPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [i, e, s] = await Promise.all([
          app.api.get('חשבוניות', '?maxRecords=200&raw=1'),
          app.api.get('הוצאות', '?maxRecords=200'),
          app.api.get('מבנים', '?maxRecords=200'),
        ]);
        setInvoices(Array.isArray(i) ? i : []);
        setExpenses(Array.isArray(e) ? e : []);
        setStructures(Array.isArray(s) ? s : []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [app.api]);

  // ============================================================
  // פדיון / משקל אמיתיים מתוך טבלת החשבוניות
  // (הנתונים האמיתיים נמצאים בחשבוניות עצמן, לא ברול־אפ של
  //  סיכום שבועי — שגם כך לרוב אינו מאוכלס)
  // ============================================================
  // חילוץ תאריך מחשבונית: שדה "תאריך-AI" ואם חסר — מה"סיכום יומי"
  const invoiceDate = (inv) => {
    if (inv['תאריך-AI']) return inv['תאריך-AI'];
    const sj = inv['סיכום יומי'];
    if (typeof sj === 'string') {
      try {
        const parsed = JSON.parse(sj);
        const firstDay = parsed?.days?.[0]?.date;
        if (firstDay) return firstDay;
      } catch {}
    }
    return null;
  };

  // סכום ברוטו/נטו/משקל של חשבונית — מנרמל מספרים שיורדים כמחרוזות
  const invNum = (inv, field) => Number(inv[field]) || 0;

  // פדיון נטו לפי חודש (YYYY-MM)
  const netByMonth = {};
  invoices.forEach((inv) => {
    const date = invoiceDate(inv);
    if (!date) return;
    const mon = String(date).slice(0, 7);
    netByMonth[mon] = (netByMonth[mon] || 0) + invNum(inv, 'סכום נטו');
  });
  const revenueData = Object.entries(netByMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ month: k, 'פדיון נטו': Math.round(v) }));

  // ============================================================
  // שנים זמינות מתוך תאריכי החשבוניות
  // ============================================================
  const yearsAvailable = [...new Set(
    invoices.map(invoiceDate).filter(Boolean).map((d) => String(d).slice(0, 4)),
  )].sort();
  const selectedYear = year || (yearsAvailable.length ? yearsAvailable[yearsAvailable.length - 1] : String(new Date().getFullYear()));

  // סינון חשבוניות לפי שנה נבחר (לפדיון)
  const filteredInvoices = !selectedYear || selectedYear === 'הכל'
    ? invoices
    : invoices.filter((inv) => String(invoiceDate(inv) || '').slice(0, 4) === selectedYear);
  const fNet = filteredInvoices.reduce((s, inv) => s + invNum(inv, 'סכום נטו'), 0);
  const fBruto = filteredInvoices.reduce((s, inv) => s + invNum(inv, 'סכום ברוטו'), 0);
  const fWeight = filteredInvoices.reduce((s, inv) => s + invNum(inv, 'משקל'), 0);

  if (loading) {
    return (
      <div>
        <h1>לוח בקרה</h1>
        <div className="kpi-grid">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
        <div className="skeleton skeleton-chart" style={{ marginTop: 18 }} />
      </div>
    );
  }

  // KPI חישובים — מתוך החשבוניות המסוננות לפי שנה
  const sumBruto = fBruto;
  const sumNeto = fNet;
  const sumWeight = fWeight;
  const sumExpenses = expenses.reduce((s, e) => s + (Number(e['סכום כולל-AI']) || 0), 0);
  const profit = sumNeto - sumExpenses;
  const activeStructures = structures.filter((s) => String(s['סטטוס המבנה'] || '').startsWith('חלקה שתולה')).length;

  // נתוני עוגה: הוצאות לפי קטגוריה
  const expenseByCat = {};
  expenses.forEach((e) => {
    const cat = e['קטגוריית חשבונית-AI'] || 'אחר';
    expenseByCat[cat] = (expenseByCat[cat] || 0) + (Number(e['סכום כולל-AI']) || 0);
  });
  const donutData = Object.entries(expenseByCat).map(([k, v]) => ({ name: k, value: Math.round(v) }));

  return (
    <div>
      <div className="topbar">
        <h1>לוח בקרה</h1>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <select className="select" value={selectedYear} onChange={(e) => setYear(e.target.value)}>
            {['הכל', ...yearsAvailable].map((y) => (
              <option key={y} value={y}>{y === 'הכל' ? 'כל השנים' : y}</option>
            ))}
          </select>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {filteredInvoices.length} חשבוניות
          </span>
        </div>
      </div>

      {/* ===== שורה 1 — KPI ===== */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💰</div>
            <span className="kpi-label">פדיון ברוטו</span>
          </div>
          <div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(sumBruto)}</div>
          <div className="kpi-sub">{selectedYear === 'הכל' ? 'כל הזמנים' : selectedYear}</div>
          <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#08A878,#16BE8B)' }}>דוח הכנסות</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💸</div>
            <span className="kpi-label">פדיון נטו</span>
          </div>
          <div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(sumNeto)}</div>
          <div className="kpi-sub">לכל התקופה</div>
          <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#27C99A,#08A878)' }}>דוח הכנסות נטו</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon" style={{ background: 'var(--expense-soft)' }}>🧾</div>
            <span className="kpi-label">הוצאות</span>
          </div>
          <div className="kpi-value" style={{ color: 'var(--expense)' }}>{formatMoney(sumExpenses)}</div>
          <div className="kpi-sub">{expenses.length} חשבוניות</div>
          <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#EF4444,#FF625F)' }}>דוח הוצאות</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon" style={{ background: 'var(--profit-soft)' }}>📈</div>
            <span className="kpi-label">רווח</span>
          </div>
          <div className="kpi-value" style={{ color: 'var(--profit)' }}>{formatMoney(profit)}</div>
          <div className="kpi-sub">פדיון נטו − הוצאות</div>
          <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#10A66A,#39C889)' }}>רווח כולל</div>
        </div>

        <div className="kpi-card highlight">
          <div className="kpi-top">
            <div className="kpi-icon" style={{ background: 'var(--weight-soft)' }}>⚖️</div>
            <span className="kpi-label">ק"ג בפועל</span>
          </div>
          <div className="kpi-value" style={{ color: 'var(--weight)' }}>{formatNumber(sumWeight)}</div>
          <div className="kpi-sub">ק"ג סה"כ</div>
          <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#2878D0,#3D91E8)' }}>ק"ג לאורך זמן</div>
        </div>
      </div>

      {/* ===== שורה 2 — גרפים ===== */}
      <div className="grid-2" style={{ marginTop: 22 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הכנסות לאורך זמן</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={revenueData} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#08A878" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#08A878" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" {...xAxisProps(revenueData.length)} />
                <YAxis {...yAxisProps({ money: true })} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [formatMoney(v), n]} />
                <Area type="monotone" dataKey="פדיון נטו" stroke="#08A878" strokeWidth={3} fill="url(#gRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי קטגוריה</div>
          {donutData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                {/* השמות מוצגים במקרא ולא כתוויות על הפלחים — תוויות נדרסו זו על ידי זו */}
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={['#F04444', '#F79009', '#09A7B2', '#8B5CF6', '#2878D0', '#7C4DFF'][i % 6]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [formatMoney(v), n]} />
                <Legend wrapperStyle={LEGEND_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">
              <div className="icon">📊</div>
              אין נתוני הוצאות לתקופה זו
            </div>
          )}
        </div>
      </div>

      {/* ===== מבנים פעילים ===== */}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="section-title" style={{ marginTop: 0 }}>מבנים</div>
        <div style={{ color: 'var(--text-secondary)' }}>
          {activeStructures} מבנים פעילים מתוך {structures.length} סה"כ
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {structures.slice(0, 12).map((s) => (
            <span
              key={s.id}
              className="badge"
              role="button"
              tabIndex={0}
              title="פתיחת פרטי המבנה"
              onClick={() => navigate('/structures', { state: { openStructure: s } })}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate('/structures', { state: { openStructure: s } }); }}
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', padding: '8px 14px', cursor: 'pointer' }}
            >
              🏗️ {s['מספר מבנה'] || 'מבנה'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
