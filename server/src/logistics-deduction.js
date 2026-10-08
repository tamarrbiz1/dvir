// ============================================================
// הורדת מלאי מתעודות משלוח/חשבוניות (תוספת 2026-10-06, סעיף D) —
// בניגוד ל"הוצאות" (document-analysis.js), כאן אין AI: השדות
// (כמות קרטונים, מספר משטחים) כבר ממולאים ישירות ע"י Make על הרשומה
// עצמה. התפקיד שלנו: לקרוא אותם, להצליב בין תעודת משלוח לחשבונית
// לאותו "קוד שבוע", ולהוריד מ"מלאי בסיסי".
//
// ⚠️ אין בטבלאות האלה שדה "הערות" (נבדק מול הסכימה בפועל) — אי אפשר
// לשמור עליהן state כמו ה-marker [מלאי-AI] ב"הוצאות". לכן אין state
// על המסמך המקור בכלל: הפונקציה הזו חוזרת-בטוחה (אידמפוטנטית) כי
// לפני כל הורדה *שבוצעה בפועל* היא בודקת אם כבר קיימת תגית-מקור
// תואמת בהערות של פריט המלאי עצמו — וזו גם יחידת ה-state היחידה
// שיש הרשאה לכתוב לה.
//
// ⚠️⚠️ תקרית אמיתית 2026-10-06 (בדיקת-אמת מול Airtable חי, לא השערה):
// ל-Make לוקח זמן למלא "כמות קרטונים"/"מספר משטחים" אחרי העלאה. לפני
// התיקון הזה, num() המיר שדה ריק/חסר ל-0 (לא ל-null!) — כך ש-0 נחשב
// "יש נתון" ו-deductOne כתב תגית-אידמפוטנטיות גם כשההורדה היתה 0
// מזויף. התגית חסמה לנצח כל ניסיון חוזר מאוחר יותר עם הנתון האמיתי.
// תעודות #45/#47 (recPuhd0dotAhQAdF / recoBwKNFzdhbEsQb) ננעלו כך בפועל
// ב-12:08/12:13 ב-2026-10-06, עם "↓ 0" בהערות הפריט במקום 450 קרטונים/
// נילונים/כובעים כל אחת. חשבונית #61 (recxVMx3Fw5rKwY57) ננעלה דומה
// ל-0 משטחי עץ "דורש אישור". ר' תיעוד מפורט ב-PROGRESS/דוח הסיום —
// אלה נותרו *לא מתוקנים בנתונים האמיתיים* בכוונה (אין הרשאה לתקן
// נתוני-אמת); הקוד כאן מתוקן כדי שזה לא יקרה לתעודות/חשבוניות עתידיות,
// ולאפשר ריצה חוזרת תקינה היכן שהתגית עדיין לא ננעלה (ר' PENDING_SKIP
// ו-deductOne למטה — "ממתין לנתון" לעולם לא כותב שום דבר ל-Airtable).
//
// ⚠️⚠️ סעיף N1 (2026-10-07, הוראת תמר) — כלל חדש למשטחים: בניגוד
// לקרטונים/נילונים/כובעים (שכבר לא נחסמים מ-2026-10-06), **משטחי-עץ
// עצמם גם לא נחסמים יותר כש-needsApproval** — זה שינוי-מדיניות, לא
// המשך של אותו תיקון. משטחים יורדים *תמיד* מ"מספר משטחים" בחשבונית,
// בלי קשר להתאמה לתעודת-המשלוח; כשאין התאמה (סטייה>5% או אין תעודה
// לשבוע כלל) — מתועד `mismatchNote` מפורט בהערות הפריט (עם מספרי
// החשבונית/התעודות הרלוונטיות), לא חסימה. חשבונית #61 (recxVMx3Fw5rKwY57,
// 5.58% סטייה) היא המקרה שהניע את השינוי — אושר ע"י תמר להרצה לאחר המיזוג.
// ============================================================
import { fetchRecords, updateRecord } from './airtable.js';
// סעיף Z — אותו נרמול-יחידות שההתאמה בהוצאות משתמשת בו, כדי ש-"יח'"/
// "קרטונים" לא ייחשבו ליחידה אחרת מ-"יחידות"/"קרטון" (ר' unitBlockReason)
import { canonicalUnit } from './inventory-matching.js';

const NOTES_TABLE = 'תעודות משלוח';
const INVOICES_TABLE = 'חשבוניות';
const INVENTORY_TABLE = 'מלאי בסיסי';
export const PENDING_SKIP = 'הנתון עוד לא מולא';

// מקדם קבוע: שקית אחת וכובע אחד לכל קרטון יוצא. אין דרך לדעת מהשדות
// הקיימים אם מסמך ספציפי ציין כמות מפורשת של כובעים/שקיות (זה יצריך
// קריאת תוכן המסמך, לא רק שדות מובנים) — לכן תמיד נגזר מהמקדם.
const UNITS_PER_CARTON = 1;

// ⚠️ אחוז הסטייה המותר בין כמות קרטונים בתעודה לכמות בחשבונית לאותו
// שבוע — החלטה סופית של תמר: 5%, לא משתנה בלי אישור מפורש נוסף.
// הבסיס להשוואה *כן* השתנה (2026-10-06): סכום כל התעודות/החשבוניות של
// השבוע, לא זוג בודד — אחרת שבוע עם 2+ תעודות "נכשל" בהצלבה באופן מובנה
// גם כשהכול תקין (כל תעודה, בפני עצמה, סוטה מהחשבונית-השבועית-המלאה).
export const DEVIATION_THRESHOLD = 0.05;

// ערך חסר/ריק/0 תמיד null — "0" אמיתי שהוזן בפועל (למשל מסמך שבאמת
// מציין 0) לעולם לא מגיע לכאן כמחרוזת ריקה, רק כ-"0" ממשי, וגם הוא
// מטופל כ"אין עדיין נתון" בכוונה (ר' למעלה) כי בפועל 0 קרטונים/משטחים
// אמיתי בתעודה הוא תרחיש לא-ריאלי לעומת "Make עוד לא מילא".
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function computeDeviation(a, b) {
  if (a == null || b == null) return null;
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base;
}

/** מוצא את הרשומה המקבילה (תעודה↔חשבונית) לאותו "קוד שבוע" בדיוק */
export function findCounterpart(weekCode, counterpartRecords) {
  if (!weekCode) return null;
  return counterpartRecords.find((r) => r['קוד שבוע'] === weekCode) || null;
}

function pendingResult(sourceTable, record, fieldLabel) {
  const numLabel = sourceTable === NOTES_TABLE ? record['מספר תעודה'] : record['מספר חשבונית'];
  return {
    category: null, quantity: null, weekCode: record['קוד שבוע'] || null,
    sourceTable, sourceId: record.id,
    sourceLabel: sourceTable === NOTES_TABLE ? `תעודה #${numLabel ?? '?'}` : `חשבונית #${numLabel ?? '?'}`,
    pending: true, skipped: PENDING_SKIP,
    reason: `השדה "${fieldLabel}" עדיין לא מולא — ייתכן ש-Make עדיין מעבד את הקובץ`,
  };
}

/**
 * גוזר את רשימת ההורדות (קטגוריה→כמות) מזוג (תעודת משלוח, חשבונית)
 * לאותו שבוע. לא נדרש ששני הצדדים יהיו קיימים — אם רק אחד קיים,
 * מה שאפשר להוריד ממנו יורד, עם אזהרת "בלי הצלבה" (לא חוסמת).
 *
 * weekNoteCartonsTotal / weekInvoiceCartonsTotal — סכומי-השבוע המלאים
 * (כל התעודות/החשבוניות של אותו קוד-שבוע, לא רק הזוג הנוכחי) לצורך
 * ההצלבה; כשלא מועברים (תאימות-לאחור לבדיקות זוג-בודד) — נופלים חזרה
 * לכמויות של הזוג הנוכחי בלבד.
 *
 * ⚠️ 2026-10-06: סטייה-מעל-הסף בין תעודות לחשבוניות **לא חוסמת** את
 * קרטונים/נילונים/כובעים — התעודה היא עדות ישירה לכמות שבאמת יצאה
 * פיזית, ומורידים אותה בכל מקרה, רק עם אזהרה "⚠ סטייה X%". חסימה
 * אמיתית (needsApproval) נשארת רק למשטחי-עץ, שנגזרים מהחשבונית בלבד
 * וללא "תעודה" ישירה שאפשר להסתמך עליה כשההצלבה נכשלת.
 */
export function deriveDeductions({ note, invoice, weekNoteCartonsTotal, weekInvoiceCartonsTotal, weekNoteNumbers } = {}) {
  const weekCode = note?.['קוד שבוע'] || invoice?.['קוד שבוע'] || null;
  const crossNote = weekNoteCartonsTotal !== undefined ? weekNoteCartonsTotal : (note ? num(note['כמות קרטונים']) : null);
  const crossInvoice = weekInvoiceCartonsTotal !== undefined ? weekInvoiceCartonsTotal : (invoice ? num(invoice['כמות קרטונים']) : null);
  const hasCross = crossNote != null && crossInvoice != null;
  const deviation = hasCross ? computeDeviation(crossNote, crossInvoice) : null;
  const deviated = hasCross && deviation > DEVIATION_THRESHOLD;
  const cartonsCrossCheck = hasCross ? { noteCartons: crossNote, invoiceCartons: crossInvoice, deviation, ok: !deviated } : null;

  const out = [];

  if (note) {
    const noteCartons = num(note['כמות קרטונים']);
    if (!noteCartons) {
      out.push(pendingResult(NOTES_TABLE, note, 'כמות קרטונים'));
    } else {
      for (const category of ['קרטונים', 'נילונים', 'כובעים']) {
        const quantity = category === 'קרטונים' ? noteCartons : Math.round(noteCartons * UNITS_PER_CARTON);
        out.push({
          category, quantity, weekCode,
          sourceTable: NOTES_TABLE, sourceId: note.id, sourceLabel: `תעודה #${note['מספר תעודה'] ?? '?'}`,
          derivedFrom: category === 'קרטונים' ? 'ישיר מהתעודה' : `${noteCartons} קרטונים × ${UNITS_PER_CARTON}`,
          needsApproval: false,
          reason: deviated
            ? `⚠ סטייה ${(deviation * 100).toFixed(1)}% מול חשבוניות השבוע (סה"כ תעודות: ${crossNote}, סה"כ חשבוניות: ${crossInvoice}) — נגזר מהתעודה בכל זאת`
            : (!hasCross ? 'אין חשבונית מקבילה לשבוע זה — בלי הצלבה' : null),
          softWarning: !hasCross || deviated,
        });
      }
    }
  }

  if (invoice) {
    const pallets = num(invoice['מספר משטחים']);
    if (!pallets) {
      out.push(pendingResult(INVOICES_TABLE, invoice, 'מספר משטחים'));
    } else {
      // ⚠️ סעיף N1 (2026-10-07, הוראת תמר — מחליף את ההתנהגות הקודמת):
      // משטחים יורדים **תמיד** מהחשבונית, בלי קשר להתאמה לתעודת המשלוח.
      // כשאין התאמה (סטייה>5% או אין תעודה לשבוע כלל) — לא חוסמים, רק
      // מתעדים בהערות הפריט את אי-ההתאמה עם הפניה למספרי המסמכים.
      const invoiceNum = invoice['מספר חשבונית'] ?? '?';
      const mismatch = deviated || !hasCross;
      const noteNumsText = (weekNoteNumbers && weekNoteNumbers.length)
        ? `תעודות ${weekNoteNumbers.map((n) => `#${n}`).join(', ')}`
        : 'אין תעודות לשבוע זה';
      const mismatchNote = mismatch
        ? `אין התאמה לתעודת המשלוח (${hasCross ? `סטייה ${(deviation * 100).toFixed(1)}%` : 'אין תעודה לשבוע זה'}) · חשבונית #${invoiceNum} · ${noteNumsText}`
        : null;
      out.push({
        category: 'משטחי עץ', quantity: pallets, weekCode,
        sourceTable: INVOICES_TABLE, sourceId: invoice.id, sourceLabel: `חשבונית #${invoiceNum}`,
        derivedFrom: 'ישיר מהחשבונית (מספר משטחים)',
        needsApproval: false,
        reason: mismatchNote,
        softWarning: mismatch,
        mismatchNote,
      });
    }
  }

  return { weekCode, cartonsCrossCheck, deductions: out };
}

function doneTag(d) {
  return `[מלאי-D:${d.sourceTable}:${d.sourceId}:${d.category}]`;
}

// ⚠️ סעיף Z (8.10.2026, "משימה Z" — יחידת-מידה לכל פריט): שדה "יחידת
// מידה" חופשי על פריט-המלאי (תמר הוסיפה בעצמה, singleLineText — לא
// single-select). "כמות קרטונים"/"מספר משטחים" שמגיעים מ-Make הם תמיד
// **מניין יחידות שלמות**. לכן אם פריט-היעד הוגדר (לא ריק!) ליחידת-מידה
// שאינה "יחידות"/"קרטון" — למשל "ליטר" או "מ\"ר" — אין שום בסיס להוריד
// ממנו את המניין הזה אוטומטית, והשורה הופכת ל"דורש אישור" עם הסבר.
// **אין ולא תהיה המרה בין יחידות** (בדיוק כמו ב-inventory-matching.js).
//
// ⚠️ פריט בלי יחידת-מידה מוגדרת (ריק — המצב של **כל** הפריטים כרגע)
// מוחזר null, כלומר ממשיך בדיוק כמו היום. זו הגנה-עתידית, לא שינוי
// התנהגות על הנתונים הקיימים. עצמאי לגמרי מהגנת-הסטייה/N1 (הצלבת
// מספר קרטונים/משטחים מול התעודה) — לא נוגע בה.
//
// מחזיר את נוסח-הסיבה לתצוגה, או null כשאין חסימה.
export function unitBlockReason(item) {
  const unit = String(item?.['יחידת מידה'] || '').trim();
  if (!unit) return null;
  const canonical = canonicalUnit(unit);
  if (canonical === 'יחידות' || canonical === 'קרטון') return null;
  return `הפריט מנוהל ביחידת מידה "${unit}", והנתון מהמסמך הוא מניין יחידות — דורש אישור ידני (אין המרה אוטומטית בין יחידות)`;
}

async function deductOne(item, d) {
  // "ממתין לנתון" — לעולם לא כותבים שום דבר ל-Airtable (לא שינוי מלאי,
  // לא תגית, לא אזהרה). זה בדיוק מה שמאפשר לניסיון החוזר (אוטומטי או
  // ידני, אחרי שה-Make ימלא את השדה) לרוץ נקי בלי "ננעל על 0".
  if (d.pending) return { ...d };

  const tag = doneTag(d);
  const notes = String(item['הערות'] || '');
  if (notes.includes(tag)) return { ...d, skipped: 'כבר נוצל בעבר (אידמפוטנטיות)' };

  if (d.needsApproval) {
    // אזהרה בלי תגית: מותר (ואף צפוי) שתירשם שוב בניסיון עתידי אם
    // המצב עדיין חסום — אבל *לא חוסמת* ניסיון חוזר לבצע הורדה אמיתית
    // ברגע שהנתונים מסתדרים. דה-דופ פשוט לפי טקסט מדויק כדי לא להציף
    // את ההערות בשורות זהות בכל ניסיון-חוזר אוטומטי (כל 10–60 שניות).
    const warnLine = `⚠ דורש אישור: ${d.quantity} ${d.category} (${d.sourceLabel}, שבוע ${d.weekCode}) — ${d.reason}`;
    if (!notes.split('\n').some((line) => line.trim() === warnLine)) {
      await updateRecord(INVENTORY_TABLE, item.id, { 'הערות': notes ? `${notes}\n${warnLine}` : warnLine });
    }
    return { ...d, deducted: false };
  }

  const current = Number(item['מלאי נוכחי']) || 0;
  // mismatchNote (סעיף N1, משטחים) נותן תיאור-מלא-ומפורש של אי-ההתאמה
  // כולל הפניה למסמכים — גובר על הסיומת הגנרית "⚠ בלי הצלבה".
  const suffix = d.mismatchNote ? ` — ${d.mismatchNote}` : (d.softWarning ? ' ⚠ בלי הצלבה' : '');
  const line = `↓ ${d.quantity} ממלאי: ${d.category} (${d.sourceLabel}, שבוע ${d.weekCode}${d.derivedFrom.startsWith('ישיר') ? '' : ` · ${d.derivedFrom}`})${suffix} ${tag}`;
  await updateRecord(INVENTORY_TABLE, item.id, { 'מלאי נוכחי': current - d.quantity, 'הערות': notes ? `${notes}\n${line}` : line });
  return { ...d, deducted: true, itemId: item.id };
}

/**
 * מריץ את תהליך ההורדה המלא לרשומה אחת (תעודת משלוח או חשבונית):
 * מוצא את הרשומה המקבילה לאותו שבוע, מחשב את סכומי-ההצלבה השבועיים
 * (כל התעודות/החשבוניות של אותו קוד-שבוע, לא רק זוג בודד), גוזר הורדות,
 * ומבצע אותן על פריטי "מלאי בסיסי" הקיימים (רק קטגוריות שיש להן פריט
 * אמיתי). בטוח להרצה חזרה על אותה רשומה — ראו deductOne.
 */
export async function analyzeLogisticsInventory(table, recordId) {
  if (table !== NOTES_TABLE && table !== INVOICES_TABLE) throw new Error(`טבלה לא נתמכת: ${table}`);
  const [notes, invoices, inventoryItems] = await Promise.all([
    fetchRecords(NOTES_TABLE, {}), fetchRecords(INVOICES_TABLE, {}), fetchRecords(INVENTORY_TABLE, {}),
  ]);
  const record = (table === NOTES_TABLE ? notes : invoices).find((r) => r.id === recordId);
  if (!record) throw new Error('הרשומה לא נמצאה');
  const weekCode = record['קוד שבוע'];
  const note = table === NOTES_TABLE ? record : findCounterpart(weekCode, notes);
  const invoice = table === INVOICES_TABLE ? record : findCounterpart(weekCode, invoices);

  const weekNotes = weekCode ? notes.filter((r) => r['קוד שבוע'] === weekCode) : [];
  const weekInvoices = weekCode ? invoices.filter((r) => r['קוד שבוע'] === weekCode) : [];
  const weekNoteCartonsTotal = sumOrNull(weekNotes.map((r) => r['כמות קרטונים']));
  const weekInvoiceCartonsTotal = sumOrNull(weekInvoices.map((r) => r['כמות קרטונים']));
  // מספרי התעודות של השבוע — לציטוט בהערת-אי-התאמה של משטחים (סעיף N1)
  const weekNoteNumbers = weekNotes.map((r) => r['מספר תעודה']).filter((n) => n != null);

  const { cartonsCrossCheck, deductions } = deriveDeductions({ note, invoice, weekNoteCartonsTotal, weekInvoiceCartonsTotal, weekNoteNumbers });
  const results = [];
  for (const d of deductions) {
    if (d.pending) { results.push({ ...d }); continue; }
    const item = inventoryItems.find((it) => it['קטגוריה'] === d.category);
    if (!item) { results.push({ ...d, skipped: 'אין פריט מלאי בקטגוריה הזו' }); continue; }
    // סעיף Z — guard יחיד (ר' unitBlockReason למעלה): יחידת-מידה שהוגדרה
    // לפריט ואינה מניין-יחידות הופכת את ההורדה ל"דורש אישור" במקום
    // אוטומטית. לא נוגע בשאר הלוגיקה (סטייה/N1/אידמפוטנטיות).
    const unitBlock = unitBlockReason(item);
    results.push(await deductOne(item, unitBlock ? { ...d, needsApproval: true, reason: unitBlock } : d));
  }
  return { weekCode, cartonsCrossCheck, results };
}

/** סכום מספרים תקינים ברשימת ערכי-שדה גולמיים; null אם אף אחד לא מולא עדיין */
function sumOrNull(values) {
  const nums = values.map(num).filter((v) => v != null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

// ============================================================
// ביטול הורדה (תוספת 2026-10-06 לילה 2, ממצא M2.2#7) — מחיקת תעודת
// משלוח/חשבונית לא החזירה עד כה שום דבר למלאי (בניגוד ל"הוצאות",
// ר' reverseInventoryDeduction ב-inventory-deduction.js). אומת בפועל
// בביקורת-הקוד הזו (לא רק תאוריה): ה-route DELETE הקיים קורא
// ל-reverseInventoryDeduction רק לטבלת 'הוצאות'.
//
// אין state מבני על המסמך-המקור עצמו (אין שדה "הערות" ב"תעודות
// משלוח"/"חשבוניות" — ר' הערת הכותרת למעלה) — כל מה שיש הוא תגית
// [מלאי-D:טבלה:מזהה:קטגוריה] שנכתבה בעבר *בתוך שורת ה"↓" בהערות של
// פריט המלאי עצמו* (ר' doneTag/deductOne). לכן סורקים את כל פריטי
// "מלאי בסיסי" ומחפשים שורות-הורדה עם תגית תואמת למסמך הזה.
//
// מפוצל לפונקציה טהורה (planLogisticsReversal) + עטיפת I/O דקה
// (reverseLogisticsDeduction), בדיוק כמו deriveDeductions/computeDeviation
// למעלה — כדי שאפשר לבדוק את לוגיקת-הפענוח בלי לגעת ב-Airtable בכלל.
// ============================================================

/**
 * פונקציה טהורה: לכל פריט ב-inventoryItems, מוצאת שורות-הורדה ("↓...")
 * בהערות שלו עם תגית [מלאי-D:sourceTable:sourceId:...] שעדיין לא בוטלו
 * (אין "↩ <אותה תגית>" קיימת), וגוזרת מתוך השורה את הכמות המדויקת
 * שנרשמה בפועל (לא גוזרת מחדש מ-deriveDeductions — מה שבאמת ירד זה מה
 * שמוחזר, גם אם הלוגיקה תשתנה בעתיד). מחזירה תוכנית-פעולה בלבד, בלי
 * לקרוא/לכתוב שום דבר — ללא תופעות-לוואי, קל לבדיקה.
 * @returns [{ itemId, currentNotes, currentStock, totalBack, reversalLines }]
 */
export function planLogisticsReversal(inventoryItems, sourceTable, sourceId) {
  const tagPrefix = `[מלאי-D:${sourceTable}:${sourceId}:`;
  const plan = [];
  for (const item of inventoryItems || []) {
    const notes = String(item['הערות'] || '');
    if (!notes.includes(tagPrefix)) continue;

    const toReverse = [];
    for (const line of notes.split('\n')) {
      if (!line.startsWith('↓') || !line.includes(tagPrefix)) continue;
      const tagMatch = line.match(/(\[מלאי-D:[^\]]+\])/);
      if (!tagMatch) continue;
      const fullTag = tagMatch[1];
      // כבר בוטל בעבר — אידמפוטנטי. בודקים שורה-שלמה שמתחילה ב-"↩" ומכילה
      // את התגית (לא "↩ " צמוד לתגית — שורת-הביטול כותבת טקסט בין
      // השניים: "↩ ביטול הורדה של X · ... נמחק · <תאריך> <תגית>").
      const alreadyReversed = notes.split('\n').some((l) => l.startsWith('↩') && l.includes(fullTag));
      if (alreadyReversed) continue;
      const qtyMatch = line.match(/^↓\s*([\d.]+)\s*ממלאי:/);
      if (!qtyMatch) continue;
      const quantity = Number(qtyMatch[1]);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      toReverse.push({ fullTag, quantity });
    }
    if (!toReverse.length) continue;

    const totalBack = toReverse.reduce((a, r) => a + r.quantity, 0);
    const today = new Date().toISOString().slice(0, 10);
    const reversalLines = toReverse.map((r) => `↩ ביטול הורדה של ${r.quantity} · ${sourceTable} ${sourceId} נמחק · ${today} ${r.fullTag}`);
    plan.push({
      itemId: item.id,
      currentNotes: notes,
      currentStock: Number(item['מלאי נוכחי']) || 0,
      totalBack,
      reversalLines,
    });
  }
  return plan;
}

/**
 * מחזיר למלאי את כל ההורדות שבוצעו בעבר בפועל למסמך לוגיסטי (תעודת
 * משלוח/חשבונית) שעומד להימחק — נקרא לפני המחיקה בפועל (ר' server.js,
 * DELETE /api/:table/:id). כשל בעדכון פריט בודד לא עוצר את הפריטים
 * האחרים (עד 3 קטגוריות לתעודה אחת).
 *
 * ⚠️ תוקן 7.10.2026 (לילה 3, בדיקת-עמידות עם 429 מוזרק ב-fault-inject.js):
 * עד כה הפונקציה **בלעה** כל כשל — כשל בקריאת "מלאי בסיסי" החזיר `false`,
 * וכשל בעדכון פריט בודד נרשם ללוג בלבד — ובשני המקרים
 * `cascadeDocumentDelete` לא קיבל שום סימן, לא הוסיף שגיאת "מלאי:" לדוח,
 * וה-DELETE ב-server.js המשיך ומחק את המסמך. התוצאה (**אומתה בפועל, לא
 * תאוריה**): 429 חולף אחד על `updateRecord` = המלאי לא חוזר, המסמך נמחק,
 * והתגית `[מלאי-D:טבלה:מזהה:...]` בהערות פריט-המלאי מצביעה על מסמך שלא
 * קיים — אין שום דרך לדעת מה היה צריך לחזור. בנוסף הדוח דיווח "↩7 הוחזרו"
 * כי `report.inventory` נבנה מה-plan שחושב *לפני* הביצוע.
 *
 * מעתה מוחזר דוח מפורט; `document-cascade.js` ממפה כל שגיאה כאן ל-
 * "מלאי: ..." ב-report.errors, וזה מה שחוסם את המחיקה (המדיניות הקיימת
 * ב-server.js: אם ביטול-המלאי נכשל — לא מוחקים, כדי לא לאבד מעקב).
 * ניסיון חוזר בטוח ואידמפוטנטי: שורת ה-"↩" והמלאי החדש נכתבים באותו
 * `updateRecord` **יחיד** — או ששניהם קרו או שאף אחד מהם.
 *
 * @returns {Promise<{reversed: Array<{itemId:string,quantity:number}>, errors: string[]}>}
 */
export async function reverseLogisticsDeduction(sourceTable, sourceId) {
  const out = { reversed: [], errors: [] };
  let inventoryItems;
  try {
    inventoryItems = await fetchRecords(INVENTORY_TABLE, {});
  } catch (e) {
    const msg = `קריאת "${INVENTORY_TABLE}" נכשלה לפני ביטול הורדה ל-${sourceTable}/${sourceId}: ${e.message}`;
    console.error(`[logistics-reverse] ${msg}`);
    out.errors.push(msg);
    return out;
  }

  const plan = planLogisticsReversal(inventoryItems, sourceTable, sourceId);
  for (const p of plan) {
    try {
      await updateRecord(INVENTORY_TABLE, p.itemId, {
        'מלאי נוכחי': p.currentStock + p.totalBack,
        'הערות': `${p.currentNotes}\n${p.reversalLines.join('\n')}`,
        'תאריך עדכון': new Date().toISOString().slice(0, 10),
      });
      out.reversed.push({ itemId: p.itemId, quantity: p.totalBack });
    } catch (e) {
      const msg = `עדכון פריט מלאי ${p.itemId} נכשל בביטול הורדה ל-${sourceTable}/${sourceId} (${p.totalBack} יחידות לא חזרו): ${e.message}`;
      console.error(`[logistics-reverse] ${msg}`);
      out.errors.push(msg);
    }
  }
  return out;
}
