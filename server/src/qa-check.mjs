// ============================================================
// בדיקות איכות ובקרה — מריצים: node server/src/qa-check.mjs
// ------------------------------------------------------------
// בודק מול השרת החי: קריאת כל הטבלאות (עם מדידת זמן), כל זרימות
// הכתיבה שהמסכים מבצעים (יצירה/עדכון/מחיקה על רשומות זמניות),
// כניסת עובד, העלאת מסמך ויצירה קבוצתית — עם ניקוי מלא בסוף.
// כל שורה מדווחת PASS/FAIL + משך בביצוע. יציאה 1 אם משהו נכשל.
//
// בדיקות שנוגעות בטבלאות עם אוטומציית ניתוח מסמכים ב-Make (הוצאות/
// חשבוניות/תעודות משלוח/צ׳קים) רצות רק עם RUN_UPLOAD_TESTS=1 —
// כל יצירה כזו שורפת קרדיטים אמיתיים של הלקוחה ב-Make, גם כשהיא
// מנוקה מיד אחר-כך. הרצה רגילה מדלגת עליהן. ר' פירוט למטה.
// ============================================================
import { readFile } from 'node:fs/promises';
// גישה ישירה ל-Airtable (לא דרך ה-HTTP API) — נחוצה אך ורק כדי לקרוא
// אישורי-בדיקה אמיתיים לבדיקות ההתחברות (admin-login/worker-login).
// אין לזה שום קשר ל"עקיפת" האבטחה: זו בדיוק אותה שיטה שבה משתמש
// /api/admin-login עצמו בצד השרת. לעולם לא נכתב כאן ערך קבוע/גלוי —
// הקוד/הדרכון תמיד נקראים חי מהטבלה בזמן ריצה, לא מוטמעים בקובץ.
import { fetchRecords as directFetchRecords } from './airtable.js';
import { LOGIN_CODES_TABLE, canReadTable, canWriteTable } from './auth.js';
import { analyzeExpenseDocument } from './document-analysis.js';
import { matchLinesToInventory, categoryOfDescription, normalize } from './inventory-matching.js';
import { readState } from './inventory-deduction.js';
import { deriveDeductions, computeDeviation, findCounterpart, DEVIATION_THRESHOLD, planLogisticsReversal } from './logistics-deduction.js';
import { fixFilenameEncoding } from './filename-utils.js';
import { weekCodeFromDate, WEEK_CODE_RE } from './weekly-sync.js';
import { normalizeName, matchEntity, planLink, planCheckSupplier, computeSuggestions, summarizeSuggestions, AUTO_THRESHOLD } from './supplier-linking.js';
import { parseSummary, parseDateRange, parseDosage, markerOf, isTestRecord as isSprayTestRecord } from './spray-report-import.js';
import { cascadeDocumentDelete } from './document-cascade.js';
import { parseInventoryLedger, resolveExpenseLinks, documentLink } from '../../client/src/utils/inventoryLedger.js';
import { stripInventoryAiMarker, withPreservedInventoryTags } from '../../client/src/utils/inventoryAi.js';
import { yearFromWeekValue } from '../../client/src/utils/weekYear.js';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4000/api';
const MARK = 'QA-' + Date.now();
const enc = encodeURIComponent;
const results = [];
const cleanup = [];
// ראה "חלק C2 — forecast-sync" למטה: טווחי-תאריכים (from/to, YYYY-MM-DD)
// של שורות-תחזית-QA שעלולות להיווצר באיחור ע"י אוטומציית "רענן תחזית"
// (עיכוב-תשתית לא-קבוע ב-Airtable) אחרי שהניקוי הרגיל כבר מחק את
// התוכנית/הגידול שלהן. נסרקות ונוקות בנפרד ב"חלק 4.5" בסוף הקובץ.
const forecastSyncOrphanRanges = [];

const READ_WARN_MS = 2000;   // קריאה איטית מזה מסומנת באזהרה
const WRITE_WARN_MS = 3500;  // כתיבה איטית מזה מסומנת באזהרה

// 2026-09-08: מאז שנוסף אימות בצד השרת, כל קריאה (מלבד ההתחברות עצמה)
// דורשת טוקן. ברירת המחדל של api() מצרפת את טוקן הבדיקה הנוכחי
// (currentToken, נקבע אחרי התחברות למטה); test('...',...,{noAuth:true})
// או apiAs(token,...) מאפשרים לבדוק תרחישים אחרים במפורש.
let currentToken = null;
async function apiRaw(method, path, body, isForm, token) {
  const headers = {};
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers,
    body: isForm ? body : (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${r.status}: ${json?.error || text.slice(0, 140)}`);
  return json;
}
const api = (method, path, body, isForm = false) => apiRaw(method, path, body, isForm, currentToken);
const apiAs = (token, method, path, body, isForm = false) => apiRaw(method, path, body, isForm, token);
const get = (t, qs = '?maxRecords=3&raw=1') => api('GET', `${enc(t)}${qs}`);
const create = async (t, fields) => {
  const rec = await api('POST', enc(t), fields);
  if (rec?.id) cleanup.push({ table: t, id: rec.id });
  if (Array.isArray(rec)) rec.forEach((x) => x?.id && cleanup.push({ table: t, id: x.id }));
  return rec;
};
const patch = (t, id, fields) => api('PATCH', `${enc(t)}/${id}`, fields);
const del = (t, id) => api('DELETE', `${enc(t)}/${id}`);

// סעיף Q (7.10.2026): "קטגוריה אחת = פריט אחד" חוסם עכשיו יצירת פריט-
// מלאי-בדיקה בקטגוריה שכבר תפוסה ע"י פריט אמיתי — כל בדיקה שיוצרת פריט
// מלאי זמני (לא בודקת את Q עצמה) חייבת לבחור קטגוריה **פנויה בפועל**,
// לא סתם choices[0] (שעלול להיות קטגוריה אמיתית ותפוסה, למשל "קרטונים").
async function freeInventoryCategory() {
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  const items = await api('GET', `${enc('מלאי בסיסי')}?raw=1`);
  const usedCats = new Set(items.map((i) => String(i['קטגוריה'] || '').trim()).filter(Boolean));
  return opts.choices.find((c) => !usedCats.has(c)) || opts.choices[0];
}

// כניסה כמנהל ראשי אמיתי (הרשומה הראשונה מהסוג "מנהל ראשי") — כדי
// שכל שאר הבדיקות (שרצות תחת ההרשאה הרחבה ביותר, כמו לפני שהיה אימות
// כלל) יעבדו כרגיל. קוד הכניסה עצמו נקרא חי מ-Airtable ולעולם לא
// נכתב/נשמר בקובץ הזה.
const allAdmins = await directFetchRecords('הרשאת מנהל', {});
const qaOwner = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && !String(a['סוג'] || '').includes('עבודה'));
if (!qaOwner) { console.error('אין רשומת מנהל ראשי עם קוד — לא ניתן להריץ בדיקות'); process.exit(1); }
{
  const loginRes = await apiRaw('POST', 'admin-login', { email: qaOwner['מייל'], code: qaOwner['קוד אישי'] }, false, null);
  currentToken = loginRes.token;
  if (!currentToken) { console.error('ההתחברות לא החזירה טוקן — לא ניתן להריץ בדיקות'); process.exit(1); }
}

// תקרית 2026-09-02: בדיקה שיצרה רשומה חשופה (בלי קובץ) בטבלת "הוצאות" —
// אוטומציית Make שמאזינה לטבלה הזו (וגם לחשבוניות/תעודות משלוח/צ׳קים)
// נתקלה בה תוך כדי הריצה (הניקוי קורה רק בסוף הסקריפט, אחרי כל שאר
// הבדיקות) וקיבלה "Missing value of required parameter 'url'" — 3 שגיאות
// רצופות והתרחיש הושבת אוטומטית. מאז ואילך: כל רשומת בדיקה בטבלה
// שיש לה אוטומציית ניתוח מסמכים נוצרת עם קובץ אמיתי מצורף מהרגע הראשון,
// דרך אותו /api/upload-document שהמסך עצמו משתמש בו.
//
// תקרית 2026-09-03: התיקון הקודם צירף קובץ תקין (PNG של 1x1 פיקסל) אבל
// חסר תוכן לניתוח — שירות ה-AI ב-Make קרס עליו עם "500 RuntimeError:
// AI Agent Service", שוב 3 שגיאות רצופות והשבתה אוטומטית. הקובץ לא
// חייב להיות רק "קובץ תקין טכנית" — הוא חייב להיות מסמך אמיתי שה-AI
// כבר ידע לנתח בהצלחה בעבר. לכן: קובץ הבדיקה הוא צילום חשבונית אמיתית
// (server/fixtures/qa-real-invoice.pdf — חשבונית #21, כבר נותחה בהצלחה
// בעבר). לעולם אין להחליף אותו בתוכן סינתטי/ריק/מזויף.
//
// בנוסף: כל יצירה כזו — גם עם קובץ תקין ואמיתי — שורפת קרדיטים אמיתיים
// של הלקוחה ב-Make. לכן הבדיקות שמשתמשות ב-createWithFile רצות רק
// כשמפעילים במפורש: RUN_UPLOAD_TESTS=1 node src/qa-check.mjs
// בהרצה רגילה (ברירת המחדל) הן מדולגות.
const RUN_UPLOAD_TESTS = process.env.RUN_UPLOAD_TESTS === '1';
const REAL_FIXTURE_PATH = new URL('../fixtures/qa-real-invoice.pdf', import.meta.url);
const REAL_FIXTURE_NAME = 'qa-real-invoice.pdf';
// filename — עקיפה אופציונלית לשם-הקובץ שמועלה. נחוצה לטבלאות שאין בהן
// שום שדה-טקסט שיכול לשאת את ה-MARK (ר' "דוחות ריסוסים": 4 שדות, 2 מהם
// מחושבים) — שם-הקובץ נשמר בתוך אובייקט ה-attachment, ו-isTestRecord מריץ
// את התבנית על JSON.stringify של הרשומה כולה, ולכן MARK בשם-הקובץ מסמן
// את הרשומה כבדיקה לכל דבר. **המפריד חייב להיות מקף ולא קו-תחתי**:
// התבנית היא /\bQA-\d{10,}\b/ ו-"_" הוא תו-מילה ב-regex, כך ש-
// "QA-1234567890123_x.pdf" לא היה נתפס בכלל.
const createWithFile = async (table, field, extraFields = {}, filename = REAL_FIXTURE_NAME) => {
  const fileBuf = await readFile(REAL_FIXTURE_PATH);
  const fd = new FormData();
  fd.append('file', new Blob([fileBuf], { type: 'application/pdf' }), filename);
  fd.append('table', table);
  fd.append('field', field);
  const j = await api('POST', 'upload-document', fd, true);
  if (!j?.record?.id) throw new Error('לא נוצרה רשומה עם הקובץ');
  cleanup.push({ table, id: j.record.id });
  if (Object.keys(extraFields).length) await patch(table, j.record.id, extraFields);
  return j.record;
};

async function test(name, fn, warnMs = WRITE_WARN_MS) {
  const t0 = Date.now();
  try {
    const extra = await fn();
    const ms = Date.now() - t0;
    results.push([ms > warnMs ? 'SLOW' : 'PASS', name, ms, extra || '']);
  } catch (e) {
    results.push(['FAIL', name, Date.now() - t0, String(e.message || e).slice(0, 110)]);
  }
}

const today = new Date().toISOString().slice(0, 10);

// ============ 0. בדיקה טהורה: תאריך/שעה מקומי → ISO (UTC) ============
// לא נוגעת ברשת/שרת חי — בודקת רק את utils/format.js (localDateTimeToISO/
// isoToLocalTime), בהן WorkerReport.jsx ו-WorkersPage.jsx (WorkForm) בונים
// את "שעת התחלה"/"שעת סיום". תיקון באג (2026-10-06): לפני כן נבנתה
// המחרוזת ע"י הדבקה ישירה `${date}T${time}:00.000Z` — ה-"Z" סימן שעה
// **מקומית** (ישראל) כ-UTC בטעות, מה שגרם לסטייה של שעות בתצוגת המנהל.
await test('תאריך/שעה: בניית ISO מקומי (לא הדבקת מחרוזת עם Z)', async () => {
  const { localDateTimeToISO, isoToLocalTime } = await import('../../client/src/utils/format.js');
  const date = '2026-10-06', start = '08:30', end = '12:00';
  const isoStart = localDateTimeToISO(date, start);
  const isoEnd = localDateTimeToISO(date, end);
  if (!isoStart || !isoEnd) throw new Error('localDateTimeToISO החזיר null');

  // 1) round-trip: ISO → זמן מקומי מחזיר את מה שהוזן
  if (isoToLocalTime(isoStart) !== start) throw new Error(`round-trip נכשל: ${isoToLocalTime(isoStart)} != ${start}`);
  if (isoToLocalTime(isoEnd) !== end) throw new Error('round-trip נכשל (end)');

  // 2) התיקון בפועל משנה את התוצאה מול התבנית הבאגית הישנה — אלא אם
  //    אזור הזמן המקומי של התהליך הוא UTC עצמו (offset=0, אין הבדל)
  const buggy = `${date}T${start}:00.000Z`;
  const offsetMin = new Date(`${date}T${start}:00`).getTimezoneOffset();
  if (offsetMin !== 0 && isoStart === buggy) throw new Error('התיקון לא משנה את התוצאה — עדיין מתנהג כמו הבאג הישן');
  if (offsetMin === 0 && isoStart !== buggy) throw new Error('באופסט 0 התוצאה אמורה להיות זהה לתבנית הישנה');

  // 3) ה"הפרש" בין שתי שעות (הבסיס לחישוב "סכום שעות" ב-Airtable) לא
  //    נפגע מהתיקון — שתי השעות מוזזות באותו כיוון/גודל
  const diffNewMs = new Date(isoEnd) - new Date(isoStart);
  const diffOldMs = new Date(`${date}T${end}:00.000Z`) - new Date(buggy);
  if (diffNewMs !== diffOldMs) throw new Error(`ההפרש בין שעות השתנה: חדש=${diffNewMs} ישן=${diffOldMs}`);
  const expectedHours = 3.5; // 12:00 - 08:30
  if (Math.abs(diffNewMs / 3600000 - expectedHours) > 1e-9) throw new Error('הפרש השעות שגוי');

  return `offset=${offsetMin}min, ISO=${isoStart}`;
}, READ_WARN_MS);

// ============ 1. קריאת כל הטבלאות + זמני תגובה ============
const tables = await api('GET', 'tables');
for (const t of tables) {
  // הרשאת מנהל חסומה בכוונה מה-API הכללי לגמרי (ר' בדיקות אבטחה
  // למטה) — כאן רק מוודאים שהיא באמת חסומה, לא שהיא קריאה.
  if (t.name === LOGIN_CODES_TABLE) {
    await test(`קריאה: ${t.name} (חסום בכוונה)`, async () => {
      try {
        await api('GET', `${enc(t.name)}?maxRecords=50`);
        throw new Error('טבלת קודי הכניסה נקראה — אמורה להיות חסומה!');
      } catch (e) {
        if (String(e.message).startsWith('403')) return 'חסום כנדרש';
        throw e;
      }
    }, READ_WARN_MS);
    continue;
  }
  await test(`קריאה: ${t.name}`, async () => {
    const rows = await api('GET', `${enc(t.name)}?maxRecords=50`);
    return `${Array.isArray(rows) ? rows.length : 0} רשומות`;
  }, READ_WARN_MS);
}

// ============ 2. נתוני עזר ============
const structures = await get('מבנים');
const workers = await get('עובדים', '?maxRecords=5&raw=1');
const pricing = await get('תמחור עבודות', '?maxRecords=10&raw=1');
const materials = await get('חומרי ריסוס');
const suppliersList = await get('ספקים');
const sId = structures[0]?.id, wId = workers[0]?.id, mId = materials[0]?.id;
const priced = pricing.find((x) => x['מחיר'] != null);

// ============ 3. זרימות כתיבה ============
await test('עבודה חדשה (שעות dateTime + תמחור)', async () => {
  const rec = await create('עבודות עובדים', {
    'תאריך': today, 'עובד': [wId], 'מבנה': [sId], 'תמחור עבודות': [priced.id],
    'כמות': 2, 'שעת התחלה': `${today}T08:00:00.000Z`, 'שעת סיום': `${today}T12:00:00.000Z`, 'הערות': MARK,
  });
  return `id=${rec.id.slice(-5)}`;
});

await test('אוטומציית שכר (עדכון מחיר → סכום לתשלום)', async () => {
  const rec = cleanup.find((c) => c.table === 'עבודות עובדים');
  await patch('עבודות עובדים', rec.id, { 'עדכון מחיר': false });
  await patch('עבודות עובדים', rec.id, { 'עדכון מחיר': true });
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const back = await api('GET', `${enc('עבודות עובדים')}/${rec.id}`);
    if (back['סכום לתשלום'] != null) return `₪${back['סכום לתשלום']} (2×${priced['מחיר']})`;
  }
  throw new Error('הסכום לא חושב תוך 24 שניות');
}, 30000);

await test('טיפול/ריסוס: יצירה + בוצע + עריכה', async () => {
  const rec = await create('ריסוסים', { 'תאריך': today, 'מבנה': [sId], 'חומר ריסוס': [mId], 'מינון ': 100, 'הערות': MARK });
  await patch('ריסוסים', rec.id, { 'בוצע': true });
  await patch('ריסוסים', rec.id, { 'מינון ': 150 });
});

await test('קטיף: יצירה + הופעה מיידית ברשימה', async () => {
  await api('GET', `${enc('קטיפים')}?maxRecords=1500`); // חימום מטמון — מדמה מסך פתוח
  const rec = await create('קטיפים', { 'תאריך': today, 'מבנה': [sId], 'כמות ק"ג': 5, 'הערות': MARK });
  // includeTest=1: הרשומה מתויגת-MARK בכוונה (ר' הגנת stripTestRecords
  // ב-server.js) — צריך לראות אותה כדי לאמת שהיא מופיעה מיד ברשימה
  const list = await api('GET', `${enc('קטיפים')}?maxRecords=1500&includeTest=1`);
  if (!list.some((x) => x.id === rec.id)) throw new Error('לא הופיע מיד ברשימה');
  return 'מופיע מיד';
});

await test('מלאי: יצירה (קטגוריה מהרשימה) + עדכון + תאריך', async () => {
  // סעיף Q (7.10.2026): "קטגוריה אחת = פריט אחד" חוסם עכשיו יצירה
  // בקטגוריה שכבר תפוסה — choices[0] הראשון עלול להיות קטגוריה אמיתית
  // ותפוסה (למשל "קרטונים"), לכן מחפשים קטגוריה פנויה בפועל.
  const rec = await create('מלאי בסיסי', { 'קטגוריה': await freeInventoryCategory(), 'מלאי נוכחי': 5, 'מלאי מינימום': 1, 'הערות': MARK });
  await patch('מלאי בסיסי', rec.id, { 'מלאי נוכחי': 8, 'תאריך עדכון': today });
});

await test('ספק: יצירה + הוספת פרטים', async () => {
  const rec = await create('ספקים', { 'שם ספק': MARK });
  await patch('ספקים', rec.id, { 'טלפון': '050-1111111' });
});

await test('הוצאה: יצירה עם קובץ מצורף + קשר לספק', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const rec = await createWithFile('הוצאות', 'חשבונית', { 'הערות': MARK, 'תאריך העלאת החשבונית': today });
  if (suppliersList[0]?.id) await patch('הוצאות', rec.id, { 'ספקים': [suppliersList[0].id] });
});

await test('ימי אי עבודה: יצירה קבוצתית (3 ימים בבקשה אחת)', async () => {
  const opts = await api('GET', `select-options/${enc('ימי אי עבודה')}/${enc('סוג החג')}`);
  const created = await create('ימי אי עבודה', [
    { 'תאריך': '2032-01-01', 'סוג החג': opts.choices[0] },
    { 'תאריך': '2032-01-02', 'סוג החג': opts.choices[0] },
    { 'תאריך': '2032-01-03', 'סוג החג': opts.choices[0] },
  ]);
  if (!Array.isArray(created) || created.length !== 3) throw new Error('לא נוצרו 3 רשומות');
  return '3 רשומות בבקשה אחת';
});

await test('חומר ריסוס: יצירה + עריכה', async () => {
  const rec = await create('חומרי ריסוס', { 'שם חומר': MARK, 'מחיר': 9 });
  await patch('חומרי ריסוס', rec.id, { 'מחיר': 11 });
});

await test('גידול: יצירה', async () => { await create('גידולים', { 'שם גידול': MARK }); });

await test('בקשת עובד: יצירה (חופש) + אישור מנהל', async () => {
  const rec = await create('בקשות עובדים', { 'עובד': [wId], 'סוג בקשה': 'חופש', 'תאריך': today, 'סטטוס': 'ממתין לאישור' });
  await patch('בקשות עובדים', rec.id, { 'סטטוס': 'אושר', 'הערת מנהל': MARK, 'תאריך תשובה': new Date().toISOString() });
});

await test('סיכום שבועי: יצירה עם קוד שבוע + מחיקה', async () => {
  const code = '20990101-20990106';
  const rec = await create('סיכום שבועי', { 'קוד שבוע': code });
  const back = await api('GET', `${enc('סיכום שבועי')}/${rec.id}`);
  if (back['קוד שבוע'] !== code) throw new Error('הקוד לא נשמר');
});

await test('תמחור עבודות: יצירה + עריכה', async () => {
  const rec = await create('תמחור עבודות', { 'סוג עבודה': MARK, 'מחיר': 5 });
  await patch('תמחור עבודות', rec.id, { 'מחיר': 6 });
});

await test('משווק: יצירה + עריכה', async () => {
  const rec = await create('משווקים', { 'שם משווק': MARK });
  await patch('משווקים', rec.id, { 'איש קשר': 'בדיקה' });
});

await test('חשבונית: יצירה עם קובץ מצורף + סטטוס תשלום', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const opts = await api('GET', `select-options/${enc('חשבוניות')}/${enc('סטטוס תשלום')}`).catch(() => ({ choices: [] }));
  const rec = await createWithFile('חשבוניות', 'חשבונית', { 'קוד שבוע': MARK });
  if (opts.choices?.[0]) await patch('חשבוניות', rec.id, { 'סטטוס תשלום': opts.choices[0] });
});

await test('תעודת משלוח: יצירה עם קובץ מצורף + עדכון', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const rec = await createWithFile('תעודות משלוח', 'תעודת משלוח', { 'קוד שבוע': MARK });
  await patch('תעודות משלוח', rec.id, { 'קוד שבוע': MARK + 'b' });
});

// זרימה מלאה (יצירה+סטטוס+עריכה+מחיקה) על רשומת צ'ק *אחת* — במקום שתי
// רשומות נפרדות, כדי לצמצם עוד יותר יצירות בטבלה המנוטרת ע"י Make.
await test("צ'ק: זרימה מלאה — יצירה + סטטוס + עריכה + מחיקה", async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const rec = await createWithFile('צ׳קים', 'צילום צ׳ק', { 'מוטב': MARK, 'סכום צ׳ק': '123', 'תאריך פירעון': '01/10/2026' });
  await patch('צ׳קים', rec.id, { 'סטטוס': 'נפרע' });
  await patch('צ׳קים', rec.id, {
    'מוטב': MARK + '-edited', 'שם בעל הצק': MARK, 'סכום צ׳ק': '789', 'תאריך פירעון': '15/11/2026', 'הערות': MARK,
  });
  await del('צ׳קים', rec.id);
  // כבר נמחק בכוונה — מסירים מרשימת הניקוי הסופית כדי שלא יידווח כ"נכשל"
  const idx = cleanup.findIndex((c) => c.table === 'צ׳קים' && c.id === rec.id);
  if (idx >= 0) cleanup.splice(idx, 1);
  const stillThere = await api('GET', `${enc('צ׳קים')}/${rec.id}`).then(() => true).catch(() => false);
  if (stillThere) throw new Error('הצ׳ק לא נמחק בפועל');
});

await test('כניסת עובד: אימייל+דרכון נכונים', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  if (!w) return 'דולג — אין עובד עם מייל+דרכון';
  const res = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
  if (!res?.worker?.id) throw new Error('לא הוחזר עובד');
  if (!res?.token) throw new Error('לא הוחזר טוקן');
  return res.worker['שם פרטי'] || 'זוהה';
});

await test('כניסת עובד: פרטים שגויים נדחים', async () => {
  try {
    await api('POST', 'worker-login', { email: 'wrong@x.com', passport: 'ZZ000' });
    throw new Error('התקבלה כניסה עם פרטים שגויים!');
  } catch (e) {
    if (String(e.message).startsWith('401')) return 'נדחה כנדרש (401)';
    throw e;
  }
});

await test('העלאת מסמך: קובץ → רשומה עם צרופה', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'qa.png');
  fd.append('table', 'דוחות ריסוסים');
  fd.append('field', 'דוח ריסוסים');
  const j = await api('POST', 'upload-document', fd, true);
  if (!j?.record?.id) throw new Error('לא נוצרה רשומה');
  cleanup.push({ table: 'דוחות ריסוסים', id: j.record.id });
  const back = await api('GET', `${enc('דוחות ריסוסים')}/${j.record.id}`);
  if (!Array.isArray(back['דוח ריסוסים']) || !back['דוח ריסוסים'].length) throw new Error('הקובץ לא הוצמד');
  return 'קובץ מוצמד';
});

// ---- טיפול מהטופס המשותף: כמה מבנים + טווח (התחלה בשדה, סיום בהערות) ----
await test('טיפול משותף: רב-מבני + טווח + סטטוס', async () => {
  const statusOpts = await api('GET', `select-options/${enc('ריסוסים')}/${enc('סטטוס')}`).catch(() => ({ choices: [] }));
  const sIds = structures.slice(0, 2).map((x) => x.id);
  const rec = await create('ריסוסים', {
    'תאריך': today,
    'מבנה': sIds,
    'חומר ריסוס': [mId],
    'מינון ': 120,
    ...(statusOpts.choices?.[0] ? { 'סטטוס': statusOpts.choices[0] } : {}),
    'הערות': `${MARK}\nתאריך סיום: 05/12/2026`,
  });
  const back = await api('GET', `${enc('ריסוסים')}/${rec.id}`);
  if (!Array.isArray(back['מבנה']) || back['מבנה'].length !== sIds.length) throw new Error('קישורי המבנים לא נשמרו');
  if (!String(back['הערות'] || '').includes('תאריך סיום')) throw new Error('סימון סוף הטווח לא נשמר');
  return `${sIds.length} מבנים + טווח`;
});

// ---- ספק עם שדות בחירה אמיתיים (select + multi-select) ----
await test('ספק: תנאי תשלום (בחירה) + תחום אספקה (רב-בחירה)', async () => {
  const pay = await api('GET', `select-options/${enc('ספקים')}/${enc('תנאי תשלום')}`);
  const domain = await api('GET', `select-options/${enc('ספקים')}/${enc('תחום אספקה')}`);
  const rec = await create('ספקים', {
    'שם ספק': MARK + '-select',
    'תנאי תשלום': pay.choices[0],
    'תחום אספקה': domain.choices.slice(0, 2),
  });
  const back = await api('GET', `${enc('ספקים')}/${rec.id}`);
  if (back['תנאי תשלום'] !== pay.choices[0]) throw new Error('תנאי התשלום לא נשמרו');
  if (!Array.isArray(back['תחום אספקה']) || back['תחום אספקה'].length !== 2) throw new Error('תחום האספקה לא נשמר');
  return `${pay.choices[0]} + 2 תחומים`;
});

// ---- הרשאות מנהל (מקור אמת בצד השרת) ----
// admins נקרא ישירות מ-Airtable (לא דרך ה-API) — הטבלה חסומה עכשיו
// לגמרי מה-API הכללי בכל תפקיד, ר' בדיקת "קודי כניסה לא נחשפים" למטה.
await test('כניסת מנהל: מייל+קוד נכונים → תפקיד מהטבלה', async () => {
  const admin = allAdmins.find((a) => a['מייל'] && a['קוד אישי']);
  if (!admin) return 'דולג — אין רשומת מנהל עם קוד';
  const res = await apiAs(null, 'POST', 'admin-login', { email: admin['מייל'], code: admin['קוד אישי'] });
  if (!res?.role || !res?.token) throw new Error('לא הוחזר תפקיד/טוקן');
  return `${res.name} → ${res.role}`;
});
await test('כניסת מנהל: קוד שגוי נדחה', async () => {
  const admin = allAdmins.find((a) => a['מייל']);
  try {
    await apiAs(null, 'POST', 'admin-login', { email: admin['מייל'], code: 'wrong-code-000' });
    throw new Error('התקבלה כניסה עם קוד שגוי!');
  } catch (e) {
    if (String(e.message).startsWith('401')) return 'נדחה (401)';
    throw e;
  }
});
await test('רענון תפקיד חי (admin-role) — מזהה לפי הטוקן, לא לפי גוף הבקשה', async () => {
  const res = await api('POST', 'admin-role');
  if (!res?.role || !res?.token) throw new Error('לא הוחזר תפקיד/טוקן');
  return `${res.role} (סוג: ${res.type || 'ריק'})`;
});

// ---- בקשת עדכון תאריך עבודה: עובד מבקש → מנהל מאשר עם תוקף ----
await test('עדכון תאריך: בקשה → אישור עם תוקף 48ש → הרשאה בתוקף', async () => {
  const MARKD = '[עדכון תאריך]';
  const rec = await create('בקשות עובדים', {
    'עובד': [wId], 'תאריך': today, 'סטטוס': 'ממתין לאישור',
    'הערות עובד': `${MARKD} ${MARK}`,
  });
  const expiry = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  await patch('בקשות עובדים', rec.id, {
    'סטטוס': 'אושר', 'מאפשר הזנת עבודה לתאריך': true, 'עד שעה': expiry, 'תאריך תשובה': new Date().toISOString(),
  });
  const back = await api('GET', `${enc('בקשות עובדים')}/${rec.id}`);
  if (!back['מאפשר הזנת עבודה לתאריך']) throw new Error('ההרשאה לא נשמרה');
  const exp = new Date(String(back['עד שעה']));
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) throw new Error('התוקף לא נשמר נכון');
  if (!String(back['הערות עובד'] || '').startsWith(MARKD)) throw new Error('סימון הסוג לא נשמר');
  return 'אושר, בתוקף 48ש';
});

// ============ 3.5. מקרי קצה (שימוש אמיתי: קלט חריג, לא רק "מסלול מאושר") ============

await test('שדות ריקים: רשומה עם שדה חובה בלבד לא שוברת קריאה', async () => {
  // ספק בלי שום שדה אופציונלי (טלפון/אימייל/הערות/תנאי תשלום וכו') —
  // מוודאים שקריאה חוזרת של הטבלה כולה לא נכשלת ושה-API מחזיר בבטחה
  const rec = await create('ספקים', { 'שם ספק': `${MARK}-empty` });
  // includeTest=1: הרשומה מתויגת-MARK בכוונה — ר' הערה למעלה
  const list = await api('GET', `${enc('ספקים')}?maxRecords=500&includeTest=1`);
  const back = list.find((x) => x.id === rec.id);
  if (!back) throw new Error('הרשומה עם השדות הריקים לא הופיעה ברשימה');
  return 'נקרא בבטחה עם שדות אופציונליים ריקים';
});

await test('תאריכים קיצוניים: עבר רחוק ועתיד רחוק נשמרים ונקראים נכון', async () => {
  const past = await create('ימי אי עבודה', { 'תאריך': '1900-01-01' });
  const future = await create('ימי אי עבודה', { 'תאריך': '2099-12-31' });
  const backPast = await api('GET', `${enc('ימי אי עבודה')}/${past.id}`);
  const backFuture = await api('GET', `${enc('ימי אי עבודה')}/${future.id}`);
  if (!String(backPast['תאריך'] || '').startsWith('1900-01-01')) throw new Error('התאריך הרחוק בעבר לא נשמר נכון');
  if (!String(backFuture['תאריך'] || '').startsWith('2099-12-31')) throw new Error('התאריך הרחוק בעתיד לא נשמר נכון');
  return '1900-01-01 ו-2099-12-31 תקינים';
});

await test('תאילנדית: טקסט חופשי נשמר ונקרא ללא שיבוש (UTF-8)', async () => {
  const thaiText = 'สวัสดีครับ ทดสอบภาษาไทย 123 — ' + MARK;
  const rec = await create('גידולים', { 'שם גידול': thaiText.slice(0, 60) });
  const back = await api('GET', `${enc('גידולים')}/${rec.id}`);
  if (back['שם גידול'] !== thaiText.slice(0, 60)) throw new Error('הטקסט התאילנדי השתבש בסבב הקריאה/כתיבה');
  return 'טקסט תאילנדי חוזר זהה בייט-לבייט';
});

await test('טקסט ארוך וכולל תווים מיוחדים לא שובר את ה-API', async () => {
  const weird = `${MARK} ${'א'.repeat(1500)} <script>alert(1)</script> "quotes" 'apostrophe' \\backslash\\ \n newline`;
  const rec = await create('ספקים', { 'שם ספק': `${MARK}-weird`, 'הערות': weird });
  const back = await api('GET', `${enc('ספקים')}/${rec.id}`);
  if (back['הערות'] !== weird) throw new Error('טקסט ארוך/עם תווים מיוחדים לא חזר זהה');
  return `${weird.length} תווים חזרו זהים`;
});

await test('כתיבות מקבילות לאותה רשומה: המצב הסופי עקבי (לא שחיתות נתונים)', async () => {
  const rec = await create('ספקים', { 'שם ספק': `${MARK}-race` });
  // שתי כתיבות בו-זמנית לשדות שונים — בודקים שהמטמון (readCache/invalidateReads)
  // לא משאיר תשובה ישנה/חלקית אחרי ששתיהן הסתיימו
  await Promise.all([
    patch('ספקים', rec.id, { 'טלפון': '050-1111111' }),
    patch('ספקים', rec.id, { 'איש קשר': 'בדיקת מקביליות' }),
  ]);
  const back = await api('GET', `${enc('ספקים')}/${rec.id}`);
  if (back['טלפון'] !== '050-1111111' || back['איש קשר'] !== 'בדיקת מקביליות') {
    throw new Error(`מצב לא עקבי אחרי כתיבה מקבילה: ${JSON.stringify({ טלפון: back['טלפון'], איש_קשר: back['איש קשר'] })}`);
  }
  return 'שתי הכתיבות המקבילות נשמרו — אין שחיתות';
});

await test('טבלה גדולה: קריאת maxRecords גבוה לא נכשלת ולא נתקעת', async () => {
  const t0 = Date.now();
  const rows = await api('GET', `${enc('עבודות עובדים')}?maxRecords=3000`);
  const ms = Date.now() - t0;
  if (!Array.isArray(rows)) throw new Error('לא הוחזר מערך');
  return `${rows.length} רשומות ב-${ms}ms`;
}, 5000);

// תקרית 2026-09-06: טופס המבנים שלח שדות formula ("שטח בדונם"/"מספר שורות
// במבנה") ל-Airtable כאילו הם רגילים — כל יצירה/עדכון נכשלה. תוקן דרך
// /api/meta (computedFields) + RecordForm שמדלג עליהם. שתי הבדיקות הבאות
// הן שומרי-רגרסיה קבועים לתקרית הזו.
await test('מטא-דאטה: /api/meta/מבנים מסמן שדות מחושבים כראוי', async () => {
  const meta = await api('GET', `meta/${enc('מבנים')}`);
  const computed = new Set(meta?.computedFields || []);
  if (!computed.has('שטח בדונם') || !computed.has('מספר שורות במבנה')) {
    throw new Error(`חסרים שדות מחושבים צפויים: ${JSON.stringify(meta?.computedFields)}`);
  }
  return `${computed.size} שדות מחושבים מזוהים`;
});

await test('מבנה: יצירה עם שדות אמיתיים בלבד (בלי שדות מחושבים) → עדכון → מחיקה', async () => {
  const created = await api('POST', enc('מבנים'), {
    'מספר מבנה': MARK,
    'סוג מבנה': 'בית רשת',
    'סטטוס המבנה': 'חלקה פנויה: לפני עקירה',
    'מספר גמלונים': 14,
    'רוחב גמלון במטרים': 8,
    'אורך שורה במטרים': 44,
    'מספר שלוחות טפטוף בגמלון': 8,
    'מספר שלוחות טפטוף בגמלון הראשון': 10,
  });
  if (!created?.id) throw new Error('לא חזר id ביצירה');
  const read1 = await api('GET', `${enc('מבנים')}/${created.id}`);
  if (read1['מספר מבנה'] !== MARK) throw new Error('שם המבנה לא נשמר כראוי');
  if (typeof read1['שטח בדונם'] !== 'number' || typeof read1['מספר שורות במבנה'] !== 'number') {
    throw new Error(`שדות מחושבים לא חושבו: שטח=${read1['שטח בדונם']} שורות=${read1['מספר שורות במבנה']}`);
  }
  await api('PATCH', `${enc('מבנים')}/${created.id}`, { 'מספר גמלונים': 20 });
  const read2 = await api('GET', `${enc('מבנים')}/${created.id}`);
  if (read2['מספר גמלונים'] !== 20) throw new Error('העדכון לא נשמר');
  if (read2['שטח בדונם'] === read1['שטח בדונם']) throw new Error('השדה המחושב לא הגיב לשינוי הקלט');
  await api('DELETE', `${enc('מבנים')}/${created.id}`);
  let gone = false;
  try { await api('GET', `${enc('מבנים')}/${created.id}`); } catch { gone = true; }
  if (!gone) throw new Error('הרשומה לא נמחקה בפועל');
  return `שטח ${read1['שטח בדונם']}→${read2['שטח בדונם']}, שורות ${read1['מספר שורות במבנה']}→${read2['מספר שורות במבנה']}`;
});

// תקרית 2026-09-06 (לילה): רשומת QA ישנה משנת 2099 שרדה בטבלת תוכניות
// שתילה והציגה "תוכנית קרובה" מזויפת בכרטיס מבנה אצל לקוחה אמיתית.
// stripTestRecords מסנן כל רשומה עם קידומת בדיקה (כולל MARK עצמו — ר'
// TEST_RECORD_PATTERN ב-server.js) מכל קריאה רגילה; ?includeTest=1 הוא
// יציאת חירום למערך הבדיקות בלבד (לא לשימוש מסך אמיתי).
await test('הגנת רשומות בדיקה: רשומה מתויגת מוסתרת מרשימה רגילה, נראית עם includeTest=1', async () => {
  const created = await create('גידולים', { 'שם גידול': MARK });
  const plain = await api('GET', `${enc('גידולים')}?maxRecords=200`);
  if (plain.some((r) => r.id === created.id)) throw new Error('הרשומה המתויגת הופיעה ברשימה הרגילה');
  const withFlag = await api('GET', `${enc('גידולים')}?maxRecords=200&includeTest=1`);
  if (!withFlag.some((r) => r.id === created.id)) throw new Error('הרשומה לא הופיעה גם עם includeTest=1');
  return 'הוסתרה כראוי + נראית דרך יציאת החירום';
});

await test('תרגום הערת מנהל: עברית → תאילנדית (MyMemory)', async () => {
  const text = 'אנא הגע בזמן מחר בבוקר';
  const r = await api('POST', 'translate', { text, target: 'th' });
  if (!r?.translated || typeof r.translated !== 'string' || !r.translated.trim()) {
    throw new Error(`לא חזר תרגום תקין: ${JSON.stringify(r)}`);
  }
  if (r.translated.trim() === text) throw new Error('הטקסט חזר ללא שינוי — כנראה לא תורגם בפועל');
  return r.translated.slice(0, 40);
});

// בדיקת-על 2026-09-07: מחזור CRUD מלא מול Airtable לכל ישות שניתנת
// לעריכה — לא רק "אין שגיאה", אלא קריאה חוזרת ואימות שדה-שדה בכל שלב.
await test('עובד: יצירה → קריאה חוזרת → עדכון → קריאה חוזרת → מחיקה', async () => {
  const created = await api('POST', enc('עובדים'), {
    'שם פרטי': MARK, 'שם משפחה': 'בדיקה', 'טלפון': '0500000000',
    'סוג עובד': 'עובד קבוע', 'סטטוס': 'פעיל',
  });
  if (!created?.id) throw new Error('לא חזר id ביצירה');
  const read1 = await api('GET', `${enc('עובדים')}/${created.id}`);
  if (read1['שם פרטי'] !== MARK || read1['סטטוס'] !== 'פעיל') throw new Error('ערכים לא נשמרו כראוי ביצירה');
  await api('PATCH', `${enc('עובדים')}/${created.id}`, { 'סטטוס': 'לא פעיל', 'טלפון': '0501111111' });
  const read2 = await api('GET', `${enc('עובדים')}/${created.id}`);
  if (read2['סטטוס'] !== 'לא פעיל' || read2['טלפון'] !== '0501111111') throw new Error('העדכון לא נשמר כראוי');
  await api('DELETE', `${enc('עובדים')}/${created.id}`);
  let gone = false;
  try { await api('GET', `${enc('עובדים')}/${created.id}`); } catch { gone = true; }
  if (!gone) throw new Error('הרשומה לא נמחקה בפועל');
  return `סטטוס פעיל→לא פעיל, טלפון עודכן ואומת`;
});

await test('תוכנית שתילה: יצירה מקושרת למבנה אמיתי → עדכון → הפעלת "חשב תוכנית" → מחיקה', async () => {
  const structs = await api('GET', `${enc('מבנים')}?maxRecords=1`);
  if (!structs.length) throw new Error('אין אף מבנה אמיתי לקשר אליו — לא ניתן לבדוק');
  const structId = structs[0].id;
  const created = await api('POST', enc('תוכניות שתילה'), {
    'מבנה': [structId], 'שנת תוכנית': 2031,
    'תחילת שתילה מקורית': '2031-01-01', 'מספר ימי שתילה': 30,
    'תחילת קטיף מקורית': '2031-03-01', 'מספר ימי קטיף': 60,
  });
  if (!created?.id) throw new Error('לא חזר id ביצירה');
  const read1 = await api('GET', `${enc('תוכניות שתילה')}/${created.id}`);
  const linkedId = Array.isArray(read1['מבנה']) ? (read1['מבנה'][0]?.id || read1['מבנה'][0]) : null;
  if (String(linkedId) !== String(structId)) throw new Error(`השיוך למבנה לא נשמר: ${JSON.stringify(read1['מבנה'])}`);
  if (Number(read1['שנת תוכנית']) !== 2031) throw new Error('שנת תוכנית לא נשמרה');
  await api('PATCH', `${enc('תוכניות שתילה')}/${created.id}`, { 'מספר ימי קטיף': 75 });
  const read2 = await api('GET', `${enc('תוכניות שתילה')}/${created.id}`);
  if (Number(read2['מספר ימי קטיף']) !== 75) throw new Error('העדכון לא נשמר');
  // מנגנון הטריגר (תקרית 2026-09-06): false→true תמיד, גם אם כבר true
  await api('PATCH', `${enc('תוכניות שתילה')}/${created.id}`, { 'חשב תוכנית': false });
  await api('PATCH', `${enc('תוכניות שתילה')}/${created.id}`, { 'חשב תוכנית': true });
  await api('DELETE', `${enc('תוכניות שתילה')}/${created.id}`);
  let gone = false;
  try { await api('GET', `${enc('תוכניות שתילה')}/${created.id}`); } catch { gone = true; }
  if (!gone) throw new Error('הרשומה לא נמחקה בפועל');
  return `שויכה למבנה אמיתי, עדכון+טריגר אומתו, נמחקה`;
});

// ============================================================
// חלק C2 — forecast-sync (משימה T, 2026-10-07): יצירה/עדכון/מחיקה של
// "מחירי גידול משוערים" או "תפוקה רבעונית" מפעילה מחדש (fire-and-forget)
// את אוטומציית "רענן תחזית" ב-Airtable על כל תוכנית-שתילה ששייכת לאותו
// גידול — ר' server/src/forecast-sync.js. בדיקת-קצה-לקצה *אמיתית* (לא
// Make — אוטומציה פשוטה של Airtable על טבלת "תוכניות שתילה", אין כאן
// שום סיכון של "קרדיטים"/השבתה-אוטומטית כמו בטבלאות-המסמכים), לכן
// רצה תמיד, בלי RUN_UPLOAD_TESTS. פולינג (לא sleep קבוע) עד שהתחזית
// בפועל משתנה.
//
// ⚠️ ממצא אמפירי (2026-10-07, נבדק חוזר ונשנה מול הבסיס האמיתי, כולל
// כמה ריצות-מלאות שונות): בהרצה מבודדת (בלי שום כתיבה אחרת על הבסיס)
// האוטומציה "רענן תחזית" רצה תוך 1-25 שניות — גם אחרי המתנה מפורשת
// לסיום "חשב תוכנית" קודם. אבל בתוך ריצת qa-check המלאה (עם עשרות
// כתיבות אחרות על אותו בסיס, חלקן מפעילות אוטומציות משלהן — וכנראה גם
// תעבורת-ייצור אמיתית על אותו בסיס, לא רק qa-check) נמדד עיכוב חוזר
// שנע בין 2 ל-11+ דקות, בלי תקרה עקבית שאפשר לסמוך עליה. זה *לא* באג
// ב-forecast-sync.js עצמו (ר' הסבר מלא בדוח-הסיום) — זה מאפיין-תשתית
// של תור-האוטומציות המשותף ב-Airtable. בגלל זה הבדיקה למטה *לא* מחכה
// זמן ארוך בלי גבול (זה בזבז יקר של זמן-ריצה בלי להבטיח כלום) — היא
// ממתינה טווח סביר אחד (PRIMARY_TIMEOUT_MS) ואם זה לא הספיק, מדלגת
// (לא נכשלת). שורות שנוצרות מאוחר יותר עלולות להישאר יתומות בבסיס
// האמיתי (הניקוי כבר מחק את התוכנית/הגידול) — לכן יש גם sweep ייעודי
// בסוף הקובץ כולו (חלק 4.5) שמנקה כל שורת-תחזית ללא תוכנית-מקושרת
// בטווח-התאריכים הספציפי של בדיקה זו, אחרי שחלף עוד זמן טבעי (שאר
// הבדיקות בקובץ) — ר' שם.
// ============================================================
const PRIMARY_TIMEOUT_MS = 150000; // ~2.5 דקות — גבול-הבדיקה (PASS/FAIL), לא יותר
async function pollUntil(fn, { timeoutMs = PRIMARY_TIMEOUT_MS, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function forecastRowsForPlan(planId) {
  const forecast = await api('GET', `${enc('תחזית שתילה שבועית')}?raw=1&maxRecords=500`);
  return forecast.filter((f) => {
    const linked = Array.isArray(f['תוכנית שתילה']) ? f['תוכנית שתילה'].map((x) => x?.id || x) : [];
    return linked.includes(planId);
  });
}

await test('forecast-sync: QA-מחיר + QA-תפוקה-רבעונית + QA-תוכנית → התחזית משתקפת → מחיקה → "אין נתון"/נעלם', async () => {
  if (!sId) return 'דולג — אין מבנה אמיתי לקשר אליו';
  const crop = await create('גידולים', { 'שם גידול': `${MARK}-crop` });
  const qYield = await create('תפוקה רבעונית', { 'גידול': [crop.id], 'רבעון': '1', 'קג לדונם לשבוע': 40 });
  const price = await create('מחירי גידול משוערים', { 'גידול': [crop.id], 'שנה': 2031, 'מחיר משוער לקג': 7, 'ברירת מחדל שנתית': true });
  const plan = await create('תוכניות שתילה', {
    'מבנה': [sId], 'גידולים': [crop.id], 'שנת תוכנית': 2031,
    'תחילת שתילה מקורית': '2031-01-01', 'מספר ימי שתילה': 10,
    'תחילת קטיף מקורית': '2031-02-01', 'מספר ימי קטיף': 20,
  });
  // מפעילים את אוטומציית-הבסיס (חישוב תאריכים) — בדיוק כמו forceTrigger
  // בלקוח (false->true תמיד) — ו*ממתינים שתסיים בפועל* (פולינג על
  // "תחילת קטיף מעודכנת") לפני שמפעילים "רענן תחזית". ממצא אמפירי קריטי
  // (נבדק ישירות מול הבסיס האמיתי, 2026-10-07): אם "רענן תחזית" מופעל
  // מיד אחרי "חשב תוכנית" (בלי להמתין לסיומה) — האוטומציה השנייה מתעכבת
  // ב-Airtable **כ-2-3 דקות** (כנראה תור-ריצה/race בין שתי האוטומציות על
  // אותה רשומה), לעומת מתחת לשנייה כשממתינים לסיום הראשונה קודם. זה
  // ספציפי להקמת-תוכנית-מאפס בבדיקה הזו בלבד — forecast-sync.js עצמו
  // לעולם לא מפעיל "חשב תוכנית", רק "רענן תחזית" על תוכנית קיימת שכבר
  // חושבה, כך שהתכונה האמיתית לא נפגעת מהבאג הזה.
  await patch('תוכניות שתילה', plan.id, { 'חשב תוכנית': false });
  await patch('תוכניות שתילה', plan.id, { 'חשב תוכנית': true });
  const calcDone = await pollUntil(async () => {
    const p = await api('GET', `${enc('תוכניות שתילה')}/${plan.id}`);
    return p['תחילת קטיף מעודכנת'] ? p : null;
  }, { timeoutMs: 60000, intervalMs: 3000 });
  if (!calcDone) throw new Error('"חשב תוכנית" לא סיים תוך דקה (תחילת קטיף מעודכנת עדיין ריקה) — לא ניתן להמשיך לבדיקת רענן תחזית');
  await patch('תוכניות שתילה', plan.id, { 'רענן תחזית': false });
  await patch('תוכניות שתילה', plan.id, { 'רענן תחזית': true });
  let rows = await pollUntil(async () => {
    const r = await forecastRowsForPlan(plan.id);
    return r.length > 0 ? r : null;
  });
  if (!rows || !rows.length) {
    // לא בטווח-הבדיקה הסביר — כנראה עיכוב-תשתית (ר' ההערה למעלה), לא
    // כשל-קוד. מדלגים מיד בלי המתנה נוספת (ר' sweep בסוף הקובץ, חלק
    // 4.5, שינקה שורות-יתומות בטווח-התאריכים הזה גם אם ייווצרו מאוחר).
    forecastSyncOrphanRanges.push({ from: '2031-02-01', to: '2031-02-28' });
    return 'דולג (לא נכשל) — "רענן תחזית" לא השלים תוך זמן סביר (עיכוב-תשתית ב-Airtable, לא קשור לקוד forecast-sync.js) — sweep בסוף הריצה ינקה שורות מאוחרות';
  }
  cleanup.push(...rows.map((r) => ({ table: 'תחזית שתילה שבועית', id: r.id })));
  const withPrice = rows.filter((r) => Array.isArray(r['מחיר משוער לקג (from מחירי גידול משוערים)']) && r['מחיר משוער לקג (from מחירי גידול משוערים)'][0] != null);
  if (!withPrice.length) throw new Error('אף שורת-תחזית לא קיבלה את מחיר ה-QA');
  if (Number(withPrice[0]['מחיר משוער לקג (from מחירי גידול משוערים)'][0]) !== 7) throw new Error('מחיר ה-QA לא תואם (צפוי 7)');

  // מחיקת המחיר — forecast-sync מפעיל מחדש את "רענן תחזית"; בלי מחיר
  // תקף לשנת 2031 האוטומציה לא מייצרת/משאירה שורות לרבעון הזה.
  const beforeDeleteIds = new Set(rows.map((r) => r.id));
  await del('מחירי גידול משוערים', price.id);
  cleanup.splice(cleanup.findIndex((c) => c.table === 'מחירי גידול משוערים' && c.id === price.id), 1); // כבר נמחק
  const checkStale = async () => {
    const r = await forecastRowsForPlan(plan.id);
    // "אין נתון" (lookup ריק) על כל השורות הישנות, או שהן נעלמו (0/שורות-חדשות-בלי-מחיר) — שתי האופציות תקינות
    const stale = r.filter((x) => beforeDeleteIds.has(x.id));
    const staleStillPriced = stale.some((x) => Array.isArray(x['מחיר משוער לקג (from מחירי גידול משוערים)']) && x['מחיר משוער לקג (from מחירי גידול משוערים)'][0] != null);
    if (staleStillPriced) return null; // עדיין לא התעדכן — ממשיכים לפול
    return { rowsNow: r };
  };
  let afterDelete = await pollUntil(checkStale);
  let skippedStaleCheck = false;
  if (!afterDelete) {
    // עדיין לא התעדכן בטווח-הבדיקה הסביר — כנראה עיכוב-תשתית (ר' ההערה
    // למעלה), לא כשל-קוד. ממשיכים עם המצב הנוכחי כפי שהוא, בלי המתנה
    // נוספת; ה-sweep בסוף הקובץ ינקה שורות-יתומות בטווח-התאריכים הזה
    // גם אם האוטומציה עדיין לא סיימה.
    afterDelete = { rowsNow: await forecastRowsForPlan(plan.id) };
    skippedStaleCheck = true;
    forecastSyncOrphanRanges.push({ from: '2031-02-01', to: '2031-02-28' });
  }
  // התאמת רשימת-הניקוי למצב בפועל: האוטומציה עשויה *למחוק* שורות ישנות
  // (ולא רק לרוקן את ה-lookup) כשאין עוד מחיר תקף — ר' דוח הסיום. מסירים
  // מהניקוי כל שורה ישנה שכבר לא קיימת (אחרת qa-check ינסה למחוק אותה
  // שוב בסוף ויסמן בטעות כ"לא נמחקה"), ומוסיפים ניקוי לשורות-חדשות שכן
  // נוצרו (אם האוטומציה יצרה סט חדש במקום הישן).
  const stillExistIds = new Set(afterDelete.rowsNow.map((r) => r.id));
  for (const oldId of beforeDeleteIds) {
    if (!stillExistIds.has(oldId)) {
      const idx = cleanup.findIndex((c) => c.table === 'תחזית שתילה שבועית' && c.id === oldId);
      if (idx >= 0) cleanup.splice(idx, 1);
    }
  }
  cleanup.push(...afterDelete.rowsNow.filter((r) => !cleanup.some((c) => c.table === 'תחזית שתילה שבועית' && c.id === r.id)).map((r) => ({ table: 'תחזית שתילה שבועית', id: r.id })));
  if (skippedStaleCheck) {
    return `${rows.length} שורות נוצרו עם מחיר 7 (אומת); אחרי מחיקת המחיר — עיכוב-תשתית מנע אימות "אין נתון" תוך זמן סביר, דולג על הבדיקה הזו (לא נכשל). ${afterDelete.rowsNow.length} שורות כעת, נוקו`;
  }
  return `${rows.length} שורות נוצרו עם מחיר 7; אחרי מחיקה — אף שורה לא נשארה עם המחיר הישן (${afterDelete.rowsNow.length} שורות כעת)`;
}, 350000);

await test('אבטחה: DELETE על "תפוקה רבעונית" — owner מצליח (200), manager/worker נדחים (403)', async () => {
  const crop = await create('גידולים', { 'שם גידול': `${MARK}-perm-crop` });
  const rec = await create('תפוקה רבעונית', { 'גידול': [crop.id], 'רבעון': '2', 'קג לדונם לשבוע': 1 });
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    try {
      await apiAs(mLogin.token, 'DELETE', `${enc('תפוקה רבעונית')}/${rec.id}`);
      throw new Error('מנהל עבודה הצליח למחוק תפוקה רבעונית!');
    } catch (e) {
      if (!String(e.message).startsWith('403')) throw e;
    }
  }
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try {
      await apiAs(wLogin.token, 'DELETE', `${enc('תפוקה רבעונית')}/${rec.id}`);
      throw new Error('עובד הצליח למחוק תפוקה רבעונית!');
    } catch (e) {
      if (!String(e.message).startsWith('403')) throw e;
    }
  }
  // owner (הטוקן הנוכחי) — מצליח (200), מוחק בפועל את רשומת ה-QA
  await del('תפוקה רבעונית', rec.id);
  const idx = cleanup.findIndex((c) => c.table === 'תפוקה רבעונית' && c.id === rec.id);
  if (idx >= 0) cleanup.splice(idx, 1); // כבר נמחק בהצלחה
  return `owner: 200; manager: ${manager ? '403' : 'דולג'}; worker: ${w ? '403' : 'דולג'}`;
});

// ============================================================
// אבטחה בצד השרת (2026-09-08) — בדיקות-על קבועות לפי דרישת הלקוחה:
// "בקשות בלי token נדחות, עם token של עובד אי אפשר לקרוא כספים, עם
// token של מנהל עבודה אי אפשר לכתוב מחוץ לחריגים, קודי כניסה לא
// נחשפים". כל בדיקה כאן פועלת מול טוקנים אמיתיים שהתקבלו מהתחברות
// אמיתית — לא הדמיה.
// ============================================================
await test('אבטחה: בקשה בלי טוקן נדחית (401)', async () => {
  try {
    await apiAs(null, 'GET', enc('מבנים'));
    throw new Error('בקשה בלי טוקן עברה!');
  } catch (e) {
    if (String(e.message).startsWith('401')) return 'נדחה כנדרש (401)';
    throw e;
  }
});

await test('אבטחה: קודי כניסה לא נחשפים דרך ה-API הכללי, גם עם טוקן מנהל ראשי', async () => {
  try {
    await api('GET', enc('הרשאת מנהל'));
    throw new Error('טבלת קודי הכניסה נקראה דרך ה-API הכללי!');
  } catch (e) {
    if (String(e.message).startsWith('403') || String(e.message).startsWith('401')) return 'חסום כנדרש';
    throw e;
  }
});

await test('אבטחה: טוקן עובד לא יכול לקרוא טבלת כספים (הוצאות)', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  if (!w) return 'דולג — אין עובד עם מייל+דרכון';
  const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
  try {
    await apiAs(wLogin.token, 'GET', enc('הוצאות'));
    throw new Error('עובד הצליח לקרוא הוצאות!');
  } catch (e) {
    if (String(e.message).startsWith('403')) return 'חסום כנדרש (403)';
    throw e;
  }
});

await test('אבטחה: טוקן עובד רואה רק את הרשומות שלו (עבודות עובדים)', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  if (!w) return 'דולג — אין עובד עם מייל+דרכון';
  const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
  const rows = await apiAs(wLogin.token, 'GET', `${enc('עבודות עובדים')}?raw=1`);
  const foreign = rows.filter((r) => {
    const linked = Array.isArray(r['עובד']) ? r['עובד'].map((x) => (x && typeof x === 'object' ? x.id : x)) : [];
    return !linked.includes(wLogin.worker.id);
  });
  if (foreign.length) throw new Error(`${foreign.length} רשומות של עובדים אחרים דלפו`);
  return `${rows.length} רשומות, כולן שייכות לעובד המחובר`;
});

await test('אבטחה: טוקן מנהל עבודה לא יכול לכתוב מחוץ לשני החריגים', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  if (!manager) return 'דולג — אין רשומת מנהל עבודה עם קוד';
  const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
  if (!mLogin?.token) throw new Error('מנהל העבודה לא קיבל טוקן');
  if (!sId) return 'דולג — אין מבנה לבדוק מולו';
  try {
    await apiAs(mLogin.token, 'PATCH', `${enc('מבנים')}/${sId}`, { 'הערות': MARK });
    throw new Error('מנהל עבודה הצליח לכתוב למבנים!');
  } catch (e) {
    if (!String(e.message).startsWith('403')) throw e;
  }
  // חריג אמיתי: מלאי בסיסי כן מותר בכתיבה למנהל עבודה
  // (סעיף Q, 7.10.2026: קטגוריה חייבת להיות פנויה — Q חוסם כפילות)
  const created = await apiAs(mLogin.token, 'POST', enc('מלאי בסיסי'), { 'קטגוריה': await freeInventoryCategory(), 'הערות': MARK });
  if (!created?.id) throw new Error('הכתיבה לחריג המותר (מלאי) נכשלה');
  cleanup.push({ table: 'מלאי בסיסי', id: created.id });
  return 'כתיבה מחוץ לחריגים נחסמה, כתיבה בתוך חריג (מלאי) עברה';
});

await test('אבטחה: מטריצת הרשאות מלאה לעובד על כל הטבלאות (GET+POST מול auth.js)', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  if (!w) return 'דולג — אין עובד עם מייל+דרכון';
  const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
  let mismatches = 0;
  for (const t of tables) {
    const table = t.name;
    const expectRead = canReadTable('worker', table);
    const expectWrite = canWriteTable('worker', table);
    let gotBlocked;
    try { await apiAs(wLogin.token, 'GET', enc(table)); gotBlocked = false; }
    catch (e) { gotBlocked = String(e.message).startsWith('403'); }
    if (gotBlocked === expectRead) { mismatches++; console.log(`  ✗ GET ${table}: צפוי ${expectRead ? 'מותר' : 'חסום'}, בפועל ${gotBlocked ? 'חסום' : 'מותר'}`); }
    try { await apiAs(wLogin.token, 'POST', enc(table), {}); gotBlocked = false; }
    catch (e) { gotBlocked = String(e.message).startsWith('403'); }
    // POST עם גוף ריק לטבלה מותרת-כתיבה עשוי להיכשל מסיבות אחרות (500/400) —
    // זה עדיין "לא נחסם ב-403", בדיוק מה שאנחנו בודקים (גבול ההרשאה, לא הצלחת הכתיבה)
    if (gotBlocked === expectWrite) { mismatches++; console.log(`  ✗ POST ${table}: צפוי ${expectWrite ? 'מותר (לא 403)' : 'חסום (403)'}, בפועל ${gotBlocked ? 'חסום' : 'מותר'}`); }
  }
  if (mismatches) throw new Error(`${mismatches} אי-התאמות מול auth.js`);
  return `${tables.length * 2} בדיקות (GET+POST לכל טבלה), כולן תואמות ל-auth.js`;
});

await test('אבטחה: עובד לא יכול PATCH/DELETE רשומת עבודה של עובד אחר', async () => {
  const w1 = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const w2 = workers.find((x) => x['מייל'] && x['מספר דרכון'] && x.id !== w1?.id);
  if (!w1 || !w2) return 'דולג — צריך שני עובדים עם מייל+דרכון';
  const w1Login = await apiAs(null, 'POST', 'worker-login', { email: w1['מייל'], passport: w1['מספר דרכון'] });
  // נוצר עם טוקן הבעלים (לא ניתן ליצור עם טוקן עובד בשם עובד אחר — השרת כופה בעלות על POST)
  const created = await api('POST', enc('עבודות עובדים'), { 'תאריך': '2026-10-06', 'עובד': [w2.id], 'כמות': 1, 'הערות': MARK });
  if (!created?.id) throw new Error('יצירת רשומת הבדיקה נכשלה');
  cleanup.push({ table: 'עבודות עובדים', id: created.id });
  try {
    await apiAs(w1Login.token, 'PATCH', `${enc('עבודות עובדים')}/${created.id}`, { 'כמות': 999 });
    throw new Error('עובד הצליח לעדכן רשומה של עובד אחר!');
  } catch (e) { if (!String(e.message).startsWith('403')) throw e; }
  try {
    await apiAs(w1Login.token, 'DELETE', `${enc('עבודות עובדים')}/${created.id}`);
    throw new Error('עובד הצליח למחוק רשומה של עובד אחר!');
  } catch (e) { if (!String(e.message).startsWith('403')) throw e; }
  return 'PATCH ו-DELETE שניהם נחסמו (403) כנדרש';
});

// ============================================================
// חלק B — ניתוח מסמכי הוצאות → ניהול מלאי אוטומטי (2026-10-06 לילה)
// ------------------------------------------------------------
// בדיקות יחידה טהורות (בלי שום קריאת/כתיבת Airtable) ל-3 המודולים
// החדשים — document-analysis.js (ספק stub דטרמיניסטי כשאין
// ANTHROPIC_API_KEY), inventory-matching.js (התאמה מטושטשת +
// סף ביטחון + יחידות עמומות), inventory-deduction.js (סמן
// אידמפוטנטיות ב"הערות"). רצות תמיד — אין בהן שום סיכון לנתונים
// אמיתיים או לאוטומציית Make, ולכן לא מגודרות מאחורי RUN_UPLOAD_TESTS.
// בדיקת-הקצה-לקצה האמיתית (קובץ מצורף אמיתי בהוצאה) כן מגודרת —
// ר' בסוף הבלוק.
// ============================================================
const buf = (s) => Buffer.from(s, 'utf8');

await test('ניתוח מסמך (stub): זיהוי שורת ניילון ברורה', async () => {
  const r = await analyzeExpenseDocument(buf('הזמנה: 3 גלילי ניילון לחממה'), 'application/pdf', []);
  if (!r.lines.length) throw new Error('לא זוהתה אף שורה');
  if (r.lines[0].confidence < 0.9) throw new Error('ביטחון נמוך מהצפוי');
  return `${r.lines.length} שורות, ביטחון ${r.lines[0].confidence}`;
});

await test('ניתוח מסמך (stub): מסמך בלי שום פריט מלאי רלוונטי (דלק)', async () => {
  const r = await analyzeExpenseDocument(buf('NO_MATCH_ITEM: דלק לטרקטור 200 ליטר'), 'application/pdf', []);
  if (!r.lines.length) throw new Error('הקו של stub לא הופעל כצפוי — בדוק את STUB_RULES');
  // השורה מזוהה (יש "מוצר" במסמך) אבל matchLinesToInventory אמור לסנן אותה — נבדק בהמשך
  return `${r.lines.length} שורות מזוהות (ייבדק שאף אחת לא תתאים למלאי)`;
});

await test('ניתוח מסמך (stub): מסמך דו-קטגורי (קרטון + כובע יחד)', async () => {
  const r = await analyzeExpenseDocument(buf('חשבונית: קרטונים למיון + כובעי הגנה לעובדים'), 'application/pdf', []);
  if (r.lines.length !== 2) throw new Error(`צפויות 2 שורות, התקבלו ${r.lines.length}`);
  return '2 שורות (קרטון + כובע)';
});

await test('ניתוח מסמך (stub): יחידה לא ברורה + ביטחון נמוך', async () => {
  // טקסט בכוונה בלי "ניילון"/"נילו" כדי לא להפעיל גם את הכלל של ניילון
  // בטעות (UNCLEAR_UNIT היא שורת-בדיקה נפרדת ומבודדת)
  const r = await analyzeExpenseDocument(buf('UNCLEAR_UNIT: משקל לא ברור'), 'application/pdf', []);
  if (r.lines.length !== 1) throw new Error(`צפויה שורה אחת בדיוק, התקבלו ${r.lines.length}`);
  if (r.lines[0].confidence >= 0.85) throw new Error('הציפייה הייתה לביטחון נמוך מ-0.85');
  return `ביטחון ${r.lines[0].confidence}, יחידה "${r.lines[0].unit}"`;
});

await test('ניתוח מסמך (stub): אין כלל מילות-מפתח מוכרות', async () => {
  const r = await analyzeExpenseDocument(buf('חשבונית על שירותי ייעוץ חשבונאי'), 'application/pdf', []);
  if (r.lines.length !== 0) throw new Error(`צפוי 0 שורות, התקבלו ${r.lines.length}`);
  return 'lines: [] כצפוי';
});

const FAKE_INVENTORY = [
  { id: 'recFAKE_NYLON', 'קטגוריה': 'נילונים', 'מלאי נוכחי': 100 },
  { id: 'recFAKE_CARTON', 'קטגוריה': 'קרטונים', 'מלאי נוכחי': 200 },
  // ⚠️ בכוונה בלי 'כובעים' — בודק את התרחיש "קטגוריה זוהתה אבל אין לה פריט במלאי"
];

await test('התאמת מלאי: ריבוי עם אות סופית ("ניילונים", בלי מילת-רמז אחרת בתיאור)', () => {
  // מבודד בכוונה — בלי "גליל"/"גלילי" (שגם הם כינוי בפני עצמו) כדי
  // לבדוק באמת את ההתאמה המטושטשת של "ניילון"->"ניילונים", לא התאמה
  // מקרית דרך כינוי אחר (זה בדיוק מה שהסתיר את התקלה המקורית)
  const matches = matchLinesToInventory([{ description: 'ניילונים לבית הרשת', quantity: 3, unit: 'יחידה', confidence: 0.95 }], FAKE_INVENTORY);
  if (matches.length !== 1 || matches[0].item.id !== 'recFAKE_NYLON') throw new Error('לא נמצאה התאמה מטושטשת (אות סופית מול רגילה)');
});

await test('התאמת מלאי: ריבוי נקבה ("יריעות" מול כינוי "יריעה")', () => {
  const matches = matchLinesToInventory([{ description: 'יריעות לחיפוי', quantity: 2, unit: 'יחידה', confidence: 0.95 }], FAKE_INVENTORY);
  if (matches.length !== 1 || matches[0].item.id !== 'recFAKE_NYLON') throw new Error('לא נמצאה התאמה מטושטשת (יריעה/יריעות)');
});

await test('התאמת מלאי: יחידת מידה עמומה (ליטר) חוסמת הורדה אוטומטית', () => {
  const matches = matchLinesToInventory([{ description: 'ניילון 50 ליטר', quantity: 50, unit: 'ליטר', confidence: 0.95 }], FAKE_INVENTORY);
  if (!matches[0]?.needsApproval) throw new Error('ציפייה ל-needsApproval=true ביחידה לא ברורה');
  if (!/יחידת מידה/.test(matches[0].reason || '')) throw new Error('הסיבה לא מזכירה יחידת מידה');
});

await test('התאמת מלאי: ביטחון מתחת לסף 0.85 חוסם הורדה אוטומטית', () => {
  const matches = matchLinesToInventory([{ description: 'קרטונים לאריזה', quantity: 10, unit: 'יחידה', confidence: 0.7 }], FAKE_INVENTORY);
  if (!matches[0]?.needsApproval) throw new Error('ציפייה ל-needsApproval=true בביטחון 0.7');
});

await test('התאמת מלאי: קטגוריה מזוהה אבל אין לה פריט במלאי (כובעים) — לא מדווחת', () => {
  const matches = matchLinesToInventory([{ description: 'כובעי הגנה', quantity: 20, unit: 'יחידה', confidence: 0.95 }], FAKE_INVENTORY);
  if (matches.length !== 0) throw new Error(`צפוי 0 תוצאות (אין פריט "כובעים" במלאי הבדיקה), התקבלו ${matches.length}`);
});

await test('התאמת מלאי: תיאור שלא שייך לאף קטגוריה (דלק) — מסונן לגמרי', () => {
  const matches = matchLinesToInventory([{ description: 'דלק לטרקטור', quantity: 200, unit: 'ליטר', confidence: 0.95 }], FAKE_INVENTORY);
  if (matches.length !== 0) throw new Error(`צפוי 0 תוצאות, התקבלו ${matches.length}`);
});

await test('הורדת מלאי: קריאת סמן [מלאי-AI] מ"הערות" — round-trip ומקרה-קצה', () => {
  const state = { status: 'done', results: [{ description: 'x', deducted: true }] };
  const notes = `הערה ידנית של תמר\n[מלאי-AI]${JSON.stringify(state)}`;
  const parsed = readState(notes);
  if (parsed?.status !== 'done' || parsed.results[0].description !== 'x') throw new Error('הסמן לא נקרא נכון מתוך טקסט עם שורות אחרות');
  if (readState('הערה רגילה בלי שום סמן') !== null) throw new Error('ציפייה ל-null כשאין סמן בכלל');
});

await test('אבטחה: נתיבי /api/expenses/:id/analyze-inventory - owner בלבד', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const results2 = [];
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    try { await apiAs(mLogin.token, 'POST', 'expenses/recFAKE00000001/analyze-inventory'); results2.push('manager POST עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) results2.push(`manager POST שגיאה לא-צפויה: ${e.message}`); }
  }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try { await apiAs(wLogin.token, 'GET', 'expenses/recFAKE00000001/analyze-inventory'); results2.push('worker GET עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) results2.push(`worker GET שגיאה לא-צפויה: ${e.message}`); }
  }
  try { await apiAs(null, 'POST', 'expenses/recFAKE00000001/analyze-inventory'); results2.push('בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) results2.push(`בלי טוקן שגיאה לא-צפויה: ${e.message}`); }
  if (results2.length) throw new Error(results2.join('; '));
  return 'manager/worker נחסמו (403), בלי טוקן נחסם (401)';
});

// ============================================================
// תוספת 2026-10-06 (סעיף H) — שם קובץ עברי שהתעקם ב-multer (mojibake,
// למשל "ª ×�×�…pdf") עקב קידוד latin1 בטעות על מקור UTF-8.
// ר' filename-utils.js. בדיקות טהורות (sync, בלי רשת) — אין להן תלות
// ב-RUN_UPLOAD_TESTS כי הן לא יוצרות שום רשומה ב-Airtable.
// ============================================================
await test('fixFilenameEncoding: מתקן שם קובץ עברי שהתעקם (latin1 במקום utf8)', () => {
  const real = 'בדיקה-עברית.pdf';
  // כך בדיוק נראה req.file.originalname כשmulter מפענח כותרת UTF-8 כ-latin1 —
  // כל בית UTF-8 מקורי הופך לתו-latin1 נפרד.
  const mojibake = Buffer.from(real, 'utf8').toString('latin1');
  const fixed = fixFilenameEncoding(mojibake);
  if (fixed !== real) throw new Error(`התיקון לא החזיר את השם המקורי: קיבלנו ${JSON.stringify(fixed)}`);
});

await test('fixFilenameEncoding: שם קובץ תקין (עברית/אנגלית) לא משתנה', () => {
  const samples = ['invoice-21.pdf', 'בדיקה-עברית.pdf', 'חשבונית 2026.jpg', 'a.pdf'];
  for (const s of samples) {
    const fixed = fixFilenameEncoding(s);
    if (fixed !== s) throw new Error(`שם תקין "${s}" השתנה ל-"${fixed}"`);
  }
});

await test('fixFilenameEncoding: קלט לא-תקין (ריק/undefined) לא קורס', () => {
  if (fixFilenameEncoding('') !== '') throw new Error('מחרוזת ריקה אמורה להישאר ריקה');
  if (fixFilenameEncoding(undefined) !== undefined) throw new Error('undefined אמור להישאר undefined');
  if (fixFilenameEncoding(null) !== null) throw new Error('null אמור להישאר null');
});

await test('הוצאה אמיתית → ניתוח מלאי מקצה-לקצה (קובץ אמיתי, אידמפוטנטי)', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const rec = await createWithFile('הוצאות', 'חשבונית', { 'הערות': MARK });
  const r1 = await api('POST', `expenses/${rec.id}/analyze-inventory`);
  if (r1.status === 'failed' && !/אין קובץ/.test(r1.error || '')) throw new Error(`ניתוח ראשון נכשל: ${r1.error}`);
  const r2 = await api('POST', `expenses/${rec.id}/analyze-inventory`);
  if (JSON.stringify(r1.results) !== JSON.stringify(r2.results)) throw new Error('אידמפוטנטיות נכשלה — ניתוח שני נתן תוצאה שונה');
  return `סטטוס: ${r1.status}, ${(r1.results || []).length} שורות (קובץ אמיתי לא בהכרח מכיל פריטי מלאי — זו בדיקת-צנרת, לא בדיקת-זיהוי)`;
});

await test('הורדת מלאי: החלמה מכשל-באמצע (restart מדומה) ממשיכה בלי הורדה כפולה', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const item = await create('מלאי בסיסי', { 'קטגוריה': await freeInventoryCategory(), 'מלאי נוכחי': 100, 'הערות': MARK });
  const before = Number(item['מלאי נוכחי']);
  const exp = await createWithFile('הוצאות', 'חשבונית', {});
  // קריאה/כתיבה ישירה (import, לא HTTP) מכאן ואילך בכוונה: נמצא בפועל
  // שעיכוב-שכפול קצר של Airtable בין כתיבה מתהליך אחד לקריאה הבאה
  // מבקשת-HTTP נפרדת הופך בדיקת-timing כזו לפלקית (לא קשור ללוגיקה —
  // אומת בנפרד שהלוגיקה עצמה תקינה). קריאה/כתיבה מאותו מופע-SDK לא
  // סובלת מהבעיה הזו.
  const { analyzeExpenseInventory, readState: readState2 } = await import('./inventory-deduction.js');
  const { fetchRecords: dfr, updateRecord: upd } = await import('./airtable.js');
  // ממתינים שהטריגר האוטומטי-אחרי-העלאה (fire-and-forget בשרת, עם
  // backoff פנימי שיכול לקחת עד ~18 שנ' אם ניסיון ראשון לא מצא קובץ)
  // יסיים בפועל לפני שמזריקים state מדומה — אחרת יש מרוץ אמיתי בין
  // שתי כתיבות ל"הערות".
  let settled = false;
  for (let i = 0; i < 20 && !settled; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const cur = (await dfr('הוצאות', {})).find((r) => r.id === exp.id);
    if (readState2(cur?.['הערות'])) settled = true;
  }
  if (!settled) throw new Error('הטריגר האוטומטי לא הסתיים תוך 20 שניות — לא ניתן להמשיך בבדיקה בבטחה');
  // מדמים "נפילה באמצע" — state עם שורה אחת שכבר ירדה (לא לגעת שוב!)
  // ושורה אחת שנכשלה ב-429 מדומה (אמורה להינסות שוב ולהצליח עכשיו)
  const fakeState = {
    status: 'partial', analyzedAt: new Date().toISOString(), supplier: 'QA', date: '2026-10-06',
    results: [
      { description: `${MARK}-already`, quantity: 3, unit: 'יחידה', category: item['קטגוריה'], itemId: item.id, confidence: 0.95, deducted: true, deductedAt: new Date().toISOString() },
      { description: `${MARK}-retry`, quantity: 5, unit: 'יחידה', category: item['קטגוריה'], itemId: item.id, confidence: 0.95, deducted: false, error: 'סימולציה: כשל-באמצע (429)' },
    ],
  };
  await upd('הוצאות', exp.id, { 'הערות': `${MARK}\n[מלאי-AI]${JSON.stringify(fakeState)}` });
  const resumed = await analyzeExpenseInventory(exp.id);
  if (resumed.status !== 'done') throw new Error(`צפוי status:done אחרי החלמה, התקבל ${resumed.status}`);
  const retryLine = resumed.results.find((r) => r.description === `${MARK}-retry`);
  if (!retryLine?.deducted) throw new Error('השורה שנכשלה לא ירדה בניסיון החוזר');
  const afterRec = await api('GET', `${enc('מלאי בסיסי')}/${item.id}`);
  const after = Number(afterRec['מלאי נוכחי']);
  // רק ה-5 של "retry" אמורים לרדת כאן — ה-3 של "already" כבר "ירדו" לפני
  // הבדיקה (לא באמת, זו הזרקת state מדומה) ולכן לא אמורים לרדת שוב
  if (before - after !== 5) throw new Error(`ירידה בפועל ${before - after}, צפוי בדיוק 5 (לא 8 — זה היה אומר הורדה כפולה)`);
  return `ירידה של 5 בדיוק (לא 8) — אין הורדה כפולה לשורה שכבר הושלמה`;
});

// ============================================================
// תוספת 2026-10-06 בבוקר — מסמך הוצאה ידני ("ידני?") + ביטול במחיקה
// ------------------------------------------------------------
// ⚠️ לא בדקתי את createManualExpense מקצה-לקצה (יצירת רשומת "הוצאות"
// אמיתית **בלי קובץ מצורף**) — זו בדיוק התבנית שגרמה לתקרית 2026-09-02
// (רשומה חשופה בטבלה מנוטרת ע"י Make, 3 כשלים רצופים, השבתה אוטומטית
// של התרחיש). השדה "ידני?" קיים מראש ב-Airtable והשם שלו מרמז חזק
// שה-Make automation כבר מסננת/מדלגת על רשומות עם ידני?=true — אבל
// זו הנחה, לא אימות. **לא הרצתי את הבדיקה הזו הלילה** — ר' דוח הבוקר,
// דורש אישור/אימות של תמר לפני שמישהו (אני או היא) יוצר ידנית הוצאה
// בלי קובץ בטבלה האמיתית, גם דרך הטופס החדש.
// בדיקת reverseInventoryDeduction כן רצה (מגודרת) — עם קובץ אמיתי
// (createWithFile, התבנית הבטוחה הקיימת), לא עם רשומה חשופה.
// ============================================================

await test('התאמת מלאי: שורה ידנית (confidence=1) עוברת סף אוטומטית', () => {
  const FAKE = [{ id: 'recFAKE_X', 'קטגוריה': 'נילונים', 'מלאי נוכחי': 50 }];
  const matches = matchLinesToInventory([{ description: 'ניילון לחממה', quantity: 10, unit: 'יחידה', confidence: 1 }], FAKE);
  if (!matches.length || matches[0].needsApproval) throw new Error('שורה ידנית (confidence=1) הייתה אמורה לעבור אוטומטית');
});

await test('הורדת מלאי: ביטול הורדה במחיקת הוצאה (reverseInventoryDeduction), אידמפוטנטי', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const item = await create('מלאי בסיסי', { 'קטגוריה': await freeInventoryCategory(), 'מלאי נוכחי': 100, 'הערות': MARK });
  const before = Number(item['מלאי נוכחי']);
  const exp = await createWithFile('הוצאות', 'חשבונית', {});

  const { reverseInventoryDeduction, readState: readState3 } = await import('./inventory-deduction.js');
  const { fetchRecords: dfr3, updateRecord: upd3 } = await import('./airtable.js');

  let settled = false;
  for (let i = 0; i < 20 && !settled; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const cur = (await dfr3('הוצאות', {})).find((r) => r.id === exp.id);
    if (readState3(cur?.['הערות'])) settled = true;
  }
  if (!settled) throw new Error('הטריגר האוטומטי לא הסתיים — לא ניתן להמשיך בבטחה');

  // מזריקים state עם שורה שכבר "ירדה" (מדמה ניתוח שהוריד 7 יחידות),
  // בלי לגעת במלאי האמיתי דרך API — מדמים רק את ה-state, ואז מבטלים
  const fakeState = {
    status: 'done', analyzedAt: new Date().toISOString(), supplier: 'QA', date: '2026-10-06',
    results: [{ description: `${MARK}-rev`, quantity: 7, unit: 'יחידה', category: item['קטגוריה'], itemId: item.id, confidence: 0.95, deducted: true, deductedAt: new Date().toISOString() }],
  };
  await upd3('הוצאות', exp.id, { 'הערות': `${MARK}\n[מלאי-AI]${JSON.stringify(fakeState)}` });
  // "מורידים" בפועל את המלאי (כאילו הניתוח המדומה באמת קרה) כדי שהביטול יהיה בדיקה אמיתית
  await patch('מלאי בסיסי', item.id, { 'מלאי נוכחי': before - 7 });

  const reversed = await reverseInventoryDeduction(exp.id);
  if (!reversed) throw new Error('reverseInventoryDeduction החזיר null — צפוי state עם שינוי');
  const afterRec = await api('GET', `${enc('מלאי בסיסי')}/${item.id}`);
  if (Number(afterRec['מלאי נוכחי']) !== before) throw new Error(`לא חזר במדויק ל-${before}, התקבל ${afterRec['מלאי נוכחי']}`);

  // ביטול שני (אידמפוטנטיות) — לא אמור לשנות כלום יותר
  const reversedAgain = await reverseInventoryDeduction(exp.id);
  const afterRec2 = await api('GET', `${enc('מלאי בסיסי')}/${item.id}`);
  if (Number(afterRec2['מלאי נוכחי']) !== before) throw new Error('ביטול שני שינה את המלאי שוב — לא אידמפוטנטי');

  return `חזר במדויק ל-${before} אחרי ביטול, ביטול שני לא שינה כלום (${reversedAgain ? 'סומן reversed' : 'no-op'})`;
});

// ============================================================
// תוספת 2026-10-06 (לילה, סעיף J) — ManualExpenseModal: אפשרות לצרף
// קובץ באותו חלון + ולידציית-שרת מלאה (לא רק בלקוח, כי הבקשה יכולה
// לבוא גם ישירות מה-API). שתי בדיקות הוולידציה הראשונות בטוחות
// להרצה תמיד (גם בלי RUN_UPLOAD_TESTS) — הן נדחות ב-400 *לפני*
// שנוצרת רשומה כלשהי (ר' validateManualExpenseInput/createManualExpense
// ב-inventory-deduction.js), כך שאין שום סיכון מול Make.
// הבדיקה השלישית (יצירה מוצלחת) *כן* יוצרת רשומה אמיתית ב"הוצאות" —
// מצורף אליה מהרגע הראשון קובץ אמיתי (REAL_FIXTURE_PATH), בדיוק
// כנדרש בכלל הקבוע. היא מדולגת כברירת מחדל ורצה רק עם
// RUN_UPLOAD_TESTS=1.
// "גם ללא קובץ — עובד כמו קודם" מכוסה חלקית: הנתיב/הוולידציה-ברמת-
// השדות כשאין קובץ זהים לדיוק לקוד שרץ עם קובץ (upload.single('file')
// הוא no-op על בקשת JSON רגילה — ר' הערה ב-server.js), ובדיקות ה-400
// למטה אכן שולחות בלי קובץ. אבל *יצירה מוצלחת בלי קובץ בכלל* בטבלת
// "הוצאות" החיה לא נבדקת כאן בכוונה — זו בדיוק התבנית שגרמה לתקרית
// 2026-09-02 (רשומה חשופה בטבלה מנוטרת ע"י Make), ור' ההערה המתועדת
// למעלה (שורות ~862-869): דורש אישור מפורש של תמר לפני שתיווצר הוצאה
// ידנית בלי קובץ בטבלה האמיתית, גם דרך הבדיקה האוטומטית.
// ============================================================

await test('הוצאה ידנית: שדה חובה חסר (API ישיר) → 400, אין רשומה נוצרת', async () => {
  let threw = null;
  try {
    // חסרים: supplierId, תאריך, סכום, קטגוריה
    await api('POST', 'expenses/manual', {});
  } catch (e) { threw = e; }
  if (!threw) throw new Error('היה צפוי 400 — הבקשה לא נדחתה');
  if (!/^400:/.test(threw.message)) throw threw;
  if (!/חסר שדה חובה/.test(threw.message)) throw new Error(`הודעת השגיאה לא כללה "חסר שדה חובה": ${threw.message}`);
});

// סעיף R (2026-10-07): "ספק" חובה הוא עכשיו supplierId (קישור לרשומת
// ספק קיימת), לא טקסט חופשי — חסר/ריק צריך עדיין 400 נקי בעברית,
// לא 500 ולא כשל שקט. בדיקה זו לא יוצרת שום רשומה (נדחית בוולידציה
// לפני כל כתיבה ל-Airtable) — בטוחה להרצה תמיד, בלי RUN_UPLOAD_TESTS.
await test('הוצאה ידנית: בלי supplierId בכלל → 400 נקי בעברית (לא 500)', async () => {
  let threw = null;
  try {
    await api('POST', 'expenses/manual', { date: today, total: 10, category: MARK });
  } catch (e) { threw = e; }
  if (!threw) throw new Error('היה צפוי 400 — הבקשה לא נדחתה');
  if (!/^400:/.test(threw.message)) throw new Error(`צפוי 400, התקבל: ${threw.message}`);
  if (!/ספק/.test(threw.message)) throw new Error(`הודעת השגיאה לא כללה "ספק": ${threw.message}`);
});

await test('הוצאה ידנית: שורת פריט חלקית (רק "מה נקנה", בלי כמות) → 400, אין רשומה', async () => {
  let threw = null;
  try {
    await api('POST', 'expenses/manual', {
      supplierId: 'recNonExistent000000', date: today, total: 10, category: MARK,
      lines: [{ description: 'שקיות ניילון' }], // חסרה כמות
    });
  } catch (e) { threw = e; }
  if (!threw) throw new Error('היה צפוי 400 — הבקשה לא נדחתה');
  if (!/^400:/.test(threw.message)) throw threw;
  if (!/שורת פריט/.test(threw.message)) throw new Error(`הודעת השגיאה לא כללה "שורת פריט": ${threw.message}`);
});

// עודכן סעיף R (2026-10-07): "ספק" הוא עכשיו supplierId (קישור לרשומת
// ספק קיימת, לא טקסט חופשי) — נוצרת כאן רשומת ספק-בדיקה אמיתית ונבדק
// שגם הקישור ('ספקים') וגם שדה-התאימות-לאחור ('ספק-AI', שם הספק) נכתבים
// נכון. גם שדה "יחידה" הוסר משורות-הפריט (לא נשלח כלל — בדיוק התרחיש
// שהתבקש: "בלי unit בפלט" עדיין 201 + הורדת-מלאי תקינה).
//
// הורדת-המלאי הפכה fire-and-forget (סעיף R, תיקון-ביצועים) — אז בניגוד
// לגרסה הקודמת של הבדיקה הזו, הירידה במלאי לא מובטחת מיד אחרי שה-POST
// חוזר; ממתינים לה ב-polling (אותה תבנית בדיוק כמו הבדיקות למעלה,
// "הורדת מלאי: החלמה מכשל-באמצע"/"ביטול הורדה במחיקת הוצאה").
//
// ⚠️ timing: נמדד כאן זמן התגובה **עם קובץ מצורף** (חייב תמיד קובץ
// אמיתי בטבלה הזו — ר' הערת הכותרת של הקובץ) — לא ניתן לאמת כאן באופן
// בטוח את יעד "<2.5 שניות בלי קובץ" מהמשימה, כי זה ידרוש ליצור רשומת
// הוצאה **בלי שום קובץ** בטבלה החיה המנוטרת ע"י Make, בדיוק התבנית
// שההערה למעלה (סביב השורה ~945, "לא בדקתי את createManualExpense
// מקצה-לקצה... בלי קובץ מצורף") כבר סימנה כדורשת אישור מפורש של תמר
// שעדיין לא ניתן. נשמר כאן רק יעד סביר יותר לנתיב-עם-קובץ (כולל זמן
// העלאת הקובץ עצמו ל-Airtable, שהוא הרכיב האיטי מבין השניים).
// ⚠️ מה הבדיקה הזו **לא** עושה, ולמה (שינוי מהגרסה הראשונה שלה):
// `matchLinesToInventory` מזהה קטגוריה רק דרך מילון-כינויים קבוע של 4
// שמות (ר' CATEGORY_ALIASES ב-inventory-matching.js: נילונים/קרטונים/
// משטחי עץ/כובעים) — `categoryOfDescription` לא יכול להחזיר שום ערך
// אחר, ולכן פריט-מלאי QA (בקטגוריה שרירותית) לעולם לא יתאים לשום שורה.
// המשמעות: אי-אפשר לאמת הורדת-מלאי **אמיתית** מקצה-לקצה בלי לגעת
// בפריט מלאי אמיתי — וזה אסור מפורשות ("אסור לגעת בנתונים אמיתיים").
// לכן הבדיקה הזו מאמתת את מה שסעיף R בפועל שינה — ספק-מקושר, היעדר
// "יחידה", וש-fire-and-forget **באמת רץ** (state נכתב להוצאה ברקע) —
// עם תיאור-QA שלא מתאים לאף קטגוריה, ובנוסף מאמתת מפורשות שאף פריט
// מלאי אמיתי לא השתנה. צינור ההתאמה/ההורדה/הביטול האמיתי מכוסה
// בנפרד: בדיקות-היחידה הטהורות של matchLinesToInventory, והבדיקות
// "הורדת מלאי: החלמה מכשל-באמצע"/"ביטול הורדה במחיקת הוצאה" למעלה
// (שמזריקות state על פריט QA ולא נוגעות בנתונים אמיתיים).
await test('הוצאה ידנית + קובץ אמיתי: supplierId אמיתי מקושר נכון, בלי "יחידה", ההורדה-ברקע רצה (fire-and-forget), ו-0 נגיעה במלאי אמיתי', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const supplier = await create('ספקים', { 'שם ספק': MARK });
  const invBefore = await api('GET', `${enc('מלאי בסיסי')}?raw=1&includeTest=1`);

  const fileBuf = await readFile(REAL_FIXTURE_PATH);
  const fd = new FormData();
  fd.append('file', new Blob([fileBuf], { type: 'application/pdf' }), REAL_FIXTURE_NAME);
  fd.append('supplierId', supplier.id);
  fd.append('date', today);
  fd.append('total', '123');
  fd.append('category', MARK);
  fd.append('lines', JSON.stringify([
    { description: MARK, quantity: 2 }, // בלי unit בכלל; תיאור-QA שלא מתאים לשום קטגוריה אמיתית
    { description: '', quantity: '' }, // שורה ריקה-לגמרי — צפוי להתעלם, לא שגיאה
  ]));
  const t0 = Date.now();
  const rec = await api('POST', 'expenses/manual', fd, true);
  const requestMs = Date.now() - t0;
  if (!rec?.id) throw new Error('לא נוצרה רשומת הוצאה');
  cleanup.push({ table: 'הוצאות', id: rec.id });

  if (rec['ידני?'] !== true) throw new Error('"ידני?" לא סומן true');
  if (!Array.isArray(rec['ספקים']) || rec['ספקים'][0] !== supplier.id) throw new Error(`שדה "ספקים" לא מקושר ל-supplierId שנשלח (${JSON.stringify(rec['ספקים'])})`);
  if (rec['ספק-AI'] !== MARK) throw new Error(`שדה ספק-AI (תאימות-לאחור) לא נכתב משם הספק האמיתי (${rec['ספק-AI']})`);
  if (requestMs > 8000) throw new Error(`התגובה (עם קובץ מצורף) ארכה ${requestMs}ms — חריגה גם מהיעד המקל של הנתיב-עם-קובץ`);

  const full = await api('GET', `${enc('הוצאות')}/${rec.id}?raw=1`);
  if (!Array.isArray(full['חשבונית']) || !full['חשבונית'].length) throw new Error('הקובץ לא מצורף לשדה "חשבונית"');

  // הורדת-המלאי רצה ברקע (fire-and-forget) — ממתינים לה ב-polling על
  // ה-state שנכתב להוצאה עצמה, **לא** על שינוי מלאי: ר' הערת-המסגרת
  // למטה — הבדיקה הזו לא נוגעת בשום פריט מלאי אמיתי.
  let state = null;
  for (let i = 0; i < 20 && !state; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const cur = await api('GET', `${enc('הוצאות')}/${rec.id}?raw=1`);
    state = readState(cur['הערות']);
  }
  if (!state) throw new Error('ההורדה-ברקע (fire-and-forget) לא כתבה state להוצאה תוך 20 שניות — כלומר לא רצה בכלל');
  // השורה הריקה דולגה; השורה היחידה שנשלחה מתועדת ב-state
  if ((state.results || []).length !== 1) throw new Error(`צפויה שורה אחת ב-state (השורה הריקה דולגת), התקבלו ${(state.results || []).length}`);
  const line = state.results[0];
  if (line.deducted) throw new Error('שורת-הבדיקה ירדה בפועל ממלאי — אסור: תיאור-QA לא אמור להתאים לשום קטגוריה אמיתית');

  // ⚠️ אימות-ליבה של הבדיקה הזו: **שום** פריט מלאי אמיתי לא השתנה
  const invAfter = await api('GET', `${enc('מלאי בסיסי')}?raw=1&includeTest=1`);
  const changed = invAfter.filter((a) => {
    const b = invBefore.find((x) => x.id === a.id);
    return b && Number(b['מלאי נוכחי']) !== Number(a['מלאי נוכחי']);
  });
  if (changed.length) throw new Error(`הבדיקה שינתה מלאי אמיתי (אסור): ${changed.map((c) => `${c['קטגוריה']}→${c['מלאי נוכחי']}`).join(', ')}`);

  return `תגובת ה-POST (עם קובץ): ${requestMs}ms · supplierId מקושר + ספק-AI תקין · בלי "יחידה" בפלט · ההורדה-ברקע רצה וכתבה state (${state.status}, שורה אחת, לא ירדה — תיאור-QA) · 0 שינוי בפריטי מלאי אמיתיים`;
});

// ============================================================
// סעיף R (2026-10-07) — stripInventoryAiMarker/withPreservedInventoryTags
// (client/src/utils/inventoryAi.js): בדיקות טהורות (sync, בלי רשת/
// Airtable) — מוודאות שהסמן הפנימי [מלאי-AI]{...} וגם תגית [מלאי-D:...]
// מוסתרים מתצוגה, אבל נשמרים במדויק כשחוזרים לשמור (round-trip).
// ============================================================
await test('stripInventoryAiMarker: ערך שהוא רק סמן/תגית → מחזיר מחרוזת ריקה', () => {
  const onlyMarker = `[מלאי-AI]${JSON.stringify({ status: 'done', results: [] })}`;
  if (stripInventoryAiMarker(onlyMarker) !== '') throw new Error(`צפוי מחרוזת ריקה, התקבל: ${JSON.stringify(stripInventoryAiMarker(onlyMarker))}`);
  const onlyTag = '[מלאי-D:תעודות משלוח:recXXX:קרטונים]';
  if (stripInventoryAiMarker(onlyTag) !== '') throw new Error(`צפוי מחרוזת ריקה (תגית D), התקבל: ${JSON.stringify(stripInventoryAiMarker(onlyTag))}`);
});

await test('stripInventoryAiMarker: טקסט חופשי + סמן → מחזיר רק את הטקסט החופשי', () => {
  const notes = `הערה חופשית של תמר\n[מלאי-AI]${JSON.stringify({ status: 'done', results: [] })}`;
  const out = stripInventoryAiMarker(notes);
  if (out !== 'הערה חופשית של תמר') throw new Error(`צפוי רק הטקסט החופשי, התקבל: ${JSON.stringify(out)}`);
});

await test('stripInventoryAiMarker: בלי שום סמן → לא משתנה', () => {
  const notes = 'הערה רגילה בלי שום דבר פנימי';
  if (stripInventoryAiMarker(notes) !== notes) throw new Error(`הטקסט היה אמור להישאר ללא שינוי, התקבל: ${JSON.stringify(stripInventoryAiMarker(notes))}`);
});

await test('withPreservedInventoryTags: עריכת טקסט חופשי שומרת את הסמן בדיוק כפי שהיה (round-trip)', () => {
  const state = { status: 'done', analyzedAt: '2026-10-07T00:00:00.000Z', results: [] };
  const original = `הערה ישנה\n[מלאי-AI]${JSON.stringify(state)}`;
  // אם לא נגעו בטקסט החופשי בכלל — התוצאה המלאה אמורה לחזור זהה למקור
  const unchanged = withPreservedInventoryTags(original, stripInventoryAiMarker(original));
  if (unchanged !== original) throw new Error(`round-trip בלי שינוי לא חזר זהה: ${JSON.stringify(unchanged)} !== ${JSON.stringify(original)}`);
  // עריכה בפועל של הטקסט החופשי — הסמן נשאר בדיוק אותו דבר, רק הטקסט מוחלף
  const edited = withPreservedInventoryTags(original, 'הערה חדשה שתמר הקלידה');
  if (!edited.includes(`[מלאי-AI]${JSON.stringify(state)}`)) throw new Error(`הסמן לא נשמר בדיוק כפי שהיה: ${edited}`);
  if (!edited.startsWith('הערה חדשה שתמר הקלידה')) throw new Error(`הטקסט החדש לא מופיע בתחילת הערך: ${edited}`);
});

// ============================================================
// אבטחה (ליל-בדיקות 2026-10-06, M2.8): /api/expenses/manual — owner בלבד.
// לא יוצרת שום רשומה — requireOwner חוסם manager/worker לפני שהבקשה
// מגיעה בכלל ל-handler (ולידציה/יצירה), כך שבדיקת 403 בטוחה בלי קובץ/body.
// ============================================================
await test('אבטחה: POST /api/expenses/manual — owner בלבד', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const problems = [];
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    try { await apiAs(mLogin.token, 'POST', 'expenses/manual', {}); problems.push('manager עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`manager שגיאה לא-צפויה: ${e.message}`); }
  }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try { await apiAs(wLogin.token, 'POST', 'expenses/manual', {}); problems.push('worker עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`worker שגיאה לא-צפויה: ${e.message}`); }
  }
  try { await apiAs(null, 'POST', 'expenses/manual', {}); problems.push('בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) problems.push(`בלי טוקן שגיאה לא-צפויה: ${e.message}`); }
  if (problems.length) throw new Error(problems.join('; '));
  return 'manager/worker נחסמו (403), בלי טוקן נחסם (401)';
});

// ============================================================
// תוספת 2026-10-06 — הורדת מלאי נגזרת מתעודת משלוח/חשבונית (סעיף D)
// בדיקות על הפונקציות הטהורות (deriveDeductions/computeDeviation/
// findCounterpart) בלי שום כתיבה ל-Airtable — אין צורך ליצור רשומות
// אמיתיות בטבלאות המנוטרות ע"י Make כדי לבדוק את הלוגיקה הזו, כי
// היא רק קוראת שדות קיימים ומחשבת, לא קוראת לשום AI.
// ============================================================

await test('הורדה נגזרת: תעודה+חשבונית תואמות (קרטונים זהים) → אין חריגה, 4 קטגוריות', () => {
  const note = { id: 'recN1', 'קוד שבוע': 'W1', 'כמות קרטונים': '100', 'מספר תעודה': 1 };
  const invoice = { id: 'recI1', 'קוד שבוע': 'W1', 'כמות קרטונים': '100', 'מספר משטחים': '5', 'מספר חשבונית': 1 };
  const { cartonsCrossCheck, deductions } = deriveDeductions({ note, invoice });
  if (!cartonsCrossCheck.ok) throw new Error('קרטונים זהים — ההצלבה הייתה אמורה לעבור');
  const byCategory = Object.fromEntries(deductions.map((d) => [d.category, d]));
  if (byCategory['קרטונים'].quantity !== 100) throw new Error('קרטונים: צפויה 100');
  if (byCategory['נילונים'].quantity !== 100) throw new Error('נילונים: צפוי מקדם 1:1 = 100');
  if (byCategory['כובעים'].quantity !== 100) throw new Error('כובעים: צפוי מקדם 1:1 = 100');
  if (byCategory['משטחי עץ'].quantity !== 5) throw new Error('משטחים: צפוי ישיר מהחשבונית = 5');
  if (deductions.some((d) => d.needsApproval)) throw new Error('אין סטייה — שום קטגוריה לא אמורה לדרוש אישור');
  return `4 קטגוריות נגזרו נכון, הצלבה עברה (${(cartonsCrossCheck.deviation * 100).toFixed(1)}% סטייה)`;
});

// ============================================================
// תוספת 2026-10-06 (אחה"צ) — ממצא-אמת מול Airtable חי: סטייה מעל הסף
// לא אמורה לחסום קרטונים/נילונים/כובעים (התעודה היא עדות ישירה לכמות
// שיצאה פיזית — מורידים, רק מסמנים אזהרה).
// עודכן 2026-10-07 (סעיף N1, הוראת תמר): גם משטחי-עץ **לא** נחסמים
// יותר — יורדים תמיד מהחשבונית, ורק מתועדת אי-התאמה בהערה (עם הפניה
// למספרי המסמכים), בלי needsApproval.
// ============================================================
await test(`הורדה נגזרת: סטייה מעל הסף (${(DEVIATION_THRESHOLD * 100)}%) → כל הקטגוריות (כולל משטחים) יורדות עם ציון אי-התאמה, בלי חסימה`, () => {
  const note = { id: 'recN2', 'קוד שבוע': 'W2', 'כמות קרטונים': '100', 'מספר תעודה': 2 };
  const invoice = { id: 'recI2', 'קוד שבוע': 'W2', 'כמות קרטונים': '140', 'מספר משטחים': '5', 'מספר חשבונית': 2 }; // 28.5% סטייה
  const { cartonsCrossCheck, deductions } = deriveDeductions({ note, invoice, weekNoteNumbers: [2] });
  if (cartonsCrossCheck.ok) throw new Error('סטייה גדולה — ההצלבה לא הייתה אמורה לעבור');
  const byCategory = Object.fromEntries(deductions.map((d) => [d.category, d]));
  for (const cat of ['קרטונים', 'נילונים', 'כובעים']) {
    if (byCategory[cat].needsApproval) throw new Error(`${cat}: לא אמור לדרוש אישור — התעודה מוסמכת להוריד בכל מקרה`);
    if (!byCategory[cat].reason || !byCategory[cat].reason.includes('%')) throw new Error(`${cat}: חייב להכיל אזהרת-סטייה עם האחוז`);
  }
  if (byCategory['משטחי עץ'].needsApproval) throw new Error('משטחים: לא אמורים לדרוש אישור יותר (N1) — צריכים לרדת בכל מקרה');
  if (byCategory['משטחי עץ'].quantity !== 5) throw new Error('משטחים: הכמות אמורה לרדת בכל מקרה, כולל בסטייה');
  if (!byCategory['משטחי עץ'].mismatchNote || !byCategory['משטחי עץ'].mismatchNote.includes('חשבונית #2') || !byCategory['משטחי עץ'].mismatchNote.includes('תעודות #2')) {
    throw new Error(`משטחים: mismatchNote חייב להפנות לחשבונית ולתעודה, התקבל: ${byCategory['משטחי עץ'].mismatchNote}`);
  }
  return `סטייה ${(cartonsCrossCheck.deviation * 100).toFixed(1)}% זוהתה: כל 4 הקטגוריות ירדו, משטחים עם הערת-אי-התאמה מפורטת`;
});

await test('הורדה נגזרת: רק תעודה קיימת (אין חשבונית מקבילה לשבוע) → נגזר עם אזהרת "בלי הצלבה", לא חוסם', () => {
  const note = { id: 'recN3', 'קוד שבוע': 'W3', 'כמות קרטונים': '50', 'מספר תעודה': 3 };
  const { cartonsCrossCheck, deductions } = deriveDeductions({ note, invoice: null });
  if (cartonsCrossCheck) throw new Error('בלי חשבונית מקבילה — אין מה להצליב, cartonsCrossCheck צפוי null');
  if (deductions.some((d) => d.needsApproval)) throw new Error('בלי מסמך מקביל זו אזהרה רכה, לא חסימה');
  if (!deductions.every((d) => d.softWarning)) throw new Error('כל השורות צפויות softWarning=true (בלי הצלבה)');
  if (deductions.find((d) => d.category === 'משטחי עץ')) throw new Error('בלי חשבונית — אין "מספר משטחים" לגזור ממנו');
  return `3 קטגוריות (קרטונים/נילונים/כובעים) נגזרו עם אזהרה רכה, בלי חסימה`;
});

await test('הורדה נגזרת: שדה "כמות קרטונים"/"מספר משטחים" ריק עדיין (Make לא סיים) → pending, לא skipped סתמי, בלי קטגוריה', () => {
  const note = { id: 'recN4', 'קוד שבוע': 'W4', 'מספר תעודה': 4 }; // אין "כמות קרטונים" בכלל
  const invoice = { id: 'recI4', 'קוד שבוע': 'W4', 'כמות קרטונים': '', 'מספר משטחים': '0', 'מספר חשבונית': 4 }; // ריק/0
  const { deductions } = deriveDeductions({ note, invoice });
  if (deductions.length !== 2) throw new Error(`צפויות 2 שורות pending (תעודה+חשבונית), התקבלו ${deductions.length}`);
  if (!deductions.every((d) => d.pending)) throw new Error('כל השורות צפויות pending=true כש"כמות קרטונים"/"מספר משטחים" עדיין ריקים');
  if (deductions.some((d) => d.category)) throw new Error('שורת pending לא אמורה לכלול category (אין קטגוריה לגזור כל עוד אין נתון)');
  return 'שני הצדדים (תעודה+חשבונית) חזרו pending בלי קטגוריה, כצפוי';
});

// ============================================================
// תוספת 2026-10-06 (אחה"צ) — הצלבה שבועית: ממצא-אמת מהיום (4 תעודות
// אמיתיות של תמר באותו שבוע 20260926-20261001, 328+450+328+450=1556
// קרטונים, מול חשבונית #61 עם 1648 קרטונים — 5.6% סטייה). בלי אגרגציה
// שבועית, תעודה בודדת מול חשבונית-שבועית-מלאה "נכשלת" בהצלבה באופן
// מובנה גם כששום דבר לא שגוי (328 מול 1648 = 80% סטייה!).
// ============================================================
await test('הורדה נגזרת: הצלבה שבועית מצליבה את סכום כל תעודות השבוע מול החשבונית, לא תעודה בודדת', () => {
  const note1 = { id: 'recN5a', 'קוד שבוע': 'W5', 'כמות קרטונים': '328', 'מספר תעודה': 44 };
  const invoice = { id: 'recI5', 'קוד שבוע': 'W5', 'כמות קרטונים': '1648', 'מספר משטחים': '27', 'מספר חשבונית': 61 };
  // בלי אגרגציה שבועית (ברירת מחדל זוג-בודד) — 328 מול 1648 נכשל קשות
  const single = deriveDeductions({ note: note1, invoice });
  if (single.cartonsCrossCheck.ok) throw new Error('בדיקת-יסוד: 328 מול 1648 חייב להיכשל כזוג בודד (ממחיש למה האגרגציה דרושה)');
  // עם אגרגציה שבועית (סכום 4 התעודות של השבוע, כמו שהיה בפועל היום) — 5.6% בלבד
  const weekTotal = 328 + 450 + 328 + 450; // 1556 — סכום 4 התעודות האמיתיות
  const agg = deriveDeductions({ note: note1, invoice, weekNoteCartonsTotal: weekTotal, weekInvoiceCartonsTotal: 1648 });
  const dev = agg.cartonsCrossCheck.deviation;
  if (Math.abs(dev - Math.abs(weekTotal - 1648) / 1648) > 1e-9) throw new Error('הסטייה צפויה להיות מחושבת מהסכומים השבועיים, לא מהזוג הבודד');
  if (dev <= DEVIATION_THRESHOLD) throw new Error(`הסטייה בפועל (${(dev * 100).toFixed(1)}%) צפויה להיות מעל הסף — זה המקרה האמיתי מהיום`);
  const byCategory = Object.fromEntries(agg.deductions.map((d) => [d.category, d]));
  if (byCategory['קרטונים'].quantity !== 328) throw new Error('קרטונים: עדיין נגזר מהתעודה הבודדת (328), לא מהסכום השבועי');
  if (byCategory['קרטונים'].needsApproval) throw new Error('קרטונים לא אמורים להיחסם גם בסטייה שבועית אמיתית (5.6%)');
  // N1 (2026-10-07): משטחים לא נחסמים יותר — יורדים עם ציון אי-התאמה (זה בדיוק המקרה האמיתי של חשבונית #61)
  if (byCategory['משטחי עץ'].needsApproval) throw new Error('משטחים לא אמורים להיחסם יותר (N1) — צריכים לרדת 27 עם הערת אי-התאמה');
  if (byCategory['משטחי עץ'].quantity !== 27) throw new Error('משטחים: 27 אמור לרדת בכל מקרה (מספר משטחים מהחשבונית)');
  if (!byCategory['משטחי עץ'].mismatchNote?.includes('5.6%')) throw new Error(`משטחים: mismatchNote חייב לציין את אחוז-הסטייה המדויק, התקבל: ${byCategory['משטחי עץ'].mismatchNote}`);
  return `זוג-בודד: ${(single.cartonsCrossCheck.deviation * 100).toFixed(0)}% (שגוי), אגרגציה שבועית: ${(dev * 100).toFixed(1)}% (נכון, כמו הנתון האמיתי מהיום) — משטחים ירדו 27 עם הערת-אי-התאמה (N1)`;
});

await test('findCounterpart: מוצא רשומה תואמת-שבוע בדיוק, לא מתאים שבוע שונה', () => {
  const invoices = [{ id: 'a', 'קוד שבוע': 'W1' }, { id: 'b', 'קוד שבוע': 'W2' }];
  if (findCounterpart('W2', invoices)?.id !== 'b') throw new Error('היה צפוי להתאים ל-W2');
  if (findCounterpart('W9', invoices) !== null) throw new Error('שבוע לא קיים צפוי null');
});

await test('computeDeviation: סימטרי ומחושב כאחוז מהערך הגדול', () => {
  if (Math.abs(computeDeviation(100, 100)) > 1e-9) throw new Error('זהים → סטייה 0');
  if (Math.abs(computeDeviation(100, 110) - computeDeviation(110, 100)) > 1e-9) throw new Error('צפוי סימטרי');
  if (computeDeviation(null, 100) !== null) throw new Error('ערך חסר → null (לא ניתן להצליב)');
});

// ============================================================
// תוספת 2026-10-06 לילה 2 (M2.2#7 + M3) — planLogisticsReversal: פונקציה
// טהורה, פענוח-בלבד, בלי קריאה/כתיבה ל-Airtable (ר' reverseLogisticsDeduction
// ב-logistics-deduction.js). נוספה כי מחיקת תעודת-משלוח/חשבונית לא
// החזירה עד כה שום דבר למלאי — אומת בפועל בביקורת-קוד שה-route DELETE
// הקיים קרא ל-reverseInventoryDeduction רק לטבלת 'הוצאות'. בדיקת-יחידה
// טהורה בלבד (לא נגד שרת חי) — ר' גם תקרית-פיתוח: הגרסה הראשונה של
// בדיקת האידמפוטנטיות כאן נכשלה בפועל (notes.includes(`↩ ${tag}`) לא
// תאם את הפורמט האמיתי של שורת-הביטול, שיש בה טקסט בין החץ לתגית) —
// זה מה שגילה וגרם לתיקון התאמת-התגית בקוד עצמו, לפני שהגיע לפרודקשן.
// ============================================================
await test('ביטול הורדה-לוגיסטית (תוכנית): שורת-הורדה אחת לא-מבוטלת → תוכנית עם הכמות המדויקת שנרשמה', () => {
  const items = [{ id: 'recItem1', 'קטגוריה': 'קרטונים', 'מלאי נוכחי': 100, 'הערות': '↓ 450 ממלאי: קרטונים (תעודה #45, שבוע 20260727-20260801) [מלאי-D:תעודות משלוח:recSRC:קרטונים]' }];
  const plan = planLogisticsReversal(items, 'תעודות משלוח', 'recSRC');
  if (plan.length !== 1) throw new Error(`צפוי פריט אחד בתוכנית, התקבלו ${plan.length}`);
  if (plan[0].totalBack !== 450) throw new Error(`צפוי להחזיר 450, התקבל ${plan[0].totalBack}`);
  if (plan[0].currentStock !== 100) throw new Error('מלאי נוכחי לא נקרא נכון מהפריט');
});

await test('ביטול הורדה-לוגיסטית (תוכנית): אידמפוטנטי — שורת "↩" קיימת לאותה תגית → אין תוכנית', () => {
  const items = [{ id: 'recItem2', 'קטגוריה': 'קרטונים', 'מלאי נוכחי': 550, 'הערות': '↓ 450 ממלאי: קרטונים (x) [מלאי-D:תעודות משלוח:recSRC2:קרטונים]\n↩ ביטול הורדה של 450 · תעודות משלוח recSRC2 נמחק · 2026-10-06 [מלאי-D:תעודות משלוח:recSRC2:קרטונים]' }];
  const plan = planLogisticsReversal(items, 'תעודות משלוח', 'recSRC2');
  if (plan.length !== 0) throw new Error(`צפוי אין-תוכנית (כבר בוטל), התקבלו ${plan.length} פריטים`);
});

await test('ביטול הורדה-לוגיסטית (תוכנית): שלוש קטגוריות מתעודה אחת (קרטונים/נילונים/כובעים), פריטים שונים — כל אחד מסתכם בנפרד', () => {
  const items = [
    { id: 'recA', 'קטגוריה': 'קרטונים', 'מלאי נוכחי': 10, 'הערות': '↓ 50 ממלאי: קרטונים (x) [מלאי-D:תעודות משלוח:recSRC3:קרטונים]' },
    { id: 'recB', 'קטגוריה': 'נילונים', 'מלאי נוכחי': 20, 'הערות': '↓ 50 ממלאי: נילונים (x) [מלאי-D:תעודות משלוח:recSRC3:נילונים]' },
    { id: 'recC', 'קטגוריה': 'כובעים', 'מלאי נוכחי': 30, 'הערות': '↓ 50 ממלאי: כובעים (x) [מלאי-D:תעודות משלוח:recSRC3:כובעים]' },
  ];
  const plan = planLogisticsReversal(items, 'תעודות משלוח', 'recSRC3');
  if (plan.length !== 3) throw new Error(`צפויים 3 פריטים בתוכנית, התקבלו ${plan.length}`);
  for (const id of ['recA', 'recB', 'recC']) {
    if (plan.find((p) => p.itemId === id)?.totalBack !== 50) throw new Error(`פריט ${id}: צפויה החזרה של 50`);
  }
});

await test('ביטול הורדה-לוגיסטית (תוכנית): תגית של מסמך-מקור אחר (sourceId שונה) — לא נוגע בפריט', () => {
  const items = [{ id: 'recD', 'קטגוריה': 'קרטונים', 'מלאי נוכחי': 10, 'הערות': '↓ 50 ממלאי: קרטונים (x) [מלאי-D:תעודות משלוח:recOTHER:קרטונים]' }];
  const plan = planLogisticsReversal(items, 'תעודות משלוח', 'recSRC4');
  if (plan.length !== 0) throw new Error(`תגית של מסמך אחר לא הייתה אמורה להתאים, התקבלו ${plan.length} פריטים`);
});

await test('ביטול הורדה-לוגיסטית (תוכנית): שורת "דורש אישור" בלבד (בלי תגית [מלאי-D:...]) — לא מטופלת כהורדה-לביטול', () => {
  const items = [{ id: 'recE', 'קטגוריה': 'משטחי עץ', 'מלאי נוכחי': 10, 'הערות': '⚠ דורש אישור: 27 משטחי עץ (חשבונית #61, שבוע 20260926-20261001) — סטייה 5.58%' }];
  const plan = planLogisticsReversal(items, 'חשבוניות', 'recINV61');
  if (plan.length !== 0) throw new Error(`שורת-אזהרה בלי תגית [מלאי-D:...] לא הייתה אמורה להיחשב כהורדה לביטול, התקבלו ${plan.length}`);
});

// ============================================================
// אבטחה (ליל-בדיקות 2026-10-06, M2.8): לוגיסטיקה (/api/logistics/...).
// analyze-inventory (POST) — owner בלבד, בודקים עם רשומה פיקטיבית
// (recFAKE...) כי requireOwner חוסם לפני שה-handler בכלל מנסה לקרוא
// אותה. status (GET) — authenticate בלבד בכוונה (מטא-דאטה על מצב
// עיבוד, לא מידע פיננסי — ר' ההערה ב-server.js מעל ה-route), אז
// manager/worker *אמורים* לעבור, רק בלי טוקן נחסם.
// ============================================================
await test('אבטחה: POST /api/logistics/:table/:id/analyze-inventory — owner בלבד', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const target = `logistics/${enc('חשבוניות')}/recFAKE00000001/analyze-inventory`;
  const problems = [];
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    try { await apiAs(mLogin.token, 'POST', target); problems.push('manager עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`manager שגיאה לא-צפויה: ${e.message}`); }
  }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try { await apiAs(wLogin.token, 'POST', target); problems.push('worker עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`worker שגיאה לא-צפויה: ${e.message}`); }
  }
  try { await apiAs(null, 'POST', target); problems.push('בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) problems.push(`בלי טוקן שגיאה לא-צפויה: ${e.message}`); }
  if (problems.length) throw new Error(problems.join('; '));
  return 'manager/worker נחסמו (403), בלי טוקן נחסם (401)';
});

await test('אבטחה: GET /api/logistics/:table/status — authenticate בלבד (לא owner), בלי טוקן נחסם', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const path = `logistics/${enc('חשבוניות')}/status`;
  try { await apiAs(null, 'GET', path); throw new Error('בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) throw e; }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    const res = await apiAs(wLogin.token, 'GET', path); // מטא-דאטה בלבד — עובד מורשה לקרוא
    if (typeof res !== 'object') throw new Error('תגובה לא צפויה לעובד');
  }
  return 'בלי טוקן נחסם (401), עובד עם טוקן תקין קורא בהצלחה (מטא-דאטה, לא כספים)';
});

// ============================================================
// אבטחה (ליל-בדיקות 2026-10-06, M2.8): /api/weekly/sync — GET תמיד
// dryRun ופתוח לכל מחובר (authenticate בלבד); POST (הכתיבה בפועל)
// owner בלבד. משתמשים כאן רק ב-dryRun=1 כך שאפילו אם ההרשאה הייתה
// שבורה, שום דבר לא היה נכתב ל-Airtable מהבדיקה הזו עצמה.
// ============================================================
await test('אבטחה: /api/weekly/sync — GET פתוח לכל מחובר, POST owner בלבד', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const problems = [];
  try { await apiAs(null, 'GET', 'weekly/sync'); problems.push('GET בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) problems.push(`GET בלי טוקן שגיאה לא-צפויה: ${e.message}`); }
  try { await apiAs(null, 'POST', 'weekly/sync?dryRun=1'); problems.push('POST בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) problems.push(`POST בלי טוקן שגיאה לא-צפויה: ${e.message}`); }
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    const getRes = await apiAs(mLogin.token, 'GET', 'weekly/sync');
    if (getRes?.dryRun !== true) problems.push('GET עם מנהל-עבודה לא חזר dryRun=true');
    try { await apiAs(mLogin.token, 'POST', 'weekly/sync?dryRun=1'); problems.push('POST מנהל-עבודה עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`POST מנהל-עבודה שגיאה לא-צפויה: ${e.message}`); }
  }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try { await apiAs(wLogin.token, 'POST', 'weekly/sync?dryRun=1'); problems.push('POST עובד עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`POST עובד שגיאה לא-צפויה: ${e.message}`); }
  }
  if (problems.length) throw new Error(problems.join('; '));
  return 'GET פתוח (dryRun=true) למחובר, POST חסום ל-403 למי שאינו owner, 401 בלי טוקן';
});

// ============================================================
// אבטחה (ליל-בדיקות 2026-10-06, M2.8): /api/suppliers/auto-link —
// owner בלבד גם ל-GET (בניגוד ל-weekly/sync!) כי זה חושף טקסט-AI
// פיננסי (ספק-AI/משווק-AI) מהוצאות/צ'קים/חשבוניות/תעודות משלוח.
// ============================================================
await test('אבטחה: /api/suppliers/auto-link — owner בלבד (GET וגם POST)', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const problems = [];
  try { await apiAs(null, 'GET', 'suppliers/auto-link'); problems.push('GET בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) problems.push(`GET בלי טוקן שגיאה לא-צפויה: ${e.message}`); }
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    try { await apiAs(mLogin.token, 'GET', 'suppliers/auto-link'); problems.push('GET מנהל-עבודה עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`GET מנהל-עבודה שגיאה לא-צפויה: ${e.message}`); }
    try { await apiAs(mLogin.token, 'POST', 'suppliers/auto-link?dryRun=1'); problems.push('POST מנהל-עבודה עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`POST מנהל-עבודה שגיאה לא-צפויה: ${e.message}`); }
  }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try { await apiAs(wLogin.token, 'GET', 'suppliers/auto-link'); problems.push('GET עובד עבר - לא תקין!'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`GET עובד שגיאה לא-צפויה: ${e.message}`); }
  }
  if (problems.length) throw new Error(problems.join('; '));
  return 'owner-only נאכף בפועל גם על GET וגם על POST';
});

// ============================================================
// אבטחה (ליל-בדיקות 2026-10-06, M2.8): /api/plans/:id/forecast-preflight —
// authenticate בלבד (לא owner) בכוונה: בדיקת-מוכנות read-only, לא מידע
// כספים. בלי טוקן → 401; עם טוקן עובד/מנהל-עבודה → 200 (לא 403).
// ============================================================
await test('אבטחה: GET /api/plans/:id/forecast-preflight — authenticate בלבד, פתוח לכל תפקיד', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const path = 'plans/recNONEXISTENT00000000/forecast-preflight';
  try { await apiAs(null, 'GET', path); throw new Error('בלי טוקן עבר - לא תקין!'); }
  catch (e) { if (!String(e.message).startsWith('401')) throw e; }
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    const res = await apiAs(wLogin.token, 'GET', path);
    if (res?.ok !== false) throw new Error('עובד לא קיבל תגובה תקינה (ok=false לתוכנית לא-קיימת)');
  }
  return 'בלי טוקן נחסם (401), עובד עם טוקן תקין רואה preflight (לא 403)';
});

// ============================================================
// תוספת 2026-10-06 — סנכרון "סיכום שבועי" (סעיף D): weekCodeFromDate
// בלבד, פונקציה טהורה בלי שום קריאה ל-Airtable. הקודים הצפויים
// אומתו ישירות מול רשומות אמיתיות בחשבוניות/תעודות משלוח (ר' תיעוד
// ב-weekly-sync.js) — לא מהמרים על הפורמט.
// sweep()/ensureWeekRecord() *לא* נבדקים כאן (כותבים ל-Airtable) —
// הורצו בדיקת dry-run ידנית מול הנתונים האמיתיים לפני מיזוג, ר' דוח
// ההתקדמות; ההרצה האמיתית (dryRun=false) ממתינה לאישור אחרי מיזוג.
// ============================================================
await test('weekCodeFromDate: תאריכים אמיתיים מחשבוניות/תעודות משלוח (שבת–חמישי)', () => {
  const cases = [
    ['2026-08-22', '20260822-20260827'], // שבת — תחילת שבוע
    ['2026-08-27', '20260822-20260827'], // חמישי — סוף אותו שבוע
    ['2026-08-28', '20260822-20260827'], // שישי (תאריך מסמך אמיתי) — עדיין השבוע שהסתיים
    ['2026-09-12', '20260912-20260917'],
    ['2026-09-13', '20260912-20260917'], // ראשון
    ['2026-09-05', '20260905-20260910'],
    ['2026-09-09', '20260905-20260910'], // רביעי
  ];
  for (const [input, expected] of cases) {
    const got = weekCodeFromDate(input);
    if (got !== expected) throw new Error(`${input} → "${got}", צפוי "${expected}"`);
    if (!WEEK_CODE_RE.test(got)) throw new Error(`"${got}" לא תואם את הפורמט YYYYMMDD-YYYYMMDD`);
  }
  return `${cases.length} תאריכים (כולל יום שישי) תואמים בדיוק לקודים האמיתיים`;
});

await test('weekCodeFromDate: קלט לא תקין → null, בלי לזרוק', () => {
  if (weekCodeFromDate('not-a-date') !== null) throw new Error('מחרוזת לא-תאריך צפויה null');
  if (weekCodeFromDate(null) !== null) throw new Error('null צפוי null');
  if (weekCodeFromDate(undefined) !== null) throw new Error('undefined צפוי null');
  if (weekCodeFromDate(new Date('invalid')) !== null) throw new Error('Date לא תקין צפוי null');
});

// ============================================================
// קישור ספקים/משווקים אוטומטי (סעיף C, 2026-10-06) — ר' supplier-linking.js.
// כל הבדיקות כאן טהורות-לוגיקה (מערכים מפוברקים ב-RAM, אין קריאת/כתיבת
// Airtable בכלל) בכוונה: /api/suppliers/auto-link יכול ליצור/לעדכן
// רשומות ספק/משווק אמיתיות כשהוא לא ב-dryRun, ואין לבדוק את זה כאן
// נגד השרת החי. ר' הערת הבטיחות בתדריך המשימה (2026-10-06, סעיף C).
// ============================================================
await test('normalizeName: מתעלם מסיומת חברה/גרשיים/פיסוק/רווחים', () => {
  if (normalizeName('ל.ש. שיווק תוצרת חקלאית בע"מ') !== normalizeName('ל ש שיווק תוצרת חקלאית')) {
    throw new Error('נרמול לא עקבי בין צורות כתיב שונות');
  }
  if (normalizeName('  ABC  Ltd.  ') !== 'abc') throw new Error('סיומת חברה/רווחים לא הוסרו');
});

await test('matchEntity: התאמה מדויקת מקבלת ביטחון 1.0, שם ריק מתעלם', () => {
  const candidates = [{ id: 's1', 'שם ספק': 'דוד ירקות' }, { id: 's2', 'שם ספק': '' }];
  const m = matchEntity('דוד ירקות', candidates, 'שם ספק');
  if (!m || m.candidate.id !== 's1' || m.confidence !== 1.0) throw new Error('התאמה מדויקת לא זוהתה כצפוי');
});

await test('planLink: בלי התאמה ממלא רשומה קיימת בלי שם (לא יוצר כפולה)', () => {
  const candidates = [{ id: 's1', 'שם ספק': 'דוד ירקות' }, { id: 'm1', 'שם ספק': '' }];
  const plan = planLink('ל.ש. שיווק תוצרת חקלאית', candidates, 'שם ספק');
  if (plan?.kind !== 'fill' || plan.targetId !== 'm1') throw new Error('צפוי kind=fill על הרשומה הקיימת בלי שם');
});

await test('planLink: בלי התאמה ובלי רשומה-בלי-שם מציע יצירה חדשה', () => {
  const plan = planLink('חברה חדשה שלא קיימת', [{ id: 's1', 'שם ספק': 'דוד ירקות' }], 'שם ספק');
  if (plan?.kind !== 'create' || plan.newName !== 'חברה חדשה שלא קיימת') throw new Error('צפוי kind=create');
  if (planLink('   ', [], 'שם ספק') !== null) throw new Error('טקסט ריק צפוי להחזיר null');
});

await test('planCheckSupplier: ירושת ספק מהוצאה מקושרת גוברת על "מוטב"', () => {
  const suppliers = [{ id: 's1', 'שם ספק': 'דוד ירקות' }];
  const expensesById = new Map([['e1', { id: 'e1', 'ספקים': ['s1'] }]]);
  const plan = planCheckSupplier({ id: 'c1', 'הוצאות': ['e1'], 'מוטב': 'מישהו אחר' }, suppliers, expensesById);
  if (plan?.kind !== 'link' || plan.targetId !== 's1' || plan.confidence !== 1.0) throw new Error('צפוי קישור דרך ההוצאה, ביטחון 1.0');
});

await test('computeSuggestions: ארבע הקבוצות (הוצאות/צ\'קים/חשבוניות/תעודות) מחושבות נכון', () => {
  const suppliers = [{ id: 's1', 'שם ספק': 'דוד ירקות' }];
  const marketers = [{ id: 'm1', 'שם משווק': '' }]; // ממצא אמיתי: רשומת משווק אחת בלי שם
  const expenses = [
    { id: 'e2', 'ספק-AI': 'דוד ירקות', 'ספקים': [] },
    { id: 'e3', 'ספק-AI': '', 'ספקים': [] }, // בלי טקסט — לא נכנס לרשימה
  ];
  const checks = [{ id: 'c3', 'מוטב': 'דוד ירקות', 'ספקים': [] }];
  const invoices = [{ id: 'i1', 'משווק-AI': 'ל.ש. שיווק תוצרת חקלאית', 'משווק': [] }];
  const deliveryNotes = [{ id: 'd1', 'משווק-AI': 'ל.ש. שיווק תוצרת חקלאית', 'משווק': [] }];
  const sug = computeSuggestions({ suppliers, marketers, expenses, checks, invoices, deliveryNotes });
  if (sug.expenses.length !== 1 || sug.expenses[0].plan?.kind !== 'link') throw new Error('הוצאה עם ספק-AI ריק לא אמורה להיכלל, והקיימת צפויה kind=link');
  if (sug.checks.length !== 1 || sug.checks[0].plan?.kind !== 'link') throw new Error('צ\'ק צפוי kind=link לפי "מוטב"');
  if (sug.invoices[0].plan?.kind !== 'fill' || sug.invoices[0].plan.targetId !== 'm1') throw new Error('חשבונית צפויה kind=fill על המשווק הקיים בלי שם');
  if (sug.deliveryNotes[0].plan?.kind !== 'fill' || sug.deliveryNotes[0].plan.targetId !== 'm1') throw new Error('תעודת משלוח צפויה kind=fill על המשווק הקיים בלי שם');
  const summary = summarizeSuggestions(sug, 'willApply');
  if (summary.expenses.willApply !== 1 || summary.invoices.willApply !== 1 || summary.deliveryNotes.willApply !== 1) {
    throw new Error('סיכום willApply שגוי');
  }
  if (AUTO_THRESHOLD !== 0.9) throw new Error('AUTO_THRESHOLD השתנה בלי כוונה');
  return `${sug.expenses.length} הוצאות, ${sug.checks.length} צ'קים, ${sug.invoices.length} חשבוניות, ${sug.deliveryNotes.length} תעודות`;
});

// ============================================================
// חלק C — preflight ל"רענן תחזית" (תוספת 2026-10-06, סעיף E)
// ------------------------------------------------------------
// GET בלבד (fetchRecords ב-forecast-preflight.js, שום כתיבה) מול
// תוכנית אמיתית עם חוסרים ידועים מראש (תוכנית 42, שדוח תמר דיווח
// שנשארת ריקה) — מאמת שהרשימה שמוחזרת סבירה, לא שמתקנים את החוסר.
// ============================================================
await test('forecast-preflight: תוכנית 42 (ידועה כריקה בדוח) מחזירה רשימת חוסרים סבירה', async () => {
  const plansAll = await directFetchRecords('תוכניות שתילה', {});
  const plan42 = plansAll.find((p) => Number(p['מספר תוכנית']) === 42);
  if (!plan42) return 'דולג — תוכנית 42 לא נמצאה (ייתכן שתוקנה/נמחקה מאז)';
  const result = await api('GET', `plans/${plan42.id}/forecast-preflight`);
  if (!Array.isArray(result.missing)) throw new Error('"missing" אינו מערך');
  if (result.ok !== (result.missing.length === 0)) throw new Error('"ok" לא תואם את אורך "missing"');
  if (!result.missing.every((m) => typeof m === 'string' && m.trim())) throw new Error('יש רשומת-חוסר ריקה/לא-טקסטואלית ברשימה');
  if (result.missing.length === 0) return 'אין חוסרים — ok=true (ייתכן שתוקן בינתיים ב-Airtable)';
  return `${result.missing.length} חוסרים, לדוגמה: ${result.missing[0]}`;
}, READ_WARN_MS);

await test('forecast-preflight: תוכנית שלא קיימת מחזירה ok=false בלי לקרוס (500)', async () => {
  const result = await api('GET', 'plans/recNONEXISTENT00000000/forecast-preflight');
  if (result.ok !== false) throw new Error('"ok" צפוי false לתוכנית לא-קיימת');
  if (!Array.isArray(result.missing) || !result.missing.length) throw new Error('צפויה הודעת-חוסר לתוכנית לא-קיימת');
}, READ_WARN_MS);

// ============================================================
// חלק C3 — yearFromWeekValue (client/src/utils/weekYear.js, משימה T):
// בדיקות-יחידה טהורות (בלי Airtable) לסינון-השנים בטאב "תחזית שתילה" —
// מחרוזת קוד-שבוע, תאריך ISO, וערך ריק/חסר.
// ============================================================
await test('yearFromWeekValue: קוד-שבוע / תאריך ISO / ריק-וחסר', () => {
  if (yearFromWeekValue('20260926-20261001') !== 2026) throw new Error('קוד-שבוע לא פוענח נכון');
  if (yearFromWeekValue('2027-03-15') !== 2027) throw new Error('תאריך ISO לא פוענח נכון');
  if (yearFromWeekValue('2027-03-15T10:00:00.000Z') !== 2027) throw new Error('תאריך ISO עם חלק-זמן לא פוענח נכון');
  if (yearFromWeekValue('') !== null) throw new Error('מחרוזת ריקה אמורה להחזיר null');
  if (yearFromWeekValue(null) !== null) throw new Error('null אמור להחזיר null');
  if (yearFromWeekValue(undefined) !== null) throw new Error('undefined אמור להחזיר null');
  if (yearFromWeekValue('לא-תאריך-בכלל') !== null) throw new Error('טקסט חסר-משמעות אמור להחזיר null, לא לזרוק');
  return 'כל המקרים פוענחו/נדחו כצפוי';
});

// ⚠️ ניסיתי לכתוב כאן בדיקת-קצה-לקצה חיה (כמו ל-reverseInventoryDeduction
// למעלה) שמדמה "כמות קרטונים"/"מספר משטחים" ע"י patch ישיר, ואז קוראת
// ל-analyzeLogisticsInventory על רשומות אמיתיות. היא נכשלה באופן שחשף
// ממצא אמיתי, לא באג בבדיקה: קובץ-הקבע (qa-real-invoice.pdf — חשבונית
// אמיתית #21) מופעל ע"י Make כדי לנתח ולמלא "כמות קרטונים"/"מספר משטחים"
// בעצמו מתוך תוכן הקובץ, ו-Make ניתח את הקובץ ברקע ו**שכתב** את ה-"20"
// שה-patch שלי כתב לערך האמיתי מהחשבונית (1648!) — תוך כדי הריצה.
// בניגוד ל"הוצאות" (שיש לנו עליה סימן-state משלנו ב"[מלאי-AI]" לדעת
// שהניתוח הסתיים), לתעודת-משלוח/חשבונית **אין** אצלנו שום סימן-"סיום"
// לדעת שה-Make-ניתוח התייצב — ה-retry האוטומטי בשרת (autoAnalyzeLogisticsInventory)
// הוא ניחוש לפי "יש ערך לא-ריק", לא לפי "הערך הסופי". זה פער אמיתי —
// ר' דוח הבוקר, סעיף "ממה נגזרת ההורדה" (סיכון מקצה-לקצה פתוח, לא קוד שגוי).
// הלוגיקה הטהורה (deriveDeductions/computeDeviation/findCounterpart,
// מעל) כבר מכוסה היטב בלי להזדקק לשדות-Make בכלל.

// ============ 3ב. דוחות ריסוסים → טיפולים (spray-report-import.js) ============
// בדיקות יחידה טהורות (בלי Airtable/Make, בלי שום סיכון) לפענוח מה
// ש-Make כותב ל-"Attachment Summary" — JSON/fence/טווחי-תאריכים/מינון.
// רצות תמיד. בדיקת-הקצה-לקצה היחידה שיוצרת רשומה בטבלה המנוטרת ע"י
// Make ("דוחות ריסוסים") מצרפת קובץ אמיתי שכבר נותח בהצלחה בעבר
// (REAL_FIXTURE_PATH — בדיוק כמו הוצאות/חשבוניות/תעודות משלוח/צ'קים
// למעלה; לעולם לא תוכן סינתטי), רצה רק מאחורי RUN_UPLOAD_TESTS=1,
// ומוגבלת ל-dryRun בלבד: בודקת שה-dry-run עצמו מחזיר תוצאה סבירה,
// בלי ליצור אף "ריסוסים"/"חומר ריסוס" אמיתי.
//
// סימון הרשומה כבדיקה (תוקן בלילה 3): לטבלה "דוחות ריסוסים" יש 4 שדות
// בלבד, ושניים מהם מחושבים (מספור אוטומטי / העלאה אחרונה של הקובץ) —
// אין בה **שום** שדה-טקסט שיכול לשאת MARK. עד לילה 3 הבדיקה קראה ל-
// createWithFile עם extraFields ריק, ולכן isTestRecord החזיר false:
// גם poll (scheduleSprayReportImport, כל 15ש') וגם sweep
// (startSprayImportSweep, כל 10 דק') ראו את רשומת-ה-QA כרשומה אמיתית,
// ואם Make היה מנתח את ה-PDF לשורות — היו נוצרים טיפולי "ריסוסים"
// אמיתיים ביומן של תמר מתוך צילום חשבונית. מאז: ה-MARK נישא בשם-הקובץ
// של הצרופה (ר' ההערה ב-createWithFile על למה דווקא מקף ולא קו-תחתי).

await test('פענוח Attachment Summary: JSON תקין / עטוף ב-fence / "[]" ריק / עטיפת {rows:[...]} / טקסט לא-JSON', () => {
  if (parseSummary(null).status !== 'pending') throw new Error('null צפוי pending');
  if (parseSummary('').status !== 'pending') throw new Error('מחרוזת ריקה צפויה pending');
  if (parseSummary('[]').status !== 'empty') throw new Error('"[]" צפוי empty');
  if (parseSummary('לא JSON בכלל').status !== 'invalid') throw new Error('טקסט לא תקין צפוי invalid');
  const fenced = parseSummary('```json\n[{"סוג טיפול":"ריסוס"}]\n```');
  if (fenced.status !== 'ready' || fenced.rows.length !== 1) throw new Error('JSON עטוף ב-fence לא פוענח');
  const wrapped = parseSummary(JSON.stringify({ rows: [{ a: 1 }] }));
  if (wrapped.status !== 'ready' || wrapped.rows.length !== 1) throw new Error('עטיפת {rows:[...]} לא פוענחה');
  return 'כל המקרים פוענחו כצפוי';
});

await test('פענוח תאריך/טווח: dd/mm/yyyy, טווח עם "-", yyyy-mm-dd, סדר הפוך מתוקן, תאריך לא-חוקי', () => {
  const a = parseDateRange('03/03/2031');
  if (!a || a.start !== '2031-03-03' || a.end !== '2031-03-03') throw new Error(`תאריך בודד שגוי: ${JSON.stringify(a)}`);
  const b = parseDateRange('05/03/2031-09/03/2031');
  if (!b || b.start !== '2031-03-05' || b.end !== '2031-03-09') throw new Error(`טווח שגוי: ${JSON.stringify(b)}`);
  const c = parseDateRange('09/03/2031-05/03/2031'); // הפוך — אמור לתקן לסדר עולה
  if (!c || c.start !== '2031-03-05' || c.end !== '2031-03-09') throw new Error(`טווח הפוך לא תוקן: ${JSON.stringify(c)}`);
  const d = parseDateRange('2031-03-11');
  if (!d || d.start !== '2031-03-11') throw new Error(`ISO שגוי: ${JSON.stringify(d)}`);
  if (parseDateRange('אין תאריך כאן') !== null) throw new Error('טקסט בלי תאריך צפוי null');
  if (parseDateRange('32/13/2031') !== null) throw new Error('תאריך לא-חוקי (32/13) צפוי null, לא לקרוס');
  return 'בודד/טווח/ISO/הפוך/חסר/לא-חוקי — כולם כצפוי';
});

await test('פענוח מינון: מספר טהור / "לדונם" / "ל-100 ליטר" / עמום (בלי מספר חד-משמעי)', () => {
  const a = parseDosage('40');
  if (a.value !== 40 || a.basis !== null) throw new Error(`מספר טהור שגוי: ${JSON.stringify(a)}`);
  const b = parseDosage('1 ליטר לדונם');
  if (b.value !== 1 || b.basis !== 'לדונם') throw new Error(`"לדונם" שגוי: ${JSON.stringify(b)}`);
  const c = parseDosage('50 סמ"ק ל-100 ליטר');
  if (c.value !== 50 || c.basis !== 'ל-100 ליטר') throw new Error(`"ל-100 ליטר" שגוי: ${JSON.stringify(c)}`);
  const d = parseDosage('לפי הצורך, במידת הנדרש');
  if (d.value !== null) throw new Error(`טקסט בלי מספר חד-משמעי צפוי value:null, התקבל ${d.value}`);
  if (parseDosage('').value !== null) throw new Error('מחרוזת ריקה צפויה value:null');
  return 'מספר טהור/לדונם/ל-100-ליטר/עמום/ריק — כולם כצפוי';
});

// מקרי-קצה שנוספו במשימת הלילה 2026-10-06 (M3): פסיק כמפריד-אלפים מול
// עשרוני, ו"ל-1000" שלא אמור להיתפס בטעות כ"ל-100" (תת-מחרוזת, בלי עוגן).
await test('פענוח מינון — מקרי קצה: פסיק-אלפים ("40,000"), "ל-1000 ליטר" לא נתפס כ"ל-100", מקפים/אחוז/טווח', () => {
  const thousands = parseDosage('40,000');
  if (thousands.value !== 40000) throw new Error(`"40,000" אמור להתפרש כ-40000 (מפריד אלפים), התקבל ${JSON.stringify(thousands)}`);
  const decimal = parseDosage('1,5');
  if (decimal.value !== 1.5) throw new Error(`"1,5" אמור להתפרש כ-1.5 (עשרוני, לא אלפים), התקבל ${JSON.stringify(decimal)}`);
  const dot = parseDosage('2.5');
  if (dot.value !== 2.5) throw new Error(`"2.5" אמור להישאר 2.5, התקבל ${JSON.stringify(dot)}`);
  const notHundred = parseDosage('40 גרם ל-1000 ליטר');
  if (notHundred.basis === 'ל-100 ליטר') throw new Error(`"ל-1000 ליטר" נתפס בטעות כ"ל-100 ליטר": ${JSON.stringify(notHundred)}`);
  const percent = parseDosage('3%');
  if (percent.value !== 3 || percent.basis !== 'אחוז') throw new Error(`"3%" שגוי: ${JSON.stringify(percent)}`);
  const range = parseDosage('50-60');
  if (range.value !== null) throw new Error(`טווח "50-60" לא חד-משמעי, צפוי value:null, התקבל ${range.value}`);
  const ccPer100 = parseDosage('50 סמ״ק ל-100 ליטר'); // גרש תאילנדי/עברי שונה (״ במקום ")
  if (ccPer100.value !== 50 || ccPer100.basis !== 'ל-100 ליטר') throw new Error(`גרש חלופי שגוי: ${JSON.stringify(ccPer100)}`);
  return '40,000→40000, 1,5→1.5, 2.5→2.5, ל-1000≠ל-100, 3%, טווח→null — כולם כצפוי';
});

// Attachment Summary כ-{state:'error'}/{state:'pending'} (אובייקט aiText של Airtable,
// לא מחרוזת JSON) — אמור להתפרש כ"אין נתון עדיין" (pending), לא לקרוס (M3).
await test('פענוח Attachment Summary: אובייקט {state:"error"}/{state:"pending"} → pending, לא קורס', () => {
  const err = parseSummary({ state: 'error', errorType: 'emptyDependency' });
  if (err.status !== 'pending') throw new Error(`{state:'error'} אמור להתפרש כ-pending, התקבל: ${JSON.stringify(err)}`);
  const pending = parseSummary({ state: 'pending' });
  if (pending.status !== 'pending') throw new Error(`{state:'pending'} אמור להתפרש כ-pending, התקבל: ${JSON.stringify(pending)}`);
  const generated = parseSummary({ state: 'generated', value: '[{"סוג טיפול":"ריסוס"}]' });
  if (generated.status !== 'ready' || generated.rows.length !== 1) throw new Error(`{state:'generated',value:...} אמור להתפרש כ-ready עם שורה אחת: ${JSON.stringify(generated)}`);
  return "error/pending/generated — כולם מתפרשים נכון, בלי לקרוס";
});

await test('סמן המקור: markerOf תואם את תבנית הזיהוי שה-UI/הייבוא קוראים', () => {
  const marker = markerOf(42);
  if (!/^\[מדוח ריסוסים #42\]$/.test(marker)) throw new Error(`תבנית סמן לא צפויה: ${marker}`);
});

// בדיקה טהורה שנוספה בלילה 3 — שומרת על שתי המלכודות שהתגלו בבאג
// "דוח ריסוסים dry-run":
// (1) רשומת "דוחות ריסוסים" אין לה שדה-טקסט ל-MARK, ולכן הסימון היחיד
//     האפשרי הוא שם-הקובץ של הצרופה. אם זה יישבר — poll/sweep יייבאו
//     רשומות-בדיקה ליומן הטיפולים האמיתי של תמר.
// (2) המפריד בין MARK לשם-הקובץ חייב להיות **לא תו-מילה**: ב-regex
//     /\bQA-\d{10,}\b/ אין גבול-מילה בין ספרה ל-"_", ולכן קו-תחתי שובר
//     את הזיהוי בשקט מוחלט.
await test('זיהוי רשומת-בדיקה של "דוחות ריסוסים" לפי שם-הקובץ בצרופה (מקף מזוהה, קו-תחתי לא)', () => {
  const mk = 'QA-1759800000000';
  const recOf = (filename) => ({ id: 'recX', 'מספור אוטומטי': 77, 'דוח ריסוסים': [{ url: 'https://x/y.pdf', filename }] });
  if (!isSprayTestRecord(recOf(`${mk}-qa-real-invoice.pdf`))) {
    throw new Error('MARK במפריד-מקף בשם-הקובץ לא זוהה כרשומת בדיקה — האיסוף האוטומטי יייבא רשומות QA לייצור');
  }
  if (isSprayTestRecord(recOf(`${mk}_qa-real-invoice.pdf`))) {
    throw new Error('המלכודת התהפכה: קו-תחתי כן מזוהה עכשיו — עדכן את התבנית/הבדיקה יחד');
  }
  if (isSprayTestRecord(recOf('qa-real-invoice.pdf'))) throw new Error('שם-קובץ בלי MARK זוהה בטעות כבדיקה');
  if (isSprayTestRecord(recOf('דוח ריסוסים אוקטובר.pdf'))) throw new Error('דוח אמיתי זוהה בטעות כבדיקה');
  // התבנית דורשת 10 ספרות ומעלה — MARK קצר מדי לא נתפס (שומר על הכוונה)
  if (isSprayTestRecord(recOf('QA-123-x.pdf'))) throw new Error('"QA-123" (קצר) לא אמור להיחשב סמן בדיקה');
  return 'מקף→בדיקה, קו-תחתי→לא, שם רגיל→לא';
});

await test('דוח ריסוסים: רשומה עם קובץ אמיתי שכבר נותח בעבר + dry-run בלבד (0 יצירות אמיתיות)', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  // "מיקום" אינו שדה אמיתי בטבלת "דוחות ריסוסים" (ר' getMeta: רק
  // מספור-אוטומטי/דוח-ריסוסים/Attachment Summary/העלאה-אחרונה) — זה שם
  // עמודה בתוך קובץ-הריסוסים שמיובא, לא שדה-Airtable על הרשומה עצמה.
  // ולכן גם ה-MARK נישא בשם-הקובץ, ולא בשדה (ר' ההערה למעלה).
  const rec = await createWithFile('דוחות ריסוסים', 'דוח ריסוסים', {}, `${MARK}-${REAL_FIXTURE_NAME}`);
  const dry = await api('POST', `spray-reports/${rec.id}/import?dryRun=1`);
  if (dry.dryRun !== true) throw new Error('התשובה לא מסמנת dryRun:true');
  if (dry.created !== 0) throw new Error(`dry-run "יצר" ${dry.created} — אסור, dry-run לא אמור לכתוב כלום`);
  if (!['pending', 'no-file', 'empty', 'invalid', 'ready'].includes(dry.status)) throw new Error(`status לא מוכר: ${dry.status}`);

  // הבדיקה הנכונה היא לפי **סמן המקור של הדוח הזה** ([מדוח ריסוסים #N]),
  // לא לפי ה-MARK הגלובלי של הריצה: ל-MARK יש כבר רשומות "ריסוסים"
  // לגיטימיות שנוצרו ע"י בדיקות קודמות באותה ריצה (ר' "טיפול/ריסוס:
  // יצירה + בוצע + עריכה" ו"טיפול משותף: רב-מבני") והן מתנקות רק בסוף
  // הקובץ — חיפוש לפי MARK תפס אותן ודיווח בשקר ש"ה-dry-run יצר רשומות".
  if (dry.number == null) throw new Error('הדוח חזר בלי "מספור אוטומטי" — אין סמן מקור לבדוק מולו');
  const srcMarker = markerOf(dry.number);
  const made = await api('GET', `${enc('ריסוסים')}?raw=1&includeTest=1&filterByFormula=${enc(`FIND('${srcMarker}', {הערות})`)}`);
  if (made.length) throw new Error(`נמצאו ${made.length} רשומות "ריסוסים" עם סמן המקור ${srcMarker} — dry-run לא אמור ליצור אף אחת`);

  // גם חומרי ריסוס: dry-run מחזיר ב-createdMaterials את מה ש"היה נוצר" —
  // ואסור שרשומה כזו תיווצר באמת (materialResolver מדלג על createRecord)
  for (const name of dry.createdMaterials || []) {
    const hits = await api('GET', `${enc('חומרי ריסוס')}?raw=1&includeTest=1&filterByFormula=${enc(`{שם חומר}='${String(name).replace(/'/g, "\\'")}'`)}`);
    if (hits.length) throw new Error(`dry-run יצר באמת חומר ריסוס "${name}" — אסור`);
  }

  const hist = await api('GET', 'spray-reports/history?includeTest=1');
  if (!hist.some((h) => h.id === rec.id)) throw new Error('הדוח לא מופיע בהיסטוריה (includeTest=1)');
  const histPlain = await api('GET', 'spray-reports/history');
  if (histPlain.some((h) => h.id === rec.id)) throw new Error('רשומת בדיקה דלפה להיסטוריה הרגילה — ה-MARK בשם-הקובץ לא נתפס ע"י isTestRecord, והאיסוף האוטומטי עלול לייבא אותה לייצור');
  return `dry-run: status=${dry.status}, created=0 (כצפוי), ${dry.rows?.length ?? 0} שורות בניתוח, מסומנת כבדיקה`;
});

await test('אבטחה: /api/spray-reports — עובד 403 בשניהם, מנהל עבודה 200 היסטוריה / 403 ייבוא', async () => {
  const manager = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && String(a['סוג'] || '').includes('עבודה'));
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  const target = 'recFAKE00000001';
  const problems = [];
  if (w) {
    const wLogin = await apiAs(null, 'POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
    try { await apiAs(wLogin.token, 'GET', 'spray-reports/history'); problems.push('worker GET history עבר'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`worker GET: ${e.message}`); }
    try { await apiAs(wLogin.token, 'POST', `spray-reports/${target}/import?dryRun=1`); problems.push('worker POST import עבר'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`worker POST: ${e.message}`); }
  }
  if (manager) {
    const mLogin = await apiAs(null, 'POST', 'admin-login', { email: manager['מייל'], code: manager['קוד אישי'] });
    const h = await apiAs(mLogin.token, 'GET', 'spray-reports/history');
    if (!Array.isArray(h)) problems.push('manager GET history לא החזיר מערך');
    try { await apiAs(mLogin.token, 'POST', `spray-reports/${target}/import?dryRun=1`); problems.push('manager POST import עבר'); }
    catch (e) { if (!String(e.message).startsWith('403')) problems.push(`manager POST: ${e.message}`); }
  }
  try { await apiAs(null, 'GET', 'spray-reports/history'); problems.push('בלי טוקן עבר'); }
  catch (e) { if (!String(e.message).startsWith('401')) problems.push(`בלי טוקן: ${e.message}`); }
  if (problems.length) throw new Error(problems.join('; '));
  return `${w ? 'עובד 403×2' : 'אין עובד לבדיקה'}, ${manager ? 'מנהל 200/403' : 'אין מנהל עבודה לבדיקה'}, בלי טוקן 401`;
});

// ============ 3ג. הוספת אפשרות לשדה-בחירה דרך typecast (סעיף G, 7.10.2026) ============
// השרת מאפשר ?typecast=1 רק למנהל ראשי, רק ל-"מלאי בסיסי"."קטגוריה". הבדיקות
// שלא משנות סכימה רצות תמיד; יצירת קטגוריה אמיתית (שמשאירה אפשרות חדשה
// ברשימת הבחירה ב-Airtable — אי-אפשר למחוק אותה ב-API) רק עם RUN_SCHEMA_TESTS=1.
await test("typecast: טבלה שאינה ברשימה הלבנה → 403", async () => {
  try { await api("POST", `${enc("הוצאות")}?typecast=1`, { "קטגוריית חשבונית-AI": MARK }); }
  catch (e) { if (String(e.message).startsWith("403")) return "חסום כנדרש"; throw e; }
  throw new Error("יצירה עם typecast בטבלה לא מורשית עברה");
});
await test("typecast: מנהל עבודה → 403 (מנהל ראשי בלבד)", async () => {
  const manager = allAdmins.find((a) => a["מייל"] && a["קוד אישי"] && String(a["סוג"] || "").includes("עבודה"));
  if (!manager) return "אין מנהל עבודה לבדיקה";
  const mLogin = await apiAs(null, "POST", "admin-login", { email: manager["מייל"], code: manager["קוד אישי"] });
  if (!mLogin?.token) throw new Error("מנהל העבודה לא קיבל טוקן");
  try { await apiAs(mLogin.token, "POST", `${enc("מלאי בסיסי")}?typecast=1`, { "קטגוריה": MARK }); }
  catch (e) { if (String(e.message).startsWith("403")) return "חסום כנדרש"; throw e; }
  throw new Error("מנהל עבודה יצר קטגוריה חדשה");
});
await test("typecast: ערך ריק/ארוך מדי → 403", async () => {
  try { await api("POST", `${enc("מלאי בסיסי")}?typecast=1`, { "קטגוריה": "x".repeat(61) }); }
  catch (e) { if (String(e.message).startsWith("403")) return "חסום כנדרש"; throw e; }
  throw new Error("קטגוריה של 61 תווים עברה");
});
await test("typecast: ללא הדגל — ערך שאינו ברשימה נדחה ע\"י Airtable (422), לא נוצרת אפשרות", async () => {
  try { await api("POST", enc("מלאי בסיסי"), { "קטגוריה": MARK + "-nocast" }); }
  catch (e) { if (/^4\d\d/.test(String(e.message))) return "נדחה כנדרש"; throw e; }
  throw new Error("ערך לא-ברשימה נשמר בלי typecast");
});
if (process.env.RUN_SCHEMA_TESTS !== "0") { // ברירת מחדל דלוק (הוראת תמר 7.10: שרידי בדיקה מותרים לפני המסירה ללקוח); כיבוי עם RUN_SCHEMA_TESTS=0
  await test("typecast: קטגוריה חדשה נוצרת בפועל (RUN_SCHEMA_TESTS)", async () => {
    const rec = await api("POST", `${enc("מלאי בסיסי")}?typecast=1`, { "קטגוריה": MARK, "מלאי נוכחי": 1, "הערות": MARK });
    if (rec?.id) cleanup.push({ table: "מלאי בסיסי", id: rec.id });
    if (rec?.["קטגוריה"] !== MARK) throw new Error("הקטגוריה לא נשמרה");
    const opts = await api("GET", `select-options/${enc("מלאי בסיסי")}/${enc("קטגוריה")}`);
    if (!(opts.choices || []).includes(MARK)) throw new Error("האפשרות לא מופיעה ב-select-options");
    return `נוצרה אפשרות "${MARK}" — להסרה ידנית ב-Airtable (ה-API לא מוחק אפשרויות)`;
  });
}

// ============ 3ד. מניעת קטגוריית-מלאי כפולה (סעיף Q, 7.10.2026) ============
// "קטגוריה אחת = פריט אחד" — ר' server.js findDuplicateInventoryCategory.
// שריד-בדיקה (TEST_RECORD_PATTERN) מסונן מתוך "הקיימים" בכוונה — שתי
// רשומות-QA בקטגוריה חדשה-זהה לא אמורות לחסום זו את זו.
await test('Q: יצירת פריט QA בקטגוריה קיימת ("קרטונים") → 409, בלי רשומה חדשה', async () => {
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  if (!opts.choices.includes('קרטונים')) return 'דולג — אין קטגוריית "קרטונים" קיימת כרגע';
  try {
    await api('POST', enc('מלאי בסיסי'), { 'קטגוריה': 'קרטונים', 'הערות': MARK });
  } catch (e) {
    if (!String(e.message).startsWith('409')) throw new Error(`קוד-שגיאה לא צפוי: ${e.message}`);
    // ⚠️ סינון גם לפי קטגוריה="קרטונים" ולא רק MARK-בהערות — אחרת בדיקת
    // G ("typecast: קטגוריה חדשה נוצרת בפועל", רצה קודם בקובץ) מזהה-בטעות
    // את הפריט-התמים-שלה-עצמה (קטגוריה=MARK, עדיין ב-cleanup, קטגוריה
    // שונה לגמרי) כ"דליפה" כאן, כי שתיהן חולקות את אותו MARK של הריצה.
    const leaked = (await api('GET', `${enc('מלאי בסיסי')}?raw=1&includeTest=1`))
      .filter((i) => i['קטגוריה'] === 'קרטונים' && String(i['הערות'] || '').includes(MARK));
    if (leaked.length) throw new Error(`נוצרה בכל זאת רשומה: ${leaked.map((l) => l.id).join(',')}`);
    return '409 כנדרש, בלי רשומה חדשה';
  }
  throw new Error('יצירה בקטגוריה קיימת עברה בהצלחה — אסור');
});

await test('Q: PATCH של פריט QA לקטגוריה תפוסה ("קרטונים") → 409, הקטגוריה המקורית לא השתנתה', async () => {
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  if (!opts.choices.includes('קרטונים')) return 'דולג — אין קטגוריית "קרטונים" קיימת כרגע';
  const items = await api('GET', `${enc('מלאי בסיסי')}?raw=1`);
  const usedCats = new Set(items.map((i) => String(i['קטגוריה'] || '').trim()).filter(Boolean));
  const freeCat = opts.choices.find((c) => !usedCats.has(c));
  if (!freeCat) return 'דולג — אין קטגוריה פנויה ברשימת האפשרויות ליצירת פריט-QA זמני';
  const rec = await api('POST', enc('מלאי בסיסי'), { 'קטגוריה': freeCat, 'הערות': MARK });
  cleanup.push({ table: 'מלאי בסיסי', id: rec.id });
  try {
    await api('PATCH', `${enc('מלאי בסיסי')}/${rec.id}`, { 'קטגוריה': 'קרטונים' });
  } catch (e) {
    if (!String(e.message).startsWith('409')) throw new Error(`קוד-שגיאה לא צפוי: ${e.message}`);
    const after = await api('GET', `${enc('מלאי בסיסי')}/${rec.id}`);
    if (after['קטגוריה'] !== freeCat) throw new Error('הקטגוריה השתנתה בכל זאת אחרי 409');
    return `409 כנדרש (קטגוריית-המקור "${freeCat}" לא השתנתה)`;
  }
  throw new Error('PATCH לקטגוריה תפוסה עבר בהצלחה — אסור');
});

await test('Q: יצירה בקטגוריה פנויה שקיימת ברשימת האפשרויות → 201 (ואז מחיקה)', async () => {
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  const items = await api('GET', `${enc('מלאי בסיסי')}?raw=1`);
  const usedCats = new Set(items.map((i) => String(i['קטגוריה'] || '').trim()).filter(Boolean));
  const freeCat = opts.choices.find((c) => !usedCats.has(c));
  if (!freeCat) return 'דולג — אין קטגוריה פנויה ברשימת האפשרויות כרגע';
  const rec = await api('POST', enc('מלאי בסיסי'), { 'קטגוריה': freeCat, 'הערות': MARK });
  if (!rec?.id) throw new Error('היצירה לא החזירה רשומה');
  await del('מלאי בסיסי', rec.id);
  return `נוצר ונמחק פריט בקטגוריה-פנויה "${freeCat}"`;
});

if (process.env.RUN_SCHEMA_TESTS !== '0') { // יוצרת אפשרות-select חדשה-לצמיתות (כמו בדיקת G) — ברירת מחדל דלוק, כיבוי עם RUN_SCHEMA_TESTS=0
  await test('Q: שתי רשומות-QA בקטגוריית-QA חדשה-זהה (לא קטגוריה אמיתית) → לא נחסמות זו בגלל זו (שריד-בדיקה מסונן מהבדיקה דרך שדה "קטגוריה" עצמו)', async () => {
    // ⚠️ חייב להיות קטגוריה שעצם-ערכה תואם TEST_RECORD_PATTERN (לא קטגוריה
    // אמיתית פנויה כמו "נילונים"!) — אחרת זה לא בודק את מה ש-Q מתעד: ש-
    // findDuplicateInventoryCategory מסנן לפי שדה "קטגוריה" של הקיים, לא
    // לפי ה-JSON השלם (ר' תיקון 7.10 — באג אמיתי שנתפס: בדיקה על ה-JSON
    // השלם החריגה פריטי-מלאי אמיתיים שה"הערות" שלהם צברה אזכור-QA ישן,
    // ואפשרה כפילות-קטגוריה אמיתית ליצור בטעות דרך הבדיקה עצמה).
    const recA = await api('POST', `${enc('מלאי בסיסי')}?typecast=1`, { 'קטגוריה': MARK });
    cleanup.push({ table: 'מלאי בסיסי', id: recA.id });
    const recB = await api('POST', enc('מלאי בסיסי'), { 'קטגוריה': MARK, 'הערות': MARK });
    cleanup.push({ table: 'מלאי בסיסי', id: recB.id });
    return `שתי רשומות-QA נוצרו בקטגוריית-QA "${MARK}" בלי חסימה הדדית, כצפוי — להסרה ידנית של האפשרות ב-Airtable`;
  });
}

// ============================================================
// תוספת 2026-10-07 — יומן-ירידות למלאי + מחיקה מדורגת (סעיף P)
// בדיקות-יחידה טהורות על הפרסר (בלי Airtable) + בדיקה חיה אחת מגודרת
// (RUN_UPLOAD_TESTS) שמוודאת שה-cascade האמיתי עובד קצה-לקצה.
// ============================================================
await test('inventoryLedger: פרסור שורת-הורדה לוגיסטית (עם תגית) → שדות+קישור נכונים', () => {
  const line = '↓ 328 ממלאי: כובעים (תעודה #44, שבוע 20260926-20261001 · 328 קרטונים × 1) ⚠ בלי הצלבה [מלאי-D:תעודות משלוח:recJx50ogFRvpYvxd:כובעים]';
  const { movements } = parseInventoryLedger(line);
  const m = movements[0];
  if (m.kind !== 'deduction' || m.sourceTable !== 'תעודות משלוח' || m.sourceId !== 'recJx50ogFRvpYvxd') throw new Error(`שדות-מקור שגויים: ${JSON.stringify(m)}`);
  if (m.quantity !== 328 || m.category !== 'כובעים') throw new Error('כמות/קטגוריה שגויים');
  if (m.link !== '/delivery-notes?open=recJx50ogFRvpYvxd') throw new Error(`קישור שגוי: ${m.link}`);
});

await test('inventoryLedger: פרסור שורת-הוצאה (בלי תגית) → sourceNumber בלבד, link מתמלא ע"י resolveExpenseLinks', () => {
  const line = '↓ 20 · הוצאה #48 · גיניגר · 2026-09-16';
  const { movements } = parseInventoryLedger(line);
  const m = movements[0];
  if (m.sourceTable !== 'הוצאות' || m.sourceNumber !== '48' || m.link) throw new Error(`צפוי sourceNumber=48, link=null לפני resolve: ${JSON.stringify(m)}`);
  const resolved = resolveExpenseLinks(movements, { 48: 'recEXPENSE1' });
  if (resolved[0].link !== documentLink('הוצאות', 'recEXPENSE1')) throw new Error('resolveExpenseLinks לא מילא קישור נכון');
});

await test('inventoryLedger: שורת ביטול (↩) עם תגית → sourceId/category מהתגית, בלי קישור (המסמך כבר נמחק)', () => {
  const line = '↩ ביטול הורדה של 450 · תעודות משלוח recPuhd0dotAhQAdF נמחק · 2026-10-06 [מלאי-D:תעודות משלוח:recPuhd0dotAhQAdF:כובעים]';
  const { movements } = parseInventoryLedger(line);
  const m = movements[0];
  if (m.kind !== 'reversal' || m.sourceId !== 'recPuhd0dotAhQAdF' || m.category !== 'כובעים' || m.quantity !== 450) throw new Error(`שגוי: ${JSON.stringify(m)}`);
  if (m.link) throw new Error('שורת-ביטול לא אמורה לקבל קישור (המסמך כבר נמחק)');
});

await test('inventoryLedger: הערה חופשית (בלי ↓/↩/⚠) נשארת ב-freeNotes, לא ב-movements', () => {
  const { movements, freeNotes } = parseInventoryLedger('הערה חופשית של תמר\n↓ 10 · הוצאה #1 · ספק · 2026-01-01');
  if (movements.length !== 1) throw new Error('צפויה שורת-תנועה אחת בלבד');
  if (freeNotes !== 'הערה חופשית של תמר') throw new Error(`freeNotes שגוי: "${freeNotes}"`);
});

await test('cascade: dryRun על מסמך בלי שום השפעה על מלאי מחזיר inventory ריק, בלי לכתוב כלום', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  // תעודה-QA בלי "כמות קרטונים" בכלל (pending) — אין מה להחזיר, אין שבוע תואם אמיתי
  const rec = await createWithFile('תעודות משלוח', 'תעודת משלוח', { 'קוד שבוע': MARK });
  const { readFile: rf } = await import('node:fs/promises');
  const report = await cascadeDocumentDelete('תעודות משלוח', rec.id, { dryRun: true });
  if (report.inventory.length) throw new Error(`לא אמור להיות מה להחזיר: ${JSON.stringify(report.inventory)}`);
  if (report.week) throw new Error('קוד-שבוע ייחודי-QA לא אמור להתאים לאף רשומת-שבוע אמיתית');
  return 'dryRun נקי: אין מלאי להחזיר, אין שבוע תואם';
});

await test('cascade: מחיקה אמיתית של תעודה-QA שהורידה מלאי (קטגוריה "קרטונים", לא "נילונים" — ר\' ממצא כפילות 2026-10-07) מחזירה מלאי במדויק', async () => {
  if (!RUN_UPLOAD_TESTS) return 'דולג — נמנע משריפת קרדיטי Make; הרץ עם RUN_UPLOAD_TESTS=1 לכלול';
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  if (!opts.choices.includes('קרטונים')) return 'דולג — אין פריט אמיתי בקטגוריית "קרטונים" כרגע';
  const before = (await api('GET', `${enc('מלאי בסיסי')}?raw=1`)).find((i) => i['קטגוריה'] === 'קרטונים');
  if (!before) return 'דולג — לא נמצא פריט קרטונים';
  // ⚠️ analyze-inventory מוריד בבת-אחת משלוש הקטגוריות (קרטונים/נילונים/
  // כובעים יחד, לא רק מהקטגוריה שבשמה קראנו לבדיקה) — אם קיימת כרגע
  // כפילות-קטגוריה אמיתית (ר' ממצא 2026-10-07 בפועל: 2 פריטי "נילונים"),
  // ה-deduction עלול לרדת מהפריט-הלא-צפוי. במקום להניח שזה לא יקרה,
  // מצלמים snapshot של **כל** הקטגוריות לפני/אחרי ומוודאים שהכל חוזר
  // במדויק — כך שגם אם כפילות קיימת, הבדיקה חייבת להוכיח שה-cascade
  // מחזיר בדיוק את מה שהורד, לא "להניח" שרק קרטונים הושפעו.
  const snapshot = async () => {
    const items = await api('GET', `${enc('מלאי בסיסי')}?raw=1`);
    const m = {};
    for (const it of items) { const cat = it['קטגוריה']; if (cat) (m[cat] ||= []).push({ id: it.id, stock: Number(it['מלאי נוכחי']) || 0 }); }
    return m;
  };
  const beforeSnap = await snapshot();

  const rec = await createWithFile('תעודות משלוח', 'תעודת משלוח', { 'קוד שבוע': MARK, 'כמות קרטונים': '15' });
  const owner = allAdmins.find((a) => a['מייל'] && a['קוד אישי'] && !String(a['סוג'] || '').includes('עבודה'));
  const loginRes = await apiAs(null, 'POST', 'admin-login', { email: owner['מייל'], code: owner['קוד אישי'] });
  await apiAs(loginRes.token, 'POST', `logistics/${enc('תעודות משלוח')}/${rec.id}/analyze-inventory`);

  // ⚠️ "קרטונים"/"נילונים"/"כובעים" הם פריטי-מלאי משותפים שכל תעודה/
  // חשבונית אמיתית בייצור מורידה מהם במקביל — השוואת ערך-מלאי מוחלט
  // מול snapshot קודם (beforeStock-15) שברירית תחת עומס-כתיבה מקביל
  // אמיתי (ראינו בפועל: ערך-אחר לגמרי בין שני ריצות, בעוד שהתגית עצמה
  // נכתבה ובוטלה נכון בלוג השרת). בודקים לכן דרך התגית הייעודית (אותה
  // שיטה ש-planLogisticsReversal עצמו משתמש בה), לא דרך ההפרש המוחלט.
  // קריאת-GET בודדת מיד אחרי כתיבה הראתה בפועל חוסר-עקביות חולף (הפריט
  // לא הופיע ברשימה בניסיון אחד) — פולינג קצר עד 3 ניסיונות, כמו דפוס
  // הניקוי-הכפול הקיים למטה בקובץ הזה.
  const findCardboard = async () => {
    for (let i = 0; i < 3; i++) {
      const found = (await api('GET', `${enc('מלאי בסיסי')}?raw=1`)).find((it) => it['קטגוריה'] === 'קרטונים');
      if (found) return found;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('פריט "קרטונים" לא נמצא ב"מלאי בסיסי" אחרי 3 ניסיונות קריאה');
  };

  const afterAnalyze = await findCardboard();
  const tagPrefix = `[מלאי-D:תעודות משלוח:${rec.id}:קרטונים]`;
  if (!String(afterAnalyze['הערות'] || '').includes(tagPrefix)) throw new Error('לא נמצאה שורת-הורדה מתויגת עבור הקטגוריה "קרטונים" אחרי analyze-inventory');

  const preview = await apiAs(loginRes.token, 'GET', `documents/${enc('תעודות משלוח')}/${rec.id}/cascade-preview`);
  if (!preview.inventory.some((r) => r.category === 'קרטונים' && r.quantity === 15)) throw new Error(`preview לא הציג את ההחזרה הצפויה: ${JSON.stringify(preview.inventory)}`);
  const afterPreview = await findCardboard();
  if (!String(afterPreview['הערות'] || '').includes(tagPrefix) || String(afterPreview['הערות'] || '').split('\n').some((l) => l.startsWith('↩') && l.includes(tagPrefix))) {
    throw new Error('cascade-preview לא אמור לשנות/לבטל כלום (dryRun), אבל השורה המתויגת כבר בוטלה');
  }

  await apiAs(loginRes.token, 'DELETE', `${enc('תעודות משלוח')}/${rec.id}`);
  // כבר נמחק בכוונה — מסירים מרשימת הניקוי הסופית כדי שלא יידווח כ"נכשל"
  const idx = cleanup.findIndex((c) => c.table === 'תעודות משלוח' && c.id === rec.id);
  if (idx >= 0) cleanup.splice(idx, 1);

  const afterSnap = await snapshot();
  const mismatches = [];
  for (const cat of Object.keys(beforeSnap)) {
    const b = beforeSnap[cat], a = afterSnap[cat] || [];
    for (const item of b) {
      const match = a.find((x) => x.id === item.id);
      if (!match || match.stock !== item.stock) mismatches.push(`${cat} (${item.id}): לפני=${item.stock}, אחרי=${match?.stock ?? 'נעלם'}`);
    }
  }
  if (mismatches.length) throw new Error(`מלאי לא חזר במדויק בכל הקטגוריות (כולל אפשרות-כפילות): ${mismatches.join(' | ')}`);
  return `מלאי חזר במדויק בכל הקטגוריות (${Object.keys(beforeSnap).length}) אחרי מחיקה-מדורגת (cascade) — כולל בדיקת-כפילות`;
});

// ============ 4. ניקוי מלא ============
// תקרית 2026-09-03 (לילה): רשומת בדיקה בטבלה מנוטרת ע"י Make (חשבונית)
// שרדה את הניקוי בריצה קודמת ונשארה בטבלה החיה עד שאותרה ידנית למחרת —
// כנראה קונפליקט זמני (Make מעבד את הרשומה באותו רגע). מנסים כל מחיקה
// פעם שנייה אחרי השהיה קצרה לפני שמוותרים, ומדווחים בדיוק אילו רשומות
// (טבלה+id) לא נמחקו בכלל — כדי שלא יישארו שם בלי שאף אחד ידע.
let cleaned = 0, cleanFailed = [];
for (const c of cleanup.reverse()) {
  try { await del(c.table, c.id); cleaned++; continue; } catch {}
  await new Promise((r) => setTimeout(r, 1500));
  try { await del(c.table, c.id); cleaned++; } catch { cleanFailed.push(c); }
}
if (cleanFailed.length) {
  console.log('\n⚠️ רשומות שלא נמחקו אחרי 2 ניסיונות — יש להסיר ידנית:');
  cleanFailed.forEach((c) => console.log(`   ${c.table} / ${c.id}`));
}

// ============ 4.5 — ניקוי יתומי forecast-sync (ר' "חלק C2" למעלה) ============
// עיכוב-תשתית לא-קבוע באוטומציית "רענן תחזית" (ר' ההערה ב"חלק C2")
// יכול לגרום לשורות-תחזית-QA להיווצר *אחרי* שהניקוי הרגיל (סעיף 4,
// למעלה) כבר מחק את התוכנית/הגידול שלהן — ה-link בשורה נשאר ריק
// (Airtable לא מקשר לרשומה שכבר לא קיימת), כך שהן לא היו ברשימת ה-
// cleanup הרגילה בכלל. סורקים כאן, בסוף הריצה כולה (אחרי שחלף עוד זמן
// טבעי מריצת שאר הבדיקות — יותר סיכוי שהאוטומציה כבר סיימה), כל שורת-
// "תחזית שתילה שבועית" בלי תוכנית-מקושרת שתאריך תחילת-השבוע שלה נופל
// באחד מטווחי-התאריכים ש-forecast-sync.js-tests דיווחו עליהם כ"דולג".
let sweepDeleted = 0;
if (forecastSyncOrphanRanges.length) {
  try {
    const forecastAll = await directFetchRecords('תחזית שתילה שבועית', {});
    const inAnyRange = (dateStr) => {
      if (!dateStr) return false;
      return forecastSyncOrphanRanges.some(({ from, to }) => dateStr >= from && dateStr <= to);
    };
    const orphans = forecastAll.filter((f) => !f['תוכנית שתילה'] && inAnyRange(f['תחילת שבוע']));
    for (const o of orphans) {
      try { await del('תחזית שתילה שבועית', o.id); sweepDeleted++; } catch {}
    }
    if (orphans.length) console.log(`\n🧹 ניקוי יתומי forecast-sync: ${sweepDeleted}/${orphans.length} שורות-תחזית יתומות (ללא תוכנית-מקושרת) נוקו מטווחי-התאריכים של הבדיקות שדולגו`);
  } catch (e) {
    console.log(`\n⚠️ ניקוי יתומי forecast-sync נכשל: ${e.message} — בדוק ידנית ב-Airtable טבלת "תחזית שתילה שבועית"`);
  }
}

// ============ 5. דוח ============
const pad = (v, n) => String(v).padEnd(n);
console.log('\n================= דוח בדיקות איכות =================');
for (const [st, name, ms, extra] of results) {
  const mark = st === 'PASS' ? '✅' : st === 'SLOW' ? '🐢' : '❌';
  console.log(`${mark} ${pad(st, 5)} ${pad(ms + 'ms', 8)} ${name}${extra ? ' — ' + extra : ''}`);
}
const reads = results.filter(([, n]) => n.startsWith('קריאה:'));
const readTimes = reads.map(([, , ms]) => ms);
const writes = results.filter(([, n]) => !n.startsWith('קריאה:'));
console.log('----------------------------------------------------');
console.log(`קריאות: ${reads.length} טבלאות · ממוצע ${Math.round(readTimes.reduce((a, b) => a + b, 0) / (readTimes.length || 1))}ms · מקס ${Math.max(...readTimes, 0)}ms`);
console.log(`כתיבות/זרימות: ${writes.length} · ניקוי: ${cleaned} נמחקו${cleanFailed.length ? `, ${cleanFailed.length} נכשלו` : ''}`);
const fails = results.filter(([s]) => s === 'FAIL').length;
const slows = results.filter(([s]) => s === 'SLOW').length;
console.log(fails ? `❌ ${fails} נכשלו` : slows ? `⚠️ הכל עבר, ${slows} איטיות` : '✅ כל הבדיקות עברו במהירות תקינה');
process.exit(fails ? 1 : 0);
