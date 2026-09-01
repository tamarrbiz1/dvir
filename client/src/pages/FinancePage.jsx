import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatMoney, formatNumber, formatDate } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { CHART_MARGIN, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';
import ChecksTab from '../components/ChecksTab.jsx';
import ExpensesTab from '../components/ExpensesTab.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';

const MARKETER_FORM_FIELDS = [
  { name: 'שם משווק', label: 'שם משווק', type: 'text', required: true },
  { name: 'איש קשר', label: 'איש קשר', type: 'text' },
  { name: 'טלפון', label: 'טלפון', type: 'text' },
  { name: 'אימייל', label: 'אימייל', type: 'text' },
  { name: 'כתובת', label: 'כתובת', type: 'text' },
  { name: 'תנאי תשלום', label: 'תנאי תשלום', type: 'select' },
  { name: 'הערות', label: 'הערות', type: 'textarea' },
];
import { CHECKS_TABLE } from '../utils/checks.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DELIVERY_TABLE, notesOfMarketer } from '../utils/deliveryNotes.js';

const TABS = ['סקירה', 'הוצאות', "צ'קים", 'משווקים'];
// מפתחות ל-URL (?tab=) — כדי שקישור/חזרה יפתחו את הטאב הנכון
const TAB_KEYS = { overview: 'סקירה', expenses: 'הוצאות', checks: "צ'קים", marketers: 'משווקים' };
const keyOfTab = (name) => Object.keys(TAB_KEYS).find((k) => TAB_KEYS[k] === name) || 'overview';

export default function FinancePage() {
  const app = useApp();
  const [weekly, setWeekly] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [marketers, setMarketers] = useState([]);
  const [checks, setChecks] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [deliveries, setDeliveries] = useState([]); // תעודות משלוח — לכרטיס המשווק (סעיף 27)
  const [suppliers, setSuppliers] = useState([]); // ל"קשר לספק" בטאב ההוצאות
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTabState] = useState(() => TAB_KEYS[searchParams.get('tab')] || 'סקירה');
  const setTab = (name) => {
    setTabState(name);
    const next = new URLSearchParams(searchParams);
    next.set('tab', keyOfTab(name));
    setSearchParams(next, { replace: true });
  };

  // רענון צ'קים אחרי סימון (האיפיון: לקרוא מחדש נתונים תלויים בסיום פעולה)
  const reloadChecks = async () => {
    const c = await app.api.get(CHECKS_TABLE, '?maxRecords=300');
    setChecks(Array.isArray(c) ? c : []);
  };
  // רענון הוצאות אחרי כתיבה (קשר לספק / עריכה / מחיקה)
  const reloadExpenses = async () => {
    const e = await app.api.get('הוצאות', '?maxRecords=400');
    setExpenses(Array.isArray(e) ? e : []);
  };
  const reloadMarketers = async () => {
    const s = await app.api.get('משווקים', '?maxRecords=100');
    setMarketers(Array.isArray(s) ? s : []);
  };

  useEffect(() => {
    Promise.all([
      app.api.get('סיכום שבועי', '?maxRecords=200'),
      app.api.get('הוצאות', '?maxRecords=400'),
      app.api.get('משווקים', '?maxRecords=100'),
      app.api.get(CHECKS_TABLE, '?maxRecords=300'),
      app.api.get('חשבוניות', '?maxRecords=400'),
      app.api.get(DELIVERY_TABLE, '?maxRecords=1000').catch(() => []),
      app.api.get('ספקים', '?maxRecords=200').catch(() => []),
    ])
      .then(([w, e, s, c, inv, dn, sup]) => {
        setSuppliers(Array.isArray(sup) ? sup : []);
        setWeekly(Array.isArray(w) ? w : []);
        setExpenses(Array.isArray(e) ? e : []);
        setMarketers(Array.isArray(s) ? s : []);
        setChecks(Array.isArray(c) ? c : []);
        setInvoices(Array.isArray(inv) ? inv : []);
        setDeliveries(Array.isArray(dn) ? dn : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const bruto = weekly.reduce((s, w) => s + (Number(w['סכום ברוטו Rollup (from חשבוניות)']) || 0), 0);
  const neto = weekly.reduce((s, w) => s + (Number(w['סכום נטוRollup (from חשבוניות)']) || 0), 0);
  const expSum = expenses.reduce((s, e) => s + num(e, ['סכום כולל-AI', 'סכום', 'סכום כולל']), 0);
  const profit = neto - expSum;

  return (
    <div>
      <PageHeader icon="💰" title="כספים" />

      <div className="tabs" style={{ marginBottom: 18 }}>
        {TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : tab === 'סקירה' ? (
        <Overview weekly={weekly} expenses={expenses} bruto={bruto} neto={neto} expSum={expSum} profit={profit} />
      ) : tab === 'הוצאות' ? (
        <ExpensesTab app={app} expenses={expenses} suppliers={suppliers} onChanged={reloadExpenses} />
      ) : tab === "צ'קים" ? (
        <ChecksTab checks={checks} onRefresh={reloadChecks} />
      ) : (
        <MarketersTab marketers={marketers} invoices={invoices} deliveries={deliveries} app={app} onChanged={reloadMarketers} />
      )}
    </div>
  );
}

// ---------- סקירה ----------
function Overview({ weekly, expenses, bruto, neto, expSum, profit }) {
  const chartData = useMemo(() => {
    const rev = {};
    weekly.forEach((w) => {
      const key = String(w['קוד שבוע'] || '').slice(0, 6);
      rev[key] = (rev[key] || 0) + (Number(w['סכום נטוRollup (from חשבוניות)']) || 0);
    });
    const exp = {};
    expenses.forEach((e) => {
      const d = pick(e, ['תאריך חשבונית-AI', 'תאריך העלאת החשבונית', 'תאריך']);
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return; // הוצאה בלי תאריך תקין — לא מציירים "?"
      const key = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}`;
      exp[key] = (exp[key] || 0) + num(e, ['סכום כולל-AI', 'סכום', 'סכום כולל']);
    });
    const months = [...new Set([...Object.keys(rev), ...Object.keys(exp)])].sort();
    return months.map((m) => ({ month: m, הכנסה: Math.round(rev[m] || 0), הוצאה: Math.round(exp[m] || 0) }));
  }, [weekly, expenses]);

  const cat = {};
  expenses.forEach((e) => {
    const c = pick(e, ['קטגוריית חשבונית-AI', 'קטגוריה', 'סוג הוצאה']) || 'אחר';
    cat[c] = (cat[c] || 0) + num(e, ['סכום כולל-AI', 'סכום', 'סכום כולל']);
  });
  const donut = Object.entries(cat).map(([k, v]) => ({ name: k, value: Math.round(v) }));

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💰</div><span className="kpi-label">פדיון ברוטו</span></div><div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(bruto)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--profit-soft)' }}>💸</div><span className="kpi-label">פדיון נטו</span></div><div className="kpi-value" style={{ color: 'var(--profit)' }}>{formatMoney(neto)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--expense-soft)' }}>🧾</div><span className="kpi-label">הוצאות</span></div><div className="kpi-value" style={{ color: 'var(--expense)' }}>{formatMoney(expSum)}</div></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--profit-soft)' }}>📈</div><span className="kpi-label">רווח</span></div><div className="kpi-value" style={{ color: 'var(--profit)' }}>{formatMoney(profit)}</div></div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="section-title" style={{ marginTop: 0 }}>הכנסות מול הוצאות</div>
        <div style={{ direction: 'ltr' }}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={CHART_MARGIN}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="month" {...xAxisProps(chartData.length)} />
              <YAxis {...yAxisProps({ money: true })} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="הכנסה" fill="#08A878" radius={[4, 4, 0, 0]} />
              <Bar dataKey="הוצאה" fill="#F04444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי קטגוריה</div>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={donut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85}>
              {donut.map((_, i) => <Cell key={i} fill={['#F04444', '#F79009', '#09A7B2', '#8B5CF6', '#2878D0'][i % 5]} />)}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
            <Legend wrapperStyle={LEGEND_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// ---------- משווקים ----------
function MarketersTab({ marketers, invoices, deliveries = [], app, onChanged }) {
  const [active, setActive] = useState(null);
  const [form, setForm] = useState(null);
  const canEdit = (app?.user?.role || 'owner') === 'owner';
  const navigate = useNavigate();

  // סכום נטו של חשבונית לפי id (מתאימות למזהים שמוחזרים ב-`חשבוניות` של המשווק)
  const invById = useMemo(() => {
    const m = new Map();
    invoices.forEach((inv) => {
      if (inv?.id) m.set(inv.id, inv);
    });
    return m;
  }, [invoices]);

  const cards = useMemo(
    () =>
      marketers.map((mk) => {
        const links = Array.isArray(mk['חשבוניות']) ? mk['חשבוניות'] : [];
        const ids = links.map((l) => (typeof l === 'object' && l.id ? l.id : l));
        let revenue = 0;
        let count = 0;
        const byDate = {};
        ids.forEach((id) => {
          const inv = invById.get(id);
          const amt = Number(inv?.['סכום נטו']) || 0;
          revenue += amt;
          if (amt > 0) count++;
          const d = new Date(inv?.['תאריך']);
          if (!Number.isNaN(d.getTime())) {
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byDate[k] = (byDate[k] || 0) + amt;
          }
        });
        const trend = Object.entries(byDate)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => ({ month: k, פדיון: Math.round(v) }));
        return { mk, revenue, count, trend, invoiceCount: ids.length };
      }),
    [marketers, invById]
  );

  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-primary no-print" onClick={() => setForm({})}>+ משווק חדש</button>
        </div>
      )}
      <div className="grid">
        {cards.map(({ mk, revenue, count, trend, invoiceCount }) => (
          <div
            key={mk.id || mk['שם משווק']}
            className="card"
            onClick={() => setActive((prev) => (prev === mk.id ? null : mk.id))}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>🚚 {mk['שם משווק'] || 'משווק'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {mk['איש קשר'] && <div>איש קשר: {mk['איש קשר']}</div>}
              {mk['טלפון'] && <div>טלפון: {mk['טלפון']}</div>}
              {mk['כתובת'] && <div>{mk['כתובת']}</div>}
              {mk['תנאי תשלום'] && <div>תנאי תשלום: {mk['תנאי תשלום']}</div>}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13 }}>
              <div><span className="kpi-label">חשבוניות</span><div className="kpi-value" style={{ fontSize: 18 }}>{invoiceCount}</div></div>
              <div><span className="kpi-label">תעודות משלוח</span><div className="kpi-value" style={{ fontSize: 18, color: 'var(--docs)' }}>{notesOfMarketer(deliveries, mk.id).length}</div></div>
              <div><span className="kpi-label">פדיון בתקופה</span><div className="kpi-value" style={{ fontSize: 18, color: 'var(--revenue)' }}>{formatMoney(revenue)}</div></div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/delivery-notes?marketer=${encodeURIComponent(mk.id)}`); }}>📄 תעודות משלוח</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate('/invoices'); }}>🧾 חשבוניות</button>
              {canEdit && (
                <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 4 }}>
                  <button type="button" className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); setForm(mk); }}>✎</button>
                  <button type="button" className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await removeRecord(app.api, 'משווקים', mk.id, mk['שם משווק'] || 'המשווק')) await onChanged();
                    }}>🗑</button>
                </span>
              )}
            </div>
            {count === 0 && invoiceCount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {invoiceCount} חשבוניות ללא סכום נטו
              </div>
            )}
            {active === mk.id && (
              <div style={{ marginTop: 12 }}>
                <div className="section-title" style={{ marginTop: 0 }}>פדיון לאורך זמן</div>
                {trend.length === 0 ? (
                  <div className="empty-state" style={{ padding: '14px 0' }}>אין נתוני פדיון למשווק זה</div>
                ) : (
                  <div style={{ direction: 'ltr' }}>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={trend} margin={CHART_MARGIN}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="month" {...xAxisProps(trend.length)} />
                        <YAxis {...yAxisProps({ money: true })} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                        <Line type="monotone" dataKey="פדיון" stroke="#08A878" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {marketers.length === 0 && <div className="empty-state">אין נתונים לתקופה זו</div>}
      </div>

      {form !== null && (
        <RecordForm
          api={app.api} table="משווקים"
          title={form.id ? `עריכת ${form['שם משווק'] || 'משווק'}` : 'משווק חדש'}
          record={form.id ? form : null}
          fields={MARKETER_FORM_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); toast('המשווק נשמר בהצלחה'); }}
        />
      )}
    </div>
  );
}
