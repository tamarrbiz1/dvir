// ============================================================
// סנכרון-תחזית אוטומטי (תוספת 2026-10-07, סעיף T) — "גידולים ותחזיות":
// שינוי/מחיקה של "מחירי גידול משוערים" או "תפוקה רבעונית" אמור להשפיע
// מיד על תחזית השתילה של כל תוכנית ששייכת לאותו גידול.
// ------------------------------------------------------------
// **עודכן במשימה AL (13.10.2026).** עד AL המודול הזה *הפעיל מחדש את
// אוטומציית Airtable* — כתיבת `רענן תחזית` false→true על כל תוכנית
// רלוונטית. תמר השביתה את האוטומציה, ולכן מעתה הוא **קורא ל-build
// בשרת ישירות** (`forecast-build.js`). אין יותר נסיעה דרך צ'קבוקס.
//
// למה גם במחיקה: שדה-הקישור מ"תחזית שתילה שבועית" לרשומת המחיר/
// התפוקה הספציפית שנבחרה מתנתק אוטומטית ע"י Airtable כשהרשומה
// המקושרת נמחקת (ה-lookup נהיה ריק מיד) — וזה מה שגורם ל"אין נתון"
// להופיע. אבל אם קיימת רשומת-חלופה תקפה (למשל מחיר-טווח נמחק אך נשאר
// מחיר ברירת-מחדל שנתית לאותה שנה) — רק בנייה-מחדש "יודעת" לחפש
// חלופה ולקשר אליה. לכן גם במחיקה בונים מחדש.
//
// ------------------------------------------------------------
// איחוד הפעלות (AL, §2 במשימה)
// ------------------------------------------------------------
// עריכה של מחיר אחד ב-Airtable/באפליקציה יכולה לגעת בעשרות תוכניות,
// ושינוי של שלושה מחירים ברצף (מה שתמר עושה בפועל) הפעיל עד כה את
// אותה תוכנית שלוש פעמים — שלוש בניות מלאות, כל אחת עם ארבע
// קריאות-טבלה, על vCPU אחד. מעתה: **debounce של 3 שניות וקבוצה
// מאוחדת** — כל מזהי-התוכניות שהצטברו נבנים פעם אחת כל אחד, עם
// קריאת-מקורות אחת לכולם.
// ============================================================
import { fetchRecords } from './airtable.js';
import { buildForecastForPlans } from './forecast-build.js';
import { recordBuildResult } from './forecast-watcher.js';

const PLANS_TABLE = 'תוכניות שתילה';
const PLANS_CROP_FIELD = 'גידולים'; // שדה-קישור לגידול/ים בתוכנית שתילה (רבים)
const SOURCE_CROP_FIELD = 'גידול'; // שדה-קישור לגידול (יחיד) במחירים/תפוקה רבעונית

// שתי הטבלאות שמשפיעות על חישוב התחזית — אותן טבלאות שהתוספת הזו עוקבת
// אחריהן (ר' forecast-build.js: YIELD_TABLE / PRICES_TABLE).
export const FORECAST_SOURCE_TABLES = new Set(['מחירי גידול משוערים', 'תפוקה רבעונית']);

/** חלון האיחוד (ר' "איחוד הפעלות" בכותרת) */
export const DEBOUNCE_MS = 3000;

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

// --- מצב האיחוד: תור-תוכניות אחד + טיימר אחד, כל התהליך ---
const pendingPlanIds = new Set();
const pendingReasons = new Set();
let debounceTimer = null;
let flushing = false;
let onBuilt = null;

/** מי לקרוא אחרי בנייה מוצלחת (invalidateReads) — נקבע מ-server.js */
export function setForecastSyncHooks({ invalidate } = {}) {
  onBuilt = invalidate || null;
}

async function flush() {
  debounceTimer = null;
  if (flushing) {
    // בנייה כבר רצה; הטיימר יידלק מחדש ע"י הקורא הבא, ואם לא —
    // מתזמנים עוד חלון כדי שלא נאבד את מה שהצטבר בזמן הריצה.
    if (pendingPlanIds.size) debounceTimer = setTimeout(flush, DEBOUNCE_MS);
    return;
  }
  const planIds = [...pendingPlanIds];
  const reasons = [...pendingReasons];
  pendingPlanIds.clear();
  pendingReasons.clear();
  if (!planIds.length) return;

  flushing = true;
  try {
    const results = await buildForecastForPlans(planIds, { dryRun: false });
    results.forEach(recordBuildResult);
    const okCount = results.filter((r) => r.ok).length;
    console.log(`[forecast-sync] ${reasons.join(' + ')}: ${planIds.length} תוכניות נבנו מחדש (${okCount} הצליחו)`);
    if (okCount && onBuilt) onBuilt();
  } catch (e) {
    console.error(`[forecast-sync] בנייה מאוחדת נכשלה (${reasons.join(' + ')}): ${e.message}`);
  } finally {
    flushing = false;
    if (pendingPlanIds.size && !debounceTimer) debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  }
}

/** מוסיף תוכניות לתור-האיחוד ומאפס את חלון ה-debounce */
export function queueForecastBuild(planIds, reason) {
  let added = 0;
  for (const id of planIds) {
    if (!pendingPlanIds.has(id)) { pendingPlanIds.add(id); added += 1; }
  }
  if (reason) pendingReasons.add(reason);
  if (!added && debounceTimer) return; // כבר בתור, החלון פתוח
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  if (debounceTimer.unref) debounceTimer.unref();
}

/**
 * fire-and-forget: מוצא את כל תוכניות-השתילה המקושרות לגידול(ים)
 * שהשתנו ומכניס אותן לתור-הבנייה המאוחד. לא זורק — כל כשל מתועד
 * ללוג בלבד ולא חוזר לקורא (שכבר קיבל תשובה מוצלחת על הכתיבה
 * המקורית לפני שזה נקרא).
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
      console.log(`[forecast-sync] ${table}/${recordId} (${reason}): ${affected.length} תוכניות נכנסו לתור-בנייה (${planLabel})`);
      queueForecastBuild(affected.map((p) => p.id), `${table}/${reason}`);
    } catch (e) {
      console.error(`[forecast-sync] כשל כללי בסנכרון תחזית (${table}/${recordId}, ${reason}): ${e.message}`);
    }
  })();
}

export default {
  isForecastSourceTable, syncForecastForChangedRecord, queueForecastBuild,
  setForecastSyncHooks, FORECAST_SOURCE_TABLES, DEBOUNCE_MS,
};
