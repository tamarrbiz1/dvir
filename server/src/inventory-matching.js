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
 */
// ⚠️ 8.10.2026, באג אמיתי שנתפס בבדיקה חיה על הוצאה #48: שלוש שורות
// "רשת נגד מזיקים" נמדדו ב-**מ"ר** (382.5 / 960 / 600), ו-"מ\"ר" לא היה
// ברשימת היחידות-הלא-ברורות — ולכן הן ירדו כאילו היו יחידות, והורידו
// את "רשתות" מ-10 ל-**-1932.5**. (בוטל מיד דרך reverseInventoryDeduction.)
// לפני סעיף V4 זה לא היה מתרחש רק במקרה — "רשת" לא התאימה לאף קטגוריה
// במילון, ולכן שום דבר לא ירד. ברגע שההתאמה לקטגוריות-אמיתיות נפתחה,
// הפער הזה נחשף.
//
// ⚠️⚠️ סעיף Z (8.10.2026, "משימה Z" — יחידת-מידה לכל פריט): התיקון
// הזמני (רשימת-יחידות-עמומות + חסם לא-מורידים-מעבר-למלאי) הוחלף עכשיו
// במקור-אמת אמיתי: שדה "יחידת מידה" על פריט-המלאי עצמו (טקסט חופשי
// ב-Airtable, לא single-select — תמר הוסיפה את השדה בעצמה). ההשוואה:
// היחידה שחולצה מהשורה מול היחידה שהוגדרה לפריט, שתיהן אחרי נרמול-
// יחידות (לא ניחוש-המרה!): זהות → מורידים אוטומטית; שונות → "דורש
// אישור" עם הסבר מפורש ששתי היחידות מוצגות בו. **לעולם לא ממירים בין
// יחידות שונות** (מ"ר↔יחידות וכו') — זה בדיוק מה שגרם לתקרית המקורית.
// חסם-השפיות (לא-מורידים-מעבר-למלאי, ר' exceedsStock למטה) נשאר
// כהגנת-עומק נוספת ובלתי-תלויה.
//
// ⚠️ שדה "יחידת מידה" ריק כרגע על **כל** 7 הפריטים הקיימים — "ריק"
// מתפרש כ-"יחידות" **רק בזמן-קריאה/השוואה כאן בקוד** (ר' resolveQuantity
// למטה), ולעולם לא נכתב כברירת-מחדל בפועל ל-Airtable (לא על פריטים
// אמיתיים ולא על אחרים) — כך שההתנהגות הקיימת על הנתונים האמיתיים
// ממשיכה לעבוד בדיוק כמו היום (יחידה/ריק נחשב "יחידות"), עד שתמר תמלא
// את השדה בעצמה דרך הטופס.

// שבעת סוגי-היחידות שהטופס מציע (ר' client/src/pages/InventoryPage.jsx,
// UNIT_OPTIONS) + כינויים נפוצים לכל אחד מהם. המפתחות הם "נרמול-יחידה"
// קומפקטי (ר' compactUnit למטה — מסיר גם רווחים, לא רק מנקד/מפסיק),
// כדי ש"מ\"ר"/"מר"/"מ״ר" (כל הגרשיים השונים) יתכנסו לאותו מפתח.
const UNIT_ALIAS_TABLE = {
  'יחידות': ['יחידה', "יח'", 'יח', 'יחידת', 'pcs', 'piece', 'pieces', 'unit', 'units', ''],
  'ליטר': ['ליטרים', "ל'", 'ל', 'liter', 'liters', 'litre', 'litres'],
  'מ"ר': ['מר', 'מטר רבוע', 'מטרים רבועים', 'sqm', 'm2', 'מ²'],
  "מ'": ['מ', 'מטר', 'מטרים', 'מטר רץ', 'meter', 'meters', 'm'],
  'ק"ג': ['קג', 'קילו', 'קילוגרם', 'kg'],
  'גליל': ['גלילים', 'roll', 'rolls'],
  'קרטון': ['קרטונים', 'ארגז', 'ארגזים', 'box', 'boxes', 'carton', 'cartons'],
};
const UNIT_ALIAS_LOOKUP = (() => {
  const map = {};
  for (const [canonical, aliases] of Object.entries(UNIT_ALIAS_TABLE)) {
    map[compactUnit(canonical)] = canonical;
    for (const a of aliases) map[compactUnit(a)] = canonical;
  }
  return map;
})();

/** נרמול-יחידה קומפקטי: מסיר ניקוד/פיסוק/**כל** רווח (לא רק מכפיל) — יחידות
 * הן טוקנים קצרים, ובניגוד ל-normalize() (שמשמש להתאמת-קטגוריה מטושטשת
 * ומשמר רווח יחיד), כאן "מ\"ר" (עם גרש) ו"מר" (בלי) חייבים להתכנס לאותו
 * ערך — ה-גרש/גרשיים מוסרים ע"י [^\p{L}\p{N}] בדיוק כמו רווח. */
function compactUnit(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c])
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** היחידה-הקנונית (אחת מ-7 השמות בטופס) שטקסט שייך אליה, או null אם
 * הטקסט לא מזוהה כלל כאחת מהיחידות הידועות/כינוייהן. */
function canonicalUnit(text) {
  const key = compactUnit(text);
  return Object.prototype.hasOwnProperty.call(UNIT_ALIAS_LOOKUP, key) ? UNIT_ALIAS_LOOKUP[key] : null;
}

function resolveQuantity(line, item) {
  if (line.quantity == null || !Number.isFinite(line.quantity) || line.quantity <= 0) return { ok: false, why: 'invalid-quantity' };

  // הזנה ידנית (סעיף R, 7.10.2026: "יחידה הוסרה — לא רלוונטית להפחתת
  // כמות מהמלאי") — ל-cleanLines ב-runManualExpenseInventoryDeduction
  // (inventory-deduction.js) אין בכלל מפתח unit (undefined ממש, לא
  // null/''). document-analysis.js לעומת זאת **תמיד** כותב unit מפורש
  // (מחרוזת או null, ר' שם) — ולכן undefined ממש הוא סימן אמין ל"כמות
  // הוקלדה ידנית ע"י המשתמשת" (ביטחון 1.0, היא בחרה את הפריט בעצמה),
  // לא לבדיקת-יחידה בכלל.
  if (line.unit === undefined) return { ok: true, quantity: line.quantity, why: 'ok' };

  const itemUnitRaw = String(item?.['יחידת מידה'] || '').trim();
  // ריק → "יחידות" בזמן-קריאה בלבד (ר' הערת-הכותרת למעלה) — לא נכתב בחזרה
  const itemUnit = itemUnitRaw ? canonicalUnit(itemUnitRaw) : 'יחידות';
  const lineUnit = canonicalUnit(line.unit);

  if (lineUnit == null) {
    // טקסט-יחידה שלא מזוהה כלל (לא אחת מ-7 הסוגים או כינוי שלהם) — נשאר
    // "לא ברור" בדיוק כמו ההתנהגות הקודמת (AMBIGUOUS_UNITS), גם אם
    // itemUnit לא ידוע: אין בסיס להשוואה.
    return { ok: false, why: 'unit-unknown' };
  }
  if (!itemUnit || lineUnit !== itemUnit) {
    return {
      ok: false, why: 'unit-mismatch',
      lineUnitDisplay: lineUnit, itemUnitDisplay: itemUnit || (itemUnitRaw || 'לא מוגדרת'),
    };
  }
  return { ok: true, quantity: line.quantity, why: 'ok' };
}

/** בונה את הודעת-ההסבר ל-reason לפי קוד ה-why (ר' resolveQuantity/
 * matchLinesToInventory) — מחרוזת-תצוגה אחת לכל קוד, כולל שני
 * היחידות בפועל כש-why==='unit-mismatch' (בדיוק כמו שהתבקש: "החשבונית
 * ב-X, המלאי מנוהל ב-Y — אשרי את הכמות"). null כש-why==='ok'. */
function approvalReason(why, qty, current, line) {
  switch (why) {
    case 'ok': return null;
    case 'unit-mismatch':
      // "יחידת מידה" חייב להישאר במחרוזת (לא רק בתיאור הכללי) — נבדק
      // במפורש בבדיקות קיימות (qa-check.mjs).
      return `יחידת מידה שונה: החשבונית ב-${qty.lineUnitDisplay}, המלאי מנוהל ב-${qty.itemUnitDisplay} — אשרי את הכמות`;
    case 'unit-unknown':
      return 'יחידת מידה לא ברורה — דורש אישור';
    case 'exceeds-stock':
      return `הכמות (${qty.quantity}) גדולה מהמלאי הקיים (${current}) — דורש אישור`;
    case 'low-confidence':
      return `ביטחון נמוך (${Math.round(line.confidence * 100)}%) — דורש אישור`;
    default:
      return 'דורש אישור';
  }
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

    const qty = resolveQuantity(line, item);
    const CONFIDENCE_THRESHOLD = 0.85;
    // חסם-שפיות (8.10.2026): הורדה אוטומטית לא תיקח את המלאי למינוס.
    // זה השומר האחרון מול טעות-המרת-יחידות — גם אם יחידה חדשה תתפספס
    // ברשימה למעלה, המערכת תבקש אישור במקום להוריד 1,942 מתוך 10.
    const current = Number(item['מלאי נוכחי']);
    const exceedsStock = qty.ok && Number.isFinite(current) && qty.quantity > current;
    const needsApproval = !qty.ok || exceedsStock || line.confidence < CONFIDENCE_THRESHOLD;
    // why: קוד-סיבה יציב (לצריכה תכנותית, לא רק טקסט תצוגה) — סעיף Z.
    // מסדר-העדיפויות שלא השתנה: יחידה לפני חריגה-ממלאי לפני ביטחון-נמוך.
    const why = !qty.ok ? qty.why : exceedsStock ? 'exceeds-stock' : (line.confidence < CONFIDENCE_THRESHOLD ? 'low-confidence' : 'ok');
    results.push({
      line,
      item,
      category,
      confidence: line.confidence,
      quantity: qty.ok ? qty.quantity : line.quantity,
      needsApproval,
      why,
      reason: approvalReason(why, qty, current, line),
    });
  }
  return results;
}

export { normalize, categoryOfDescription, canonicalUnit }; // נחשפים לבדיקות
