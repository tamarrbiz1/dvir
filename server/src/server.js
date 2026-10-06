// ============================================================
// שרת Express + Airtable
// ============================================================
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getMeta, fetchRecords, createRecord, createRecords, updateRecord, deleteRecord, uploadAttachmentToRecord } from './airtable.js';
import { attachLinkedNames, invalidateIndex } from './resolve-links.js';
import {
  signToken, authenticate, authorizeRead, authorizeWrite,
  canReadTable, canWriteTable, ownFilterField, LOGIN_CODES_TABLE,
} from './auth.js';
import { notifyMakeWebhook } from './make-webhooks.js';
import { scheduleFridaysCheck } from './fridays.js';
import { analyzeExpenseInventory, approvePendingDeduction, readState, reverseInventoryDeduction, createManualExpense } from './inventory-deduction.js';
import { analyzeLogisticsInventory } from './logistics-deduction.js';
import { fixFilenameEncoding } from './filename-utils.js';
import { sweep as sweepWeeklySync, INVOICES_TABLE, NOTES_TABLE } from './weekly-sync.js';
import { runAutoLink, SUPPLIERS_TABLE, MARKETERS_TABLE, EXPENSES_TABLE, CHECKS_TABLE, DELIVERY_TABLE } from './supplier-linking.js';

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
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}\b|\bPERF-TEST\b/;
// ?includeTest=1 — יציאת חירום למערך הבדיקות (qa-check.mjs) בלבד: הוא
// יוצר וקורא בחזרה רשומות מתויגות-MARK כחלק מהאימות העצמי שלו, ולכן
// חייב לראות אותן; שום מסך אמיתי באפליקציה לא שולח את הפרמטר הזה.
function stripTestRecords(records, req) {
  if (!Array.isArray(records) || req?.query?.includeTest === '1') return records;
  return records.filter((r) => !TEST_RECORD_PATTERN.test(JSON.stringify(r)));
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
    } catch { /* לא קריטי — ממשיכים בלי שדה שם הקובץ */ }

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
      await deleteRecord(table, created.id).catch(() => {});
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
    const result = await analyzeExpenseInventory(expenseId);
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
// ⚠️ סיכון פתוח, אומת בפועל בבדיקה (ר' qa-check.mjs): ל"הוצאות" יש לנו
// סימן-state משלנו ([מלאי-AI]) שמאפשר לדעת בוודאות שניתוח Make הסתיים
// לפני שאנחנו קוראים את התוצאה. לתעודת-משלוח/חשבונית **אין** סימן כזה —
// "יש ערך לא-ריק" הוא ניחוש, לא אישור שה-Make-ניתוח הסתיים וסופי. אם
// הניסיון הראשון קולט ערך-ביניים/שגוי ומצליח להוריד מלאי (לא "נכשל",
// אז אין ניסיון חוזר!) — התגית-אידמפוטנטיות תחסום הורדה נכונה בהמשך.
// ההמתנה הארוכה (עד ~2 דקות) מקטינה את הסיכון אך לא מבטלת אותו.
// עד שתהיה דרך אמינה יותר לדעת ש-Make סיים (למשל webhook ממנו, כמו
// notifyMakeWebhook בכיוון ההפוך) — מומלץ לתמר לאמת ידנית דרך
// POST /api/logistics/:table/:id/analyze-inventory אחרי שרואה בעין
// שהשדות התמלאו נכון בטבלה, ולא להסתמך רק על הטריגר האוטומטי.
// ============================================================
async function autoAnalyzeLogisticsInventory(table, recordId, attempt = 0) {
  const MAX_ATTEMPTS = 6;
  try {
    await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
    const result = await analyzeLogisticsInventory(table, recordId);
    if (!result.results.length && attempt < MAX_ATTEMPTS - 1) {
      return autoAnalyzeLogisticsInventory(table, recordId, attempt + 1);
    }
    invalidateReads('מלאי בסיסי');
    console.log(`[logistics-ai] ${table} ${recordId}: ${result.results.length} פעולות מלאי`);
  } catch (e) {
    console.error(`[logistics-ai] ${table} ${recordId} נכשל: ${e.message}`);
  }
}

app.post('/api/logistics/:table/:id/analyze-inventory', authenticate, requireOwner, async (req, res) => {
  try {
    const { table, id } = req.params;
    if (table !== 'תעודות משלוח' && table !== 'חשבוניות') return res.status(400).json({ error: 'טבלה לא נתמכת' });
    const result = await analyzeLogisticsInventory(table, id);
    invalidateReads('מלאי בסיסי');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    const result = await analyzeExpenseInventory(req.params.id, { force: req.query.force === '1' });
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
// מסמך הוצאה ידני (תוספת 2026-10-06, סעיף E) — owner בלבד, בלי קובץ.
// אותם שדות -AI שהניתוח האוטומטי כותב אליהם, הורדת מלאי מיידית.
// ============================================================
app.post('/api/expenses/manual', authenticate, requireOwner, async (req, res) => {
  try {
    const { supplier, date, total, category, notes, lines } = req.body || {};
    if (!supplier && !total) return res.status(400).json({ error: 'יש למלא לפחות ספק או סכום' });
    const created = await createManualExpense({ supplier, date, total, category, notes, lines });
    invalidateReads('הוצאות');
    invalidateReads('מלאי בסיסי');
    res.status(201).json(created);
  } catch (e) {
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
const RESERVED_PATHS = new Set(['tables', 'meta', 'select-options', 'upload-document']);
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

// רשומות מטבלה (עם filters / sort / limit)
app.get('/api/:table', authorizeRead, async (req, res) => {
  try {
    const { table } = req.params;
    const key = cacheKeyFor(table, req.query) + '|role=' + req.auth.role + (req.auth.sub || '');
    const cached = readCache.get(key);
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
    // כך שהשוואה למזהה תמיד נכשלת בשקט. לכן מסננים כאן ב-Node, אחרי
    // הקריאה — לא ניתן לעקוף מהלקוח (opts.fields תמיד כולל את שדה
    // השיוך גם אם הלקוח לא ביקש אותו, כדי שהסינון יהיה אפשרי).
    const ownField = ownFilterField(req.auth.role, table);
    if (ownField && opts.fields && !opts.fields.includes(ownField)) opts.fields.push(ownField);
    let records = stripTestRecords(await fetchRecords(table, opts), req);
    if (ownField) {
      records = records.filter((r) => {
        const linked = r[ownField];
        const ids = Array.isArray(linked) ? linked.map((x) => (x && typeof x === 'object' ? x.id : x)) : [];
        return ids.includes(req.auth.sub);
      });
    }

    // העשרה: שדות מקושרים -> אובייקטים עם שם (אלא אם raw=1)
    const payload = req.query.raw === '1' ? records : await attachLinkedNames(table, records);
    readCache.set(key, { at: Date.now(), payload });
    res.set('X-Cache', 'MISS');
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// יצירת רשומה (או כמה רשומות — כשנשלח מערך, למשל בייבוא חגים)
app.post('/api/:table', authorizeWrite, async (req, res) => {
  try {
    const { table } = req.params;
    const ownField = ownFilterField(req.auth.role, table);
    if (Array.isArray(req.body)) {
      if (ownField) return res.status(403).json({ error: 'יצירה קבוצתית אינה נתמכת עבור הרשאה זו' });
      if (req.body.length > 100) return res.status(400).json({ error: 'עד 100 רשומות בבקשה אחת' });
      const created = await createRecords(table, req.body);
      invalidateReads(table);
      return res.status(201).json(created);
    }
    // עובד: שדה השיוך נכפה תמיד להיות הרשומה של עצמו, בלי קשר למה שנשלח —
    // מונע יצירת רשומה בשם עובד אחר דרך payload מזויף.
    const body = ownField ? { ...req.body, [ownField]: [req.auth.sub] } : req.body;
    const created = await createRecord(table, body);
    invalidateReads(table); // כדי שהרשומה החדשה תיקרא מיד ותיפתר לשם
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const updated = await updateRecord(table, req.params.id, body);
    invalidateReads(table);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// מחיקה
app.delete('/api/:table/:id', authorizeWrite, async (req, res) => {
  try {
    const { table } = req.params;
    if (!(await assertOwnRecord(req, res, table))) return;
    // מחיקת הוצאה (ידנית או אוטומטית) מחזירה למלאי כל מה שהיא הורידה —
    // לפני המחיקה בפועל (ר' תוספת 2026-10-06, סעיף E). כשל בביטול לא
    // חוסם את המחיקה עצמה — ההוצאה עדיין נמחקת, רק בלי שהמלאי יתעדכן
    // (יישאר מתועד בלוג השרת לבדיקה ידנית).
    if (table === 'הוצאות') {
      await reverseInventoryDeduction(req.params.id).catch((e) => console.error(`[inventory-ai] ביטול הורדה נכשל להוצאה ${req.params.id}: ${e.message}`));
      invalidateReads('מלאי בסיסי');
    }
    await deleteRecord(table, req.params.id);
    invalidateReads(table);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ שרת Zite רץ על http://localhost:${PORT}`);
  warmUpLinkIndex();
  scheduleFridaysCheck(); // ימי שישי תמיד ב"ימי אי עבודה" — ר' fridays.js
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
