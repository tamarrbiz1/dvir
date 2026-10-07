// ============================================================
// חילוץ "שנה" מתוך תאריך (ISO) או קוד-שבוע — לשימוש בסינון-שנה בטאב
// "תחזית שתילה" (CropsPage.jsx, סעיף T, 2026-10-07). פונקציה טהורה,
// לא תלויה ב-React — כך שגם qa-check.mjs בשרת יכול לייבא ולבדוק אותה
// ישירות (בדיוק כמו inventoryLedger.js).
//
// שני פורמטים נתמכים:
//  - תאריך ISO: "YYYY-MM-DD" (עם או בלי חלק-זמן בסוף) — השנה היא 4
//    הספרות הראשונות.
//  - קוד-שבוע "YYYYMMDD-YYYYMMDD" (שבת–חמישי, ר' WEEK_CODE_RE +
//    weekCodeFromDate ב-server/src/weekly-sync.js — אותה קונבנציה
//    בדיוק; כאן רק מחלצים את השנה מתחילת הקוד, לא בונים אותו).
// ערך ריק/חסר/לא תקין -> null, לעולם לא זורק.
// ============================================================
const WEEK_CODE_RE = /^(\d{4})\d{4}-\d{8}$/;
const ISO_DATE_RE = /^(\d{4})-\d{2}-\d{2}/;

export function yearFromWeekValue(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const codeMatch = WEEK_CODE_RE.exec(s);
  if (codeMatch) return Number(codeMatch[1]);
  const isoMatch = ISO_DATE_RE.exec(s);
  if (isoMatch) return Number(isoMatch[1]);
  return null;
}

// ============================================================
// אותם שני פורמטים → Date בחצות **מקומית** (לא UTC), או null.
// למה לא `new Date(value)` ישירות (לילה 3, 2026-10-07):
//  1. `new Date(null)` מחזיר את 1.1.1970 — Date *תקין* לכל דבר, ש-
//     Number.isNaN לא תופס. שדה-תאריך ריק שחוזר כ-null הופך לנקודת-נתון
//     פנטום בינואר 1970 שמותחת את ציר-הזמן של כל גרף.
//  2. `new Date('2026-08-28')` נקרא כחצות UTC — באזור-זמן שלילי זה כבר
//     27.8 מקומית, והחודש/השנה בגרף זזים. parseIso בונה חצות מקומית,
//     בדיוק כמו parseDate ב-server/src/forecast-preflight.js.
//  3. `new Date('05/12/2026')` נקרא כ-12 במאי (m/d/y אמריקאי), לא
//     כ-5 בדצמבר. כאן פשוט מוחזר null במקום תאריך שגוי בשקט.
// ============================================================
function parseIso(y, m, d) {
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  // "2026-02-31" → 3.3; פסילה, לא תיקון שקט
  if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  return date;
}

export function dateFromWeekValue(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const codeMatch = WEEK_CODE_RE.exec(s);
  if (codeMatch) return parseIso(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
  const isoMatch = ISO_DATE_RE.exec(s);
  if (isoMatch) return parseIso(s.slice(0, 4), s.slice(5, 7), s.slice(8, 10));
  return null;
}

// ============================================================
// תאריך חשבונית — סדר-עדיפות אחד ויחיד לכל מי שצריך "מתי החשבונית הזו"
// ------------------------------------------------------------
// באג שנמצא בלילה 3 (2026-10-07): כרטיס-המשווק ב-FinancePage.jsx קרא
// `inv['תאריך']`, **שדה שלא קיים בטבלת "חשבוניות" בכלל**. שדותיה הם
// "תאריך-AI" / "תאריך העלאת קובץ" / "העלאה אחרונה של החשבונית" /
// "קוד שבוע". התוצאה: new Date(undefined) → Invalid Date → כל חשבונית
// נזרקה, וגרף "פדיון לפי חודש" הציג "אין נתוני פדיון בתקופה זו" לכל
// משווק ובכל שלוש התקופות. הפיצ'ר כולו היה מת בשקט.
//
// סדר העדיפות, מהמדויק לפחות-מדויק:
//  1. "תאריך-AI" — תאריך החשבונית כפי שחולץ מהמסמך. זה התאריך העסקי
//     הנכון (חשבונית 61: תאריך-AI 31.7.2026, הועלתה רק ב-6.10 — תאריך
//     ההעלאה היה תולה אותה בחודש הלא-נכון).
//  2. "קוד שבוע" — שבוע השיווק בפועל.
//  3/4. תאריכי ההעלאה — נפילה-לאחור בלבד, כדי שחשבונית שה-AI לא חילץ
//     ממנה תאריך לא תיעלם מהגרף לגמרי.
// הפונקציה טהורה (אין React) כדי ש-qa-check.mjs יוכל לבדוק אותה ישירות.
// ============================================================
export const INVOICE_DATE_FIELDS = ['תאריך-AI', 'קוד שבוע', 'תאריך העלאת קובץ', 'העלאה אחרונה של החשבונית'];

export function invoiceDate(invoice) {
  for (const field of INVOICE_DATE_FIELDS) {
    const d = dateFromWeekValue(invoice?.[field]);
    if (d) return d;
  }
  return null;
}

export default { yearFromWeekValue, dateFromWeekValue, invoiceDate, INVOICE_DATE_FIELDS };
