// ============================================================
// עזרי טבלה ראשית (סעיף 47): מיון, עימוד והדפסה
// ------------------------------------------------------------
// ההדפסה פועלת על "הנתונים המוצגים כרגע" — כלומר אחרי
// חיפוש, פילטרים ומיון — כפי שהאיפיון דורש.
// ============================================================

// מיון יציב לפי מפתח; getters ממפה שם-עמודה -> פונקציה שמחזירה ערך
export function sortRows(rows, key, dir = 'asc', getters = {}) {
  if (!key || !getters[key]) return rows;
  const get = getters[key];
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = get(a.r);
      const vb = get(b.r);
      const ea = va === null || va === undefined || va === '';
      const eb = vb === null || vb === undefined || vb === '';
      if (ea && eb) return a.i - b.i;
      if (ea) return 1; // ריקים תמיד בסוף
      if (eb) return -1;
      let c;
      if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
      else if (va instanceof Date && vb instanceof Date) c = va - vb;
      else c = String(va).localeCompare(String(vb), 'he');
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.r);
}

// המרת ערך תאריך למספר (לצורך מיון/סינון); null כשאין תאריך תקין
export function dateValue(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// האם תאריך נמצא בטווח [from, to] (מחרוזות YYYY-MM-DD, כל אחת אופציונלית)
export function inDateRange(v, from, to) {
  if (!from && !to) return true;
  const t = dateValue(v);
  if (t === null) return false;
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
  return true;
}

// חלוקה לעמודים
export function paginate(rows, page, pageSize) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, pages, current, start, end: Math.min(start + pageSize, total) };
}

// תקציר שורות לעימוד — "מציג X–Y מתוך Z" רק כשיש יותר מעמוד אחד;
// כשהכול נכנס בעמוד אחד — "N רשומות" פשוט, בלי טווח מבלבל
export function pagerSummary(paged, formatNumber) {
  if (paged.pages <= 1) return `${formatNumber(paged.total)} ${paged.total === 1 ? 'רשומה' : 'רשומות'}`;
  return `מציג ${formatNumber(paged.start + 1)}–${formatNumber(paged.end)} מתוך ${formatNumber(paged.total)}`;
}
