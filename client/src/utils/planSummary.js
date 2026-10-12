// ============================================================
// שורות הסיכום בתחתית הגיליון השנתי (משימה AF, 12.10.2026)
// ------------------------------------------------------------
// הוצא מ-`ExcelTable` ב-PlantingPlanPage.jsx כדי שיהיה **נבדק** — הבאג
// שתוקן כאן היה שקט לחלוטין: הקיבוץ החודשי השתמש ב-`new Date()`
// (`key = ${month}-${now.getFullYear()}`, `label = now.toLocaleDate...`)
// ולכן כל שורות-הסיכום קיבלו את שם החודש והשנה **הנוכחיים**. בגיליון
// 2026 כל השורות נקראו "אוקטובר"; בגיליון שחוצה שנים, אותו חודש משתי
// שנים שונות התמזג לשורה אחת. שום בדיקה לא כיסתה את זה כי החישוב היה
// בתוך רכיב JSX.
// ============================================================

/**
 * מקבץ שורות-שבוע לשורות-סיכום חודשיות, לפי החודש/שנה של **השבוע**.
 * כל שורת-שבוע: { year, month (0-11), expectedKg, actualKg,
 *   expectedRevenue, actualRevenue (null = טרם בוצע) }.
 * מוחזר ממוין כרונולוגית, עם מפתח `YYYY-MM` ותווית "דצמבר 2026".
 */
export function groupWeeksByMonth(weekRows, { locale = 'he-IL' } = {}) {
  const byMonth = new Map();
  for (const r of weekRows || []) {
    const year = Number(r?.year);
    const month = Number(r?.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue; // שבוע בלי תאריך תקין — לא מסכמים "לחודש לא ידוע"
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        key,
        year,
        month,
        label: new Date(year, month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
        expectedKg: 0, actualKg: 0, expectedRevenue: 0, actualRevenue: 0, hasActual: false,
      });
    }
    const m = byMonth.get(key);
    m.expectedKg += Number(r.expectedKg) || 0;
    m.actualKg += Number(r.actualKg) || 0;
    m.expectedRevenue += Number(r.expectedRevenue) || 0;
    // null = "טרם בוצע" ולא 0: 0 אמיתי (נקטף ולא נמכר) חייב להיראות
    // אחרת מ"אין נתון" — ר' actualKg ב-PlantingPlanPage.jsx.
    if (r.actualRevenue !== null && r.actualRevenue !== undefined) {
      m.actualRevenue += Number(r.actualRevenue) || 0;
      m.hasActual = true;
    }
  }
  return [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** סה"כ שנתי משורות-השבוע (אותו כלל null כמו למעלה) */
export function totalsOfWeeks(weekRows) {
  return (weekRows || []).reduce((acc, r) => {
    acc.expectedKg += Number(r.expectedKg) || 0;
    acc.actualKg += Number(r.actualKg) || 0;
    acc.expectedRevenue += Number(r.expectedRevenue) || 0;
    if (r.actualRevenue !== null && r.actualRevenue !== undefined) acc.actualRevenue += Number(r.actualRevenue) || 0;
    return acc;
  }, { expectedKg: 0, actualKg: 0, expectedRevenue: 0, actualRevenue: 0 });
}
