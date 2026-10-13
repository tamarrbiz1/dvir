// ============================================================
// בניית התחזית השבועית בשרת (משימה AL, 13.10.2026)
// ------------------------------------------------------------
// תמר **השביתה את אוטומציית "רענן תחזית" ב-Airtable**. מרגע זה שום
// שורת `תחזית שתילה שבועית` לא נבנית עד שהשרת יבנה אותה. המודול הזה
// הוא השחזור של אותה לוגיקה, אחד-לאחד.
//
// מקור האמת: `/root/missions/forecast-script-airtable.js` — העתק מדויק
// של הסקריפט שהושבת. כל מה שמחושב כאן זהה לו: שבוע תפעולי שבת–חמישי,
// רבעון לפי תחילת השבוע, מחיר לפי **היום הראשון הפעיל בשבוע** (חשוב
// בשבוע חלקי), סדר העדיפות של המחירים (טווח-תאריכים, המאוחר-להתחיל
// גובר → ברירת-מחדל שנתית לאותה שנה), ואותם שמונה שדות נכתבים.
//
// ------------------------------------------------------------
// שני ההבדלים מהסקריפט — ושניהם תיקוני-באג שתמר ביקשה
// ------------------------------------------------------------
// 1. **בונים לפני שמוחקים.** הסקריפט מחק את כל שורות התחזית של
//    התוכנית (`deleteInBatches`) ו*רק אחר כך* נכנס ללופ שזורק
//    `לא נמצאה תפוקה רבעונית לגידול ברבעון N`. כלומר כל כשל של
//    נתון-בסיס השאיר את התוכנית **ריקה לגמרי** — וזה בדיוק מה שתמר
//    ראתה. כאן כל השורות נבנות בזיכרון קודם, וכשחסר נתון מוחזר
//    `{ ok:false, missing:[...] }` **בלי לגעת בשום שורה קיימת**.
//
// 2. **עדכון במקום, לא מחיקה+יצירה.** התאמה לפי `תחילת שבוע`: שורה
//    שקיימת וזהה — לא נוגעים · שונה — `updateRecord` של השדות שהשתנו
//    בלבד · חסרה — נוצרת · עודפת — נמחקת. התוצאה: אין "ריצוד" בגיליון,
//    מזהי-השורות נשמרים (והקישורים אליהם), ו-**`קג בפועל` לא נדרס
//    לעולם** — הוא אינו באף אחת מרשימות השדות שנכתבות כאן.
//
//    חריג-בטיחות אחד שהוספתי מעבר למשימה: שורה "עודפת" (שבוע שיצא
//    מטווח הקטיף אחרי הזזה) **שיש בה `קג בפועל` — לא נמחקת**, אלא
//    מדווחת ב-`keptWithActual`. מחיקה כזו הייתה משמידה דיווח-קטיף
//    אמיתי שמנוע ה"בפועל" (AJ) כתב, וזה גרוע יותר מדריסה.
// ============================================================
import { fetchRecords, createRecord, updateRecord, deleteRecord } from './airtable.js';

export const PLANS_TABLE = 'תוכניות שתילה';
export const FORECAST_TABLE = 'תחזית שתילה שבועית';
export const YIELD_TABLE = 'תפוקה רבעונית';
export const PRICES_TABLE = 'מחירי גידול משוערים';
export const CROPS_TABLE = 'גידולים';

const TRIGGER_FIELD = 'רענן תחזית';
const PLAN_LINK = 'תוכנית שתילה';
const WEEK_START = 'תחילת שבוע';
const WEEK_END = 'סוף שבוע';
const WEEK_LABEL = 'שבוע';
const ACTIVE_DAYS = 'ימי קטיף פעילים';
const YIELD_LINK = 'תפוקה רבעונית';
const PRICE_LINK = 'מחירי גידול משוערים';
const PRICE_FIELD = 'מחיר לקג מעודכן';
const KG_ACTUAL = 'קג בפועל'; // נכתב ע"י actuals-sync.js — **לא נוגעים**

// ------------------------------------------------------------
// עזרי-תאריך — זהים לסקריפט (UTC בשעה 12:00, כדי שחיסור-ימים יהיה
// שלם גם כשיש מעבר-שעון; אין כאן שום תלות באזור-הזמן של השרת)
// ------------------------------------------------------------

export function parseDate(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split('-').map(Number);
  if (!year || !month || !day) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return Number.isNaN(d.getTime()) ? null : d;
}
export const formatDate = (date) => date.toISOString().slice(0, 10);
const addDays = (date, amount) => { const r = new Date(date); r.setUTCDate(r.getUTCDate() + amount); return r; };
export const quarterFromDate = (date) => Math.floor(date.getUTCMonth() / 3) + 1;

/** שבוע תפעולי: שבת עד חמישי (6 ימים). יום שישי שייך לשבוע שהסתיים. */
export function startOfOperationalWeek(date) {
  const result = new Date(date);
  const weekday = result.getUTCDay(); // 0=ראשון ... 5=שישי, 6=שבת
  const daysBack = weekday === 6 ? 0 : weekday + 1;
  result.setUTCDate(result.getUTCDate() - daysBack);
  return result;
}

export function countActiveDays(weekStart, weekEnd, harvestStart, harvestEnd) {
  const activeStart = weekStart > harvestStart ? weekStart : harvestStart;
  const activeEnd = weekEnd < harvestEnd ? weekEnd : harvestEnd;
  if (activeStart > activeEnd) return 0;
  return Math.floor((activeEnd - activeStart) / 86400000) + 1;
}

const linkedIds = (value) => {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => (v && typeof v === 'object' ? v.id : v)).filter(Boolean);
};
const firstLinkedId = (value) => linkedIds(value)[0] || null;

const isBlank = (v) => v === null || v === undefined || v === '';

// ------------------------------------------------------------
// חיפוש תפוקה ומחיר — אותה לוגיקה בדיוק כמו בסקריפט
// ------------------------------------------------------------

/** רשומת תפוקה רבעונית לגידול+רבעון. `רבעון` הוא singleSelect ("1".."4"). */
export function findYieldRecord(yields, cropId, quarter) {
  return yields.find((r) => {
    const quarterValue = r['רבעון'];
    if (!quarterValue) return false;
    if (!linkedIds(r['גידול']).includes(cropId)) return false;
    const quarterText = typeof quarterValue === 'object' ? quarterValue.name : quarterValue;
    return String(quarterText) === String(quarter);
  }) || null;
}

/**
 * מחיר לתאריך: קודם מחירים שטווח-התאריכים שלהם מכיל את התאריך
 * (ו**המאוחר-להתחיל גובר**), ואם אין — ברירת-המחדל השנתית של אותה שנה.
 * שים לב: רשומה יכולה להיות גם בטווח וגם "ברירת מחדל שנתית" (כך זה
 * בפועל אצל מלפפון 2026) — ואז הטווח הוא שקובע, בדיוק כמו בסקריפט.
 */
export function findPriceRecord(prices, cropId, date) {
  const year = date.getUTCFullYear();
  const cropPrices = prices.filter((r) => linkedIds(r['גידול']).includes(cropId));

  const datedPrices = cropPrices.filter((r) => {
    const from = parseDate(r['מתאריך']);
    const to = parseDate(r['עד תאריך']);
    if (!from) return false;
    if (date < from) return false;
    if (to && date > to) return false;
    return true;
  });
  if (datedPrices.length) {
    datedPrices.sort((a, b) => parseDate(b['מתאריך']).getTime() - parseDate(a['מתאריך']).getTime());
    return datedPrices[0];
  }
  return cropPrices.find((r) => Number(r['שנה']) === year && Boolean(r['ברירת מחדל שנתית'])) || null;
}

// ------------------------------------------------------------
// החישוב (טהור — בלי I/O, כדי שיהיה נבדק)
// ------------------------------------------------------------

/**
 * @returns {{ ok: boolean, missing: string[], rows: Array, quarters: number[] }}
 * `rows` הוא מה שצריך להיות בטבלה בסוף — לא מה שנכתב. `missing` מכיל
 * את **אותן הודעות** שהסקריפט זרק (בעברית), וכשהוא לא ריק לא נוגעים
 * בשום שורה קיימת (ר' הערת הכותרת, תיקון 1).
 */
export function computeForecastRows(plan, { yields = [], prices = [] } = {}) {
  const missing = [];
  const harvestStart = parseDate(plan['תחילת קטיף מעודכנת']);
  const harvestEnd = parseDate(plan['סוף קטיף מעודכן']);
  const cropId = firstLinkedId(plan['גידולים']);

  // אותן שלוש בדיקות-הפתיחה של הסקריפט, רק שהן נאספות ולא זורקות
  if (!harvestStart || !harvestEnd) missing.push('חסרים תאריכי קטיף מעודכנים.');
  else if (harvestEnd < harvestStart) missing.push('סוף הקטיף לפני תחילת הקטיף.');
  if (!cropId) missing.push('לא נבחר גידול בתוכנית.');
  if (missing.length) return { ok: false, missing, rows: [], quarters: [] };

  const rows = [];
  const quarters = new Set();
  let weekStart = startOfOperationalWeek(harvestStart);
  // גדר-שפיות: תקופת-קטיף שבורה (או תאריך משובש מ-Airtable) לא תייצר
  // לופ אינסופי. 520 שבועות = עשר שנים, יותר מכל תוכנית אפשרית.
  let guard = 0;
  while (weekStart <= harvestEnd && guard < 520) {
    guard += 1;
    const weekEnd = addDays(weekStart, 5);
    if (weekEnd >= harvestStart && weekStart <= harvestEnd) {
      const activeDays = countActiveDays(weekStart, weekEnd, harvestStart, harvestEnd);
      const quarter = quarterFromDate(weekStart);
      quarters.add(quarter);
      const yieldRecord = findYieldRecord(yields, cropId, quarter);
      if (!yieldRecord) {
        const message = `לא נמצאה תפוקה רבעונית לגידול ברבעון ${quarter}`;
        if (!missing.includes(message)) missing.push(message);
      }
      // המחיר נקבע לפי **היום הראשון שבו הקטיף פעיל באותו שבוע** —
      // בשבוע החלקי הראשון זה תחילת הקטיף ולא תחילת השבוע.
      const effectiveDate = weekStart < harvestStart ? harvestStart : weekStart;
      const priceRecord = findPriceRecord(prices, cropId, effectiveDate);
      if (!priceRecord) {
        missing.push(`לא נמצא מחיר משוער לתאריך ${formatDate(effectiveDate)}`);
      } else if (isBlank(priceRecord['מחיר משוער לקג'])) {
        missing.push(`ברשומת המחיר לתאריך ${formatDate(effectiveDate)} אין מחיר.`);
      }
      if (yieldRecord && priceRecord && !isBlank(priceRecord['מחיר משוער לקג'])) {
        rows.push({
          weekStart: formatDate(weekStart),
          fields: {
            [PLAN_LINK]: [plan.id],
            [WEEK_START]: formatDate(weekStart),
            [WEEK_END]: formatDate(weekEnd),
            [WEEK_LABEL]: `${formatDate(weekStart)} - ${formatDate(weekEnd)}`,
            [ACTIVE_DAYS]: activeDays,
            [YIELD_LINK]: [yieldRecord.id],
            [PRICE_LINK]: [priceRecord.id],
            [PRICE_FIELD]: priceRecord['מחיר משוער לקג'],
          },
        });
      }
    }
    weekStart = addDays(weekStart, 7);
  }

  if (missing.length) return { ok: false, missing, rows: [], quarters: [...quarters].sort() };
  return { ok: true, missing: [], rows, quarters: [...quarters].sort() };
}

/** השוואת שדה-בודד בין הרצוי לקיים — מחזיר true אם **צריך** לכתוב */
function fieldDiffers(name, wanted, existing) {
  if (name === YIELD_LINK || name === PRICE_LINK || name === PLAN_LINK) {
    const a = linkedIds(wanted).slice().sort();
    const b = linkedIds(existing).slice().sort();
    return a.length !== b.length || a.some((x, i) => x !== b[i]);
  }
  if (name === WEEK_START || name === WEEK_END) {
    return String(wanted).slice(0, 10) !== String(existing ?? '').slice(0, 10);
  }
  if (name === ACTIVE_DAYS || name === PRICE_FIELD) {
    const a = wanted === null || wanted === undefined ? null : Number(wanted);
    const b = isBlank(existing) ? null : Number(existing);
    if (a === null || b === null) return a !== b;
    // currency/number ב-Airtable חוזר כ-float; סובלנות של אגורה אחת
    return Math.abs(a - b) > 1e-6;
  }
  return String(wanted ?? '') !== String(existing ?? '');
}

/**
 * מתכנן את ההתאמה בין הרצוי לקיים (טהור). מחזיר
 * `{ creates, updates, deletes, unchanged, keptWithActual }`.
 */
export function planReconciliation(wantedRows, existingRows) {
  const byWeek = new Map();
  const duplicates = [];
  for (const r of existingRows) {
    const key = String(r[WEEK_START] ?? '').slice(0, 10);
    // שתי שורות לאותו שבוע (שרידי הסקריפט הישן, שיצר בלי לבדוק) —
    // הראשונה נשמרת, השנייה נחשבת עודפת ותימחק/תדווח. בלי זה כפילות
    // כזו הייתה שורדת כל בנייה עתידית, ונספרת פעמיים בגיליון.
    if (key && !byWeek.has(key)) byWeek.set(key, r);
    else duplicates.push(r);
  }

  const creates = [];
  const updates = [];
  const unchanged = [];
  const used = new Set();

  for (const row of wantedRows) {
    const existing = byWeek.get(row.weekStart);
    if (!existing) { creates.push(row); continue; }
    used.add(existing.id);
    const changed = {};
    for (const [name, value] of Object.entries(row.fields)) {
      if (fieldDiffers(name, value, existing[name])) changed[name] = value;
    }
    if (Object.keys(changed).length) updates.push({ id: existing.id, weekStart: row.weekStart, fields: changed });
    else unchanged.push({ id: existing.id, weekStart: row.weekStart });
  }

  const deletes = [];
  const keptWithActual = [];
  const leftovers = existingRows.filter((r) => !used.has(r.id) && !duplicates.includes(r)).concat(duplicates);
  for (const r of leftovers) {
    // ר' "חריג-הבטיחות" בכותרת: שבוע שיצא מהטווח אבל יש לו ק"ג בפועל
    // אמיתי — לא נמחק. מחיקה כאן הייתה משמידה דיווח-קטיף.
    if (!isBlank(r[KG_ACTUAL])) {
      keptWithActual.push({ id: r.id, weekStart: String(r[WEEK_START] ?? '').slice(0, 10), actualKg: r[KG_ACTUAL] });
    } else {
      deletes.push({ id: r.id, weekStart: String(r[WEEK_START] ?? '').slice(0, 10) });
    }
  }
  return { creates, updates, deletes, unchanged, keptWithActual };
}

// ------------------------------------------------------------
// קריאת המקורות (פעם אחת גם ל-batch של כמה תוכניות)
// ------------------------------------------------------------

export async function fetchForecastSources() {
  const [plans, forecasts, yields, prices, crops] = await Promise.all([
    fetchRecords(PLANS_TABLE, {}),
    fetchRecords(FORECAST_TABLE, {}),
    fetchRecords(YIELD_TABLE, {}),
    fetchRecords(PRICES_TABLE, {}),
    fetchRecords(CROPS_TABLE, {}),
  ]);
  return { plans, forecasts, yields, prices, crops };
}

// ------------------------------------------------------------
// הבנייה בפועל
// ------------------------------------------------------------

/**
 * בונה (או מחשב ב-dryRun) את התחזית לתוכנית אחת.
 *
 * @param {string} planId
 * @param {{ dryRun?: boolean, sources?: object, clearTrigger?: boolean }} opts
 *   `sources` — תוצאת `fetchForecastSources()`, כדי שבנייה של כמה
 *   תוכניות לא תקרא את אותן ארבע הטבלאות פעם אחר פעם.
 *   `clearTrigger` — לכבות `רענן תחזית` בסוף (ברירת מחדל: כן, כמו
 *   הסקריפט). מכובה גם בכשל, כדי שהסורק לא ינסה לנצח (ר' §3 במשימה).
 */
export async function buildForecastForPlan(planId, { dryRun = false, sources = null, clearTrigger = true } = {}) {
  const data = sources || await fetchForecastSources();
  const plan = data.plans.find((p) => p.id === planId);
  if (!plan) {
    return { ok: false, planId, planNumber: null, missing: ['התוכנית לא נמצאה'], notFound: true };
  }
  const planNumber = plan['מספר תוכנית'] ?? null;
  const cropId = firstLinkedId(plan['גידולים']);
  const cropName = data.crops?.find((c) => c.id === cropId)?.['שם גידול'] || null;

  const computed = computeForecastRows(plan, data);
  const base = {
    planId, planNumber, cropName, dryRun,
    quarters: computed.quarters,
    harvestFrom: String(plan['תחילת קטיף מעודכנת'] || '').slice(0, 10) || null,
    harvestTo: String(plan['סוף קטיף מעודכן'] || '').slice(0, 10) || null,
  };

  if (!computed.ok) {
    // ⚠️ היציאה הזו היא לב התיקון: אין כאן שום כתיבה, ושורות התחזית
    // הקיימות של התוכנית נשארות בדיוק כפי שהיו.
    if (!dryRun && clearTrigger && plan[TRIGGER_FIELD]) {
      await updateRecord(PLANS_TABLE, planId, { [TRIGGER_FIELD]: false }).catch((e) =>
        console.error(`[forecast-build] כיבוי "${TRIGGER_FIELD}" לתוכנית ${planNumber} נכשל: ${e.message}`));
    }
    console.log(`[forecast-build] תוכנית ${planNumber}: לא נבנתה — ${computed.missing.join(' | ')}`);
    return { ...base, ok: false, missing: computed.missing, created: 0, updated: 0, deleted: 0, unchanged: 0 };
  }

  const existing = data.forecasts.filter((f) => linkedIds(f[PLAN_LINK]).includes(planId));
  const recon = planReconciliation(computed.rows, existing);
  const result = {
    ...base,
    ok: true,
    missing: [],
    created: recon.creates.length,
    updated: recon.updates.length,
    deleted: recon.deletes.length,
    unchanged: recon.unchanged.length,
    keptWithActual: recon.keptWithActual,
    weeks: computed.rows.map((r) => ({
      weekStart: r.fields[WEEK_START], weekEnd: r.fields[WEEK_END],
      activeDays: r.fields[ACTIVE_DAYS], pricePerKg: r.fields[PRICE_FIELD],
      quarter: quarterFromDate(parseDate(r.fields[WEEK_START])),
    })),
  };
  if (dryRun) {
    result.plannedCreates = recon.creates.map((r) => r.weekStart);
    result.plannedUpdates = recon.updates.map((r) => ({ weekStart: r.weekStart, fields: Object.keys(r.fields) }));
    result.plannedDeletes = recon.deletes.map((r) => r.weekStart);
    return result;
  }

  result.errors = [];
  // סדר: יצירה → עדכון → מחיקה. "בנה לפני שתמחק" חל גם כאן: גם אם
  // Airtable ייפול באמצע, מה שנמחק הוא רק מה שכבר אין לו מקום.
  for (const row of recon.creates) {
    try { await createRecord(FORECAST_TABLE, row.fields); }
    catch (e) { result.errors.push({ kind: 'יצירה', weekStart: row.weekStart, error: e.message }); result.created -= 1; }
  }
  for (const row of recon.updates) {
    try { await updateRecord(FORECAST_TABLE, row.id, row.fields); }
    catch (e) { result.errors.push({ kind: 'עדכון', weekStart: row.weekStart, error: e.message }); result.updated -= 1; }
  }
  for (const row of recon.deletes) {
    try { await deleteRecord(FORECAST_TABLE, row.id); }
    catch (e) { result.errors.push({ kind: 'מחיקה', weekStart: row.weekStart, error: e.message }); result.deleted -= 1; }
  }
  if (clearTrigger) {
    try { await updateRecord(PLANS_TABLE, planId, { [TRIGGER_FIELD]: false }); }
    catch (e) { result.errors.push({ kind: 'כיבוי טריגר', error: e.message }); }
  }

  const bits = [`${result.created} חדשים`, `${result.updated} עודכנו`, `${result.deleted} נמחקו`, `${result.unchanged} ללא שינוי`];
  if (recon.keptWithActual.length) bits.push(`${recon.keptWithActual.length} נשמרו (יש בהם ק"ג בפועל)`);
  if (result.errors.length) bits.push(`${result.errors.length} שגיאות`);
  console.log(`[forecast-build] תוכנית ${planNumber}: ${bits.join(', ')}`);
  return result;
}

/** בנייה לכמה תוכניות עם קריאת-מקורות אחת. סדרתי — vCPU אחד. */
export async function buildForecastForPlans(planIds, { dryRun = false } = {}) {
  const sources = await fetchForecastSources();
  const results = [];
  for (const id of planIds) {
    results.push(await buildForecastForPlan(id, { dryRun, sources }));
  }
  return results;
}

export default { buildForecastForPlan, buildForecastForPlans, computeForecastRows, fetchForecastSources };
