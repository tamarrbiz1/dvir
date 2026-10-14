// ============================================================
// שיוך תוכניות שתילה לטיפול (משימה AS-2, 14.10.2026 — נוסח מעודכן)
// ------------------------------------------------------------
// תמר: "אפשרות גם לשייך **מבנים בלבד** וגם לבחור **כמה תוכניות שתילה**.
// לא רוצה לשבש את מה שקיים היום, ומצד שני אופציה לקשר לתוכנית השתילה."
// **עיקרון: הכל אופציונלי ותוספתי** — אפס/אחת/כמה תוכניות, שום דבר לא
// נבחר אוטומטית, והשדה **אינו חובה** (טיפול עם מבנים בלבד הוא תרחיש
// לגיטימי ולא מקרה-קצה).
//
// `תוכנית שתילה` בטבלת `ריסוסים` הוא **singleLineText** (ולא שדה-קישור
// כמו באותו שם בטבלאות `תקופות תוכנית`/`תחזית שתילה שבועית`) — וזו בדיוק
// הסיבה שהאחסון הוא מופרד-בפסיק: בלי שדה חדש ובלי שינוי סכימה.
//
// **תאימות לאחור היא התנאי:** כל הטיפולים הקיימים, וגם הייבוא מדוח
// ריסוסים (server/src/spray-report-import.js, שממשיך לכתוב מזהה בודד),
// מחזיקים מזהה **בודד בלי פסיקים**. לכן כל קריאה של השדה עוברת ב-
// `planIdList`, ומזהה בודד הופך לרשימה באורך 1. אין מקום שקורא את השדה
// ישירות. שלושת המצבים שכל קורא חייב לסבול: **מזהה בודד** (טיפולים
// ישנים), **רשימה מופרדת בפסיקים** (חדש), ו**ערך ריק** (טיפול בלי
// תוכנית — מבנים בלבד). `planIdList` מחזירה `[]` לשלישי.
//
// JS טהור (לא jsx) כדי שסוויטת הבדיקות תייבא אותו ישירות — ר' qa-check.mjs.
// ============================================================
import { firstId } from './resolve.js';

/** מחרוזת מזהים (בודד או מופרד בפסיקים) → מערך מזהים נקי */
export function planIdList(v) {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.id : String(x))).filter(Boolean);
  return String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** מערך מזהים → הערך שנשמר בשדה. תוכנית אחת → בלי פסיק, כמו עד היום. */
export function planIdsToField(ids) {
  return planIdList(Array.isArray(ids) ? ids.join(',') : ids).join(',');
}

/**
 * הטווח הפעיל של תוכנית שתילה: מתחילת השתילה ועד סוף הקטיף. הערכים
 * המעודכנים גוברים על המקוריים — אותה היררכיה כמו `cropResolver` ב-
 * server/src/spray-report-import.js. null כשאין בכלל תאריכים.
 */
export function planActiveRange(p) {
  const from = p?.['תחילת שתילה מעודכנת'] || p?.['תחילת שתילה מקורית'] || null;
  const to = p?.['סוף קטיף מעודכן'] || p?.['סוף קטיף מקורי'] || null;
  const start = from ? String(from).slice(0, 10) : null;
  const end = to ? String(to).slice(0, 10) : null;
  if (!start && !end) return null;
  return { start: start || end, end: end || start };
}

/**
 * האם הטווח הפעיל של התוכנית חופף לטווח הטיפול (fromISO..toISO)?
 * ⚠️ **חיווי בלבד.** ר' AS-2: סינון התוכניות ממשיך להיות לפי מבנה, והזמן
 * רק מסמן ומקדים ברשימה. אין כאן הסתרה, אין חסימה ואין בחירה אוטומטית.
 */
export function planActiveOn(p, fromISO, toISO) {
  const r = planActiveRange(p);
  if (!r) return false;
  const a = fromISO || toISO;
  const b = toISO || fromISO || a;
  if (!a) return false;
  return r.start <= b && r.end >= a;
}

/**
 * רשימת התוכניות להצגה בטופס הטיפול.
 *
 * 1. **סינון לפי מבנה — בדיוק כמו שהיה**: אין מבנה נבחר → כל התוכניות.
 * 2. סימון `active` לפי חפיפה לתאריכי הטיפול, והקדמה של הפעילות לראש
 *    הרשימה (sort יציב → הסדר המקורי נשמר בתוך כל קבוצה). **שום דבר
 *    לא מוסתר ושום דבר לא נבחר** — הפונקציה מחזירה אפשרויות, לא בחירה.
 * 3. מזהים שמורים שאינם ברשימה (מבנה שהוחלף / תוכנית שנמחקה) נוספים
 *    בסוף עם `plan: null`, כדי שלא ייעלמו בשקט מרשומה קיימת — אותו רעיון
 *    כמו `withCurrent` של שאר שדות הטופס.
 */
export function planChoicesFor(plans, { structures = [], from, to, selected = [] } = {}) {
  const inStructures = (plans || []).filter((p) => !structures.length || structures.includes(firstId(p['מבנה'])));
  const choices = inStructures
    .map((p) => ({ id: p.id, plan: p, active: planActiveOn(p, from, to) }))
    .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  const missing = planIdList(selected.join(',')).filter((id) => !choices.some((c) => c.id === id));
  return [...choices, ...missing.map((id) => ({ id, plan: null, active: false }))];
}
