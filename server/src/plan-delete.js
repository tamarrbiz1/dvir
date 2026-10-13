// ============================================================
// מחיקת תוכנית-שתילה שלמה (משימה AI, 13.10.2026)
// ------------------------------------------------------------
// עד עכשיו אי-אפשר היה למחוק תוכנית שתילה מהממשק בכלל — רק תקופה
// בודדת. מחיקה "סתם" של רשומת התוכנית דרך DELETE /api/:table/:id
// הייתה משאירה בבסיס את כל הילדים שלה (תקופות ושורות-תחזית) בלי אב:
// הם לא נמחקים אוטומטית ב-Airtable, ושורת-תחזית בלי תוכנית מקושרת
// עדיין נספרת בגיליון השנתי ובדשבורד (הסינון שם הוא לפי שנה/מבנה, לא
// לפי "יש אב"). לכן המחיקה חייבת להיות מדורגת ומסודרת.
//
// הקישורים האמיתיים של "תוכניות שתילה" (אומת במטא החי, 13.10.2026):
//   תקופות תוכנית.תוכנית שתילה          → ילד, נמחק
//   תחזית שתילה שבועית.תוכנית שתילה      → ילד, נמחק
//   קטיפים.תוכניות שתילה                → **נתוני אמת**, חוסם מחיקה
//   מבנים.תוכניות שתילה / גידולים.תוכניות שתילה → קישור הפוך, מתנקה
//     לבד ע"י Airtable כשהתוכנית נמחקת. אין לגעת.
//
// סדר המחיקה: תחזיות → תקופות → התוכנית. מלמטה למעלה בכוונה — אם
// המחיקה נכשלת באמצע, מה שנשאר הוא תוכנית *עם* פחות ילדים (מצב תקין
// שאפשר לנסות שוב), ולא ילדים יתומים בלי אב (מצב שאי-אפשר לתקן
// מהממשק, כי אין דרך להגיע אליהם). לכן גם: אם מחיקת ילד נכשלה, **לא**
// מוחקים את התוכנית עצמה, ומחזירים 500 עם מה נמחק ומה נשאר.
//
// ⚠️ אוטומציות Airtable סביב מחיקה (נבדק ותועד, 13.10.2026):
// ל-Airtable אין בכלל טריגר "רשומה נמחקה" — אוטומציה יכולה להיות
// מופעלת מיצירה/עדכון/טופס/כניסה-לתצוגה בלבד. לכן מחיקת תקופות
// ושורות-תחזית אינה יכולה להפעיל אוטומציה *ישירות*. העקיפה היחידה
// האפשרית היא "רשומה עודכנה" בטבלה שתא-קישור שלה משתנה כתוצאה
// מהמחיקה — ואלה, לפי המטא, רק:
//   תוכניות שתילה (נמחקת בעצמה בסוף), מחירי גידול משוערים, תפוקה
//   רבעונית (שדה "תחזית שתילה שבועית" שלהן).
// הטבלה `סיכום שבועי` **אינה** מקושרת לא לתחזית ולא לתקופות (היא
// מקושרת רק לחשבוניות/תעודות-משלוח) — כלומר בניגוד לחשש שבמשימה,
// מחיקת תוכנית אינה נוגעת בה בכלל. גם `forecast-sync.js` שלנו אינו
// מגיב למחיקות האלה: הוא מופעל רק מכתיבה דרך ה-API שלנו על
// "מחירי גידול משוערים"/"תפוקה רבעונית" (ר' FORECAST_SOURCE_TABLES).
// ============================================================
import { getBase, fetchRecords, deleteRecords } from './airtable.js';

export const PLANS_TABLE = 'תוכניות שתילה';
export const PERIODS_TABLE = 'תקופות תוכנית';
export const PLAN_FORECAST_TABLE = 'תחזית שתילה שבועית';
export const HARVESTS_TABLE = 'קטיפים';

const PERIOD_PLAN_FIELD = 'תוכנית שתילה';
const FORECAST_PLAN_FIELD = 'תוכנית שתילה';
const HARVEST_PLAN_FIELD = 'תוכניות שתילה';

// status + statusCode: sendApiError ב-server.js קורא `statusCode` (זו
// התכונה שספריית Airtable מצרפת לשגיאות שלה), והנתיב עצמו קורא `status`.
// שתיהן מוגדרות כדי ששני המסלולים יחזירו את אותו קוד ולא ייפלו ל-500.
export class PlanNotFoundError extends Error {
  constructor(id) {
    super(`תוכנית השתילה ${id} לא נמצאה — ייתכן שכבר נמחקה`);
    this.status = 404;
    this.statusCode = 404;
  }
}

export class PlanHasHarvestsError extends Error {
  constructor(count) {
    super(`לתוכנית יש ${count} דיווחי קטיף — לא ניתן למחוק. אפשר להזיז או לערוך אותה.`);
    this.status = 409;
    this.statusCode = 409;
    this.harvests = count;
  }
}

/** מזהי-רשומות מתא-קישור (Airtable מחזיר מערך מזהים, או אובייקטים אחרי העשרה) */
function linkedIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);
}

/**
 * סורק טבלת-ילדים ומחזיר את מזהי השורות שמקושרות לתוכנית.
 * סריקה (ולא filterByFormula) בכוונה: ARRAYJOIN על שדה-קישור ב-Airtable
 * מחזיר את ה-Primary Field של הרשומה המקושרת ולא את מזהה ה-record שלה,
 * כך שהשוואה למזהה נכשלת **בשקט** ומחזירה אפס שורות — בדיוק התקלה
 * שמתועדת מעל GET /api/:table ב-server.js. כאן "אפס שורות בשקט" פירושו
 * ילדים יתומים שנשארים בבסיס, ולכן אסור להסתמך על נוסחה.
 */
async function childIdsOf(table, linkField, planId) {
  const rows = await fetchRecords(table, { fields: [linkField] });
  return rows.filter((r) => linkedIds(r[linkField]).includes(planId)).map((r) => r.id);
}

/**
 * מה יימחק אם ימחקו את התוכנית. read-only לחלוטין.
 * @returns {{ plan, periods: string[], forecasts: string[], harvests: string[] }}
 */
export async function planDeletionPreview(planId) {
  let rec;
  try {
    rec = await getBase()(PLANS_TABLE).find(planId);
  } catch {
    throw new PlanNotFoundError(planId);
  }
  const plan = { id: rec.id, ...rec.fields };
  // הילדים נספרים מסריקת טבלאות-הילדים ולא מתאי-הקישור של התוכנית:
  // תא-קישור הוא אותו מידע בדיוק כשהבסיס עקבי, אבל הסריקה תופסת גם
  // שורה שנוצרה בדיוק עכשיו ע"י אוטומציה ועוד לא השתקפה בתא של האב.
  const [periods, forecasts] = await Promise.all([
    childIdsOf(PERIODS_TABLE, PERIOD_PLAN_FIELD, planId),
    childIdsOf(PLAN_FORECAST_TABLE, FORECAST_PLAN_FIELD, planId),
  ]);
  // קטיפים: תא-הקישור של התוכנית מספיק ואמין (קטיף נוצר ידנית/מדיווח,
  // לא ע"י אוטומציה תוך-כדי-מחיקה), וזו טבלה גדולה שאין טעם לסרוק.
  const harvests = linkedIds(plan[HARVESTS_TABLE]);
  return { plan, periods, forecasts, harvests };
}

/**
 * מחיקה מדורגת של תוכנית שתילה שלמה.
 * זורק PlanNotFoundError (404) / PlanHasHarvestsError (409), ובכשל-אמצע
 * זורק Error עם status 500 ועם `partial` — כמה נמחק וכמה נשאר.
 */
export async function deletePlanCascade(planId) {
  const { plan, periods, forecasts, harvests } = await planDeletionPreview(planId);
  if (harvests.length) throw new PlanHasHarvestsError(harvests.length);

  const deleted = { forecasts: 0, periods: 0, plan: false };
  const remaining = { forecasts: forecasts.length, periods: periods.length };

  const fail = (what, e) => {
    const err = new Error(
      `מחיקת ${what} נכשלה — התוכנית **לא** נמחקה כדי לא להשאיר רשומות יתומות. ` +
      `נמחקו ${deleted.forecasts} שורות תחזית ו-${deleted.periods} תקופות; ` +
      `נשארו ${remaining.forecasts} שורות תחזית ו-${remaining.periods} תקופות. (${e.message || e})`,
    );
    err.status = 500;
    err.partial = { deleted, remaining };
    return err;
  };

  try {
    deleted.forecasts = await deleteRecords(PLAN_FORECAST_TABLE, forecasts);
  } catch (e) {
    deleted.forecasts = e.deletedCount || 0;
    remaining.forecasts = forecasts.length - deleted.forecasts;
    throw fail('שורות התחזית', e);
  }
  remaining.forecasts = 0;

  try {
    deleted.periods = await deleteRecords(PERIODS_TABLE, periods);
  } catch (e) {
    deleted.periods = e.deletedCount || 0;
    remaining.periods = periods.length - deleted.periods;
    throw fail('תקופות התוכנית', e);
  }
  remaining.periods = 0;

  try {
    await deleteRecords(PLANS_TABLE, [planId]);
  } catch (e) {
    // המצב היחיד שבו נשארת "תוכנית חצי-מחוקה": הילדים נמחקו והאב לא.
    // חובה לדווח אותו במפורש (ולא "המחיקה נכשלה" סתמי) — אחרת
    // המשתמשת תראה תוכנית שנראית תקינה אבל כל התקופות והתחזיות שלה
    // נעלמו, בלי לדעת למה. ניסיון מחיקה חוזר על אותה תוכנית יעבוד
    // (היא תהיה בלי ילדים) ולכן ההודעה מציעה בדיוק את זה.
    const err = new Error(
      `${deleted.forecasts} שורות תחזית ו-${deleted.periods} תקופות נמחקו, ` +
      `אבל מחיקת התוכנית עצמה נכשלה. התוכנית נשארה בלי התקופות והתחזיות שלה — ` +
      `נסי למחוק אותה שוב. (${e.message || e})`,
    );
    err.status = 500;
    err.statusCode = 500;
    err.partial = { deleted, remaining: { forecasts: 0, periods: 0 } };
    throw err;
  }
  deleted.plan = true;

  return {
    ok: true,
    planNumber: plan['מספר תוכנית'] ?? null,
    deleted: { forecasts: deleted.forecasts, periods: deleted.periods, plan: 1 },
  };
}

export default { planDeletionPreview, deletePlanCascade, PlanNotFoundError, PlanHasHarvestsError };
