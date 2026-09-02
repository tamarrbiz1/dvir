import { getLang } from '../i18n.js';
// ============================================================
// עזר גמיש לבחירת שדה — מנסה מספר שמות-אפשריים
// שימושי כאשר שדות Airtable שונו (שמות או סוגים)
// ============================================================

// מחזיר את הערך הראשון הקיים מבין רשימת שמות
export function pick(record, names, fallback = null) {
  if (!record) return fallback;
  for (const n of names) {
    if (n == null) continue;
    const v = record[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return fallback;
}

// ערך מספרי גמיש
export function num(record, names, def = 0) {
  const v = pick(record, names, def);
  const n = Number(v);
  return Number.isNaN(n) ? def : n;
}

// ערך מוניטרי (מחזיר מספר; לעיצוב תהפוך ל-₪)
export function money(record, names, def = 0) {
  return num(record, names, def);
}

// ערך טקסט/מקושר גמיש (מקושר מערך → מחזיר שם ראשון או רשימה)
export function name(record, names, fallback = 'לא זמין') {
  const v = pick(record, names, fallback);
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ') || fallback;
  return v ?? fallback;
}

// קטגוריית הוצאה לתצוגה: הוצאה ששולמה בצ'ק בלי קטגוריה מזוהה
// נחשבת "תשלום לספק" (ולא "שונות"/"אחר")
export function expenseCategory(e) {
  const raw = pick(e, ['קטגוריית חשבונית-AI', 'קטגוריה', 'סוג הוצאה']);
  const viaCheck = (Array.isArray(e?.['צ׳קים']) && e['צ׳קים'].length > 0)
    || String(e?.['אמצעי תשלום'] || '').includes("צ'ק")
    || String(e?.['אמצעי תשלום'] || '').includes('צ׳ק');
  if (viaCheck && (!raw || raw === 'שונות' || raw === 'אחר')) return 'תשלום לספק';
  return raw || (viaCheck ? 'תשלום לספק' : 'אחר');
}

// שעות עבודה של רשומת "עבודות עובדים": "סכום שעות" (משעות התחלה/סיום),
// ואם אין — "כמות" כשהיחידה בתמחור היא שעה
export function workHours(r) {
  const h = Number(r?.['סכום שעות'] ?? r?.['שעות']);
  if (Number.isFinite(h) && h > 0) return h;
  const unit = String(r?.['יחידת תמחור (from תמחור עבודות)'] ?? '').trim();
  if (unit.includes('שע')) {
    const q = Number(r?.['כמות']);
    if (Number.isFinite(q) && q > 0) return q;
  }
  return Number.isFinite(h) ? h : 0;
}

// סוג העבודה לתצוגה — בתאילנדית משתמשים בתרגום הקיים ב-Airtable
// ("סוג עבודה - תאילנדית"), לא בתרגום חדש (כלל האיפיון)
const firstOf = (v) => (Array.isArray(v) ? v[0] : v);
export function workTypeName(r, fallback = '') {
  const he = firstOf(r?.['סוג עבודה (from תמחור עבודות)'] ?? r?.['סוג עבודה']);
  if (getLang() === 'th') {
    const th = firstOf(r?.['סוג עבודה - תאילנדית (from תמחור עבודות)'] ?? r?.['סוג עבודה-תאילנדית']);
    if (th) return th;
  }
  return he || fallback;
}
