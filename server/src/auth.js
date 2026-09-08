// ============================================================
// אימות והרשאות בצד השרת — 2026-09-08
// ------------------------------------------------------------
// עד כה כל בקרת ההרשאות (מנהל-עבודה צפייה-בלבד וכו') הייתה קישוט
// בממשק בלבד: כל קריאת API ישירה (בלי שום כותרת) עברה, כולל קריאת
// טבלת "הרשאת מנהל" שחשפה את קודי הכניסה של הבעלים בטקסט גלוי.
// המודול הזה סוגר את הפער: טוקן חתום (HMAC, בלי תלות בחבילת npm
// חיצונית) שנוצר בהתחברות, ומאומת בכל קריאה ל-/api/:table. מיפוי
// ההרשאות כאן מעתיק במדויק את הכללים שכבר קיימים בצד הלקוח
// (canWrite/canSee/OPERATIONS ב-navigation.jsx).
// ============================================================
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_PATH = path.join(__dirname, '..', '.session-secret');

// מפתח חתימה: נוצר פעם אחת בהרצה הראשונה על השרת, נשמר לקובץ מקומי
// (לא ב-.env, לא ב-git — ר' .gitignore). אם הקובץ נמחק, כל הטוקנים
// הקיימים נפסלים והמשתמשים יתבקשו להתחבר מחדש — לא קורס, לא דולף.
function loadOrCreateSecret() {
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}
const SECRET = loadOrCreateSecret();

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (str) => Buffer.from(str, 'base64url');

const TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 יום — כניסה חוזרת נדירה, לא מטריד

// ============================================================
// טוקן חתום: base64url(payload).base64url(HMAC-SHA256)
// לא JWT תקני (בלי תלות בחבילה), אבל אותו עיקרון בדיוק.
// ============================================================
export function signToken(payload) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC };
  const payloadB64 = b64url(JSON.stringify(body));
  const sig = createHmac('sha256', SECRET).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.indexOf('.');
  const payloadB64 = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);
  if (!payloadB64 || !sigB64) return null;
  let providedSig, expectedSig;
  try {
    providedSig = fromB64url(sigB64);
    expectedSig = createHmac('sha256', SECRET).update(payloadB64).digest();
  } catch { return null; }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) return null;
  let body;
  try { body = JSON.parse(fromB64url(payloadB64).toString('utf8')); } catch { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

// ============================================================
// מיפוי הרשאות לפי טבלה — מעתיק את הכללים מ-navigation.jsx
// ============================================================
// חסום לגמרי מכל תפקיד דרך ה-API הכללי, כולל מנהל ראשי — הטבלה
// הזו נקראת אך ורק דרך /api/admin-login ו-/api/admin-role בצד
// השרת, לעולם לא דרך קריאת לקוח ישירה. זה מה שסוגר את דליפת
// קודי הכניסה.
export const LOGIN_CODES_TABLE = 'הרשאת מנהל';

// מנהל עבודה: קטגוריית "כוח אדם" בצפייה + שני חריגי כתיבה נקודתיים
// (אישור בקשות, עדכון מלאי) — בדיוק כמו OPERATIONS/canWrite בלקוח.
const MANAGER_READ = new Set(['עובדים', 'עבודות עובדים', 'בקשות עובדים', 'מלאי בסיסי', 'מבנים', 'תמחור עבודות']);
const MANAGER_WRITE = new Set(['בקשות עובדים', 'מלאי בסיסי']);

// עובד: רק הנתונים שלו (מאוכף בפועל — ר' ownFilterField למטה),
// ורשימות עזר לטופס הדיווח (מבנים/תמחור, קריאה בלבד).
const WORKER_READ = new Set(['עבודות עובדים', 'בקשות עובדים', 'מבנים', 'תמחור עבודות']);
const WORKER_WRITE = new Set(['עבודות עובדים', 'בקשות עובדים']);
const WORKER_OWN_TABLES = new Set(['עבודות עובדים', 'בקשות עובדים']);
const WORKER_OWN_FIELD = 'עובד';

export function canReadTable(role, table) {
  if (table === LOGIN_CODES_TABLE) return false;
  if (role === 'owner') return true;
  if (role === 'manager') return MANAGER_READ.has(table);
  if (role === 'worker') return WORKER_READ.has(table);
  return false;
}

export function canWriteTable(role, table) {
  if (table === LOGIN_CODES_TABLE) return false;
  if (role === 'owner') return true;
  if (role === 'manager') return MANAGER_WRITE.has(table);
  if (role === 'worker') return WORKER_WRITE.has(table);
  return false;
}

/** שדה השיוך שחייב להיות "שלהם" — null אם אין אכיפת-בעלות לתפקיד/טבלה הזו */
export function ownFilterField(role, table) {
  if (role === 'worker' && WORKER_OWN_TABLES.has(table)) return WORKER_OWN_FIELD;
  return null;
}

// ============================================================
// Middleware
// ============================================================
export function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const auth = verifyToken(token);
  if (!auth) return res.status(401).json({ error: 'נדרשת התחברות מחדש', authRequired: true });
  req.auth = auth;
  next();
}

export function authorizeRead(req, res, next) {
  if (!canReadTable(req.auth.role, req.params.table)) {
    return res.status(403).json({ error: 'אין הרשאה לצפות בטבלה זו' });
  }
  next();
}

export function authorizeWrite(req, res, next) {
  if (!canWriteTable(req.auth.role, req.params.table)) {
    return res.status(403).json({ error: 'אין הרשאת עדכון לטבלה זו' });
  }
  next();
}
