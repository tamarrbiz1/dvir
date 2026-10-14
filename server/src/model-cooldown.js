// ============================================================
// חסימת-מודל זמנית אחרי שנגמרה לו המכסה (משימה AO, 14.10.2026)
// ------------------------------------------------------------
// תמר: "לפאבל נגמרו הקרדיטים. אני רוצה שאם נגמר — עובר אוטומטית
// לאופוס, וכשפאבל מתאפס — חוזר לפאבל."
//
// עד AO ה-CLI רץ על `claude-fable-5-1` **קבוע ובלי גיבוי**: ברגע
// שהמכסה נגמרה, כל ניתוח נכשל ב-QUOTA_EXCEEDED, ו-analysis-retry.js
// ניסה שוב — באותו מודל — עד שהמכסה תתחדש. כלומר הניתוח פשוט עמד.
//
// מה שהמודול הזה מחזיק: לכל מודל, עד מתי הוא חסום. זה **לא** מצב
// מרכזי — זו רק זיכרון-מקומי שחוסך ניסיונות מבוזבזים:
//   • חסימה נוצרת רק מכשל **מכסה/rate-limit** (QUOTA_EXCEEDED).
//     כשל פרסינג/קובץ/timeout לא חוסם כלום.
//   • כל עוד החסימה בתוקף, המודל מדולג והניתוח הולך ישר לגיבוי.
//   • כשהחסימה פגה, המודל נכנס שוב לתור הניסיונות **לפני** הגיבוי;
//     הצליח → החסימה נמחקת לגמרי ("Fable חזר").
//   • המצב נשמר ב-server/data/model-cooldown.json כדי שישרוד restart
//     (אחרת כל deploy היה מתחיל לבזבז ניסיון על מודל שבוודאות חסום).
//
// למה קובץ ולא Airtable: אין הרשאת-סכמה ליצור שדות (ר' ההערה
// ב-inventory-deduction.js), וזה מצב תפעולי של התהליך — לא נתון של
// הלקוחה. אותה תבנית כמו spray-import-state.json שהייתה כאן קודם.
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
/**
 * נקרא בזמן-קריאה ולא בזמן-טעינת-המודול, בדיוק כמו `cliPath()`
 * ב-document-analysis.js — כדי שבדיקות יוכלו להצביע על קובץ-מצב זמני
 * בלי לגעת במצב האמיתי של השרת.
 */
export function cooldownPath() {
  return process.env.MODEL_COOLDOWN_PATH || path.join(DATA_DIR, 'model-cooldown.json');
}

/** ברירת מחדל כשאי-אפשר לחלץ זמן איפוס מהודעת השגיאה */
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
/** תקרה לזמן-איפוס שחולץ מטקסט — הגנה מפני פרסור שגוי שיחסום ליומיים */
export const MAX_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const TIMEZONE = 'Asia/Jerusalem';

// ------------------------------------------------------------
// חילוץ זמן האיפוס מהודעת השגיאה
// ------------------------------------------------------------
// ⚠️ ההודעה שנמדדה בפועל ב-14.10.2026 על החשבון הזה היא
//   "You've reached your Fable limit. Switch to another model to continue."
// (429, api_error: model_requires_usage_credits) — ובה **אין** שום זמן
// איפוס. לכן ברירת-המחדל (30 דקות) היא המסלול הרגיל, והפורמטים כאן
// הם למקרים שה-CLI כן נוקב בזמן (הם קיימים בהודעות אחרות שלו).
/**
 * @returns {number|null} חותמת-זמן (ms) של האיפוס, או null אם לא נמצא
 */
export function parseQuotaResetAt(text, now = Date.now()) {
  const s = String(text ?? '');
  if (!s) return null;
  const cap = (at) => {
    if (!Number.isFinite(at)) return null;
    // תמיד לפחות דקה קדימה (אחרת "חסימה" שפגה מיד), ולא יותר מהתקרה
    if (at <= now) return null;
    return Math.min(at, now + MAX_COOLDOWN_MS);
  };

  // 1. "Claude AI usage limit reached|1760000000" — epoch שניות/מילישניות
  const piped = /\|\s*(\d{10,13})\b/.exec(s);
  if (piped) {
    const n = Number(piped[1]);
    const at = piped[1].length >= 13 ? n : n * 1000;
    const capped = cap(at);
    if (capped) return capped;
  }

  // 2. "try again in 25 minutes" / "resets in 2 hours" / "retry in 90 seconds"
  const relative = /\b(?:again|resets?|retry|wait)\s+(?:in\s+)?(\d{1,4})\s*(second|sec|minute|min|hour|hr)s?\b/i.exec(s);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = unit.startsWith('sec') ? n * 1000 : unit.startsWith('min') ? n * 60_000 : n * 3_600_000;
    const capped = cap(now + ms);
    if (capped) return capped;
  }

  // 3. "resets at 3pm" / "will reset at 15:00" / "resets at 3:30am"
  const absolute = /\breset(?:s|ting)?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(s);
  if (absolute) {
    let hour = Number(absolute[1]);
    const minute = Number(absolute[2] || 0);
    const ampm = (absolute[3] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const capped = cap(nextLocalTime(hour, minute, now));
      if (capped) return capped;
    }
  }

  return null;
}

/** המופע הבא של השעה הזו בשעון ישראל, כחותמת-זמן ms */
function nextLocalTime(hour, minute, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  // 'hour' יכול לחזור כ-24 בחצות בפורמטים מסוימים
  const curMinutes = (get('hour') % 24) * 60 + get('minute');
  let delta = (hour * 60 + minute) - curMinutes;
  if (delta <= 0) delta += 24 * 60;
  return now + delta * 60_000;
}

/** שעה בשעון ישראל לתצוגה בלוג ("14:37") */
export function israelTime(ms) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
}

// ------------------------------------------------------------
// המצב עצמו: זיכרון + קובץ
// ------------------------------------------------------------
/** @type {{ models: Record<string, { blockedUntil: number, reason?: string, at?: string }> }|null} */
let cache = null;
let cacheKey = null; // הנתיב שממנו המטמון נטען — שינוי נתיב = טעינה מחדש

export function loadCooldowns() {
  const file = cooldownPath();
  if (cache && cacheKey === file) return cache;
  cacheKey = file;
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.models && typeof parsed.models === 'object') {
        cache = { models: parsed.models };
        return cache;
      }
    } catch { /* קובץ פגום — מתחילים מאפס, לא מפילים את השרת */ }
  }
  cache = { models: {} };
  return cache;
}

function persist() {
  const file = cooldownPath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    // חסימה בזיכרון עדיין תקפה — רק לא תשרוד restart
    console.warn(`[model-cooldown] לא ניתן לשמור את ${file}: ${e.message}`);
  }
}

/** לבדיקות בלבד: שוכח את המטמון כדי שהקובץ ייקרא מחדש (כמו restart) */
export function resetCooldownCache() { cache = null; cacheKey = null; }

/** האם המודל חסום **כרגע** */
export function isModelBlocked(model, now = Date.now()) {
  const entry = loadCooldowns().models[model];
  return !!entry && Number(entry.blockedUntil) > now;
}

/** מתי המודל חסום עד (ms), או null אם אינו חסום כרגע */
export function blockedUntil(model, now = Date.now()) {
  const entry = loadCooldowns().models[model];
  return entry && Number(entry.blockedUntil) > now ? Number(entry.blockedUntil) : null;
}

/**
 * חוסם מודל אחרי כשל-מכסה. `resetText` הוא הטקסט שה-CLI החזיר —
 * ממנו מנסים לחלץ זמן איפוס אמיתי; בלעדיו 30 דקות.
 * @returns {number} עד מתי נחסם (ms)
 */
export function blockModel(model, { reason = '', now = Date.now() } = {}) {
  const until = parseQuotaResetAt(reason, now) ?? (now + DEFAULT_COOLDOWN_MS);
  loadCooldowns().models[model] = {
    blockedUntil: until,
    reason: String(reason || '').slice(0, 200),
    at: new Date(now).toISOString(),
  };
  persist();
  return until;
}

/**
 * מסיר חסימה. מחזיר true אם באמת הייתה חסימה (כדי שהקורא ידע לרשום
 * "המודל חזר" פעם אחת ולא בכל ניתוח).
 */
export function clearModelBlock(model) {
  const state = loadCooldowns();
  if (!(model in state.models)) return false;
  delete state.models[model];
  persist();
  return true;
}

/**
 * סדר הניסיונות: כל המודלים שאינם חסומים כרגע, בסדר העדיפות שהתקבל.
 * מערך ריק = כל המודלים חסומים → הקורא זורק שגיאת-מכסה בלי לבזבז
 * קריאה (ו-analysis-retry.js ינסה שוב מאוחר יותר).
 */
export function modelsToTry(models, now = Date.now()) {
  return models.filter((m) => !isModelBlocked(m, now));
}
