import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { authFetch } from '../utils/authFetch.js';
import { formatDate, formatMoney, formatNumber } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { confirmDialog, toast } from '../utils/ui.js';
import { readInventoryAiState, inventoryAiSummary, logisticsAiSummary } from '../utils/inventoryAi.js';

// ============================================================
// העלאת מסמך — "גרסה סופית" באיפיון (שורות 3845–4118)
// שלב 1 נושא · שלב 2 שבוע (חובה לחשבונית הכנסה / תעודת משלוח)
// שלב 3 קובץ (מכשיר / גרירה / מצלמה) · שלב 4 סיכום ואישור
// ============================================================

const TOPICS = [
  { key: 'income', label: 'חשבונית הכנסה', icon: '🧾', color: '#08A878', soft: 'var(--revenue-soft)' },
  { key: 'expense', label: 'חשבונית הוצאה', icon: '🧾', color: '#F79009', soft: 'var(--warning-soft)' },
  { key: 'delivery', label: 'תעודת משלוח', icon: '📦', color: '#2878D0', soft: 'var(--weight-soft)' },
  { key: 'cheque', label: 'צ\'ק', icon: '🏦', color: '#10A66A', soft: 'var(--profit-soft)' },
  { key: 'spray', label: 'דוח ריסוסים', icon: '🧴', color: '#8B5CF6', soft: 'var(--pallets-soft)' },
];

// שמות טבלאות ושדות (חיים ב-Airtable) לפי נושא.
// analysis — השדות שה-Automation ממלאת אחרי ההעלאה (מוצגים במעקב ובהיסטוריה).
// הסטטוס בהיסטוריה נגזר רק מהם: יש ערך → "נותח", אין → "ממתין לעיבוד" (לא ממציאים סטטוס).
const TARGETS = {
  income: {
    table: 'חשבוניות', field: 'חשבונית', dateField: 'תאריך-AI', uploadedField: 'תאריך העלאת קובץ',
    analysis: [['תאריך', 'תאריך-AI', 'date'], ['משווק', 'משווק-AI'], ['סכום ברוטו', 'סכום ברוטו', 'money'], ['סכום נטו', 'סכום נטו', 'money'], ['משקל', 'משקל', 'num'], ['קרטונים', 'כמות קרטונים', 'num'], ['משטחים', 'מספר משטחים', 'num']],
  },
  expense: {
    table: 'הוצאות', field: 'חשבונית', dateField: 'תאריך חשבונית-AI', uploadedField: 'תאריך העלאת החשבונית',
    analysis: [['תאריך', 'תאריך חשבונית-AI', 'date'], ['ספק', 'ספק-AI'], ['קטגוריה', 'קטגוריית חשבונית-AI'], ['סכום כולל', 'סכום כולל-AI', 'money']],
  },
  delivery: {
    table: 'תעודות משלוח', field: 'תעודת משלוח', dateField: 'תאריך תעודה', uploadedField: 'תאריך העלאת קובץ',
    analysis: [['תאריך תעודה', 'תאריך תעודה', 'date'], ['משווק', 'משווק-AI'], ['קרטונים', 'כמות קרטונים', 'num'], ['משקל כולל', 'משקל כולל', 'num'], ['משקל ממוצע לקרטון', 'משקל ממוצע לקרטון', 'num']],
  },
  cheque: {
    table: 'צ׳קים', field: 'צילום צ׳ק', dateField: 'תאריך פירעון', uploadedField: 'תאריך העלאה האחרון',
    analysis: [['סכום', 'סכום צ׳ק', 'money'], ['מוטב', 'מוטב'], ['תאריך פירעון', 'תאריך פירעון', 'date']],
  },
  spray: {
    table: 'דוחות ריסוסים', field: 'דוח ריסוסים', dateField: 'העלאה אחרונה של הקובץ', uploadedField: 'העלאה אחרונה של הקובץ',
    analysis: [['סיכום', 'Attachment Summary']],
  },
};

const POLL_MS = 6000;            // תדירות בדיקה של הרשומה שנוצרה
const POLL_MAX_MS = 4 * 60 * 1000; // מפסיקים לבדוק אחרי 4 דקות
const HISTORY_POLL_MS = 15000;              // רענון שקט של ההיסטוריה כל עוד יש "ממתין לעיבוד"
const HISTORY_POLL_MAX_MS = 10 * 60 * 1000; // ...עד 10 דקות מהכניסה למסך / מההעלאה האחרונה

/**
 * האם ה-Automation כבר מילאה לפחות שדה ניתוח אחד.
 * הגנה (2026-10-06, סעיף L): שדה-AI אמיתי של Airtable (טיפוס aiText,
 * לא multilineText רגיל) מגיע כאובייקט כמו { state:'pending' } או
 * { state:'error', errorType:... } — "לא ריק" כאובייקט JS, אבל *לא*
 * ניתוח שהושלם. היום אף שדה-analysis בפועל אינו מהטיפוס הזה (נבדק מול
 * הסכימה האמיתית — כולם multilineText/singleLineText/formula), אבל
 * אם ייוסף כזה שדה בעתיד — לא נרצה "נותח" שגוי (error/pending) ולא
 * "ממתין" שגוי (state:'generated' עם value אמיתי).
 */
function isAnalyzed(rec, target) {
  return target.analysis.some(([, f]) => {
    const v = rec?.[f];
    if (v === undefined || v === null || v === '') return false;
    if (typeof v === 'object' && !Array.isArray(v) && 'state' in v) {
      return v.state === 'generated' && v.value !== undefined && v.value !== null && v.value !== '';
    }
    return true;
  });
}
function fmtAnalysis(v, kind) {
  if (v === undefined || v === null || v === '') return null;
  if (kind === 'money') return formatMoney(v);
  if (kind === 'num') return formatNumber(v);
  if (kind === 'date') return formatDate(v);
  return Array.isArray(v) ? v.join(', ') : String(v);
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const MAX_MB = 15;

// תמונות גדולות מוקטנות בצד הלקוח לפני השליחה — מקצר משמעותית את זמן ההעלאה
// (המסמך נשאר קריא לניתוח; PDF אינו משתנה)
async function shrinkImage(f, maxDim = 2000, quality = 0.85) {
  if (!f.type.startsWith('image/') || f.size < 1.2 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.(png|jpe?g)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch { return f; }
}

// ---------- שבוע עסקי: שבת → חמישי ----------
const pad = (n) => String(n).padStart(2, '0');
const dmy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** שבת שמתחילה את השבוע העסקי הקודם ביחס להיום */
function defaultWeekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // השבת האחרונה (כולל היום אם שבת) = תחילת השבוע הנוכחי; ברירת המחדל היא השבוע הקודם
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7) - 7);
  return d;
}
function weekOf(start) {
  const end = new Date(start);
  end.setDate(start.getDate() + 5); // שבת + 5 = חמישי
  return { start, end, label: `${dmy(start)} – ${dmy(end)}`, code: `${ymd(start)}-${ymd(end)}` };
}

export default function UploadDocumentPage() {
  const app = useApp();
  const canEdit = (app.user?.role || 'owner') === 'owner'; // מנהל עבודה צופה בלבד
  const location = useLocation();
  // הגעה ממסך אחר עם סוג מסמך מוכן (למשל "העלאת תעודה" ממסך תעודות משלוח)
  const [topic, setTopic] = useState(() => TOPICS.find((t) => t.label === location.state?.docType)?.key ?? null);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [weekConfirmed, setWeekConfirmed] = useState(false);
  const [changingWeek, setChangingWeek] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  // הרשומה שנוצרה בהעלאה האחרונה — נקראת מחדש עד שה-Automation ממלאת אותה
  const [created, setCreated] = useState(null); // { key, table, id, name, at }
  const [createdRec, setCreatedRec] = useState(null);
  const [tracking, setTracking] = useState('idle'); // idle | polling | analyzed | timeout
  const fileRef = useRef(null);
  const historyPollFrom = useRef(Date.now()); // נקודת ההתחלה של חלון הרענון העצמי
  // הרענון השקט (setInterval) מנוקה כראוי ב-unmount, אבל קריאת loadHistory
  // שכבר יצאה לדרך (fetch באוויר) לא "נעצרת" בעצמה — שומר שלא נעדכן state
  // אחרי שעזבו את המסך (אזהרת React / עבודה מיותרת).
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  const week = useMemo(() => weekOf(weekStart), [weekStart]);
  const needsWeek = topic === 'income' || topic === 'delivery';
  const topicMeta = TOPICS.find((t) => t.key === topic);

  // מצב הורדת-המלאי הנגזרת (תעודות משלוח/חשבוניות — ר' logistics-deduction.js),
  // id -> { weekCode, cartonsCrossCheck, results, ... }. בשרת-בלבד (in-memory),
  // כי לטבלאות האלה אין שדה "הערות" משלהן לשמור בו state (ר' server.js).
  const [logisticsById, setLogisticsById] = useState({});

  // silent — רענון ברקע בלי להחליף את הטבלה בשלד (כדי שלא יהבהב כל 15 שניות)
  // fresh=1: עוקף את מטמון-הקריאה (30 שניות) בשרת — Make כותב ישירות ל-Airtable
  // בלי לעבור בשרת שלנו, כך שאין שום invalidateReads שיודע לנקות קאש-ישן (ר'
  // תוספת 2026-10-06, סעיף L). המסך הזה הוא בדיוק מי שצריך לראות "נותח" מהר
  // כי הוא בפולינג פעיל על "ממתין לעיבוד".
  const loadHistory = (opts = {}) => {
    if (opts.silent !== true) setHistLoading(true);
    Promise.all([
      ...Object.entries(TARGETS).map(([key, t]) =>
        app.api.get(t.table, '?maxRecords=60&raw=1&fresh=1').then((d) => (Array.isArray(d) ? d : [])
          .filter((r) => Array.isArray(r[t.field]) && r[t.field].length)
          .map((r) => ({
            key, id: r.id, table: t.table,
            label: TOPICS.find((x) => x.key === key)?.label || t.table,
            date: r[t.dateField] || r['תאריך'] || r['תאריך העלאת קובץ'] || '',
            uploadedAt: r[t.uploadedField] || r[t.dateField] || '',
            week: r['קוד שבוע'] || '',
            name: r[t.field][0]?.filename || 'קובץ',
            url: r[t.field][0]?.url || '',
            analyzed: isAnalyzed(r, t),
            notes: r['הערות'] || '', // לניתוח מלאי-AI בהוצאות בלבד (ר' inventoryAi.js) — ריק/לא רלוונטי בשאר הסוגים
          }))).catch(() => [])
      ),
      ...['תעודות משלוח', 'חשבוניות'].map((tbl) =>
        authFetch(`/api/logistics/${encodeURIComponent(tbl)}/status`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
      ),
    ]).then((all) => {
      if (!isMounted.current) return;
      const historyResults = all.slice(0, Object.keys(TARGETS).length);
      const [notesStatus, invoicesStatus] = all.slice(Object.keys(TARGETS).length);
      setLogisticsById({ ...notesStatus, ...invoicesStatus });
      setHistory(historyResults.flat().sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))).slice(0, 20));
      setHistLoading(false);
    });
  };
  useEffect(() => { loadHistory(); }, []);

  const retryLogistics = async (h) => {
    try {
      const r = await authFetch(`/api/logistics/${encodeURIComponent(h.table)}/${h.id}/analyze-inventory`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `שגיאה ${r.status}`);
      toast('הניתוח הופעל מחדש');
      loadHistory({ silent: true });
    } catch (e) {
      toast(`לא ניתן היה להפעיל ניתוח מחדש: ${e.message || e}`, 'error');
    }
  };

  // ההיסטוריה מתרעננת מעצמה כל עוד יש בה מסמך "ממתין לעיבוד" — גם אם ההעלאה
  // נעשתה בביקור קודם במסך (המעקב שלמעלה חי רק בביקור שבו הועלה הקובץ).
  // כולל גם "ממתין לנתוני ניתוח" בהורדת-מלאי נגזרת (תעודות/חשבוניות) —
  // זה יכול להישאר ממתין אחרי שה-AI עצמו (isAnalyzed) כבר הושלם, כי Make
  // ממלא "כמות קרטונים"/"מספר משטחים" בנפרד (ר' logistics-deduction.js).
  const pendingCount = history.filter((h) => !h.analyzed
    || ((h.key === 'delivery' || h.key === 'income') && logisticsAiSummary(logisticsById[h.id])?.kind === 'pending')).length;
  useEffect(() => {
    if (!pendingCount) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - historyPollFrom.current > HISTORY_POLL_MAX_MS) { clearInterval(timer); return; }
      loadHistory({ silent: true });
    }, HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [pendingCount]);

  // ---------- מעקב אחרי הרשומה שנוצרה (סעיף "לאחר ההעלאה" באיפיון) ----------
  // קוראים מחדש את הרשומה עצמה (לא את כל הטבלה) עד שה-Automation ממלאת נתונים,
  // ומעדכנים את המסך בלי שהמשתמש יצטרך לרענן.
  useEffect(() => {
    if (!created) return undefined;
    const target = TARGETS[created.key];
    let stopped = false;
    setTracking('polling');
    const check = async () => {
      try {
        const rec = await app.api.get(target.table, `/${created.id}`);
        if (stopped) return;
        setCreatedRec(rec);
        if (isAnalyzed(rec, target)) { setTracking('analyzed'); stopped = true; clearInterval(timer); loadHistory(); }
      } catch { /* ננסה שוב בבדיקה הבאה */ }
      if (!stopped && Date.now() - created.at > POLL_MAX_MS) { setTracking('timeout'); stopped = true; clearInterval(timer); }
    };
    const timer = setInterval(check, POLL_MS);
    check();
    return () => { stopped = true; clearInterval(timer); };
  }, [created]);

  // תצוגה מקדימה לתמונות
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickTopic = (key) => {
    setTopic(key); setStatus('idle'); setMessage(''); setFile(null);
    setWeekConfirmed(false); setChangingWeek(false); setWeekStart(defaultWeekStart());
    setCreated(null); setCreatedRec(null); setTracking('idle');
  };

  const acceptFile = async (f) => {
    if (!f) return;
    const okType = /\.(pdf|jpe?g|png)$/i.test(f.name) || ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type);
    if (!okType) { setStatus('error'); setMessage('סוג קובץ לא נתמך. יש להעלות PDF, JPG או PNG.'); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setStatus('error'); setMessage(`הקובץ גדול מדי (מקסימום ${MAX_MB}MB).`); return; }
    const small = await shrinkImage(f);
    if (small.size > 5 * 1024 * 1024) { setStatus('error'); setMessage('הקובץ גדול מ-5MB גם לאחר כיווץ — יש להעלות קובץ קטן יותר.'); return; }
    setFile(small); setStatus('idle'); setMessage('');
  };

  const shiftWeek = (weeks) => { const d = new Date(weekStart); d.setDate(d.getDate() + weeks * 7); setWeekStart(d); };

  const canSend = topic && file && (!needsWeek || weekConfirmed) && status !== 'uploading';

  const handleUpload = async () => {
    if (!canSend) return;
    setStatus('uploading'); setMessage('');
    try {
      const target = TARGETS[topic];
      const fd = new FormData();
      fd.append('file', file);
      fd.append('table', target.table);
      fd.append('field', target.field);
      if (needsWeek) fd.append('weekCode', week.code);
      const r = await authFetch('/api/upload-document', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      // קובץ פגום/לא רלוונטי (למשל טקסט שנשמר בשם "קובץ.pdf") — הודעה ברורה,
      // בלי ניסוח טכני, ובלי שנוצרה רשומה כלשהי ב-Airtable (השרת בדק לפני היצירה)
      if (data.invalidFile) { setStatus('error'); setMessage(data.error || 'הקובץ אינו תקין.'); return; }
      if (!r.ok || data.error) throw new Error(data.error || `שגיאה ${r.status}`);
      // הצלחה מוצגת רק אחרי ש-Airtable החזיר את הרשומה שנוצרה בפועל
      const recId = data.record?.id;
      if (!recId) throw new Error('השמירה לא הושלמה — נסו שוב');
      setStatus('done');
      setMessage('');
      setCreatedRec(data.record);
      setCreated({ key: topic, table: target.table, id: recId, name: file.name, at: Date.now() });
      setFile(null);
      historyPollFrom.current = Date.now();
      loadHistory();
    } catch (e) {
      setStatus('error');
      setMessage(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
    }
  };

  const sizeLabel = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  // מחיקת מסמך מההיסטוריה — כשהמסמך עדיין לא נותח, ייתכן שהוא בעיבוד פעיל
  // אצל Make ברגע זה; מחיקה עלולה לגרום לשגיאה שם (הרשומה נעלמת תוך כדי
  // עדכון). אזהרה ייעודית מוצגת רק במקרה הזה, ולא בכל מחיקה.
  // מחיקה מדורגת: המסמך שהועלה *הוא* הרשומה עצמה (חשבונית/הוצאה/תעודה
  // עם הקובץ ונתוני הניתוח יחד, לא רשומה נפרדת שנוצרה "בעקבותיו") — אז
  // אין "רשומות נגזרות" יתומות שנשארות. אבל יש השפעת-שרשרת אמיתית:
  // המסמך עשוי להיות מקושר לצ'ק (יאבד את הקישור) ולסיכום שבועי (סכומי
  // Rollup שם יתעדכנו אוטומטית וישתנו בלי אזהרה נפרדת) — לכן בודקים
  // ומציגים את זה במפורש בדיאלוג האישור לפני מחיקה.
  const deleteHistoryRow = async (h) => {
    let linkedChecks = [];
    let linkedWeek = null;
    try {
      const raw = await app.api.get(h.table, `/${h.id}?raw=1`);
      const checks = raw?.['צ׳קים'];
      if (Array.isArray(checks)) linkedChecks = checks;
      const week = raw?.['סיכום שבועי'];
      if (Array.isArray(week) && week.length) linkedWeek = week[0];
    } catch { /* אם הבדיקה נכשלת — ממשיכים לאישור הרגיל בלי הפרטים הנוספים */ }

    const impactLines = [];
    if (linkedChecks.length) {
      impactLines.push(`מקושר ל-${linkedChecks.length === 1 ? 'צ\'ק אחד' : `${linkedChecks.length} צ'קים`} — הקישור יוסר מהם.`);
    }
    if (linkedWeek) {
      impactLines.push('נכלל בסיכום השבועי — הסכומים המצטברים שם יתעדכנו אוטומטית (יקטנו) אחרי המחיקה.');
    }

    const baseMsg = h.analyzed
      ? 'הפריט ימחק ולא יינתן לשחזור.'
      : 'המסמך עדיין מסומן כ"ממתין לעיבוד" — ייתכן שהוא בעיבוד פעיל כרגע. מחיקה עכשיו עלולה להתנגש עם הניתוח ולגרום לשגיאה בצד המערכת המנתחת.\nהפריט ימחק ולא יינתן לשחזור.';
    const message = impactLines.length
      ? `${baseMsg}\n\nמה עוד יושפע:\n${impactLines.map((l) => `• ${l}`).join('\n')}\n\nלהמשיך במחיקה?`
      : `${baseMsg} אין רשומות אחרות שיושפעו.\nהאם אתה בטוח שברצונך לבצע פעולה זו?`;

    const ok = await confirmDialog({ title: `מחיקת ${h.label}`, message, confirmLabel: 'מחק', danger: true });
    if (!ok) return;
    try {
      await app.api.remove(h.table, h.id);
    } catch {
      toast('לא ניתן היה למחוק את הפריט.', 'error');
      return;
    }
    toast('הפריט נמחק בהצלחה');
    loadHistory();
  };

  return (
    <div>
      <PageHeader icon="⬆️" title="העלאת מסמך" />

      <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* ===== שלב 1 — נושא ===== */}
        <div className="section-title" style={{ marginTop: 0 }}>1. נושא המסמך</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {TOPICS.map((t) => {
            const on = topic === t.key;
            return (
              <button key={t.key} type="button" onClick={() => pickTopic(t.key)} aria-pressed={on}
                style={{
                  padding: '18px 10px', borderRadius: 14, cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'center',
                  border: `2px solid ${on ? t.color : 'var(--border)'}`, background: on ? t.soft : '#fff',
                  boxShadow: on ? `inset 0 -4px 0 ${t.color}` : 'none',
                }}>
                <div style={{ fontSize: 30 }}>{t.icon}</div>
                <div style={{ fontWeight: 700, marginTop: 6, color: on ? t.color : 'var(--text-main)' }}>{t.label}</div>
              </button>
            );
          })}
        </div>

        {/* ===== שלב 2 — שבוע ===== */}
        {needsWeek && (
          <div className="card" style={{ marginTop: 22, background: weekConfirmed ? 'var(--ok-soft)' : 'var(--bg-secondary)', border: `1px solid ${weekConfirmed ? 'var(--ok)' : 'var(--border)'}` }}>
            <div className="section-title" style={{ marginTop: 0 }}>2. שבוע המסמך</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>שבוע עסקי: שבת → חמישי (יום שישי אינו נכלל)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {changingWeek && <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWeek(-1)}>‹ שבוע קודם</button>}
              <div style={{ fontWeight: 800, fontSize: 18, direction: 'ltr' }}>{week.label}</div>
              {changingWeek && <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWeek(1)}>שבוע הבא ›</button>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>קוד שבוע: <b style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{week.code}</b></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {weekConfirmed ? (
                <>
                  <span className="badge badge-ok" style={{ padding: '8px 14px' }}>✓ השבוע אושר</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setWeekConfirmed(false); setChangingWeek(true); }}>שנה שבוע</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-success" onClick={() => { setWeekConfirmed(true); setChangingWeek(false); }}>✓ השבוע נכון</button>
                  {!changingWeek && <button type="button" className="btn btn-ghost" onClick={() => setChangingWeek(true)}>שנה שבוע</button>}
                </>
              )}
            </div>
          </div>
        )}

        {/* ===== שלב 3 — קובץ ===== */}
        {topic && (
          <div style={{ marginTop: 22 }}>
            <div className="section-title">{needsWeek ? '3' : '2'}. בחר קובץ</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '36px 20px', border: `2px dashed ${dragOver ? 'var(--accent-top)' : 'var(--border)'}`, borderRadius: 14,
                cursor: 'pointer', background: dragOver ? 'var(--docs-soft)' : 'var(--bg-secondary)',
              }}>
              <div style={{ fontSize: 40 }}>⬆️</div>
              <div style={{ fontWeight: 700 }}>בחר קובץ מהמכשיר או גרור לכאן</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>PDF · JPG · PNG · עד {MAX_MB}MB</div>
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }} />

            {file && (
              <div className="card" style={{ marginTop: 14, background: 'var(--bg-main)', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                {preview ? <img src={preview} alt="תצוגה מקדימה" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                  : <div style={{ width: 90, height: 90, borderRadius: 10, background: 'var(--docs-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>📄</div>}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{file.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{topicMeta?.label} · {sizeLabel(file.size)}</div>
                  {needsWeek && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>שבוע {week.label} · <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{week.code}</span></div>}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>✕ הסר</button>
              </div>
            )}
          </div>
        )}

        {/* ===== שלב 4 — סיכום ושליחה ===== */}
        {topic && file && (
          <div style={{ marginTop: 22 }}>
            <div className="section-title">{needsWeek ? '4' : '3'}. אישור ושליחה</div>
            <div className="card" style={{ background: 'var(--bg-secondary)', marginBottom: 14 }}>
              <Row l="נושא" v={topicMeta?.label} />
              <Row l="קובץ" v={file.name} />
              <Row l="יישמר בטבלה" v={TARGETS[topic].table} />
              {needsWeek && <Row l="שבוע" v={week.label} />}
              {needsWeek && <Row l="קוד שבוע" v={<span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{week.code}</span>} />}
            </div>
            {needsWeek && !weekConfirmed && <div className="badge badge-warn" style={{ width: '100%', marginBottom: 12 }}>⚠️ יש לאשר את השבוע לפני השליחה</div>}
            <button type="button" className="btn btn-primary" style={{ width: '100%', minHeight: 52, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }} disabled={!canSend} aria-busy={status === 'uploading'} onClick={handleUpload}>
              {status === 'uploading' ? <><span className="spinner" /> מעלה את המסמך...</> : '📤 שלח מסמך'}
            </button>
          </div>
        )}

        {status === 'done' && created && (
          <div style={{ padding: 20, marginTop: 16, background: 'var(--ok-soft)', borderRadius: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34 }}>✅</div>
              <div style={{ fontWeight: 800, color: 'var(--ok)', fontSize: 17 }}>✓ המסמך הועלה בהצלחה</div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>נשלח לעיבוד</div>
            </div>
            <ProcessingCard created={created} rec={createdRec} tracking={tracking} />
            <div style={{ textAlign: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => pickTopic(topic)}>העלה מסמך נוסף</button>
            </div>
          </div>
        )}
        {status === 'error' && <div style={{ padding: 14, marginTop: 16, background: 'var(--error-soft)', borderRadius: 12, color: 'var(--error)' }}>❌ {message}</div>}

        {!topic && <div className="empty-state" style={{ padding: '30px 10px' }}><div className="icon">📋</div>בחר תחילה את נושא המסמך</div>}
      </div>

      {/* ===== היסטוריה ===== */}
      <div className="card" style={{ marginTop: 30 }}>
        <div className="section-title" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>מסמכים שהועלו לאחרונה</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadHistory} disabled={histLoading}>🔄 רענן</button>
        </div>
        {histLoading ? <div className="skeleton skeleton-card" /> : history.length === 0 ? (
          <div className="empty-state">אין העלאות אחרונות</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>נושא</th><th>קובץ</th><th>תאריך העלאה</th><th>תאריך מסמך</th><th>שבוע</th><th>סטטוס</th><th>מלאי</th>{canEdit && <th className="no-print" />}</tr></thead>
              <tbody>
                {history.map((h, i) => {
                  const meta = TOPICS.find((t) => t.key === h.key);
                  // תעודות משלוח/חשבוניות: הורדה נגזרת (קרטונים/נילונים/כובעים/משטחים —
                  // ר' logistics-deduction.js), מצב בשרת-בלבד (in-memory) לפי record id.
                  // צ'קים: במפורש "אין השפעה" ולא שתיקה (סעיף L, בקשת תמר).
                  const aiSummary = h.key === 'expense' ? inventoryAiSummary(readInventoryAiState(h.notes))
                    : (h.key === 'delivery' || h.key === 'income') ? logisticsAiSummary(logisticsById[h.id])
                      : null;
                  const canRetry = canEdit && (h.key === 'delivery' || h.key === 'income') && aiSummary && aiSummary.kind !== 'ok';
                  return (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td><span className="badge" style={{ background: meta?.soft, color: meta?.color }}>{meta?.icon} {h.label}</span></td>
                      <td style={{ overflowWrap: 'anywhere' }}>{h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.name}</a> : h.name}</td>
                      <td>{h.uploadedAt ? formatDate(h.uploadedAt) : 'לא זמין'}</td>
                      <td>{h.date ? formatDate(h.date) : 'לא זמין'}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right' }}>{h.week || '—'}</td>
                      <td>{h.analyzed ? <span className="badge badge-ok">נותח</span> : <span className="badge badge-warn">ממתין לעיבוד</span>}</td>
                      <td>
                        {aiSummary ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className={`badge ${aiSummary.kind === 'ok' ? 'badge-ok' : (aiSummary.kind === 'warn' || aiSummary.kind === 'pending') ? 'badge-warn' : aiSummary.kind === 'error' ? 'badge-error' : ''}`} title={aiSummary.text}>
                              📦 {aiSummary.text}
                            </span>
                            {canRetry && (
                              <button type="button" className="btn btn-ghost btn-sm" title="נסה שוב — להריץ את הצלבת המלאי מחדש" aria-label={`ניסיון חוזר להורדת מלאי: ${h.label}`} style={{ padding: '2px 6px' }} onClick={() => retryLogistics(h)}>🔄</button>
                            )}
                          </span>
                        ) : h.key === 'expense' ? <span className="muted" style={{ fontSize: 12 }}>—</span>
                          : h.key === 'cheque' ? <span className="muted" style={{ fontSize: 12 }} title="לצ'קים אין השפעה על מלאי">אין השפעה</span>
                            : null}
                      </td>
                      {canEdit && (
                        <td className="no-print">
                          <button type="button" className="btn btn-sm btn-ghost" aria-label={`מחיקת ${h.label}`} title="מחיקה"
                            style={{ color: 'var(--error)' }}
                            onClick={() => deleteHistoryRow(h)}>🗑</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ l, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><b style={{ overflowWrap: 'anywhere', textAlign: 'left' }}>{v}</b></div>;
}

/**
 * כרטיס מעקב אחרי העיבוד ב-Airtable: מציג את שדות הניתוח ברגע שה-Automation
 * ממלאת אותם. הנתונים מוצגים רק אחרי שהתקבלו מהמקור (ללא Optimistic UI).
 */
function ProcessingCard({ created, rec, tracking }) {
  const target = TARGETS[created.key];
  const filled = target.analysis.map(([label, field, kind]) => [label, fmtAnalysis(rec?.[field], kind)]).filter(([, v]) => v !== null);
  const badge = tracking === 'analyzed'
    ? <span className="badge badge-ok">✓ נותח</span>
    : tracking === 'timeout'
      ? <span className="badge badge-warn">עדיין בעיבוד</span>
      : <span className="badge badge-warn"><span className="spinner spinner-sm" /> בעיבוד</span>;
  return (
    <div className="card" style={{ marginTop: 14, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>📄 {created.name}</div>
        {badge}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        נשמר בטבלה "{target.table}"
        {tracking === 'polling' && ' · המסך מתעדכן אוטומטית כשהניתוח מסתיים'}
        {tracking === 'timeout' && ' · הניתוח טרם הסתיים; התוצאה תופיע בהיסטוריה כשתהיה מוכנה'}
      </div>
      {filled.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {filled.map(([l, v]) => <Row key={l} l={l} v={v} />)}
        </div>
      )}
    </div>
  );
}
