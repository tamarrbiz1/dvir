// ============================================================
// השלמה-עצמית של ניתוח שנעצר (משימה AD, 12.10.2026)
// ------------------------------------------------------------
// תמר: "גם אם השרת נעצר בתהליך ניתוח המלאי בגלל סיום הקרדיטים —
// שישלים את התהליך בסיומו."
//
// מה היה עד היום: כל כשל של הניתוח — מכסה גמורה, 429, השרת נפל
// באמצע — נשמר כ-`status:'failed'` בתגית `[מלאי-AI]` שבשדה "הערות"
// של ההוצאה, והדרך היחידה להמשיך הייתה שתמר תיזכר ללחוץ "נתח מחדש"
// על כל הוצאה בנפרד. כשל-מכסה הוא **זמני בהגדרה** — שעה אחר-כך זה
// היה עובד מעצמו — ולכן "נכשל" הוא סיווג שגוי שגורם לאיבוד עבודה.
//
// מה יש כאן:
//   • סיווג: `QUOTA_EXCEEDED` (זמני, בלי תקרת-ניסיונות) מול כשל
//     זמני-אחר (timeout/5xx — 3 ניסיונות) מול כשל קבוע (קובץ פגום,
//     פרסינג, AUTH_EXPIRED — אפס ניסיונות). ר' classifyAnalysisFailure
//     ב-document-analysis.js.
//   • מצב עמיד: `status:'waiting'` + `retry:{code,attempts,nextAt}`
//     **בתוך אותה תגית JSON** שכבר קיימת. אין צורך בשדה חדש
//     ב-Airtable ואין צורך בהרשאת-סכמה (שאין לנו) — ר' הערת הכותרת
//     ב-inventory-deduction.js.
//   • סריקה בעלייה: כל הוצאה ב-waiting/processing/partial נכנסת לתור,
//     וכך restart באמצע ניתוח אינו מאבד אותו.
//   • מתזמן בתוך התהליך: ניסיון **אחד בכל פעם** (vCPU אחד), backoff
//     10 דק' → 20 → 40 → 60, ומשם שעה קבועה.
//
// אידמפוטנטיות: הניסיון-החוזר קורא ל-analyzeExpenseInventory, שמחזיר
// מיד על `done`, וממשיך שורות-שלא-הושלמו (בלי קריאה ל-AI) על
// processing/partial. לכן הוצאה שכבר יצרה "ממתין לאישור" לא תייצר
// אותן שורות בשנית — גם אם הסריקה תרוץ עליה פעמיים.
// ============================================================
import { fetchRecords } from './airtable.js';
import { readState } from './inventory-deduction.js';

const EXPENSES_TABLE = 'הוצאות';

/** מדרגות ה-backoff בדקות; מהמדרגה האחרונה ואילך — שעה קבועה */
export const BACKOFF_MINUTES = [10, 20, 40, 60];
/** כשל זמני שאינו מכסה (timeout/5xx/רשת) — אחרי 3 ניסיונות נכנעים */
export const MAX_TEMPORARY_ATTEMPTS = 3;
/**
 * כשל-אימות הוא "קבוע" מבחינת המתזמן (צריך אדם), אבל **עליית-שרת**
 * היא בדיוק הרגע שבו הטוקן זה-עתה חודש (ר' RENEW-AUTH.md — הצעד
 * האחרון הוא restart). לכן הוצאה שנכשלה ב-AUTH_EXPIRED מקבלת ניסיון
 * אחד בכל עלייה, עד 3 עליות — כך שהניתוחים שנפלו בזמן שהטוקן היה
 * מבוטל משלימים את עצמם אחרי החידוש, בלי שתמר תיגע בכלום.
 * הוחלט לבד (12.10.2026): המשימה סיווגה AUTH_EXPIRED כ"קבוע", וזה
 * נשאר נכון למתזמן התקופתי — זה חל על עלייה בלבד ולכן חסום בתקרה.
 */
export const MAX_BOOT_RETRIES_ON_AUTH = 3;

/** מתי הניסיון הבא, לפי מספר הניסיונות שכבר נעשו */
export function nextRetryAt(attempts, now = Date.now()) {
  const i = Math.min(Math.max(Number(attempts) || 0, 0), BACKOFF_MINUTES.length - 1);
  return now + BACKOFF_MINUTES[i] * 60_000;
}

/**
 * ההחלטה היחידה של המתזמן, כפונקציה טהורה (ולכן נבדקת בלי Airtable
 * ובלי לצרוך מכסה). מחזירה:
 *   { action: 'retry' | 'wait' | 'give-up' | 'skip', reason, nextAt? }
 * - `onBoot` מבדיל בין סריקת-העלייה (שמריצה גם מה ש"ממתין לזמנו",
 *   כי restart עצמו הוא שינוי-מצב) לבין טיק תקופתי שמכבד את nextAt.
 */
export function retryDecision(state, { now = Date.now(), onBoot = false } = {}) {
  if (!state) return { action: 'skip', reason: 'אין מצב-ניתוח' };
  const status = state.status;
  const retry = state.retry || {};
  const attempts = Number(retry.attempts) || 0;

  // ריצה שנקטעה באמצע ההורדות — ההמשך אינו קורא ל-AI בכלל, ולכן
  // אין לו עלות-מכסה ואין סיבה להמתין.
  if (status === 'processing' || status === 'partial') {
    return { action: 'retry', reason: 'ריצה שנקטעה באמצע — המשך שורות שלא הושלמו' };
  }

  if (status === 'waiting') {
    if (retry.code !== 'QUOTA_EXCEEDED' && attempts >= MAX_TEMPORARY_ATTEMPTS) {
      return { action: 'give-up', reason: `${attempts} ניסיונות נכשלו (כשל זמני שאינו מכסה)` };
    }
    const due = Number(retry.nextAt) || 0;
    if (!onBoot && due > now) {
      return { action: 'wait', reason: 'טרם הגיע זמן הניסיון הבא', nextAt: due };
    }
    return { action: 'retry', reason: retry.code === 'QUOTA_EXCEEDED' ? 'מכסה — ניסיון חוזר' : `ניסיון ${attempts + 1}/${MAX_TEMPORARY_ATTEMPTS}` };
  }

  // כשל-אימות: ניסיון אחד לכל עלייה (ר' MAX_BOOT_RETRIES_ON_AUTH)
  if (status === 'failed' && state.errorCode === 'AUTH_EXPIRED') {
    if (!onBoot) return { action: 'skip', reason: 'כשל-אימות — מחכה לעליית-שרת (חידוש טוקן)' };
    const boots = Number(retry.bootRetries) || 0;
    if (boots >= MAX_BOOT_RETRIES_ON_AUTH) {
      return { action: 'skip', reason: `כשל-אימות — ${boots} ניסיונות-עלייה נוצלו` };
    }
    return { action: 'retry', reason: `כשל-אימות — ניסיון-עלייה ${boots + 1}/${MAX_BOOT_RETRIES_ON_AUTH}` };
  }

  return { action: 'skip', reason: `status=${status}` };
}

/**
 * האם ההוצאה הזו צריכה להיכנס לתור. מחזירה סיבה (מחרוזת) או null.
 * ⚠️ הגנה על רשומות-בדיקה: אין כאן סינון-QA בכוונה — הניסיון-החוזר
 * אינו יוצר רשומות ואינו נוגע במלאי מעבר למה שהניתוח המקורי כבר
 * החליט; והוא מדלג על `done`. (ר' logistics-sweep.js, שם דווקא **כן**
 * צריך סינון, כי הוא מנכה מלאי לפי מסמך ולא לפי state קיים.)
 */
export function resumeCandidateReason(expense, { now = Date.now(), onBoot = false } = {}) {
  const state = readState(expense?.['הערות']);
  const d = retryDecision(state, { now, onBoot });
  return d.action === 'retry' ? d.reason : null;
}

/**
 * סריקה אחת. `analyze` מוזרקת (ב-qa-check: פונקציה מדומה) כדי שהבדיקות
 * לא ייגעו ב-CLI, ב-Airtable או במכסה אמיתית.
 * מריצה **הוצאה אחת בכל קריאה** — vCPU אחד, והניתוח עצמו הוא תהליך-ילד
 * שצורך זיכרון; תור שלם במקביל היה מזמין OOM (ר' מגבלות-המשאבים
 * ב-CLAUDE.md). ההצלחה היא הסימן שהמכסה חזרה, והסריקה הבאה תיקח את
 * ההוצאה הבאה.
 */
export async function sweepStalledAnalyses({ lock, analyze, fetchExpenses, markGaveUp, now = () => Date.now(), onBoot = false, maxScan = 200 } = {}) {
  const t = now();
  const expenses = await (fetchExpenses
    ? fetchExpenses()
    : fetchRecords(EXPENSES_TABLE, { maxRecords: maxScan, sort: [{ field: 'מספר הוצאה', direction: 'desc' }] }));

  const report = { checked: expenses.length, candidates: 0, processed: 0, gaveUp: 0, waiting: 0, errors: [] };
  let picked = null;

  for (const e of expenses) {
    const state = readState(e['הערות']);
    const d = retryDecision(state, { now: t, onBoot });
    if (d.action === 'wait') report.waiting += 1;
    if (d.action === 'give-up') {
      report.gaveUp += 1;
      try { await markGaveUp?.(e.id, state, d.reason); } catch (err) { report.errors.push(`${e.id}: ${err.message}`); }
      continue;
    }
    if (d.action !== 'retry') continue;
    report.candidates += 1;
    if (!picked) picked = { id: e.id, num: e['מספר הוצאה'], reason: d.reason };
  }

  if (picked) {
    const run = () => analyze(picked.id);
    try {
      // אותה נעילה שמגנה על המלאי מכתיבות מקבילות (withInventoryLock
      // ב-server.js) — הניסיון-החוזר מוריד מלאי בפועל.
      await (lock ? lock(`expense:${picked.id}`, run) : run());
      report.processed = 1;
      console.log(`[analysis-retry] הוצאה #${picked.num ?? '?'} (${picked.id}) — ${picked.reason}`);
    } catch (err) {
      report.errors.push(`${picked.id}: ${err.message}`);
    }
  }
  return report;
}

/**
 * מתזמן בתוך התהליך. `firstDelayMs` נדיב בכוונה: בעלייה כבר רצות
 * סריקת-הריסוסים וסריקת-הלוגיסטיקה, ואין טעם להצטופף איתן על vCPU אחד.
 */
export function startAnalysisRetrySweep({ lock, analyze, markGaveUp, firstDelayMs = 120 * 1000, intervalMs = 5 * 60 * 1000 } = {}) {
  let first = true;
  const run = () => {
    const onBoot = first;
    first = false;
    return sweepStalledAnalyses({ lock, analyze, markGaveUp, onBoot })
      .then((r) => {
        if (r.candidates || r.gaveUp || r.errors.length) {
          console.log(`[analysis-retry] ${onBoot ? 'סריקת-עלייה' : 'סריקה'}: נבדקו ${r.checked}, מועמדים ${r.candidates}, הורצו ${r.processed}, ממתינים ${r.waiting}, ויתורים ${r.gaveUp}${r.errors.length ? `, שגיאות ${r.errors.length}` : ''}`);
        }
      })
      .catch((e) => console.error(`[analysis-retry] הסריקה עצמה נכשלה: ${e.message}`));
  };
  setTimeout(run, firstDelayMs);
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
