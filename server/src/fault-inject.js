// ============================================================
// הזרקת-תקלות ל-QA בלבד (2026-10-07, לילה 3 — בדיקות עמידות)
// ------------------------------------------------------------
// למה זה קיים: אי-אפשר לבדוק "מה קורה כש-Airtable מחזיר 429/503 בדיוק
// באמצע מחיקה-מדורגת" בלי לגרום לכשל כזה בכוונה. השכבה הזו מאפשרת
// לבדיקה לבקש שקריאה מסוימת ל-Airtable תיכשל — בלי לגעת ברשת, בלי
// mock-ים, ובלי לשנות את קוד הזרימה עצמו.
//
// ⚠️ שתי בקרות-בטיחות **מצטברות**, כדי שהקובץ הזה יהיה בטוח לחלוטין
// לשחרור לייצור:
//   1. חייב להיות מוגדר משתנה-סביבה AIRTABLE_FAULT (ברירת מחדל: כבוי).
//   2. חייב ש-NODE_ENV **לא** יהיה 'production'. בשרת הייצור
//      (zite-server.service) NODE_ENV=production תמיד — ולכן הזרקת
//      התקלות שם **אינה אפשרית מבנית**, גם אם מישהו יגדיר את המשתנה
//      בטעות.
//
// תחביר: AIRTABLE_FAULT="op[:table][:count][:status]" (מופרד בפסיקים)
//   op     — fetch | create | update | delete | upload | meta | *
//   table  — שם טבלה מדויק, או * לכל טבלה (ברירת מחדל: *)
//   count  — כמה קריאות תואמות להכשיל (ברירת מחדל: 1; 0 = ללא הגבלה)
//   status — קוד HTTP מדומה (ברירת מחדל: 429)
// דוגמה: AIRTABLE_FAULT="update:מלאי בסיסי:1:429"
//
// הקריאה ל-process.env נעשית בכל פעם (לא פעם אחת בטעינת המודול), כדי
// שבדיקה תוכל לחמש/לנטרל כלל באמצע ריצה (`process.env.AIRTABLE_FAULT=...`)
// בלי לטעון מחדש את כל שרשרת המודולים.
// ============================================================

let cachedRaw = null;
let rules = [];

function isProd() {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function activeRules() {
  const raw = process.env.AIRTABLE_FAULT || '';
  if (!raw || isProd()) { cachedRaw = raw; rules = []; return rules; }
  if (raw === cachedRaw) return rules;
  cachedRaw = raw;
  rules = raw.split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
    const [op, table = '*', countStr = '1', statusStr = '429'] = part.split(':');
    const count = Number(countStr);
    return {
      op: op.trim(),
      table: table.trim(),
      remaining: Number.isFinite(count) ? count : 1,
      status: Number(statusStr) || 429,
    };
  });
  console.warn(`[fault-inject] ⚠️ הזרקת-תקלות פעילה (QA בלבד): ${JSON.stringify(rules)}`);
  return rules;
}

/**
 * נקראת בתחילת כל פעולת Airtable. אם קיים כלל תואם שטרם נגמר —
 * זורקת שגיאה שנראית כמו שגיאת 429/503 של Airtable (כולל `statusCode`,
 * שעליו sendApiError ב-server.js מסתמך).
 * בייצור (NODE_ENV=production) או בלי AIRTABLE_FAULT — no-op מוחלט.
 */
export function maybeFail(op, table = '*') {
  const rs = activeRules();
  if (!rs.length) return;
  for (const r of rs) {
    if (r.remaining === 0) continue;
    if (r.op !== '*' && r.op !== op) continue;
    if (r.table !== '*' && r.table !== table) continue;
    if (r.remaining > 0) r.remaining -= 1;
    const e = new Error(`[fault-inject] תקלה מוזרקת ל-QA: ${op} ${table} -> ${r.status}`);
    e.statusCode = r.status;
    e.faultInjected = true;
    throw e;
  }
}

/** האם ההזרקה אפשרית בסביבה הזו בכלל (ל-qa-check: לדלג אם לא) */
export function faultInjectionPossible() {
  return !isProd();
}
