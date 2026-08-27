/**
 * פונקציית עזר להצגת שדות מקושרים
 * השרת מחזיר [{id, name, table}] — ממירה למחרוזת תצוגה פשוטה
 * @param {any} v — הערך מהשרת
 * @param {string} fallback — ערך ברירת מחדל (ברירת מחדל: '—')
 */
export function displayName(v, fallback = '—') {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v || fallback;
  if (Array.isArray(v)) {
    if (v.length === 0) return fallback;
    return v.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && item.name) return item.name;
      return String(item || '');
    }).join(', ') || fallback;
  }
  if (typeof v === 'object' && v.name) return v.name;
  return String(v);
}

/**
 * שליפת ID ראשון משדה מקושר
 * @param {any} v — הערך מהשרת (מערך אובייקטים, אובייקט בודד, או מחרוזת)
 */
export function firstId(v) {
  if (!v) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const first = v[0];
    return first && typeof first === 'object' ? first.id : first;
  }
  return typeof v === 'object' ? v.id : v;
}

/**
 * שליפת ID ראשון והמרה למערך (לשליחה חזרה ל-API)
 */
export function asArray(v) {
  const id = firstId(v);
  return id ? [id] : [];
}
