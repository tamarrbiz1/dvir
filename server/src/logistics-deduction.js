// ============================================================
// הורדת מלאי מתעודות משלוח/חשבוניות (תוספת 2026-10-06, סעיף D) —
// בניגוד ל"הוצאות" (document-analysis.js), כאן אין AI: השדות
// (כמות קרטונים, מספר משטחים) כבר ממולאים ישירות ע"י Make על הרשומה
// עצמה. התפקיד שלנו: לקרוא אותם, להצליב בין תעודת משלוח לחשבונית
// לאותו "קוד שבוע", ולהוריד מ"מלאי בסיסי" רק כשההצלבה תקינה.
//
// ⚠️ אין בטבלאות האלה שדה "הערות" (נבדק מול הסכימה בפועל) — אי אפשר
// לשמור עליהן state כמו ה-marker [מלאי-AI] ב"הוצאות". לכן אין state
// על המסמך המקור בכלל: הפונקציה הזו חוזרת-בטוחה (אידמפוטנטית) כי
// לפני כל הורדה היא בודקת אם כבר קיימת תגית-מקור תואמת בהערות של
// פריט המלאי עצמו — וזו גם יחידת ה-state היחידה שיש הרשאה לכתוב לה.
// ============================================================
import { fetchRecords, updateRecord } from './airtable.js';

const NOTES_TABLE = 'תעודות משלוח';
const INVOICES_TABLE = 'חשבוניות';
const INVENTORY_TABLE = 'מלאי בסיסי';

// מקדם קבוע: שקית אחת וכובע אחד לכל קרטון יוצא. אין דרך לדעת מהשדות
// הקיימים אם מסמך ספציפי ציין כמות מפורשת של כובעים/שקיות (זה יצריך
// קריאת תוכן המסמך, לא רק שדות מובנים) — לכן תמיד נגזר מהמקדם.
const UNITS_PER_CARTON = 1;

// ⚠️ אחוז הסטייה המותר בין כמות קרטונים בתעודה לכמות בחשבונית לאותו
// שבוע — זו החלטה של תמר (התוספת נותנת 5% כדוגמה). זה רק ברירת מחדל
// זמנית עד שתמר תחליט ותעדכן את הקבוע הזה.
export const DEVIATION_THRESHOLD = 0.05;

function num(v) {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
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

/**
 * גוזר את רשימת ההורדות (קטגוריה→כמות) מזוג (תעודת משלוח, חשבונית)
 * לאותו שבוע. לא נדרש ששני הצדדים יהיו קיימים — אם רק אחד קיים,
 * מה שאפשר להוריד ממנו יורד, עם אזהרת "בלי הצלבה" (לא חוסמת).
 */
export function deriveDeductions({ note, invoice }) {
  const weekCode = note?.['קוד שבוע'] || invoice?.['קוד שבוע'] || null;
  const noteCartons = note ? num(note['כמות קרטונים']) : null;
  const invoiceCartons = invoice ? num(invoice['כמות קרטונים']) : null;
  const pallets = invoice ? num(invoice['מספר משטחים']) : null;

  const out = [];
  let cartonsCrossCheck = null;

  if (noteCartons != null || invoiceCartons != null) {
    if (noteCartons != null && invoiceCartons != null) {
      const deviation = computeDeviation(noteCartons, invoiceCartons);
      cartonsCrossCheck = { noteCartons, invoiceCartons, deviation, ok: deviation <= DEVIATION_THRESHOLD };
    }
    // כמות קרטונים יוצאים — מקור האמת הוא התעודה; אם אין תעודה (רק
    // חשבונית), אין "קרטונים שיצאו" פיזית לרדת מהם — לא גוזרים מהחשבונית.
    if (noteCartons != null) {
      const blocked = cartonsCrossCheck && !cartonsCrossCheck.ok;
      const noCrossCheck = !cartonsCrossCheck;
      for (const category of ['קרטונים', 'נילונים', 'כובעים']) {
        const quantity = category === 'קרטונים' ? noteCartons : Math.round(noteCartons * UNITS_PER_CARTON);
        out.push({
          category, quantity, weekCode,
          sourceTable: NOTES_TABLE, sourceId: note.id, sourceLabel: `תעודה #${note['מספר תעודה'] ?? '?'}`,
          derivedFrom: category === 'קרטונים' ? 'ישיר מהתעודה' : `${noteCartons} קרטונים × ${UNITS_PER_CARTON}`,
          needsApproval: !!blocked,
          reason: blocked ? `סטייה ${(cartonsCrossCheck.deviation * 100).toFixed(1)}% בין תעודה (${noteCartons}) לחשבונית (${invoiceCartons}) לשבוע ${weekCode}` : (noCrossCheck ? 'אין חשבונית מקבילה לשבוע זה — בלי הצלבה' : null),
          softWarning: noCrossCheck,
        });
      }
    }
  }

  if (pallets != null) {
    const blocked = cartonsCrossCheck && !cartonsCrossCheck.ok;
    out.push({
      category: 'משטחי עץ', quantity: pallets, weekCode,
      sourceTable: INVOICES_TABLE, sourceId: invoice.id, sourceLabel: `חשבונית #${invoice['מספר חשבונית'] ?? '?'}`,
      derivedFrom: 'ישיר מהחשבונית (מספר משטחים)',
      needsApproval: !!blocked,
      reason: blocked ? `סטייה בין תעודה לחשבונית לשבוע ${weekCode} — לא ניתן לאמת משטחים` : null,
      softWarning: !cartonsCrossCheck,
    });
  }

  return { weekCode, cartonsCrossCheck, deductions: out };
}

function sourceTag(d) {
  return `[מלאי-D:${d.sourceTable}:${d.sourceId}:${d.category}]`;
}

async function deductOne(item, d) {
  const tag = sourceTag(d);
  const notes = String(item['הערות'] || '');
  if (notes.includes(tag)) return { ...d, skipped: 'כבר טופל בעבר (אידמפוטנטיות)' };

  if (d.needsApproval) {
    const warnLine = `⚠ דורש אישור: ${d.quantity} ${d.category} (${d.sourceLabel}, שבוע ${d.weekCode}) — ${d.reason} ${tag}`;
    await updateRecord(INVENTORY_TABLE, item.id, { 'הערות': notes ? `${notes}\n${warnLine}` : warnLine });
    return { ...d, deducted: false };
  }

  const current = Number(item['מלאי נוכחי']) || 0;
  const line = `↓ ${d.quantity} ממלאי: ${d.category} (${d.sourceLabel}, שבוע ${d.weekCode}${d.derivedFrom.startsWith('ישיר') ? '' : ` · ${d.derivedFrom}`})${d.softWarning ? ' ⚠ בלי הצלבה' : ''} ${tag}`;
  await updateRecord(INVENTORY_TABLE, item.id, { 'מלאי נוכחי': current - d.quantity, 'הערות': notes ? `${notes}\n${line}` : line });
  return { ...d, deducted: true, itemId: item.id };
}

/**
 * מריץ את תהליך ההורדה המלא לרשומה אחת (תעודת משלוח או חשבונית):
 * מוצא את הרשומה המקבילה לאותו שבוע, גוזר הורדות, ומבצע אותן על
 * פריטי "מלאי בסיסי" הקיימים (רק קטגוריות שיש להן פריט אמיתי).
 * בטוח להרצה חזרה על אותה רשומה — כל קטגוריה מסומנת בתגית ייחודית.
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

  const { cartonsCrossCheck, deductions } = deriveDeductions({ note, invoice });
  const results = [];
  for (const d of deductions) {
    const item = inventoryItems.find((it) => it['קטגוריה'] === d.category);
    if (!item) { results.push({ ...d, skipped: 'אין פריט מלאי בקטגוריה הזו' }); continue; }
    results.push(await deductOne(item, d));
  }
  return { weekCode, cartonsCrossCheck, results };
}
