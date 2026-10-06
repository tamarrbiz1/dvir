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
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    // תגית קיימת אבל ה-JSON שבתוכה פגום (למשל נערך ידנית בטעות) — לא
    // קורס, אבל חשוב לדעת שזה קרה (ללא לוג, ההוצאה הזו הייתה "מתנתחת
    // מחדש בשקט" לנצח בלי שאף אחד ישים לב שהמצב הקודם אבד).
    console.error(`[inventory-ai] פענוח מצב-מלאי קיים נכשל (JSON פגום בתגית [מלאי-AI]): ${e.message}`);
    return null;
  }
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

  // "ידני?" מסומן = המשתמש שולט בזה בעצמו (סעיף E, תוספת 2026-10-06) —
  // אין ניתוח AI אוטומטי בכלל, גם אם המשתמש מסמן אותו אחרי שכבר הייתה
  // הורדה אוטומטית (לא מבטלים את מה שכבר קרה, רק לא ממשיכים לנתח).
  if (fields['ידני?'] && !force) {
    return existingState || { status: 'manual', note: 'מסומן כ"ידני?" — ללא ניתוח אוטומטי' };
  }

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

  const { status: finalStatus, results, notes } = await deductMatchedLines(
    expenseId, currentNotes, matched,
    { supplier: analysis.supplier, date: analysis.date, total: analysis.total, expenseNum, supplierLabel, dateLabel }
  );
  return { status: finalStatus, analyzedAt: new Date().toISOString(), supplier: analysis.supplier, date: analysis.date, total: analysis.total, results, notes };
}

/**
 * מבצע את ההורדה בפועל לרשימת שורות-מותאמות (matchLinesToInventory),
 * עם שמירה הדרגתית (לא רק בסוף!): אחרי כל שורה שהורדה בפועל נשמר
 * סטטוס "processing" מעודכן. אם השרת ייפול/יופעל מחדש באמצע (בין
 * שורה לשורה) — ה-state כבר משקף נכון מה הורד ומה לא, וניסיון חוזר
 * ימשיך מאיפה שנעצר במקום להוריד שוב את מה שכבר ירד (ר' דרישה
 * מפורשת במשימה: "כשל באמצע... לא חצי-הורדה, ניתן לנסות שוב").
 * משותף לנתיב האוטומטי (AI) ולנתיב הידני (סעיף E, תוספת 2026-10-06).
 */
async function deductMatchedLines(expenseId, startNotes, matched, meta) {
  let notesCursor = startNotes;
  const results = [];
  // אם שמירת ה-state על ההוצאה עצמה נכשלת (למשל ההוצאה נמחקה "תחת
  // הרגליים" באמצע העיבוד — ר' משימת M3, "רשומה נמחקת בין קריאה
  // לכתיבה") — לא ממשיכים ללולאה: אין לאן לשמור את המשך ההתקדמות,
  // וממשיכים להוריד מלאי נגד מסמך-מקור שאולי כבר לא קיים הוא יותר
  // נזק מתועד גרוע מהפסקה מוקדמת עם לוג ברור.
  let sourceGone = false;
  const saveProgress = async (status) => {
    try {
      notesCursor = await saveState(expenseId, notesCursor, {
        status, analyzedAt: new Date().toISOString(),
        supplier: meta.supplier, date: meta.date, total: meta.total,
        results,
      });
    } catch (e) {
      console.error(`[inventory-ai] שמירת מצב להוצאה ${expenseId} נכשלה (ייתכן שהרשומה נמחקה באמצע העיבוד): ${e.message}`);
      sourceGone = true;
    }
  };

  for (const m of matched) {
    if (sourceGone) break;
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
      await appendItemMovementNote(m.item, `↓ ${m.quantity} · הוצאה #${meta.expenseNum ?? '?'} · ${meta.supplierLabel || 'ספק לא ידוע'} · ${meta.dateLabel || new Date().toISOString().slice(0, 10)}`);
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

  const finalStatus = results.some((r) => r.error) ? 'partial' : 'done';
  await saveProgress(finalStatus);
  return { status: finalStatus, results, notes: notesCursor };
}

// ============================================================
// מסמך הוצאה ידני (תוספת 2026-10-06 בבוקר, סעיף E) — "ידני?"=true.
// המשתמש מזין בעצמו שורות מלאי (לא AI) — ביטחון 1.0 תמיד (המשתמש
// קבע את זה בעצמו, לא ניחוש), עדיין דרך matchLinesToInventory כדי
// לאכוף "רק פריטים קיימים" ובדיקת יחידת-מידה עמומה.
// ============================================================

/**
 * שגיאת ולידציה — מסומנת כ-400 (לא 500), כדי שה-route יידע להבדיל
 * "קלט לא תקין מהמשתמש" מ"תקלת שרת" בלי לבדוק טקסט חופשי של ההודעה.
 */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

/**
 * ולידציה עצמאית בצד השרת (תוספת 2026-10-06, הבהרת תמר) — לא מסתמכת
 * על הלקוח, כי הבקשה יכולה לבוא גם ישירות מה-API ולא רק מהטופס.
 * כל 4 שדות הראש חובה: ספק/תאריך/סכום/קטגוריה. שורת פריט שאינה
 * ריקה-לגמרי (יש בה תיאור ו/או כמות ו/או יחידה) חייבת למלא את כל 3
 * השדות — שורה חלקית = שגיאה. שורה ריקה-לגמרי מתעלמים ממנה בשקט.
 */
export function validateManualExpenseInput({ supplier, date, total, category, lines }) {
  const missing = [];
  if (!supplier || !String(supplier).trim()) missing.push('ספק');
  if (!date || !String(date).trim()) missing.push('תאריך');
  if (total == null || String(total).trim() === '' || Number.isNaN(Number(total))) missing.push('סכום');
  if (!category || !String(category).trim()) missing.push('קטגוריה');
  if (missing.length) throw new ValidationError(`חסר שדה חובה: ${missing.join(', ')}`);

  (lines || []).forEach((l, i) => {
    const desc = String(l?.description || '').trim();
    const hasQty = l?.quantity !== null && l?.quantity !== undefined && String(l.quantity).trim() !== '';
    const unit = String(l?.unit || '').trim();
    if (!desc && !hasQty && !unit) return; // שורה ריקה-לגמרי — מתעלמים, לא שולחים שגיאה
    const lineMissing = [];
    if (!desc) lineMissing.push('מה נקנה');
    if (!hasQty || Number.isNaN(Number(l.quantity))) lineMissing.push('כמות');
    if (!unit) lineMissing.push('יחידה');
    if (lineMissing.length) throw new ValidationError(`שורת פריט ${i + 1}: חסר/ה ${lineMissing.join(', ')}`);
  });
}

/**
 * יוצר רשומת הוצאה ידנית (ידני?=true) עם שורות מלאי, וכותבת ישירות
 * לאותם שדות -AI שהניתוח האוטומטי כותב אליהם (השם היסטורי, לא משנים
 * אותו). ההורדה מתבצעת מיד עם היצירה. owner בלבד (נאכף ב-route).
 */
export async function createManualExpense({ supplier, date, total, category, notes: freeNotes, lines }) {
  validateManualExpenseInput({ supplier, date, total, category, lines });
  const fields = { 'ידני?': true };
  if (supplier) fields['ספק-AI'] = supplier;
  if (date) fields['תאריך חשבונית-AI'] = date;
  if (total != null) fields['סכום כולל-AI'] = String(total);
  if (category) fields['קטגוריית חשבונית-AI'] = category;
  if (freeNotes) fields['הערות'] = freeNotes;

  const base = getBase();
  const created = await base(EXPENSES_TABLE).create(fields);
  const expenseId = created.id;
  const expenseNum = created.fields['מספר הוצאה'];

  const cleanLines = (lines || [])
    .map((l) => ({ description: String(l.description || '').trim(), quantity: l.quantity != null ? Number(l.quantity) : null, unit: l.unit ? String(l.unit).trim() : null, unitPrice: null, lineTotal: null, confidence: 1 }))
    .filter((l) => l.description);

  if (!cleanLines.length) {
    const state = { status: 'done', analyzedAt: new Date().toISOString(), supplier, date, total, results: [], note: 'מסמך ידני בלי שורות מלאי' };
    await saveState(expenseId, fields['הערות'] || '', state);
    return { id: expenseId, ...created.fields, inventoryState: state };
  }

  let inventoryItems;
  try {
    inventoryItems = await fetchRecords(INVENTORY_TABLE, {});
  } catch (e) {
    const state = { status: 'failed', analyzedAt: new Date().toISOString(), supplier, date, total, error: `קריאת המלאי נכשלה: ${e.message}`, results: [] };
    await saveState(expenseId, fields['הערות'] || '', state);
    return { id: expenseId, ...created.fields, inventoryState: state };
  }

  const matched = matchLinesToInventory(cleanLines, inventoryItems);
  const { status, results, notes: finalNotes } = await deductMatchedLines(
    expenseId, fields['הערות'] || '', matched,
    { supplier, date, total, expenseNum, supplierLabel: supplier || '', dateLabel: date || '' }
  );
  return { id: expenseId, ...created.fields, inventoryState: { status, analyzedAt: new Date().toISOString(), supplier, date, total, results, notes: finalNotes } };
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

// ============================================================
// ביטול הורדה (תוספת 2026-10-06 בבוקר, סעיף E) — מוחקים הוצאה (ידנית
// או אוטומטית) → כל מה שהיא הורידה חוזר למלאי. נקרא **לפני** המחיקה
// בפועל של רשומת ההוצאה (ר' server.js, DELETE /api/הוצאות/:id).
// ============================================================

/**
 * מחזיר למלאי את כל מה שהוצאה הורידה, לפני שהיא נמחקת. אידמפוטנטי:
 * אם כבר בוטלה (reversed:true בכל השורות שהורידו) — לא מחזיר שוב.
 * לא חוסם במחיקה חלקית/מלאי שהשתנה בינתיים — מבצע ככל האפשר ומתעד
 * הפרש, בדיוק כמו שהתבקש ("לא לחסום... לתעד את ההפרש").
 */
export async function reverseInventoryDeduction(expenseId) {
  const base = getBase();
  let rec;
  try {
    rec = await base(EXPENSES_TABLE).find(expenseId);
  } catch (e) {
    // יכולה להיות "כבר נמחקה" (תקין, אין מה לבטל) *או* כשל-רשת/429 אמיתי
    // (לא תקין — מבטל-בשוגג בלי לנסות שוב). אין לנו דרך פשוטה להבדיל בלי
    // לבדוק קוד שגיאה (חבילת airtable לא חושפת סטטוס HTTP ישיר כאן), אז
    // לפחות מתעדים כדי שאפשר לזהות דפוס אם זה קורה הרבה (ר' M3).
    console.error(`[inventory-ai] קריאת הוצאה ${expenseId} לפני ביטול-הורדה נכשלה (יכול להיות שנמחקה בעבר, או כשל-רשת): ${e.message}`);
    return null;
  }
  const currentNotes = rec.fields['הערות'] || '';
  const state = readState(currentNotes);
  if (!state || !Array.isArray(state.results) || !state.results.length) return null;

  const expenseNum = rec.fields['מספר הוצאה'];
  let notesCursor = currentNotes;
  let changed = false;

  for (let i = 0; i < state.results.length; i++) {
    const r = state.results[i];
    if (!r.deducted || r.reversed) continue; // לא ירד בכלל, או כבר בוטל — לא נוגעים
    changed = true;
    try {
      const itemRec = await base(INVENTORY_TABLE).find(r.itemId);
      const current = Number(itemRec.fields['מלאי נוכחי']) || 0;
      await updateRecord(INVENTORY_TABLE, r.itemId, {
        'מלאי נוכחי': current + r.quantity,
        'תאריך עדכון': new Date().toISOString().slice(0, 10),
      });
      await appendItemMovementNote({ id: r.itemId, ...itemRec.fields }, `↩ ביטול הורדה של ${r.quantity} · הוצאה #${expenseNum ?? '?'} נמחקה · ${new Date().toISOString().slice(0, 10)}`);
      state.results[i] = { ...r, reversed: true, reversedAt: new Date().toISOString() };
    } catch (e) {
      // הפריט עצמו נמחק בינתיים, או כשל רשת — מתעדים את ההפרש בלי לחסום
      // את מחיקת ההוצאה (בדיוק כמו שהתבקש: "לבצע את ההחזרה ולתעד הפרש")
      state.results[i] = { ...r, reversed: false, reverseError: e.message };
    }
    notesCursor = await saveState(expenseId, notesCursor, state);
  }

  return changed ? state : null;
}
