import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useAutoRefresh } from '../utils/live.js';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { exportCsv, fileStamp } from '../utils/table.js';
import { formatMoney } from '../utils/format.js';
import { formatDate, formatNumber } from '../utils/format.js';
import { pick } from '../utils/field.js';
import { displayName, firstId } from '../utils/resolve.js';
import PageHeader from '../components/PageHeader.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';
import { confirmDialog, toast } from '../utils/ui.js';

// ============================================================
// תכנון טיפולים — סעיפים 22 ו-25 באיפיון
//
// מקור הנתונים: טבלת "ריסוסים". Airtable מחשב כמות/מחיר; המסך מציג,
// יוצר ומעדכן בלבד. "תאריך" מגיע כ-ISO ("2026-08-04T10:03:00.000Z")
// או כטווח טקסטואלי ("16/07/2026-23/07/2026") — שני הפורמטים נתמכים.
// ============================================================

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const TYPES = {
  'ריסוס': { bg: '#FFF3D6', border: '#F59E0B', label: 'ריסוס' },
  'הגמעה': { bg: '#E8F1FF', border: '#3B82F6', label: 'הגמעה' },
  'פיזור מועילים': { bg: '#E5F7EE', border: '#22A06B', label: 'פיזור מועילים' },
  'אחר': { bg: '#F1ECFE', border: '#8B5CF6', label: 'אחר' },
};
const TODAY_BG = '#FFF4CC';
const TODAY_BORDER = '#E5A900';

const DOSAGE_FIELDS = ['מינון ', 'מינון']; // השדה החי נקרא "מינון " (עם רווח בסוף)
const RANGE_RE = /^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})$/;

// ---------- תאריכים ----------
function parseDMY(s) {
  const [d, m, y] = String(s).split('/').map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}
function parseISO(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** מחזיר {start,end} של הטיפול, או null */
function treatmentRange(raw) {
  const v = raw['תאריך'];
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(RANGE_RE);
  if (m) {
    const start = parseDMY(m[1]);
    const end = parseDMY(m[2]);
    return start && end ? { start, end: end < start ? start : end } : null;
  }
  const single = s.includes('/') ? parseDMY(s) : parseISO(s);
  if (!single) return null;
  // טווח רב-יומי: השדה ב-Airtable הוא תאריך בודד, וסוף הטווח נשמר בהערות
  const endMatch = /תאריך סיום:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(String(raw['הערות'] || ''));
  if (endMatch) {
    const end = parseDMY(endMatch[1]);
    if (end && end > single) return { start: single, end };
  }
  return { start: single, end: single };
}
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toISO = dateKey;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function inferType(t) {
  const tag = [t['סוג טיפול'], t['סוג מרסס'], t['בסיס מינון'], displayName(t['חומר ריסוס'], '')].join(' ').toLowerCase();
  if (tag.includes('הגמע') || tag.includes('טפטוף')) return 'הגמעה';
  if (tag.includes('מועיל')) return 'פיזור מועילים';
  if (tag.includes('ריסוס') || tag.includes('מרסס')) return 'ריסוס';
  return 'ריסוס';
}

/** תג "היום / מתחיל היום / יום אחרון" (סעיף 22 — Highlight) */
function todayBadge(ev) {
  const today = startOfToday();
  if (ev.start > today || ev.end < today) return null;
  if (ev.start.getTime() === today.getTime() && ev.end.getTime() !== today.getTime()) return 'מתחיל היום';
  if (ev.end.getTime() === today.getTime() && ev.start.getTime() !== today.getTime()) return 'יום אחרון';
  return 'היום';
}

// ============================================================
const MATERIAL_FORM_FIELDS = [
  { name: 'שם חומר', label: 'שם חומר', type: 'text', required: true },
  { name: 'מחיר', label: 'מחיר (₪)', type: 'number' },
  { name: 'גודל האריזה', label: 'גודל אריזה', type: 'number' },
  { name: 'מינון בסמ"ק', label: 'מינון ברירת מחדל', type: 'number' },
  { name: 'יחידת תמחור', label: 'יחידת תמחור', type: 'select' },
];

export default function TreatmentsPage({ initialTab = 'calendar' }) {
  const app = useApp();
  const navigate = useNavigate();
  const canEdit = (app.user?.role || 'owner') === 'owner'; // מנהל עבודה צופה בלבד
  // "list" הייתה פעם לשונית עליונה נפרדת; היום היא תצוגה בתוך "calendar" (לצד חודש/שבוע) —
  // נשמרת תאימות לאחור לקישורים/ניווטים ישנים שמעבירים initialTab="list"
  const [tab, setTab] = useState(initialTab === 'list' ? 'calendar' : initialTab);
  const [view, setView] = useState(initialTab === 'list' ? 'list' : 'calendar');
  // מעבר מלשונית צד ללשונית צד אחרת של אותו מסך — הטאב מסתנכרן מהניתוב
  useEffect(() => {
    setTab(initialTab === 'list' ? 'calendar' : initialTab);
    if (initialTab === 'list') setView('list');
  }, [initialTab]);
  const [listSearch, setListSearch] = useState('');
  const [materialSearch, setMaterialSearch] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [materialForm, setMaterialForm] = useState(null);
  const [listLimit, setListLimit] = useState(30);
  const [treatments, setTreatments] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [structures, setStructures] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [options, setOptions] = useState({ status: [], sizes: [], basis: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [weekStart, setWeekStart] = useState(() => { const d = startOfToday(); d.setDate(d.getDate() - d.getDay()); return d; });
  const [fStructure, setFStructure] = useState('');
  const [fCrop, setFCrop] = useState('');
  const [fVariety, setFVariety] = useState('');
  const [fType, setFType] = useState('');

  const [dayDrawer, setDayDrawer] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [t, m, s, w, p] = await Promise.all([
        app.api.get('ריסוסים', '?maxRecords=1000'),
        app.api.get('חומרי ריסוס', '?maxRecords=300'),
        app.api.get('מבנים', '?maxRecords=300'),
        app.api.get('עובדים', '?maxRecords=300'),
        app.api.get('תוכניות שתילה', '?maxRecords=500'),
      ]);
      setTreatments(Array.isArray(t) ? t : []);
      setMaterials(Array.isArray(m) ? m : []);
      setStructures(Array.isArray(s) ? s : []);
      setWorkers(Array.isArray(w) ? w : []);
      setPlans(Array.isArray(p) ? p : []);
    } catch (e) {
      setLoadError(e.message || 'לא ניתן היה לטעון את הנתונים.');
    }
    setLoading(false);
  }, [app.api]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  // אפשרויות singleSelect — נטענות מהמטא כדי לא לכתוב ערך שאינו ברשימה
  useEffect(() => {
    const fetchChoices = (field) =>
      fetch(`/api/select-options/${encodeURIComponent('ריסוסים')}/${encodeURIComponent(field)}`)
        .then((r) => (r.ok ? r.json() : { choices: [] }))
        .then((d) => (Array.isArray(d.choices) ? d.choices : []))
        .catch(() => []);
    Promise.all([fetchChoices('סטטוס'), fetchChoices('גודל מרסס בליטר'), fetchChoices('בסיס מינון')])
      .then(([status, sizes, basis]) => setOptions({ status, sizes, basis }));
  }, []);

  // ---------- אירועים מועשרים ----------
  const events = useMemo(() => {
    return treatments.map((t) => {
      const range = treatmentRange(t);
      if (!range) return null;
      const structs = Array.isArray(t['מבנה']) ? t['מבנה'] : (t['מבנה'] ? [t['מבנה']] : []);
      const structNames = structs.map((x) => (x && typeof x === 'object' ? x.name : String(x))).filter(Boolean);
      const structIds = structs.map((x) => (x && typeof x === 'object' ? x.id : String(x)));
      const planId = firstId(t['תוכנית שתילה']);
      const plan = plans.find((p) => p.id === planId);
      const crop = plan ? (displayName(plan['גידולים'], '') || displayName(plan['סוג גידול'], '')) : '';
      const variety = plan ? displayName(plan['זן'], '') : '';
      return {
        id: t.id, raw: t, ...range,
        type: inferType(t),
        material: displayName(t['חומר ריסוס'], 'לא זמין'),
        structNames, structIds,
        crop: crop || 'לא זמין',
        variety: variety || '',
        number: t['מספר ריסוס'],
        dosage: pick(t, DOSAGE_FIELDS),
        basis: t['בסיס מינון'] || '',
        executor: displayName(t['מבצע'], ''),
        status: t['סטטוס'] || '',
        done: !!t['בוצע'],
        notes: t['הערות'] || '',
        days: Math.round((range.end - range.start) / 86400000) + 1,
      };
    }).filter(Boolean);
  }, [treatments, plans]);

  const cropOptions = useMemo(() => [...new Set(events.map((e) => e.crop).filter((c) => c && c !== 'לא זמין'))].sort(), [events]);
  const varietyOptions = useMemo(() => [...new Set(events.map((e) => e.variety).filter(Boolean))].sort(), [events]);

  const filtered = useMemo(() => events.filter((e) => {
    if (fStructure && !e.structIds.includes(fStructure)) return false;
    if (fCrop && e.crop !== fCrop) return false;
    if (fVariety && e.variety !== fVariety) return false;
    if (fType && e.type !== fType) return false;
    return true;
  }), [events, fStructure, fCrop, fVariety, fType]);

  const onDate = useCallback((d) => filtered.filter((e) => e.start <= d && e.end >= d), [filtered]);

  // שורות לשונית הרשימה — חיפוש חופשי מעל הפילטרים המשותפים
  const listRows = useMemo(() => filtered.filter((e) => {
    if (!listSearch) return true;
    const hay = [e.material, e.structNames.join(' '), e.crop, e.variety, e.status, e.notes, e.basis].join(' ').toLowerCase();
    return hay.includes(listSearch.toLowerCase());
  }).sort((a, b) => b.start - a.start), [filtered, listSearch]);

  const rangeLabel = (e) => (e.start.getTime() === e.end.getTime()
    ? formatDate(e.start) : `${formatDate(e.start)} – ${formatDate(e.end)}`);

  const exportList = () => exportCsv(`ריסוסים-${fileStamp()}`, [
    { label: 'תאריך', get: rangeLabel },
    { label: 'מבנה', get: (e) => e.structNames.join(', ') },
    { label: 'חומר', get: (e) => e.material },
    { label: 'גידול', get: (e) => (e.crop === 'לא זמין' ? '' : e.crop) },
    { label: 'זן', get: (e) => e.variety },
    { label: 'מינון', get: (e) => e.dosage ?? '' },
    { label: 'בסיס מינון', get: (e) => e.basis },
    { label: 'סטטוס', get: (e) => e.status },
    { label: 'בוצע', get: (e) => (e.done ? 'כן' : 'לא') },
    { label: 'הערות', get: (e) => e.notes },
  ], listRows);

  // ---------- KPI (סעיף 25) ----------
  const kpi = useMemo(() => {
    const today = startOfToday();
    const ws = new Date(today); ws.setDate(today.getDate() - today.getDay());
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    return {
      total: filtered.length,
      week: filtered.filter((e) => e.start <= we && e.end >= ws).length,
      today: filtered.filter((e) => e.start <= today && e.end >= today).length,
      done: filtered.filter((e) => e.done).length,
    };
  }, [filtered]);

  // ---------- כתיבה ל-Airtable ----------
  const runAction = async (fn) => {
    if (busy) return false;
    setBusy(true); setActionError('');
    try { await fn(); await load(); setBusy(false); return true; }
    catch (e) { setActionError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`); setBusy(false); return false; }
  };

  const openForm = (ev) => {
    setActionError('');
    const r = ev?.raw;
    setForm({
      id: ev?.id || null,
      from: ev ? toISO(ev.start) : toISO(startOfToday()),
      to: ev ? toISO(ev.end) : toISO(startOfToday()),
      structures: ev ? ev.structIds : [],
      material: r ? firstId(r['חומר ריסוס']) || '' : '',
      plan: typeof r?.['תוכנית שתילה'] === 'string' ? r['תוכנית שתילה'] : '',
      sprayer: r?.['סוג מרסס'] || '',
      // ברירת מחדל לטיפול חדש: 200 ליטר (הגודל הנפוץ בפועל) — בעריכת טיפול קיים מוצג הערך השמור בפועל
      sprayerSize: ev ? (r?.['גודל מרסס בליטר'] || '') : '200',
      basis: r?.['בסיס מינון'] || '',
      dosage: r ? (pick(r, DOSAGE_FIELDS) ?? '') : '',
      status: r?.['סטטוס'] || '',
      notes: String(r?.['הערות'] || '').replace(/\n?תאריך סיום:.*$/m, '').trim(),
      done: !!r?.['בוצע'],
    });
  };

  const saveForm = async () => {
    const f = form;
    if (!f.structures.length) { setActionError('חסר שדה חובה: מבנה'); return; }
    if (!f.material) { setActionError('חסר שדה חובה: חומר ריסוס'); return; }
    // השדה "תאריך" ב-Airtable הוא תאריך בודד — טווח נשמר כתאריך התחלה + שורת סיום בהערות
    const fmt = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
    let notesValue = String(f.notes || '').replace(/\n?תאריך סיום:.*$/m, '').trim();
    if (f.to && f.to !== f.from) notesValue = `${notesValue}${notesValue ? '\n' : ''}תאריך סיום: ${fmt(f.to)}`;
    const fields = {
      'תאריך': f.from,
      'מבנה': f.structures,
      'חומר ריסוס': [f.material],
      'תוכנית שתילה': f.plan || null,
      'סוג מרסס': f.sprayer || null,
      'גודל מרסס בליטר': f.sprayerSize || null,
      'בסיס מינון': f.basis || null,
      'מינון ': f.dosage === '' ? null : Number(f.dosage),
      'סטטוס': f.status || null,
      'הערות': notesValue || null,
      'בוצע': !!f.done,
    };
    Object.keys(fields).forEach((k) => { if (fields[k] === null) delete fields[k]; });
    const ok = await runAction(async () => {
      if (f.id) await app.api.update('ריסוסים', f.id, fields);
      else await app.api.create('ריסוסים', fields);
    });
    if (ok) { setForm(null); setDayDrawer(null); }
  };

  const toggleDone = (ev) => runAction(() => app.api.update('ריסוסים', ev.id, { 'בוצע': !ev.done }));
  const removeTreatment = async (ev) => {
    const yes = await confirmDialog({
      title: `מחיקת הטיפול ${ev.material}`,
      message: 'הפריט ימחק ולא יינתן לשחזור.\nהאם אתה בטוח שברצונך לבצע פעולה זו?',
      confirmLabel: 'מחק', danger: true,
    });
    if (!yes) return;
    const ok = await runAction(() => app.api.remove('ריסוסים', ev.id));
    if (ok) { setDayDrawer(null); toast('הפריט נמחק בהצלחה'); }
  };

  // ---------- ניווט ----------
  const prevMonth = () => { if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1); };
  const stepWeek = (n) => { const d = new Date(weekStart); d.setDate(d.getDate() + n * 7); setWeekStart(d); };
  const goToday = () => { const t = startOfToday(); setYear(t.getFullYear()); setMonth(t.getMonth()); const d = new Date(t); d.setDate(t.getDate() - t.getDay()); setWeekStart(d); };
  const goWeekOfMonth = (n) => { const d = new Date(year, month, 1 + (n - 1) * 7); d.setDate(d.getDate() - d.getDay()); setWeekStart(d); setView('week'); };

  const years = useMemo(() => {
    const set = new Set(events.flatMap((e) => [e.start.getFullYear(), e.end.getFullYear()]));
    set.add(now.getFullYear());
    return [...set].sort();
  }, [events]);

  const filtersActive = fStructure || fCrop || fVariety || fType;

  if (loading) {
    return <div><PageHeader icon="🧴" title="ריסוסים וטיפולים" /><div className="skeleton skeleton-chart" /></div>;
  }

  return (
    <div>
      <PageHeader icon="🧴" title="ריסוסים וטיפולים">
        {tab === 'calendar' && <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>🖨️ הדפסה</button>}
        {tab === 'calendar' && <button type="button" className="btn btn-ghost no-print" onClick={exportList} disabled={!listRows.length}>⬇️ ייצוא</button>}
        {tab === 'reports' && <button className="btn btn-primary no-print" onClick={() => navigate('/upload', { state: { docType: 'דוח ריסוסים' } })}>⬆️ העלאת דוח</button>}
        {tab === 'materials' && canEdit && <button className="btn btn-primary no-print" onClick={() => setMaterialForm({})}>+ חומר חדש</button>}
        {tab === 'calendar' && canEdit && <button className="btn btn-primary no-print" onClick={() => openForm(null)}>+ טיפול חדש</button>}
      </PageHeader>

      <div className="tabs no-print" style={{ marginBottom: 16 }}>
        {[['calendar', '📅 טיפולים'], ['materials', '🧪 חומרי ריסוס'], ['reports', '📄 דוחות']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {loadError && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {loadError}</div>}
      {actionError && !form && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {actionError}</div>}

      {/* KPI — סעיף 25 */}
      {tab === 'calendar' && <>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {[
          { l: 'מספר טיפולים', v: kpi.total, c: 'var(--spray)', i: '🧴' },
          { l: 'טיפולים השבוע', v: kpi.week, c: 'var(--irrigation)', i: '🗓️' },
          { l: 'טיפולים היום', v: kpi.today, c: TODAY_BORDER, i: '⭐' },
          { l: 'טיפולים שהושלמו', v: kpi.done, c: 'var(--ok)', i: '✅' },
        ].map((k) => (
          <div key={k.label || k.l} className="kpi-card">
            <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--spray-soft)' }}>{k.i}</div><span className="kpi-label">{k.l}</span></div>
            <div className="kpi-value" style={{ color: k.c }}>{formatNumber(k.v, 0)}</div>
          </div>
        ))}
      </div>

      {/* פילטרים — סעיף 22 */}
      <div className="filter-bar" style={{ alignItems: 'flex-end' }}>
        <Sel label="שנה" value={year} onChange={(v) => setYear(Number(v))} options={years.map((y) => [y, y])} />
        <Sel label="חודש" value={month} onChange={(v) => setMonth(Number(v))} options={MONTHS.map((m, i) => [i, m])} />
        <Sel label="שבוע" value="" onChange={(v) => v && goWeekOfMonth(Number(v))} options={[['', 'בחר...'], ...[1, 2, 3, 4, 5].map((n) => [n, `שבוע ${n} בחודש`])]} />
        <Sel label="מבנה" value={fStructure} onChange={setFStructure}
          options={[['', 'הכל'], ...structures.map((s) => [s.id, s['מספר מבנה'] ? `מבנה ${s['מספר מבנה']}` : 'מבנה'])]} />
        <Sel label="גידול" value={fCrop} onChange={setFCrop} options={[['', 'הכל'], ...cropOptions.map((c) => [c, c])]} />
        <Sel label="זן" value={fVariety} onChange={setFVariety} options={[['', 'הכל'], ...varietyOptions.map((c) => [c, c])]} />
        <Sel label="סוג טיפול" value={fType} onChange={setFType} options={[['', 'הכל'], ...Object.keys(TYPES).map((k) => [k, k])]} />
        {filtersActive && <button className="btn btn-sm btn-ghost" onClick={() => { setFStructure(''); setFCrop(''); setFVariety(''); setFType(''); }}>✕ נקה פילטר</button>}
      </div>
      </>}

      {tab === 'calendar' && <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="tabs">
          {[['calendar', '🗓️ חודש'], ['week', '📆 שבוע'], ['list', '📋 רשימה']].map(([k, l]) => (
            <button key={k} className={`tab ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {view !== 'list' && (
          <div style={{ display: 'flex', gap: 14, fontSize: 12, flexWrap: 'wrap' }}>
            {Object.values(TYPES).map((t) => (
              <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 12, background: t.bg, border: `2px solid ${t.border}`, borderRadius: 3 }} />{t.label}
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: TODAY_BG, border: `2px solid ${TODAY_BORDER}`, borderRadius: 3 }} />פעיל היום
            </span>
          </div>
        )}
      </div>}

      {tab === 'calendar' && view === 'calendar' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
            <button className="btn btn-ghost btn-sm" onClick={prevMonth}>‹ קודם</button>
            <button className="btn btn-ghost btn-sm" onClick={goToday}>היום</button>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth}>הבא ›</button>
            <b style={{ fontSize: 16, marginRight: 10 }}>{MONTHS[month]} {year}</b>
          </div>
          <MonthGrid year={year} month={month} onDate={onDate} onOpen={(d, evs) => setDayDrawer({ date: d, events: evs })} />
        </div>
      )}

      {tab === 'calendar' && view === 'week' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => stepWeek(-1)}>‹ קודם</button>
            <button className="btn btn-ghost btn-sm" onClick={goToday}>היום</button>
            <button className="btn btn-ghost btn-sm" onClick={() => stepWeek(1)}>הבא ›</button>
            <b style={{ fontSize: 16, marginRight: 10 }}>
              שבוע {formatDate(weekStart)} – {formatDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6))}
            </b>
          </div>
          <WeekGrid weekStart={weekStart} onDate={onDate} onOpen={(ev) => setDayDrawer({ date: ev.start, events: [ev] })} />
        </div>
      )}

      {tab === 'calendar' && view === 'list' && (
        <ListTab
          rows={listRows} search={listSearch} setSearch={setListSearch}
          canEdit={canEdit} busy={busy}
          limit={listLimit} onMore={() => setListLimit((l) => l + 50)}
          onOpen={(ev) => setDayDrawer({ date: ev.start, events: [ev] })}
          onEdit={openForm} onToggle={toggleDone} onDelete={removeTreatment}
        />
      )}

      {tab === 'materials' && (
        <MaterialsTab
          materials={materials} search={materialSearch} setSearch={setMaterialSearch}
          canEdit={canEdit} api={app.api} onChanged={load} onEdit={setMaterialForm}
        />
      )}

      {tab === 'reports' && (
        <ReportsTab
          events={events} search={reportSearch} setSearch={setReportSearch}
          canEdit={canEdit} busy={busy}
          onEdit={openForm} onToggle={toggleDone} onDelete={removeTreatment}
        />
      )}

      {dayDrawer && (
        <DayDrawer
          date={dayDrawer.date} events={dayDrawer.events} busy={busy} error={actionError}
          onClose={() => setDayDrawer(null)}
          onEdit={canEdit ? openForm : null} onToggle={canEdit ? toggleDone : null} onDelete={canEdit ? removeTreatment : null}
        />
      )}

      {materialForm !== null && (
        <RecordForm
          api={app.api} table="חומרי ריסוס"
          title={materialForm.id ? `עריכת ${materialForm['שם חומר'] || 'חומר'}` : 'חומר ריסוס חדש'}
          record={materialForm.id ? materialForm : null}
          fields={MATERIAL_FORM_FIELDS}
          onClose={() => setMaterialForm(null)}
          onSaved={async () => { setMaterialForm(null); await load(); toast('החומר נשמר בהצלחה'); }}
        />
      )}

      {form && (
        <TreatmentForm
          form={form} setForm={setForm} busy={busy} error={actionError}
          structures={structures} materials={materials} workers={workers} plans={plans} options={options}
          onCancel={() => setForm(null)} onSave={saveForm}
        />
      )}
    </div>
  );
}

// ============================================================
// רכיבי תצוגה
// ============================================================
function Sel({ label, value, onChange, options }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{label}</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={String(v)} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/** פס אירוע בתוך תא לוח — צבע לפי סוג, הדגשה כשפעיל היום */
function EventChip({ ev, compact, onClick }) {
  const c = TYPES[ev.type] || TYPES['אחר'];
  const badge = todayBadge(ev);
  return (
    <div onClick={(e) => { e.stopPropagation(); onClick?.(ev); }}
      title={`${c.label} · ${ev.material} · ${ev.structNames.join(', ')}`}
      style={{
        background: badge ? TODAY_BG : c.bg, borderRight: `4px solid ${c.border}`,
        border: badge ? `2px solid ${TODAY_BORDER}` : `1px solid ${c.border}`, borderRightWidth: 4, borderRightColor: c.border,
        borderRadius: 6, padding: compact ? '2px 5px' : '5px 7px', marginTop: 3, fontSize: compact ? 10.5 : 12, cursor: 'pointer',
        opacity: ev.done ? 0.65 : 1,
      }}>
      <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {ev.done ? '✓ ' : ''}{ev.material}
      </div>
      {!compact && <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.structNames.join(', ') || 'לא זמין'}</div>}
      {badge && <span className="badge" style={{ background: TODAY_BORDER, color: '#fff', fontSize: 10, padding: '1px 7px', marginTop: 2 }}>{badge}</span>}
    </div>
  );
}

function MonthGrid({ year, month, onDate, onOpen }) {
  const today = startOfToday();
  const count = new Date(year, month + 1, 0).getDate();
  const lead = new Date(year, month, 1).getDay();
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', fontSize: 12, minWidth: 560 }}>
      {DAYS.map((d) => <div key={d} style={{ padding: 6, textAlign: 'center', background: 'var(--bg-secondary)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>{d}</div>)}
      {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} style={{ minHeight: 92, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }} />)}
      {Array.from({ length: count }, (_, i) => new Date(year, month, i + 1)).map((day) => {
        const evs = onDate(day);
        const isToday = day.getTime() === today.getTime();
        const isShabbat = day.getDay() === 6;
        return (
          <div key={dateKey(day)} onClick={() => evs.length && onOpen(day, evs)}
            style={{
              minHeight: 92, padding: 4, borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              background: isToday ? '#FFFBEB' : isShabbat ? '#F1ECFE' : '#fff', cursor: evs.length ? 'pointer' : 'default',
              outline: isToday ? `2px solid ${TODAY_BORDER}` : 'none', outlineOffset: -2,
            }}>
            <div style={{ fontWeight: isToday ? 800 : 500, color: isToday ? TODAY_BORDER : 'inherit' }}>{day.getDate()}</div>
            {evs.slice(0, 3).map((ev) => <EventChip key={ev.id} ev={ev} compact onClick={() => onOpen(day, evs)} />)}
            {evs.length > 3 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>+{evs.length - 3} עוד</div>}
          </div>
        );
      })}
    </div>
    </div>
  );
}

function WeekGrid({ weekStart, onDate, onOpen }) {
  const today = startOfToday();
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', fontSize: 12, minWidth: 560 }}>
      {days.map((day) => {
        const evs = onDate(day);
        const isToday = day.getTime() === today.getTime();
        const isShabbat = day.getDay() === 6;
        return (
          <div key={dateKey(day)} style={{ minHeight: 220, padding: 6, borderLeft: '1px solid var(--border)', background: isToday ? '#FFFBEB' : isShabbat ? '#F1ECFE' : '#fff', outline: isToday ? `2px solid ${TODAY_BORDER}` : 'none', outlineOffset: -2 }}>
            <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 4, color: isToday ? TODAY_BORDER : 'inherit' }}>
              {DAYS[day.getDay()]} {day.getDate()}/{day.getMonth() + 1}
            </div>
            {evs.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 11, marginTop: 10 }}>—</div>}
            {evs.map((ev) => <EventChip key={ev.id} ev={ev} onClick={onOpen} />)}
          </div>
        );
      })}
    </div>
    </div>
  );
}

function ListView({ events, onOpen }) {
  const [limit, setLimit] = useState(100);
  const sorted = [...events].sort((a, b) => a.start - b.start);
  if (!sorted.length) return <div className="card empty-state">אין טיפולים לפילטרים שנבחרו.</div>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>תאריך</th><th>סוג טיפול</th><th>מבנה</th><th>גידול</th><th>זן</th><th>חומר</th><th>מינון</th><th>מבצע</th><th>סטטוס</th></tr></thead>
          <tbody>
            {sorted.slice(0, limit).map((ev) => {
              const c = TYPES[ev.type] || TYPES['אחר'];
              const badge = todayBadge(ev);
              return (
                <tr key={ev.id} onClick={() => onOpen(ev)} style={{ background: badge ? TODAY_BG : undefined, borderRight: badge ? `4px solid ${TODAY_BORDER}` : undefined }}>
                  <td>
                    <b>{formatDate(ev.start)}{ev.days > 1 ? ` – ${formatDate(ev.end)}` : ''}</b>
                    {badge && <span className="badge" style={{ background: TODAY_BORDER, color: '#fff', fontSize: 10, marginRight: 6 }}>{badge}</span>}
                  </td>
                  <td><span className="badge" style={{ background: c.bg, color: c.border, border: `1px solid ${c.border}` }}>{c.label}</span></td>
                  <td><Chips names={ev.structNames} /></td>
                  <td>{ev.crop}</td>
                  <td>{ev.variety || '—'}</td>
                  <td>{ev.material}</td>
                  <td>{ev.dosage ?? '—'}{ev.basis ? ` ${ev.basis}` : ''}</td>
                  <td>{ev.executor || '—'}</td>
                  <td><span className={`badge ${ev.done ? 'badge-ok' : 'badge-warn'}`}>{ev.done ? 'בוצע' : (ev.status || 'לא בוצע')}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && <div style={{ textAlign: 'center', marginTop: 12 }}><button className="btn btn-ghost btn-sm" onClick={() => setLimit(limit + 100)}>טען עוד ({sorted.length - limit} נותרו)</button></div>}
    </div>
  );
}

/** מבנים מרובים — Chips (סעיף 22) */
function Chips({ names }) {
  if (!names.length) return 'לא זמין';
  if (names.length === 1) return names[0];
  return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{names.map((n) => <span key={n} className="badge" style={{ background: 'var(--bg-secondary)' }}>{n}</span>)}</span>;
}

// ---------- כרטיס טיפול ----------
function DayDrawer({ date, events, busy, error, onClose, onEdit, onToggle, onDelete }) {
  useEscapeClose(onClose, !busy); // סגירה במקש Escape
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>🧴 טיפולים — {formatDate(date)}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          {error && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
          {events.map((ev) => {
            const c = TYPES[ev.type] || TYPES['אחר'];
            const badge = todayBadge(ev);
            const row = (l, v) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><b>{v}</b></div>;
            return (
              <div key={ev.id} className="card" style={{ marginBottom: 12, background: badge ? TODAY_BG : c.bg, border: `${badge ? 2 : 1}px solid ${badge ? TODAY_BORDER : c.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span className="badge" style={{ background: '#fff', color: c.border, border: `1px solid ${c.border}` }}>{c.label}</span>
                  {badge && <span className="badge" style={{ background: TODAY_BORDER, color: '#fff' }}>{badge}</span>}
                  <span className={`badge ${ev.done ? 'badge-ok' : 'badge-warn'}`}>{ev.done ? 'בוצע' : (ev.status || 'לא בוצע')}</span>
                  <div style={{ flex: 1 }} />
                  {onEdit && <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" disabled={busy} onClick={() => onEdit(ev)}>✎</button>}
                  {onToggle && <button className="btn btn-sm btn-ghost" title={ev.done ? 'סמן כלא בוצע' : 'סמן כבוצע'} disabled={busy} onClick={() => onToggle(ev)}>{ev.done ? '↩' : '✓'}</button>}
                  {onDelete && <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }} disabled={busy} onClick={() => onDelete(ev)}>🗑</button>}
                </div>
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>{ev.material}</div>
                {row('תאריך / טווח', ev.days > 1 ? `${formatDate(ev.start)} – ${formatDate(ev.end)} (${ev.days} ימים)` : formatDate(ev.start))}
                {row('מבנה', <Chips names={ev.structNames} />)}
                {row('גידול', ev.crop)}
                {row('זן', ev.variety || '—')}
                {row('מספר ריסוס', ev.number ?? '—')}
                {row('מינון', ev.dosage != null && ev.dosage !== '' ? `${ev.dosage}${ev.basis ? ` ${ev.basis}` : ''}` : 'לא זמין')}
                {row('מבצע', ev.executor || 'לא זמין')}
                {row('כמות מחושבת', ev.raw['כמות מחושבת'] != null && typeof ev.raw['כמות מחושבת'] === 'number' ? formatNumber(ev.raw['כמות מחושבת']) : 'לא זמין')}
                {ev.notes && <div style={{ fontSize: 13, marginTop: 8 }}>{ev.notes}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- טופס יצירה / עריכה ----------
function TreatmentForm({ form, setForm, busy, error, structures, materials, workers, plans, options, onCancel, onSave }) {
  useEscapeClose(onCancel, !busy); // סגירה במקש Escape
  const set = (k, v) => setForm({ ...form, [k]: v });
  const toggleStruct = (id) => set('structures', form.structures.includes(id) ? form.structures.filter((x) => x !== id) : [...form.structures, id]);
  const mat = materials.find((m) => m.id === form.material);
  const relevantPlans = plans.filter((p) => !form.structures.length || form.structures.includes(firstId(p['מבנה'])));
  const planLabel = (p) => `תוכנית ${p['מספר תוכנית'] ?? ''} · ${displayName(p['מבנה'], '')} · ${displayName(p['גידולים'], '') || displayName(p['סוג גידול'], '')}`;
  const withCurrent = (list, current) => (current && !list.includes(current) ? [current, ...list] : list);

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>{form.id ? 'עריכת טיפול' : 'טיפול חדש'}</h3>
        {error && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group"><label>מתאריך <span className="required" /></label>
              <input className="input" type="date" required style={{ width: '100%' }} value={form.from} onChange={(e) => { const v = e.target.value; setForm({ ...form, from: v, to: form.to < v ? v : form.to }); }} /></div>
            <div className="form-group"><label>עד תאריך</label>
              <input className="input" type="date" style={{ width: '100%' }} min={form.from} value={form.to} onChange={(e) => set('to', e.target.value || form.from)} /></div>
          </div>

          <div className="form-group">
            <label>מבנים <span className="required" /></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {structures.map((s) => {
                const on = form.structures.includes(s.id);
                return (
                  <button type="button" key={s.id} onClick={() => toggleStruct(s.id)} className="badge"
                    style={{ cursor: 'pointer', border: `1px solid ${on ? 'var(--accent-top)' : 'var(--border)'}`, background: on ? 'var(--accent-top)' : '#fff', color: on ? '#fff' : 'var(--text-main)', padding: '6px 12px' }}>
                    {s['מספר מבנה'] ? `מבנה ${s['מספר מבנה']}` : 'מבנה'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-group"><label>חומר ריסוס <span className="required" /></label>
            <select className="select" style={{ width: '100%' }} required value={form.material}
              onChange={(e) => {
                const id = e.target.value;
                const m = materials.find((x) => x.id === id);
                // ברירת המחדל מהאיפיון: המינון של החומר מוצע אוטומטית וניתן לעריכה
                const def = m?.['מינון בסמ"ק'];
                setForm({ ...form, material: id, dosage: def != null && def !== '' ? String(def) : form.dosage });
              }}>
              <option value="">בחר חומר...</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m['שם חומר'] || 'חומר'}</option>)}
            </select>
          </div>

          <div className="form-group"><label>תוכנית שתילה (גידול / זן)</label>
            <select className="select" style={{ width: '100%' }} value={form.plan} onChange={(e) => set('plan', e.target.value)}>
              <option value="">ללא</option>
              {relevantPlans.map((p) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
            </select>
          </div>

          <div className="grid-2" style={{ gap: 12 }}>
            <div className="form-group"><label>סטטוס</label>
              <select className="select" style={{ width: '100%' }} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">ללא</option>
                {withCurrent(options.status, form.status).map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div className="form-group"><label>סוג מרסס</label>
              <input className="input" style={{ width: '100%' }} value={form.sprayer} onChange={(e) => set('sprayer', e.target.value)} /></div>
            <div className="form-group"><label>גודל מרסס (ליטר)</label>
              <select className="select" style={{ width: '100%' }} value={form.sprayerSize} onChange={(e) => set('sprayerSize', e.target.value)}>
                <option value="">ללא</option>
                {withCurrent(options.sizes || [], String(form.sprayerSize || '')).filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div className="form-group"><label>בסיס מינון</label>
              <select className="select" style={{ width: '100%' }} value={form.basis} onChange={(e) => set('basis', e.target.value)}>
                <option value="">ללא</option>
                {withCurrent(options.basis, form.basis).map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div className="form-group"><label>מינון</label>
              <input className="input" type="number" step="any" min="0" style={{ width: '100%' }} value={form.dosage} onChange={(e) => set('dosage', e.target.value)} /></div>
          </div>

          <div className="form-group"><label>הערות</label>
            <textarea className="input" style={{ width: '100%' }} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={form.done} onChange={(e) => set('done', e.target.checked)} /> בוצע
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'שומר...' : form.id ? 'שמור שינויים' : 'צור טיפול'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ============================================================
// לשונית הרשימה — התצוגה התפעולית (חיפוש · פעולות · ייצוא)
// ============================================================
function ListTab({ rows, search, setSearch, canEdit, busy, limit, onMore, onOpen, onEdit, onToggle, onDelete }) {
  const rangeLabel = (e) => (e.start.getTime() === e.end.getTime()
    ? formatDate(e.start) : `${formatDate(e.start)} – ${formatDate(e.end)}`);
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="input no-print" aria-label="חיפוש טיפול" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted" style={{ fontSize: 13 }}>{formatNumber(rows.length, 0)} טיפולים</span>
      </div>
      {rows.length === 0 ? <div className="empty-state"><div className="icon">🧴</div>אין נתונים לתקופה זו</div> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>תאריך</th><th>סוג</th><th>מבנה</th><th>חומר</th><th>גידול / זן</th><th>מינון</th><th>סטטוס</th><th>בוצע</th>
                {canEdit && <th className="no-print">פעולות</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((e) => {
                const c = TYPES[e.type] || TYPES['אחר'];
                return (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(e)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{rangeLabel(e)}</td>
                    <td><span className="badge" style={{ background: c.bg, border: `1px solid ${c.border}` }}>{c.label}</span></td>
                    <td>{e.structNames.length ? e.structNames.map((n, i) => <span key={i} className="obj-chip static">🏗️ {n}</span>) : 'לא זמין'}</td>
                    <td style={{ fontWeight: 600 }}>{e.material}</td>
                    <td>{[e.crop === 'לא זמין' ? '' : e.crop, e.variety].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{e.dosage != null && e.dosage !== '' ? `${formatNumber(e.dosage)}${e.basis ? ` (${e.basis})` : ''}` : '—'}</td>
                    <td>{e.status || '—'}</td>
                    <td><span className={`badge ${e.done ? 'badge-ok' : 'badge-warn'}`}>{e.done ? '✓ בוצע' : '● לא בוצע'}</span></td>
                    {canEdit && (
                      <td className="no-print" onClick={(ev2) => ev2.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-ghost" disabled={busy} aria-label={e.done ? 'סמן כלא בוצע' : 'סמן כבוצע'} title={e.done ? 'סמן כלא בוצע' : 'סמן כבוצע'} onClick={() => onToggle(e)}>{e.done ? '↩' : '✓'}</button>
                          <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => onEdit(e)}>✎</button>
                          <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }} onClick={() => onDelete(e)}>🗑</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn btn-ghost no-print" onClick={onMore}>הצג עוד ({formatNumber(rows.length - limit, 0)})</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// לשונית חומרי הריסוס (סעיף 20 באיפיון)
// ============================================================
function MaterialsTab({ materials, search, setSearch, canEdit, api, onChanged, onEdit }) {
  const list = materials.filter((m) => !search || String(m['שם חומר'] || '').toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <div className="filter-bar no-print">
        <input className="input" aria-label="חיפוש חומר" placeholder="חיפוש חומר..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatNumber(list.length, 0)} חומרים</span>
      </div>
      <div className="grid">
        {list.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}><div className="icon">🧪</div>אין נתונים לתקופה זו</div>}
        {list.map((m) => (
          <div key={m.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b style={{ fontSize: 16 }}>🧪 {m['שם חומר'] || 'חומר'}</b>
              {m['יחידת תמחור'] && <span className="badge" style={{ background: 'var(--spray-soft)', color: 'var(--spray)' }}>{m['יחידת תמחור']}</span>}
            </div>
            <div style={{ fontSize: 14 }}>
              {m['מחיר'] != null && <div className="obj-row"><span className="obj-row-label">מחיר</span><span className="obj-row-value">{formatMoney(m['מחיר'])}</span></div>}
              {m['גודל האריזה'] != null && <div className="obj-row"><span className="obj-row-label">גודל אריזה</span><span className="obj-row-value">{formatNumber(m['גודל האריזה'])}</span></div>}
              {m['מינון בסמ"ק'] != null && <div className="obj-row"><span className="obj-row-label">מינון ברירת מחדל</span><span className="obj-row-value">{formatNumber(m['מינון בסמ"ק'])}</span></div>}
              {m['מחיר לדונם בריסוס'] != null && <div className="obj-row"><span className="obj-row-label">מחיר לדונם</span><span className="obj-row-value">{formatMoney(m['מחיר לדונם בריסוס'])}</span></div>}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => onEdit(m)}>✎</button>
                <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                  onClick={async () => {
                    if (await removeRecord(api, 'חומרי ריסוס', m.id, m['שם חומר'] || 'החומר')) await onChanged();
                  }}>🗑</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ============================================================
// לשונית הדוחות — טיפולים שמקורם בדוח סרוק (כרטיסים עם פעולות)
// ============================================================
function ReportsTab({ events, search, setSearch, canEdit, busy, onEdit, onToggle, onDelete }) {
  const rows = events
    .filter((e) => (Array.isArray(e.raw['דוח ריסוסים']) && e.raw['דוח ריסוסים'].length) || e.raw['פירוק טבלת דוח (AI ניתוח טבלה)'])
    .filter((e) => {
      if (!search) return true;
      const hay = [e.material, e.structNames.join(' '), e.crop, e.variety, e.status].join(' ').toLowerCase();
      return hay.includes(search.toLowerCase());
    })
    .sort((a, b) => b.start - a.start);
  const rangeLabel = (e) => (e.start.getTime() === e.end.getTime()
    ? formatDate(e.start) : `${formatDate(e.start)} – ${formatDate(e.end)}`);
  return (
    <>
      <div className="filter-bar no-print">
        <input className="input" aria-label="חיפוש" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatNumber(rows.length, 0)} טיפולים מדוחות</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📄</div>
          <div>אין טיפולים מדוחות ריסוסים</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>העלו דוח במסך "העלאת מסמך" והטיפולים יופיעו כאן</div>
        </div>
      ) : (
        <div className="grid">
          {rows.map((e) => {
            const c = TYPES[e.type] || TYPES['אחר'];
            const doc = Array.isArray(e.raw['דוח ריסוסים']) && e.raw['דוח ריסוסים'][0];
            return (
              <div key={e.id} className="card" style={{ borderRight: `4px solid ${c.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <b>🧴 {e.material}</b>
                  <span className={`badge ${e.done ? 'badge-ok' : 'badge-warn'}`}>{e.done ? '✓ בוצע' : '● לא בוצע'}</span>
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', display: 'grid', gap: 3 }}>
                  <div>תאריך: <b style={{ color: 'var(--text-main)' }}>{rangeLabel(e)}</b></div>
                  {e.structNames.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      מבנה: {e.structNames.map((n, i) => <span key={i} className="obj-chip static">🏗️ {n}</span>)}
                    </div>
                  )}
                  {e.crop !== 'לא זמין' && <div>גידול / זן: {[e.crop, e.variety].filter(Boolean).join(' · ')}</div>}
                  {e.dosage != null && e.dosage !== '' && <div>מינון: {formatNumber(e.dosage)}{e.basis ? ` (${e.basis})` : ''}</div>}
                  {e.status && <div>סטטוס: {e.status}</div>}
                  {doc && <div>📎 <a href={doc.url} target="_blank" rel="noopener noreferrer">{doc.filename || 'קובץ הדוח'}</a></div>}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onToggle(e)}>{e.done ? '↩' : '✓ בוצע'}</button>
                    <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => onEdit(e)}>✎</button>
                    <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }} onClick={() => onDelete(e)}>🗑</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
