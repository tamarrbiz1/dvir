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
