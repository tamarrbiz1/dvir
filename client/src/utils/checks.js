// ============================================================
// עזרי צ'קים (סעיף 26 באיפיון) — מקור אמת יחיד לשמות השדות
// ------------------------------------------------------------
// ב-Airtable שמות השדות כתובים עם גרש עברי (׳) ולא עם גרש לטיני ('):
// "סכום צ׳ק", "צילום צ׳ק", וכן "שם בעל הצק" (בלי גרש) ו-"ספקים" (ברבים).
// כל מסך שמציג צ'קים חייב לעבור דרך הפונקציות כאן, כדי שאי-התאמה
// בשם שדה לא תגרום ל"לא זמין" בכל הטבלה.
// ============================================================
import { pick } from './field.js';
import { displayName, firstId } from './resolve.js';

export const CHECK_FIELDS = {
  number: ['מספר צ׳ק', "מספר צ'ק"],
  photo: ['צילום צ׳ק', "צילום צ'ק"],
  amount: ['סכום צ׳ק', "סכום צ'ק"],
  owner: ['שם בעל הצק', 'שם בעל הצ׳ק', "שם בעל הצ'ק"],
  payee: ['מוטב'],
  due: ['תאריך פירעון'],
  suppliers: ['ספקים', 'ספק'],
  invoices: ['חשבוניות'],
  expenses: ['הוצאות'],
  status: ['סטטוס'],
  notes: ['הערות'],
  uploadedAt: ['תאריך העלאה האחרון'],
};

// ערכי הסטטוס לפי האיפיון. "נפרע"/"לא נפרע" קיימים ב-Airtable;
// "מבוטל" נדרש באיפיון (הצג מבוטלים / KPI מבוטלים).
export const STATUS = {
  PAID: 'נפרע',
  UNPAID: 'לא נפרע',
  CANCELLED: 'מבוטל',
};

export const CHECKS_TABLE = 'צ׳קים';

export function checkNumber(c) {
  return pick(c, CHECK_FIELDS.number);
}

export function checkTitle(c) {
  const n = checkNumber(c);
  return n != null && n !== '' ? `צ׳ק #${n}` : 'צ׳ק';
}

export function checkStatus(c) {
  return String(pick(c, CHECK_FIELDS.status, '') || '').trim();
}

export function isCancelled(c) {
  return checkStatus(c) === STATUS.CANCELLED;
}

export function isPaid(c) {
  return checkStatus(c) === STATUS.PAID;
}

// צ'ק שעדיין ממתין לפירעון: לא מבוטל ולא נפרע (סטטוס ריק נחשב "לא נפרע")
export function isPending(c) {
  return !isCancelled(c) && !isPaid(c);
}

export function checkAmount(c) {
  const n = Number(pick(c, CHECK_FIELDS.amount, 0));
  return Number.isNaN(n) ? 0 : n;
}

// תאריך פירעון כאובייקט Date (או null כשאין/לא תקין)
export function checkDueDate(c) {
  const raw = pick(c, CHECK_FIELDS.due);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function checkPayee(c) {
  return pick(c, CHECK_FIELDS.payee, '') || '';
}

export function checkOwner(c) {
  return pick(c, CHECK_FIELDS.owner, '') || '';
}

export function checkNotes(c) {
  return pick(c, CHECK_FIELDS.notes, '') || '';
}

// שדות מקושרים — השרת מחזיר [{id, name, table}]
export function checkSuppliers(c) {
  const v = pick(c, CHECK_FIELDS.suppliers, []);
  return Array.isArray(v) ? v : [];
}

export function checkSupplierName(c) {
  return displayName(pick(c, CHECK_FIELDS.suppliers), '');
}

export function checkSupplierId(c) {
  return firstId(pick(c, CHECK_FIELDS.suppliers));
}

export function checkInvoices(c) {
  const v = pick(c, CHECK_FIELDS.invoices, []);
  return Array.isArray(v) ? v : [];
}

export function checkExpenses(c) {
  const v = pick(c, CHECK_FIELDS.expenses, []);
  return Array.isArray(v) ? v : [];
}

// האם הצ'ק משויך לספק מסוים (לכרטיס ספק)
export function checkBelongsToSupplier(c, supplierId) {
  return checkSuppliers(c).some((x) => String(x?.id ?? x) === String(supplierId));
}

// צילום הצ'ק — קובץ מצורף ראשון: { thumb, large, full, filename } או null
export function checkPhoto(c) {
  const arr = pick(c, CHECK_FIELDS.photo);
  if (!Array.isArray(arr) || !arr.length) return null;
  const a = arr[0];
  if (!a || typeof a !== 'object') return null;
  return {
    thumb: a.thumbnails?.small?.url || a.thumbnails?.large?.url || a.url,
    large: a.thumbnails?.large?.url || a.url,
    full: a.thumbnails?.full?.url || a.url,
    filename: a.filename || 'צילום צ׳ק',
    isImage: String(a.type || '').startsWith('image/'),
  };
}

// מיון לפי תאריך פירעון (הקרוב ראשון); צ'קים בלי תאריך — בסוף
export function sortByDue(list) {
  return [...list].sort((a, b) => {
    const da = checkDueDate(a);
    const db = checkDueDate(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
}
