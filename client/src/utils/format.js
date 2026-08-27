// ============================================================
// פונקציות עיצוב מספרים/תאריכים — לפי האיפיון
// ============================================================

// הסר אפסים עשרוניים מיותרים: 5.00000 → 5, 5.25000 → 5.25
export function trimNumber(n) {
  if (n === null || n === undefined || n === '') return null;
  const num = Number(n);
  if (Number.isNaN(num)) return null;
  const rounded = Math.round(num * 100000) / 100000;
  return rounded;
}

// פורמט מספר עם מפריד אלפים, ללא אפסים עשרוניים מיותרים
export function formatNumber(n, digits) {
  if (n === null || n === undefined || n === '') return 'לא זמין';
  const num = Number(n);
  if (Number.isNaN(num)) return 'לא זמין';
  const opts = {
    maximumFractionDigits: digits ?? 3,
  };
  return num.toLocaleString('he-IL', opts);
}

// פורמט כסף: ₪ + מפריד אלפים
export function formatMoney(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return 'לא זמין';
  const num = Number(n);
  // מקסימום 2 ספרות עשרוניות, בלי אפסים מיותרים
  const str = num.toLocaleString('he-IL', { maximumFractionDigits: 2 });
  return `₪${str}`;
}

// פורמט משקל: 5,756 ק"ג
export function formatWeight(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return 'לא זמין';
  const num = Number(n);
  return `${formatNumber(num)} ק"ג`;
}

// פורמט אחוז: 0.205 → 20.5%
export function formatPercent(ratio) {
  if (ratio === null || ratio === undefined || ratio === '' || Number.isNaN(Number(ratio))) return 'לא זמין';
  const num = Number(ratio) * 100;
  return `${formatNumber(num, 1)}%`;
}

// פורמט תאריך: DD/MM/YYYY
export function formatDate(value) {
  if (!value) return 'לא זמין';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    // ייתכן מחרוזת תאריך — ננסה לפרק
    if (typeof value === 'string' && value.includes('-')) return value.slice(0, 10);
    return String(value);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// החזרת ערך בטוח: null/ריק → 'לא זמין', אחרת הערך
export function safeValue(v) {
  if (v === null || v === undefined || v === '') return 'לא זמין';
  return v;
}
