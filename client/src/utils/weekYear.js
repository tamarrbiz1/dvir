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

export default { yearFromWeekValue };
