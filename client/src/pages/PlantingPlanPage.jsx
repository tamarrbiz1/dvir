import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useApp } from '../App.jsx';
import { formatDate, formatMoney, formatNumber } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';
import { holidayInfo, KIND_STYLE } from '../utils/holidays.js';
import {
  CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE,
  xAxisProps, yAxisProps, yCategoryProps,
} from '../utils/chart.js';

// ============================================================
// תוכנית שתילה — סעיף 44 באיפיון
//
// Airtable הוא מקור האמת: כל התאריכים, הרבעונים, הקג הצפוי, ההכנסה
// והתחזית מחושבים שם. המסך הזה מציג ומפעיל בלבד — אינו מחשב מחדש דבר.
// ============================================================

// שמות שדות אמיתיים מ-Airtable (לא מהאיפיון — האיפיון כתב "קג צפוי")
const KG_EXPECTED = 'ק"ג צפוי';
const KG_ACTUAL = 'קג בפועל';

const PLANT = { key: 'שתילה', bg: '#FFF4CC', border: '#E5A900', label: 'שתילה' };
const HARVEST = { key: 'קטיף', bg: '#DCF7E7', border: '#2E9B62', label: 'קטיף' };
const UPDATED_ACCENT = '#3578E5';
const PLANNED_COLOR = '#3578E5';
const ACTUAL_COLOR = '#168A55';
const KG_PER_CARTON = 12.3; // משקל ממוצע לקרטון (ק"ג)

const QUARTERS = [
  { q: 1, months: [0, 1, 2], color: '#DCEEFF', label: 'רבעון 1', short: 'Q1' },
  { q: 2, months: [3, 4, 5], color: '#DFF5E5', label: 'רבעון 2', short: 'Q2' },
  { q: 3, months: [6, 7, 8], color: '#FFE7CC', label: 'רבעון 3', short: 'Q3' },
  { q: 4, months: [9, 10, 11], color: '#E9DDF7', label: 'רבעון 4', short: 'Q4' },
];

// אייקון לכל גידול (סעיף 6) — אין לזהות גידולים לפי צבע
const CROP_ICONS = {
  'מלפפון': '🥒', 'קישוא': '🥒', 'זוקיני': '🥒',
  'עגבניה': '🍅', 'עגבניות': '🍅', 'שרי': '🍅',
  'פלפל': '🫑', 'חציל': '🍆', 'תות': '🍓', 'תותים': '🍓',
  'בצל': '🧅', 'שום': '🧄', 'גזר': '🥕', 'תירס': '🌽',
  'חסה': '🥬', 'כרוב': '🥬', 'ברוקולי': '🥦', 'כרובית': '🥦',
  'בטטה': '🍠', 'תפוח אדמה': '🥔', 'דלעת': '🎃', 'דלורית': '🎃',
  'אבטיח': '🍉', 'מלון': '🍈', 'ענבים': '🍇', 'לימון': '🍋',
  'שעועית': '🫘', 'אפונה': '🫛', 'בזיליקום': '🌿', 'נענע': '🌿', 'פטרוזיליה': '🌿',
};
const cropIcon = (name) => CROP_ICONS[String(name || '').trim()] || '🌱';

// ============================================================
// עזרי נתונים
// ============================================================

/** תאריך Airtable ("2027-01-30") -> Date בחצות מקומית, בלי הסטת אזור זמן */
function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ערך מספרי משדה שעשוי להגיע כמערך (lookup) */
function num(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const quarterInfo = (q) => QUARTERS.find((x) => x.q === Number(q)) || null;
const quarterOfDate = (d) => QUARTERS.find((q) => q.months.includes(d.getMonth()));

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * הצגת ביצוע בפועל (סעיף 24): אין להציג 0 כאילו הוא ביצוע אמיתי.
 * ערך חסר — ובן כך 0 בשבוע שטרם הסתיים — מוצג כ"טרם התקבל ביצוע".
 */
function actualKg(row) {
  const value = num(row[KG_ACTUAL]);
  if (value === null) return { received: false, value: null };
  const weekEnd = parseDate(row['סוף שבוע']);
  if (value === 0 && weekEnd && weekEnd >= startOfToday()) return { received: false, value: null };
  return { received: true, value };
}

const CHART_COLORS = ['#3578E5', '#2E9B62', '#E8B20B', '#7C4DFF', '#09A7B2', '#F04444', '#F79009', '#8B5CF6'];

// ============================================================
// רכיבים קטנים
// ============================================================

function QuarterBadge({ q }) {
  const info = quarterInfo(q);
  if (!info) return null;
  return <span className="badge" style={{ background: info.color, color: '#26313D' }}>{info.short}</span>;
}

/** זוג מספרים "מתוכנן / בפועל" — כחול מול ירוק כהה, זה לצד זה (סעיף 27) */
function PlannedVsActual({ expected, actual, unit = 'ק"ג' }) {
  return (
    <div style={{ display: 'flex', gap: 18 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>מתוכנן</div>
        <div style={{ color: PLANNED_COLOR, fontWeight: 700 }}>
          {expected === null ? 'לא זמין' : `${formatNumber(expected, 0)} ${unit}`}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>בפועל</div>
        <div style={{ color: actual.received ? ACTUAL_COLOR : 'var(--text-muted)', fontWeight: 700 }}>
          {actual.received ? `${formatNumber(actual.value, 0)} ${unit}` : 'טרם התקבל ביצוע'}
        </div>
      </div>
    </div>
  );
}

/** שורת תאריך בכרטיס התוכנית — מודגשת בכחול כשהיא שונה מהמקורי */
function DateRow({ label, value, changed }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: changed ? 700 : 500, color: changed ? UPDATED_ACCENT : 'inherit' }}>
        {value ? formatDate(value) : 'לא זמין'}
      </span>
    </div>
  );
}

// ============================================================
// המסך
// ============================================================
export default function PlantingPlanPage() {
  const app = useApp();

  const [plans, setPlans] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [forecasts, setForecasts] = useState([]);
  const [structures, setStructures] = useState([]);
  const [crops, setCrops] = useState([]);
  const [nonWorkDays, setNonWorkDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // פילטרים משותפים (סעיף 4) — נשמרים במעבר בין הטאבים
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [structureFilter, setStructureFilter] = useState('');
  const [cropFilter, setCropFilter] = useState('');
  const [quarterFilter, setQuarterFilter] = useState('');
  const [tab, setTab] = useState('build');

  // לוח שנה
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  });

  // חלוניות
  const [planDrawer, setPlanDrawer] = useState(null);
  const [weekDrawer, setWeekDrawer] = useState(null);
  const [planForm, setPlanForm] = useState(null); // יצירה / שכפול / עריכה
  const [shiftForm, setShiftForm] = useState(null);
  const [periodForm, setPeriodForm] = useState(null);
  const [showNonWork, setShowNonWork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // ============================================================
  // טעינת נתונים
  // ============================================================
  // רענון אחרי פעולה אינו מציג שלד ואינו מאפס טאב/לוח — נשארים באותו מקום
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const [p, pe, f, s, c, nw] = await Promise.all([
        app.api.get('תוכניות שתילה', '?maxRecords=500'),
        app.api.get('תקופות תוכנית', '?maxRecords=1000'),
        app.api.get('תחזית שתילה שבועית', '?maxRecords=1000'),
        app.api.get('מבנים', '?maxRecords=300'),
        app.api.get('גידולים', '?maxRecords=300'),
        app.api.get('ימי אי עבודה', '?maxRecords=500'),
      ]);
      setPlans(Array.isArray(p) ? p : []);
      setPeriods(Array.isArray(pe) ? pe : []);
      setForecasts(Array.isArray(f) ? f : []);
      setStructures(Array.isArray(s) ? s : []);
      setCrops(Array.isArray(c) ? c : []);
      setNonWorkDays(Array.isArray(nw) ? nw : []);
    } catch (e) {
      setLoadError(e.message || 'לא ניתן היה לטעון את הנתונים מ-Airtable.');
    }
    setLoading(false);
  }, [app.api]);

  useEffect(() => { load(); }, [load]);

  // ============================================================
  // אינדקסים ונגזרות
  // ============================================================
  const planById = useMemo(() => {
    const map = new Map();
    for (const p of plans) map.set(p.id, p);
    return map;
  }, [plans]);

  const planInfo = useCallback((plan) => {
    if (!plan) return null;
    const cropName = displayName(plan['גידולים'], '') || displayName(plan['סוג גידול'], '') || 'לא זמין';
    return {
      id: plan.id,
      number: plan['מספר תוכנית'],
      structure: displayName(plan['מבנה'], 'לא זמין'),
      structureId: firstId(plan['מבנה']),
      crop: cropName,
      cropId: firstId(plan['גידולים']),
      icon: cropIcon(cropName),
      area: num(plan['שטח בדונם (from מבנה)']),
      year: num(plan['שנת תוכנית']),
      raw: plan,
    };
  }, []);

  const yearsAvailable = useMemo(() => {
    const set = new Set();
    for (const p of plans) {
      const y = num(p['שנת תוכנית']);
      if (y) set.add(String(y));
    }
    set.add(String(new Date().getFullYear()));
    return [...set].sort();
  }, [plans]);

  // רשימות לפילטרים — רק מבנים/גידולים שבאמת מופיעים בתוכניות השנה
  const plansOfYear = useMemo(
    () => plans.filter((p) => String(num(p['שנת תוכנית'])) === String(year)),
    [plans, year]
  );

  const structureOptions = useMemo(() => {
    const map = new Map();
    for (const p of plansOfYear) {
      const id = firstId(p['מבנה']);
      if (id) map.set(id, displayName(p['מבנה'], id));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  }, [plansOfYear]);

  const cropOptions = useMemo(() => {
    const map = new Map();
    for (const p of plansOfYear) {
      const id = firstId(p['גידולים']);
      if (id) map.set(id, displayName(p['גידולים'], id));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  }, [plansOfYear]);

  const matchesFilters = useCallback(
    (info, q) => {
      if (!info) return false;
      if (String(info.year) !== String(year)) return false;
      if (structureFilter && info.structureId !== structureFilter) return false;
      if (cropFilter && info.cropId !== cropFilter) return false;
      if (quarterFilter && String(q) !== String(quarterFilter)) return false;
      return true;
    },
    [year, structureFilter, cropFilter, quarterFilter]
  );

  const filtersActive = structureFilter || cropFilter || quarterFilter;
  const clearFilters = () => { setStructureFilter(''); setCropFilter(''); setQuarterFilter(''); };

  // ------------------------------------------------------------
  // אירועי לוח השנה — מקור: "תקופות תוכנית" (סעיף 9)
  // השיוך לשנה נעשה לפי "שנת תוכנית" של התוכנית, אך התאריכים
  // מוצגים כפי שהם — תוכנית שחוצה שנה אינה נחתכת (סעיף 43).
  // ------------------------------------------------------------
  const events = useMemo(() => {
    return periods
      .map((period) => {
        const start = parseDate(period['מתאריך']);
        const end = parseDate(period['עד תאריך']);
        if (!start || !end) return null;

        const plan = planById.get(firstId(period['תוכנית שתילה']));
        const info = planInfo(plan);
        if (!info) return null;

        const status = String(period['סטטוס'] || '');
        const style = status.includes('קטיף') ? HARVEST : status.includes('שתילה') ? PLANT : null;
        if (!style) return null;

        const q = quarterOfDate(start)?.q;
        if (!matchesFilters(info, q)) return null;

        return { id: period.id, start, end, status, style, quarter: q, info, period };
      })
      .filter(Boolean);
  }, [periods, planById, planInfo, matchesFilters]);

  const eventsOnDate = useCallback(
    (date) => events.filter((e) => e.start <= date && e.end >= date),
    [events]
  );

  // תוכנית עשויה לחצות שנה (סעיף 43): "שנת תוכנית" היא שנת השיוך, אך
  // התאריכים בפועל יכולים ליפול בשנה הבאה. מיקום הלוח על החודש שבו
  // באמת מתחילה הפעילות — אחרת המשתמש נוחת על חודש ריק.
  const [positionedYear, setPositionedYear] = useState(null);
  useEffect(() => {
    if (loading || positionedYear === year) return;
    const earliest = events.reduce((min, e) => (!min || e.start < min ? e.start : min), null);
    if (earliest) {
      setCursor({ year: earliest.getFullYear(), month: earliest.getMonth(), day: 1 });
    } else {
      const now = new Date();
      const sameYear = now.getFullYear() === Number(year);
      setCursor({ year: Number(year), month: sameYear ? now.getMonth() : 0, day: sameYear ? now.getDate() : 1 });
    }
    setPositionedYear(year);
  }, [year, loading, events, positionedYear]);

  /** האם התאריכים בפועל חורגים מהשנה שנבחרה */
  const crossesYear = useMemo(
    () => events.some((e) => e.start.getFullYear() !== Number(year) || e.end.getFullYear() !== Number(year)),
    [events, year]
  );

  const nonWorkByKey = useMemo(() => {
    const map = new Map();
    for (const d of nonWorkDays) {
      const parsed = parseDate(d['תאריך']);
      if (parsed) map.set(dateKey(parsed), d);
    }
    return map;
  }, [nonWorkDays]);

  // ------------------------------------------------------------
  // תחזית שבועית מסוננת — מקור לתכנון מול ביצוע ולדשבורד
  // ------------------------------------------------------------
  const filteredForecasts = useMemo(() => {
    return forecasts.filter((f) => {
      const plan = planById.get(firstId(f['תוכנית שתילה']));
      const info = planInfo(plan);
      return matchesFilters(info, f['רבעון']);
    });
  }, [forecasts, planById, planInfo, matchesFilters]);

  /** קיבוץ התחזיות לשבועות (סעיף 23 — השבוע מגיע מ-Airtable, לא מחושב) */
  const weeks = useMemo(() => {
    const map = new Map();
    for (const f of filteredForecasts) {
      const start = parseDate(f['תחילת שבוע']);
      if (!start) continue;
      const key = dateKey(start);
      if (!map.has(key)) {
        map.set(key, {
          key,
          start,
          end: parseDate(f['סוף שבוע']),
          label: f['שבוע'] || '',
          quarter: f['רבעון'],
          rows: [],
        });
      }
      map.get(key).rows.push(f);
    }
    return [...map.values()].sort((a, b) => a.start - b.start);
  }, [filteredForecasts]);

  const weekTotals = useCallback((rows) => {
    let expected = 0;
    let actual = 0;
    let revenue = 0;
    let anyActual = false;
    for (const row of rows) {
      expected += num(row[KG_EXPECTED]) || 0;
      revenue += num(row['הכנסה צפויה']) || 0;
      const a = actualKg(row);
      if (a.received) { actual += a.value; anyActual = true; }
    }
    return { expected, actual, revenue, anyActual };
  }, []);

  // ============================================================
  // כתיבה ל-Airtable (סעיף 44 — Loading, נטרול כפתור, רענון)
  // ============================================================
  const runAction = async (fn) => {
    if (busy) return false; // מניעת Double Click
    setBusy(true);
    setActionError('');
    try {
      await fn();
      await load({ silent: true }); // בהצלחה — קרא מחדש מ-Airtable בלי לקפוץ מהמסך
      setBusy(false);
      return true;
    } catch (e) {
      setActionError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
      setBusy(false);
      return false;
    }
  };

  const savePlan = async () => {
    const form = planForm;
    const fields = {
      'מבנה': form.structureId ? [form.structureId] : [],
      'גידולים': form.cropId ? [form.cropId] : [],
      'תחילת שתילה מקורית': form.plantStart || null,
      'מספר ימי שתילה': Number(form.plantDays) || null,
      'תחילת קטיף מקורית': form.harvestStart || null,
      'מספר ימי קטיף': Number(form.harvestDays) || null,
      'שנת תוכנית': Number(form.year) || null,
    };
    const ok = await runAction(async () => {
      if (form.mode === 'edit') {
        await app.api.update('תוכניות שתילה', form.id, fields);
        await app.api.update('תוכניות שתילה', form.id, { 'חשב תוכנית': true });
      } else {
        const created = await app.api.create('תוכניות שתילה', fields);
        // הפעלת מנגנון החישוב הקיים ב-Airtable — Zite אינו מחשב תאריכים
        if (created?.id) await app.api.update('תוכניות שתילה', created.id, { 'חשב תוכנית': true });
      }
    });
    if (ok) { setPlanForm(null); setPlanDrawer(null); }
  };

  const submitShift = async () => {
    const ok = await runAction(async () => {
      await app.api.update('תוכניות שתילה', shiftForm.planId, {
        'מספר ימי הזזה': Number(shiftForm.days) || 0,
      });
      await app.api.update('תוכניות שתילה', shiftForm.planId, { 'הזז תוכנית': true });
    });
    if (ok) { setShiftForm(null); setPlanDrawer(null); }
  };

  const submitPeriod = async () => {
    const ok = await runAction(async () => {
      await app.api.create('תקופות תוכנית', {
        'תוכנית שתילה': [periodForm.planId],
        'מתאריך': periodForm.from,
        'עד תאריך': periodForm.to,
        'סטטוס': periodForm.status,
        'מקור': 'שינוי ידני',
      });
    });
    if (ok) { setPeriodForm(null); setPlanDrawer(null); }
  };

  const openNewPlan = (base) => {
    setActionError('');
    setPlanForm({
      mode: base?.mode || 'create',
      id: base?.id || null,
      structureId: base?.structureId || '',
      cropId: base?.cropId || '',
      plantStart: base?.plantStart || '',
      plantDays: base?.plantDays ?? '',
      harvestStart: base?.harvestStart || '',
      harvestDays: base?.harvestDays ?? '',
      year: base?.year || year,
    });
  };

  // ============================================================
  // לוח השנה — ניווט
  // ============================================================
  const cursorDate = new Date(cursor.year, cursor.month, cursor.day || 1);
  const activeQuarter = quarterOfDate(cursorDate);

  const stepMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth(), day: 1 });
  };
  const stepWeek = (delta) => {
    const d = new Date(cursor.year, cursor.month, (cursor.day || 1) + delta * 7);
    setCursor({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() });
  };
  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() });
  };
  const goQuarter = (q) => {
    const info = quarterInfo(q);
    setCursor({ year: Number(year), month: info.months[0], day: 1 });
  };

  const monthDays = useMemo(() => {
    const count = new Date(cursor.year, cursor.month + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) => new Date(cursor.year, cursor.month, i + 1));
  }, [cursor.year, cursor.month]);

  const weekDays = useMemo(() => {
    const base = new Date(cursor.year, cursor.month, cursor.day || 1);
    const sunday = new Date(base);
    sunday.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
  }, [cursor]);

  // ============================================================
  // נתוני הדשבורד
  // ============================================================
  const dashboard = useMemo(() => {
    let expected = 0;
    let actual = 0;
    let revenue = 0;
    const byCrop = new Map();
    const byStructure = new Map();
    const byQuarter = new Map();

    // מספר התוכניות והמבנים נספר מהתוכניות עצמן — לא רק מאלה שיש להן תחזית
    const planIds = new Set();
    const structureIds = new Set();
    for (const p of plansOfYear) {
      const info = planInfo(p);
      if (structureFilter && info.structureId !== structureFilter) continue;
      if (cropFilter && info.cropId !== cropFilter) continue;
      planIds.add(info.id);
      if (info.structureId) structureIds.add(info.structureId);
    }

    for (const f of filteredForecasts) {
      const kgE = num(f[KG_EXPECTED]) || 0;
      const kgA = actualKg(f);
      const rev = num(f['הכנסה צפויה']) || 0;
      expected += kgE;
      revenue += rev;
      if (kgA.received) actual += kgA.value;

      const plan = planById.get(firstId(f['תוכנית שתילה']));
      const info = planInfo(plan);
      const cropName = displayName(f['גידול'], '') || info?.crop || 'לא זמין';
      const structName = displayName(f['מבנה'], '') || info?.structure || 'לא זמין';

      const bump = (map, key) => {
        if (!map.has(key)) map.set(key, { name: key, expected: 0, actual: 0 });
        const entry = map.get(key);
        entry.expected += kgE;
        if (kgA.received) entry.actual += kgA.value;
      };
      bump(byCrop, cropName);
      bump(byStructure, structName);

      const q = String(f['רבעון'] || '');
      if (q) {
        if (!byQuarter.has(q)) byQuarter.set(q, { name: `Q${q}`, quarter: q, expected: 0, actual: 0 });
        const entry = byQuarter.get(q);
        entry.expected += kgE;
        if (kgA.received) entry.actual += kgA.value;
      }
    }

    const weekSeries = weeks.map((w) => {
      const totals = weekTotals(w.rows);
      return {
        key: w.key,
        name: formatDate(w.start).slice(0, 5),
        quarter: w.quarter,
        expected: Math.round(totals.expected),
        actual: totals.anyActual ? Math.round(totals.actual) : null,
        revenue: Math.round(totals.revenue),
      };
    });

    // פעילות שתילה/קטיף לפי חודש (סעיף 38)
    const monthly = Array.from({ length: 12 }, (_, m) => ({
      name: new Date(Number(year), m, 1).toLocaleDateString('he-IL', { month: 'short' }),
      month: m,
      quarter: QUARTERS.find((q) => q.months.includes(m)).q,
      שתילה: 0,
      קטיף: 0,
    }));
    for (const e of events) {
      for (let m = 0; m < 12; m++) {
        const monthStart = new Date(Number(year), m, 1);
        const monthEnd = new Date(Number(year), m + 1, 0);
        if (e.start <= monthEnd && e.end >= monthStart) {
          monthly[m][e.style.key] += 1;
        }
      }
    }

    return {
      expected, actual, revenue,
      planCount: planIds.size,
      structureCount: structureIds.size,
      byCrop: [...byCrop.values()].sort((a, b) => b.expected - a.expected),
      byStructure: [...byStructure.values()].sort((a, b) => b.expected - a.expected),
      byQuarter: ['1', '2', '3', '4'].map(
        (q) => byQuarter.get(q) || { name: `Q${q}`, quarter: q, expected: 0, actual: 0 }
      ),
      weekSeries,
      monthly,
    };
  }, [filteredForecasts, weeks, weekTotals, planById, planInfo, events, year,
      plansOfYear, structureFilter, cropFilter]);

  // ============================================================
  // תצוגה
  // ============================================================
  const openPlanCard = (planId) => {
    const plan = planById.get(planId);
    if (plan) { setActionError(''); setPlanDrawer(plan); }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header"><h2>תוכנית שתילה</h2></div>
        <div className="skeleton skeleton-chart" />
      </div>
    );
  }

  return (
    <div>
      {/* ---------- כותרת, שנה ופילטרים (סעיף 46) ---------- */}
      <div className="page-header">
        <h2>תוכנית שתילה — {year}</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => openNewPlan(null)}>+ תוכנית חדשה</button>
          <button className="btn btn-ghost" onClick={() => setShowNonWork(true)}>🗓️ ימי אי עבודה</button>
        </div>
      </div>

      {loadError && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {loadError}</div>}

      <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>שנה</label>
          <select className="select" value={year} onChange={(e) => { setYear(e.target.value); clearFilters(); }}>
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>מבנה</label>
          <select className="select" value={structureFilter} onChange={(e) => setStructureFilter(e.target.value)}>
            <option value="">הכל</option>
            {structureOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>גידול</label>
          <select className="select" value={cropFilter} onChange={(e) => setCropFilter(e.target.value)}>
            <option value="">הכל</option>
            {cropOptions.map(([id, name]) => <option key={id} value={id}>{cropIcon(name)} {name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>רבעון</label>
          <select className="select" value={quarterFilter} onChange={(e) => setQuarterFilter(e.target.value)}>
            <option value="">הכל</option>
            {QUARTERS.map((q) => <option key={q.q} value={q.q}>{q.label}</option>)}
          </select>
        </div>
        {filtersActive && (
          <button className="btn btn-sm btn-ghost" onClick={clearFilters}>✕ נקה פילטר</button>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: 18 }}>
        {[
          { key: 'build', label: 'בניית תוכנית' },
          { key: 'exec', label: 'תכנון מול ביצוע' },
          { key: 'dash', label: 'דשבורד' },
        ].map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= בניית תוכנית ================= */}
      {tab === 'build' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 20px', background: activeQuarter ? `${activeQuarter.color}66` : '#fff',
            borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <b style={{ fontSize: 16 }}>
              {cursorDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
            </b>
            {activeQuarter && (
              <span className="badge" style={{ background: activeQuarter.color, color: '#26313D' }}>
                {activeQuarter.label}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {QUARTERS.map((q) => (
              <button key={q.q} className="btn btn-sm btn-ghost"
                style={{ background: activeQuarter?.q === q.q ? q.color : undefined }}
                onClick={() => goQuarter(q.q)}>
                {q.short}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '10px 20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => (view === 'month' ? stepMonth(-1) : stepWeek(-1))}>‹ קודם</button>
            <button className="btn btn-sm btn-ghost" onClick={goToday}>היום</button>
            <button className="btn btn-sm btn-ghost" onClick={() => (view === 'month' ? stepMonth(1) : stepWeek(1))}>הבא ›</button>
            <div style={{ flex: 1 }} />
            <div className="tabs" style={{ width: 'fit-content' }}>
              {[['month', 'חודש'], ['week', 'שבוע']].map(([key, label]) => (
                <button key={key} className={`tab ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>{label}</button>
              ))}
            </div>
          </div>

          {crossesYear && (
            <div style={{
              margin: '0 20px 10px', padding: '8px 12px', borderRadius: 8, fontSize: 12,
              background: 'var(--docs-soft)', color: 'var(--text-secondary)',
            }}>
              ℹ️ חלק מהתוכניות של {year} חוצות שנה — הן מוצגות לפי טווח התאריכים האמיתי שלהן.
            </div>
          )}

          <CalendarGrid
            days={view === 'month' ? monthDays : weekDays}
            leadingBlanks={view === 'month' ? monthDays[0].getDay() : 0}
            tall={view === 'week'}
            eventsOnDate={eventsOnDate}
            nonWorkByKey={nonWorkByKey}
            onEvent={(e) => openPlanCard(e.info.id)}
          />

          <div style={{ padding: '10px 20px', display: 'flex', gap: 16, borderTop: '1px solid var(--border)', flexWrap: 'wrap', fontSize: 12 }}>
            <LegendSwatch bg={PLANT.bg} border={PLANT.border} label="שתילה" />
            <LegendSwatch bg={HARVEST.bg} border={HARVEST.border} label="קטיף" />
            {QUARTERS.map((q) => <LegendSwatch key={q.q} bg={q.color} border={q.color} label={q.short} />)}
            <LegendSwatch bg={KIND_STYLE.shabbat.bg} border={KIND_STYLE.shabbat.border} label="שבת" />
            <LegendSwatch bg={KIND_STYLE.jewish.bg} border={KIND_STYLE.jewish.border} label="חג יהודי" />
            <LegendSwatch bg={KIND_STYLE.thai.bg} border={KIND_STYLE.thai.border} label="חג תאילנדי" />
            <span style={{ color: 'var(--text-muted)' }}>עבר מוצג בשקיפות · היום במסגרת בולטת</span>
          </div>
        </div>
      )}

      {/* ================= תכנון מול ביצוע ================= */}
      {tab === 'exec' && (
        weeks.length === 0 ? (
          <div className="card empty-state">אין נתוני תחזית לשנה או לפילטרים שנבחרו.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {weeks.map((w) => {
              const totals = weekTotals(w.rows);
              const info = quarterInfo(w.quarter);
              return (
                <div key={w.key} className="card clickable" onClick={() => setWeekDrawer(w)}
                  style={{ cursor: 'pointer', borderRight: `4px solid ${info?.color || 'var(--border)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <b>שבוע {formatDate(w.start)} – {w.end ? formatDate(w.end) : 'לא זמין'}</b>
                      <QuarterBadge q={w.quarter} />
                    </div>
                    <PlannedVsActual
                      expected={totals.expected}
                      actual={{ received: totals.anyActual, value: totals.actual }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {w.rows.map((row) => {
                      const plan = planById.get(firstId(row['תוכנית שתילה']));
                      const pInfo = planInfo(plan);
                      const a = actualKg(row);
                      return (
                        <div key={row.id}
                          onClick={(ev) => { ev.stopPropagation(); if (pInfo) openPlanCard(pInfo.id); }}
                          style={{
                            border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px',
                            fontSize: 12, cursor: 'pointer', background: 'var(--bg-secondary)',
                          }}>
                          <div><b>{pInfo?.icon || '🌱'} {displayName(row['מבנה'], pInfo?.structure || 'לא זמין')}</b></div>
                          <div>{displayName(row['גידול'], pInfo?.crop || 'לא זמין')} · קטיף</div>
                          <div style={{ color: PLANNED_COLOR }}>צפוי: {formatNumber(num(row[KG_EXPECTED]), 0)} ק"ג</div>
                          <div style={{ color: a.received ? ACTUAL_COLOR : 'var(--text-muted)' }}>
                            {a.received ? `בפועל: ${formatNumber(a.value, 0)} ק"ג` : 'טרם התקבל ביצוע'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ================= דשבורד ================= */}
      {tab === 'dash' && (
        <Dashboard data={dashboard} year={year} onWeek={(key) => {
          const w = weeks.find((x) => x.key === key);
          if (w) setWeekDrawer(w);
        }} onStructure={(name) => {
          const match = structureOptions.find(([, n]) => n === name);
          if (match) setStructureFilter(match[0]);
        }} onCrop={(name) => {
          const match = cropOptions.find(([, n]) => n === name);
          if (match) setCropFilter(match[0]);
        }} onQuarter={(q) => setQuarterFilter(String(q))} />
      )}

      {/* ================= טבלת אקסל — תכנון מול ביצוע (סעיף 4.3) ================= */}
      {tab === 'dash' && weeks.length > 0 && (
        <ExcelTable weeks={weeks} weekTotals={weekTotals} />
      )}

      {/* ================= כרטיס תוכנית ================= */}
      {planDrawer && (
        <PlanCard
          plan={planDrawer}
          info={planInfo(planDrawer)}
          forecasts={forecasts.filter((f) => firstId(f['תוכנית שתילה']) === planDrawer.id)}
          periods={periods.filter((p) => firstId(p['תוכנית שתילה']) === planDrawer.id)}
          busy={busy}
          error={actionError}
          onClose={() => setPlanDrawer(null)}
          onShift={() => { setActionError(''); setShiftForm({ planId: planDrawer.id, days: '' }); }}
          onPeriod={() => { setActionError(''); setPeriodForm({ planId: planDrawer.id, from: '', to: '', status: 'שתילה' }); }}
          onEdit={() => {
            const i = planInfo(planDrawer);
            openNewPlan({
              mode: 'edit', id: planDrawer.id,
              structureId: i.structureId, cropId: i.cropId,
              plantStart: String(planDrawer['תחילת שתילה מקורית'] || '').slice(0, 10),
              plantDays: planDrawer['מספר ימי שתילה'] ?? '',
              harvestStart: String(planDrawer['תחילת קטיף מקורית'] || '').slice(0, 10),
              harvestDays: planDrawer['מספר ימי קטיף'] ?? '',
              year: i.year || year,
            });
          }}
          onDuplicate={() => {
            const i = planInfo(planDrawer);
            openNewPlan({
              mode: 'create',
              structureId: i.structureId, cropId: i.cropId,
              plantDays: planDrawer['מספר ימי שתילה'] ?? '',
              harvestDays: planDrawer['מספר ימי קטיף'] ?? '',
              year: year,
            });
          }}
        />
      )}

      {/* ================= פרטי שבוע ================= */}
      {weekDrawer && (
        <WeekDetails
          week={weekDrawer}
          totals={weekTotals(weekDrawer.rows)}
          planById={planById}
          planInfo={planInfo}
          onClose={() => setWeekDrawer(null)}
          onPlan={(id) => { setWeekDrawer(null); openPlanCard(id); }}
        />
      )}

      {/* ================= טופס תוכנית ================= */}
      {planForm && (
        <div className="modal-overlay" onClick={() => !busy && setPlanForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {planForm.mode === 'edit' ? 'עריכת תוכנית' : 'תוכנית שתילה חדשה'}
            </h3>
            {actionError && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {actionError}</div>}
            <form onSubmit={(e) => { e.preventDefault(); savePlan(); }}>
              <div className="form-group">
                <label>מבנה <span className="required">*</span></label>
                <select className="select" style={{ width: '100%' }} required
                  value={planForm.structureId} onChange={(e) => setPlanForm({ ...planForm, structureId: e.target.value })}>
                  <option value="">בחר מבנה...</option>
                  {structures.map((s) => (
                    <option key={s.id} value={s.id}>{s['מספר מבנה'] ? `מבנה ${s['מספר מבנה']}` : s.id}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>גידול <span className="required">*</span></label>
                <select className="select" style={{ width: '100%' }} required
                  value={planForm.cropId} onChange={(e) => setPlanForm({ ...planForm, cropId: e.target.value })}>
                  <option value="">בחר גידול...</option>
                  {crops.map((c) => (
                    <option key={c.id} value={c.id}>{cropIcon(c['שם גידול'])} {c['שם גידול'] || 'לא זמין'}</option>
                  ))}
                </select>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="form-group">
                  <label>תחילת שתילה מקורית <span className="required">*</span></label>
                  <input className="input" style={{ width: '100%' }} type="date" required
                    value={planForm.plantStart} onChange={(e) => setPlanForm({ ...planForm, plantStart: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>מספר ימי שתילה <span className="required">*</span></label>
                  <input className="input" style={{ width: '100%' }} type="number" min="1" required
                    value={planForm.plantDays} onChange={(e) => setPlanForm({ ...planForm, plantDays: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>תחילת קטיף מקורית <span className="required">*</span></label>
                  <input className="input" style={{ width: '100%' }} type="date" required
                    value={planForm.harvestStart} onChange={(e) => setPlanForm({ ...planForm, harvestStart: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>מספר ימי קטיף <span className="required">*</span></label>
                  <input className="input" style={{ width: '100%' }} type="number" min="1" required
                    value={planForm.harvestDays} onChange={(e) => setPlanForm({ ...planForm, harvestDays: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>שנת תוכנית <span className="required">*</span></label>
                <input className="input" style={{ width: '100%' }} type="number" required
                  value={planForm.year} onChange={(e) => setPlanForm({ ...planForm, year: e.target.value })} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                תאריכי הסיום, התקופות והתחזית השבועית מחושבים ב-Airtable לאחר השמירה.
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPlanForm(null)}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'שומר...' : planForm.mode === 'edit' ? 'שמור שינויים' : 'צור תוכנית'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= הזזת תוכנית ================= */}
      {shiftForm && (
        <div className="modal-overlay" onClick={() => !busy && setShiftForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>הזז תוכנית</h3>
            {actionError && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {actionError}</div>}
            <form onSubmit={(e) => { e.preventDefault(); submitShift(); }}>
              <div className="form-group">
                <label>מספר ימי הזזה <span className="required">*</span></label>
                <input className="input" style={{ width: '100%' }} type="number" required autoFocus
                  value={shiftForm.days} onChange={(e) => setShiftForm({ ...shiftForm, days: e.target.value })} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Airtable מטפל בימי אי עבודה, בחפיפות ובהזזת התוכניות הבאות באותו מבנה.
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setShiftForm(null)}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={busy || shiftForm.days === ''}>
                  {busy ? 'מזיז...' : 'הזז תוכנית'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= שינוי תקופה ================= */}
      {periodForm && (
        <div className="modal-overlay" onClick={() => !busy && setPeriodForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>שינוי תקופה</h3>
            {actionError && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {actionError}</div>}
            <form onSubmit={(e) => { e.preventDefault(); submitPeriod(); }}>
              <div className="form-group">
                <label>מתאריך <span className="required">*</span></label>
                <input className="input" style={{ width: '100%' }} type="date" required
                  value={periodForm.from} onChange={(e) => setPeriodForm({ ...periodForm, from: e.target.value })} />
              </div>
              <div className="form-group">
                <label>עד תאריך <span className="required">*</span></label>
                <input className="input" style={{ width: '100%' }} type="date" required
                  value={periodForm.to} onChange={(e) => setPeriodForm({ ...periodForm, to: e.target.value })} />
              </div>
              <div className="form-group">
                <label>סטטוס <span className="required">*</span></label>
                <select className="select" style={{ width: '100%' }} required
                  value={periodForm.status} onChange={(e) => setPeriodForm({ ...periodForm, status: e.target.value })}>
                  <option value="שתילה">שתילה</option>
                  <option value="קטיף">קטיף</option>
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPeriodForm(null)}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'שומר...' : 'שמור תקופה'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= ימי אי עבודה ================= */}
      {showNonWork && (
        <div className="modal-overlay" onClick={() => setShowNonWork(false)}>
          <div className="drawer struct-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <span>ימי אי עבודה — {year}</span>
              <button className="drawer-close" onClick={() => setShowNonWork(false)}>✕</button>
            </div>
            <div className="drawer-body">
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>תאריך</th><th>חג</th><th>סוג החג</th></tr></thead>
                  <tbody>
                    {nonWorkDays
                      .filter((d) => String(d['תאריך'] || '').slice(0, 4) === String(year))
                      .sort((a, b) => String(a['תאריך']).localeCompare(String(b['תאריך'])))
                      .map((d) => {
                        const parsed = parseDate(d['תאריך']);
                        const info = parsed ? holidayInfo(parsed, d) : null;
                        return (
                          <tr key={d.id}>
                            <td>{formatDate(d['תאריך'])}</td>
                            <td>{info?.name.he || 'לא זמין'}</td>
                            <td>{info ? <span className="badge" style={{ background: info.style.bg, color: info.style.border }}>{d['סוג החג'] || 'לא זמין'}</span> : (d['סוג החג'] || 'לא זמין')}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {nonWorkDays.filter((d) => String(d['תאריך'] || '').slice(0, 4) === String(year)).length === 0 && (
                <div className="empty-state">אין ימי אי עבודה לשנה זו.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// לוח השנה
// ============================================================
function LegendSwatch({ bg, border, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 12, height: 12, background: bg, border: `1px solid ${border}`, borderRadius: 3 }} />
      {label}
    </span>
  );
}

function CalendarGrid({ days, leadingBlanks, tall, eventsOnDate, nonWorkByKey, onEvent }) {
  const today = startOfToday();
  const minHeight = tall ? 150 : 86;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', fontSize: 12 }}>
      {['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].map((d) => (
        <div key={d} style={{
          padding: 6, textAlign: 'center', background: 'var(--bg-secondary)',
          fontWeight: 600, borderBottom: '1px solid var(--border)',
        }}>{d}</div>
      ))}

      {Array.from({ length: leadingBlanks }).map((_, i) => (
        <div key={`blank-${i}`} style={{ minHeight, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }} />
      ))}

      {days.map((day) => {
        const dayEvents = eventsOnDate(day);
        const isToday = day.getTime() === today.getTime();
        const isPast = day < today;
        // שבת / חג — כל רקע התא מודגש, בצבע לפי הסוג, עם שם החג (שלב 5)
        const holiday = holidayInfo(day, nonWorkByKey.get(dateKey(day)));

        return (
          <div key={dateKey(day)} title={holiday ? holiday.name.he : undefined} style={{
            minHeight, padding: 4, borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            background: holiday ? holiday.style.bg : '#fff',
            boxShadow: holiday ? `inset 4px 0 0 ${holiday.style.border}` : 'none',
            outline: isToday ? '2px solid var(--accent-top, #3578E5)' : 'none',
            outlineOffset: '-2px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: isToday ? 800 : 500, color: isToday ? UPDATED_ACCENT : 'inherit' }}>
                {day.getDate()}
              </span>
              {holiday && (
                <span style={{
                  fontSize: 9.5, fontWeight: 700, color: holiday.style.border, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80%',
                }}>
                  {holiday.name.he}
                </span>
              )}
            </div>

            {dayEvents.map((e) => (
              <div key={e.id} onClick={() => onEvent(e)} title={`${e.info.structure} · ${e.info.crop} · ${e.style.label}`}
                style={{
                  background: e.style.bg, border: `1px solid ${e.style.border}`, borderRadius: 5,
                  padding: '2px 4px', fontSize: 10.5, marginTop: 2, cursor: 'pointer',
                  opacity: e.end < today ? 0.55 : 1,
                }}>
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.info.icon} {e.info.structure}
                </div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.info.crop}</div>
                <div style={{ fontWeight: 600 }}>{e.style.label}</div>
                {tall && <div style={{ fontSize: 9.5, color: 'var(--text-secondary)' }}>
                  {formatDate(e.start).slice(0, 5)}–{formatDate(e.end).slice(0, 5)}
                </div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// כרטיס תוכנית (סעיפים 14–15)
// ============================================================
function PlanCard({ plan, info, forecasts, periods, busy, error, onClose, onShift, onPeriod, onEdit, onDuplicate }) {
  const pairs = [
    ['תחילת שתילה', 'תחילת שתילה מקורית', 'תחילת שתילה מעודכנת'],
    ['סוף שתילה', 'סוף שתילה מקורי', 'סוף שתילה מעודכן'],
    ['תחילת קטיף', 'תחילת קטיף מקורית', 'תחילת קטיף מעודכנת'],
    ['סוף קטיף', 'סוף קטיף מקורי', 'סוף קטיף מעודכן'],
  ];
  const changed = (a, b) =>
    String(plan[a] || '').slice(0, 10) !== String(plan[b] || '').slice(0, 10) && plan[b];
  const anyChanged = pairs.some(([, o, u]) => changed(o, u));

  const sorted = [...forecasts].sort(
    (a, b) => String(a['תחילת שבוע'] || '').localeCompare(String(b['תחילת שבוע'] || ''))
  );

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer struct-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>{info.icon} כרטיס תוכנית — תוכנית {info.number ?? 'חדשה'}</span>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {error && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>מבנה</div><b>{info.structure}</b></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>גידול</div><b>{info.icon} {info.crop}</b></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>שטח בדונם</div><b>{info.area !== null ? formatNumber(info.area) : 'לא זמין'}</b></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>שנת תוכנית</div><b>{info.year ?? 'לא זמין'}</b></div>
            </div>
          </div>

          <div className="grid-2" style={{ gap: 14, marginBottom: 14 }}>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>תכנון מקורי</div>
              {pairs.map(([label, original]) => (
                <DateRow key={original} label={label} value={plan[original]} changed={false} />
              ))}
            </div>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                תוכנית מעודכנת
                {anyChanged
                  ? <span className="badge" style={{ background: '#E8F1FF', color: UPDATED_ACCENT }}>עודכן</span>
                  : <span className="badge" style={{ background: 'var(--bg-secondary)' }}>ללא שינוי</span>}
              </div>
              {pairs.map(([label, original, updated]) => (
                <DateRow key={updated} label={label} value={plan[updated]} changed={!!changed(original, updated)} />
              ))}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>תחזית וביצוע</div>
            {sorted.length === 0 ? (
              <div className="empty-state">אין תחזית שבועית לתוכנית זו.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>שבוע</th><th>רבעון</th><th>קג לדונם</th><th>שטח בדונם</th>
                      <th>ימי קטיף</th><th>קג צפוי</th><th>קג בפועל</th><th>מחיר לקג</th><th>הכנסה צפויה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((f) => {
                      const a = actualKg(f);
                      return (
                        <tr key={f.id}>
                          <td>{f['שבוע'] || formatDate(f['תחילת שבוע'])}</td>
                          <td><QuarterBadge q={f['רבעון']} /></td>
                          <td>{formatNumber(num(f['קג לדונם לשבוע (from תפוקה רבעונית)']))}</td>
                          <td>{formatNumber(num(f['שטח בדונם (from מבנה) (from תוכנית שתילה)']))}</td>
                          <td>{formatNumber(num(f['ימי קטיף פעילים']), 0)}</td>
                          <td style={{ color: PLANNED_COLOR, fontWeight: 600 }}>{formatNumber(num(f[KG_EXPECTED]), 0)}</td>
                          <td style={{ color: a.received ? ACTUAL_COLOR : 'var(--text-muted)', fontWeight: 600 }}>
                            {a.received ? formatNumber(a.value, 0) : 'טרם'}
                          </td>
                          <td>{formatMoney(num(f['מחיר לקג מעודכן']))}</td>
                          <td>{formatMoney(num(f['הכנסה צפויה']))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>תקופות</div>
            {periods.length === 0 ? (
              <div className="empty-state">אין תקופות לתוכנית זו.</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>סטטוס</th><th>מתאריך</th><th>עד תאריך</th><th>מקור</th></tr></thead>
                  <tbody>
                    {[...periods]
                      .sort((a, b) => String(a['מתאריך']).localeCompare(String(b['מתאריך'])))
                      .map((p) => {
                        const isHarvest = String(p['סטטוס'] || '').includes('קטיף');
                        const style = isHarvest ? HARVEST : PLANT;
                        return (
                          <tr key={p.id}>
                            <td>
                              <span className="badge" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                                {p['סטטוס']}
                              </span>
                            </td>
                            <td>{formatDate(p['מתאריך'])}</td>
                            <td>{formatDate(p['עד תאריך'])}</td>
                            <td>
                              {p['מקור'] === 'שינוי ידני'
                                ? <span className="badge badge-warn">ידני</span>
                                : (p['מקור'] || 'לא זמין')}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy} onClick={onEdit}>עריכת תוכנית</button>
            <button className="btn btn-ghost" disabled={busy} onClick={onShift}>הזז תוכנית</button>
            <button className="btn btn-ghost" disabled={busy} onClick={onPeriod}>שינוי תקופה</button>
            <button className="btn btn-ghost" disabled={busy} onClick={onDuplicate}>שכפול תוכנית</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// פרטי שבוע (סעיף 26)
// ============================================================
function WeekDetails({ week, totals, planById, planInfo, onClose, onPlan }) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer struct-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>שבוע {formatDate(week.start)} – {week.end ? formatDate(week.end) : 'לא זמין'}</span>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <div className="kpi-grid" style={{ marginBottom: 14 }}>
            <div className="kpi-card">
              <div className="kpi-top"><span className="kpi-label">סה"כ ק"ג צפוי</span></div>
              <div className="kpi-value" style={{ color: PLANNED_COLOR }}>{formatNumber(totals.expected, 0)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><span className="kpi-label">סה"כ ק"ג בפועל</span></div>
              <div className="kpi-value" style={{ color: totals.anyActual ? ACTUAL_COLOR : 'var(--text-muted)' }}>
                {totals.anyActual ? formatNumber(totals.actual, 0) : 'טרם התקבל ביצוע'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><span className="kpi-label">סה"כ הכנסה צפויה</span></div>
              <div className="kpi-value">{formatMoney(totals.revenue)}</div>
            </div>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>פירוט לפי מבנים</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>מבנה</th><th>גידול</th><th>רבעון</th><th>קג לדונם</th><th>שטח בדונם</th>
                    <th>ימי קטיף</th><th>קג צפוי</th><th>קג בפועל</th><th>מחיר לקג</th><th>הכנסה צפויה</th>
                  </tr>
                </thead>
                <tbody>
                  {week.rows.map((row) => {
                    const info = planInfo(planById.get(firstId(row['תוכנית שתילה'])));
                    const a = actualKg(row);
                    const cropName = displayName(row['גידול'], info?.crop || 'לא זמין');
                    return (
                      <tr key={row.id} className="clickable" style={{ cursor: info ? 'pointer' : 'default' }}
                        onClick={() => info && onPlan(info.id)}>
                        <td>{cropIcon(cropName)} {displayName(row['מבנה'], info?.structure || 'לא זמין')}</td>
                        <td>{cropName}</td>
                        <td><QuarterBadge q={row['רבעון']} /></td>
                        <td>{formatNumber(num(row['קג לדונם לשבוע (from תפוקה רבעונית)']))}</td>
                        <td>{formatNumber(num(row['שטח בדונם (from מבנה) (from תוכנית שתילה)']))}</td>
                        <td>{formatNumber(num(row['ימי קטיף פעילים']), 0)}</td>
                        <td style={{ color: PLANNED_COLOR, fontWeight: 600 }}>{formatNumber(num(row[KG_EXPECTED]), 0)}</td>
                        <td style={{ color: a.received ? ACTUAL_COLOR : 'var(--text-muted)', fontWeight: 600 }}>
                          {a.received ? formatNumber(a.value, 0) : 'טרם'}
                        </td>
                        <td>{formatMoney(num(row['מחיר לקג מעודכן']))}</td>
                        <td>{formatMoney(num(row['הכנסה צפויה']))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// דשבורד (סעיפים 28–40)
// ============================================================
function Dashboard({ data, year, onWeek, onStructure, onCrop, onQuarter }) {
  const grid = <CartesianGrid {...GRID_PROPS} />;
  const weekCount = data.weekSeries.length;

  const kpis = [
    { label: 'סה"כ ק"ג צפוי', value: formatNumber(data.expected, 0), color: PLANNED_COLOR },
    { label: 'סה"כ ק"ג בפועל', value: formatNumber(data.actual, 0), color: ACTUAL_COLOR },
    { label: 'סה"כ הכנסה צפויה', value: formatMoney(data.revenue), color: 'var(--revenue)' },
    { label: 'מספר תוכניות', value: formatNumber(data.planCount, 0), color: 'var(--planting)' },
    { label: 'מבנים פעילים', value: formatNumber(data.structureCount, 0), color: 'var(--workers)' },
  ];

  if (data.expected === 0 && data.planCount === 0) {
    return <div className="card empty-state">אין נתונים לשנה או לפילטרים שנבחרו.</div>;
  }

  return (
    <div>
      <h3 style={{ marginBottom: 12 }}>דשבורד תוכנית שתילה — {year}</h3>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-top"><span className="kpi-label">{k.label}</span></div>
            <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>צפוי מול בפועל לאורך השנה</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.weekSeries} margin={CHART_MARGIN}
            onClick={(e) => e?.activePayload?.[0] && onWeek(e.activePayload[0].payload.key)}>
            {grid}
            <XAxis dataKey="name" {...xAxisProps(weekCount)} />
            <YAxis {...yAxisProps()} />
            <Tooltip content={<WeekTooltip />} />
            <Legend wrapperStyle={LEGEND_STYLE} />
            <Line type="monotone" dataKey="expected" name='ק"ג צפוי' stroke={PLANNED_COLOR} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="actual" name='ק"ג בפועל' stroke={ACTUAL_COLOR} strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>הכנסה צפויה לפי שבוע</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.weekSeries} margin={CHART_MARGIN}
            onClick={(e) => e?.activePayload?.[0] && onWeek(e.activePayload[0].payload.key)}>
            {grid}
            <XAxis dataKey="name" {...xAxisProps(weekCount)} />
            <YAxis {...yAxisProps({ money: true })} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
            <Bar dataKey="revenue" name="הכנסה צפויה" fill="#08A878" radius={[6, 6, 0, 0]} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
        <DonutCard title='ק"ג צפוי לפי גידול' rows={data.byCrop} total={data.expected} withIcon onSlice={onCrop} />
        <DonutCard title='ק"ג צפוי לפי מבנה' rows={data.byStructure} total={data.expected} onSlice={onStructure} />
      </div>

      <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>ק"ג בפועל לפי מבנה</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" margin={CHART_MARGIN}
              data={[...data.byStructure].sort((a, b) => b.actual - a.actual)}
              onClick={(e) => e?.activePayload?.[0] && onStructure(e.activePayload[0].payload.name)}>
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis type="number" {...xAxisProps(0)} />
              <YAxis dataKey="name" {...yCategoryProps({ width: 96 })} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v, 0)} ק"ג`} />
              <Bar dataKey="actual" name='ק"ג בפועל' fill={ACTUAL_COLOR} radius={[0, 6, 6, 0]} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>צפוי מול בפועל לפי גידול</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byCrop} margin={CHART_MARGIN_ROTATED}
              onClick={(e) => e?.activePayload?.[0] && onCrop(e.activePayload[0].payload.name)}>
              {grid}
              <XAxis dataKey="name" {...xAxisProps(data.byCrop.length, { rotate: data.byCrop.length > 4 })} />
              <YAxis {...yAxisProps()} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v, 0)} ק"ג`} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="expected" name='ק"ג צפוי' fill={PLANNED_COLOR} radius={[6, 6, 0, 0]} cursor="pointer" />
              <Bar dataKey="actual" name='ק"ג בפועל' fill={ACTUAL_COLOR} radius={[6, 6, 0, 0]} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>תכנון מול ביצוע לפי רבעון</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byQuarter} margin={CHART_MARGIN}
              onClick={(e) => e?.activePayload?.[0] && onQuarter(e.activePayload[0].payload.quarter)}>
              {grid}
              <XAxis dataKey="name" {...xAxisProps(4)} />
              <YAxis {...yAxisProps()} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v, 0)} ק"ג`} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="expected" name='ק"ג צפוי' fill={PLANNED_COLOR} radius={[6, 6, 0, 0]} cursor="pointer" />
              <Bar dataKey="actual" name='ק"ג בפועל' fill={ACTUAL_COLOR} radius={[6, 6, 0, 0]} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
          {/* פס צבע הרבעון מתחת לכל קבוצת עמודות */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '0 30px' }}>
            {QUARTERS.map((q) => (
              <div key={q.q} style={{ height: 6, background: q.color, borderRadius: 3 }} title={q.label} />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>חלוקת הק"ג הצפוי בין הרבעונים</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.byQuarter.filter((q) => q.expected > 0)} dataKey="expected" nameKey="name"
                innerRadius={55} outerRadius={95} paddingAngle={2}
                onClick={(slice) => onQuarter(slice?.payload?.quarter ?? slice?.quarter)}>
                {data.byQuarter.filter((q) => q.expected > 0).map((q) => (
                  <Cell key={q.name} fill={quarterInfo(q.quarter)?.color || '#DDD'} stroke="#C9D2DC" cursor="pointer" />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v, n) => [`${formatNumber(v, 0)} ק"ג (${((v / (data.expected || 1)) * 100).toFixed(1)}%)`, n]} />
              <Legend wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>פעילות שתילה וקטיף לאורך השנה</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.monthly} margin={CHART_MARGIN}>
            {grid}
            <XAxis dataKey="name" {...xAxisProps(12)} />
            <YAxis {...yAxisProps({ width: 44, allowDecimals: false, formatter: (v) => String(v) })} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [`${formatNumber(v, 0)} תקופות`, n]} />
            <Legend wrapperStyle={LEGEND_STYLE} />
            <Bar dataKey="שתילה" fill={PLANT.border} radius={[6, 6, 0, 0]} />
            <Bar dataKey="קטיף" fill={HARVEST.border} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '0 30px', marginTop: 4 }}>
          {QUARTERS.map((q) => (
            <div key={q.q} style={{ textAlign: 'center', fontSize: 11, background: q.color, borderRadius: 4, padding: '2px 0' }}>
              {q.short}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12 }}>
      <div><b>שבוע {label}</b> {row.quarter ? <QuarterBadge q={row.quarter} /> : null}</div>
      <div style={{ color: PLANNED_COLOR }}>ק"ג צפוי: {formatNumber(row.expected, 0)}</div>
      <div style={{ color: ACTUAL_COLOR }}>
        ק"ג בפועל: {row.actual === null ? 'טרם התקבל ביצוע' : formatNumber(row.actual, 0)}
      </div>
    </div>
  );
}
function ExcelTable({ weeks, weekTotals }) {
  const fmt = (v) => formatNumber(v, 0);
  const money = (v) => formatMoney(v, 0);

  // ---- חישוב נתוני כל שבוע (כולל קרטונים והכנסה בפועל) ----
  const weekRows = weeks.map((w) => {
    const t = weekTotals(w.rows);
    let actualRevenue = 0;
    let anyActual = false;
    let actualKgSum = 0;
    for (const row of w.rows) {
      const a = actualKg(row);
      if (!a.received) continue;
      actualKgSum += a.value;
      const price = num(row['מחיר לקג מעודכן'])
        ?? num(row['מחיר משוער לקג (from מחירי גידול משוערים)']) ?? 0;
      actualRevenue += a.value * price;
      anyActual = true;
    }
    return {
      key: w.key,
      month: w.start.getMonth(),
      label: formatDate(w.start).slice(0, 5),
      expectedKg: t.expected,
      actualKg: actualKgSum,
      expectedCartons: t.expected / KG_PER_CARTON,
      actualCartons: actualKgSum / KG_PER_CARTON,
      expectedRevenue: t.revenue,
      actualRevenue: anyActual ? actualRevenue : null,
      hasActual: anyActual,
    };
  });

  // ---- קיבוץ לסיכום חודשי ----
  const byMonth = new Map();
  const now = new Date();
  for (const r of weekRows) {
    const key = `${r.month}-${now.getFullYear()}`;
    if (!byMonth.has(key)) byMonth.set(key, {
      label: now.toLocaleDateString('he-IL', { month: 'long' }),
      expectedKg: 0, actualKg: 0, expectedRevenue: 0, actualRevenue: 0, hasActual: false,
    });
    const m = byMonth.get(key);
    m.expectedKg += r.expectedKg;
    m.actualKg += r.actualKg;
    m.expectedRevenue += r.expectedRevenue;
    if (r.actualRevenue !== null) { m.actualRevenue += r.actualRevenue; m.hasActual = true; }
  }

  // ---- סה"כ שנתי ----
  const totals = weekRows.reduce((acc, r) => {
    acc.expectedKg += r.expectedKg;
    acc.actualKg += r.actualKg;
    acc.expectedRevenue += r.expectedRevenue;
    if (r.actualRevenue !== null) acc.actualRevenue += r.actualRevenue;
    return acc;
  }, { expectedKg: 0, actualKg: 0, expectedRevenue: 0, actualRevenue: 0 });

  const showActual = weekRows.some((r) => r.hasActual);
  const actualCell = (val, has) => (has ? fmt(val) : 'טרם בוצע');

  const head = ['שבוע', 'ק"ג צפוי', 'ק"ג בפועל', 'קרטונים צפוי', 'קרטונים בפועל', 'הכנסה צפויה', 'הכנסה בפועל'];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        טבלת נתונים — תכנון מול ביצוע {showActual ? '' : '(חסר ביצוע)'}
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="data-table" style={{ minWidth: 860 }}>
          <thead>
            <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {weekRows.map((r) => (
              <tr key={r.key}>
                <td>שבוע {r.label}</td>
                <td style={{ color: PLANNED_COLOR, fontWeight: 600 }}>{fmt(r.expectedKg)}</td>
                <td style={{ color: r.hasActual ? ACTUAL_COLOR : 'var(--text-muted)', fontWeight: 600 }}>
                  {r.hasActual ? fmt(r.actualKg) : 'טרם'}
                </td>
                <td>{fmt(r.expectedCartons)}</td>
                <td style={{ color: r.hasActual ? ACTUAL_COLOR : 'var(--text-muted)' }}>
                  {r.hasActual ? fmt(r.actualCartons) : 'טרם'}
                </td>
                <td>{money(r.expectedRevenue)}</td>
                <td>{r.actualRevenue !== null ? money(r.actualRevenue) : '—'}</td>
              </tr>
            ))}

            {/* סיכום חודשי */}
            {[...byMonth.entries()].map(([key, m]) => (
              <tr key={key} style={{ background: 'var(--bg-secondary)', fontWeight: 700 }}>
                <td>{m.label}</td>
                <td>{fmt(m.expectedKg)}</td>
                <td style={{ color: m.hasActual ? ACTUAL_COLOR : 'var(--text-muted)' }}>
                  {m.hasActual ? fmt(m.actualKg) : 'טרם'}
                </td>
                <td>{fmt(m.expectedKg / KG_PER_CARTON)}</td>
                <td>{m.hasActual ? fmt(m.actualKg / KG_PER_CARTON) : 'טרם'}</td>
                <td>{money(m.expectedRevenue)}</td>
                <td>{m.hasActual ? money(m.actualRevenue) : '—'}</td>
              </tr>
            ))}

            {/* סה"כ שנתי */}
            <tr style={{ background: 'var(--docs-soft)', fontWeight: 800 }}>
              <td>סה"כ שנתי</td>
              <td>{fmt(totals.expectedKg)}</td>
              <td style={{ color: ACTUAL_COLOR }}>{fmt(totals.actualKg)}</td>
              <td>{fmt(totals.expectedKg / KG_PER_CARTON)}</td>
              <td>{fmt(totals.actualKg / KG_PER_CARTON)}</td>
              <td>{money(totals.expectedRevenue)}</td>
              <td>{totals.actualRevenue ? money(totals.actualRevenue) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
        קרטונים מחושבים: ק"ג ÷ {KG_PER_CARTON} (משקל ממוצע לקרטון). הכנסה בפועל = ק"ג בפועל × מחיר לק"ג.
      </div>
    </div>
  );
}

function DonutCard({ title, rows, total, withIcon, onSlice }) {
  const data = rows.filter((r) => r.expected > 0);
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      {data.length === 0 ? (
        <div className="empty-state">אין נתונים לתקופה זו.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey="expected" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}
              onClick={(slice) => onSlice?.(slice?.payload?.name ?? slice?.name)}>
              {data.map((row, i) => (
                <Cell key={row.name} fill={CHART_COLORS[i % CHART_COLORS.length]} cursor="pointer" />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [
              `${formatNumber(v, 0)} ק"ג (${((v / (total || 1)) * 100).toFixed(1)}%)`,
              withIcon ? `${cropIcon(n)} ${n}` : n,
            ]} />
            <Legend wrapperStyle={LEGEND_STYLE} formatter={(v) => (withIcon ? `${cropIcon(v)} ${v}` : v)} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
