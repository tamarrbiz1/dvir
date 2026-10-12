// ============================================================
// מק"טים לפי ספק — משימה AB (12.10.2026, הוראת תמר)
// ------------------------------------------------------------
// אותו פריט מלאי ("קרטונים") מקבל מק"ט אחר אצל כל ספק. הטבלה
// `מק"טים` מחזיקה שלישייה: מק"ט (שדה ראשי) + קישור לפריט-מלאי +
// קישור לספק. שני שימושים:
//  1. מסך המלאי — תמר מזינה/מוחקת מק"טים לכל פריט (ItemDrawer).
//  2. ניתוח מסמכים — מק"ט שמופיע בשורת-חשבונית מזהה את הפריט
//     **בוודאות**, בלי להסתמך על התאמת-שם מטושטשת (ר'
//     inventory-deduction.js, matchLinesWithSkus).
//
// ⚠️ הטבלה היא **אופציונלית בכוונה**: ל-PAT שבשרת אין הרשאת
// `schema.bases:write` (אומת בפועל 12.10 — Metadata API החזיר 403
// INVALID_PERMISSIONS), ולכן היא נוצרת ידנית ב-Airtable ע"י תמר
// (ההוראה המדויקת ב-PROGRESS.md). כל הקוד כאן מזהה את הטבלה **לפי
// שם** (לא לפי id קשיח), ועובד ברגע שהיא קיימת בלי שום שינוי נוסף:
// כל עוד היא חסרה — המסך מציג הודעה ולא נופל, והניתוח מדלג על שלב
// המק"ט בשקט וממשיך בהתאמה לפי שם כמו היום.
// ============================================================
import { getMeta, fetchRecords, createRecord, deleteRecord, getBase } from './airtable.js';

export const SKU_TABLE = 'מק"טים';
const INVENTORY_TABLE = 'מלאי בסיסי';
const SUPPLIERS_TABLE = 'ספקים';

const F_SKU = 'מק"ט';
const F_ITEM = 'פריט מלאי';
const F_SUPPLIER = 'ספק';

/** שגיאת-ולידציה של קלט מק"ט — 400, לא 500 (אותה תבנית כמו ValidationError ב-inventory-deduction.js) */
export class SkuValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

// ============================================================
// זמינות הטבלה — נבדקת מול המטא של Airtable, במטמון קצר כדי שלא
// לשלם getMeta על כל קריאה. TTL של 2 דקות: ברגע שתמר יוצרת את
// הטבלה היא "נדלקת" מעצמה, בלי restart לשרת.
// ============================================================
const AVAILABILITY_TTL_MS = 2 * 60 * 1000;
let availability = { at: 0, value: null };

export async function isSkuTableAvailable() {
  if (availability.value !== null && Date.now() - availability.at < AVAILABILITY_TTL_MS) {
    return availability.value;
  }
  try {
    const names = new Set((await getMeta()).map((t) => t.name));
    availability = { at: Date.now(), value: names.has(SKU_TABLE) };
  } catch (e) {
    // המטא לא זמין כרגע (429/רשת) — לא מכריזים "אין טבלה" לצמיתות:
    // מחזירים false לפעם הזו בלי לשמור במטמון, כך שהניסיון הבא יבדוק מחדש.
    console.error(`[skus] בדיקת קיום טבלת "${SKU_TABLE}" נכשלה: ${e.message}`);
    return false;
  }
  return availability.value;
}

/** לשימוש אחרי יצירה/שינוי ידני של הטבלה (ובבדיקות) — מאפס את מטמון-הזמינות */
export function resetSkuAvailabilityCache() {
  availability = { at: 0, value: null };
}

// ============================================================
// נרמול מק"ט להשוואה — trim + רווחים-כפולים + רישיות. "חיפוש מדויק"
// כן, אבל לא עד כדי כך שרווח-נגרר או אות גדולה יפילו את ההתאמה
// (מק"ט מוקלד ידנית מול מק"ט שחולץ מ-OCR).
// ============================================================
export function normalizeSku(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const firstLinkId = (value) => {
  if (!Array.isArray(value) || !value.length) return null;
  const v = value[0];
  return v && typeof v === 'object' ? v.id || null : String(v);
};

const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;

// ============================================================
// נעילה לפי פריט-מלאי — בדיקת-כפילות + יצירה הן read-then-write,
// ושתי בקשות מקבילות על אותו פריט היו יוצרות שני מק"טים לאותו ספק
// (בדיוק המצב שהבדיקה אמורה למנוע). אותה תבנית-תור כמו
// withKeyLock ב-inventory-deduction.js.
// ============================================================
const keyLocks = new Map();
function withKeyLock(key, fn) {
  const prev = keyLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  keyLocks.set(key, run.catch(() => {}));
  return run;
}

/** כל רשומות המק"טים (הטבלה קטנה מעצם טבעה — פריטים × ספקים) */
async function fetchAllSkus() {
  return fetchRecords(SKU_TABLE, {});
}

/** מפת מזהה-ספק → שם ספק, לתצוגה במסך (הלקוח לא רואה מזהים טכניים) */
async function supplierNames() {
  try {
    const rows = await fetchRecords(SUPPLIERS_TABLE, { fields: ['שם ספק'] });
    const map = new Map();
    for (const r of rows) map.set(r.id, r['שם ספק'] || '');
    return map;
  } catch (e) {
    console.error(`[skus] קריאת שמות הספקים נכשלה: ${e.message}`);
    return new Map();
  }
}

function toClientSku(rec, names) {
  const supplierId = firstLinkId(rec[F_SUPPLIER]);
  return {
    id: rec.id,
    sku: rec[F_SKU] || '',
    itemId: firstLinkId(rec[F_ITEM]),
    supplierId,
    supplierName: (supplierId && names.get(supplierId)) || '',
    notes: rec['הערות'] || '',
  };
}

/**
 * כל המק"טים של פריט-מלאי אחד, ממוינים לפי שם ספק.
 * @returns {{available:boolean, skus:Array}} available=false כשהטבלה
 *   עוד לא הוגדרה ב-Airtable — המסך מציג הודעה ולא נופל.
 */
export async function listItemSkus(itemId) {
  if (!(await isSkuTableAvailable())) return { available: false, skus: [] };
  const [rows, names] = await Promise.all([fetchAllSkus(), supplierNames()]);
  const skus = rows
    .filter((r) => firstLinkId(r[F_ITEM]) === itemId)
    .map((r) => toClientSku(r, names))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'he'));
  return { available: true, skus };
}

/**
 * יוצר מק"ט לפריט+ספק. מק"ט ריק → לא נשמר (400). אותו ספק לאותו
 * פריט פעמיים → 400 בעברית, בתוך נעילה לפי הפריט (ר' withKeyLock).
 */
export async function createItemSku({ itemId, supplierId, sku }) {
  if (!(await isSkuTableAvailable())) {
    const e = new Error(`טבלת "${SKU_TABLE}" עוד לא הוגדרה ב-Airtable`);
    e.statusCode = 503;
    throw e;
  }
  const value = String(sku ?? '').trim();
  if (!value) throw new SkuValidationError('יש להזין מק"ט');
  if (value.length > 100) throw new SkuValidationError('מק"ט ארוך מדי (עד 100 תווים)');
  if (typeof supplierId !== 'string' || !RECORD_ID_RE.test(supplierId)) {
    throw new SkuValidationError('יש לבחור ספק');
  }
  if (typeof itemId !== 'string' || !RECORD_ID_RE.test(itemId)) {
    throw new SkuValidationError('פריט מלאי לא תקין');
  }
  // הפריט חייב להתקיים בפועל — אחרת נוצר מק"ט "תלוי באוויר" שלא
  // יופיע באף מסך (Airtable מקבל קישור לרשומה שנמחקה בשקט).
  try {
    await getBase()(INVENTORY_TABLE).find(itemId);
  } catch {
    throw new SkuValidationError('פריט המלאי לא נמצא');
  }

  return withKeyLock(`sku-item:${itemId}`, async () => {
    const rows = await fetchAllSkus();
    const dup = rows.find((r) => firstLinkId(r[F_ITEM]) === itemId && firstLinkId(r[F_SUPPLIER]) === supplierId);
    if (dup) throw new SkuValidationError('לספק הזה כבר יש מק"ט לפריט');
    const created = await createRecord(SKU_TABLE, {
      [F_SKU]: value,
      [F_ITEM]: [itemId],
      [F_SUPPLIER]: [supplierId],
    });
    const names = await supplierNames();
    return toClientSku(created, names);
  });
}

/** מחיקת מק"ט בודד. אידמפוטנטי: רשומה שלא קיימת מוחזרת כ-ok (אין מה למחוק) */
export async function deleteItemSku(skuId) {
  if (!(await isSkuTableAvailable())) {
    const e = new Error(`טבלת "${SKU_TABLE}" עוד לא הוגדרה ב-Airtable`);
    e.statusCode = 503;
    throw e;
  }
  if (typeof skuId !== 'string' || !RECORD_ID_RE.test(skuId)) throw new SkuValidationError('מזהה מק"ט לא תקין');
  try {
    await deleteRecord(SKU_TABLE, skuId);
  } catch (e) {
    if (e?.statusCode === 404) return { ok: true, alreadyGone: true };
    throw e;
  }
  return { ok: true };
}

// ============================================================
// אינדקס לניתוח מסמכים: מק"ט מנורמל → רשימת {itemId, supplierId}
// נטען פעם אחת לכל ניתוח (לא קריאה לכל שורה).
// ============================================================
/**
 * @returns {Map<string, Array<{itemId:string, supplierId:string|null}>>|null}
 *   null כשהטבלה חסרה/לא נקראה — הקורא מדלג על שלב המק"ט בשקט.
 */
export async function loadSkuIndex() {
  if (!(await isSkuTableAvailable())) return null;
  try {
    const rows = await fetchAllSkus();
    const index = new Map();
    for (const r of rows) {
      const key = normalizeSku(r[F_SKU]);
      const itemId = firstLinkId(r[F_ITEM]);
      if (!key || !itemId) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ itemId, supplierId: firstLinkId(r[F_SUPPLIER]) });
    }
    return index;
  } catch (e) {
    console.error(`[skus] קריאת טבלת "${SKU_TABLE}" נכשלה — ממשיכים בהתאמה לפי שם: ${e.message}`);
    return null;
  }
}

/**
 * מזהה-פריט לפי מק"ט מתוך אינדקס שנטען מראש.
 * קודם מצומצם לספק של המסמך (אם ידוע); אם אין שורה לספק הזה —
 * נופלים להתאמה לפי המק"ט לבדו, **אבל רק כשהיא חד-משמעית**: אותו
 * מק"ט שמוביל לשני פריטים שונים אינו "התאמה ודאית" ולכן מדולג
 * (ואז ההתאמה לפי שם מטפלת בשורה כמו היום).
 * @returns {string|null} itemId
 */
export function findItemIdBySku(index, sku, supplierId) {
  if (!index) return null;
  const rows = index.get(normalizeSku(sku));
  if (!rows || !rows.length) return null;
  if (supplierId) {
    const forSupplier = rows.filter((r) => r.supplierId === supplierId);
    if (forSupplier.length) {
      const ids = new Set(forSupplier.map((r) => r.itemId));
      return ids.size === 1 ? forSupplier[0].itemId : null;
    }
  }
  const ids = new Set(rows.map((r) => r.itemId));
  return ids.size === 1 ? rows[0].itemId : null;
}
