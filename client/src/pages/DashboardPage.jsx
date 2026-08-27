import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatMoney, formatNumber, formatWeight, formatDate } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar, CartesianGrid
} from 'recharts';
import {
  CHART_MARGIN, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps,
} from '../utils/chart.js';

export default function DashboardPage() {
  const app = useApp();
  const [weekly, setWeekly] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [w, e, s] = await Promise.all([
          app.api.get('סיכום שבועי', '?maxRecords=200'),
          app.api.get('הוצאות', '?maxRecords=200'),
          app.api.get('מבנים', '?maxRecords=200'),
        ]);
        setWeekly(Array.isArray(w) ? w : []);
        setExpenses(Array.isArray(e) ? e : []);
        setStructures(Array.isArray(s) ? s : []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // בחר רק רשומות עם קוד שבוע תקין בפורמט YYYYMMDD-YYYYMMDD
  // (רשומות עם קוד שבור/כפול נפסלות לפי כללי אמינות הנתונים)
  const validWeeks = weekly.filter((w) => {
    const code = String(w['קוד שבוע'] || '');
    return /^\d{8}-\d{8}$/.test(code);
  });

  // חישוב השנים מתוך הרשומות התקינות בלבד
  const yearsAvailable = [...new Set(validWeeks.map((w) => String(w['קוד שבוע']).slice(0, 4)))].sort();
  const selectedYear = year || (yearsAvailable.length ? yearsAvailable[yearsAvailable.length - 1] : String(new Date().getFullYear()));

  // סינון לפי שנה — חישוב ישיר ללא useEffect (מונע לולאת אינסוף)
  const filtered = !selectedYear || selectedYear === 'הכל'
    ? validWeeks
    : validWeeks.filter((w) => String(w['קוד שבוע']).slice(0, 4) === selectedYear);

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

  // KPI חישובים — מתוך רשומות מסונן (תקין + שנה נבחרת)
  const sumBruto = filtered.reduce((s, w) => s + (Number(w['סכום ברוטו Rollup (from חשבוניות)']) || 0), 0);
  const sumNeto = filtered.reduce((s, w) => s + (Number(w['סכום נטוRollup (from חשבוניות)']) || 0), 0);
  const sumWeight = filtered.reduce((s, w) => s + (Number(w['משקל Rollup (from חשבוניות)']) || 0), 0);
  const sumExpenses = expenses.reduce((s, e) => s + (Number(e['סכום כולל-AI']) || 0), 0);
  const profit = sumNeto - sumExpenses;
  const activeStructures = structures.filter((s) => s['סטטוס המבנה'] === 'פעיל').length;

  // נתונים לגרף: פדיון לאורך זמן לפי חודש (לפי קוד שבוע)
  const revenueByMonth = {};
  filtered.forEach((w) => {
    const code = String(w['קוד שבוע'] || '');
    const month = code.slice(4, 6); // MM
    const key = month ? `${code.slice(0, 4)}-${month}` : 'לא ידוע';
    const amt = Number(w['סכום נטוRollup (from חשבוניות)']) || 0;
    revenueByMonth[key] = (revenueByMonth[key] || 0) + amt;
  });
  const revenueData = Object.entries(revenueByMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ month: k, net: Math.round(v) }));

  // נתוני עוגה: הוצאות לפי קטגוריה
  const expenseByCat = {};
  expenses.forEach((e) => {
    const cat = e['קטגוריית חשבונית-AI'] || 'אחר';
    expenseByCat[cat] = (expenseByCat[cat] || 0) + (Number(e['סכום כולל-AI']) || 0);
  });
  const donutData = Object.entries(expenseByCat).map(([k, v]) => ({ name: k, value: Math.round(v) }));

  const CAT_COLORS = {
    'פדיון': '#08A878',
    'הוצאות': '#F04444',
    'רווח': '#10A66A',
  };

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
            {filtered.length} שבועות
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
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                <Area type="monotone" dataKey="net" stroke="#08A878" strokeWidth={3} fill="url(#gRev)" />
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
            <span key={s.id} className="badge" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', padding: '8px 14px' }}>
              🏗️ {s['מספר מבנה'] || 'מבנה'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
