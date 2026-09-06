// ============================================================
// לוח בקרה — Dashboard ראשי של בעל העסק
// ------------------------------------------------------------
// לפי האיפיון: פילטר תקופה מרכזי (היום/השבוע/החודש/חודש קודם/
// השנה/טווח מותאם), שורות KPI (כספים · תפוקה · עובדים · בקרה),
// גרפים עם Drill-down, פעולות מהירות.
//
// מקורות הנתונים (אומת 2026-09, ר' גם FinancePage/WeeklySummaryPage):
// - כספים (פדיון ברוטו/נטו, רווח): שדות "סכום ברוטו"/"סכום נטו" ישירות
//   מטבלת "חשבוניות" (kGross/kNet) — לא הערכה, הסכום שבאמת נגבה.
//   "הוצאות": "סכום כולל-AI" מטבלת הוצאות. רווח = נטו − הוצאות.
// - תפוקה (ק"ג/קרטונים/משטחים): "JSON לפי ימים מאוחד" ב"סיכום שבועי" —
//   זה המקור היחיד לפירוט יומי; אין לו חלופה ישירה יותר.
// - עובדים (עלות/שעות): "סכום לתשלום"/שעות מטבלת "עבודות עובדים" עצמה.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatMoney, formatNumber, formatDate, yearProgressLabel } from '../utils/format.js';
import { useAutoRefresh } from '../utils/live.js';
import { expenseCategory , workHours } from '../utils/field.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts';
import {
  CHART_MARGIN, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps,
} from '../utils/chart.js';

const PRESETS = [
  { key: 'today', label: 'היום' },
  { key: 'week', label: 'השבוע' },
  { key: 'month', label: 'החודש' },
  { key: 'prevMonth', label: 'חודש קודם' },
  { key: 'year', label: 'השנה' },
  { key: 'all', label: 'הכל' },
  { key: 'custom', label: 'טווח מותאם' },
];

// תחום תאריכים [start, end] לפי הבחירה; null = ללא סינון
function periodRange(preset, from, to) {
  const now = new Date();
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  if (preset === 'today') return [day0(now), end0(now)];
  if (preset === 'week') {
    // שבוע עסקי: שבת עד חמישי (לפי האיפיון)
    const s = day0(now);
    const back = (s.getDay() + 1) % 7; // שבת=6 → 0 ימים אחורה
    s.setDate(s.getDate() - back);
    const e = new Date(s); e.setDate(s.getDate() + 5); e.setHours(23, 59, 59);
    return [s, e];
  }
  if (preset === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end0(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (preset === 'prevMonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), end0(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (preset === 'year') return [new Date(now.getFullYear(), 0, 1), end0(new Date(now.getFullYear(), 11, 31))];
  if (preset === 'custom') {
    const s = from ? new Date(`${from}T00:00:00`) : null;
    const e = to ? new Date(`${to}T23:59:59`) : null;
    return (s || e) ? [s || new Date(2000, 0, 1), e || new Date(2100, 0, 1)] : null;
  }
  return null;
}

const parseAny = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};
const num = (v) => (Number(v) || 0);

export default function DashboardPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState({ invoices: [], expenses: [], structures: [], weeks: [], works: [] });
  const [loading, setLoading] = useState(true);
  // "עבודות עובדים" (עד 3000 רשומות, עם קישורים לעובדים/מבנים/תמחור)
  // נמדדה כפי רחוק הכי כבדה מבין קריאות לוח הבקרה — עד 1.3 שניות
  // בקאש קר. נטענת בנפרד כדי שלא תחסום את שאר המסך: שורות ה-KPI
  // הראשונות (כספים/תפוקה) והבקרה מוצגות מיד, ורק שורת "עובדים" +
  // גרף העלות לפי עובד ממתינים לה בנפרד.
  const [loadingWorks, setLoadingWorks] = useState(true);
  const [preset, setPreset] = useState('year');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loadFast = useCallback(async () => {
    const enc = encodeURIComponent;
    const weekFields = [
      'קוד שבוע', 'תאריך התחלה', 'תאריך סיום', 'סטטוס התאמה', 'סטטוס התאמת קטיף',
      'שגיאת חישוב קג לפי מבנים', 'JSON לפי ימים מאוחד', 'JSON הכנסה לפי מבנים',
    ].map(enc).join(',');
    const arr = (v) => (Array.isArray(v) ? v : []);
    try {
      const [i, e, s, wk] = await Promise.all([
        app.api.get('חשבוניות', '?maxRecords=1000&raw=1'),
        app.api.get('הוצאות', '?maxRecords=1000'),
        app.api.get('מבנים', '?maxRecords=200'),
        app.api.get('סיכום שבועי', `?maxRecords=300&raw=1&fields=${weekFields}`).catch(() => []),
      ]);
      setData((cur) => ({ ...cur, invoices: arr(i), expenses: arr(e), structures: arr(s), weeks: arr(wk) }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [app.api]);

  const loadWorks = useCallback(async () => {
    try {
      const w = await app.api.get('עבודות עובדים', '?maxRecords=3000');
      setData((cur) => ({ ...cur, works: Array.isArray(w) ? w : [] }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingWorks(false);
    }
  }, [app.api]);

  useEffect(() => { loadFast(); loadWorks(); }, [loadFast, loadWorks]);
  useAutoRefresh(loadFast);
  useAutoRefresh(loadWorks);

  const range = useMemo(() => periodRange(preset, from, to), [preset, from, to]);
  const inRange = (dateStr) => {
    if (!range) return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    return d >= range[0] && d <= range[1];
  };

  // תאריך חשבונית: "תאריך-AI", ואם חסר — היום הראשון ב"סיכום יומי"
  const invoiceDate = (inv) => {
    if (inv['תאריך-AI']) return inv['תאריך-AI'];
    const parsed = parseAny(inv['סיכום יומי']);
    return parsed?.days?.[0]?.date || null;
  };
  const expenseDate = (e) => e['תאריך חשבונית-AI'] || e['תאריך העלאת החשבונית'] || null;

  // ============ סינון לפי התקופה ============
  const fInvoices = useMemo(() => data.invoices.filter((i) => inRange(invoiceDate(i))), [data.invoices, range]);
  const fExpenses = useMemo(() => data.expenses.filter((e) => inRange(expenseDate(e))), [data.expenses, range]);
  const fWorks = useMemo(() => data.works.filter((r) => inRange(r['תאריך'])), [data.works, range]);

  // ימי תפוקה מתוך "JSON לפי ימים מאוחד" של כל השבועות
  const productionDays = useMemo(() => {
    const out = [];
    data.weeks.forEach((w) => {
      const daily = parseAny(w['JSON לפי ימים מאוחד']);
      (Array.isArray(daily?.days) ? daily.days : []).forEach((d) => {
        if (d?.date) out.push({ date: d.date, weight: num(d.weight), cartons: num(d.cartons), pallets: num(d.pallets) });
      });
    });
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [data.weeks]);
  const fDays = useMemo(() => productionDays.filter((d) => inRange(d.date)), [productionDays, range]);

  // ============ KPI ============
  const invNum = (inv, field) => num(inv[field]);
  const kGross = fInvoices.reduce((s, i) => s + invNum(i, 'סכום ברוטו'), 0);
  const kNet = fInvoices.reduce((s, i) => s + invNum(i, 'סכום נטו'), 0);
  const kExpenses = fExpenses.reduce((s, e) => s + num(e['סכום כולל-AI']), 0);
  const kProfit = kNet - kExpenses;
  const kWeight = fDays.reduce((s, d) => s + d.weight, 0);
  const kCartons = fDays.reduce((s, d) => s + d.cartons, 0);
  const kPallets = fDays.reduce((s, d) => s + d.pallets, 0);
  const activeStructures = data.structures.filter((s) => String(s['סטטוס המבנה'] || '').startsWith('חלקה שתולה')).length;
  const kLabor = fWorks.reduce((s, r) => s + num(r['סכום לתשלום']), 0);
  const kHours = fWorks.reduce((s, r) => s + workHours(r), 0);
  const kActiveWorkers = new Set(fWorks.map((r) => {
    const ref = r['עובד'];
    return Array.isArray(ref) ? (ref[0]?.id ?? ref[0]) : ref;
  }).filter(Boolean)).size;

  // שעות עבודה ועלות עובדים — תמיד שבוע/חודש/שנה נוכחיים, בלתי-תלוי
  // בבורר התקופה העליון (סעיף 2026-09-06: 3 נתונים קבועים במשבצת)
  const weekWorkRange = periodRange('week');
  const monthWorkRange = periodRange('month');
  const yearWorkRange = periodRange('year');
  const worksIn = (r) => {
    const d = new Date(r['תאריך']);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const laborIn = (r) => num(r['סכום לתשלום']);
  const hoursIn = (r) => workHours(r);
  const sumIf = (fn, rng) => data.works.reduce((s, r) => { const d = worksIn(r); return (d && d >= rng[0] && d <= rng[1]) ? s + fn(r) : s; }, 0);
  const laborWeek = sumIf(laborIn, weekWorkRange);
  const laborMonth = sumIf(laborIn, monthWorkRange);
  const laborYear = sumIf(laborIn, yearWorkRange);
  const hoursWeek = sumIf(hoursIn, weekWorkRange);
  const hoursMonth = sumIf(hoursIn, monthWorkRange);
  const hoursYear = sumIf(hoursIn, yearWorkRange);

  // ============ נתוני גרפים ============
  // הכנסות/הוצאות לפי חודש
  const monthly = useMemo(() => {
    const m = {};
    fInvoices.forEach((inv) => {
      const d = invoiceDate(inv);
      if (!d) return;
      const k = String(d).slice(0, 7);
      m[k] = m[k] || { month: k, הכנסות: 0, הוצאות: 0 };
      m[k].הכנסות += invNum(inv, 'סכום נטו');
    });
    fExpenses.forEach((e) => {
      const d = expenseDate(e);
      if (!d) return;
      const k = String(d).slice(0, 7);
      m[k] = m[k] || { month: k, הכנסות: 0, הוצאות: 0 };
      m[k].הוצאות += num(e['סכום כולל-AI']);
    });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({
        ...r,
        // תווית קריאה: "8/2026" במקום מחרוזת המפתח הטכנית
        month: `${Number(r.month.slice(5, 7))}/${r.month.slice(0, 4)}`,
        הכנסות: Math.round(r.הכנסות),
        הוצאות: Math.round(r.הוצאות),
      }));
  }, [fInvoices, fExpenses]);

  // הוצאות לפי קטגוריה
  const donutData = useMemo(() => {
    const m = {};
    fExpenses.forEach((e) => {
      const cat = expenseCategory(e);
      m[cat] = (m[cat] || 0) + num(e['סכום כולל-AI']);
    });
    return Object.entries(m).map(([name, value]) => ({ name, value: Math.round(value) })).filter((x) => x.value > 0);
  }, [fExpenses]);

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

  const periodLabel = PRESETS.find((p) => p.key === preset)?.label || '';
  // כלל רוחבי: שום סכום תלוי-זמן בלי לציין טווח. ב"השנה" (ברירת המחדל)
  // מציינים גם כמה מהשנה נאסף בפועל עד כה — לא רק "השנה" כאילו שנה שלמה.
  const periodDisclosure = preset === 'year' ? yearProgressLabel() : periodLabel;
  const Kpi = ({ icon, label, value, sub, color, soft, footer, footerBg, onClick }) => (
    <div className={`kpi-card ${onClick ? 'clickable' : ''}`}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e) => { if (e.key === 'Enter') onClick(); } } : {})}>
      <div className="kpi-top"><div className="kpi-icon" style={{ background: soft }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {footer
        ? <div className="kpi-footer" style={{ background: footerBg || color }}>{footer}</div>
        : <div style={{ height: 12 }} />}
    </div>
  );

  return (
    <div>
      {/* ===== סרגל עליון: כותרת + פילטר תקופה + פעולה מהירה ===== */}
      <div className="topbar">
        <div>
          <h1>לוח בקרה</h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>תקופה: {periodLabel}</div>
        </div>
        <div className="filter-bar no-print" style={{ marginBottom: 0 }}>
          <select className="select" aria-label="בחירת תקופה" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {preset === 'custom' && (
            <>
              <label className="date-field">מתאריך<input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="date-field">עד תאריך<input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={() => navigate('/upload')} title="העלאת חשבונית / תעודת משלוח / דוח ריסוסים">
            ⬆️ העלאת מסמך
          </button>
        </div>
      </div>

      {/* ===== שורה 1 — KPI כספיים ===== */}
      <div className="kpi-grid">
        <div className="kpi-card clickable" role="button" tabIndex={0} onClick={() => navigate('/finance')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/finance'); }}>
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💰</div>
            <span className="kpi-label">{fInvoices.length ? `הכנסות ברוטו: ${formatMoney(kGross)}` : 'הכנסות ברוטו: אין נתונים'}</span></div>
          <div className="kpi-value" style={{ color: 'var(--revenue)' }}>{fInvoices.length ? formatMoney(kNet) : 'אין נתונים'}</div>
          <div className="kpi-sub">הכנסות נטו · {periodDisclosure}</div>
          <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#08A878,#16BE8B)' }}>דוח הכנסות</div>
        </div>
        <Kpi icon="🧾" label="הוצאות" value={fExpenses.length ? formatMoney(kExpenses) : 'אין נתונים'} sub={`${fExpenses.length} חשבוניות הוצאה · ${periodDisclosure}`}
          color="var(--expense)" soft="var(--expense-soft)" footer="דוח הוצאות" footerBg="linear-gradient(135deg,#EF4444,#FF625F)" onClick={() => navigate('/finance?tab=expenses')} />
        <Kpi icon="📈" label="רווח" value={(fInvoices.length || fExpenses.length) ? formatMoney(kProfit) : 'אין נתונים'} sub={`פדיון נטו − הוצאות · ${periodDisclosure}`}
          color="var(--profit)" soft="var(--profit-soft)" footer="סקירה כספית" footerBg="linear-gradient(135deg,#10A66A,#39C889)" onClick={() => navigate('/finance')} />
      </div>

      {/* ===== שורה 2 — תפוקה ===== */}
      <div className="kpi-grid" style={{ marginTop: 14 }}>
        <Kpi icon="⚖️" label={'ק"ג בפועל'} value={fDays.length ? formatNumber(Math.round(kWeight)) : 'אין נתונים'} sub={periodDisclosure}
          color="var(--weight)" soft="var(--weight-soft)" onClick={() => navigate('/weekly')} />
        <Kpi icon="📦" label="קרטונים" value={fDays.length ? formatNumber(kCartons) : 'אין נתונים'} sub={periodDisclosure}
          color="var(--cartons)" soft="var(--cartons-soft)" onClick={() => navigate('/weekly')} />
        <Kpi icon="🛒" label="משטחים" value={fDays.length ? formatNumber(kPallets) : 'אין נתונים'} sub={periodDisclosure}
          color="var(--pallets)" soft="var(--pallets-soft)" onClick={() => navigate('/weekly')} />
        <Kpi icon="🏗️" label="מבנים פעילים" value={formatNumber(activeStructures)} sub={`מתוך ${data.structures.length} · כרגע`}
          color="var(--harvest)" soft="var(--harvest-soft)" onClick={() => navigate('/structures')} />
      </div>

      {/* ===== שורה 3 — עובדים (נטענת בנפרד — הטבלה הכבדה ביותר) ===== */}
      {/* עלות עובדים ושעות עבודה: תמיד שבוע/חודש/שנה — קבוע, לא תלוי בבורר התקופה */}
      {loadingWorks ? (
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          {[1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          <div className="kpi-card clickable" role="button" tabIndex={0} onClick={() => navigate('/crew')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/crew'); }}>
            <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--workers-soft)' }}>👷</div><span className="kpi-label">עלות עובדים</span></div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>השבוע</div><b style={{ color: 'var(--workers)' }}>{formatMoney(laborWeek)}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>החודש</div><b style={{ color: 'var(--workers)' }}>{formatMoney(laborMonth)}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{yearProgressLabel()}</div><b style={{ color: 'var(--workers)' }}>{formatMoney(laborYear)}</b></div>
            </div>
            <div className="kpi-footer" style={{ background: 'linear-gradient(135deg,#7548ED,#9259F4)' }}>דוח עובדים</div>
          </div>
          <div className="kpi-card clickable" role="button" tabIndex={0} onClick={() => navigate('/workers?tab=jobs')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/workers?tab=jobs'); }}>
            <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--hours-soft)' }}>⏱️</div><span className="kpi-label">שעות עבודה</span></div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>השבוע</div><b style={{ color: 'var(--hours)' }}>{formatNumber(Math.round(hoursWeek * 10) / 10)}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>החודש</div><b style={{ color: 'var(--hours)' }}>{formatNumber(Math.round(hoursMonth * 10) / 10)}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{yearProgressLabel()}</div><b style={{ color: 'var(--hours)' }}>{formatNumber(Math.round(hoursYear * 10) / 10)}</b></div>
            </div>
            <div style={{ height: 12 }} />
          </div>
          <Kpi icon="👥" label="עובדים פעילים" value={formatNumber(kActiveWorkers)} sub={periodDisclosure}
            color="var(--workers)" soft="var(--workers-soft)" onClick={() => navigate('/workers')} />
        </div>
      )}

      {/* ===== בקרת מסמכים — מתוך "סיכום שבועי" ===== */}
      {data.weeks.length > 0 && (() => {
        const has = (v, k) => String(v || '').includes(k);
        const missingDocs = data.weeks.filter((w) => has(w['סטטוס התאמה'], 'חסר')).length;
        const mismatches = data.weeks.filter((w) => has(w['סטטוס התאמה'], 'אי התאמה') || has(w['סטטוס התאמת קטיף'], 'אי התאמה')).length;
        const calcErrors = data.weeks.filter((w) => String(w['שגיאת חישוב קג לפי מבנים'] || '').trim()).length;
        const active = missingDocs + mismatches + calcErrors;
        const cards = [
          { label: 'התראות פעילות', value: active, icon: '🔔', to: '/alerts', color: active ? 'var(--error)' : 'var(--ok)', bg: 'var(--error-soft)' },
          { label: 'חסרים מסמכים', value: missingDocs, icon: '📂', to: '/weekly', color: missingDocs ? 'var(--warning)' : 'var(--ok)', bg: 'var(--warning-soft)' },
          { label: 'אי התאמות', value: mismatches, icon: '⚖️', to: '/alerts', color: mismatches ? 'var(--warning)' : 'var(--ok)', bg: 'var(--warning-soft)' },
          { label: 'שגיאות חישוב', value: calcErrors, icon: '🧮', to: '/alerts', color: calcErrors ? 'var(--error)' : 'var(--ok)', bg: 'var(--error-soft)' },
        ];
        return (
          <div className="kpi-grid" style={{ marginTop: 14 }}>
            {cards.map((c) => (
              <div key={c.label} className="kpi-card clickable" role="button" tabIndex={0} style={{ padding: '14px 16px' }}
                onClick={() => navigate(c.to)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(c.to); }} title="פתיחת המסך המתאים">
                <div className="kpi-top"><div className="kpi-icon" style={{ background: c.bg }}>{c.icon}</div><span className="kpi-label">{c.label}</span></div>
                <div className="kpi-value" style={{ color: c.color, fontSize: 24 }}>{formatNumber(c.value)}</div>
                <div className="kpi-sub">שבועות · מתוך {data.weeks.length}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ===== גרף Hero: הכנסות מול הוצאות + עוגת הוצאות ===== */}
      <div className="grid-2" style={{ marginTop: 22 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הכנסות מול הוצאות</div>
          {monthly.length ? (
            <div style={{ direction: 'ltr' }}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthly} margin={CHART_MARGIN}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...xAxisProps(monthly.length)} />
                  <YAxis {...yAxisProps({ money: true })} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [formatMoney(v), n]} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="הכנסות" fill="#08A878" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="הוצאות" fill="#F04444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-state"><div className="icon">📊</div>אין נתונים לתקופה זו</div>}
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי קטגוריה</div>
          {donutData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2}>
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={['#F04444', '#F79009', '#09A7B2', '#8B5CF6', '#2878D0', '#7C4DFF'][i % 6]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [formatMoney(v), n]} />
                <Legend wrapperStyle={LEGEND_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="empty-state"><div className="icon">📊</div>אין נתוני הוצאות לתקופה זו</div>}
        </div>
      </div>

      {/* ===== פעולות מהירות ===== */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title" style={{ marginTop: 0 }}>פעולות מהירות</div>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/upload')}>⬆️ העלאת מסמך</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/workers?tab=jobs&new=1')}>👷 עבודה חדשה</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/spraying?new=1')}>🧴 ריסוס חדש</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/planting')}>🌱 תוכנית שתילה חדשה</button>
        </div>
      </div>
    </div>
  );
}
