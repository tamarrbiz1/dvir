// ============================================================
// בדיקת מוכנות-תחזית לתוכנית שתילה (read-only) — תוספת 2026-10-06, סעיף E
// **נכתב מחדש במשימה AL (13.10.2026) — ר' "איחוד" למטה.**
// ------------------------------------------------------------
// הבעיה המקורית: "רענן תחזית" נכשל בשקט כשחסרים נתוני-בסיס — תפוקה
// רבעונית לגידול+רבעון, או מחיר גידול משוער — והמשתמשת לא קיבלה שום
// שגיאה; פשוט לא נוצרו שורות "תחזית שתילה שבועית" (ר' תוכנית 42
// שנשארה ריקה).
//
// ------------------------------------------------------------
// איחוד (AL, §1.5 במשימה): אין יותר שתי לוגיקות
// ------------------------------------------------------------
// עד AL היה כאן **שחזור עצמאי** של תנאי-הזכאות של סקריפט-Airtable:
// אילו רבעונים רלוונטיים, איזה מחיר תקף, מה נחשב "חסר". זה החזיק שתי
// אמיתות שהיה מובטח שיסטו אחת מהשנייה — וזה כבר קרה: בלילה 3
// (7.10.2026) המחיר-לפי-טווח-תאריכים נבדק כאן לפי `שנה` בלבד, ולכן
// מחיר תקף לגמרי דווח כ"חסר" ותמר נשלחה לתקן נתון שלא היה שבור.
//
// מאז AL החישוב **עבר לשרת** (`forecast-build.js`), ולכן הבדיקה הזו
// היא פשוט אותה בנייה ב-`dryRun`: אותה פונקציה, אותם מקורות, **אותן
// הודעות-חוסר בדיוק** שתמר תראה אם תלחץ "רענן תחזית". אי-אפשר יותר
// שהצ'יפ יגיד "מוכן" והבנייה תיכשל, או להיפך.
// ============================================================
import { buildForecastForPlan, fetchForecastSources, quarterFromDate, parseDate } from './forecast-build.js';

const linkedIds = (value) => {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => (v && typeof v === 'object' ? v.id : v)).filter(Boolean);
};

/**
 * בדיקת מוכנות-תחזית לתוכנית בודדת — read-only בלבד (dryRun).
 * מחזיר: { ok, planId, planNumber, year, checkedCropNames, checkedQuarters, missing, preview }
 * — אותו מבנה-תשובה שהלקוח צורך מאז סעיף E, כדי שהצ'יפ והמודאל
 * הקיימים ימשיכו לעבוד בלי שינוי.
 */
export async function checkForecastPreflight(planId, { sources = null } = {}) {
  const data = sources || await fetchForecastSources();
  const plan = data.plans.find((p) => p.id === planId);
  if (!plan) {
    return {
      ok: false, planId, planNumber: null, year: null,
      checkedCropNames: [], checkedQuarters: [],
      missing: ['התוכנית לא נמצאה'], preview: null,
    };
  }

  const result = await buildForecastForPlan(planId, { dryRun: true, sources: data });

  const cropNames = linkedIds(plan['גידולים'])
    .map((id) => data.crops.find((c) => c.id === id)?.['שם גידול'] || id);

  // הרבעונים שהבנייה נגעה בהם. כשהתוכנית נפלה עוד לפני הלופ (אין
  // תאריכי קטיף או אין גידול) אין רבעונים — ואז הם נגזרים מהטווח, כדי
  // שהתשובה תישאר אינפורמטיבית כמו קודם.
  let checkedQuarters = result.quarters || [];
  if (!checkedQuarters.length) {
    const start = parseDate(plan['תחילת קטיף מעודכנת']) || parseDate(plan['תחילת קטיף מקורית']);
    const end = parseDate(plan['סוף קטיף מעודכן']) || parseDate(plan['סוף קטיף מקורי']) || start;
    if (start && end && end >= start) {
      const qs = new Set();
      const cursor = new Date(start);
      let guard = 0;
      while (cursor <= end && guard < 64) {
        qs.add(quarterFromDate(cursor));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        guard += 1;
      }
      checkedQuarters = [...qs].sort((a, b) => a - b);
    }
  }

  return {
    ok: result.ok,
    planId,
    planNumber: plan['מספר תוכנית'] ?? null,
    year: Number(plan['שנת תוכנית']) || null,
    checkedCropNames: cropNames,
    checkedQuarters,
    missing: result.missing || [],
    // תוספת AL — מה *היה* קורה אם היו לוחצים "רענן תחזית" עכשיו
    preview: result.ok
      ? { weeks: result.weeks?.length || 0, created: result.created, updated: result.updated, deleted: result.deleted, unchanged: result.unchanged }
      : null,
  };
}

export default { checkForecastPreflight };
