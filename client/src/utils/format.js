// ============================================================
// פונקציות עיצוב מספרים/תאריכים — לפי האיפיון
// ============================================================

// כלל רוחבי (2026-09-06): שום סכום/סיכום תלוי-זמן לא מוצג בלי לציין
// לאיזה טווח הוא מתייחס. עבור "השנה הנוכחית" באמצע השנה — כמה מהשנה
// נאסף בפועל עד כה (לא "השנה" סתם, שעלול להטעות כאילו זו שנה שלמה).
// לדוגמה ב-6 בספטמבר: "2026 (8 חודשים ו-6 ימים)".
export function yearProgressLabel(year = new Date().getFullYear()) {
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  if (!isCurrentYear) return String(year); // שנה שהסתיימה — כל הנתונים קיימים, אין צורך בפירוט
  const start = new Date(year, 0, 1);
  const months = now.getMonth(); // חודשים שלמים שחלפו (ינואר=0)
  const days = now.getDate() - start.getDate() + 1; // כולל היום הנוכחי
  const parts = [];
  if (months > 0) parts.push(`${months} ${months === 1 ? 'חודש' : 'חודשים'}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? 'יום' : 'ימים'}`);
  const detail = parts.length ? parts.join(' ו-') : 'פחות מיום';
  return `${year} (${detail} עד כה)`;
}

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
  // Airtable מחזיר שגיאת נוסחה כאובייקט {error: '#ERROR!'} — לא תאריך
  if (typeof value === 'object' && !(value instanceof Date)) return 'לא זמין';
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
