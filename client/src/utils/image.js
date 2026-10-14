// ============================================================
// המרת/הקטנת תמונות בצד הלקוח — נחלץ ממסך העלאת המסמכים (AM-3)
// ------------------------------------------------------------
// עד כה הקוד הזה חי בתוך `UploadDocumentPage.jsx` בלבד. משימה AS-3
// (העלאת תמונה לטיפול) צריכה **בדיוק** את אותה התנהגות — HEIC מאייפון
// מומר ל-JPG לפני השליחה, תמונה גדולה מוקטנת — ולכן הועבר לכאן בלי
// שינוי לוגי, במקום לשכפל. `UploadDocumentPage` מייבא מכאן.
//
// **בלי תלות חדשה בכלל** — אין ספריית HEIC ב-node_modules, ולא הוספתי
// אחת (הן שוקלות מגה-בייטים של wasm). מה שקובע אם הפורמט נתמך הוא
// `createImageBitmap` של הדפדפן: iOS/Safari מפענחים HEIC, וזה בדיוק
// המקום שממנו HEIC מגיע.
// ============================================================

/** פורמטים שהדפדפן אמור להצליח לפענח ואנחנו ממירים ל-JPG לפני השליחה */
export const CONVERTIBLE_RE = /\.(heic|heif|webp|bmp|tiff?|gif)$/i;
export const CONVERTIBLE_TYPES = ['image/heic', 'image/heif', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif'];

/** האם הקובץ הזה פורמט שננסה להמיר ל-JPG (ולא פורמט שמתקבל כמו שהוא) */
export function isConvertibleImage(f) {
  return !!f && (CONVERTIBLE_RE.test(f.name || '') || CONVERTIBLE_TYPES.includes(f.type));
}

/**
 * תמונה → JPEG דרך canvas. **זורק** אם הדפדפן לא מצליח לפענח את הפורמט
 * (הזריקה היא מה שמאפשר לקורא להציג הסבר "מה לעשות" במקום
 * "סוג קובץ לא נתמך").
 */
export async function imageToJpeg(f, maxDim = 2000, quality = 0.85) {
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('המרת התמונה נכשלה');
  const name = (f.name || 'image').replace(/\.[^.]+$/i, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

/**
 * תמונות גדולות מוקטנות בצד הלקוח לפני השליחה — מקצר משמעותית את זמן
 * ההעלאה (המסמך נשאר קריא לניתוח; PDF אינו משתנה). כשל בהמרה מחזיר את
 * הקובץ המקורי: עדיף להעלות גדול מלא להעלות בכלל.
 */
export async function shrinkImage(f, maxDim = 2000, quality = 0.85) {
  if (!f.type.startsWith('image/') || f.size < 1.2 * 1024 * 1024) return f;
  try {
    return await imageToJpeg(f, maxDim, quality) || f;
  } catch { return f; }
}

/** ההודעה המדויקת שמוצגת כשההמרה נכשלה — זהה בכל המסכים */
export function conversionErrorMessage(f) {
  return /heic|heif/i.test(f?.name || '') || /heic|heif/i.test(f?.type || '')
    ? 'הדפדפן הזה לא יודע לפתוח HEIC (הפורמט של צילום באייפון). צלמי שוב במצב "תואם ביותר" (JPG), או שתפי את התמונה מהגלריה — השיתוף ממיר אותה ל-JPG. אפשר גם לשלוח PDF.'
    : 'לא ניתן היה להמיר את התמונה. יש להעלות PDF, JPG או PNG.';
}
