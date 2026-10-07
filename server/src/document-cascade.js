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

  // 1) הורדת-מלאי שתבוטל
  //
  // ⚠️ 7.10.2026 (לילה 3, בדיקת-עמידות עם 429 מוזרק): `report.inventory`
  // חייב לתאר מה **קרה בפועל**, לא מה תוכנן לקרות, וכל כשל-החזרה חייב
  // להגיע ל-`report.errors` עם התחילית "מלאי:" — זה הסימן **היחיד**
  // שעליו ה-DELETE ב-server.js מסתמך כדי *לא* למחוק את המסמך. לפני
  // התיקון, 429 חולף יחיד על עדכון פריט-מלאי אחד הספיק כדי שהדוח ידווח
  // "↩הוחזר" והמסמך יימחק בלי שהמלאי חזר באמת, ובלי שום דרך לשחזר מה
  // היה צריך לחזור (ר' הערת reverseLogisticsDeduction).
  try {
    if (table === EXPENSES_TABLE) {
      if (dryRun) {
        report.inventory = await previewExpenseInventory(id);
      } else {
        const state = await reverseInventoryDeduction(id);
        const lines = state?.results || [];
        report.inventory = lines
          .filter((r) => r.reversed)
          .map((r) => ({ itemId: r.itemId, category: r.category, quantity: r.quantity }));
        // שורה שירדה בעבר, טרם בוטלה, וניסיון-הביטול שלה נכשל עכשיו.
        // בלי הדיווח הזה ההוצאה נמחקת — ואיתה ה-state שב"הערות" שלה, שהוא
        // המקום **היחיד** שבו כתוב מה צריך לחזור ולאיזה פריט-מלאי.
        for (const r of lines) {
          if (r.deducted && !r.reversed && r.reverseError) {
            report.errors.push(`מלאי: החזרת ${r.quantity} ל"${r.category || r.itemId}" נכשלה: ${r.reverseError}`);
          }
        }
      }
    } else if (LOGISTICS_TABLES.has(table)) {
      if (dryRun) {
        report.inventory = await previewLogisticsInventory(table, id);
      } else {
        const result = await reverseLogisticsDeduction(table, id);
        // שמות-הקטגוריות לדוח — נקראים אחרי הביצוע, ורק לפריטים שבאמת חזרו
        let items = [];
        try { items = await fetchRecords(INVENTORY_TABLE, {}); } catch { /* שם-קטגוריה הוא קוסמטיקה בדוח */ }
        report.inventory = result.reversed.map((r) => ({
          itemId: r.itemId,
          category: items.find((i) => i.id === r.itemId)?.['קטגוריה'] || null,
          quantity: r.quantity,
        }));
        result.errors.forEach((msg) => report.errors.push(`מלאי: ${msg}`));
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
      report.week = { weekCode: week['קוד שבוע'], weekId: week.id, action: wouldBeEmpty ? 'delete' : 'unlink' };
      if (!dryRun) {
        if (wouldBeEmpty) {
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
  const weekSum = report.week ? `שבוע ${report.week.weekCode} ${report.week.action === 'delete' ? 'נמחק' : 'נותק'}` : 'ללא שבוע';
  return `[cascade] ${report.table} ${report.id}: מלאי ${invSum} | ${weekSum}${report.errors.length ? ` | שגיאות: ${report.errors.join('; ')}` : ''}`;
}
