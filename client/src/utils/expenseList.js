// ============================================================
// חלוקת רשימת ההוצאות ל"בתוך התקופה" ו"הועלו לאחרונה" (AM-1, 13.10.2026)
// ------------------------------------------------------------
// הבעיה שתמר דיווחה: "הוצאה שהעליתי עכשיו נעלמת". המסך מסנן לפי
// **תאריך החשבונית** (`תאריך חשבונית-AI`), וברירת המחדל היא "החודש" —
// ולכן חשבונית שהועלתה היום אבל תאריכה ינואר (למשל #174) פשוט לא
// מופיעה. מבחינת המשתמשת זה נראה כמו העלאה שנכשלה או נתון שאבד.
// בפועל זה היה המצב בשלוש מתוך שמונה ההוצאות בבסיס (#174/#175/#176,
// שהועלו ב-13.10 עם תאריכי ינואר-פברואר).
//
// הפתרון, לפי ההגדרה של תמר: הוצאה שהועלתה ב-7 הימים האחרונים מופיעה
// **תמיד** בראש הרשימה עם תג "חדש", גם כשתאריך החשבונית מחוץ לתקופה —
// אבל **אינה נספרת ב-KPI ובגרפים**. זו הנקודה העדינה: אם היא תיכנס
// לסכומים, "סה"כ הוצאות החודש" יכלול חשבונית של ינואר והמספר יהיה
// שקר. לכן החלוקה לשתי רשימות ולא לרשימה אחת מורחבת.
//
// מופרד לקובץ-utils כדי שיהיה **נבדק** בלי לרנדר את המסך (אותו שיקול
// כמו planSummary.js במשימה AF — באג בחישוב שיושב בתוך JSX הוא באג
// שאף בדיקה לא מכסה).
// ============================================================

/** חלון "הועלה לאחרונה" בימים — ההגדרה של תמר */
export const RECENT_UPLOAD_DAYS = 7;

/** "2026-10-13T..." / "2026-10-13" → "2026-10-13"; אחרת null */
export function ymd(value) {
  const s = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * האם הרשומה הועלתה בתוך חלון ה"לאחרונה".
 * @param {string} uploadDate ערך השדה `תאריך העלאת החשבונית`
 * @param {Date|string} now   "עכשיו" (מוזרק, כדי שהבדיקה תהיה דטרמיניסטית)
 */
export function isRecentUpload(uploadDate, now = new Date(), days = RECENT_UPLOAD_DAYS) {
  const up = ymd(uploadDate);
  if (!up) return false;
  const today = ymd(now instanceof Date ? now.toISOString() : now);
  if (!today) return false;
  // השוואה ביומן, בלי שעות: עד `days - 1` ימים אחורה **כולל היום**
  // (7 ימים = היום + 6 אחורה). עובדים במחרוזות ISO כדי שלא תיכנס
  // הסטת אזור-זמן לחישוב.
  const floor = new Date(`${today}T12:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - (days - 1));
  const floorYmd = floor.toISOString().slice(0, 10);
  // תאריך-העלאה עתידי (שעון שגוי/הקלדה) נחשב "לאחרונה" ולא נעלם
  return up >= floorYmd;
}

/**
 * מחלק את ההוצאות לשתי רשימות.
 *
 * @param {Array} expenses      כל ההוצאות
 * @param {object} opts
 *   `matches(e)`   — הסינון שאינו-תקופה (ספק/קטגוריה/חיפוש). חל על **שתי**
 *                    הרשימות: "חדש" לא אמור לעקוף חיפוש או סינון-ספק
 *                    שהמשתמשת בחרה במפורש.
 *   `inRange(e)`   — האם תאריך ההוצאה בתוך התקופה שנבחרה.
 *   `uploadOf(e)`  — ערך תאריך-ההעלאה של הרשומה.
 *   `sortKey(e)`   — מפתח המיון (תאריך ההוצאה), יורד.
 *   `now`          — "עכשיו" (מוזרק).
 * @returns {{ inPeriod: Array, recentOutside: Array, rows: Array }}
 *   `rows` = ה"חדשות" בראש ואחריהן אלה שבתקופה — זה מה שהטבלה מציגה.
 *   `inPeriod` לבדו הוא מה שנכנס ל-KPI ולגרפים.
 */
export function splitExpenses(expenses, { matches, inRange, uploadOf, sortKey, now = new Date() } = {}) {
  const byDateDesc = (a, b) => String(sortKey(b) || '').localeCompare(String(sortKey(a) || ''));
  const inPeriod = [];
  const recentOutside = [];
  for (const e of expenses || []) {
    if (matches && !matches(e)) continue;
    if (inRange(e)) { inPeriod.push(e); continue; }
    if (isRecentUpload(uploadOf(e), now)) recentOutside.push(e);
  }
  inPeriod.sort(byDateDesc);
  // ה"חדשות" ממוינות לפי תאריך ההעלאה (האחרונה קודם) — זה הסדר
  // שהמשתמשת מצפה לו כשהיא מחפשת "מה שהעליתי עכשיו"
  recentOutside.sort((a, b) => String(ymd(uploadOf(b)) || '').localeCompare(String(ymd(uploadOf(a)) || '')));
  return { inPeriod, recentOutside, rows: [...recentOutside, ...inPeriod] };
}

export default { splitExpenses, isRecentUpload, RECENT_UPLOAD_DAYS, ymd };
