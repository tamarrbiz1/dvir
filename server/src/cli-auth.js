// ============================================================
// חידוש אימות הניתוח מתוך האפליקציה (משימה AA, 8.10.2026)
// ------------------------------------------------------------
// הבעיה: הטוקן שמאמת את ה-CLI (ניתוח מסמכי הוצאה) תקף לשנה. כשהוא
// יפוג, הלקוחה — שאינה טכנולוגית — תראה "הניתוח לא זמין". הדרישה:
// חידוש **מתוך האפליקציה**, כשכל מה שהלקוחה עושה הוא לאשר בדפדפן.
//
// המנגנון: `claude setup-token` הוא תהליך אינטראקטיבי בשני צעדים —
// מדפיס URL לאישור, ואז ממתין להדבקת קוד. שני דברים הכריחו את העיצוב:
//  1. ה-CLI **מסרב לרוץ בלי TTY**. node-pty אינו מותקן ואסור
//     npm install, ולכן משתמשים ב-`script -q -c` שמספק pseudo-TTY.
//     ⚠️ ל-`script -c` מועבר מחרוזת-פקודה שהוא מריץ דרך shell. לכן
//     המחרוזת מורכבת **רק מקבועים שבשליטתנו** (נתיב ה-CLI + דגל
//     קבוע) — אפס קלט-משתמש. הקוד שהלקוחה מדביקה נכתב ל-**stdin**,
//     ולעולם לא לשורת-הפקודה.
//  2. התהליך חייב לשרוד בין שתי בקשות HTTP (start → complete), ולכן
//     נשמר בזיכרון סשן יחיד. סשן אחד בכל רגע, תפוגה 10 דקות.
//
// סודות: הטוקן והקוד **לעולם** לא חוזרים בתשובה, לא נרשמים ללוג ולא
// נכתבים ל-progress/לוגי-לילה. ר' redactSecrets — כל מה שיוצא מכאן
// עובר בו, והתנהגותו נבדקת ביחידה.
//
// אחסון: /var/lib/zite-claude/token.json (600, בעלות zite) — השרת
// רץ כ-zite ו**אינו** יכול לכתוב ל-.env (root:root 644), ואינו יכול
// sudo או restart. לכן אין נגיעה ב-.env/systemd: הטוקן החדש נכנס
// לתוקף **בזיכרון התהליך** מיד, והקובץ הוא ההתמדה לאתחול הבא.
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';

const TOKEN_DIR = process.env.CLAUDE_CLI_HOME || '/var/lib/zite-claude';
const TOKEN_FILE = path.join(TOKEN_DIR, 'token.json');
const CLI_PATH = () => process.env.CLAUDE_CLI_PATH || '/opt/zite-tools/claude';
const SESSION_TTL_MS = 10 * 60 * 1000;
// ניתנים לכיוונון דרך הסביבה: בייצור נדיב (רשת/עומס), ובבדיקות קצר
// כדי שבדיקת-ה-timeout לא תאריך את כל הסוויטה ב-60 שניות.
const URL_WAIT_MS = Number(process.env.CLI_AUTH_URL_WAIT_MS) || 60_000;
const TOKEN_WAIT_MS = Number(process.env.CLI_AUTH_TOKEN_WAIT_MS) || 90_000;
const TOKEN_VALID_DAYS = 365;

// תבנית הקוד שהלקוחה מדביקה מהדפדפן. ולידציה הדוקה לפני שנוגעים
// ב-stdin של התהליך — קלט לא-תקין נדחה ב-400 ולא נכתב לשום מקום.
const CODE_RE = /^[A-Za-z0-9_#.~-]{20,400}$/;
const OAUTH_URL_RE = /(https:\/\/claude\.com\/[^\s"']*oauth[^\s"']*)/i;
const TOKEN_RE = /(sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,})/;

/** מסתיר כל סוד אפשרי מכל מחרוזת שיוצאת מהמודול (לוג/תשובה/שגיאה) */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***')
    .replace(/\b[A-Za-z0-9_#-]{20,200}#[A-Za-z0-9_-]{6,}/g, '***')
    .replace(/(code=)[^&\s"']+/gi, '$1***');
}

function log(msg) {
  console.log(`[cli-auth] ${redactSecrets(msg)}`);
}

// ------------------------------------------------------------
// סשן יחיד בזיכרון
// ------------------------------------------------------------
let session = null; // { id, child, dir, buffer, url, startedAt, expiresAt, done }

function clearSession(reason) {
  if (!session) return;
  const { child, dir, id } = session;
  try { child?.kill('SIGKILL'); } catch { /* התהליך כבר מת */ }
  rm(dir, { recursive: true, force: true }).catch(() => {});
  session = null;
  log(`סשן ${id} נסגר (${reason})`);
}

function sessionExpired() {
  return !!session && Date.now() > session.expiresAt;
}

/** נקרא גם מהחוץ (status/start) כדי שסשן שפג לא ייתקע לנצח */
function reapIfExpired() {
  if (sessionExpired()) clearSession('תפוגה');
}

// ------------------------------------------------------------
// אחסון הטוקן
// ------------------------------------------------------------
export async function readStoredToken() {
  try {
    const raw = await readFile(TOKEN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.token || typeof parsed.token !== 'string') return null;
    return parsed;
  } catch {
    // קובץ חסר / פגום / לא-JSON / לא-קריא → מתעלמים בשקט ונופלים
    // ל-.env. זה המצב התקין בפעם הראשונה, ולכן לא שגיאה.
    return null;
  }
}

async function storeToken(token) {
  const now = Date.now();
  const payload = {
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOKEN_VALID_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
  await writeFile(TOKEN_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await chmod(TOKEN_FILE, 0o600).catch(() => {});
  return payload;
}

/**
 * בעלייה: אם יש טוקן שמור ותקף — הוא **גובר** על .env (זה הטוקן
 * שהלקוחה חידשה מהאפליקציה). אם אין — נשארים עם .env, כלומר המצב
 * שעבד עד היום. לא זורק לעולם: כשל כאן לא יפיל את השרת.
 */
export async function loadTokenIntoEnv() {
  const stored = await readStoredToken();
  if (!stored) return { source: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'env' : 'none' };
  if (stored.expiresAt && Date.parse(stored.expiresAt) < Date.now()) {
    log('הטוקן השמור פג — ממשיכים עם זה שבסביבה (אם קיים)');
    return { source: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'env' : 'none', expired: true };
  }
  process.env.CLAUDE_CODE_OAUTH_TOKEN = stored.token;
  log(`נטען טוקן שמור, תקף עד ${stored.expiresAt}`);
  return { source: 'file', expiresAt: stored.expiresAt };
}

export async function authStatus() {
  reapIfExpired();
  const stored = await readStoredToken();
  const hasEnv = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (stored?.expiresAt) {
    const ms = Date.parse(stored.expiresAt) - Date.now();
    return {
      configured: ms > 0 || hasEnv,
      source: ms > 0 ? 'file' : (hasEnv ? 'env' : 'none'),
      expiresAt: stored.expiresAt,
      daysLeft: Math.floor(ms / 86_400_000),
      sessionOpen: !!session,
    };
  }
  // אין קובץ: הטוקן מגיע מהסביבה. אין לנו תאריך-תפוגה אמיתי עבורו,
  // ולכן daysLeft=null — הבאנר לא יתריע סתם, אבל כן יתריע כשהניתוח
  // ייכשל ב-AUTH_EXPIRED (ר' הלקוח).
  return { configured: hasEnv, source: hasEnv ? 'env' : 'none', expiresAt: null, daysLeft: null, sessionOpen: !!session };
}

// ------------------------------------------------------------
// start — מריץ setup-token תחת pseudo-TTY ומחלץ את ה-URL
// ------------------------------------------------------------
export async function startAuth() {
  reapIfExpired();
  if (session) {
    const err = new Error('תהליך חידוש אימות כבר פתוח — יש להשלים אותו או להמתין לתפוגתו');
    err.statusCode = 409;
    throw err;
  }

  const dir = await mkdtemp(path.join('/var/tmp', 'zite-cliauth-'));
  // ⚠️ מחרוזת-הפקודה ל-`script -c` מורכבת **רק מקבועים** (ר' הערת
  // הכותרת). אין בה שום קלט-משתמש, ולכן אין משטח-הזרקה.
  const inner = `${CLI_PATH()} setup-token`;
  const child = spawn('script', ['-q', '-c', inner, '/dev/null'], {
    cwd: dir,
    env: {
      HOME: TOKEN_DIR,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: process.env.LANG || 'C.UTF-8',
      TERM: 'xterm-256color',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const id = `s${Date.now().toString(36)}`;
  const now = Date.now();
  session = { id, child, dir, buffer: '', url: null, startedAt: now, expiresAt: now + SESSION_TTL_MS, done: false };
  const mine = session;

  const onData = (d) => { if (mine.buffer.length < 1_000_000) mine.buffer += d.toString('utf8'); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => { mine.closed = true; mine.exitCode = code; });
  child.on('error', (e) => { mine.spawnError = e; });

  // ממתינים שה-URL יופיע בפלט
  const deadline = Date.now() + URL_WAIT_MS;
  while (Date.now() < deadline) {
    if (mine !== session) throw Object.assign(new Error('הסשן בוטל'), { statusCode: 410 });
    if (mine.spawnError) {
      clearSession('כשל הפעלה');
      throw Object.assign(new Error('לא ניתן להפעיל את תהליך האימות בשרת'), { statusCode: 500 });
    }
    const m = mine.buffer.match(OAUTH_URL_RE);
    if (m) {
      mine.url = m[1];
      log(`סשן ${id}: התקבל קישור אישור`);
      return { sessionId: id, url: mine.url, expiresAt: new Date(mine.expiresAt).toISOString() };
    }
    if (mine.closed) {
      clearSession(`התהליך נסגר (exit ${mine.exitCode})`);
      throw Object.assign(new Error('תהליך האימות נסגר לפני שהתקבל קישור'), { statusCode: 502 });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  clearSession('לא התקבל קישור בזמן');
  throw Object.assign(new Error('תהליך האימות לא הגיב בזמן — נסו שוב'), { statusCode: 504 });
}

// ------------------------------------------------------------
// complete — מדביק את הקוד ל-stdin וקורא את הטוקן
// ------------------------------------------------------------
export async function completeAuth(code) {
  reapIfExpired();
  if (!session) {
    throw Object.assign(new Error('אין תהליך חידוש פתוח — התחילו מחדש'), { statusCode: 410 });
  }
  if (!session.url) {
    throw Object.assign(new Error('תהליך האימות עדיין לא מוכן — נסו עוד רגע'), { statusCode: 409 });
  }
  // ניקוי הדבקה גסה מהטרמינל/דפדפן: תווי-בקרה של צבע ואחריהם כתובת
  // או רווח — נשאר רק הקוד עצמו. אם אחרי הניקוי אין קוד תקין, נדחה.
  const cleaned = typeof code === 'string'
    ? (code.replace(/\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]*m/g, '').trim().split(/[\s"'<>]|https?:\/\//)[0] || '')
    : '';
  if (!CODE_RE.test(cleaned)) {
    // אבחון בלי לחשוף את הקוד: אורך, ואילו תווים *מחוץ* לתבנית הופיעו
    const bad = [...new Set((cleaned.match(/[^A-Za-z0-9_#.~-]/g) || []).map((c) => 'U+' + c.codePointAt(0).toString(16).padStart(4, '0')))];
    log(`complete: קוד נדחה — אורך-גולמי ${typeof code === 'string' ? code.length : 'לא-מחרוזת'}, אורך-אחרי-ניקוי ${cleaned.length}, תווים-חורגים: ${bad.join(' ') || 'אין'}`);
    // הקוד עצמו לא נרשם ולא מוחזר — רק העובדה שנדחה
    throw Object.assign(new Error('הקוד שהוזן אינו בפורמט הנכון — העתיקו אותו שוב מהדפדפן'), { statusCode: 400 });
  }

  const mine = session;
  const before = mine.buffer.length;
  mine.child.stdin.write(`${cleaned}\n`);

  const deadline = Date.now() + TOKEN_WAIT_MS;
  while (Date.now() < deadline) {
    if (mine !== session) throw Object.assign(new Error('הסשן בוטל'), { statusCode: 410 });
    const fresh = mine.buffer.slice(before);
    const m = fresh.match(TOKEN_RE) || mine.buffer.match(TOKEN_RE);
    if (m) {
      const payload = await storeToken(m[1]);
      process.env.CLAUDE_CODE_OAUTH_TOKEN = m[1]; // נכנס לתוקף מיד, בלי restart
      clearSession('הושלם בהצלחה');
      log(`האימות חודש; תוקף עד ${payload.expiresAt}`);
      return { ok: true, expiresAt: payload.expiresAt };
    }
    if (/invalid|expired|failed|error/i.test(mine.buffer.slice(before))) {
      clearSession('הקוד נדחה');
      throw Object.assign(new Error('הקוד לא אושר — חזרו על התהליך מההתחלה'), { statusCode: 400 });
    }
    if (mine.closed) {
      clearSession(`התהליך נסגר (exit ${mine.exitCode})`);
      throw Object.assign(new Error('תהליך האימות נסגר בלי להשלים — נסו שוב'), { statusCode: 502 });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  clearSession('לא התקבל אישור בזמן');
  throw Object.assign(new Error('האישור לא הושלם בזמן — נסו שוב'), { statusCode: 504 });
}

/** לבדיקות בלבד — מאפס מצב בין בדיקות, בלי לגעת בטוקן השמור */
export function __resetSessionForTests() {
  clearSession('איפוס לבדיקה');
}

export const __internals = { CODE_RE, OAUTH_URL_RE, TOKEN_RE, TOKEN_FILE };
