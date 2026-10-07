// ============================================================
// בדיקת מוכנות-תחזית לתוכנית שתילה (read-only) — תוספת 2026-10-06, סעיף E
// ------------------------------------------------------------
// הבעיה: הכפתור/תיבת-הסימון "רענן תחזית" (אוטומציה ב-Airtable, טבלת
// "תוכניות שתילה") נכשלת בשקט כשחסרים נתוני-בסיס — "תפוקה רבעונית"
// לגידול+רבעון, או "מחיר גידול משוער" לגידול+שנה. המשתמש לא מקבל שום
// שגיאה; פשוט לא נוצרות שורות "תחזית שתילה שבועית" חדשות (ר' תוכנית 42
// שנשארה ריקה).
//
// המודול הזה *בודק בלבד* (fetchRecords, לא כתיבה) ומחזיר רשימת חוסרים
// בעברית ברורה — התיקון עצמו הוא בידי תמר ישירות ב-Airtable, לא כאן.
// ============================================================
import { fetchRecords } from './airtable.js';

const PLANS_TABLE = 'תוכניות שתילה';
const CROPS_TABLE = 'גידולים';
const QUARTERLY_YIELD_TABLE = 'תפוקה רבעונית';
const CROP_PRICES_TABLE = 'מחירי גידול משוערים';

const QUARTER_MONTHS = { 1: [0, 1, 2], 2: [3, 4, 5], 3: [6, 7, 8], 4: [9, 10, 11] };

/** כל מזהי-הקישור בשדה (לא רק הראשון) — "גידול" מוגדר כקישור-יחיד, אבל
 *  Airtable מרשה להוסיף שם יותר מאחד, ואז בדיקת-הראשון-בלבד שהייתה כאן
 *  עד לילה 3 "איבדה" התאמה ודיווחה חוסר-כזב. */
function allIds(value) {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => (v && typeof v === 'object' ? v.id : v)).filter(Boolean);
}

/** תאריך Airtable ("2027-01-30") -> Date בחצות מקומית, בלי הסטת אזור זמן */
function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function quarterOfMonth(m) {
  for (const [q, months] of Object.entries(QUARTER_MONTHS)) {
    if (months.includes(m)) return Number(q);
  }
  return null;
}

/** ערך "ריק" — null/undefined/מחרוזת ריקה. 0 אינו ריק (ר' הערה ב-PlantingPlanPage.jsx, actualKg). */
function isBlank(v) {
  return v === null || v === undefined || v === '';
}

/**
 * הרבעונים (1–4) שתקופת הקטיף של התוכנית חוצה — לפי הטווח המעודכן אם
 * קיים, אחרת המקורי (אותה לוגיקה בדיוק כמו computePlanRanges בלקוח).
 */
function relevantQuarters(plan) {
  const start = parseDate(plan['תחילת קטיף מעודכנת']) || parseDate(plan['תחילת קטיף מקורית']);
  if (!start) return [];
  const end = parseDate(plan['סוף קטיף מעודכן']) || parseDate(plan['סוף קטיף מקורי']) || start;
  const realEnd = end >= start ? end : start;

  const quarters = new Set();
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endCursor = new Date(realEnd.getFullYear(), realEnd.getMonth(), 1);
  // הגנת-שפיות: לא לולאה אינסופית אם תאריכים הפוכים/שבורים הגיעו מ-Airtable
  let guard = 0;
  while (cursor <= endCursor && guard < 64) {
    const q = quarterOfMonth(cursor.getMonth());
    if (q) quarters.add(q);
    cursor.setMonth(cursor.getMonth() + 1);
    guard += 1;
  }
  return [...quarters].sort((a, b) => a - b);
}

/**
 * בדיקת מוכנות-תחזית לתוכנית שתילה בודדת — read-only בלבד.
 * מחזיר: { ok, planId, planNumber, year, checkedCropNames, checkedQuarters, missing }
 * "missing" הוא מערך משפטים בעברית, לדוגמה:
 *   "חסר מחיר משוער לעגבניה לשנת 2026"
 *   "חסרה תפוקה רבעונית לרבעון 4 (מלפפון)"
 */
export async function checkForecastPreflight(planId) {
  const plans = await fetchRecords(PLANS_TABLE, {});
  const plan = plans.find((p) => p.id === planId);
  if (!plan) {
    return {
      ok: false, planId, planNumber: null, year: null,
      checkedCropNames: [], checkedQuarters: [],
      missing: ['התוכנית לא נמצאה'],
    };
  }

  const cropIds = allIds(plan['גידולים']);
  const year = Number(plan['שנת תוכנית']) || null;
  const quarters = relevantQuarters(plan);
  // טווח הקטיף בפועל (YYYY-MM-DD) — נחוץ לבדיקת מחיר-לפי-טווח-תאריכים
  const harvestFrom = String(plan['תחילת קטיף מעודכנת'] || plan['תחילת קטיף מקורית'] || '').slice(0, 10) || null;
  const harvestTo = String(plan['סוף קטיף מעודכן'] || plan['סוף קטיף מקורי'] || '').slice(0, 10) || harvestFrom;
  const missing = [];

  if (!cropIds.length) missing.push('לתוכנית זו אין גידול מקושר (שדה "גידולים" ריק)');
  if (!year) missing.push('לתוכנית זו אין "שנת תוכנית" — לא ניתן לבדוק מחיר משוער');
  if (!quarters.length) missing.push('לתוכנית זו אין תאריכי קטיף (מקוריים או מעודכנים) — לא ניתן לקבוע רבעונים רלוונטיים');

  // בלי גידול מקושר אין מה לבדוק מול תפוקה/מחירים — עוצרים כאן
  if (!cropIds.length) {
    return { ok: missing.length === 0, planId, planNumber: plan['מספר תוכנית'] ?? null, year, checkedCropNames: [], checkedQuarters: quarters, missing };
  }

  const [crops, yields, prices] = await Promise.all([
    fetchRecords(CROPS_TABLE, {}),
    fetchRecords(QUARTERLY_YIELD_TABLE, {}),
    fetchRecords(CROP_PRICES_TABLE, {}),
  ]);
  const cropById = new Map(crops.map((c) => [c.id, c]));
  const checkedCropNames = cropIds.map((id) => cropById.get(id)?.['שם גידול'] || id);

  for (const cropId of cropIds) {
    const cropName = cropById.get(cropId)?.['שם גידול'] || cropId;

    for (const q of quarters) {
      const hasYield = yields.some((y) => allIds(y['גידול']).includes(cropId)
        && Number(y['רבעון']) === q
        && !isBlank(y['קג לדונם לשבוע']));
      if (!hasYield) missing.push(`חסרה תפוקה רבעונית לרבעון ${q} (${cropName})`);
    }

    // מחיר: האוטומציה ב-Airtable בוחרת לפי העדיפות
    //   "מחיר לקג מעודכן" ידני  >  מחיר שטווח-התאריכים שלו מכיל את השבוע
    //   >  מחיר ברירת-המחדל-השנתית לאותה שנה.
    // תיקון לילה 3 (2026-10-07): כאן נבדק עד עכשיו **רק** Number(שנה)===year,
    // ולכן מחיר שמוגדר בטווח-תאריכים בלבד (שדות "מתאריך"/"עד תאריך",
    // בלי "שנה" — צירוף חוקי לגמרי בטבלה) דווח בשקר כ"חסר מחיר משוער",
    // גם כשהאוטומציה כן הייתה מוצאת ומקשרת אותו. דיווח-חוסר כזב גרוע
    // במיוחד כאן, כי כל תפקידו של המודול הזה הוא להסביר למה התחזית
    // ריקה — והוא היה שולח את תמר לתקן נתון שלא היה שבור.
    const cropPrices = prices.filter((pr) => allIds(pr['גידול']).includes(cropId) && !isBlank(pr['מחיר משוער לקג']));
    const byYear = year ? cropPrices.filter((pr) => Number(pr['שנה']) === year) : [];
    // חפיפה בין טווח-המחיר לטווח-הקטיף; צד פתוח (בלי "מתאריך"/"עד תאריך")
    // נחשב פתוח לאינסוף — בדיוק כמו "מחיר שתקף מאז/עד בלי הגבלה".
    const byRange = (harvestFrom && harvestTo)
      ? cropPrices.filter((pr) => {
        const from = String(pr['מתאריך'] || '').slice(0, 10) || null;
        const to = String(pr['עד תאריך'] || '').slice(0, 10) || null;
        if (!from && !to) return false; // לא מחיר-טווח בכלל
        return (!from || from <= harvestTo) && (!to || to >= harvestFrom);
      })
      : [];
    if (!byYear.length && !byRange.length) {
      missing.push(year
        ? `חסר מחיר משוער ל${cropName} לשנת ${year} (גם אין מחיר שטווח התאריכים שלו מכסה את תקופת הקטיף)`
        : `חסר מחיר משוער ל${cropName} — אין "שנת תוכנית" ואין מחיר שטווח התאריכים שלו מכסה את תקופת הקטיף`);
    }
  }

  return {
    ok: missing.length === 0,
    planId,
    planNumber: plan['מספר תוכנית'] ?? null,
    year,
    checkedCropNames,
    checkedQuarters: quarters,
    missing,
  };
}

export default { checkForecastPreflight };
