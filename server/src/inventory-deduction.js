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
 * ממשיכים ריצה שנעצרה באמצע (status "processing"/"partial") — בלי
 * לקרוא שוב ל-AI. רק שורות שסומנו "נכשלו עם שגיאה" (למשל 429 באמצע)
 * מנוסות שוב; שורות שכבר ירדו או מחכות לאישור ידני נשארות כמו שהן.
 */
async function resumeUnresolvedLines(expenseId, currentNotes, existingState) {
  const base = getBase();
  const rec = await base(EXPENSES_TABLE).find(expenseId);
  const expenseNum = rec.fields['מספר הוצאה'];
  const supplierLabel = existingState.supplier || rec.fields['ספק-AI'] || '';
  const dateLabel = existingState.date || rec.fields['תאריך חשבונית-AI'] || '';

  const results = [...existingState.results];
  let notesCursor = currentNotes;
  const saveProgress = async (status) => {
    notesCursor = await saveState(expenseId, notesCursor, { ...existingState, status, results });
  };

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.deducted || r.needsApproval) continue; // כבר טופל או ממתין לאישור — לא נוגעים
    if (!r.error) continue; // לא אמור לקרות, אבל ליתר ביטחון
    try {
      const itemRec = await base(INVENTORY_TABLE).find(r.itemId);
      const current = Number(itemRec.fields['מלאי נוכחי']) || 0;
      await updateRecord(INVENTORY_TABLE, r.itemId, {
        'מלאי נוכחי': current - r.quantity,
        'תאריך עדכון': new Date().toISOString().slice(0, 10),
      });
      await appendItemMovementNote({ id: r.itemId, ...itemRec.fields }, `↓ ${r.quantity} · הוצאה #${expenseNum ?? '?'} · ${supplierLabel || 'ספק לא ידוע'} · ${dateLabel || new Date().toISOString().slice(0, 10)}`);
      results[i] = { ...r, deducted: true, deductedAt: new Date().toISOString(), error: undefined };
    } catch (e) {
      results[i] = { ...r, error: e.message };
    }
    await saveProgress('processing');
  }

  const finalStatus = results.some((r) => r.error) ? 'partial' : 'done';
  await saveProgress(finalStatus);
  return { ...existingState, status: finalStatus, results, notes: notesCursor };
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
  // נפילה/restart באמצע ריצה קודמת (status "processing"/"partial"):
  // לא קוראים ל-AI שוב (לא דטרמיניסטי בין קריאות + עלות מיותרת) —
  // ממשיכים בדיוק מאיפה שנעצר, לפי השורות שכבר נקבעו בפעם הקודמת.
  if ((existingState?.status === 'processing' || existingState?.status === 'partial') && !force) {
    return resumeUnresolvedLines(expenseId, currentNotes, existingState);
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
  const expenseNum = fields['מספר הוצאה'];
  const supplierLabel = analysis.supplier || fields['ספק-AI'] || '';
  const dateLabel = analysis.date || fields['תאריך חשבונית-AI'] || '';

  // שמירה הדרגתית (לא רק בסוף!): אחרי כל שורה שהורדה בפועל נשמר סטטוס
  // "processing" מעודכן. אם השרת ייפול/יופעל מחדש באמצע (בין שורה
  // לשורה) — ה-state כבר משקף נכון מה הורד ומה לא, וניסיון חוזר
  // ימשיך מאיפה שנעצר במקום להוריד שוב את מה שכבר ירד (ר' דרישה
  // מפורשת במשימה: "כשל באמצע... לא חצי-הורדה, ניתן לנסות שוב").
  let notesCursor = currentNotes;
  const results = [];
  const saveProgress = async (status) => {
    notesCursor = await saveState(expenseId, notesCursor, {
      status, analyzedAt: new Date().toISOString(),
      supplier: analysis.supplier, date: analysis.date, total: analysis.total,
      results,
    });
  };

  for (const m of matched) {
    if (m.needsApproval) {
      results.push({
        description: m.line.description, quantity: m.quantity, unit: m.line.unit,
        category: m.category, itemId: m.item.id, confidence: m.confidence,
        deducted: false, needsApproval: true, reason: m.reason,
      });
      await saveProgress('processing');
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
    // שמירה אחרי כל שורה בפועל — לא מחכים לכל הלולאה (ר' הערה למעלה)
    await saveProgress('processing');
  }

  const anyFailed = results.some((r) => r.error);
  const finalStatus = anyFailed ? 'partial' : 'done';
  await saveProgress(finalStatus);
  return { status: finalStatus, analyzedAt: new Date().toISOString(), supplier: analysis.supplier, date: analysis.date, total: analysis.total, results, notes: notesCursor };
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
