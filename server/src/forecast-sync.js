// ============================================================
// סנכרון-תחזית אוטומטי (תוספת 2026-10-07, סעיף T) — "גידולים ותחזיות":
// שינוי/מחיקה של "מחירי גידול משוערים" או "תפוקה רבעונית" אמור להשפיע
// מיד על תחזית השתילה של כל תוכנית ששייכת לאותו גידול.
// ------------------------------------------------------------
// *אין כאן שום חישוב תחזית חדש* — ר' forecast-preflight.js וההערה שם:
// החישוב בפועל (יצירת/עדכון שורות "תחזית שתילה שבועית", כולל בחירת
// רשומת-המחיר/התפוקה-הרבעונית הספציפית שמקושרת לכל שורה — "מחיר-ידני
// > מחיר לפי שנה/טווח-תאריכים > ברירת-מחדל-שנתית") היא אוטומציה קיימת
// ב-Airtable על טבלת "תוכניות שתילה", שמופעלת ע"י מעבר false→true בשדה
// "רענן תחזית" (בדיוק כמו forceTrigger ב-PlantingPlanPage.jsx). המודול
// הזה רק *מפעיל מחדש את אותה אוטומציה* על כל תוכנית רלוונטית, בכל פעם
// שנתון-הבסיס שהיא תלויה בו משתנה — כדי שהמשתמש לא יצטרך ללחוץ ידנית
// "רענן תחזית" בעצמו אחרי כל שינוי מחיר/תפוקה.
//
// למה גם במחיקה: שדה-הקישור (Link) מ"תחזית שתילה שבועית" לרשומת המחיר/
// התפוקה הספציפית שנבחרה מתנתק אוטומטית ע"י Airtable כשהרשומה המקושרת
// נמחקת (ה-lookup "...from..." נהיה ריק מיד, בלי צורך בשום פעולה כאן) —
// זה בדיוק מה שגורם ל"אין נתון" להופיע מיד. אבל אם קיימת רשומת-חלופה
// תקפה (למשל מחיר-טווח-תאריכים נמחק אך נשאר מחיר ברירת-מחדל שנתית לאותה
// שנה) — Airtable *לא* מקשר-מחדש לבד; רק הרצה-מחדש של האוטומציה "יודעת"
// לחפש חלופה ולקשר אליה. לכן גם במחיקה מפעילים מחדש, לא רק ב-invalidate.
// ============================================================
import { fetchRecords, updateRecord } from './airtable.js';

const PLANS_TABLE = 'תוכניות שתילה';
const PLANS_CROP_FIELD = 'גידולים'; // שדה-קישור לגידול/ים בתוכנית שתילה (רבים)
const SOURCE_CROP_FIELD = 'גידול'; // שדה-קישור לגידול (יחיד) במחירים/תפוקה רבעונית
const TRIGGER_FIELD = 'רענן תחזית';

// שתי הטבלאות שמשפיעות על חישוב התחזית — אותן טבלאות שהתוספת הזו עוקבת
// אחריהן (ר' forecast-preflight.js: QUARTERLY_YIELD_TABLE / CROP_PRICES_TABLE).
export const FORECAST_SOURCE_TABLES = new Set(['מחירי גידול משוערים', 'תפוקה רבעונית']);

export function isForecastSourceTable(table) {
  return FORECAST_SOURCE_TABLES.has(table);
}

function linkedIds(value) {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);
}

/** מזהי-גידול שרשומת מחיר/תפוקה-רבעונית מסוימת מקושרת אליהם */
function cropIdsOfSourceRecord(record) {
  return linkedIds(record?.[SOURCE_CROP_FIELD]);
}

/**
 * fire-and-forget: מוצא את כל תוכניות-השתילה המקושרות לגידול(ים)
 * שהשתנו, ומפעיל מחדש עליהן את אוטומציית "רענן תחזית" (false→true,
 * בדיוק כמו forceTrigger בלקוח — ר' ההערה שם על למה חייבים מעבר ערך
 * אמיתי). לא זורק — כל כשל מתועד ללוג בלבד, לא חוזר לקורא (שכבר קיבל
 * תשובה מוצלחת על הכתיבה המקורית לפני שזה נקרא).
 */
export function syncForecastForChangedRecord(table, sourceRecord, { reason } = {}) {
  if (!isForecastSourceTable(table)) return;
  const recordId = sourceRecord?.id || '?';
  const cropIds = cropIdsOfSourceRecord(sourceRecord);
  if (!cropIds.length) {
    console.log(`[forecast-sync] ${table}/${recordId} (${reason}): אין שדה "${SOURCE_CROP_FIELD}" מקושר ברשומה — אין מה לסנכרן`);
    return;
  }

  (async () => {
    try {
      const plans = await fetchRecords(PLANS_TABLE, {});
      const affected = plans.filter((p) => linkedIds(p[PLANS_CROP_FIELD]).some((id) => cropIds.includes(id)));
      if (!affected.length) {
        console.log(`[forecast-sync] ${table}/${recordId} (${reason}): אין תוכניות שתילה מקושרות לגידול(ים) שהשתנו`);
        return;
      }
      const planLabel = affected.map((p) => p['מספר תוכנית'] ?? p.id).join(', ');
      console.log(`[forecast-sync] ${table}/${recordId} (${reason}): מפעיל מחדש "${TRIGGER_FIELD}" על ${affected.length} תוכניות (${planLabel})`);
      for (const plan of affected) {
        try {
          // false->true תמיד (גם אם תקוע על true מריצה קודמת) — ר' ההערה
          // המקבילה ב-PlantingPlanPage.jsx (forceTrigger).
          await updateRecord(PLANS_TABLE, plan.id, { [TRIGGER_FIELD]: false });
          await updateRecord(PLANS_TABLE, plan.id, { [TRIGGER_FIELD]: true });
        } catch (e) {
          console.error(`[forecast-sync] כשל בהפעלת "${TRIGGER_FIELD}" לתוכנית ${plan.id}: ${e.message}`);
        }
      }
      console.log(`[forecast-sync] ${table}/${recordId} (${reason}): הושלם (${affected.length} תוכניות הופעלו)`);
    } catch (e) {
      console.error(`[forecast-sync] כשל כללי בסנכרון תחזית (${table}/${recordId}, ${reason}): ${e.message}`);
    }
  })();
}

export default { isForecastSourceTable, syncForecastForChangedRecord, FORECAST_SOURCE_TABLES };
