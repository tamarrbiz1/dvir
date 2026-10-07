// ============================================================
// מחיקה מדורגת (cascade) של מסמך-מקור — הוצאות/חשבוניות/תעודות משלוח
// (סעיף P3, 2026-10-07, הוראת תמר: "אם מתבצעת מחיקה — מחק אוטומטית
// בכל המקומות, ובצע פעולות נגדיות: החזרת מלאי, הסרת הערות קשורות,
// סיכומים נתמכים").
//
// לא כותב-מחדש הורדת-מלאי/ביטול — קורא ל-reverseInventoryDeduction
// (inventory-deduction.js) ו-reverseLogisticsDeduction/planLogisticsReversal
// (logistics-deduction.js) **הקיימים**, רק מוסיף: תקציר-dryRun אחיד
// לשתי השיטות, וניתוק/מחיקת רשומת-השבוע ב"סיכום שבועי".
//
// דוחות-ריסוסים (מחיקת דוח → ביטול-טיפולים-שיובאו-ממנו) **כבר קיימת**
// בנתיב נפרד (`DELETE /api/spray-reports/:id`, ר' spray-report-import.js) —
// לא משוכפל כאן; הטבלה הזו לא מטופלת ע"י cascadeDocumentDelete.
//
// צ'קים: הקישור בין "הוצאות" ל"צ'קים" הוא שדה-link דו-כיווני ב-Airtable —
// מחיקת ההוצאה מנתקת את הצד השני אוטומטית (Airtable, לא אנחנו). לא
// מוחקים את הצ'ק עצמו לעולם. מדווחים כאן רק כמה צ'קים היו מקושרים,
// לתיעוד בלוג — לא פעולת-כתיבה.
// ============================================================
import { getBase, fetchRecords, updateRecord, deleteRecord } from './airtable.js';
import { readState, reverseInventoryDeduction } from './inventory-deduction.js';
import { planLogisticsReversal, reverseLogisticsDeduction } from './logistics-deduction.js';

const EXPENSES_TABLE = 'הוצאות';
const INVOICES_TABLE = 'חשבוניות';
const NOTES_TABLE = 'תעודות משלוח';
const INVENTORY_TABLE = 'מלאי בסיסי';
const WEEKLY_TABLE = 'סיכום שבועי';

const LOGISTICS_TABLES = new Set([INVOICES_TABLE, NOTES_TABLE]);

/**
 * פונקציה טהורה (נבדקת ב-qa-check בלי Airtable בכלל): אילו שורות-ביטול
 * של הוצאה **נכשלו בפועל** ב-reverseInventoryDeduction. שורה שירדה
 * (deducted) ולא סומנה reversed היא מלאי שלא חזר — בלי קשר אם נרשמה
 * הודעת reverseError (למשל כשל-רשת שלא הגיע ל-catch הפנימי).
 */
export function inventoryReverseFailures(state) {
  return (state?.results || [])
    .filter((r) => r.deducted && !r.reversed)
    .map((r) => `החזרת ${r.quantity} ל-${r.category || r.itemId} נכשלה${r.reverseError ? ` (${r.reverseError})` : ''}`);
}

/**
 * פונקציה טהורה: האם רשומת-"סיכום שבועי" מחזיקה נתונים משל עצמה שאינם
 * קוד-השבוע והקישורים למסמכים. ⚠️ 7.10.2026 (לילה 3): ה-cascade מחק את
 * **כל** רשומת-השבוע כשהמסמך האחרון נותק — אבל הרשומה מחזיקה גם שדות
 * שנגזרים מ"קטיפים" ומהאוטומציות של Make, לא מהחשבוניות (JSON עבודות
 * קטיף לפי ימים / JSON הכנסה לפי מבנים / JSON קג בפועל לפי ימים ומבנים /
 * הערות+סטטוס התאמת קטיף). הקוד שלנו לא יודע לייצר אותם מחדש
 * (ensureWeekRecord כותב רק "קוד שבוע"), ולכן מחיקה כזו היא אובדן-נתונים
 * שאינו ניתן לשחזור. מעתה מוחקים רק רשומה שבאמת ריקה מכל השאר.
 */
export function weekRecordHasOwnData(week) {
  const IGNORED = new Set(['id', 'קוד שבוע', INVOICES_TABLE, NOTES_TABLE, 'תאריך התחלה', 'תאריך סיום']);
  return Object.entries(week || {}).some(([k, v]) => {
    if (IGNORED.has(k)) return false;
    if (v == null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    // שדות rollup/lookup מתרוקנים מעצמם כשהקישור מנותק — לא "נתון עצמאי"
    if (/Rollup|rollup/.test(k)) return false;
    return true;
  });
}

/** תקציר-dryRun של הורדת-המלאי שתבוטל, בלי לכתוב כלום (ל"הוצאות") */
async function previewExpenseInventory(expenseId) {
  const base = getBase();
  let rec;
  try { rec = await base(EXPENSES_TABLE).find(expenseId); } catch { return []; }
  const state = readState(rec.fields['הערות'] || '');
  if (!state || !Array.isArray(state.results)) return [];
  return state.results
    .filter((r) => r.deducted && !r.reversed)
    .map((r) => ({ itemId: r.itemId, category: r.category, quantity: r.quantity }));
}

/** תקציר-dryRun של הורדת-המלאי שתבוטל, בלי לכתוב כלום (ללוגיסטיקה) */
async function previewLogisticsInventory(table, id) {
  const items = await fetchRecords(INVENTORY_TABLE, {});
  const plan = planLogisticsReversal(items, table, id);
  return plan.map((p) => ({
    itemId: p.itemId,
    category: items.find((i) => i.id === p.itemId)?.['קטגוריה'] || null,
    quantity: p.totalBack,
  }));
}

/** מוצא את רשומת-השבוע (אם יש) שהמסמך הזה מקושר אליה, לפי "קוד שבוע" */
async function findWeekRecord(table, id) {
  if (!LOGISTICS_TABLES.has(table)) return null;
  const base = getBase();
  let rec;
  try { rec = await base(table).find(id); } catch { return null; }
  const code = rec.fields['קוד שבוע'];
  if (!code) return null;
  const weeks = await fetchRecords(WEEKLY_TABLE, {});
  const week = weeks.find((w) => w['קוד שבוע'] === code);
  if (!week) return null;
  const linkField = table; // שם שדה-הקישור בסיכום-שבועי זהה לשם הטבלה (ר' schema)
  const linked = Array.isArray(week[linkField]) ? week[linkField] : [];
  if (!linked.some((l) => (l?.id || l) === id)) return null;
  return { week, linkField };
}

/**
 * מריצה תמיד (dryRun=true) או בפועל (dryRun=false) — אותה פונקציה,
 * כדי שתצוגה-מקדימה (`GET .../cascade-preview`) ופעולה-אמיתית
 * (לפני ה-DELETE עצמו) לעולם לא יתפצלו-ללוגיקה-כפולה.
 */
export async function cascadeDocumentDelete(table, id, { dryRun = false } = {}) {
  const report = { table, id, dryRun, inventory: [], week: null, checksLinked: 0, errors: [] };

  // 0) האם המסמך בכלל קיים? ⚠️ 7.10.2026 (לילה 3) — בלי הבדיקה הזו
  // cascade-preview על מזהה שלא קיים החזיר דוח-ריק זהה ל"אין השפעה",
  // והמחיקה-האמיתית אפילו *החזירה מלאי* עבור מסמך-רפאים (אומת חי:
  // DELETE על recQAGHOST0001 → 404, אבל המלאי עלה מ-100 ל-130).
  // ההחזרה-המדורגת מזוהה לפי תגית בהערות פריט-המלאי, לא לפי המסמך —
  // ולכן היא "עבדה" גם כשהמסמך לא קיים.
  try {
    await getBase()(table).find(id);
  } catch {
    report.notFound = true;
    return report;
  }

  // 1) הורדת-מלאי שתבוטל
  try {
    if (table === EXPENSES_TABLE) {
      if (dryRun) {
        report.inventory = await previewExpenseInventory(id);
      } else {
        const state = await reverseInventoryDeduction(id);
        report.inventory = (state?.results || [])
          .filter((r) => r.reversed)
          .map((r) => ({ itemId: r.itemId, category: r.category, quantity: r.quantity }));
        // ⚠️ 7.10.2026 (לילה 3), החור המרכזי ב-P3: reverseInventoryDeduction
        // **לא זורקת** כשהחזרת פריט בודד נכשלת — היא מתעדת reverseError
        // בשורה וממשיכה (בכוונה, ר' ההערה שם: "לא לחסום, לתעד הפרש").
        // אבל ה-cascade התייחס ל"לא נזרקה חריגה" כ"הצליח", ולכן המסמך
        // נמחק והמלאי נשאר לא-מוחזר — בלי שאף אחד יידע, ובלי שום דרך
        // לדעת מה היה צריך לחזור (ה-state נמחק עם ההוצאה).
        const failed = inventoryReverseFailures(state);
        if (failed.length) report.errors.push(`מלאי: ${failed.join('; ')}`);
      }
    } else if (LOGISTICS_TABLES.has(table)) {
      if (dryRun) {
        report.inventory = await previewLogisticsInventory(table, id);
      } else {
        // תוכנית-הביטול מחושבת *לפני* הביצוע בפועל (מידע-לדוח בלבד —
        // reverseLogisticsDeduction עצמה מחשבת ומבצעת, לא מחזירה shape זהה)
        const items = await fetchRecords(INVENTORY_TABLE, {});
        const plan = planLogisticsReversal(items, table, id);
        // אותו חור בדיוק בצד הלוגיסטי: reverseLogisticsDeduction תפסה
        // כשל-קריאה *וכשל-עדכון-פריט* ורק רשמה ללוג (return false) —
        // ה-cascade לא ראה שגיאה והמסמך נמחק עם מלאי לא-מוחזר.
        const { failures } = await reverseLogisticsDeduction(table, id);
        if (failures.length) report.errors.push(`מלאי: ${failures.join('; ')}`);
        report.inventory = plan.map((p) => ({
          itemId: p.itemId,
          category: items.find((i) => i.id === p.itemId)?.['קטגוריה'] || null,
          quantity: p.totalBack,
        }));
      }
    }
  } catch (e) {
    report.errors.push(`מלאי: ${e.message}`);
  }

  // 2) ניתוק/מחיקת רשומת-שבוע
  try {
    const found = await findWeekRecord(table, id);
    if (found) {
      const { week, linkField } = found;
      const remaining = (week[linkField] || []).filter((l) => (l?.id || l) !== id);
      const otherField = linkField === INVOICES_TABLE ? NOTES_TABLE : INVOICES_TABLE;
      const otherRemaining = Array.isArray(week[otherField]) ? week[otherField] : [];
      const wouldBeEmpty = remaining.length === 0 && otherRemaining.length === 0;
      // ר' weekRecordHasOwnData למעלה — רשומת-שבוע שמחזיקה נתוני-קטיף/
      // הכנסה משל עצמה לא נמחקת גם כשלא נשאר בה שום מסמך מקושר.
      const hasOwnData = weekRecordHasOwnData(week);
      report.week = {
        weekCode: week['קוד שבוע'], weekId: week.id,
        action: wouldBeEmpty && !hasOwnData ? 'delete' : 'unlink',
        keptForOwnData: wouldBeEmpty && hasOwnData || undefined,
      };
      if (!dryRun) {
        if (report.week.action === 'delete') {
          await deleteRecord(WEEKLY_TABLE, week.id);
        } else {
          await updateRecord(WEEKLY_TABLE, week.id, { [linkField]: remaining.map((l) => l?.id || l) });
        }
      }
    }
  } catch (e) {
    report.errors.push(`סיכום שבועי: ${e.message}`);
  }

  // 3) צ'קים מקושרים (הוצאות בלבד) — דיווח-בלבד, לא פעולת-כתיבה
  if (table === EXPENSES_TABLE) {
    try {
      const base = getBase();
      const rec = await base(EXPENSES_TABLE).find(id);
      const checks = rec.fields['צ׳קים'] || rec.fields["צ'קים"];
      report.checksLinked = Array.isArray(checks) ? checks.length : 0;
    } catch { /* לא קריטי לדוח */ }
  }

  return report;
}

/** שורת-לוג קצרה לתיעוד אחרי מחיקה אמיתית */
export function summarizeCascade(report) {
  const invSum = report.inventory?.length
    ? report.inventory.map((r) => `${r.category || '?'} ↩${r.quantity}`).join(', ')
    : 'ללא';
  const weekSum = report.notFound
    ? 'המסמך לא נמצא'
    : (report.week
      ? `שבוע ${report.week.weekCode} ${report.week.action === 'delete' ? 'נמחק' : `נותק${report.week.keptForOwnData ? ' (נשמר — יש בו נתוני-קטיף/הכנסה משל עצמו)' : ''}`}`
      : 'ללא שבוע');
  return `[cascade] ${report.table} ${report.id}: מלאי ${invSum} | ${weekSum}${report.errors.length ? ` | שגיאות: ${report.errors.join('; ')}` : ''}`;
}
