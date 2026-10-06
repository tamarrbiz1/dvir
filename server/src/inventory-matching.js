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

/** קטגוריית המלאי (אם בכלל) שמילת-תיאור שייכת אליה, לפי מילון הכינויים */
function categoryOfDescription(description) {
  const norm = normalize(description);
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((a) => fuzzyIncludes(norm, a))) return category;
    // גם שם הקטגוריה המלא עצמו ("נילונים"/"קרטונים"/...) ככינוי
    if (fuzzyIncludes(norm, category)) return category;
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
function resolveQuantity(line) {
  if (line.quantity == null || !Number.isFinite(line.quantity) || line.quantity <= 0) return { ok: false };
  const unit = normalize(line.unit || '');
  const AMBIGUOUS_UNITS = ['מ', 'מטר', 'מטרים', 'ק"ג', 'קג', 'ליטר', 'חבילה', 'חבילות']; // דורשות המרה שאין לנו בסיס לה
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
    const category = categoryOfDescription(line.description);
    if (!category) continue; // אין התאמה לאף קטגוריה — לא מדווח (רק פריטים קיימים)
    const item = itemsByCategory.get(category);
    if (!item) continue; // הקטגוריה זוהתה אבל אין לה פריט במלאי כרגע (למשל לפני שתמר תוסיף)

    const qty = resolveQuantity(line);
    const CONFIDENCE_THRESHOLD = 0.85;
    const needsApproval = !qty.ok || line.confidence < CONFIDENCE_THRESHOLD;
    results.push({
      line,
      item,
      category,
      confidence: line.confidence,
      quantity: qty.ok ? qty.quantity : line.quantity,
      needsApproval,
      reason: !qty.ok ? 'יחידת מידה לא ברורה — דורש אישור' : (line.confidence < CONFIDENCE_THRESHOLD ? `ביטחון נמוך (${Math.round(line.confidence * 100)}%) — דורש אישור` : null),
    });
  }
  return results;
}

export { normalize, categoryOfDescription }; // נחשפים לבדיקות
