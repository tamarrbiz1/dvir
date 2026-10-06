// ============================================================
// ניתוח מסמך הוצאה → הורדת מלאי אוטומטית — 2026-10-06 (לילה), חלק B
// ------------------------------------------------------------
// אורקסטרציה: קורא קובץ ההוצאה → analyzeExpenseDocument (חילוץ
// שורות) → matchLinesToInventory (התאמה לפריטים קיימים) → הורדה
// לפריטים עם ביטחון מספיק, סימון "דורש אישור" לשאר.
//
// אין לנו הרשאת סכמה ליצור שדות ייעודיים ב-Airtable (ר' הערה קיימת
// ב-server.js, checkDeviceBinding) — המצב נשמר כ-JSON בשורה אחת
// בתוך שדה "הערות" הקיים של ההוצאה, עם קידומת קבועה [מלאי-AI],
// בלי לדרוס תוכן אחר שכבר בשדה (ר' readState/writeState למטה).
// אידמפוטנטי: status:"done" => לעולם לא מורידים שוב, גם ב-restart.
// ============================================================
import { fetchRecords, updateRecord, getBase } from './airtable.js';
import { analyzeExpenseDocument } from './document-analysis.js';
import { matchLinesToInventory } from './inventory-matching.js';

const EXPENSES_TABLE = 'הוצאות';
const INVENTORY_TABLE = 'מלאי בסיסי';
const MARKER_RE = /\[מלאי-AI\](\{[^\n]*\})/;

export function readState(notes) {
  const m = String(notes || '').match(MARKER_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function writeStateIntoNotes(notes, state) {
  const line = `[מלאי-AI]${JSON.stringify(state)}`;
  const existing = String(notes || '');
  if (MARKER_RE.test(existing)) return existing.replace(MARKER_RE, line);
  return existing ? `${existing}\n${line}` : line;
}

async function saveState(expenseId, currentNotes, state) {
  const notes = writeStateIntoNotes(currentNotes, state);
  await updateRecord(EXPENSES_TABLE, expenseId, { 'הערות': notes });
  return notes;
}

/** מוריד קובץ מצורף (URL של Airtable) לזיכרון — לא נשמר על דיסק */
async function downloadAttachment(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`הורדת הקובץ נכשלה (${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** מוסיף שורת תנועה אחרונה ל"הערות" של פריט מלאי (לא מוחק היסטוריה קודמת) */
async function appendItemMovementNote(item, text) {
  const current = String(item['הערות'] || '');
  const next = current ? `${current}\n${text}` : text;
  await updateRecord(INVENTORY_TABLE, item.id, { 'הערות': next });
}

/**
 * מבצע ניתוח מלא להוצאה אחת: קריאה, אידמפוטנטיות, הורדת קובץ,
 * ניתוח AI, התאמה למלאי, הורדה בפועל לפריטים בטוחים מספיק.
 * safe מול כשל: status 'failed' נשמר, המלאי לא נוגע כשיש כשל.
 */
export async function analyzeExpenseInventory(expenseId, { force = false } = {}) {
  const base = getBase();
  const rec = await base(EXPENSES_TABLE).find(expenseId);
  const fields = rec.fields;
  const currentNotes = fields['הערות'] || '';
  const existingState = readState(currentNotes);

  // אידמפוטנטיות: כבר הושלם בעבר -> לא מנתחים שוב ולא נוגעים במלאי,
  // גם אם "נתח מחדש" נלחץ פעמיים או אחרי restart. force=true (רק
  // לשימוש פנימי בבדיקות) עוקף את זה במפורש.
  if (existingState?.status === 'done' && !force) {
    return existingState;
  }

  const attachments = fields['חשבונית'];
  if (!Array.isArray(attachments) || !attachments.length) {
    const state = { status: 'failed', analyzedAt: new Date().toISOString(), error: 'אין קובץ מצורף להוצאה זו', results: [] };
    await saveState(expenseId, currentNotes, state);
    return state;
  }

  let inventoryItems;
  try {
    inventoryItems = await fetchRecords(INVENTORY_TABLE, {});
  } catch (e) {
    const state = { status: 'failed', analyzedAt: new Date().toISOString(), error: `קריאת המלאי נכשלה: ${e.message}`, results: [] };
    await saveState(expenseId, currentNotes, state);
    return state;
  }
  if (!inventoryItems.length) {
    // אין שום פריט מלאי מוגדר כרגע — אין נגד מה להתאים. לא כשל,
    // פשוט "נותחה, לא נמצאו פריטי מלאי" (הטבלה ריקה כרגע בפועל).
    const state = { status: 'done', analyzedAt: new Date().toISOString(), results: [], note: 'אין פריטי מלאי מוגדרים במערכת' };
    await saveState(expenseId, currentNotes, state);
    return state;
  }

  let analysis;
  try {
    const file = attachments[0];
    const buffer = await downloadAttachment(file.url);
    analysis = await analyzeExpenseDocument(buffer, file.type || 'application/pdf', inventoryItems);
  } catch (e) {
    const state = { status: 'failed', analyzedAt: new Date().toISOString(), error: e.message, results: [] };
    await saveState(expenseId, currentNotes, state);
    return state;
  }

  // מילוי supplier/date/total רק אם Make לא כבר מילא את שדות ה-AI המקבילים
  const extraFields = {};
  if (!fields['ספק-AI'] && analysis.supplier) extraFields['ספק-AI'] = analysis.supplier;
  if (!fields['תאריך חשבונית-AI'] && analysis.date) extraFields['תאריך חשבונית-AI'] = analysis.date;
  if (!fields['סכום כולל-AI'] && analysis.total != null) extraFields['סכום כולל-AI'] = String(analysis.total);
  if (Object.keys(extraFields).length) await updateRecord(EXPENSES_TABLE, expenseId, extraFields);

  const matched = matchLinesToInventory(analysis.lines, inventoryItems);
  const results = [];
  const expenseNum = fields['מספר הוצאה'];
  const supplierLabel = analysis.supplier || fields['ספק-AI'] || '';
  const dateLabel = analysis.date || fields['תאריך חשבונית-AI'] || '';

  for (const m of matched) {
    if (m.needsApproval) {
      results.push({
        description: m.line.description, quantity: m.quantity, unit: m.line.unit,
        category: m.category, itemId: m.item.id, confidence: m.confidence,
        deducted: false, needsApproval: true, reason: m.reason,
      });
      continue;
    }
    try {
      const current = Number(m.item['מלאי נוכחי']) || 0;
      await updateRecord(INVENTORY_TABLE, m.item.id, {
        'מלאי נוכחי': current - m.quantity,
        'תאריך עדכון': new Date().toISOString().slice(0, 10),
      });
      await appendItemMovementNote(m.item, `↓ ${m.quantity} · הוצאה #${expenseNum ?? '?'} · ${supplierLabel || 'ספק לא ידוע'} · ${dateLabel || new Date().toISOString().slice(0, 10)}`);
      results.push({
        description: m.line.description, quantity: m.quantity, unit: m.line.unit,
        category: m.category, itemId: m.item.id, confidence: m.confidence,
        deducted: true, deductedAt: new Date().toISOString(),
      });
    } catch (e) {
      results.push({
        description: m.line.description, quantity: m.quantity, unit: m.line.unit,
        category: m.category, itemId: m.item.id, confidence: m.confidence,
        deducted: false, needsApproval: false, error: e.message,
      });
    }
  }

  const anyFailed = results.some((r) => r.error);
  const state = {
    status: anyFailed ? 'partial' : 'done',
    analyzedAt: new Date().toISOString(),
    supplier: analysis.supplier, date: analysis.date, total: analysis.total,
    results,
  };
  const newNotes = await saveState(expenseId, currentNotes, state);
  return { ...state, notes: newNotes };
}

/** אישור הורדה ידני לשורה שסומנה "דורש אישור" (lineIndex לפי מיקום ב-results) */
export async function approvePendingDeduction(expenseId, lineIndex) {
  const base = getBase();
  const rec = await base(EXPENSES_TABLE).find(expenseId);
  const currentNotes = rec.fields['הערות'] || '';
  const state = readState(currentNotes);
  if (!state || !Array.isArray(state.results) || !state.results[lineIndex]) {
    throw new Error('לא נמצאה שורה לאישור (ייתכן שהניתוח התבצע מחדש)');
  }
  const line = state.results[lineIndex];
  if (line.deducted) return state; // אידמפוטנטי — כבר אושרה/ירדה בעבר
  if (!line.needsApproval) throw new Error('השורה הזו לא מסומנת כדורשת אישור');

  const itemRec = await base(INVENTORY_TABLE).find(line.itemId);
  const itemWithId = { id: itemRec.id, ...itemRec.fields };
  const current = Number(itemRec.fields['מלאי נוכחי']) || 0;
  const expenseNum = rec.fields['מספר הוצאה'];
  await updateRecord(INVENTORY_TABLE, line.itemId, {
    'מלאי נוכחי': current - line.quantity,
    'תאריך עדכון': new Date().toISOString().slice(0, 10),
  });
  await appendItemMovementNote(itemWithId, `↓ ${line.quantity} · הוצאה #${expenseNum ?? '?'} · ${state.supplier || 'ספק לא ידוע'} · ${state.date || new Date().toISOString().slice(0, 10)} · אושר ידנית`);

  state.results[lineIndex] = { ...line, deducted: true, needsApproval: false, deductedAt: new Date().toISOString(), approvedManually: true };
  state.status = state.results.every((r) => r.deducted || r.error) ? 'done' : 'partial';
  await saveState(expenseId, currentNotes, state);
  return state;
}
