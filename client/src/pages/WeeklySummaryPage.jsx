import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useAutoRefresh } from '../utils/live.js';
import DeliveryNoteDrawer from '../components/DeliveryNoteDrawer.jsx';
import { formatNumber, formatMoney, formatDate } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import { BarChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps, yCategoryProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';
import { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';

// ============================================================
// סיכום שבועי — סעיפים 30–35 באיפיון
// ------------------------------------------------------------
// הרשימה טוענת רק שדות קלים (בלי ה-JSON הכבדים). כרטיס השבוע
// נטען טרי מ-Airtable בכל פתיחה ומתרענן בזמן שהוא פתוח, כדי
// שתוצאות Automation יופיעו בלי רענון ידני ("JSON וסיכום שבועי").
// ============================================================

const TABLE = 'סיכום שבועי';
const TABS = ['סקירה', 'לפי ימים', 'זנים', 'מבנים', 'ק"ג בפועל', 'התאמות', 'מסמכים'];
const PIE = ['#08A878', '#2878D0', '#8B5CF6', '#F59E0B', '#F04444', '#09A7B2', '#10A66A', '#6366F1'];
const REFRESH_MS = 30 * 1000;

// שמות השדות ב-Airtable (מקור אמת יחיד לקובץ הזה)
const F = {
  code: 'קוד שבוע', start: 'תאריך התחלה', end: 'תאריך סיום',
  gross: 'סכום ברוטו Rollup (from חשבוניות)', net: 'סכום נטוRollup (from חשבוניות)', weight: 'משקל Rollup (from חשבוניות)',
  docStatus: 'סטטוס התאמה', docNotes: 'רשימת הערות התאמה',
  harvestStatus: 'סטטוס התאמת קטיף', harvestNotes: 'הערות התאמת קטיף',
  calcError: 'שגיאת חישוב קג לפי מבנים',
  invoices: 'חשבוניות', deliveries: 'תעודות משלוח',
  jDays: 'JSON לפי ימים מאוחד', jInvoices: 'JSON חשבוניות מאוחד', jDeliveries: 'JSON תעודות משלוח מאוחד',
  jDailyCheck: 'JSON בדיקת התאמה יומית', jHarvestCheck: 'JSON התאמת קטיף לתעודות משלוח',
  jIncome: 'JSON הכנסה לפי מבנים', jHarvestStruct: 'JSON סיכום קטיף לפי מבנים', jKg: 'JSON קג בפועל לפי ימים ומבנים',
};
const LIST_FIELDS = [F.code, F.start, F.end, F.gross, F.net, F.weight, F.docStatus, F.harvestStatus, F.calcError, F.invoices, F.deliveries, F.jDays];
const LIST_QS = `?maxRecords=200&raw=1&fields=${LIST_FIELDS.map(encodeURIComponent).join(',')}`;

export default function WeeklySummaryPage() {
  const app = useApp();
  const [params] = useSearchParams();
  const canEdit = (app.user?.role || 'owner') === 'owner';
  const [weeks, setWeeks] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);
  const [newWeek, setNewWeek] = useState(false);
  const [fYear, setFYear] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fWeek, setFWeek] = useState('');

  const load = useCallback(async (handleParam = false) => {
    const [w, e] = await Promise.all([
      app.api.get(TABLE, LIST_QS),
      app.api.get('הוצאות', '?maxRecords=400'),
    ]);
    const list = (Array.isArray(w) ? w : []).map(cleanRecord);
    // החדש למעלה — קוד השבוע הוא YYYYMMDD ולכן מיון מחרוזתי נכון גם כשהתאריך שגוי
    list.sort((a, b) => String(b[F.code] || '').localeCompare(String(a[F.code] || '')));
    setWeeks(list);
    setExpenses(Array.isArray(e) ? e : []);
    // כרטיס שבוע פתוח ברענון ברקע מסונכרן לרשומה העדכנית
    setDrawer((cur) => (cur ? (list.find((x) => x.id === cur.id) || cur) : cur));
    if (handleParam) {
      // קישור עמוק: /weekly?week=<קוד שבוע> פותח את כרטיס השבוע
      const wanted = params.get('week');
      if (wanted) {
        const hit = list.find((x) => String(x[F.code]) === wanted);
        if (hit) setDrawer(hit);
      }
    }
    return list;
  }, [app.api, params]);

  useEffect(() => { load(true).catch(() => {}).finally(() => setLoading(false)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const silentLoad = useCallback(() => load(false).catch(() => {}), [load]);
  useAutoRefresh(silentLoad);

  // ------ סינון לפי שנה / חודש / שבוע (מקוד השבוע) ------
  const validCode = (w) => /^\d{8}-\d{8}$/.test(String(w[F.code] || ''));
  const inFilter = (w) => {
    const code = String(w[F.code] || '');
    if (!validCode(w)) return !(fYear || fMonth || fWeek);
    if (fYear && code.slice(0, 4) !== fYear) return false;
    if (fMonth && code.slice(4, 6) !== fMonth) return false;
    if (fWeek && code !== fWeek) return false;
    return true;
  };
  const shown = useMemo(() => weeks.filter(inFilter), [weeks, fYear, fMonth, fWeek]);
  const yearOptions = useMemo(() => [...new Set(weeks.filter(validCode).map((w) => String(w[F.code]).slice(0, 4)))].sort(), [weeks]);
  const monthOptions = useMemo(() => [...new Set(weeks.filter(validCode)
    .filter((w) => !fYear || String(w[F.code]).slice(0, 4) === fYear)
    .map((w) => String(w[F.code]).slice(4, 6)))].sort(), [weeks, fYear]);
  const weekOptions = useMemo(() => weeks.filter(validCode)
    .filter((w) => (!fYear || String(w[F.code]).slice(0, 4) === fYear) && (!fMonth || String(w[F.code]).slice(4, 6) === fMonth))
    .map((w) => String(w[F.code])).sort().reverse(), [weeks, fYear, fMonth]);

  // ------ חישובים ------
  // ערכי שבוע: ה-Rollup (מ-חשבוניות עצמן — המקור המהימן), ואם הוא ריק —
  // סכימה מ"JSON לפי ימים מאוחד" (לברוטו/משקל, שקיימים שם בפועל).
  // "נטו" *אין לו* נפילה לברוטו היומי: ל-JSON היומי אין פירוט ניכויים,
  // ונטו תמיד ≤ ברוטו — נפילה כזו הייתה מציגה נטו מנופח (=ברוטו) בכל
  // שבוע שטרם קיבל Rollup, בלי שום סימון שזו הערכה. עדיף 0 אמיתי (="טרם
  // נקלטה חשבונית לשבוע זה") על נתון שגוי שנראה מדויק.
  const statsOf = useCallback((w) => {
    const days = parseDays(w[F.jDays]);
    const dWeight = days.reduce((s, d) => s + (d.weight || 0), 0);
    const dGross = days.reduce((s, d) => s + (d.gross || 0), 0);
    return {
      weight: num(w[F.weight]) || dWeight,
      gross: num(w[F.gross]) || dGross,
      net: num(w[F.net]),
    };
  }, []);
  const totalNeto = shown.reduce((s, w) => s + statsOf(w).net, 0);
  const totalWeight = shown.reduce((s, w) => s + statsOf(w).weight, 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e['סכום כולל-AI']), 0);
  const missingDocs = shown.filter((w) => String(w[F.docStatus] || '').includes('חסר')).length;

  // חלוקת הוצאות לשבועות לפי טווח תאריכים
  function getWeekForDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    for (const w of weeks) {
      const s = new Date(w[F.start]);
      const e = new Date(w[F.end]);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && d >= s && d <= e) return w[F.code];
    }
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
    // רק שבועות עם קוד תקין — רשומות עם תאריך שגוי לא מציירות "?"
    const valid = shown.filter((w) => /^\d{8}-\d{8}$/.test(String(w[F.code] || '')));
    const sorted = [...valid].sort((a, b) => String(a[F.code]).localeCompare(String(b[F.code])));
    return sorted.map((w) => {
      const st = statsOf(w);
      return {
        name: shortWeek(w[F.code]),
        'פדיון': Math.round(st.net),
        'הוצאות': Math.round(weeklyExpenses[w[F.code]] || 0),
        'משקל': Math.round(st.weight),
      };
    });
  }, [shown, weeklyExpenses, statsOf]);

  return (
    <div>
      <PageHeader icon="📆" title="סיכום שבועי">
        {canEdit && <button className="btn btn-primary no-print" onClick={() => setNewWeek(true)}>+ סיכום שבועי</button>}
      </PageHeader>
      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <>
          {/* ------ סינון: שנה / חודש / שבוע ------ */}
          <div className="filter-bar no-print">
            <select className="select" aria-label="סינון לפי שנה" value={fYear} onChange={(e) => { setFYear(e.target.value); setFMonth(''); setFWeek(''); }}>
              <option value="">כל השנים</option>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="select" aria-label="סינון לפי חודש" value={fMonth} onChange={(e) => { setFMonth(e.target.value); setFWeek(''); }}>
              <option value="">כל החודשים</option>
              {monthOptions.map((m) => <option key={m} value={m}>{Number(m)}/{fYear || 'שנה'}</option>)}
            </select>
            <select className="select" aria-label="סינון לפי שבוע" value={fWeek} onChange={(e) => setFWeek(e.target.value)}>
              <option value="">כל השבועות</option>
              {weekOptions.map((c) => <option key={c} value={c}>{`${c.slice(6, 8)}/${c.slice(4, 6)} – ${c.slice(15, 17)}/${c.slice(13, 15)}`}</option>)}
            </select>
            {(fYear || fMonth || fWeek) && <button className="btn btn-ghost" onClick={() => { setFYear(''); setFMonth(''); setFWeek(''); }}>נקה פילטרים</button>}
          </div>

          {/* ------ KPI Cards ------ */}
          <div className="kpi-grid">
            <Kpi icon="💰" bg="var(--revenue-soft)" color="var(--revenue)" label='סה"כ פדיון נטו' value={formatMoney(totalNeto)} />
            <Kpi icon="🧾" bg="var(--expense-soft)" color="var(--expense)" label='סה"כ הוצאות' value={formatMoney(totalExpenses)} />
            <Kpi icon="📈" bg="var(--profit-soft)" color="var(--profit)" label="רווח" value={formatMoney(totalNeto - totalExpenses)} />
            <Kpi icon="🧺" bg="var(--harvest-soft)" color="var(--harvest)" label='סה"כ משקל' value={`${formatNumber(totalWeight)} ק"ג`} />
            <Kpi icon="📂" bg="var(--warning-soft)" color={missingDocs ? 'var(--warning)' : 'var(--ok)'} label="שבועות עם מסמכים חסרים" value={formatNumber(missingDocs)} sub={`מתוך ${weeks.length} שבועות`} />
          </div>

          {/* ------ Bar Charts ------ */}
          {chartData.length > 0 && (
            <div className="grid-2" style={{ marginTop: 20 }}>
              <MiniBar title="הכנסות לפי שבוע" data={chartData} dataKey="פדיון" color="#08A878" money />
              <MiniBar title="הוצאות לפי שבוע" data={chartData} dataKey="הוצאות" color="#F04444" money />
              <MiniBar title="משקל לפי שבוע" data={chartData} dataKey="משקל" color="#6366F1" unit='ק"ג' />
            </div>
          )}

          {/* ------ רשימת שבועות ------ */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>רשימת שבועות</div>
            {shown.length === 0 ? <div className="empty-state">אין נתונים לתקופה זו</div> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>שבוע</th><th>פדיון ברוטו</th><th>פדיון נטו</th><th>משקל</th><th>מסמכים</th><th>סטטוס מסמכים</th><th>סטטוס קטיף</th>{canEdit && <th className="no-print">פעולות</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((w) => (
                      <tr key={w.id} onClick={() => setDrawer(w)} style={{ cursor: 'pointer' }}>
                        <td>
                          <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap' }}>{formatDate(w[F.start])} – {formatDate(w[F.end])}</div>
                          <div className="muted" style={{ fontSize: 11, direction: 'ltr', unicodeBidi: 'embed', textAlign: 'right' }}>{displayName(w[F.code])}</div>
                        </td>
                        <td>{formatMoney(statsOf(w).gross)}</td>
                        <td>{formatMoney(statsOf(w).net)}</td>
                        <td>{formatNumber(Math.round(statsOf(w).weight))}</td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>🧾 {countOf(w[F.invoices])} · 📄 {countOf(w[F.deliveries])}</td>
                        <td><StatusBadge v={w[F.docStatus]} /></td>
                        <td><StatusBadge v={w[F.harvestStatus]} /></td>
                        {canEdit && (
                          <td className="no-print">
                            <button className="btn btn-sm btn-ghost" aria-label="הסרת הסיכום" title="הסרת הסיכום מהתצוגה"
                              style={{ color: 'var(--error)' }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (await removeRecord(app.api, TABLE, w.id, `סיכום השבוע ${displayName(w[F.code])}`)) await load();
                              }}>🗑</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {drawer && <WeekDrawer summary={drawer} onClose={() => setDrawer(null)} />}

      {newWeek && (
        <NewWeekModal
          existingCodes={new Set(weeks.map((w) => String(w[F.code] || '')))}
          onClose={() => setNewWeek(false)}
          onCreate={async (code) => {
            const created = await app.api.create(TABLE, { [F.code]: code });
            toast('סיכום השבוע נוצר — שאר הנתונים יתמלאו אוטומטית');
            setNewWeek(false);
            const list = await load();
            const hit = list.find((x) => x.id === created.id);
            if (hit) setDrawer(hit);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// כרטיס שבוע — נטען טרי מ-Airtable ומתרענן כל 30 שניות
// ============================================================
function WeekDrawer({ summary, onClose }) {
  const app = useApp();
  useEscapeClose(onClose);
  const [tab, setTab] = useState('סקירה');
  const [week, setWeek] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async (silent = true) => {
    if (!silent) setRefreshing(true);
    try {
      const rec = cleanRecord(await app.api.get(TABLE, `/${summary.id}`));
      if (!alive.current) return;
      setWeek(rec); setError(''); setLoadedAt(new Date());
    } catch (e) {
      if (alive.current) setError(e.message || 'שגיאה בטעינה');
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, [app.api, summary.id]);

  useEffect(() => {
    alive.current = true;
    load(false);
    // רענון ממוקד של הרשומה בלבד — כדי שעדכוני Automation יופיעו בלי רענון ידני
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, REFRESH_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);

  const w = week || summary;
  const code = w[F.code];

  // פרסור נקי של כל שדות ה-JSON (פעם אחת לכל גרסה של הרשומה)
  const parsed = useMemo(() => ({
    days: parseDays(w[F.jDays]),
    income: parseIncome(w[F.jIncome]),
    harvestStruct: parseHarvestStruct(w[F.jHarvestStruct]),
    kg: parseKg(w[F.jKg]),
    dailyCheck: parseCheck(w[F.jDailyCheck]),
    harvestCheck: parseCheck(w[F.jHarvestCheck]),
    invoicesJson: parseInvoicesJson(w[F.jInvoices]),
    deliveriesJson: parseDeliveriesJson(w[F.jDeliveries]),
  }), [w]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer stru-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>
            {formatDate(w[F.start])} – {formatDate(w[F.end])}
            <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-secondary)', marginInlineStart: 10, direction: 'ltr', unicodeBidi: 'embed' }}>{code}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(false)} disabled={refreshing} title="טעינה מחדש">
              {refreshing ? <span className="spinner spinner-sm" /> : '🔄'} {loadedAt ? `עודכן ${hhmm(loadedAt)}` : 'טוען...'}
            </button>
            <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
          </span>
        </div>

        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#fff', zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'active' : ''}`} style={{ fontSize: 12, padding: '6px 10px' }}>{t}</button>
          ))}
        </div>

        <div className="drawer-body">
          {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
          {!week ? (
            <div><div className="skeleton skeleton-card" /><div className="skeleton skeleton-chart" style={{ marginTop: 12 }} /></div>
          ) : (
            <>
              {tab === 'סקירה' && <OverviewTab week={w} p={parsed} />}
              {tab === 'לפי ימים' && <DaysTab days={parsed.days} />}
              {tab === 'זנים' && <VarietiesTab days={parsed.days} kg={parsed.kg} />}
              {tab === 'מבנים' && <StructuresTab income={parsed.income} harvestStruct={parsed.harvestStruct} kg={parsed.kg} />}
              {tab === 'ק"ג בפועל' && <KgTab kg={parsed.kg} calcError={w[F.calcError]} />}
              {tab === 'התאמות' && <MatchTab week={w} dailyCheck={parsed.dailyCheck} harvestCheck={parsed.harvestCheck} />}
              {tab === 'מסמכים' && <DocsTab week={w} p={parsed} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// סקירה (סעיף 30)
// ============================================================
function OverviewTab({ week, p }) {
  const cartons = p.days.reduce((s, d) => s + d.cartons, 0);
  const pallets = p.days.reduce((s, d) => s + d.pallets, 0);
  const kpis = [
    { l: 'פדיון ברוטו', v: formatMoney(week[F.gross]), c: 'var(--revenue)' },
    { l: 'פדיון נטו', v: formatMoney(week[F.net]), c: 'var(--profit)' },
    { l: 'משקל', v: `${formatNumber(week[F.weight])} ק"ג`, c: 'var(--weight)' },
    { l: 'קרטונים', v: formatNumber(cartons), c: 'var(--cartons)' },
    { l: 'משטחים', v: formatNumber(pallets), c: 'var(--pallets)' },
    { l: 'מספר חשבוניות', v: formatNumber(countOf(week[F.invoices])), c: 'var(--docs)' },
    { l: 'מספר תעודות משלוח', v: formatNumber(countOf(week[F.deliveries])), c: 'var(--docs)' },
  ];
  const s = p.dailyCheck?.summary;
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
        <div className="section-title" style={{ marginTop: 0 }}>סטטוס</div>
        <Row l="סטטוס מסמכים" v={<StatusBadge v={week[F.docStatus]} />} />
        <Row l="סטטוס קטיף" v={<StatusBadge v={week[F.harvestStatus]} />} />
        {s && (
          <Row l="בדיקה יומית" v={<span style={{ fontSize: 13 }}>נבדקו {s.checked_days} ימים · תקינים {s.matched_days} · אי התאמה {s.mismatch_days} · ללא חשבונית {s.missing_invoice_days} · ללא תעודה {s.missing_delivery_days}</span>} />
        )}
        {week[F.calcError] && <Row l="שגיאת חישוב" v={<span className="badge badge-error">שגיאת חישוב ק"ג לפי מבנים</span>} />}
      </div>
      <NotesCard title="הערות התאמת מסמכים" text={week[F.docNotes]} />
      <NotesCard title="הערות התאמת קטיף" text={week[F.harvestNotes]} />
    </div>
  );
}

// ============================================================
// לפי ימים (סעיף 31)
// ============================================================
function DaysTab({ days }) {
  if (!days.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  const chart = days.map((d) => ({ name: shortDate(d.date), פדיון: Math.round(d.gross), קרטונים: d.cartons, משקל: Math.round(d.weight), משטחים: d.pallets }));
  const tot = days.reduce((a, d) => ({ cartons: a.cartons + d.cartons, weight: a.weight + d.weight, gross: a.gross + d.gross, pallets: a.pallets + d.pallets }), { cartons: 0, weight: 0, gross: 0, pallets: 0 });
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
                  <td>{formatMoney(d.gross)}</td>
                  <td>{formatNumber(d.pallets)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: 'var(--bg-secondary)' }}>
                <td>סה"כ</td><td>{formatNumber(tot.cartons)}</td><td>{formatNumber(tot.weight)}</td><td>{formatMoney(tot.gross)}</td><td>{formatNumber(tot.pallets)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <MiniBar title="פדיון לפי יום" data={chart} dataKey="פדיון" color="#08A878" money />
        <MiniBar title="קרטונים לפי יום" data={chart} dataKey="קרטונים" color="#F59E0B" />
        <MiniBar title="משקל לפי יום" data={chart} dataKey="משקל" color="#2878D0" unit='ק"ג' />
        <MiniBar title="משטחים לפי יום" data={chart} dataKey="משטחים" color="#8B5CF6" />
      </div>
    </div>
  );
}

// ============================================================
// זנים (סעיפים 32–33 — לפי זן)
// ============================================================
function VarietiesTab({ days, kg }) {
  const rows = useMemo(() => {
    const by = {};
    days.forEach((d) => d.products.forEach((pr) => {
      const k = pr.variety || 'לא צוין';
      by[k] = by[k] || { name: k, cartons: 0, weight: 0, gross: 0, pallets: 0 };
      by[k].cartons += pr.cartons; by[k].weight += pr.weight; by[k].gross += pr.gross; by[k].pallets += pr.pallets;
    }));
    return Object.values(by).sort((a, b) => b.gross - a.gross);
  }, [days]);

  // קרטונים לפי זן לאורך זמן (מתעודות המשלוח המאוחדות)
  const overTime = useMemo(() => {
    const names = rows.map((r) => r.name);
    return days.map((d) => {
      const o = { name: shortDate(d.date) };
      names.forEach((n) => { o[n] = 0; });
      d.products.forEach((pr) => { o[pr.variety || 'לא צוין'] += pr.cartons; });
      return o;
    });
  }, [days, rows]);

  if (!rows.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>זן</th><th>קרטונים</th><th>משקל</th><th>פדיון</th><th>חלק יחסי</th><th>משטחים</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.name}><td><b>{x.name}</b></td><td>{formatNumber(x.cartons)}</td><td>{formatNumber(x.weight)}</td><td>{formatMoney(x.gross)}</td><td>{pct(x.gross, totalGross)}</td><td>{formatNumber(x.pallets)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הכנסה לפי זן</div>
          <PieBox data={rows.map((r) => ({ name: r.name, value: Math.round(r.gross) }))} fmt={(v) => formatMoney(v)} />
        </div>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>משקל לפי זן</div>
          <PieBox data={rows.map((r) => ({ name: r.name, value: Math.round(r.weight) }))} fmt={(v) => `${formatNumber(v)} ק"ג`} />
        </div>
        <MiniBar title="קרטונים לפי זן" data={rows.map((r) => ({ name: r.name, קרטונים: r.cartons }))} dataKey="קרטונים" color="#F59E0B" />
        <StackedBox title="קרטונים לפי זן לאורך זמן" data={overTime} keys={rows.map((r) => r.name)} />
      </div>
      {kg && <StructVarietyMatrix kg={kg} />}
    </div>
  );
}

// ============================================================
// מבנים (סעיפים 32–33 — לפי מבנה)
// ============================================================
function StructuresTab({ income, harvestStruct, kg }) {
  const cards = useMemo(() => {
    const by = {};
    (income?.structures || []).forEach((s) => { by[s.name] = { name: s.name, net: s.net, share: s.share, cartons: s.cartons, varieties: new Set() }; });
    (harvestStruct?.structures || []).forEach((s) => {
      by[s.name] = by[s.name] || { name: s.name, net: 0, share: 0, cartons: 0, varieties: new Set() };
      if (!by[s.name].cartons) by[s.name].cartons = s.cartons;
    });
    (kg?.days || []).forEach((d) => d.varieties.forEach((v) => v.structures.forEach((st) => {
      by[st.name] = by[st.name] || { name: st.name, net: 0, share: 0, cartons: 0, varieties: new Set() };
      by[st.name].varieties.add(v.variety);
    })));
    const totalNet = Object.values(by).reduce((s, x) => s + x.net, 0);
    return Object.values(by).map((x) => ({ ...x, share: x.share || (totalNet ? x.net / totalNet : 0), varieties: [...x.varieties] })).sort((a, b) => b.net - a.net || b.cartons - a.cartons);
  }, [income, harvestStruct, kg]);

  // קרטונים לפי מבנה לאורך זמן (מתוך JSON ק"ג בפועל)
  const overTime = useMemo(() => {
    if (!kg) return [];
    const names = cards.map((c) => c.name);
    return kg.days.map((d) => {
      const o = { name: shortDate(d.date) };
      names.forEach((n) => { o[n] = 0; });
      d.varieties.forEach((v) => v.structures.forEach((st) => { o[st.name] = (o[st.name] || 0) + st.cartons; }));
      return o;
    });
  }, [kg, cards]);

  if (!cards.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div>
      {income && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <MiniKpi l="הכנסה נטו שבועית" v={formatMoney(income.total)} c="var(--profit)" />
          <MiniKpi l="קרטונים שחולקו" v={formatNumber(income.cartons)} c="var(--cartons)" />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginTop: 14 }}>
        {cards.map((c) => (
          <div key={c.name} className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 800 }}>🏗️ {c.name}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--profit)', marginTop: 6 }}>{formatMoney(c.net)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>חלק יחסי {(c.share * 100).toFixed(1)}% · {formatNumber(c.cartons)} קרטונים</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {c.varieties.length ? c.varieties.map((v) => <span key={v} className="badge" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{v}</span>) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>זנים: לא זמין</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="grid-2" style={{ marginTop: 14 }}>
        <HBar title="הכנסה לפי מבנה" data={cards.map((c) => ({ name: c.name, value: Math.round(c.net) }))} color="#2878D0" fmt={(v) => formatMoney(v)} />
        <HBar title="קרטונים לפי מבנה" data={cards.map((c) => ({ name: c.name, value: c.cartons }))} color="#F59E0B" fmt={(v) => formatNumber(v)} />
        {overTime.length > 0 && <StackedBox title="קרטונים לפי מבנה לאורך זמן" data={overTime} keys={cards.map((c) => c.name)} />}
      </div>
      {kg && <StructVarietyMatrix kg={kg} />}
    </div>
  );
}

/** טבלת מבנה × זן — קרטונים (סעיף 33: "קרטונים לפי מבנה וזן") */
function StructVarietyMatrix({ kg }) {
  const { structs, vars, cell } = useMemo(() => {
    const structs = new Set(); const vars = new Set(); const cell = {};
    kg.days.forEach((d) => d.varieties.forEach((v) => v.structures.forEach((st) => {
      structs.add(st.name); vars.add(v.variety);
      cell[`${st.name}|${v.variety}`] = (cell[`${st.name}|${v.variety}`] || 0) + st.cartons;
    })));
    return { structs: [...structs], vars: [...vars], cell };
  }, [kg]);
  if (!structs.length) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="section-title" style={{ marginTop: 0 }}>קרטונים לפי מבנה וזן</div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>מבנה</th>{vars.map((v) => <th key={v}>{v}</th>)}<th>סה"כ</th></tr></thead>
          <tbody>
            {structs.map((s) => {
              const total = vars.reduce((acc, v) => acc + (cell[`${s}|${v}`] || 0), 0);
              return <tr key={s}><td><b>{s}</b></td>{vars.map((v) => <td key={v}>{formatNumber(cell[`${s}|${v}`] || 0)}</td>)}<td><b>{formatNumber(total)}</b></td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// ק"ג בפועל (סעיף 34)
// ============================================================
function KgTab({ kg, calcError }) {
  const m = useMemo(() => (kg && kg.days.length ? summarizeKg(kg) : null), [kg]);
  if (!m) {
    return (
      <div>
        {calcError && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12, whiteSpace: 'normal', textAlign: 'right' }}>⚠️ שגיאת חישוב ק"ג לפי מבנים — הנתונים טרם חושבו</div>}
        <div className="empty-state">אין נתונים לתקופה זו</div>
      </div>
    );
  }
  return (
    <div>
      {calcError && <div className="badge badge-warn" style={{ width: '100%', marginBottom: 12, whiteSpace: 'normal', textAlign: 'right' }}>⚠️ קיימת שגיאת חישוב — ייתכן שהנתונים חלקיים</div>}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <MiniKpi l='סה"כ ק"ג בפועל' v={`${formatNumber(m.totalWeight)}`} c="var(--harvest)" />
        <MiniKpi l="קרטונים שחולקו" v={formatNumber(m.totalAllocated)} c="var(--cartons)" />
        <MiniKpi l="מבנים פעילים" v={formatNumber(m.byStruct.length)} />
        <MiniKpi l="זנים" v={formatNumber(m.byVariety.length)} />
        <MiniKpi l="קרטונים לא משויכים" v={formatNumber(m.unassigned)} c={m.unassigned ? 'var(--warning)' : 'var(--ok)'} />
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>ק"ג לאורך זמן</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={m.perDay} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...xAxisProps(m.perDay.length, { rotate: m.perDay.length > 7 })} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v)} ק"ג`} />
                <Line type="monotone" dataKey='ק"ג' stroke="#2E9B62" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <HBar title="ק״ג לפי מבנה" data={m.byStruct.map((s) => ({ name: s.name, value: Math.round(s.weight) }))} color="#2E9B62" fmt={(v) => `${formatNumber(v)} ק"ג`} />
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>ק"ג לפי זן</div>
          <PieBox data={m.byVariety.map((v) => ({ name: v.name, value: Math.round(v.weight) }))} fmt={(v) => `${formatNumber(v)} ק"ג`} />
        </div>
        <HBar title="קרטונים לפי מבנה" data={m.byStruct.map((s) => ({ name: s.name, value: s.cartons }))} color="#F59E0B" fmt={(v) => formatNumber(v)} />
        <MiniBar title="משקל ממוצע לקרטון (לפי זן)" data={m.byVariety.map((v) => ({ name: v.name, ממוצע: v.avg }))} dataKey="ממוצע" color="#8B5CF6" unit='ק"ג' />
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>קרטונים בתעודות מול קרטונים ששויכו</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={m.perDay} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...xAxisProps(m.perDay.length, { rotate: m.perDay.length > 7 })} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatNumber(v)} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="בתעודות" fill="#2878D0" radius={[4, 4, 0, 0]} />
                <Bar dataKey="שויכו" fill="#08A878" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <MiniBar title="פער קרטונים לאורך זמן" data={m.perDay} dataKey="פער" color="#F04444" />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>פירוט</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>תאריך</th><th>זן</th><th>מבנה</th><th>קרטונים</th><th>ק"ג בפועל</th><th>משקל ממוצע</th><th>קרטונים בתעודות</th><th>קרטונים ששויכו</th><th>פער</th></tr></thead>
            <tbody>
              {kg.days.map((d) => d.varieties.map((v, vi) => {
                const rowsOfVar = v.structures.length ? v.structures : [{ name: 'לא משויך', cartons: 0, weight: 0 }];
                const span = rowsOfVar.length;
                const gap = v.delivery_cartons - v.allocated_cartons;
                return rowsOfVar.map((st, si) => (
                  <tr key={`${d.date}-${vi}-${si}`}>
                    {si === 0 && <td rowSpan={span}>{formatDate(d.date)}</td>}
                    {si === 0 && <td rowSpan={span}><b>{v.variety}</b></td>}
                    <td>{st.name}</td>
                    <td>{formatNumber(st.cartons)}</td>
                    <td>{formatNumber(st.weight)}</td>
                    {si === 0 && <td rowSpan={span}>{v.avg ? formatNumber(v.avg, 1) : '—'}</td>}
                    {si === 0 && <td rowSpan={span}>{formatNumber(v.delivery_cartons)}</td>}
                    {si === 0 && <td rowSpan={span}>{formatNumber(v.allocated_cartons)}</td>}
                    {si === 0 && <td rowSpan={span} style={{ color: gap ? 'var(--warning)' : 'var(--ok)', fontWeight: 700 }}>{gap > 0 ? `+${formatNumber(gap)}` : formatNumber(gap)}</td>}
                  </tr>
                ));
              }))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function summarizeKg(kg) {
  const byStruct = {}; const byVariety = {};
  let totalWeight = 0; let totalAllocated = 0; let unassigned = 0;
  const perDay = kg.days.map((d) => {
    let delivered = 0; let allocated = 0; let weight = 0;
    d.varieties.forEach((v) => {
      delivered += v.delivery_cartons; allocated += v.allocated_cartons;
      unassigned += Math.max(0, v.delivery_cartons - v.allocated_cartons);
      const bv = byVariety[v.variety] = byVariety[v.variety] || { name: v.variety, weight: 0, cartons: 0 };
      v.structures.forEach((st) => {
        weight += st.weight;
        const bs = byStruct[st.name] = byStruct[st.name] || { name: st.name, weight: 0, cartons: 0 };
        bs.weight += st.weight; bs.cartons += st.cartons;
        bv.weight += st.weight; bv.cartons += st.cartons;
      });
      if (!v.structures.length) { bv.weight += v.allocated_weight; bv.cartons += v.allocated_cartons; weight += v.allocated_weight; }
    });
    totalWeight += weight; totalAllocated += allocated;
    return { name: shortDate(d.date), 'ק"ג': Math.round(weight), בתעודות: delivered, שויכו: allocated, פער: delivered - allocated };
  });
  return {
    perDay, totalWeight, totalAllocated, unassigned,
    byStruct: Object.values(byStruct).sort((a, b) => b.weight - a.weight),
    byVariety: Object.values(byVariety).map((v) => ({ ...v, avg: v.cartons ? +(v.weight / v.cartons).toFixed(1) : 0 })).sort((a, b) => b.weight - a.weight),
  };
}

// ============================================================
// התאמות (סעיף 35)
// ============================================================
const ISSUE_LABEL = {
  cartons_mismatch: 'אי התאמת קרטונים', weight_mismatch: 'אי התאמת משקל', pallets_mismatch: 'אי התאמת משטחים',
  missing_invoice: 'חסרה חשבונית', missing_delivery: 'חסרה תעודת משלוח', missing_harvest: 'חסר דיווח קטיף',
  harvest_mismatch: 'אי התאמת קטיף', marketer_deduction: 'ניכוי משווק', transport: 'הובלה', weight_deviation: 'חריגת משקל',
};
function MatchTab({ week, dailyCheck, harvestCheck }) {
  return (
    <div>
      <CheckCard title="התאמת מסמכים (חשבוניות מול תעודות משלוח)" status={week[F.docStatus]} check={dailyCheck} notes={week[F.docNotes]}
        legend={(s) => `נבדקו ${s.checked_days} · תקינים ${s.matched_days} · אי התאמה ${s.mismatch_days} · ללא חשבונית ${s.missing_invoice_days ?? 0} · ללא תעודה ${s.missing_delivery_days ?? 0}`} />
      <CheckCard title="התאמת קטיף (דיווחי קטיף מול תעודות משלוח)" status={week[F.harvestStatus]} check={harvestCheck} notes={week[F.harvestNotes]}
        legend={(s) => `נבדקו ${s.checked_days} · תקינים ${s.matched_days} · אי התאמה ${s.mismatch_days} · ללא דיווח קטיף ${s.missing_harvest_days ?? 0}`} />
      {week[F.calcError] && (
        <div className="card" style={{ borderColor: 'var(--error)' }}>
          <div className="section-title" style={{ marginTop: 0, color: 'var(--error)' }}>שגיאת חישוב ק"ג לפי מבנים</div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{String(week[F.calcError]).trim()}</div>
        </div>
      )}
    </div>
  );
}

function CheckCard({ title, status, check, notes, legend }) {
  const days = check?.days || [];
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <Row l="סטטוס" v={<StatusBadge v={status} />} />
      {check?.summary && <Row l="סיכום" v={<span style={{ fontSize: 13 }}>{legend(check.summary)}</span>} />}
      {days.length > 0 ? (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {days.map((d, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b>{formatDate(d.date)}</b><StatusBadge v={d.status} />
              </div>
              {(d.issues || []).map((iss, j) => (
                <div key={j} style={{ marginTop: 8, fontSize: 13 }}>
                  <span className="badge badge-warn" style={{ marginInlineEnd: 6 }}>{ISSUE_LABEL[iss.type] || iss.type}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{iss.message}</span>
                </div>
              ))}
              {!(d.issues || []).length && <div style={{ fontSize: 13, color: 'var(--ok)', marginTop: 6 }}>✓ אין חריגות ביום זה</div>}
            </div>
          ))}
        </div>
      ) : (
        <NotesInline text={notes} />
      )}
    </div>
  );
}

// ============================================================
// מסמכים — חשבוניות ותעודות משלוח של השבוע
// ============================================================
function DocsTab({ week, p }) {
  const app = useApp();
  const [recs, setRecs] = useState({ invoices: null, deliveries: null });
  const [openNote, setOpenNote] = useState(null); // כרטיס תעודת משלוח מלא מעל כרטיס השבוע
  const invIds = useMemo(() => new Set(idsOf(week[F.invoices])), [week]);
  const delIds = useMemo(() => new Set(idsOf(week[F.deliveries])), [week]);

  // הרשומות עצמן נטענות רק כשנכנסים לטאב (Lazy) — בשביל הקבצים המצורפים
  useEffect(() => {
    let on = true;
    Promise.all([
      app.api.get('חשבוניות', '?maxRecords=400&raw=1').catch(() => []),
      // התעודות נטענות עם שמות מקושרים (לא raw) כדי שכרטיס התעודה יציג משווק/מבנה בשם ולא במזהה
      app.api.get('תעודות משלוח', '?maxRecords=400').catch(() => []),
    ]).then(([i, d]) => { if (on) setRecs({ invoices: Array.isArray(i) ? i : [], deliveries: Array.isArray(d) ? d : [] }); });
    return () => { on = false; };
  }, [app.api, week.id]);

  const invoices = useMemo(() => {
    const byId = new Map(p.invoicesJson.map((x) => [x.record_id, x]));
    const fromRecs = (recs.invoices || []).filter((r) => invIds.has(r.id)).map((r) => {
      const j = byId.get(r.id) || {};
      const att = Array.isArray(r['חשבונית']) ? r['חשבונית'][0] : null;
      return {
        id: r.id, title: j.title || r['כותרת (חשבונית)'] || r['מספר חשבונית'] || 'חשבונית',
        marketer: j.marketer || r['שם משווק'] || r['משווק-AI'] || 'לא זמין',
        date: j.invoice_date || r['תאריך-AI'] || r['תאריך העלאת קובץ'],
        gross: j.gross_amount ?? r['סכום ברוטו'], net: j.net_amount ?? r['סכום נטו'], weight: j.weight ?? r['משקל'],
        cartons: j.cartons ?? r['כמות קרטונים'], pallets: j.pallets ?? r['מספר משטחים'],
        deductionCheck: j.marketer_deduction_check || r['בדיקת ניכוי משווק'], palletCheck: j.pallet_price_check || r['בדיקת חריגת מחיר משטח'],
        payStatus: r['סטטוס תשלום'], file: att,
      };
    });
    if (fromRecs.length || recs.invoices) return fromRecs;
    // עד שהרשומות נטענות — מציגים את מה שיש ב-JSON המאוחד
    return p.invoicesJson.map((j) => ({ id: j.record_id, title: j.title, marketer: j.marketer, date: j.invoice_date, gross: j.gross_amount, net: j.net_amount, weight: j.weight, cartons: j.cartons, pallets: j.pallets, deductionCheck: j.marketer_deduction_check, palletCheck: j.pallet_price_check }));
  }, [recs.invoices, p.invoicesJson, invIds]);

  const deliveries = useMemo(() => (recs.deliveries || []).filter((r) => delIds.has(r.id)).map((r) => ({
    id: r.id, number: r['מספר תעודה'] || 'תעודה', date: r['תאריך תעודה'] || r['תאריך העלאת קובץ'],
    marketer: r['שם משווק'] || r['משווק-AI'] || 'לא זמין', cartons: r['כמות קרטונים'], weight: r['משקל כולל'], avg: r['משקל ממוצע לקרטון'],
    weightCheck: r['בדיקת חריגת משקל'], file: Array.isArray(r['תעודת משלוח']) ? r['תעודת משלוח'][0] : null,
    rec: r,
  })), [recs.deliveries, delIds]);

  const s = p.dailyCheck?.summary;
  const loading = recs.invoices === null;
  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <MiniKpi l="חשבוניות" v={formatNumber(invIds.size)} c="var(--docs)" />
        <MiniKpi l="תעודות משלוח" v={formatNumber(delIds.size)} c="var(--docs)" />
        {s && <MiniKpi l="ימים ללא חשבונית" v={formatNumber(s.missing_invoice_days)} c={s.missing_invoice_days ? 'var(--warning)' : 'var(--ok)'} />}
        {s && <MiniKpi l="ימים ללא תעודת משלוח" v={formatNumber(s.missing_delivery_days)} c={s.missing_delivery_days ? 'var(--warning)' : 'var(--ok)'} />}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between' }}><span>🧾 חשבוניות</span><StatusBadge v={week[F.docStatus]} /></div>
        {invoices.length === 0 ? <div className="empty-state">{loading ? 'טוען...' : 'אין חשבוניות לשבוע זה'}</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>חשבונית</th><th>משווק</th><th>תאריך</th><th>ברוטו</th><th>נטו</th><th>משקל</th><th>קרטונים</th><th>משטחים</th><th>בדיקות</th><th>קובץ</th></tr></thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td><b>{i.title}</b>{i.payStatus && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{i.payStatus}</div>}</td>
                    <td>{i.marketer}</td>
                    <td>{formatDate(i.date)}</td>
                    <td>{formatMoney(i.gross)}</td>
                    <td>{formatMoney(i.net)}</td>
                    <td>{formatNumber(i.weight)}</td>
                    <td>{formatNumber(i.cartons)}</td>
                    <td>{formatNumber(i.pallets)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><CheckBadge label="ניכוי" v={i.deductionCheck} /> <CheckBadge label="משטח" v={i.palletCheck} /></td>
                    <td>{i.file?.url ? <a href={i.file.url} target="_blank" rel="noreferrer">📎 פתח</a> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>📄 תעודות משלוח</div>
        {deliveries.length === 0 ? <div className="empty-state">{loading ? 'טוען...' : 'אין תעודות משלוח לשבוע זה'}</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>תעודה</th><th>משווק</th><th>תאריך</th><th>קרטונים</th><th>משקל כולל</th><th>משקל ממוצע</th><th>חריגת משקל</th><th>קובץ</th></tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} onClick={() => setOpenNote(d.rec)} style={{ cursor: 'pointer' }} title="פתיחת כרטיס התעודה">
                    <td><b>{d.number}</b></td>
                    <td>{d.marketer}</td>
                    <td>{formatDate(d.date)}</td>
                    <td>{formatNumber(d.cartons)}</td>
                    <td>{formatNumber(d.weight)}</td>
                    <td>{d.avg != null ? formatNumber(d.avg, 1) : '—'}</td>
                    <td><CheckBadge v={d.weightCheck} /></td>
                    <td>{d.file?.url ? <a href={d.file.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>📎 פתח</a> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openNote && <DeliveryNoteDrawer note={openNote} notes={recs.deliveries || []} api={app.api} onClose={() => setOpenNote(null)} />}
      {p.deliveriesJson.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title" style={{ marginTop: 0 }}>תעודות משלוח — מאוחד לפי יום</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>תאריך</th><th>קרטונים</th><th>משקל</th><th>משטחים</th><th>תעודות</th></tr></thead>
              <tbody>
                {p.deliveriesJson.map((d, i) => <tr key={i}><td>{formatDate(d.date)}</td><td>{formatNumber(d.cartons)}</td><td>{formatNumber(d.weight)}</td><td>{formatNumber(d.pallets)}</td><td>{d.count}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// רכיבי עזר משותפים
// ============================================================
function Kpi({ icon, bg, color, label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top"><div className="kpi-icon" style={{ background: bg }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
function MiniKpi({ l, v, c }) {
  return <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{l}</span></div><div className="kpi-value" style={{ fontSize: 18, color: c }}>{v}</div></div>;
}
function MiniBar({ title, data, dataKey, color, money, unit }) {
  const fmt = money ? (v) => formatMoney(v) : (v) => `${formatNumber(v)}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <div style={{ direction: 'ltr' }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="name" {...xAxisProps(data.length, { rotate: data.length > 7 })} />
            <YAxis {...yAxisProps({ money })} />
            <Tooltip {...TOOLTIP_STYLE} formatter={fmt} />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function HBar({ title, data, color, fmt }) {
  const h = Math.max(160, 40 * data.length + 40);
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <div style={{ direction: 'ltr' }}>
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={data} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
            <XAxis type="number" {...xAxisProps(0)} />
            <YAxis dataKey="name" {...yCategoryProps({ width: 104 })} />
            <Tooltip {...TOOLTIP_STYLE} formatter={fmt} />
            <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function PieBox({ data, fmt }) {
  const filtered = data.filter((d) => d.value > 0);
  if (!filtered.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={filtered} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75}>
          {filtered.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
        </Pie>
        <Tooltip {...TOOLTIP_STYLE} formatter={fmt} />
        <Legend wrapperStyle={LEGEND_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}
function StackedBox({ title, data, keys }) {
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <div style={{ direction: 'ltr' }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="name" {...xAxisProps(data.length, { rotate: data.length > 7 })} />
            <YAxis {...yAxisProps()} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatNumber(v)} />
            <Legend wrapperStyle={LEGEND_STYLE} />
            {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={PIE[i % PIE.length]} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
function NotesCard({ title, text }) {
  const lines = noteLines(text);
  if (!lines.length) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <NotesInline text={text} />
    </div>
  );
}
function NotesInline({ text }) {
  const lines = noteLines(text);
  if (!lines.length) return <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>אין הערות</div>;
  return <ul style={{ margin: '8px 0 0', paddingInlineStart: 18, fontSize: 13, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>;
}
function StatusBadge({ v }) {
  const s = displayName(v, '');
  if (!s) return <span className="badge badge-warn">לא זמין</span>;
  const ok = ['תקין', 'תואם', 'הושלם', '✓'].some((k) => s.includes(k));
  const warn = s.includes('חסר') || s.includes('ממתין');
  return <span className={`badge ${ok ? 'badge-ok' : warn ? 'badge-warn' : 'badge-error'}`}>{s}</span>;
}
function CheckBadge({ label, v }) {
  if (!v) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  const ok = String(v).includes('תקין');
  return <span className={`badge ${ok ? 'badge-ok' : 'badge-warn'}`} style={{ fontSize: 11 }}>{label ? `${label}: ` : ''}{v}</span>;
}
function Row({ l, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{l}</span><b style={{ textAlign: 'left' }}>{v}</b></div>;
}

// ------ פונקציות עזר ------
function num(v) { return Number(v) || 0; }
/** Airtable מחזיר שגיאת נוסחה כ-{error:'#ERROR!'} — מנקים לערך ריק כדי לא להציג "[object Object]" */
function cleanRecord(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const out = {};
  for (const [k, v] of Object.entries(rec)) out[k] = (v && typeof v === 'object' && !Array.isArray(v) && 'error' in v) ? null : v;
  return out;
}
function pct(part, total) { return total ? `${((num(part) / total) * 100).toFixed(1)}%` : '—'; }
function countOf(v) { return Array.isArray(v) ? v.length : 0; }
function idsOf(v) { return Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean) : []; }
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function shortDate(d) { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d).slice(0, 5) : `${x.getDate()}/${x.getMonth() + 1}`; }
function shortWeek(code) {
  // 20260830-20260905 → 30/08
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(String(code || ''));
  return m ? `${m[3]}/${m[2]}` : String(code || '?');
}
function noteLines(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text.map(String).filter(Boolean);
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** JSON מ-Airtable; סובלני ל-underscore מוברח (work\_records) שמופיע בנתונים אמיתיים */
function parseJSON(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  const s = String(v).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* ננסה לתקן */ }
  try { return JSON.parse(s.replace(/\\_/g, '_')); } catch { return null; }
}

/** JSON לפי ימים מאוחד: days[] {date, cartons, weight, gross_sales_amount, pallets, products[]} */
function parseDays(json) {
  const p = parseJSON(json);
  const arr = Array.isArray(p?.days) ? p.days : (Array.isArray(p) ? p : []);
  return arr.map((d) => ({
    date: d.date || d['תאריך'],
    cartons: num(d.cartons ?? d['קרטונים']),
    weight: num(d.weight ?? d['משקל']),
    gross: num(d.gross_sales_amount ?? d.value ?? d['פדיון']),
    pallets: num(d.pallets ?? d['משטחים']),
    products: (Array.isArray(d.products) ? d.products : []).map((pr) => ({
      variety: pr.variety || pr['זן'] || 'לא צוין',
      cartons: num(pr.cartons), weight: num(pr.weight), gross: num(pr.gross_sales_amount ?? pr.value), pallets: num(pr.pallets),
    })),
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** JSON הכנסה לפי מבנים: {weekly_net_income, total_cartons, structures[] {structure, cartons, share, net_income}} */
function parseIncome(json) {
  const p = parseJSON(json);
  if (!p) return null;
  const arr = Array.isArray(p.structures) ? p.structures : (Array.isArray(p) ? p : []);
  const structures = arr.map((x) => ({
    name: x.structure || x['מבנה'] || x.name || 'מבנה',
    cartons: num(x.cartons), share: num(x.share),
    net: num(x.net_income ?? x.neto ?? x['נטו'] ?? x.revenue ?? x['הכנסה'] ?? x.value),
  }));
  if (!structures.length) return null;
  return { total: num(p.weekly_net_income) || structures.reduce((s, x) => s + x.net, 0), cartons: num(p.total_cartons) || structures.reduce((s, x) => s + x.cartons, 0), structures };
}

/** JSON סיכום קטיף לפי מבנים: {total_cartons, structures[] {structure, cartons}} */
function parseHarvestStruct(json) {
  const p = parseJSON(json);
  if (!p) return null;
  const arr = Array.isArray(p.structures) ? p.structures : (Array.isArray(p) ? p : []);
  const structures = arr.map((x) => ({ name: x.structure || x['מבנה'] || x.name || 'מבנה', cartons: num(x.cartons ?? x['קרטונים']) }));
  return structures.length ? { total: num(p.total_cartons) || structures.reduce((s, x) => s + x.cartons, 0), structures } : null;
}

/** JSON ק"ג בפועל לפי ימים ומבנים (סעיף 34) — ללא structure_id / work_records */
function parseKg(json) {
  const p = parseJSON(json);
  const arr = Array.isArray(p?.days) ? p.days : [];
  if (!arr.length) return null;
  const days = arr.map((d) => ({
    date: d.date,
    allocated_cartons: num(d.allocated_cartons), allocated_weight: num(d.allocated_weight),
    varieties: (Array.isArray(d.varieties) ? d.varieties : []).map((v) => ({
      variety: v.variety || 'לא צוין',
      delivery_cartons: num(v.delivery_cartons), delivery_weight: num(v.delivery_weight),
      avg: num(v.avg_weight_per_carton),
      allocated_cartons: num(v.allocated_cartons), allocated_weight: num(v.allocated_weight),
      structures: (Array.isArray(v.structures) ? v.structures : []).map((st) => ({
        name: st.structure || st.name || 'מבנה', cartons: num(st.cartons), weight: num(st.actual_weight ?? st.weight),
      })),
    })),
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { days };
}

/** JSON בדיקת התאמה יומית / התאמת קטיף: {status, summary{...}, days[] {date, status, issues[]}} */
function parseCheck(json) {
  const p = parseJSON(json);
  if (!p) return null;
  return { status: p.status, summary: p.summary || null, days: Array.isArray(p.days) ? p.days : [] };
}

/** JSON חשבוניות מאוחד: {invoices[]} */
function parseInvoicesJson(json) {
  const p = parseJSON(json);
  return Array.isArray(p?.invoices) ? p.invoices : [];
}

/** JSON תעודות משלוח מאוחד: {days[] {date, cartons, weight, pallets, source_delivery_records[]}} */
function parseDeliveriesJson(json) {
  const p = parseJSON(json);
  return (Array.isArray(p?.days) ? p.days : []).map((d) => ({
    date: d.date, cartons: num(d.cartons), weight: num(d.weight), pallets: num(d.pallets),
    count: Array.isArray(d.source_delivery_records) ? d.source_delivery_records.length : '—',
  }));
}


// ============================================================
// יצירת סיכום שבועי חדש — בחירת שבוע עסקי (שבת–חמישי) ואישור.
// נכתב רק "קוד שבוע"; שאר השדות מתמלאים אוטומטית.
// ============================================================
function NewWeekModal({ existingCodes, onClose, onCreate }) {
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const weekOf = (base) => {
    const d0 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d0.setDate(d0.getDate() - ((d0.getDay() + 1) % 7)); // שבת
    const end = new Date(d0); end.setDate(d0.getDate() + 5); // חמישי
    return { start: d0, end };
  };
  // ברירת המחדל: השבוע העסקי הקודם
  const [week, setWeek] = useState(() => {
    const prev = new Date(); prev.setDate(prev.getDate() - 7);
    return weekOf(prev);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  const code = `${ymd(week.start)}-${ymd(week.end)}`;
  const exists = existingCodes.has(code);
  const shift = (n) => setWeek((w) => {
    const s2 = new Date(w.start); s2.setDate(s2.getDate() + n * 7);
    return weekOf(s2);
  });

  const submit = async () => {
    if (saving || exists) return;
    setSaving(true); setError('');
    try { await onCreate(code); }
    catch (e) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>סיכום שבועי חדש</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <div style={{ textAlign: 'center', marginBottom: 6, color: 'var(--text-secondary)', fontSize: 13 }}>שבוע המסמך (שבת – חמישי)</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>→ שבוע קודם</button>
          <b style={{ fontSize: 17, whiteSpace: 'nowrap' }}>{formatDate(week.start)} – {formatDate(week.end)}</b>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(1)}>שבוע הבא ←</button>
        </div>
        <div className="muted" style={{ textAlign: 'center', fontSize: 12, direction: 'ltr' }}>{code}</div>
        {exists && <div className="badge badge-warn" style={{ width: '100%', marginTop: 12 }}>⚠️ כבר קיים סיכום שבועי לשבוע הזה</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
          <button type="button" className="btn btn-primary" disabled={saving || exists} onClick={submit}>
            {saving ? 'יוצר...' : 'צור סיכום שבועי'}
          </button>
        </div>
      </div>
    </div>
  );
}
