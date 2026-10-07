// ============================================================
// הגנה על <select> מבוקר שהערך הנבחר שלו נעלם מרשימת האפשרויות
// (נמצא בלילה 3, 2026-10-07 — סינון-השנה בטאב "תחזית שתילה")
// ------------------------------------------------------------
// התקלה: בורר-שנה מבוקר (`value={fYear}`) שהאפשרויות שלו נגזרות
// מהנתונים. ברגע שהערך הנבחר כבר אינו ברשימה — למשל שורות השנה הזו
// נמחקו/סוננו, או שהערך ההתחלתי חושב ממערך אחר מזה שבונה את
// האפשרויות — React מציב `select.value` שאין לו <option> תואם, הדפדפן
// מעמיד `selectedIndex = -1`, והבורר **מוצג ריק**.
//
// למה זה מבוי סתום ולא רק מכוער: הטבלה מסוננת לפי ערך שאינו מוצג
// בשום מקום ("אין נתונים לתקופה זו" לנצח), ובחירה מחדש של האפשרות
// הראשונה ("כל השנים") **לא מפעילה onChange** — הדפדפן לא משדר change
// על בחירה שלא שינתה את ה-value המוצג. כלומר המשתמשת לא יכולה לצאת
// מהמצב הזה בשום לחיצה; רק רענון-דף.
//
// הפתרון: ברגע שיש אפשרויות, אך הערך הנבחר אינו ביניהן — חוזרים
// לערך-"הכל" (ברירת המחדל). בזמן טעינה (אין עדיין אפשרויות בכלל) לא
// נוגעים בכלום, כדי לא לאפס בחירה לגיטימית לפני שהנתונים הגיעו.
// ============================================================
import { useEffect } from 'react';

// לוגיקה טהורה (בלי React) — כדי ש-qa-check.mjs יוכל לבדוק אותה ישירות,
// בדיוק כמו dateFromWeekValue/invoiceDate ב-utils/weekYear.js.
// מחזיר true אם יש לאפס את הבחירה הנוכחית ל-fallback.
export function shouldResetOption(value, options, fallback = '') {
  if (value === fallback) return false;
  if (!options || !options.length) return false; // עוד בטעינה — לא מאפסים
  if (options.some((o) => String(o) === String(value))) return false;
  return true;
}

export function useOptionGuard(value, options, reset, fallback = '') {
  useEffect(() => {
    if (shouldResetOption(value, options, fallback)) reset(fallback);
  }, [value, options, reset, fallback]);
}

export default { useOptionGuard, shouldResetOption };
