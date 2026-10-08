// ============================================================
// שרת Express + Airtable
// ============================================================
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getMeta, fetchRecords, createRecord, createRecords, updateRecord, deleteRecord, uploadAttachmentToRecord, getBase } from './airtable.js';
import { attachLinkedNames, invalidateIndex } from './resolve-links.js';
import {
  signToken, authenticate, authorizeRead, authorizeWrite,
  canReadTable, canWriteTable, ownFilterField, LOGIN_CODES_TABLE,
} from './auth.js';
import { notifyMakeWebhook } from './make-webhooks.js';
import { scheduleFridaysCheck } from './fridays.js';
import { analyzeExpenseInventory, approvePendingDeduction, readState, createManualExpense, runManualExpenseInventoryDeduction, validateManualExpenseInput, manualExpenseSubmitKey, claimManualExpenseSubmission, updateExpenseFreeNotes } from './inventory-deduction.js';
import { analyzeLogisticsInventory, shouldRetryLogistics, MAX_LOGISTICS_ATTEMPTS } from './logistics-deduction.js';
import { cascadeDocumentDelete, summarizeCascade } from './document-cascade.js';
import { fixFilenameEncoding } from './filename-utils.js';
import { sweep as sweepWeeklySync, INVOICES_TABLE, NOTES_TABLE } from './weekly-sync.js';
import { runAutoLink, SUPPLIERS_TABLE, MARKETERS_TABLE, EXPENSES_TABLE, CHECKS_TABLE, DELIVERY_TABLE } from './supplier-linking.js';
import { importSprayReport, deleteSprayReport, sprayReportsHistory, scheduleSprayReportImport, startSprayImportSweep, REPORTS_TABLE as SPRAY_REPORTS_TABLE } from './spray-report-import.js';
import { startLogisticsSweep } from './logistics-sweep.js';
import { checkForecastPreflight } from './forecast-preflight.js';
import { isForecastSourceTable, syncForecastForChangedRecord } from './forecast-sync.js';

const FORECAST_TABLE = 'תחזית שתילה שבועית';

const app = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // יוגבל ב-Production

// CORS: ב-Dev פתוח, ב-Production מוגבל
app.use(cors(NODE_ENV === 'production' && ALLOWED_ORIGIN !== '*'
  ? { origin: ALLOWED_ORIGIN, credentials: true }
  : { origin: ALLOWED_ORIGIN }
));
app.use(express.json());
// JSON לא-תקין בגוף הבקשה (body-parser זורק SyntaxError) — בלי זה Express
// מחזיר עמוד HTML "Bad Request" גנרי; הלקוח שלנו מצפה ל-JSON בכל תשובה
// (res.json() בעטיפת ה-API, ר' authFetch.js/App.jsx) ונכשל בפענוח בשקט.
// תוספת 2026-10-06 (M3, מצאה בבדיקת עמידות ל-POST /api/worker-login).
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'גוף הבקשה אינו JSON תקין' });
  }
  next(err);
});

// רישום מעבר הבקשות לפתרון בעיות (ללא נתונים רגישים)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================
// ENDPOINTS
// ============================================================

// מטא-נתונים — רשימת טבלאות. נתיב זה ציבורי בכוונה (נטען בעליית
// האפליקציה, גם לפני התחברות — ר' App.jsx). ממצא-אבטחה 2026-09-23:
// היה חושף גם את שמות השדות של טבלת "הרשאת מנהל" (כולל "קוד אישי")
// לכל קורא בלי טוקן — לא את הערכים עצמם (הטבלה חסומה מה-API הכללי
// בכל מקרה, ר' auth.js), אבל שם השדה עצמו הוא מידע-סיוע לתוקף שאין
// שום סיבה לחשוף. הטבלה מוסרת כאן לגמרי מהרשימה הציבורית.
app.get('/api/tables', async (_req, res) => {
  try {
    const tables = (await getMeta())
      .filter((t) => t.name !== LOGIN_CODES_TABLE)
      .map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => f.name) }));
    res.json(tables);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// שדות "מחושבים" ב-Airtable (formula/rollup/lookup/autoNumber/...) — Airtable
// דוחה כל כתיבה אליהם עם שגיאה ("cannot accept a value because the field is
// computed"). נחשף כאן כדי שטפסי עריכה/יצירה (RecordForm) יוכלו לסנן אותם
// אוטומטית מגוף הבקשה, בלי תלות בכך שמי שכתב את רשימת השדות של הטופס זכר
// לבדוק זאת ידנית (תקרית 2026-09-06: STRUCTURE_FORM_FIELDS כלל שני שדות
// formula במבנים, "שטח בדונם" ו"מספר שורות במבנה", והוספה/עריכה נכשלו).
const COMPUTED_FIELD_TYPES = new Set([
  'formula', 'rollup', 'multipleLookupValues', 'count',
  'createdTime', 'lastModifiedTime', 'autoNumber', 'createdBy', 'lastModifiedBy', 'button',
]);

// ============================================================
// הגנה קבועה: שריד בדיקה שנשאר ב-Airtable (למשל תקרית 2026-09-06 —
// גידול "__PLANT_TEST_...__" משנת 2099 ששכח להימחק) לעולם לא יגיע
// למשתמש אמיתי, גם אם ניקוי עתידי ייכשל. נבדק על ה-JSON הגולמי של כל
// רשומה לפני העשרה/קאש — התבניות ספציפיות מספיק כדי לא לפגוע ברשומה
// אמיתית בטעות (מזהי בדיקה תמיד כוללים __PLANT_TEST_ או QA- ואחריו
// חותמת-זמן ארוכה, לא טקסט חופשי שמישהו היה כותב).
//
// ⚠️ 2026-10-08 ("task Y") — הוסר גבול-המילה שהיה בסוף החלופה של QA
// (`\bQA-\d{10,}\b` → `\bQA-\d{10,}`). "\b" דרש תו-שאינו-תו-מילה אחרי
// הספרה האחרונה, ולכן **כל סמן-QA שאחריו אות או קו-תחתי חמק מהזיהוי
// בשקט**: "QA-1791448600878b" (MARK + סיומת — התבנית שבה qa-check מייצר
// קוד-שבוע שני ייחודי) לא נתפס כרשומת-בדיקה בכלל. זה לא תיאורטי —
// תעודת-המשלוח של QA שניכתה 1648 קרטונים/נילונים/כובעים ממלאי *אמיתי*
// ב-8.10 נשאה בדיוק את קוד-השבוע הזה. כיוון השינוי בטוח: הוא רק
// *מרחיב* את הזיהוי (יותר רשומות מסומנות כבדיקה, לא פחות), ורשומה
// אמיתית תצטרך להכיל "QA-" ואחריו 10+ ספרות כדי להיפגע.
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}|\bPERF-TEST\b/;
// ?includeTest=1 — יציאת חירום למערך הבדיקות (qa-check.mjs) בלבד: הוא
// יוצר וקורא בחזרה רשומות מתויגות-MARK כחלק מהאימות העצמי שלו, ולכן
// חייב לראות אותן; שום מסך אמיתי באפליקציה לא שולח את הפרמטר הזה.
// ⚠️ 7.10.2026, אגב-גילוי בזמן בדיקת סעיף Q: "מלאי בסיסי" הוא טבלה
// שונה-באופיה מכל שאר הטבלאות כאן — שדה "הערות" שלה הוא יומן-ביקורת
// שגדל לצמיתות (ר' logistics-deduction.js/inventory-deduction.js) ומכיל
// בלגיטימיות אזכורי-מסמכים שהיו פעם רשומות-QA (למשל "שבוע QA-...") גם
// כשהפריט **עצמו אמיתי-לגמרי**. בדיקה על ה-JSON השלם (כמו לכל טבלה
// אחרת) **מסתירה פריטי-מלאי אמיתיים** ברגע שההערות שלהם צוברות אזכור
// כזה — אומת בפועל: 3/7 פריטים אמיתיים ("קרטונים"/"כובעים"/שני
// "נילונים") נעלמו מהמסך הרגיל (בלי includeTest=1) אחרי סבב-בדיקות חי
// של סעיף P/Q באותו יום. לכן כאן, ורק כאן, בודקים את שדה "קטגוריה"
// בלבד (מה שבאמת מזהה שהרשומה-עצמה — לא ההיסטוריה שלה — נוצרה כבדיקה).
// ⚠️ 7.10.2026, ממצא שני מאותה משפחה (נתפס בבדיקת R/T): שדות **מחושבים**
// (lookup/rollup/formula) שואבים ערכים מרשומות **אחרות** — ולכן רשומה
// אמיתית-לגמרי "נדבקת" בסמן-QA ברגע שרשומת-בדיקה נקשרת אליה בעקיפין.
// אומת בפועל: שתי מבנים אמיתיים ("מבנה 1", "מבנה 6") נעלמו מכל המערכת
// כי השדה "סוג גידול (from תוכניות שתילה)" שלהם הכיל שם של גידול-QA
// שנקשר לתוכנית-שתילה-QA שמצביעה על אותו מבנה. בדיקת-בדיקה (האם זו
// רשומת-בדיקה?) חייבת להסתמך רק על השדות של הרשומה **עצמה**, לא על
// ערכים ששאובים מרשומות אחרות. לכן שדות מחושבים מוחרגים מההשוואה.
const computedFieldsCache = new Map(); // table -> { at, names:Set }
async function computedFieldNames(table) {
  const hit = computedFieldsCache.get(table);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.names;
  try {
    const t = (await getMeta()).find((x) => x.name === table);
    const names = new Set((t?.fields || []).filter((f) => COMPUTED_FIELD_TYPES.has(f.type)).map((f) => f.name));
    computedFieldsCache.set(table, { at: Date.now(), names });
    return names;
  } catch {
    return new Set(); // המטא לא זמין — נופלים להתנהגות השמרנית (כל השדות)
  }
}

// פרדיקט על רשומה בודדת (מופרד מ-stripTestRecords כדי שגם fetchRecords
// (airtable.js) יוכל להשתמש בו כ-filter תוך-כדי-דגימת-עמודים — ר' R3
// למטה: maxRecords חייב להתפרש כ-"N אחרי סינון", לא "N גולמי מ-Airtable").
function isTestRecord(rec, table, computed) {
  if (table === 'מלאי בסיסי') {
    return TEST_RECORD_PATTERN.test(String(rec['קטגוריה'] || ''));
  }
  if (computed?.size) {
    const own = {};
    for (const [k, v] of Object.entries(rec)) if (!computed.has(k)) own[k] = v;
    return TEST_RECORD_PATTERN.test(JSON.stringify(own));
  }
  return TEST_RECORD_PATTERN.test(JSON.stringify(rec));
}

function stripTestRecords(records, req, table, computed) {
  if (!Array.isArray(records) || req?.query?.includeTest === '1') return records;
  return records.filter((r) => !isTestRecord(r, table, computed));
}

// מטא-נתונים — שדות של טבלה ספציפית
app.get('/api/meta/:table', authenticate, async (req, res) => {
  try {
    const meta = await getMeta();
    const table = meta.find((t) => t.name === req.params.table);
    if (!table) return res.status(404).json({ error: 'טבלה לא נמצאה' });
    res.json({
      name: table.name,
      fields: table.fields.map((f) => f.name),
      computedFields: table.fields.filter((f) => COMPUTED_FIELD_TYPES.has(f.type)).map((f) => f.name),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// אפשרויות של שדה בחירה (singleSelect / multipleSelects).
// המסכים טוענים מכאן את הערכים המותרים, כדי לא לכתוב ל-Airtable
// ערך שאינו ברשימה — כתיבה כזו נדחית בשגיאת הרשאות.
app.get('/api/select-options/:table/:field', authenticate, async (req, res) => {
  try {
    const meta = await getMeta();
    const table = meta.find((t) => t.name === req.params.table);
    if (!table) return res.status(404).json({ error: 'טבלה לא נמצאה' });
    const field = table.fields.find((f) => f.name === req.params.field);
    if (!field) return res.status(404).json({ error: 'שדה לא נמצא' });
    res.json({
      field: field.name,
      type: field.type,
      choices: (field.options?.choices || []).map((c) => c.name),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// העלאת מסמך ל-Airtable (שדה Attachment)
//
// חייב להיות מוגדר לפני '/api/:table', אחרת Express מתאים את
// הבקשה לנתיב הכללי ומנסה ליצור רשומה בטבלה "upload-document".
// ============================================================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ============================================================
// מנעול-סדרתיות בזיכרון, לפי מפתח (למשל `expense:<id>` או
// `logistics:<table>:<id>`) — תוספת 2026-10-06 לילה 2 (ממצא M3: שתי
// בקשות analyze-inventory כמעט-בבת-אחת על אותה רשומה יכולות שתיהן
// לקרוא "מלאי נוכחי" לפני ששתיהן כותבות → הורדה כפולה, בגלל שהתגית-
// אידמפוטנטיות נכתבת רק *אחרי* ה-read-then-write, לא חוסמת את ה-race
// עצמו). לא פותר race בין שתי רשומות-מקור שונות שמורידות מאותו פריט-
// מלאי (זה ידרוש נעילה על הפריט, לא על המסמך — לא טופל הלילה, ר' לוג),
// אבל סוגר את התרחיש הספציפי שהתבקש: double-click/שני קליקים על אותה
// רשומה (אוטומטי+ידני, או שני טאבים). תור פשוט: כל קריאה עם מפתח נתון
// מחכה לקודמתה (אם נכשלה — לא חוסם קריאות עתידיות).
// ============================================================
const inventoryLocks = new Map(); // key -> Promise (השרשרת הפעילה האחרונה)
// export: logistics-sweep.js (task Y) מריץ את ההורדה המחזורית-שלו
// תחת אותו מנעול-בזיכרון, לפי מפתח `logistics:<table>:<id>` זהה לזה
// שהריטריי-החי משתמש בו — כך ששניהם לעולם לא רצים בבת-אחת על אותה
// רשומה (למשל אם הריטריי-החי עדיין באמצע backoff כש-tick של האיסוף
// המחזורי מגיע לאותה רשומה).
export function withInventoryLock(key, fn) {
  const prev = inventoryLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  inventoryLocks.set(key, run.catch(() => {}));
  return run;
}

/**
 * בדיקת תוכן הקובץ לפי "מספרי קסם" (magic bytes) — לא לפי סיומת/MIME שהדפדפן
 * מדווח (ניתנים לזיוף, למשל טקסט רגיל שנשמר בשם "קובץ.pdf"). מוודאת שהקובץ
 * הוא באמת PDF/JPEG/PNG לפני יצירת רשומה ב-Airtable ושליחה ל-Make לניתוח.
 */
function isValidDocumentFile(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return true; // "%PDF"
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true; // PNG
  return false;
}

app.post('/api/upload-document', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { table, field, weekCode } = req.body;
    if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });
    if (!table || !field) return res.status(400).json({ error: 'פרמטרים חסרים' });
    if (!canWriteTable(req.auth.role, table)) return res.status(403).json({ error: 'אין הרשאת עדכון לטבלה זו' });
    // מגבלת נקודת הקצה של Airtable להעלאת קובץ בבקשה אחת
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'הקובץ גדול מ-5MB. יש להעלות קובץ קטן יותר (תמונות מוקטנות אוטומטית).' });
    }
    if (!isValidDocumentFile(req.file.buffer)) {
      return res.status(400).json({ error: 'הקובץ אינו תקין. יש להעלות PDF, JPG או PNG תקין.', invalidFile: true });
    }

    // תיקון שם-קובץ שהתעקם ב-multer (קידוד latin1 בטעות על מקור UTF-8) —
    // ר' filename-utils.js. משמש גם בכתיבה ל-Airtable (שדה "שם קובץ"
    // אם קיים בטבלה) וגם בהעלאת ה-attachment עצמו.
    const fixedFilename = fixFilenameEncoding(req.file.originalname);

    // בדיקה אם לטבלה היעד יש שדה "שם קובץ" — best-effort, לא חוסמת
    // את ההעלאה אם קריאת המטא-נתונים נכשלה.
    let hasFilenameField = false;
    try {
      const meta = await getMeta();
      const tableMeta = meta.find((t) => t.name === table);
      hasFilenameField = !!tableMeta?.fields?.some((f) => f.name === 'שם קובץ');
    } catch (e) { console.error(`[upload-document] קריאת מטא-נתונים לבדיקת שדה "שם קובץ" נכשלה (לא חוסם — ממשיכים בלי השדה): ${e.message}`); }

    // 1) יצירת הרשומה (עם קוד שבוע כשנדרש) 2) העלאת הקובץ אליה.
    // אם ההעלאה נכשלת — הרשומה נמחקת, כדי שלא תישאר רשומה ריקה.
    const fields = {};
    if (weekCode && (table === 'חשבוניות' || table === 'תעודות משלוח')) {
      fields['קוד שבוע'] = weekCode;
    }
    if (hasFilenameField) {
      fields['שם קובץ'] = fixedFilename;
    }
    const created = await createRecord(table, fields);
    try {
      await uploadAttachmentToRecord(created.id, field, {
        filename: fixedFilename,
        contentType: req.file.mimetype,
        base64: req.file.buffer.toString('base64'),
      });
    } catch (uploadErr) {
      // אם מחיקת-הניקוי הזו עצמה נכשלת (למשל כשל-רשת חולף) — נשארת
      // רשומה ריקה-לגמרי בטבלה בלי שום לוג (ר' M3: ממצא אפשרי מאחורי
      // רשומות-יתומות כמו #34/#51 שתועדו היום — "קובץ נדחה אחרי שהרשומה
      // נוצרה"). עדיין לא חוסם את התגובה למשתמש (ההעלאה נכשלה ככה
      // וככה), אבל חשוב שיהיה עקבות בלוג השרת.
      await deleteRecord(table, created.id).catch((delErr) => console.error(`[upload-document] מחיקת רשומה ריקה ${created.id} (טבלה ${table}) נכשלה אחרי כשל העלאה: ${delErr.message} — ייתכן שנוצרה רשומה יתומה`));
      throw uploadErr;
    }
    invalidateReads(table);
    // טריגר ל-Make — רק אחרי שהרשומה+הקובץ נוצרו בהצלחה. fire-and-forget
    // בכוונה: לא await-ים, כשל כאן לא ישפיע על התגובה למשתמש.
    notifyMakeWebhook(table, created.id);
    // ניתוח מלאי אוטומטי להוצאה חדשה — fire-and-forget, עם backoff אם
    // הקובץ עוד לא זמין מיד אחרי ההעלאה (ר' inventory-deduction.js).
    if (table === 'הוצאות') autoAnalyzeExpenseInventory(created.id);
    // הורדת מלאי נגזרת (קרטונים/נילונים/כובעים/משטחים) מתעודת משלוח
    // או חשבונית — ר' logistics-deduction.js. fire-and-forget, עם
    // backoff לתת ל-Make זמן למלא את "כמות קרטונים"/"מספר משטחים".
    if (table === 'תעודות משלוח' || table === 'חשבוניות') autoAnalyzeLogisticsInventory(table, created.id);
    // דוח ריסוסים: ברקע מחכים שהניתוח של Make יתמלא ואז מייבאים את
    // השורות לטיפולים (ר' spray-report-import.js). fire-and-forget.
    if (table === SPRAY_REPORTS_TABLE) scheduleSprayReportImport(created.id, { afterImport: onSprayImported });
    res.status(201).json({ ok: true, record: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ניתוח מלאי אוטומטי להוצאה חדשה — רץ ברקע אחרי התגובה למשתמש,
// עם ניסיונות חוזרים (הקובץ שהועלה הרגע לא תמיד זמין מיד ב-URL של
// Airtable). כשל כאן אף פעם לא זורק — נרשם ללוג בלבד.
// ============================================================
async function autoAnalyzeExpenseInventory(expenseId, attempt = 0) {
  const MAX_ATTEMPTS = 4;
  try {
    const result = await withInventoryLock(`expense:${expenseId}`, () => analyzeExpenseInventory(expenseId));
    if (result.status === 'failed' && /אין קובץ מצורף/.test(result.error || '') && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      return autoAnalyzeExpenseInventory(expenseId, attempt + 1);
    }
    invalidateReads('הוצאות');
    invalidateReads('מלאי בסיסי');
    console.log(`[inventory-ai] הוצאה ${expenseId}: ${result.status}, ${(result.results || []).length} שורות`);
  } catch (e) {
    console.error(`[inventory-ai] הוצאה ${expenseId} נכשלה: ${e.message}`);
  }
}

// ============================================================
// הורדת מלאי נגזרת מתעודת משלוח/חשבונית (תוספת 2026-10-06, סעיף D) —
// רץ ברקע אחרי העלאת קובץ. בניגוד ל"הוצאות", אין כאן ניתוח AI על
// הקובץ עצמו — ממתינים ש-Make ימלא "כמות קרטונים"/"מספר משטחים" על
// הרשומה, ואז מצליבים וגוזרים הורדה. ר' logistics-deduction.js.
//
// ⚠️ תקרית אמיתית 2026-10-06 (לא השערה — נבדק מול Airtable חי): "יש
// ערך לא-ריק" היה ניחוש-בלבד לכך ש-Make סיים, ו-num() הפך שדה ריק ל-0
// (לא ל-null) — כך ש-deductOne כתב תגית-אידמפוטנטיות גם על "0" מזויף,
// ונעל לנצח הורדה אמיתית מאוחרת יותר (ר' הערת הכותרת ב-logistics-deduction.js
// לתעודות #45/#47 וחשבונית #61 שנפגעו בפועל). לאחר התיקון: "ממתין לנתון"
// (d.pending) לעולם לא כותב ל-Airtable בכלל, אז ריטריי בטוח ולא "נועל"
// כלום. ממשיכים לנסות גם כשיש תוצאות אבל כולן pending (לא רק
// results.length===0), עד כ-5 דקות סה"כ, עם לוג מפורט לכל ניסיון.
//
// ⚠️⚠️ תקרית אמיתית 2026-10-08 ("task Y"): הלופ עצר אחרי ניסיון אחד
// ברגע שחלק מהקטגוריות כבר ירדו וחלק עדיין המתינו ל-Make (`every`
// במקום `some`), והמשטחים ירדו רק בלחיצה ידנית. ההחלטה עברה לפונקציה
// טהורה ונבדקת — shouldRetryLogistics ב-logistics-deduction.js; שם גם
// ההסבר המלא, מספרי החשבוניות שנפגעו, והנמקת גודל-החלון מול היומן.
// הריטריי הזה הוא רשת-ביטחון ראשונה בלבד: הוא חי בזיכרון התהליך, ולכן
// restart/deploy מוחק אותו. רשת-הביטחון השנייה היא האיסוף המחזורי —
// ר' logistics-sweep.js ו-startLogisticsSweep למטה.
// ============================================================
// in-memory בלבד (לא נשרד restart) — לחשיפת מצב ההורדה האחרון לכל מסמך
// למסך ("מסמכים שהועלו לאחרונה"), כולל כפתור "נסה שוב". אין לטבלאות
// תעודות-משלוח/חשבוניות שדה "הערות" משלהן לשמור בו state (ר' הערת הכותרת).
const logisticsStatus = new Map(); // `${table}:${id}` -> { at, weekCode, cartonsCrossCheck, results, attempt }

function summarizeLogisticsResults(results) {
  if (!results.length) return 'אין תוצאות (אין עדיין נתון לגזור ממנו)';
  return results.map((r) => {
    if (r.pending) return `${r.sourceLabel || '?'}: ${r.skipped}`;
    if (r.deducted) return `${r.category}: ירד ${r.quantity}${r.softWarning ? ' ⚠' : ''}`;
    if (r.needsApproval) return `${r.category}: דורש אישור (${r.reason})`;
    return `${r.category || '?'}: ${r.skipped || 'דולג'}`;
  }).join(' | ');
}

function recordLogisticsStatus(table, id, result, attempt) {
  logisticsStatus.set(`${table}:${id}`, { at: Date.now(), attempt, ...result });
}

async function autoAnalyzeLogisticsInventory(table, recordId, attempt = 0) {
  try {
    // ⚠️⚠️ "task Y" — תקרית אמיתית 2026-10-08: לריטריי הזה *מעולם* לא
    // היה סינון רשומות-בדיקה (בניגוד ל-scheduleSprayReportImport ב-
    // spray-report-import.js, שכן בודק isTestRecord ובורח בשקט). זה היה
    // סמוי כל עוד החלון היה קצר, אבל הוא מסוכן בדיוק כאן: בדיקות
    // qa-check.mjs *חייבות* לצרף קובץ-אמת לטבלאות שמנוטרות ע"י Make
    // (אחרת תרחיש ה-Make נפל והושבת — תקריות 2-3.9), ו-Make מוציא
    // מהקובץ הזה כמויות *אמיתיות*. מכיוון שאי-אפשר ליצור פריט-מלאי-QA
    // בקטגוריה תפוסה (סעיף Q, 409), הקטגוריות קרטונים/נילונים/כובעים/
    // משטחי-עץ מצביעות *תמיד* על פריט-המלאי האמיתי היחיד — ולכן רשומת-QA
    // שהגיעה לכאן מנכה ממלאי אמיתי. זה קרה בפועל ב-8.10 (חשבונית-QA #81
    // לקחה 27 משטחים, תעודת-QA #101 לקחה 1648 מכל אחת משלוש הקטגוריות);
    // בוטל ידנית. הסינון (רק בניסיון הראשון — אין טעם לשלוף שוב בכל
    // ניסיון חוזר) סוגר את זה באותה תבנית כמו spray-report-import.js.
    if (attempt === 0) {
      const rec = await getBase()(table).find(recordId).catch(() => null);
      if (rec) {
        const computed = await computedFieldNames(table);
        if (isTestRecord({ id: rec.id, ...rec.fields }, table, computed)) {
          console.log(`[logistics-ai] ${table} ${recordId}: רשומת-בדיקה (QA/PERF-TEST) — דילוג מלא, אין ריטריי ואין ניתוח`);
          return;
        }
      }
    }
    // backoff עולה: 10 שנ' לניסיון הראשון, +10 לכל ניסיון, תקרה 2 דקות.
    // עם MAX_LOGISTICS_ATTEMPTS=20 ≈ 29 דקות סה"כ (ר' ההנמקה מול היומן
    // ב-logistics-deduction.js).
    const delay = Math.min(10000 * (attempt + 1), 120000);
    await new Promise((r) => setTimeout(r, delay));
    const result = await withInventoryLock(`logistics:${table}:${recordId}`, () => analyzeLogisticsInventory(table, recordId));
    recordLogisticsStatus(table, recordId, result, attempt);
    console.log(`[logistics-ai] ${table} ${recordId}: ניסיון ${attempt + 1}/${MAX_LOGISTICS_ATTEMPTS} — ${summarizeLogisticsResults(result.results)}`);
    // ⚠️ "task Y": אם *משהו* ירד בפועל בניסיון הזה — לרענן את הקאש מיד,
    // גם אם נמשיך לנסות. קודם invalidateReads רץ רק כשהלופ *נעצר*, וזה
    // היה אומר שבשרשרת-ריטריי ארוכה (עד 29 דק') המסך מציג מלאי מיושן
    // למרות שההורדה כבר בוצעה — בדיוק תסמין התלונה ("זה לא מתעדכן").
    if (result.results?.some((r) => r.deducted)) invalidateReads('מלאי בסיסי');
    // ⚠️ "task Y" — היה `every` (כל התוצאות pending), וזה עצר את הריטריי
    // מוקדם מדי ברגע שחלק מהקטגוריות כבר ירדו וחלק עדיין ממתינות (למשל
    // קרטונים ירדו, משטחים עדיין pending). shouldRetryLogistics (`some`)
    // ממשיך לנסות כל עוד *יש* תוצאה pending אחת לפחות — deductOne
    // אידמפוטנטי לכל קטגוריה בנפרד, כך שהורדה שכבר בוצעה לא חוזרת.
    if (shouldRetryLogistics(result.results, attempt)) {
      return autoAnalyzeLogisticsInventory(table, recordId, attempt + 1);
    }
    invalidateReads('מלאי בסיסי');
  } catch (e) {
    console.error(`[logistics-ai] ${table} ${recordId} נכשל (ניסיון ${attempt + 1}): ${e.message}`);
  }
}

app.post('/api/logistics/:table/:id/analyze-inventory', authenticate, requireOwner, async (req, res) => {
  try {
    const { table, id } = req.params;
    if (table !== 'תעודות משלוח' && table !== 'חשבוניות') return res.status(400).json({ error: 'טבלה לא נתמכת' });
    const result = await withInventoryLock(`logistics:${table}:${id}`, () => analyzeLogisticsInventory(table, id));
    recordLogisticsStatus(table, id, result, 0);
    invalidateReads('מלאי בסיסי');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// מצב ההורדה-הנגזרת האחרון לכל מסמכי טבלה אחת, בבת-אחת (למסך ההיסטוריה —
// נמנעים מ-N קריאות). authenticate בלבד (לא owner): זו מטא-דאטה על מצב
// עיבוד, לא מידע פיננסי רגיש.
app.get('/api/logistics/:table/status', authenticate, async (req, res) => {
  const { table } = req.params;
  const out = {};
  for (const [key, val] of logisticsStatus.entries()) {
    const [t, id] = key.split(':');
    if (t === table) out[id] = val;
  }
  res.json(out);
});

// ============================================================
// ניתוח מלאי להוצאה — ידני (כפתור "🔍 נתח מלאי", כולל הוצאות ישנות)
// + אישור הורדה ידנית לשורה "דורשת אישור". owner בלבד בכוונה: טבלת
// "הוצאות" כולה חסומה למנהל עבודה היום (MANAGER_READ לא כוללת אותה) —
// לא מרחיבים את החשיפה הפיננסית שלו כאן כתוצר-לוואי של הפיצ'ר הזה
// (ר' דיון בדוח-הבוקר, סעיף B6 במשימה מבקש "מנהל רואה תגים" — זה
// סותר את העיקרון הקיים "מנהל עבודה לא רואה כספים" ולכן לא יושם
// בלי אישור מפורש של תמר).
function requireOwner(req, res, next) {
  if (req.auth.role !== 'owner') return res.status(403).json({ error: 'פעולה זו זמינה למנהל הראשי בלבד' });
  next();
}

app.post('/api/expenses/:id/analyze-inventory', authenticate, requireOwner, async (req, res) => {
  try {
    const result = await withInventoryLock(`expense:${req.params.id}`, () => analyzeExpenseInventory(req.params.id, { force: req.query.force === '1' }));
    invalidateReads('הוצאות');
    invalidateReads('מלאי בסיסי');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/expenses/:id/analyze-inventory', authenticate, requireOwner, async (req, res) => {
  try {
    const base = (await import('./airtable.js')).getBase();
    const rec = await base('הוצאות').find(req.params.id);
    const state = readState(rec.fields['הערות']);
    res.json(state || { status: 'none' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/expenses/:id/analyze-inventory/approve', authenticate, requireOwner, async (req, res) => {
  try {
    const { lineIndex } = req.body || {};
    if (lineIndex == null) return res.status(400).json({ error: 'חסר lineIndex' });
    const result = await approvePendingDeduction(req.params.id, Number(lineIndex));
    invalidateReads('הוצאות');
    invalidateReads('מלאי בסיסי');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// עריכת הטקסט החופשי של "הערות" בהוצאה (ליל-חיזוק 2026-10-07, סעיף E4).
// נקודת-קצה נפרדת מה-PATCH הגנרי בכוונה: שדה "הערות" של הוצאה מחזיק
// גם את מצב הורדת-המלאי כ-JSON בשורת-סמן ([מלאי-AI], ר' inventory-
// deduction.js). כשהלקוח שלח את השדה **המלא** הוא בהכרח שלח סמן
// מה-snapshot שנטען לדפדפן — וההורדה היא fire-and-forget, כך שעריכת
// הערה מיד אחרי השמירה החזירה את מצב-ההורדה אחורה, ואז מחיקת ההוצאה
// לא החזירה למלאי את מה שכן ירד. כאן הלקוח שולח **רק** את הטקסט
// החופשי, והשרת קורא מחדש, מנקה שורות-סמן שהוקלדו, ומדביק את התגיות
// העכשוויות (ר' updateExpenseFreeNotes). owner בלבד, כמו כל שאר
// נקודות-הקצה של "הוצאות" (הטבלה חסומה למנהל עבודה).
// ============================================================
app.patch('/api/expenses/:id/notes', authenticate, requireOwner, async (req, res) => {
  try {
    const { freeText } = req.body || {};
    if (freeText != null && typeof freeText !== 'string') {
      return res.status(400).json({ error: 'freeText חייב להיות טקסט' });
    }
    const notes = await updateExpenseFreeNotes(req.params.id, freeText || '');
    invalidateReads('הוצאות');
    res.json({ id: req.params.id, 'הערות': notes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// סנכרון "סיכום שבועי" (תוספת 2026-10-06, סעיף D) — ר' weekly-sync.js.
// GET תמיד dry-run (שום כתיבה, ללא קשר לפרמטר) — דוח בלבד, לכל מי
// שמחובר. POST מבצע בפועל (owner בלבד): יוצר רשומות-שבוע חסרות
// ומקשר חשבוניות/תעודות משלוח אליהן לפי "קוד שבוע".
// ============================================================
app.get('/api/weekly/sync', authenticate, async (_req, res) => {
  try {
    const report = await sweepWeeklySync({ dryRun: true });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/weekly/sync', authenticate, requireOwner, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    const report = await sweepWeeklySync({ dryRun });
    if (!dryRun) { invalidateReads('סיכום שבועי'); invalidateReads(INVOICES_TABLE); invalidateReads(NOTES_TABLE); }
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// מסמך הוצאה ידני (תוספת 2026-10-06, סעיף E; עודכן סעיף J — אפשרות
// לצרף קובץ באותו חלון, וולידציית-שרת מלאה; עודכן סעיף R, 2026-10-07 —
// ספק חייב להיות רשומה קיימת בטבלת "ספקים" (לא טקסט חופשי): הלקוח
// שולח supplierId, השרת קורא את הרשומה ל-"שם ספק" וכותב גם קישור
// אמיתי (שדה 'ספקים') וגם את שדה הטקסט הישן 'ספק-AI' (לתאימות-לאחור
// עם כל מי שעדיין קורא אותו). כמו כן הורדת-המלאי הפכה fire-and-forget
// (ר' runManualExpenseInventoryDeduction) — לפני התיקון, ה-fetch של כל
// פריטי המלאי + updateRecord סדרתי לכל שורה רצו בתוך הבקשה עצמה וחסמו
// את התגובה ללקוח; עכשיו הרשומה נוצרת ומוחזרת מיד, וההורדה רצה ברקע
// בדיוק כמו autoAnalyzeExpenseInventory ב-/api/upload-document) — owner בלבד.
// אותם שדות -AI שהניתוח האוטומטי כותב אליהם.
//
// קובץ (אופציונלי): אם מצורף (multipart/form-data, 'file') — נקודת
// הקצה הקיימת הורחבה (upload.single('file'), במקום נתיב-העלאה נפרד),
// כדי שהטופס יישאר פעולה אחת אטומית מבחינת המשתמש. אחרי שהרשומה
// נוצרה קוראים ל-uploadAttachmentToRecord בדיוק כמו ב-/api/upload-document.
// בניגוד לשם — כאן *אין* מחיקה של הרשומה אם העלאת הקובץ נכשלת:
// ב-upload-document הרשומה ריקה-לגמרי לפני ההעלאה, כך שמחיקה "מנקה"
// בלי תופעות לוואי; כאן ייתכן שהמלאי כבר התחיל לרדת ברקע — מחיקת
// הרשומה הייתה משאירה הורדת-מלאי בלי רשומה שמצביעה עליה. במקום זאת
// מחזירים 207 עם fieldError כדי שהלקוח יודיע למשתמש שההוצאה נשמרה אך
// הקובץ לא עלה, בלי לאבד את ההורדה שבוצעה/תתבצע.
// ============================================================
app.post('/api/expenses/manual', authenticate, requireOwner, upload.single('file'), async (req, res) => {
  try {
    let { supplierId, date, total, category, notes, lines } = req.body || {};
    if (typeof lines === 'string') {
      try { lines = JSON.parse(lines); } catch { return res.status(400).json({ error: 'פורמט שורות הפריטים אינו תקין' }); }
    }
    // ולידציה עצמאית בשרת — לא מסתמכים על הלקוח (ר' validateManualExpenseInput)
    try {
      validateManualExpenseInput({ supplierId, date, total, category, lines });
    } catch (ve) {
      if (ve.statusCode === 400) return res.status(400).json({ error: ve.message });
      throw ve;
    }

    if (req.file) {
      if (req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'הקובץ גדול מ-5MB. יש להעלות קובץ קטן יותר (תמונות מוקטנות אוטומטית).' });
      }
      if (!isValidDocumentFile(req.file.buffer)) {
        return res.status(400).json({ error: 'הקובץ אינו תקין. יש להעלות PDF, JPG או PNG תקין.', invalidFile: true });
      }
    }

    // ספק חייב להיות קיים ברשימת "ספקים" — לא טקסט חופשי (סעיף R)
    //
    // ⚠️ ליל-חיזוק 2026-10-07 (המשך E1-E7, ממצא חדש) — `base(SUPPLIERS_TABLE)
    // .find(id)` **אינו** בודק שהרשומה שייכת לטבלה הזו: Airtable מחזיר כל
    // רשומה קיימת באותו base, מכל טבלה, כל עוד מזהה-הרשומה תקין. נמדד
    // בפועל: supplierId ששייך בפועל לרשומת "גידולים" אמיתית עבר את ה-find()
    // בהצלחה (עם fields של הגידול, לא של ספק) — ואז הכתיבה בפועל ל-Airtable
    // (קישור שדה "ספקים" בטבלת "הוצאות" לרשומה מטבלה אחרת) נכשלה ב-422
    // "the field links to table X" **מחוץ** לבלוק try/catch הזה, וחזרה
    // ללקוח כ-500 גולמי במקום 400 נקי. התיקון: קוראים את **כל** רשימת
    // הספקים (טבלה קטנה, כבר בשימוש בכל הקריאה הזו ממילא) ובודקים חברות
    // בפועל לפי מזהה, לא סומכים על find() שמוחזר-בהצלחה.
    const suppliers = await fetchRecords(SUPPLIERS_TABLE, {});
    const supplierRow = suppliers.find((s) => s.id === supplierId);
    if (!supplierRow) {
      return res.status(400).json({ error: 'ספק לא נמצא. יש לבחור ספק קיים מרשימת הספקים.' });
    }
    const supplierName = supplierRow['שם ספק'] || '';

    // הגנה מפני שמירה כפולה (ליל-חיזוק 2026-10-07, סעיף E5) — אחרי
    // הוולידציה ובדיקת הספק בכוונה, כדי שקלט שגוי לא "יתפוס" מפתח
    // ויחסום ניסיון מתוקן. בקשה זהה לחלוטין בתוך 15 שניות מקבלת את
    // אותה רשומה במקום ליצור שנייה (שהייתה גם מריצה Make פעם שנייה
    // וגם מורידה את אותן שורות מהמלאי פעם שנייה).
    const dedupKey = manualExpenseSubmitKey({ supplierId, date, total, category, notes, lines });
    const claim = claimManualExpenseSubmission(dedupKey);
    if (!claim.fresh) {
      const prior = await claim.wait();
      if (prior) return res.status(200).json({ ...prior, duplicateSubmit: true });
      return res.status(409).json({ error: 'בקשה זהה נשלחה כרגע ונכשלה. יש לנסות לשמור שוב.' });
    }

    let created;
    try {
      created = await createManualExpense({ supplierId, supplierName, date, total, category, notes, lines });
    } catch (createErr) {
      claim.settle(null);
      throw createErr;
    }
    claim.settle(created);
    const expenseNum = created['מספר הוצאה'];
    // ניתוח/הורדת מלאי — fire-and-forget, בדיוק כמו autoAnalyzeExpenseInventory
    // ב-/api/upload-document: לא חוסם את התגובה למשתמש (ר' הערת הכותרת, סעיף R)
    // ⚠️ 7.10.2026 (לילה 3): נוסף withInventoryLock — ההורדה-ברקע של הוצאה
    // ידנית הייתה הנתיב **היחיד** שרץ בלי המנעול, כך שלחיצה על "נתח מחדש"
    // (או מחיקת ההוצאה) בזמן שהיא עוד רצה פתחה בדיוק את ה-read-then-write
    // הכפול שהמנעול נוצר כדי למנוע (ממצא M3, 6.10).
    const runDeduction = () => withInventoryLock(`expense:${created.id}`, () => runManualExpenseInventoryDeduction(created.id, {
      supplier: supplierName, date, total, freeNotes: notes || '', lines, expenseNum,
    }))
      .then((state) => {
        invalidateReads('הוצאות');
        invalidateReads('מלאי בסיסי');
        // לוג מקביל ל-autoAnalyzeExpenseInventory — בלעדיו אין שום עקבות
        // בלוג להורדה שרצה ברקע (נמצא בפועל בזמן אבחון בדיקה שנכשלה)
        console.log(`[inventory-ai] הוצאה ידנית ${created.id}: ${state?.status}, ${(state?.results || []).length} שורות`);
      })
      .catch((e) => console.error(`[expenses/manual] הורדת מלאי להוצאה ${created.id} נכשלה: ${e.message}`));

    if (req.file) {
      try {
        await uploadAttachmentToRecord(created.id, 'חשבונית', {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
          base64: req.file.buffer.toString('base64'),
        });
      } catch (uploadErr) {
        invalidateReads('הוצאות');
        res.status(207).json({ ...created, fileError: `ההוצאה נשמרה אך העלאת הקובץ נכשלה: ${uploadErr.message}` });
        runDeduction();
        return;
      }
    }

    invalidateReads('הוצאות');
    res.status(201).json(created);
    runDeduction();
  } catch (e) {
    if (e.statusCode === 400) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// קישור ספקים/משווקים אוטומטי (2026-10-06, סעיף C) — ר' supplier-linking.js.
// owner בלבד: נוגע בכספים (הוצאות/צ׳קים/חשבוניות) ויכול ליצור/לכתוב
// רשומות ספק/משווק אמיתיות. GET הוא *תמיד* dryRun (בלי קשר לפרמטר) —
// קריאת GET לעולם לא כותבת, מתוך עקרון בטיחות נוסף על מה שהתבקש; רק
// POST עם dryRun=0 מפורש מבצע כתיבה בפועל. בלי פרמטר (או dryRun=1/כל
// ערך אחר) — תצוגה מקדימה בלבד.
// ============================================================
app.get('/api/suppliers/auto-link', authenticate, requireOwner, async (_req, res) => {
  try {
    const result = await runAutoLink({ dryRun: true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/suppliers/auto-link', authenticate, requireOwner, async (req, res) => {
  try {
    const dryRun = req.query.dryRun !== '0';
    const result = await runAutoLink({ dryRun });
    if (!dryRun) {
      [SUPPLIERS_TABLE, MARKETERS_TABLE, EXPENSES_TABLE, CHECKS_TABLE, INVOICES_TABLE, DELIVERY_TABLE].forEach(invalidateReads);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// דוחות ריסוסים → טיפולים (2026-10-06). קריאה: owner + manager (מנהל
// העבודה רואה את היומן); ייבוא: owner בלבד (יוצר רשומות "ריסוסים"
// ו"חומרי ריסוס"). חייב להיות לפני '/api/:table' (ר' RESERVED_PATHS).
// ============================================================
function onSprayImported() {
  invalidateReads('ריסוסים');
  invalidateReads('חומרי ריסוס');
}
function requireOwnerOrManager(req, res, next) {
  if (req.auth.role !== 'owner' && req.auth.role !== 'manager') return res.status(403).json({ error: 'אין הרשאה לצפות בדוחות הריסוסים' });
  next();
}

app.get('/api/spray-reports/history', authenticate, requireOwnerOrManager, async (req, res) => {
  try {
    const list = (await sprayReportsHistory())
      .filter((r) => req.query.includeTest === '1' || !r.isTest)
      .map(({ isTest, ...r }) => r);
    res.json(stripTestRecords(list, req));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// מחיקת דוח ריסוסים — owner בלבד, כי היא מוחקת גם טיפולים שיובאו ממנו.
// הטיפולים שסומנו ידנית "בוצע" נשארים (ר' deleteSprayReport).
app.delete('/api/spray-reports/:id', authenticate, requireOwner, async (req, res) => {
  try {
    const result = await deleteSprayReport(req.params.id);
    onSprayImported();
    res.json(result);
  } catch (e) {
    console.error(`[api] DELETE /api/spray-reports/${req.params.id}: ${e.message}`);
    sendApiError(res, e);
  }
});

app.post('/api/spray-reports/:id/import', authenticate, requireOwner, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === '1';
    const result = await importSprayReport(req.params.id, { dryRun });
    if (!dryRun) onSprayImported();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// preflight ל"רענן תחזית" (תוספת 2026-10-06, סעיף E) — בדיקה read-only
// בלבד (fetchRecords, בלי שום כתיבה) שבודקת אם לתוכנית-שתילה מסוימת
// יש את כל נתוני-הבסיס שהאוטומציה "רענן תחזית" ב-Airtable צריכה כדי
// להצליח (תפוקה רבעונית + מחיר גידול משוער). מוגדר כאן, *לפני* ה-
// middleware הכללי '/api/:table' למטה — אחרת '/api/plans/...' היה
// מתפרש כטבלה בשם "plans" שלא קיימת ונכשל ב-404, בדיוק כמו שההערה
// מעל '/api/upload-document' מסבירה.
// ============================================================
app.get('/api/plans/:id/forecast-preflight', authenticate, async (req, res) => {
  try {
    const result = await checkForecastPreflight(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// התחברות מנהל/בעל עסק — האימות (מייל + קוד אישי) בצד השרת.
// מקור האמת לתפקיד: טבלת "הרשאת מנהל", שדה "סוג".
// הקוד האישי לעולם לא נשלח לדפדפן.
// ============================================================
function adminRoleOf(rec) {
  const type = String(rec?.['סוג'] || 'מנהל ראשי').trim();
  return (type.includes('עבודה') || type.toLowerCase() === 'manager') ? 'manager' : 'owner';
}

const DEVICES_TABLE = 'מכשירי כניסה';

// ============================================================
// כניסה לפי מכשיר (device binding) — סעיף אבטחה 2026-09-06:
// כל משתמש נכנס רק מהמכשיר שבו נכנס לראשונה. למנהל ראשי מותרים 2
// מכשירים מאושרים; מעבר לזה (וכל מכשיר נוסף לתפקידים אחרים) דורש
// אישור ידני של המנהל הראשי דרך טבלת "מכשירי כניסה" (הרשומה נוצרת
// במצב "ממתין לאישור"). דה-גרדציה בטוחה: אם הטבלה עדיין לא קיימת
// ב-Airtable (טרם נוצרה — דורשת הרשאת סכמה שאין לטוקן הנוכחי), הכניסה
// ממשיכה כרגיל בלי אכיפה, כדי שלא לנעול אף אחד בטעות עד שהטבלה תיווצר.
async function checkDeviceBinding({ email, name, role, deviceId, deviceLabel }) {
  if (!deviceId) return { status: 'ok' }; // לקוח ישן/בלי JS תומך — לא חוסמים
  const names = await knownTableNames();
  if (!names.has(DEVICES_TABLE)) return { status: 'ok', tableMissing: true };

  const norm = (s) => String(s || '').trim().toLowerCase();
  const all = await fetchRecords(DEVICES_TABLE, {});
  const mine = all.filter((d) => norm(d['אימייל']) === norm(email));
  const existing = mine.find((d) => d['מזהה מכשיר'] === deviceId);

  if (existing) {
    const status = existing['סטטוס'];
    if (status === 'מאושר') {
      await updateRecord(DEVICES_TABLE, existing.id, { 'כניסה אחרונה': new Date().toISOString() }).catch(() => {});
      return { status: 'ok' };
    }
    if (status === 'נדחה') return { status: 'rejected' };
    return { status: 'pending' }; // עדיין "ממתין לאישור"
  }

  // מכשיר חדש שלא ראינו מעולם עבור המשתמש הזה
  const approvedCount = mine.filter((d) => d['סטטוס'] === 'מאושר').length;
  const limit = role === 'owner' ? 2 : 1;
  const autoApprove = approvedCount < limit;
  await createRecord(DEVICES_TABLE, {
    'אימייל': email,
    'שם משתמש': name || '',
    'תפקיד': role === 'owner' ? 'מנהל ראשי' : 'מנהל עבודה',
    'מזהה מכשיר': deviceId,
    'תיאור מכשיר': deviceLabel || '',
    'סטטוס': autoApprove ? 'מאושר' : 'ממתין לאישור',
    'כניסה אחרונה': new Date().toISOString(),
  }).catch(() => {});
  return { status: autoApprove ? 'ok' : 'pending' };
}

app.post('/api/admin-login', async (req, res) => {
  try {
    const { email, code, deviceId, deviceLabel } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'יש להזין אימייל וקוד אישי' });
    const admins = await fetchRecords('הרשאת מנהל', {});
    const norm = (s) => String(s || '').trim().toLowerCase();
    const found = admins.find((a) => norm(a['מייל']) === norm(email));
    if (!found) return res.status(401).json({ error: 'לא נמצא משתמש עם מייל זה במערכת' });
    if (norm(found['קוד אישי']) !== norm(code)) return res.status(401).json({ error: 'הקוד האישי שגוי' });
    const role = adminRoleOf(found);
    const name = found['Name'] || 'משתמש';

    const device = await checkDeviceBinding({ email: found['מייל'] || email, name, role, deviceId, deviceLabel });
    if (device.status === 'pending') {
      return res.status(403).json({ error: 'המכשיר הזה טרם אושר. הבקשה נשלחה למנהל הראשי לאישור.', devicePending: true });
    }
    if (device.status === 'rejected') {
      return res.status(403).json({ error: 'הכניסה ממכשיר זה נדחתה על ידי המנהל הראשי.', deviceRejected: true });
    }

    const token = signToken({ role, sub: found['מייל'] || email, name });
    res.json({ ok: true, role, name, email: found['מייל'] || email, type: found['סוג'] || '', token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// רענון תפקיד חי — נקרא בכל טעינה ומחזורית, כדי ששינוי "סוג" ב-Airtable ייתפס מיד.
// דורש טוקן תקף קיים; המייל נלקח מהטוקן עצמו (לא מגוף הבקשה) — אחרת כל אחד
// יכול היה לבדוק אם מייל כלשהו רשום כמנהל בלי שום אימות (דליפת מידע).
// מנפיק טוקן חדש עם התפקיד המעודכן, כדי שסשן פתוח יקבל הרשאות עדכניות מיד.
app.post('/api/admin-role', authenticate, async (req, res) => {
  try {
    const email = req.auth.sub;
    const admins = await fetchRecords('הרשאת מנהל', {});
    const norm = (s) => String(s || '').trim().toLowerCase();
    const found = admins.find((a) => norm(a['מייל']) === norm(email));
    if (!found) return res.status(404).json({ error: 'לא נמצא' });
    const role = adminRoleOf(found);
    const name = found['Name'] || 'משתמש';
    const token = signToken({ role, sub: found['מייל'] || email, name });
    res.json({ ok: true, role, name, type: found['סוג'] || '', token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// כניסת עובד — אימות כפול (אימייל + מספר דרכון) בצד השרת
// ============================================================
app.post('/api/worker-login', async (req, res) => {
  try {
    const { email, passport } = req.body || {};
    if (!email || !passport) return res.status(400).json({ error: 'יש להזין אימייל ומספר דרכון' });
    const workers = await fetchRecords('עובדים', {});
    const norm = (s) => String(s || '').trim().toLowerCase();
    const found = workers.find((w) => norm(w['מייל']) === norm(email) && norm(w['מספר דרכון']) === norm(passport));
    if (!found) return res.status(401).json({ error: 'האימייל ומספר הדרכון אינם תואמים לעובד רשום' });
    const name = `${found['שם פרטי'] || ''} ${found['שם משפחה'] || ''}`.trim() || 'עובד';
    const token = signToken({ role: 'worker', sub: found.id, name, email: found['מייל'] || email });
    res.json({
      ok: true,
      token,
      worker: {
        id: found.id,
        'שם פרטי': found['שם פרטי'] || '',
        'שם משפחה': found['שם משפחה'] || '',
        'מייל': found['מייל'] || '',
        'מספר דרכון': found['מספר דרכון'] || '',
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// תרגום הערת מנהל לעובד (סעיף 2026-09-06) — טקסט חופשי, לא ניתן
// לתרגם מראש כמו "סוג עבודה". פתרון זמני: MyMemory — שירות תרגום
// חינמי, ללא מפתח API, ללא התקנת חבילה. מגבלות אמיתיות: איכות
// תרגום בינונית לעברית↔תאילנדית (לא שפה נפוצה בשירות הזה), הגבלת
// קצב לא-רשמית (~5000 מילה/יום ללא הרשמה), ואין שום התחייבות זמינות —
// לא מתאים כפתרון קבוע לאפליקציה חיה. אם איכות/יציבות התרגום לא
// מספקת בפועל — הפתרונות הבאים דורשים החלטת הלקוחה (עלות + חשבון
// שירות חיצוני, לא משהו שאפשר להגדיר עבורה): Google Cloud Translation
// API (משלם לפי תווים, איכות גבוהה, תמיכה רשמית בתאילנדית), DeepL API
// (איכות מעולה, לא תומך רשמית בתאילנדית נכון לכתיבת שורות אלו — לבדוק
// לפני בחירה), Azure Translator (משלם, תמיכה רשמית בתאילנדית).
app.post('/api/translate', authenticate, async (req, res) => {
  try {
    const { text, target } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'אין טקסט לתרגום' });
    if (String(text).length > 480) return res.status(400).json({ error: 'הטקסט ארוך מדי לתרגום (מגבלת השירות החינמי)' });
    const lang = target === 'he' ? 'th|he' : 'he|th';
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${lang}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: 'שירות התרגום לא זמין כרגע' });
    const data = await r.json();
    const translated = data?.responseData?.translatedText;
    if (!translated) return res.status(502).json({ error: 'התרגום נכשל' });
    res.json({ translated });
  } catch (e) {
    console.error(`[translate] שגיאה בתרגום (target=${req.body?.target || '?'}): ${e.message}`);
    res.status(502).json({ error: 'שירות התרגום לא זמין כרגע' });
  }
});

// ============================================================
// מטמון קריאה קצר
//
// מסך אחד טוען לרוב 4–6 טבלאות, וכמה מסכים חולקים את אותן טבלאות
// (מבנים, עובדים, גידולים). בלי מטמון, כל מעבר בין מסכים משלם שוב
// את זמן ההשהיה של Airtable. חלון קצר שומר על נתונים טריים
// ומתנקה מיידית בכל כתיבה.
// ============================================================
const READ_TTL_MS = 30 * 1000;
const readCache = new Map(); // key -> { at, payload }

function cacheKeyFor(table, query) {
  // includeTest חייב להיות בטוח: אחרת בקשה עם ובלי הדגל ישתפו מפתח קאש
  // ואחד ה"קורא" את מה שהשני ביקש (זליגת שריד-בדיקה למשתמש אמיתי, או
  // הפוך — qa-check.mjs מקבל תוצאה מסוננת ונכשל בטעות).
  const relevant = ['filterByFormula', 'sortField', 'sortDirection', 'maxRecords', 'pageSize', 'raw', 'fields', 'includeTest'];
  return table + '|' + relevant.map((k) => `${k}=${query[k] ?? ''}`).join('&');
}

/** מנקה את המטמון לטבלה שהשתנתה (ואת כל התלויות בה, כי שמות מקושרים משתנים) */
function invalidateReads(table) {
  for (const key of readCache.keys()) {
    if (key.startsWith(table + '|')) readCache.delete(key);
  }
  // שם מקושר של הטבלה הזו מופיע גם ברשומות של טבלאות אחרות
  invalidateIndex(table);
  readCache.clear();
}

// ============================================================
// טבלה שאינה קיימת ב-Base → 404 עם הודעה ברורה בעברית
// (Airtable מחזיר לזה 403 עמום: "You are not authorized...")
// ============================================================
const RESERVED_PATHS = new Set(['tables', 'meta', 'select-options', 'upload-document', 'spray-reports', 'documents']);
let tableNamesCache = { at: 0, names: null };
async function knownTableNames() {
  if (tableNamesCache.names && Date.now() - tableNamesCache.at < 5 * 60 * 1000) return tableNamesCache.names;
  const names = new Set((await getMeta()).map((t) => t.name));
  tableNamesCache = { at: Date.now(), names };
  return names;
}
app.use('/api/:table', async (req, res, next) => {
  if (RESERVED_PATHS.has(req.params.table)) return next();
  try {
    const names = await knownTableNames();
    if (!names.has(req.params.table)) {
      return res.status(404).json({
        error: `הטבלה "${req.params.table}" אינה קיימת ב-Airtable`,
        missingTable: req.params.table,
      });
    }
  } catch { /* המטא לא זמין כרגע — הנתיב עצמו ידווח על השגיאה */ }
  next();
});
// אימות זהות — חובה מכאן ואילך לכל קריאה ל-/api/:table (קריאה וכתיבה
// כאחד). אין רשימה לבנה: כל בקשה בלי טוקן תקף נדחית ב-401. תקרית
// 2026-09-07: לפני זה כל קריאה ישירה (בלי שום כותרת) עברה, כולל
// קריאת טבלת קודי הכניסה עצמה.
app.use('/api/:table', (req, res, next) => {
  if (RESERVED_PATHS.has(req.params.table)) return next();
  return authenticate(req, res, next);
});

/** מוודא (בקריאה חוזרת מ-Airtable) שרשומה קיימת שייכת למשתמש-עובד לפני עדכון/מחיקה */
async function assertOwnRecord(req, res, table) {
  const field = ownFilterField(req.auth.role, table);
  if (!field) return true; // אין אכיפת-בעלות לתפקיד/טבלה הזו (כבר עבר canWriteTable)
  let rec;
  try {
    const base = (await import('./airtable.js')).getBase();
    rec = await base(table).find(req.params.id);
  } catch {
    res.status(404).json({ error: 'הרשומה לא נמצאה' });
    return false;
  }
  const linked = rec.fields[field];
  const ids = Array.isArray(linked) ? linked.map((x) => (x && typeof x === 'object' ? x.id : x)) : [];
  if (!ids.includes(req.auth.sub)) {
    res.status(403).json({ error: 'אין הרשאה לרשומה זו' });
    return false;
  }
  return true;
}

// מחזיר שגיאת-כתיבה/קריאה גנרית ללקוח. תוספת 2026-10-06 (M3): ספריית
// airtable.js מצרפת statusCode אמיתי (422/404/400 וכו') לשגיאות תקינות-
// נתונים (למשל ערך לא חוקי בשדה/קישור לרשומה שלא קיימת) — קודם כל אלו
// הפכו ל-500 גנרי בלי קשר לסיבה האמיתית, מה שהציג "שגיאת שרת" ללקוח גם
// כששורש הבעיה הוא קלט לא תקין (למשל טיפול/עבודה עם שדה-קישור שגוי).
// מעבירים הלאה רק קודי 4xx ידועים של Airtable; כל דבר אחר (כולל חוסר
// statusCode, 5xx, שגיאת-רשת) נשאר 500 כקודם.
function sendApiError(res, e) {
  const status = e?.statusCode;
  res.status(status >= 400 && status < 500 ? status : 500).json({ error: e.message });
}

// רשומות מטבלה (עם filters / sort / limit)
app.get('/api/:table', authorizeRead, async (req, res) => {
  try {
    const { table } = req.params;
    // ?fresh=1 — עוקף את המטמון (קריאה וכתיבה) במקור ובפלט. משמש מסכי
    // מעקב-אחרי-ניתוח (היסטוריית העלאות) שצריכים לראות מיד שדות ש-Make
    // כתב ישירות ל-Airtable בלי לעבור בשרת שלנו (ואין שום invalidateReads
    // שיודע לנקות את זה) — ר' תוספת 2026-10-06, סעיף L.
    const fresh = req.query.fresh === '1';
    const key = cacheKeyFor(table, req.query) + '|role=' + req.auth.role + (req.auth.sub || '');
    const cached = !fresh && readCache.get(key);
    if (cached && Date.now() - cached.at < READ_TTL_MS) {
      res.set('X-Cache', 'HIT');
      return res.json(cached.payload);
    }

    const opts = {};
    if (req.query.filterByFormula) opts.filterByFormula = req.query.filterByFormula;
    if (req.query.sortField) opts.sort = [{ field: req.query.sortField, direction: req.query.sortDirection || 'asc' }];
    if (req.query.maxRecords) opts.maxRecords = parseInt(req.query.maxRecords, 10);
    if (req.query.pageSize) opts.pageSize = parseInt(req.query.pageSize, 10);
    // שדות נבחרים בלבד (fields=a,b,c) — מאפשר לרשימות לוותר על שדות JSON כבדים
    if (req.query.fields) {
      const names = String(req.query.fields).split(',').map((f) => f.trim()).filter(Boolean);
      if (names.length) opts.fields = names;
    }
    // עובד: רק הרשומות ששייכות אליו. הערה חשובה: אי-אפשר לסנן את זה עם
    // filterByFormula ישירות על שדה קישור — ARRAYJOIN על שדה מקושר מחזיר
    // את שם הרשומה המקושרת (Primary Field), לא את מזהה ה-record שלה,
    // כך שהשוואה למזהה תמיד נכשלת בשקט. לכן מסננים כאן ב-Node (opts.fields
    // תמיד כולל את שדה השיוך גם אם הלקוח לא ביקש אותו, כדי שהסינון יהיה
    // אפשרי) — לא ניתן לעקוף מהלקוח.
    const ownField = ownFilterField(req.auth.role, table);
    if (ownField && opts.fields && !opts.fields.includes(ownField)) opts.fields.push(ownField);

    // ⚠️ 7.10.2026 (R3): כשיש ?maxRecords=N, אי-אפשר יותר לקרוא
    // fetchRecords(opts) עם maxRecords ואז לסנן (stripTestRecords +
    // ownField) אחרי — כי אז N הוא "N גולמי מ-Airtable", וסינון יכול
    // לצמצם אותו ל-פחות או לאפס (אומת בפועל: מבנים?maxRecords=1 החזיר
    // []). במקום זה בונים פרדיקט יחיד ומעבירים אותו ל-fetchRecords יחד
    // עם maxRecords; airtable.js דוגם עמוד-עמוד ועוצר רק כשיש מספיק
    // תוצאות *אחרי* הסינון (או שאזל המקור ב-Airtable).
    const includeTest = req.query.includeTest === '1';
    const computed = includeTest ? null : await computedFieldNames(table);
    const filter = (rec) => {
      if (!includeTest && isTestRecord(rec, table, computed)) return false;
      if (ownField) {
        const linked = rec[ownField];
        const ids = Array.isArray(linked) ? linked.map((x) => (x && typeof x === 'object' ? x.id : x)) : [];
        if (!ids.includes(req.auth.sub)) return false;
      }
      return true;
    };
    const records = await fetchRecords(table, { ...opts, filter });

    // העשרה: שדות מקושרים -> אובייקטים עם שם (אלא אם raw=1)
    const payload = req.query.raw === '1' ? records : await attachLinkedNames(table, records);
    if (!fresh) readCache.set(key, { at: Date.now(), payload });
    res.set('X-Cache', fresh ? 'BYPASS' : 'MISS');
    res.json(payload);
  } catch (e) {
    // לוג-הקשר (2026-10-06, M3): בלי זה כשל בטבלה כלשהי (כולל "עבודות
    // עובדים" מאפליקציית העובד) מגיע ללקוח כ-500 אבל נבלע בשקט בלוג השרת —
    // אין שום דרך לדעת איזו טבלה/תפקיד נכשלו בלי לשחזר מהלקוח.
    console.error(`[api] GET /api/${req.params.table} (role=${req.auth?.role || '?'}): ${e.message}`);
    sendApiError(res, e);
  }
});

// רשומה ספציפית
app.get('/api/:table/:id', authorizeRead, async (req, res) => {
  try {
    const base = (await import('./airtable.js')).getBase();
    const rec = await base(req.params.table).find(req.params.id);
    const ownField = ownFilterField(req.auth.role, req.params.table);
    if (ownField) {
      const linked = rec.fields[ownField];
      const ids = Array.isArray(linked) ? linked.map((x) => (x && typeof x === 'object' ? x.id : x)) : [];
      if (!ids.includes(req.auth.sub)) return res.status(403).json({ error: 'אין הרשאה לרשומה זו' });
    }
    res.json({ id: rec.id, ...rec.fields });
  } catch (e) {
    console.error(`[api] GET /api/${req.params.table}/${req.params.id} (role=${req.auth?.role || '?'}): ${e.message}`);
    sendApiError(res, e);
  }
});

// יצירת רשומה (או כמה רשומות — כשנשלח מערך, למשל בייבוא חגים)
// ============================================================
// הוספת אפשרות חדשה לשדה-בחירה (סעיף G, 7.10.2026) — "קטגוריה חדשה" במלאי.
// Airtable מאפשר זאת דרך הפרמטר הרשמי typecast=true בכתיבת רשומה: ערך
// שאינו ברשימה הופך לאפשרות חדשה. אין לנו הרשאת schema (PATCH למטא
// מחזיר 403), ולכן זו הדרך היחידה — והיא מוגבלת כאן בכוונה:
//   • מנהל ראשי בלבד;
//   • רק טבלאות/שדות ברשימה הלבנה למטה;
//   • רק שדות-בחירה (נבדק מול המטא בזמן הבקשה);
//   • הערך החדש חייב להיות טקסט סביר (לא ריק, עד 60 תווים).
// כל שדה אחר בגוף הבקשה שערכו אינו ברשימת האפשרויות שלו — נדחה, כדי
// ש-typecast לא "ייצר" בטעות אפשרויות בשדות אחרים.
// ============================================================
const TYPECAST_ALLOWED = { 'מלאי בסיסי': new Set(['קטגוריה']) };
async function validateTypecastRequest(req, table, body) {
  if (req.auth.role !== 'owner') return 'הוספת קטגוריה חדשה זמינה למנהל הראשי בלבד';
  const allowed = TYPECAST_ALLOWED[table];
  if (!allowed) return 'הוספת אפשרויות חדשות אינה מותרת בטבלה זו';
  const meta = (await getMeta()).find((t) => t.name === table);
  if (!meta) return 'טבלה לא נמצאה';
  for (const [name, value] of Object.entries(body || {})) {
    const f = meta.fields.find((x) => x.name === name);
    if (!f || !/singleSelect|multipleSelects/.test(f.type)) continue; // typecast משפיע רק על שדות-בחירה
    const choices = new Set((f.options?.choices || []).map((c) => c.name));
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v == null || v === '' || choices.has(v)) continue;
      if (!allowed.has(name)) return `לא ניתן להוסיף אפשרות חדשה לשדה "${name}"`;
      if (typeof v !== 'string' || !v.trim() || v.trim().length > 60) return `שם ${name} חדש חייב להיות טקסט של עד 60 תווים`;
    }
  }
  return null;
}

// ============================================================
// סעיף Q (7.10.2026, הוראת תמר): "קטגוריה אחת = פריט מלאי אחד" — מניעת
// יצירת/עדכון פריט ב"מלאי בסיסי" לקטגוריה שכבר יש לה פריט אחר. מופעל
// רק כש-body כולל "קטגוריה" (יצירה, או עדכון שמשנה אותה) — לא בכל כתיבה.
// לא נוגע בכפילויות שכבר קיימות בנתוני-האמת (למשל "נילונים" הכפולה,
// ר' progress.md) — אלה דורשות החלטת-מיזוג/מחיקה של תמר, לא פעולה
// אוטומטית; הבדיקה הזו רק חוסמת **הצטברות** כפילויות חדשות מעתה.
// ============================================================
// ⚠️ 7.10.2026 (לילה 3) — נורמליזציה: ההשוואה הייתה `trim()` בלבד, כך
// ש"משטחי  עץ" (רווח כפול) או הבדל-רישיות עקפו את הכלל לגמרי. מנרמלים
// רווחים-פנימיים ורישיות **לצורך ההשוואה בלבד** — הערך שנשמר ב-Airtable
// נשאר בדיוק כפי שנשלח.
function normalizeCategory(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
}

async function findDuplicateInventoryCategory(table, body, excludeId) {
  if (table !== 'מלאי בסיסי') return null;
  const category = body?.['קטגוריה'];
  if (category == null || String(category).trim() === '') return null;
  const normalized = normalizeCategory(category);
  const existing = await fetchRecords('מלאי בסיסי', {});
  // ⚠️ 7.10.2026 (לילה 3) — באג שנתפס חי, רגרסיה מסעיף Q עצמו: RecordForm
  // שולח ב-PATCH את **כל** שדות הטופס, כולל "קטגוריה", גם כשהמשתמשת שינתה
  // רק "מלאי נוכחי". לכן כל שמירה מטופס-העריכה של אחת משתי רשומות
  // "נילונים" הכפולות (כפילות-אמת שממתינה להחלטת תמר) נדחתה ב-409 —
  // כלומר שתי הרשומות האלה היו **בלתי-ניתנות-לעריכה בכלל**, בניגוד
  // מפורש לדרישה של תמר שעריכת "מלאי נוכחי" שלהן תמשיך לעבוד.
  // כתיבה שאינה *משנה* את הקטגוריה לא יכולה ליצור כפילות חדשה — ולכן
  // אינה נבדקת. אומת בפועל: PATCH ללא-שינוי → 200 (היה 409), ויצירת
  // כפילות אמיתית → עדיין 409.
  if (excludeId) {
    const self = existing.find((it) => it.id === excludeId);
    if (self && normalizeCategory(self['קטגוריה']) === normalized) return null;
  }
  // שריד-בדיקה (TEST_RECORD_PATTERN) לעולם לא נחשב "קיים" לצורך החסימה —
  // אחרת שתי רשומות QA בקטגוריית-QA חדשה-זהה היו חוסמות זו את זו בטעות,
  // ורשומת QA ישנה שלא נוקתה הייתה חוסמת יצירה אמיתית של קטגוריה.
  // ⚠️ הבדיקה היא רק על שדה "קטגוריה" עצמו, לא על ה-JSON השלם — "הערות"
  // של פריט-מלאי אמיתי גדלה לצמיתות ומכילה בלגיטימיות אזכורי-מסמכי-QA
  // ישנים (ר' stripTestRecords למעלה); בדיקה על ה-JSON השלם הייתה הופכת
  // כל פריט אמיתי עם היסטוריה כזו ל"לא-קיים" ומאפשרת כפילות אמיתית —
  // בדיוק הבאג שנתפס בפועל (7.10) כש-rec0yfZ9t3Nd6CZCz (קרטונים כפול)
  // נוצר כי recrVGLabAmqJNGNY הוחרג בטעות.
  const dup = existing.find((it) =>
    it.id !== excludeId &&
    !TEST_RECORD_PATTERN.test(String(it['קטגוריה'] || '')) &&
    normalizeCategory(it['קטגוריה']) === normalized
  );
  return dup || null;
}

// ⚠️ 7.10.2026 (לילה 3), מרוץ שאומת בפועל: findDuplicateInventoryCategory
// היא read-then-write (fetchRecords מלא, מאות מילי-שניות) — שלוש בקשות
// POST מקבילות לאותה קטגוריה *פנויה* קיבלו כולן 201 ויצרו שלוש רשומות
// באותה קטגוריה, בדיוק מה שסעיף Q אמור למנוע (שוחזר בניסיון השני).
// מפתח-נעילה אחד גלובלי (ולא לפי-קטגוריה) בכוונה: שתי קטגוריות שונות
// שמתלכדות אחרי נורמליזציה חייבות להסתדר גם הן בתור.
const INVENTORY_CATEGORY_LOCK = 'inventory-category';
function needsCategoryLock(table, body) {
  return table === 'מלאי בסיסי' && body?.['קטגוריה'] != null && String(body['קטגוריה']).trim() !== '';
}

app.post('/api/:table', authorizeWrite, async (req, res) => {
  try {
    const { table } = req.params;
    const ownField = ownFilterField(req.auth.role, table);
    if (Array.isArray(req.body)) {
      if (ownField) return res.status(403).json({ error: 'יצירה קבוצתית אינה נתמכת עבור הרשאה זו' });
      if (req.body.length > 100) return res.status(400).json({ error: 'עד 100 רשומות בבקשה אחת' });
      const created = await createRecords(table, req.body);
      invalidateReads(table);
      if (isForecastSourceTable(table)) {
        created.forEach((rec) => syncForecastForChangedRecord(table, rec, { reason: 'יצירה קבוצתית' }));
        invalidateReads(FORECAST_TABLE);
      }
      return res.status(201).json(created);
    }
    // עובד: שדה השיוך נכפה תמיד להיות הרשומה של עצמו, בלי קשר למה שנשלח —
    // מונע יצירת רשומה בשם עובד אחר דרך payload מזויף.
    const body = ownField ? { ...req.body, [ownField]: [req.auth.sub] } : req.body;
    const typecast = req.query.typecast === '1';
    if (typecast) {
      const problem = await validateTypecastRequest(req, table, body);
      if (problem) return res.status(403).json({ error: problem });
    }
    // בדיקת-כפילות + יצירה בתוך אותו מנעול — אחרת שתי בקשות מקבילות
    // שתיהן "לא מצאו כפילות" ושתיהן יוצרות (ר' הערה ב-needsCategoryLock)
    const checkThenCreate = async () => {
      const dup = await findDuplicateInventoryCategory(table, body, null);
      if (dup) return { dup };
      return { created: await createRecord(table, body, { typecast }) };
    };
    const outcome = needsCategoryLock(table, body)
      ? await withInventoryLock(INVENTORY_CATEGORY_LOCK, checkThenCreate)
      : await checkThenCreate();
    if (outcome.dup) return res.status(409).json({ error: `כבר קיים פריט מלאי בקטגוריה "${body['קטגוריה']}"`, existingId: outcome.dup.id });
    const created = outcome.created;
    invalidateReads(table); // כדי שהרשומה החדשה תיקרא מיד ותיפתר לשם
    if (isForecastSourceTable(table)) {
      syncForecastForChangedRecord(table, created, { reason: 'יצירה' });
      invalidateReads(FORECAST_TABLE);
    }
    res.status(201).json(created);
  } catch (e) {
    console.error(`[api] POST /api/${req.params.table} (role=${req.auth?.role || '?'}): ${e.message}`);
    sendApiError(res, e);
  }
});

// עדכון רשומה
app.patch('/api/:table/:id', authorizeWrite, async (req, res) => {
  try {
    const { table } = req.params;
    if (!(await assertOwnRecord(req, res, table))) return;
    const ownField = ownFilterField(req.auth.role, table);
    // עובד לא יכול "להעביר" רשומה לעובד אחר דרך עדכון שדה השיוך
    const body = ownField && req.body?.[ownField] ? { ...req.body, [ownField]: [req.auth.sub] } : req.body;
    const typecast = req.query.typecast === '1';
    if (typecast) {
      const problem = await validateTypecastRequest(req, table, body);
      if (problem) return res.status(403).json({ error: problem });
    }
    const checkThenUpdate = async () => {
      const dup = await findDuplicateInventoryCategory(table, body, req.params.id);
      if (dup) return { dup };
      return { updated: await updateRecord(table, req.params.id, body, { typecast }) };
    };
    const outcome = needsCategoryLock(table, body)
      ? await withInventoryLock(INVENTORY_CATEGORY_LOCK, checkThenUpdate)
      : await checkThenUpdate();
    if (outcome.dup) return res.status(409).json({ error: `כבר קיים פריט מלאי בקטגוריה "${body['קטגוריה']}"`, existingId: outcome.dup.id });
    const updated = outcome.updated;
    invalidateReads(table);
    if (isForecastSourceTable(table)) {
      syncForecastForChangedRecord(table, updated, { reason: 'עדכון' });
      invalidateReads(FORECAST_TABLE);
    }
    res.json(updated);
  } catch (e) {
    console.error(`[api] PATCH /api/${req.params.table}/${req.params.id} (role=${req.auth?.role || '?'}): ${e.message}`);
    sendApiError(res, e);
  }
});

const CASCADE_TABLES = new Set(['הוצאות', 'חשבוניות', 'תעודות משלוח']);

// תצוגה-מקדימה (dryRun) של מחיקה-מדורגת — "מחיקה תחזיר למלאי X, תנתק מ-Y"
// לפני שהמשתמש מאשר (סעיף P3.8). אותה פונקציה בדיוק שמופעלת לפני
// המחיקה-האמיתית, רק בלי לכתוב כלום.
// ⚠️ 7.10.2026, נתפס בבדיקה חיה: "documents" לא היה ברשימת RESERVED_PATHS,
// כך שה-middleware הגנרי ל-"/api/:table" (שתי שורות: בדיקת-טבלה-קיימת +
// authenticate) יירט כל בקשה לנתיב הזה וטיפל ב-"documents" עצמו כאילו
// הוא שם-טבלה — 404 מיידי, לפני שהראוטר הספציפי הזה בכלל רץ. הנתיב הזה
// **מעולם לא עבד בפועל** מאז שנוצר (סעיף P3) — נבלם תמיד ב-404, מוסתר
// מהלקוח כי RecordForm.jsx עוטף את הקריאה ב-try/catch שקט ("נוחות, לא
// חובה"). תוקן: "documents" נוסף ל-RESERVED_PATHS (לכן authenticate
// מופעל כאן מפורשות — הוא לא רץ יותר אוטומטית מה-middleware הגנרי).
app.get('/api/documents/:table/:id/cascade-preview', authenticate, authorizeWrite, async (req, res) => {
  try {
    const { table, id } = req.params;
    if (!CASCADE_TABLES.has(table)) return res.json({ inventory: [], week: null, checksLinked: 0, errors: [] });
    // ⚠️ 7.10.2026 (לילה 3): מזהה שלא קיים החזיר 200 עם דוח ריק — זהה
    // לחלוטין ל"מסמך קיים בלי שום השפעה על מלאי". המשתמשת הייתה מקבלת
    // "המחיקה לא תחזיר כלום" על מסמך שבכלל לא קיים. עכשיו 404 מפורש.
    const report = await cascadeDocumentDelete(table, id, { dryRun: true });
    if (report.notFound) return res.status(404).json({ error: 'המסמך לא נמצא', notFound: true });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// מחיקה
app.delete('/api/:table/:id', authorizeWrite, async (req, res) => {
  try {
    const { table, id } = req.params;
    if (!(await assertOwnRecord(req, res, table))) return;
    // מחיקה-מדורגת (cascade, סעיף P3 — 2026-10-07): החזרת-מלאי + ניתוק/
    // מחיקת רשומת-שבוע. ר' document-cascade.js. **הפעולה הקריטית היא
    // החזרת-המלאי** — אם זו נכשלה, לא ממשיכים למחיקה בפועל (לא רוצים
    // למחוק הוצאה/מסמך ולאבד את היכולת-לדעת-מה-להחזיר); ניתוק-השבוע
    // הוא best-effort (לא חוסם מחיקה אם נכשל).
    // סנכרון-תחזית (ר' forecast-sync.js): חייבים לקרוא את הרשומה *לפני*
    // המחיקה כדי לדעת לאיזה גידול היא שייכת — אחרי deleteRecord אין מה
    // לקרוא יותר. best-effort: אם הקריאה נכשלת, ממשיכים למחיקה בלי סנכרון
    // (לא חוסמים מחיקה בגלל זה).
    let forecastSyncSource = null;
    if (isForecastSourceTable(table)) {
      try {
        const base = (await import('./airtable.js')).getBase();
        const rec = await base(table).find(id);
        forecastSyncSource = { id: rec.id, ...rec.fields };
      } catch (e) {
        console.error(`[forecast-sync] לא ניתן היה לקרוא ${table}/${id} לפני מחיקה: ${e.message}`);
      }
    }
    let cascade = null;
    if (CASCADE_TABLES.has(table)) {
      // ⚠️ 7.10.2026 (לילה 3) — שלוש תקלות שאומתו חי, כולן נסגרות כאן:
      //
      // 1) **מנעול**: המחיקה-המדורגת לא רצה תחת withInventoryLock, בניגוד
      //    לכל נתיבי ההורדה (autoAnalyzeExpenseInventory/analyze-inventory).
      //    לכן מחיקת הוצאה *בזמן* שההורדה-ברקע (fire-and-forget) עוד רצה
      //    קראה state חלקי, החזירה רק חלק מהכמות, ומחקה את ההוצאה —
      //    והשורות שירדו אחרי הקריאה נותרו חסרות במלאי לנצח (ה-state
      //    נשמר על ההוצאה שכבר לא קיימת → sourceGone). אותו מפתח בדיוק
      //    כמו נתיבי-ההורדה, כך שמחיקה *מחכה* לסיום ההורדה.
      // 2) **אימות-קיום לפני כתיבה**: `DELETE /api/תעודות משלוח/<מזהה שלא
      //    קיים>` החזיר 404 — *אחרי* שכבר החזיר 30 יחידות למלאי וכתב שורת
      //    "↩ ביטול" בהערות הפריט. כלומר תשובת-שגיאה שבכל זאת שינתה מלאי.
      //    האימות נמצא **בתוך** המנעול בכוונה, כך שמחיקה-כפולה מקבילה
      //    רואה שהרשומה כבר איננה ולא מריצה ביטול-הורדה שני.
      // 3) **המחיקה עצמה בתוך המנעול**: קודם ה-deleteRecord היה אחרי
      //    הבלוק, מחוץ לסדרתיות — שתי מחיקות מקבילות יכלו שתיהן לעבור
      //    את הביטול לפני שמישהי מחקה.
      const lockKey = table === EXPENSES_TABLE ? `expense:${id}` : `logistics:${table}:${id}`;
      const outcome = await withInventoryLock(lockKey, async () => {
        try {
          await getBase()(table).find(id);
        } catch {
          return { missing: true };
        }
        const report = await cascadeDocumentDelete(table, id, { dryRun: false });
        if (report.errors.some((e) => e.startsWith('מלאי:'))) return { report, blocked: true };
        await deleteRecord(table, id);
        return { report };
      });
      if (outcome.missing) {
        return res.status(404).json({ error: 'המסמך לא נמצא — ייתכן שכבר נמחק. לא בוצעה שום פעולת-מלאי.' });
      }
      cascade = outcome.report;
      if (outcome.blocked) {
        console.error(summarizeCascade(cascade));
        return res.status(500).json({ error: `ביטול הורדת-המלאי נכשל — המסמך לא נמחק כדי לא לאבד מעקב. ${cascade.errors.join('; ')}` });
      }
      console.log(summarizeCascade(cascade));
      invalidateReads('מלאי בסיסי');
      if (cascade.week) invalidateReads('סיכום שבועי');
      if (table === 'תעודות משלוח' || table === 'חשבוניות') logisticsStatus.delete(`${table}:${id}`);
    } else {
      await deleteRecord(table, id);
    }
    invalidateReads(table);
    if (forecastSyncSource) {
      syncForecastForChangedRecord(table, forecastSyncSource, { reason: 'מחיקה' });
      invalidateReads(FORECAST_TABLE);
    }
    res.json({ ok: true, cascade });
  } catch (e) {
    console.error(`[api] DELETE /api/${req.params.table}/${req.params.id} (role=${req.auth?.role || '?'}): ${e.message}`);
    sendApiError(res, e);
  }
});

// ============================================================
// שובר-מעגל אחרון לכל שגיאה ולכל נתיב-API לא מוכר (לילה 3, 7.10.2026 —
// בדיקת עמידות). הבלוק הזה חייב להיות **אחרי כל הראוטים**: מטפל-שגיאות
// ב-Express נבחר לפי סדר ההרשמה, ולכן המטפל שרשום בראש הקובץ (JSON לא
// תקין) לא תופס שגיאות שנזרקות בראוטים/ב-multer שמוגדרים אחריו — הן
// נפלו עד כה למטפל ברירת-המחדל של Express שמחזיר **HTML**.
//
// למה זה חשוב: כל קריאות הלקוח עוברות ב-serverErrorMessage (App.jsx)
// שעושה `res.json()` ונכשל בשקט על HTML. אומת בפועל מול השרת:
//   • גוף JSON מעל 100kb        → HTML 413  → המשתמש ראה טוסט "שגיאה" חשוף
//   • קובץ העלאה מעל 15MB       → HTML 500  → "תקלה בתקשורת עם השרת"
//     (במקום "הקובץ גדול מדי") — התרחיש הסביר ביותר בפועל: סריקת PDF
//     מהטלפון עוברת 15MB בקלות, והמשתמש חושב שהשרת שבור.
//   • multipart פגום/קטוע       → HTML 500
//   • נתיב /api לא מוכר         → HTML 404 "Cannot GET ..."
// מעתה כל אלה מוחזרים כ-JSON עם הודעה בעברית, בדיוק כמו כל שאר ה-API.
// ============================================================
app.use('/api', (req, res) => {
  res.status(404).json({ error: `נתיב לא קיים: ${req.method} ${req.originalUrl.split('?')[0]}` });
});

app.use((err, req, res, _next) => {
  // הודעת השגיאה המקורית נרשמת תמיד ללוג השרת — אבל לעולם לא מוחזרת
  // ללקוח כמו-שהיא (היא כוללת stack ונתיבי-קבצים מוחלטים).
  console.error(`[api] שגיאה לא-מטופלת ב-${req.method} ${req.originalUrl}: ${err?.message || err}`);

  if (res.headersSent) return; // התשובה כבר יצאה (למשל 207 בהוצאה ידנית)

  const code = err?.code || err?.type;
  if (code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'הקובץ גדול מדי. יש להעלות קובץ עד 5MB.' });
  }
  if (code === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413) {
    return res.status(413).json({ error: 'הבקשה גדולה מדי. יש לקצר את התוכן ולנסות שוב.' });
  }
  if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_PART_COUNT') {
    return res.status(400).json({ error: 'שגיאה בשדות הקובץ בבקשה.' });
  }
  // multipart קטוע (חיבור שנקטע באמצע העלאה / גוף פגום) — busboy זורק
  // "Unexpected end of form". זו שגיאת-קלט, לא תקלת-שרת.
  if (/Unexpected end of form|Malformed part|Unsupported content type|Boundary not found/i.test(err?.message || '')) {
    return res.status(400).json({ error: 'ההעלאה נקטעה או שהבקשה פגומה. יש לנסות שוב.' });
  }
  const status = err?.statusCode || err?.status;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message });
  }
  res.status(500).json({ error: 'תקלה בשרת. יש לנסות שוב בעוד רגע.' });
});

app.listen(PORT, () => {
  console.log(`✅ שרת Zite רץ על http://localhost:${PORT}`);
  warmUpLinkIndex();
  scheduleFridaysCheck(); // ימי שישי תמיד ב"ימי אי עבודה" — ר' fridays.js
  // דוחות ריסוסים שנותחו אבל טרם יובאו לטיפולים — איסוף ~60 שניות אחרי
  // העלייה ואז כל 10 דקות (רק דוחות מאחרי תאריך-הסף; ר' spray-report-import.js)
  startSprayImportSweep({ afterImport: onSprayImported });
  // "task Y": אותה תבנית בדיוק, להורדת-מלאי נגזרת מתעודות-משלוח/חשבוניות
  // שהריטריי-החי-בזיכרון החמיץ (למשל restart באמצע המתנה ל-Make) —
  // ר' logistics-sweep.js להסבר המלא ולתיחום-הבטיחות (cutoff).
  startLogisticsSweep({
    lock: withInventoryLock,
    onResult: (table, id, result) => { recordLogisticsStatus(table, id, result, 'sweep'); invalidateReads('מלאי בסיסי'); },
  });
});

// ============================================================
// חימום מטמון אינדקס הקישורים בעליית השרת
// ------------------------------------------------------------
// אינדקס שם-תצוגה של כל טבלה נבנה ב-lazy (בקריאה הראשונה אליה) ונשמר
// 5 דקות. "מבנים" מקושרת כמעט מכל טבלה תפעולית — בלעדי חימום, המשתמש
// האמיתי הראשון אחרי כל restart/deploy סופג את זמן הבנייה (נמדד: עד
// כ-4 שניות) על המסך הראשון שהוא פותח. רץ ברקע, לא חוסם את עליית
// השרת, ולא נכשל בקול רם אם Airtable איטי/לא זמין באותו רגע.
// ============================================================
async function warmUpLinkIndex() {
  // "עבודות עובדים" ו"הוצאות" נוספו אחרי מדידה: לוח הבקרה קורא את שתיהן
  // ללא raw=1 (כלומר עם פענוח קישורים), ו"עבודות עובדים" (עד 3000
  // רשומות, מקושרת לעובדים/מבנים/תמחור עבודות) נמדדה ב-1.27 שניות
  // בקריאה קרה ראשונה — זה חלק ניכר מזמן הטעינה הראשוני של לוח הבקרה.
  const tables = ['מבנים', 'עובדים', 'גידולים', 'עבודות עובדים', 'הוצאות'];
  for (const t of tables) {
    try {
      const records = await fetchRecords(t, { maxRecords: 1 });
      await attachLinkedNames(t, records);
    } catch { /* חימום best-effort — כשל כאן לא אמור להשפיע על תפקוד השרת */ }
  }
}
