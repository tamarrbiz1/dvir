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
import { LOGIN_CODES_TABLE } from './auth.js';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4000/api';
const MARK = 'QA-' + Date.now();
const enc = encodeURIComponent;
const results = [];
const cleanup = [];

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
const createWithFile = async (table, field, extraFields = {}) => {
  const fileBuf = await readFile(REAL_FIXTURE_PATH);
  const fd = new FormData();
  fd.append('file', new Blob([fileBuf], { type: 'application/pdf' }), REAL_FIXTURE_NAME);
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
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  const rec = await create('מלאי בסיסי', { 'קטגוריה': opts.choices[0], 'מלאי נוכחי': 5, 'מלאי מינימום': 1, 'הערות': MARK });
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
  const created = await apiAs(mLogin.token, 'POST', enc('מלאי בסיסי'), { 'קטגוריה': 'קרטונים', 'הערות': MARK });
  if (!created?.id) throw new Error('הכתיבה לחריג המותר (מלאי) נכשלה');
  cleanup.push({ table: 'מלאי בסיסי', id: created.id });
  return 'כתיבה מחוץ לחריגים נחסמה, כתיבה בתוך חריג (מלאי) עברה';
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
