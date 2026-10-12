// ============================================================
// מסמכי עובד — צילום דרכון (משימה AE, 12.10.2026)
// ------------------------------------------------------------
// תמר: "אופציה לעלות מסמך צילום דרכון לעובד."
//
// השדה `צילום דרכון` (multipleAttachments) **כבר קיים** בטבלת
// `עובדים` (אומת מול המטא ב-12.10), והתצוגה שלו קיימת מאז ב-
// WorkersPage.jsx — מה שחסר היה ההעלאה. לכן אין כאן שדה חדש ואין
// מה לעשות ידנית ב-Airtable.
//
// ⚠️ **אותו מנגנון** כמו העלאת מסמכי הוצאות, בכוונה ובמדויק:
// `uploadAttachmentToRecord` → content.airtable.com/.../uploadAttachment
// עם base64 בגוף הבקשה. הקובץ **אינו** נשמר על הדיסק של השרת בשום
// שלב (לא /tmp ולא uploads/) — הוא עובר בזיכרון מ-multer ישר
// ל-Airtable. אותה מגבלת 5MB (מגבלת נקודת-הקצה של Airtable לבקשה
// אחת) ואותה בדיקת magic-bytes.
//
// קישורי-attachment של Airtable פגים אחרי ~2 שעות. **אין כאן פרוקסי
// ואין cache** — בדיוק כמו במסמכי הוצאות: הלקוח מקבל את ה-URL מתוך
// הרשומה בכל קריאה, וקריאה טרייה מייצרת URL טרי. מה שחשוב הוא לא
// לשמור את ה-URL בשום מקום (לא ב-state מתמשך, לא ב-localStorage) —
// ר' invalidateReads אחרי כל כתיבה כאן.
//
// ⚠️ מה שהמודול הזה **לא** עושה, במתכוון: אינו מפעיל ניתוח-מסמכים,
// אינו קורא ל-Make (notifyMakeWebhook), אינו מתזמן
// scheduleSprayReportImport ואינו נוגע במלאי. צילום דרכון אינו
// חשבונית — כל טריגר כזה כאן היה שורף קרדיטים של הלקוחה על מסמך
// שאין מה לנתח בו (ר' תקריות 2-3.9 ב-CLAUDE.md).
//
// לוג: שם-קובץ מנוקה + מזהה-עובד בלבד. לא מספר דרכון, לא שם העובד.
// ============================================================
import { getBase, updateRecord, uploadAttachmentToRecord } from './airtable.js';
import { fixFilenameEncoding } from './filename-utils.js';

export const WORKERS_TABLE = 'עובדים';
export const PASSPORT_FIELD = 'צילום דרכון';
/** מגבלת נקודת-הקצה של Airtable להעלאה בבקשה אחת — זהה ל-upload-document */
export const MAX_PASSPORT_BYTES = 5 * 1024 * 1024;

/** 403 לעובד, 404 לעובד-שלא-קיים — שגיאה עם statusCode כמו בשאר השרת */
function httpError(status, message) {
  return Object.assign(new Error(message), { statusCode: status });
}

/**
 * מי מורשה לגעת במסמכי עובד. **מנהל-עבודה כן** — הוא זה שמנהל את
 * כוח-האדם בשטח ורואה את טבלת `עובדים` ממילא (MANAGER_READ ב-auth.js).
 * זו הרשאה נקודתית לשדה הזה בלבד, ולכן היא נבדקת כאן במפורש ולא דרך
 * `canWriteTable` — הוספת `עובדים` ל-MANAGER_WRITE הייתה פותחת לו גם
 * שינוי שכר/סטטוס/מספר-דרכון, מה שלא התבקש.
 * עובד — 403 **גם על קריאה**: צילום דרכון של עובד אחר הוא מסמך מזהה.
 */
export function canManageWorkerDocuments(role) {
  return role === 'owner' || role === 'manager';
}

export function assertCanManage(role) {
  if (!canManageWorkerDocuments(role)) {
    throw httpError(403, 'צפייה וניהול של מסמכי עובדים זמינים למנהל ראשי ומנהל עבודה בלבד');
  }
}

/** קיים? (מחזיר את הרשומה; 404 אם לא) — אותה התנהגות ל-GET/POST/DELETE */
async function findWorker(workerId) {
  try {
    return await getBase()(WORKERS_TABLE).find(workerId);
  } catch {
    throw httpError(404, 'העובד לא נמצא');
  }
}

/** מתאר את הקובץ לתצוגה, בלי לדלוף שדות אחרים של העובד */
function describe(att) {
  if (!att) return null;
  return {
    id: att.id,
    filename: att.filename || '',
    type: att.type || '',
    size: att.size || 0,
    url: att.url || '',
    // PDF אין לו thumbnails — הלקוח מציג אייקון במקום ממוזערת
    thumbnail: att.thumbnails?.large?.url || att.thumbnails?.small?.url || null,
  };
}

/** GET — מה יש לעובד הזה (ה-URL טרי, כי הוא נקרא מהרשומה עכשיו) */
export async function getWorkerPassport(workerId, role) {
  assertCanManage(role);
  const rec = await findWorker(workerId);
  const list = rec.fields[PASSPORT_FIELD];
  const att = Array.isArray(list) && list.length ? list[0] : null;
  return { passport: describe(att) };
}

/**
 * POST — העלאה/החלפה. Airtable מצרף ל**סוף** מערך ה-attachments, ולכן
 * "החלפה" היא: העלאה, ואז השארת האחרון בלבד. עושים זאת בשני שלבים
 * ולא בכתיבה ישירה של מערך-עם-URL, כי כתיבת attachment לפי URL דורשת
 * כתובת ציבורית — ואין לנו כזו (וגם לא רוצים: זה היה חושף את הצילום).
 * `isValidFile` מוזרקת (ב-server.js: isValidDocumentFile) כדי שהמודול
 * יישאר נבדק בלי לייבא את server.js.
 */
export async function setWorkerPassport(workerId, role, file, { isValidFile } = {}) {
  assertCanManage(role);
  if (!file || !file.buffer) throw httpError(400, 'לא נבחר קובץ');
  if (file.size > MAX_PASSPORT_BYTES) {
    throw httpError(400, 'הקובץ גדול מ-5MB. יש להעלות קובץ קטן יותר.');
  }
  // magic-bytes: סיומת ו-MIME שהדפדפן מדווח ניתנים לזיוף לחלוטין
  // (txt שנשמר כ-passport.jpg). אותה פונקציה בדיוק כמו במסמכי הוצאות.
  if (isValidFile && !isValidFile(file.buffer)) {
    throw httpError(400, 'הקובץ אינו תקין. יש להעלות PDF, JPG או PNG תקין.');
  }
  const rec = await findWorker(workerId);
  const before = Array.isArray(rec.fields[PASSPORT_FIELD]) ? rec.fields[PASSPORT_FIELD] : [];
  const filename = fixFilenameEncoding(file.originalname || 'passport');

  await uploadAttachmentToRecord(workerId, PASSPORT_FIELD, {
    filename,
    contentType: file.mimetype,
    base64: file.buffer.toString('base64'),
  });

  // החלפה: משאירים את החדש בלבד. קוראים מחדש (ולא מסתמכים על `before`)
  // כי ההעלאה עצמה שינתה את הרשומה.
  let kept = null;
  const after = await getBase()(WORKERS_TABLE).find(workerId);
  const list = Array.isArray(after.fields[PASSPORT_FIELD]) ? after.fields[PASSPORT_FIELD] : [];
  if (list.length > 1) {
    kept = list[list.length - 1];
    await updateRecord(WORKERS_TABLE, workerId, { [PASSPORT_FIELD]: [{ id: kept.id }] });
  } else {
    kept = list[0] || null;
  }

  console.log(`[worker-docs] צילום דרכון הועלה לעובד ${workerId}: "${filename}" (${Math.round(file.size / 1024)}KB)${before.length ? ' — החליף קובץ קודם' : ''}`);
  return { ok: true, replaced: before.length > 0, passport: describe(kept) };
}

/** DELETE — ניקוי השדה. אידמפוטנטי: מחיקה כשאין קובץ מחזירה ok. */
export async function deleteWorkerPassport(workerId, role) {
  assertCanManage(role);
  const rec = await findWorker(workerId);
  const list = Array.isArray(rec.fields[PASSPORT_FIELD]) ? rec.fields[PASSPORT_FIELD] : [];
  if (!list.length) return { ok: true, deleted: false };
  await updateRecord(WORKERS_TABLE, workerId, { [PASSPORT_FIELD]: [] });
  console.log(`[worker-docs] צילום דרכון נמחק לעובד ${workerId}`);
  return { ok: true, deleted: true };
}
