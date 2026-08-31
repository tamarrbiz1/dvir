// ============================================================
// עזרי טבלה ראשית (סעיף 47): מיון, עימוד, ייצוא והדפסה
// ------------------------------------------------------------
// הייצוא וההדפסה פועלים על "הנתונים המוצגים כרגע" — כלומר אחרי
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

// ייצוא CSV (UTF-8 עם BOM כדי שאקסל יציג עברית נכון)
// columns: [{ label, get(row) }]
export function exportCsv(filename, columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => esc(c.get(r))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// חותמת תאריך לשם קובץ: 2026-08-31
export function fileStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// חלוקה לעמודים
export function paginate(rows, page, pageSize) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, pages, current, start, end: Math.min(start + pageSize, total) };
}
