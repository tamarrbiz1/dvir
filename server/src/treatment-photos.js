// ============================================================
// תמונות לטיפול — שדה `תמונות` בטבלת `ריסוסים` (משימה AS-3, 14.10.2026)
// ------------------------------------------------------------
// תמר: "ואפשרות להעלות תמונה — כבר יש באיירטבל שדה מתאים."
//
// השדה `תמונות` (multipleAttachments) **כבר קיים** בטבלת `ריסוסים`
// (אומת מול המטא ב-14.10) — אין שדה חדש ואין מה לעשות ידנית ב-Airtable.
// בניגוד ל`צילום דרכון` של עובד, כאן זו **גלריה**: כמה תמונות לאותו
// טיפול, ולכן יש גם מחיקה של תמונה בודדת לפי מזהה-צרופה.
//
// ⚠️ **אותו מנגנון בדיוק** כמו צילום דרכון (worker-documents.js, AE):
// `uploadAttachmentToRecord` → content.airtable.com/.../uploadAttachment
// עם base64 בגוף הבקשה. הקובץ **אינו** נשמר על הדיסק של השרת בשום שלב
// (לא /tmp ולא uploads/) — הוא עובר בזיכרון מ-multer ישר ל-Airtable.
// אותה מגבלת 5MB (מגבלת נקודת-הקצה של Airtable לבקשה אחת) ואותה בדיקת
// magic-bytes.
//
// קישורי-attachment של Airtable פגים אחרי ~2 שעות. **אין כאן פרוקסי
// ואין cache** — הלקוח מקבל את ה-URL מתוך הרשומה בכל קריאה, וקריאה
// טרייה מייצרת URL טרי. ר' invalidateReads אחרי כל כתיבה כאן.
//
// ⚠️ מה שהמודול הזה **לא** עושה, במתכוון: אינו מפעיל ניתוח-מסמכים,
// אינו קורא ל-Make (notifyMakeWebhook), אינו מתזמן
// scheduleSprayReportImport ואינו נוגע במלאי — ובפרט **אינו נוגע בשדה
// `דוח ריסוסים`**, שהוא ה-attachment של הדוח עצמו (זה שכן עובר ניתוח).
// תמונת-שטח של טיפול אינה דוח ואינה חשבונית; כל טריגר כזה כאן היה שורף
// קרדיטים של הלקוחה על מסמך שאין מה לנתח בו (ר' תקריות 2-3.9 ב-CLAUDE.md).
// ============================================================
import { getBase, updateRecord, uploadAttachmentToRecord } from './airtable.js';
import { canWriteTable } from './auth.js';
import { fixFilenameEncoding } from './filename-utils.js';

export const TREATMENTS_TABLE = 'ריסוסים';
export const PHOTOS_FIELD = 'תמונות';
/** מגבלת נקודת-הקצה של Airtable להעלאה בבקשה אחת — זהה ל-upload-document */
export const MAX_TREATMENT_PHOTO_BYTES = 5 * 1024 * 1024;
/** גלריה, לא ארכיון: תקרה שמונעת רשומה עם מאות צרופות */
export const MAX_TREATMENT_PHOTOS = 12;

function httpError(status, message) {
  return Object.assign(new Error(message), { statusCode: status });
}

/**
 * מי מורשה לנהל תמונות של טיפול. **אין כאן הרשאה חדשה ואין הרחבה**:
 * נגזר מ-`canWriteTable(role, 'ריסוסים')` הקיים, כלומר מנהלת ראשית
 * (owner) בלבד — בדיוק כמו שמירת הטיפול עצמו במסך (canEdit ב-
 * TreatmentsPage) ובדיוק כמו `PUT /api/ריסוסים/:id`. מנהל-עבודה אינו
 * קורא את `ריסוסים` בכלל (MANAGER_READ), ועובד בוודאי שלא — שניהם
 * מקבלים 403, גם על קריאה. `server/src/auth.js` לא נגענו בו.
 */
export function canManageTreatmentPhotos(role) {
  return canWriteTable(role, TREATMENTS_TABLE);
}

export function assertCanManage(role) {
  if (!canManageTreatmentPhotos(role)) {
    throw httpError(403, 'צפייה וניהול של תמונות הטיפול זמינים למנהלת הראשית בלבד');
  }
}

/** קיים? (מחזיר את הרשומה; 404 אם לא) — אותה התנהגות ל-GET/POST/DELETE */
async function findTreatment(treatmentId) {
  try {
    return await getBase()(TREATMENTS_TABLE).find(treatmentId);
  } catch {
    throw httpError(404, 'הטיפול לא נמצא');
  }
}

/** מתאר צרופה לתצוגה, בלי לדלוף שדות אחרים של הטיפול */
function describe(att) {
  if (!att) return null;
  return {
    id: att.id,
    filename: att.filename || '',
    type: att.type || '',
    size: att.size || 0,
    url: att.url || '',
    thumbnail: att.thumbnails?.large?.url || att.thumbnails?.small?.url || null,
  };
}

function photosOf(rec) {
  const list = rec?.fields?.[PHOTOS_FIELD];
  return Array.isArray(list) ? list : [];
}

/** GET — התמונות של הטיפול (ה-URL טרי, כי הוא נקרא מהרשומה עכשיו) */
export async function getTreatmentPhotos(treatmentId, role) {
  assertCanManage(role);
  const rec = await findTreatment(treatmentId);
  return { photos: photosOf(rec).map(describe) };
}

/**
 * POST — הוספת תמונה לגלריה. Airtable מצרף ל**סוף** מערך ה-attachments,
 * ולכן אין צורך לכתוב מערך בעצמנו (וגם לא היינו יכולים: כתיבת
 * attachment לפי URL דורשת כתובת ציבורית — ואין לנו כזו).
 * `checkFile` מוזרקת (ב-server.js: checkTreatmentPhotoFile) כדי שהמודול
 * יישאר נבדק בלי לייבא את server.js.
 */
export async function addTreatmentPhoto(treatmentId, role, file, { checkFile } = {}) {
  assertCanManage(role);
  if (!file || !file.buffer) throw httpError(400, 'לא נבחרה תמונה');
  if (file.size > MAX_TREATMENT_PHOTO_BYTES) {
    throw httpError(400, 'הקובץ גדול מ-5MB. יש להעלות תמונה קטנה יותר (תמונות מוקטנות אוטומטית בדפדפן).');
  }
  // magic-bytes: סיומת ו-MIME שהדפדפן מדווח ניתנים לזיוף לחלוטין
  // (txt שנשמר כ-photo.jpg). אותה בדיקה בדיוק כמו במסמכי הוצאות/דרכון,
  // עם ההודעה המפורטת של AM-3 שאומרת **מה** זוהה.
  if (checkFile) {
    const verdict = checkFile(file.buffer);
    if (!verdict?.ok) throw httpError(400, verdict?.message || 'הקובץ אינו תמונה תקינה. יש להעלות JPG או PNG.');
  }
  const rec = await findTreatment(treatmentId);
  const before = photosOf(rec);
  if (before.length >= MAX_TREATMENT_PHOTOS) {
    throw httpError(400, `יש כבר ${before.length} תמונות לטיפול הזה (המקסימום ${MAX_TREATMENT_PHOTOS}). יש למחוק תמונה לפני הוספה.`);
  }
  const filename = fixFilenameEncoding(file.originalname || 'photo.jpg');

  await uploadAttachmentToRecord(treatmentId, PHOTOS_FIELD, {
    filename,
    contentType: file.mimetype,
    base64: file.buffer.toString('base64'),
  });

  // קוראים מחדש (ולא מסתמכים על `before`) כי ההעלאה עצמה שינתה את הרשומה
  const list = photosOf(await findTreatment(treatmentId));
  const photos = list.map(describe);
  console.log(`[treatment-photos] תמונה הועלתה לטיפול ${treatmentId}: "${filename}" (${Math.round(file.size / 1024)}KB) — סה"כ ${photos.length}`);
  // Airtable מצרף ל**סוף** המערך, ולכן האחרונה היא זו שהועלתה עכשיו
  return { ok: true, added: photos[photos.length - 1] || null, photos };
}

/**
 * DELETE — מחיקת תמונה בודדת לפי מזהה-צרופה. Airtable אינו יודע למחוק
 * צרופה בודדת, ולכן כותבים מחדש את המערך בלי אותו מזהה (זו **ההחזרה**
 * של הצרופות שנשארות — `[{id}]` מספיק, Airtable שומר אותן כמו שהן).
 * אידמפוטנטי: מחיקה של מזהה שאינו קיים מחזירה 404 מפורש, אבל מחיקה
 * כשהגלריה ריקה אינה מפילה את הרשומה.
 */
export async function deleteTreatmentPhoto(treatmentId, role, attachmentId) {
  assertCanManage(role);
  if (!attachmentId) throw httpError(400, 'לא צוינה תמונה למחיקה');
  const rec = await findTreatment(treatmentId);
  const list = photosOf(rec);
  const kept = list.filter((a) => a.id !== attachmentId);
  if (kept.length === list.length) throw httpError(404, 'התמונה לא נמצאה בטיפול הזה');
  await updateRecord(TREATMENTS_TABLE, treatmentId, { [PHOTOS_FIELD]: kept.map((a) => ({ id: a.id })) });
  console.log(`[treatment-photos] תמונה נמחקה מטיפול ${treatmentId} — נשארו ${kept.length}`);
  return { ok: true, deleted: true, photos: kept.map(describe) };
}
