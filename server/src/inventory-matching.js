// ============================================================
// התאמת שורות מסמך-הוצאה לפריטי "מלאי בסיסי" קיימים — 2026-10-06 (לילה)
// ------------------------------------------------------------
// רק פריטים שכבר קיימים במלאי (לא ממציאים פריטים חדשים). מילון
// כינויים לכל קטגוריה (4 הקטגוריות הקיימות ב-select של "מלאי בסיסי":
// נילונים/קרטונים/משטחי עץ/כובעים) + התאמה מטושטשת (בלי ניקוד,
// רווחים כפולים, יחיד/רבים).
// ============================================================

// כינויים נפוצים לכל קטגוריה — לא תלוי ברישיות/ניקוד (מנורמל בהמשך)
const CATEGORY_ALIASES = {
  'נילונים': ['ניילון', 'נילון', 'פוליאתילן', 'יריעה', 'יריעת', 'pe', 'גליל', 'גלילי'],
  'קרטונים': ['קרטון', 'קרטוני', 'ארגז', 'ארגזי', 'box', 'boxes'],
  'משטחי עץ': ['משטח', 'משטחי', 'פלטה', 'פלטות', 'pallet', 'pallets'],
  'כובעים': ['כובע', 'כובעי', 'כיסוי', 'כיסויי', 'cap', 'caps'],
};

// אותיות עם צורה סופית (ך ם ן ף ץ) — מופיעות רק בסוף מילה. ברגע
// שמוסיפים סיומת (למשל ריבוי "ים"), האות חוזרת לצורה הרגילה באמצע
// המילה: "קרטון" (סופית) אבל "קרטונים" (רגילה, כי יש עוד ים אחריה).
// בלי הנרמול הזה "קרטון" כתת-מחרוזת פשוט **לא מופיע בכלל** בתוך
// "קרטונים" — נמצא בפועל בבדיקה שנכשלה (qa-check.mjs, 2026-10-06).
const FINAL_LETTERS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** הסרת ניקוד עברי, פיסוק, רווחים כפולים, אותיות סופיות → רגילות — להשוואה מטושטשת */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // ניקוד
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c])
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // פיסוק -> רווח
    .replace(/\s+/g, ' ')
    .trim();
}

/** מסיר סיומת ריבוי/נקבה-רבים נפוצה (ים/ות) — גזע גס, לא דקדוק מלא */
function stripHebrewSuffix(word) {
  return word.replace(/(ים|ות)$/u, '');
}

/**
 * האם haystack "מכיל" את needle, גם בהטיה (יחיד/רבים, אותיות סופיות).
 * אחרי נרמול (כולל אותיות סופיות→רגילות) תת-מחרוזת ישירה כבר פותרת
 * את רוב מקרי הריבוי (קרטון/קרטונים, ניילון/ניילונים). למקרים שבהם
 * הריבוי משנה את סוף המילה ממש (יריעה/יריעות, פלטה/פלטות) — משווים
 * גזעים (אחרי הסרת ים/ות) בין כל מילה ב-haystack לבין ה-needle.
 */
function fuzzyIncludes(haystack, needle) {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n) return false;
  if (h.includes(n)) return true;
  const nStem = stripHebrewSuffix(n);
  for (const hw of h.split(' ')) {
    const hwStem = stripHebrewSuffix(hw);
    if (hwStem.length < 3) continue;
    if (hwStem === nStem || hwStem.startsWith(nStem) || nStem.startsWith(hwStem)) return true;
  }
  return false;
}

/**
 * קטגוריית המלאי (אם בכלל) שמילת-תיאור שייכת אליה.
 *
 * ⚠️ סעיף V4 (8.10.2026, הוראת תמר): עד כה ההתאמה הסתמכה **רק** על
 * מילון-הכינויים הקבוע (4 שמות בקוד), ולכן כל קטגוריה שתמר מוסיפה
 * במלאי — למשל "סולר" או "רשתות" — לא הייתה מזוהה לעולם, גם אם שם
 * הפריט מופיע מילה-במילה בחשבונית. עכשיו מתאימים **גם מול רשימת
 * הקטגוריות שקיימות בפועל במלאי**, והמילון נשאר כתוספת (לכינויים
 * שאינם שם-הקטגוריה: "יריעה"→נילונים, "ארגז"→קרטונים וכו').
 *
 * סדר: קודם המילון המתוחזק (מדויק וממוקד), ואחריו שמות-הקטגוריות
 * האמיתיים. `categories` אופציונלי — בלעדיו ההתנהגות זהה לקודם
 * (כך שבדיקות קיימות שקוראות עם ארגומנט אחד ממשיכות לעבוד).
 */
function categoryOfDescription(description, categories) {
  const norm = normalize(description);
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((a) => fuzzyIncludes(norm, a))) return category;
    // גם שם הקטגוריה המלא עצמו ("נילונים"/"קרטונים"/...) ככינוי
    if (fuzzyIncludes(norm, category)) return category;
  }
  for (const category of categories || []) {
    const c = normalize(category);
    // שם קצר מדי (1-2 תווים) יתפוס רעש — למשל קטגוריה "מ'" בתוך כל מילה
    if (c.length < 3) continue;
    if (fuzzyIncludes(norm, c)) return category;
  }
  return null;
}

/**
 * ממיר כמות ליחידת המלאי כשהיא ברורה. מחזיר {quantity, ok:true} אם
 * ההמרה חד-משמעית, אחרת {ok:false} — "לא ברור" חייב לעצור הורדה
 * אוטומטית (לא לנחש), לפי הכלל המפורש במשימה.
 * כרגע תומך רק בזיהוי "אותה יחידה" או "יחידה בודדת מרומזת" (כמות
 * שורה = כמות פריטים, היחידה היא "יחידה"/ריקה) — כל המרה מורכבת
 * יותר (מ' -> גלילים, ק"ג -> שקיות) מסומנת "לא ברור" בכוונה, כי
 * המלאי אצלנו לא שומר יחידת-מידה מפורשת לכל פריט (רק "מלאי נוכחי"
 * מספרי גולמי) — אין מקור-אמת להמיר נגדו בלי לנחש.
 */
// ⚠️ 8.10.2026, באג אמיתי שנתפס בבדיקה חיה על הוצאה #48: שלוש שורות
// "רשת נגד מזיקים" נמדדו ב-**מ"ר** (382.5 / 960 / 600), ו-"מ\"ר" לא היה
// ברשימת היחידות-הלא-ברורות — ולכן הן ירדו כאילו היו יחידות, והורידו
// את "רשתות" מ-10 ל-**-1932.5**. (בוטל מיד דרך reverseInventoryDeduction.)
// לפני סעיף V4 זה לא היה מתרחש רק במקרה — "רשת" לא התאימה לאף קטגוריה
// במילון, ולכן שום דבר לא ירד. ברגע שההתאמה לקטגוריות-אמיתיות נפתחה,
// הפער הזה נחשף. שתי הגנות נוספו: רשימת-היחידות הורחבה (שטח/נפח/משקל/
// אורך), **וגם** חסם-שפיות שלא נותן להוריד אוטומטית יותר מהמלאי הקיים.
const AMBIGUOUS_UNITS = [
  'מ', 'מטר', 'מטרים', 'מטר רץ', 'ליטר', 'ליטרים', 'חבילה', 'חבילות',
  'ק"ג', 'קג', 'קילו', 'גרם', 'טון',
  'מ"ר', 'מ"ק', 'דונם', 'סמ"ר', 'מ״ר', 'מ״ק',
];

function resolveQuantity(line) {
  if (line.quantity == null || !Number.isFinite(line.quantity) || line.quantity <= 0) return { ok: false };
  const unit = normalize(line.unit || '');
  if (unit && AMBIGUOUS_UNITS.some((u) => unit === normalize(u))) return { ok: false };
  return { ok: true, quantity: line.quantity };
}

/**
 * מתאים שורות מסמך לפריטי מלאי קיימים.
 * @param lines שורות שחולצו מהמסמך (ר' document-analysis.js)
 * @param inventoryItems רשומות "מלאי בסיסי" חיות (עם id, קטגוריה, מלאי נוכחי...)
 * @returns [{ line, item, confidence, quantity, needsApproval, reason }]
 *   item=null כשלא נמצאה התאמה (לא מדווח כלל, לא רק "לא בטוח") — רק
 *   פריטים שבאמת קיימים במלאי מטופלים, כנדרש במפורש.
 */
export function matchLinesToInventory(lines, inventoryItems) {
  const itemsByCategory = new Map();
  for (const item of inventoryItems || []) {
    const cat = item['קטגוריה'];
    if (cat) itemsByCategory.set(cat, item);
  }

  const results = [];
  for (const line of lines) {
    // סעיף V4: גם מול הקטגוריות שקיימות בפועל במלאי, לא רק מול המילון
    const category = categoryOfDescription(line.description, [...itemsByCategory.keys()]);
    if (!category) continue; // אין התאמה לאף קטגוריה — לא מדווח (רק פריטים קיימים)
    const item = itemsByCategory.get(category);
    if (!item) continue; // הקטגוריה זוהתה אבל אין לה פריט במלאי כרגע (למשל לפני שתמר תוסיף)

    const qty = resolveQuantity(line);
    const CONFIDENCE_THRESHOLD = 0.85;
    // חסם-שפיות (8.10.2026): הורדה אוטומטית לא תיקח את המלאי למינוס.
    // זה השומר האחרון מול טעות-המרת-יחידות — גם אם יחידה חדשה תתפספס
    // ברשימה למעלה, המערכת תבקש אישור במקום להוריד 1,942 מתוך 10.
    const current = Number(item['מלאי נוכחי']);
    const exceedsStock = qty.ok && Number.isFinite(current) && qty.quantity > current;
    const needsApproval = !qty.ok || exceedsStock || line.confidence < CONFIDENCE_THRESHOLD;
    results.push({
      line,
      item,
      category,
      confidence: line.confidence,
      quantity: qty.ok ? qty.quantity : line.quantity,
      needsApproval,
      reason: !qty.ok
        ? 'יחידת מידה לא ברורה — דורש אישור'
        : exceedsStock
          ? `הכמות (${qty.quantity}) גדולה מהמלאי הקיים (${current}) — דורש אישור`
          : (line.confidence < CONFIDENCE_THRESHOLD ? `ביטחון נמוך (${Math.round(line.confidence * 100)}%) — דורש אישור` : null),
    });
  }
  return results;
}

export { normalize, categoryOfDescription }; // נחשפים לבדיקות
