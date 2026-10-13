// ============================================================
// "מאזין" לסימון `רענן תחזית` (משימה AL, 13.10.2026)
// ------------------------------------------------------------
// אוטומציית "רענן תחזית" ב-Airtable הושבתה, אבל **שני הסקריפטים
// האחרים נשארו פעילים ולא נוגעים בהם**: `חשב תוכנית` (יצירה/עריכה)
// ו-`הזז תוכנית` מסמנים `רענן תחזית=true` על התוכניות הרלוונטיות בסוף
// הריצה שלהם. הסימון הזה הוא בדיוק האות שהשרת צריך.
//
// ל-Airtable אין webhooks אלינו, ולכן סורקים: כל 20 שניות שאילתה
// **קלה אחת** (`filterByFormula: {רענן תחזית}=1`, שדה אחד) ובנייה לכל
// תוכנית שנמצאה, אחת בכל פעם, סדרתי — vCPU אחד.
//
// ⚠️ הכיבוי בכשל הוא קריטי: `buildForecastForPlan` מכבה את הסימון
// **גם כשהבנייה נכשלה** על נתון-בסיס חסר. בלי זה הסורק היה מנסה את
// אותה תוכנית כל 20 שניות לנצח (ושורף קריאות-API). הסיבה נשמרת כאן
// בזיכרון ומוגשת ללקוח דרך `lastFailure()`, כך שהצ'יפ בכרטיס התוכנית
// יכול להגיד *למה* התחזית לא נבנתה.
// ============================================================
import { fetchRecords } from './airtable.js';
import { buildForecastForPlan, fetchForecastSources, PLANS_TABLE } from './forecast-build.js';

const TRIGGER_FIELD = 'רענן תחזית';

/** ברירת מחדל 20 שניות; `FORECAST_WATCH_MS` ב-env לכוונון (לא ב-.env) */
export const WATCH_MS = Math.max(5000, Number(process.env.FORECAST_WATCH_MS) || 20000);

/** planId -> { missing:[], at:ISO, planNumber } — כשלי-בנייה אחרונים */
const failures = new Map();
let running = false;
let onBuilt = null;

export function lastFailure(planId) {
  return failures.get(planId) || null;
}
export function allFailures() {
  return [...failures.entries()].map(([planId, v]) => ({ planId, ...v }));
}
export function clearFailure(planId) {
  failures.delete(planId);
}

/** מעדכן את זיכרון-הכשלים לפי תוצאת בנייה (מכל מקור, לא רק הסורק) */
export function recordBuildResult(result) {
  if (!result?.planId) return result;
  if (result.ok) failures.delete(result.planId);
  else failures.set(result.planId, { missing: result.missing || [], at: new Date().toISOString(), planNumber: result.planNumber ?? null });
  return result;
}

/**
 * טיק אחד של הסורק. מיוצא בנפרד כדי שהבדיקות יוכלו להריץ אותו
 * מפורשות, בלי לחכות 20 שניות.
 */
export async function sweepOnce() {
  if (running) return { skipped: 'ריצה כבר מתבצעת' };
  running = true;
  try {
    const flagged = await fetchRecords(PLANS_TABLE, {
      filterByFormula: `{${TRIGGER_FIELD}}=1`,
      fields: ['מספר תוכנית'],
    });
    if (!flagged.length) return { built: 0, failed: 0, plans: [] };

    // קריאת-מקורות אחת לכל התוכניות המסומנות בטיק הזה
    const sources = await fetchForecastSources();
    const out = { built: 0, failed: 0, plans: [] };
    for (const p of flagged) {
      const result = recordBuildResult(await buildForecastForPlan(p.id, { sources }));
      if (result.ok) out.built += 1; else out.failed += 1;
      out.plans.push({ planId: p.id, planNumber: result.planNumber, ok: result.ok, missing: result.missing });
    }
    console.log(`[forecast-watcher] ${flagged.length} תוכניות מסומנות: ${out.built} נבנו, ${out.failed} נכשלו (${out.plans.map((x) => x.planNumber).join(', ')})`);
    if (out.built && onBuilt) onBuilt();
    return out;
  } catch (e) {
    // 429/רשת/Airtable איטי — לוג וממשיכים בטיק הבא. לא מפילים את השרת.
    console.error(`[forecast-watcher] טיק נכשל: ${e.message}`);
    return { error: e.message };
  } finally {
    running = false;
  }
}

/** @param {{ invalidate?: () => void }} opts */
export function startForecastWatcher({ invalidate } = {}) {
  onBuilt = invalidate || null;
  console.log(`[forecast-watcher] סורק את "${TRIGGER_FIELD}" כל ${Math.round(WATCH_MS / 1000)} שניות`);
  const timer = setInterval(() => { sweepOnce(); }, WATCH_MS);
  if (timer.unref) timer.unref();
  // טיק ראשון מהיר — תוכנית שנשארה מסומנת מלפני restart לא מחכה 20 שניות
  const first = setTimeout(() => { sweepOnce(); }, 4000);
  if (first.unref) first.unref();
}

export default { startForecastWatcher, sweepOnce, lastFailure, allFailures, recordBuildResult, WATCH_MS };
