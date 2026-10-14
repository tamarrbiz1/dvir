// ============================================================
// "סוג טיפול" ובסיס המינון שנגזר ממנו — מקור אמת אחד (משימה AP, 14.10.2026)
// ------------------------------------------------------------
// הוראת תמר: "ביצירת טיפול — אפשרות לבחור סוג ריסוס: ריסוס, הגמעה וכו'.
// בייבוא מדוח — את השדה סוג מרסס תשאיר ריק תמיד (שם כותבים את שם
// המכשיר), ואת סוג הריסוס תמלא לבד, ולפיו ברירת מחדל של בסיס מינון.
// וגם ביצירת טיפול ידני — ברירת מחדל ברגע שנבחר סוג."
//
// הקובץ מיובא **גם** מהשרת (server/src/spray-report-import.js) **וגם**
// מהלקוח (client/src/pages/TreatmentsPage.jsx), כדי שלא ייווצר מצב שבו
// הייבוא מדוח וטופס הטיפול הידני חושבים דברים שונים על אותו סוג. אין לו
// שום תלות (לא Node ולא DOM) — ESM טהור.
//
// ⚠️ שני שדות ב-Airtable, שאסור לבלבל ביניהם:
//   • "סוג טיפול"  — singleSelect ("ריסוס", "הגמעה"). **זה** סוג הטיפול.
//   • "סוג מרסס"   — singleLineText, שם המכשיר ("מרסס א"). הייבוא מדוח
//                     לא כותב אליו **לעולם** (ר' buildRow).
// ============================================================

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// מפתח השוואה: בלי רווחים, מקפים (כולל מקף עברי ומקפים ארוכים), גרשיים
// ואותיות גדולות — כדי ש"ל-100 ליטר" ו"ל100ליטר" ייחשבו אותה אפשרות.
const key = (s) => norm(s).toLowerCase().replace(/["'״׳]/g, '').replace(/[-־–—]/g, '').replace(/\s+/g, '');

/** שמות הסוגים הקנוניים — אלה גם שמות האפשרויות בשדה "סוג טיפול" ב-Airtable */
export const TREATMENT_TYPES = ['ריסוס', 'הגמעה'];

// זיהוי סובלני לפי שורש המילה: "הגמעה"/"הגמעות"/"מגמיע"/"טפטוף" → הגמעה;
// "ריסוס"/"מרסס"/"מרסס א'" → ריסוס. הסדר חשוב — "הגמעה" נבדק ראשון.
const TYPE_PATTERNS = [
  [/הגמע|טפטוף|טיפטוף/, 'הגמעה'],
  [/ריסוס|רסס/, 'ריסוס'],
];

/**
 * טקסט חופשי (מדוח, או מהשדה "סוג מרסס" הישן) → שם סוג קנוני, או null
 * אם לא זוהה. אל תכתוב null ל-Airtable — השאר את השדה ריק.
 */
export function canonicalTreatmentType(raw) {
  const s = norm(raw);
  if (!s) return null;
  for (const [re, name] of TYPE_PATTERNS) if (re.test(s)) return name;
  return null;
}

/** AP-1: ברירת המחדל ל"בסיס מינון" לפי סוג הטיפול. כל סוג אחר — אין ברירת מחדל */
export const BASIS_BY_TYPE = {
  'ריסוס': 'ל-100 ליטר',
  'הגמעה': 'לדונם',
};

/**
 * הערך **המדויק** מתוך רשימת האפשרויות של שדה בחירה, שמתאים ל-wanted.
 * כתיבת ערך שאינו ברשימה נדחית ע"י Airtable, ולכן כל ערך שנכתב לשדה
 * select עובר דרך כאן. בלי רשימה (המטא לא נטען) — מחזיר את wanted כמו
 * שהוא, כי זה המצב שבו אין לנו ידע טוב יותר.
 * @returns {string|null} שם האפשרות הקיימת, או null אם אין התאמה
 */
export function matchChoice(wanted, choices) {
  const w = key(wanted);
  if (!w) return null;
  if (!Array.isArray(choices) || !choices.length) return norm(wanted);
  return choices.find((c) => key(c) === w) ?? null;
}

/**
 * סוג הטיפול לכתיבה לשדה "סוג טיפול": זיהוי סובלני ואז התאמה לאפשרות
 * קיימת. null → לא כותבים (ובייבוא, הסוג הגולמי נשאר בהערות).
 */
export function treatmentTypeOption(raw, typeChoices) {
  const canon = canonicalTreatmentType(raw);
  return canon ? matchChoice(canon, typeChoices) : null;
}

/**
 * ברירת המחדל של "בסיס מינון" לסוג טיפול נתון, מותאמת לאפשרות קיימת
 * בשדה. null = אין ברירת מחדל (סוג לא מוכר, או שהאפשרות לא קיימת בשדה
 * — ואז לא כותבים כלום ומדווחים).
 */
export function defaultBasisForType(type, basisChoices) {
  const canon = canonicalTreatmentType(type);
  const wanted = canon ? BASIS_BY_TYPE[canon] : null;
  return wanted ? matchChoice(wanted, basisChoices) : null;
}

/**
 * AP-2.2 — מה "בסיס מינון" צריך להיות אחרי שהמשתמשת שינתה את "סוג
 * טיפול" בטופס. פונקציה טהורה, כדי שהכלל יהיה בדיק (qa-check).
 *
 * הכלל: ברירת המחדל של הסוג החדש נכתבת **רק** אם הבסיס הנוכחי ריק או
 * שהוא ברירת המחדל של הסוג הקודם. בסיס שהמשתמשת בחרה בעצמה לא נדרס.
 * @returns {string} הבסיס החדש ('' = ריק)
 */
export function basisOnTypeChange({ prevType, nextType, currentBasis, basisChoices }) {
  const prevDefault = defaultBasisForType(prevType, basisChoices);
  const chosenByUser = !!currentBasis && currentBasis !== prevDefault;
  if (chosenByUser) return currentBasis;
  return defaultBasisForType(nextType, basisChoices) || '';
}

export default { TREATMENT_TYPES, BASIS_BY_TYPE, canonicalTreatmentType, matchChoice, treatmentTypeOption, defaultBasisForType, basisOnTypeChange };
