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

// ⚠️ סעיף Z (8.10.2026) — יחידת-המידה של פריט-המלאי נכנסת לשורת-היומן
// עצמה, מיד אחרי הכמות: "↓ 10 ליטר · הוצאה #81 · ...". היחידה נשמרת
// **כפי שהייתה בזמן ההורדה**, ולכן שורה היסטורית לא "משנה את משמעותה"
// אם תמר תחליף יחידה לפריט בעתיד.
//
// ⚠️ תואם-לאחור: כש-unit ריק/null (המצב של **כל** הפריטים כרגע, כל עוד
// השדה לא מולא) מוחזרת הכמות לבדה — כלומר שורת-היומן נשארת **זהה
// בתו** למה שהיא היום. הפרסר בצד-הלקוח
// (client/src/utils/inventoryLedger.js) מקבל את היחידה כקבוצה
// **אופציונלית**, כך ששורות קיימות ממשיכות להיפרס בדיוק כמו קודם.
function qtyWithUnit(quantity, unit) {
  const u = String(unit || '').trim();
  return u ? `${quantity} ${u}` : `${quantity}`;
}

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

// ============================================================
// נעילה לפי מפתח (ליל-חיזוק 2026-10-07, סעיפים E1/E2/E4) — אותה תבנית-תור
// בדיוק כמו withInventoryLock ב-server.js, אבל כאן המפתחות הם
// **פריט-מלאי** (`item:<id>`) ו**רשומת-הוצאה** (`notes:<id>`), לא מסמך:
// ההערה ב-server.js אמרה במפורש ש-race בין שתי רשומות-מקור שמורידות
// מאותו פריט-מלאי "לא טופל" — זה מה שנסגר כאן. כל read-modify-write
// על פריט מלאי או על שדה "הערות" של הוצאה חייב לרוץ בתוך הנעילה.
// ============================================================
const keyLocks = new Map();
function withKeyLock(key, fn) {
  const prev = keyLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  keyLocks.set(key, run.catch(() => {}));
  return run;
}

/**
 * כותב את מצב-המלאי לשדה "הערות" של ההוצאה — **קורא את הרשומה מחדש**
 * בתוך נעילה, ולא מסתמך על snapshot/cursor מקומי (סעיף E4): ההורדה היא
 * fire-and-forget, ובמקביל אליה תמר יכולה לערוך את הטקסט החופשי מכרטיס
 * ההוצאה. לפני התיקון כל כתיבה כאן דרסה את הטקסט שהוקלד בינתיים —
 * ובכיוון ההפוך, עריכת ההערות דרסה את מצב-ההורדה, מה שגרם
 * ל-reverseInventoryDeduction לא להחזיר למלאי את מה שכן ירד.
 * הפרמטר currentNotes נשמר לתאימות-חתימה בלבד ואינו בשימוש.
 */
async function saveState(expenseId, _currentNotes, state) {
  return withKeyLock(`notes:${expenseId}`, async () => {
    const rec = await getBase()(EXPENSES_TABLE).find(expenseId);
    const notes = writeStateIntoNotes(rec.fields['הערות'] || '', state);
    await updateRecord(EXPENSES_TABLE, expenseId, { 'הערות': notes });
    return notes;
  });
}

/**
 * הורדה אטומית מפריט-מלאי אחד (סעיפים E1+E2).
 * לפני התיקון ההורדה חישבה `current` מתוך ה-snapshot שנקרא פעם אחת
 * ב-fetchRecords — ו-matchLinesToInventory מחזיר את **אותו אובייקט**
 * לכל שורה באותה קטגוריה, כך ששתי שורות קרטונים (10 ו-5) מתוך 100
 * הסתיימו ב-95 במקום 85 (כל כתיבה דרסה את הקודמת), ושורת-התנועה
 * ב"הערות" של הפריט נדרסה באותה דרך בדיוק. כאן: נעילה לפי מזהה-הפריט,
 * קריאה-מחדש טרייה, וכתיבה **אחת** של "מלאי נוכחי"+"הערות"+"תאריך עדכון"
 * (חצי מהקריאות ל-Airtable מול הקוד הקודם).
 * כמות חייבת להיות מספר סופי: `Infinity` נכתב ל-Airtable כ-null, כלומר
 * **מחיקת** ערך המלאי של הפריט. כמות שלילית מותרת כאן בכוונה — זו
 * ההחזרה של reverseInventoryDeduction — אבל נחסמת בוולידציית הקלט.
 */
export async function deductFromInventoryItem(itemId, quantity, noteText) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) throw new Error(`כמות לא חוקית להורדה מהמלאי (${quantity})`);
  return withKeyLock(`item:${itemId}`, async () => {
    const rec = await getBase()(INVENTORY_TABLE).find(itemId);
    const current = Number(rec.fields['מלאי נוכחי']) || 0;
    const after = current - qty;
    const fields = { 'מלאי נוכחי': after, 'תאריך עדכון': new Date().toISOString().slice(0, 10) };
    if (noteText) {
      const currentNotes = String(rec.fields['הערות'] || '');
      fields['הערות'] = currentNotes ? `${currentNotes}\n${noteText}` : noteText;
    }
    await updateRecord(INVENTORY_TABLE, itemId, fields);
    return { before: current, after };
  });
}

/** מוריד קובץ מצורף (URL של Airtable) לזיכרון — לא נשמר על דיסק */
async function downloadAttachment(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`הורדת הקובץ נכשלה (${res.status})`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// appendItemMovementNote הוסרה (ליל-חיזוק 2026-10-07, סעיף E1): היא
// בנתה את ההערה החדשה מתוך ה-snapshot שהועבר אליה, ולכן שתי שורות
// שמורידות מאותו פריט דרסו זו את שורת-התנועה של זו. שורת-התנועה
// נכתבת עכשיו בתוך deductFromInventoryItem — באותה כתיבה כמו
// "מלאי נוכחי", על ערך שנקרא מחדש בתוך הנעילה.

/**
 * ממשיכים ריצה שנעצרה באמצע (status "processing"/"partial") — בלי
 * לקרוא שוב ל-AI. מנוסות שוב רק שורות שנכשלו עם שגיאה (למשל 429
 * באמצע) או שתוכננו אך **מעולם לא הורצו** (pendingRun — ר' סעיף E6:
 * לפני התיקון שורה כזו לא הייתה ב-results בכלל, אז restart באמצע
 * ההורדה השאיר הוצאה תקועה ב-processing בלי שום דרך להשלים אותה).
 * שורות שכבר ירדו או מחכות לאישור ידני נשארות כמו שהן.
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
    if (!r.error && !r.pendingRun) continue; // לא אמור לקרות, אבל ליתר ביטחון
    try {
      await deductFromInventoryItem(r.itemId, r.quantity, `↓ ${qtyWithUnit(r.quantity, r.itemUnit)} · הוצאה #${expenseNum ?? '?'} · ${supplierLabel || 'ספק לא ידוע'} · ${dateLabel || new Date().toISOString().slice(0, 10)}`);
      results[i] = { ...r, deducted: true, deductedAt: new Date().toISOString(), error: undefined, pendingRun: undefined };
    } catch (e) {
      results[i] = { ...r, error: e.message, pendingRun: undefined };
    }
    await saveProgress('processing');
  }

  const finalStatus = results.some((r) => r.error || r.pendingRun) ? 'partial' : 'done';
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
  // (סעיף E6, ליל-חיזוק 2026-10-07) יוצא-מן-הכלל אחד: הוצאה ידנית
  // שההורדה-ברקע שלה נקטעה באמצע (restart/429) נשארת ב-"processing"
  // לנצח — ה-return הזה חסם גם את **ההחלמה**, וכפתור "נתח מחדש" לא
  // שולח force, אז לא הייתה שום דרך להשלים אותה. החלמה אינה "ניתוח
  // אוטומטי": resumeUnresolvedLines לא קורא ל-AI בכלל, הוא רק מנסה
  // שוב שורות שנכשלו/לא הורצו לפי ה-state שכבר נקבע.
  if (fields['ידני?'] && !force) {
    if (existingState?.status === 'processing' || existingState?.status === 'partial') {
      return resumeUnresolvedLines(expenseId, currentNotes, existingState);
    }
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
    // סעיף V2 (8.10.2026): להבדיל בין "הניתוח **נכשל**" לבין "נותח ובאמת
    // אין פריטים". כשל נשמר כ-`failed` (לא `done`), עם הודעה ידידותית
    // למשתמשת; הפירוט הטכני נרשם ללוג השרת בלבד ולא נדחף לכרטיס.
    const friendly = e?.analysisUnavailable
      ? 'הניתוח לא זמין כרגע — נסו שוב מאוחר יותר'
      : (e?.message || 'שגיאה לא ידועה');
    console.error(`[inventory-ai] ניתוח הוצאה ${expenseId} נכשל: ${e?.message}${e?.detail ? ` | ${e.detail}` : ''}`);
    const state = { status: 'failed', analyzedAt: new Date().toISOString(), error: friendly, results: [] };
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
  // results נבנה מראש **בסדר של matched** (לא push הדרגתי), כי ההורדה
  // עצמה מתבצעת מקובצת לפי פריט-מלאי ולא שורה-שורה (סעיף E1), ו-lineIndex
  // שה-UI שולח ל-approve חייב להמשיך להתאים למיקום בשורות.
  // שורה שתוכננה להורדה ועוד לא הורצה מסומנת pendingRun — כך
  // resumeUnresolvedLines יודע להמשיך אותה אחרי restart (סעיף E6).
  const results = matched.map((m) => ({
    description: m.line.description, quantity: m.quantity, unit: m.line.unit,
    // itemUnit (סעיף Z) — יחידת-המידה **שהוגדרה לפריט** (לא יחידת השורה
    // בחשבונית, שכבר נשמרת לעיל כ-unit) — משמשת רק לתצוגה בשורת-היומן
    // (ר' qtyWithUnit למעלה), לא משפיעה על ההתאמה עצמה (זו כבר
    // הוכרעה ב-matchLinesToInventory).
    itemUnit: m.item['יחידת מידה'] || null,
    category: m.category, itemId: m.item.id, confidence: m.confidence,
    deducted: false,
    ...(m.needsApproval ? { needsApproval: true, reason: m.reason } : { pendingRun: true }),
  }));
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

  // תיעוד-כוונה לפני ההורדה הראשונה: אחרי השמירה הזו ה-state כבר מכיל
  // את **כל** השורות המתוכננות (pendingRun), כך ש-restart באמצע משאיר
  // משהו להמשיך ממנו ולא שורות שנעלמו בלי זכר (סעיף E6).
  await saveProgress('processing');

  // קיבוץ לפי פריט-מלאי (סעיף E1): כמה שורות שמתאימות לאותה קטגוריה =
  // הורדה אחת מסוכמת, בתוך נעילה ועל ערך שנקרא מחדש. לפני כן כל שורה
  // חישבה מתוך אותו snapshot ולכן רק האחרונה "נשארה" בפועל. בונוס:
  // 50 שורות באותה קטגוריה = 3 קריאות Airtable במקום ~150 (בלי 429).
  const groups = new Map();
  results.forEach((r, i) => {
    if (r.needsApproval) return;
    if (!groups.has(r.itemId)) groups.set(r.itemId, []);
    groups.get(r.itemId).push(i);
  });

  for (const [itemId, idxs] of groups) {
    if (sourceGone) break;
    const totalQty = idxs.reduce((sum, i) => sum + Number(results[i].quantity), 0);
    try {
      if (!Number.isFinite(totalQty) || totalQty <= 0) throw new Error(`כמות מסוכמת לא חוקית להורדה (${totalQty})`);
      // כל השורות בקבוצה הן אותו itemId, ולכן אותה יחידת-פריט — idxs[0] מספק
      await deductFromInventoryItem(itemId, totalQty, `↓ ${qtyWithUnit(totalQty, results[idxs[0]].itemUnit)} · הוצאה #${meta.expenseNum ?? '?'} · ${meta.supplierLabel || 'ספק לא ידוע'} · ${meta.dateLabel || new Date().toISOString().slice(0, 10)}`);
      const deductedAt = new Date().toISOString();
      idxs.forEach((i) => { results[i] = { ...results[i], deducted: true, deductedAt, pendingRun: undefined }; });
    } catch (e) {
      idxs.forEach((i) => { results[i] = { ...results[i], deducted: false, needsApproval: false, error: e.message, pendingRun: undefined }; });
    }
    // שמירה אחרי כל פריט בפועל — לא מחכים לכל הלולאה (ר' הערה למעלה)
    await saveProgress('processing');
  }

  const finalStatus = results.some((r) => r.error || r.pendingRun) ? 'partial' : 'done';
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
 * ולידציה עצמאית בצד השרת (תוספת 2026-10-06, הבהרת תמר; עודכן סעיף R
 * 2026-10-07: supplierId במקום טקסט חופשי, ו"יחידה" הוסרה — לא
 * רלוונטית להפחתת כמות מהמלאי) — לא מסתמכת על הלקוח, כי הבקשה יכולה
 * לבוא גם ישירות מה-API ולא רק מהטופס. כל 4 שדות הראש חובה:
 * ספק/תאריך/סכום/קטגוריה. שורת פריט שאינה ריקה-לגמרי (יש בה תיאור
 * ו/או כמות) חייבת למלא את שני השדות — שורה חלקית = שגיאה. שורה
 * ריקה-לגמרי מתעלמים ממנה בשקט.
 */
/**
 * תקרה למספר שורות-פריטים בהוצאה אחת (ליל-חיזוק 2026-10-07, סעיף E7).
 * לא הייתה שום תקרה — בקשה אחת יכלה לתזמן מאות כתיבות סדרתיות
 * ל-Airtable ברקע (429 ודאי). 100 נדיב בהרבה מכל מסמך אמיתי.
 */
export const MAX_MANUAL_LINES = 100;

export function validateManualExpenseInput({ supplierId, date, total, category, lines }) {
  const missing = [];
  // supplierId חייב להיות מחרוזת: אובייקט/מערך היו "עוברים" את
  // String(...).trim() ונופלים רק בהמשך (סעיף E7)
  if (!supplierId || typeof supplierId !== 'string' || !supplierId.trim()) missing.push('ספק');
  if (!date || typeof date !== 'string' || !date.trim()) missing.push('תאריך');
  // Number.isFinite ולא Number.isNaN (סעיף E3): "1e999" → Infinity עבר
  // את הבדיקה הקודמת ונכתב לשדה הסכום כ-"Infinity"; גם true עבר כ-1.
  if (total == null || typeof total === 'boolean' || String(total).trim() === '' || !Number.isFinite(Number(total))) missing.push('סכום');
  if (!category || typeof category !== 'string' || !category.trim()) missing.push('קטגוריה');
  if (missing.length) throw new ValidationError(`חסר שדה חובה: ${missing.join(', ')}`);

  // lines שאינו מערך גרם ל-TypeError ולכן ל-500 במקום 400 (סעיף E7)
  if (lines != null && !Array.isArray(lines)) throw new ValidationError('פורמט שורות הפריטים אינו תקין');
  if (Array.isArray(lines) && lines.length > MAX_MANUAL_LINES) {
    throw new ValidationError(`יותר מ-${MAX_MANUAL_LINES} שורות פריטים בהוצאה אחת (התקבלו ${lines.length}) — יש לפצל לכמה הוצאות`);
  }

  (lines || []).forEach((l, i) => {
    const desc = String(l?.description || '').trim();
    const hasQty = l?.quantity !== null && l?.quantity !== undefined && String(l.quantity).trim() !== '';
    if (!desc && !hasQty) return; // שורה ריקה-לגמרי — מתעלמים, לא שולחים שגיאה
    const lineMissing = [];
    if (!desc) lineMissing.push('מה נקנה');
    const qty = Number(l?.quantity);
    if (!hasQty || !Number.isFinite(qty)) lineMissing.push('כמות');
    if (lineMissing.length) throw new ValidationError(`שורת פריט ${i + 1}: חסר/ה ${lineMissing.join(', ')}`);
    // סעיף E3: כמות <= 0 עברה בשקט, סומנה "דורש אישור" עם נימוק מטעה
    // ("יחידת מידה לא ברורה"), ואישור בקליק אחד היה מריץ
    // `current - (-5)` — כלומר **הגדלת** המלאי. 0 רק מייצר רעש.
    if (qty <= 0) throw new ValidationError(`שורת פריט ${i + 1}: הכמות חייבת להיות גדולה מאפס (התקבל ${l.quantity})`);
  });
}

// ============================================================
// הגנה מפני שמירה כפולה (ליל-חיזוק 2026-10-07, סעיף E5) — בלקוח יש
// disabled={saving}, אבל בשרת לא הייתה שום הגנה: שני טאבים, retry של
// הרשת או קליק-כפול שחומק יצרו **שתי** רשומות הוצאה, שתי הרצות Make
// (קרדיטים אמיתיים) ו**שתי הורדות מלאי** על אותן שורות.
// חלון קצר בזיכרון: בקשה זהה בתוך 15 שניות ממתינה לראשונה ומקבלת את
// אותה רשומה. כשל אמיתי מנקה את המפתח כדי שניסיון חוזר יעבוד מיד.
// ============================================================
const MANUAL_SUBMIT_WINDOW_MS = 15000;
const manualSubmits = new Map();

/** חתימת-תוכן של בקשת הוצאה ידנית — זהות מלאה בלבד נחשבת כפילות */
export function manualExpenseSubmitKey({ supplierId, date, total, category, notes, lines }) {
  return JSON.stringify([
    String(supplierId || ''), String(date || ''), String(total ?? ''),
    String(category || ''), String(notes || ''),
    (Array.isArray(lines) ? lines : []).map((l) => [
      String(l?.description || '').trim(),
      l?.quantity == null ? '' : String(l.quantity),
    ]),
  ]);
}

/**
 * תובע בעלות על חתימת-בקשה. `{ fresh: true, settle }` — אתה הראשון,
 * חייב לקרוא ל-settle(record) בהצלחה או settle(null) בכשל.
 * `{ fresh: false, wait }` — יש בקשה זהה בחלון; wait() מחזיר את הרשומה
 * שנוצרה (או null אם הראשונה נכשלה).
 */
export function claimManualExpenseSubmission(key, now = Date.now()) {
  for (const [k, v] of manualSubmits) {
    if (now - v.at > MANUAL_SUBMIT_WINDOW_MS) manualSubmits.delete(k);
  }
  const existing = manualSubmits.get(key);
  if (existing) return { fresh: false, wait: () => existing.promise };
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  manualSubmits.set(key, { at: now, promise });
  return {
    fresh: true,
    settle: (record) => {
      if (!record) manualSubmits.delete(key);
      resolve(record || null);
    },
  };
}

// ============================================================
// עריכת הטקסט החופשי של "הערות" בהוצאה (ליל-חיזוק 2026-10-07, סעיף E4).
// קודם הלקוח שלח את **כל** השדה, כששורות-הסמן משוחזרות מה-snapshot
// שנטען לדפדפן — ולכן עריכה בזמן שההורדה-ברקע כותבת את הסמן החזירה
// את מצב-ההורדה אחורה (ואז reverseInventoryDeduction במחיקה לא החזיר
// למלאי את מה שכן ירד). כאן השרת הוא מקור-האמת: קריאה-מחדש בתוך
// נעילה, הדבקת התגיות **העכשוויות**, ונטרול שורות-סמן שהמשתמש הקליד.
// ============================================================
const AI_MARKER_LINE_RE = /^\s*\[מלאי-AI\]\{.*\}\s*$/;
const D_TAG_LINE_RE = /^\s*\[מלאי-D:[^\]]+\]\s*$/;
const isTagLine = (line) => AI_MARKER_LINE_RE.test(line) || D_TAG_LINE_RE.test(line);

/**
 * מסיר מהטקסט שהמשתמש הקליד כל שורה שנראית כמו סמן פנימי. בלי זה,
 * טקסט חופשי שמכיל `[מלאי-AI]{"results":[{"deducted":true,"itemId":
 * "<פריט אמיתי>","quantity":9999}]}` היה נשמר **לפני** התגית האמיתית,
 * ו-readState (שלוקח את ההתאמה הראשונה) היה מאמץ אותו — כך שמחיקת
 * ההוצאה הייתה מוסיפה 9999 לפריט מלאי אמיתי.
 */
export function sanitizeFreeNotes(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !isTagLine(line))
    .join('\n')
    .replace(MARKER_RE, '')
    .trim();
}

/** מחבר טקסט-חופשי נקי עם שורות-הסמן שקיימות כרגע ברשומה */
export function mergeFreeNotesWithTags(currentNotes, freeText) {
  const tagLines = String(currentNotes || '').split('\n').filter(isTagLine);
  const free = sanitizeFreeNotes(freeText);
  if (!tagLines.length) return free;
  return free ? `${free}\n${tagLines.join('\n')}` : tagLines.join('\n');
}

/** כותב טקסט-חופשי חדש ל"הערות" של הוצאה בלי לאבד/לזייף שורות-סמן */
export async function updateExpenseFreeNotes(expenseId, freeText) {
  return withKeyLock(`notes:${expenseId}`, async () => {
    const rec = await getBase()(EXPENSES_TABLE).find(expenseId);
    const next = mergeFreeNotesWithTags(rec.fields['הערות'] || '', freeText);
    await updateRecord(EXPENSES_TABLE, expenseId, { 'הערות': next || null });
    return next;
  });
}

// ============================================================
// מחיקת הערות מפריט-מלאי (2026-10-08, "אפשרות למחוק הערות מרשימת
// ההערות") — שדה "הערות" של "מלאי בסיסי" מכיל גם יומן-תנועות אוטומטי
// (שורות ↓/↩/⚠, ר' logistics-deduction.js וגם deductFromInventoryItem
// למעלה) שחלקן נושאות תגית-אידמפוטנטיות **בתוך הטקסט עצמו**
// ([מלאי-D:טבלה:מזהה:קטגוריה]) וחלקן (שורות הוצאה, "↓ ... · הוצאה
// #N...") בלי תגית נראית-לעין כלל — האידמפוטנטיות שלהן נשמרת בנפרד,
// בשדה "הערות" של רשומת-ההוצאה עצמה ([מלאי-AI]).
//
// ⚠️ החלטה מכוונת: שורת-תנועה **לעולם לא נמחקת בפועל** — רק מוסתרת
// (ר' isLedgerLine/hideInventoryLedgerLine למטה). שני טעמים, לא אחד:
// (1) logistics-deduction.js בודק אידמפוטנטיות ב-`notes.includes(tag)`
//     על כל שדה "הערות" — מחיקת הטקסט מוחקת את התגית, ומאפשרת הורדה
//     כפולה בניתוח חוזר של אותו מסמך (ולדוגמת-אזהרות הישנות: דה-דופ
//     לפי טקסט-מדויק, ר' deductOne — מחיקה "משחררת" אזהרה שכבר טופלה
//     לחזור).
// (2) גם לשורות-הוצאה (בלי תגית נראית): מחיקה-אמיתית+"החזרת כמות" ידנית
//     כאן הייתה מתנגשת עם מחיקה-מדורגת קיימת של ההוצאה עצמה
//     (reverseInventoryDeduction למעלה) — שתי מחיקות בלתי-תלויות
//     שמחזירות כמות לאותו פריט הן כפל-ספירה (ולא תמיד יקרה בסדר
//     שמונע את זה). הסתרה לא נוגעת ב"מלאי נוכחי" בכלל ולא בטקסט של
//     התנועה עצמה — בטוחה בוודאות במקום בטוחה-בניסוח-קפדני.
// לכן: ההסתרה חלה על **כל** שורה שנראית כמו תנועה (מתחילה ב-↓/↩/⚠,
// אחרי תאריך-ISO מוביל אופציונלי) — לא רק על שורות עם תגית נראית.
// רק הערה-חופשית אמיתית (טקסט שהמשתמשת הקלידה, לא תנועה) נמחקת בפועל.
//
// ⚠️ isLedgerLine חייבת להישאר מסונכרנת עם הסיווג המקביל ב-client
// (client/src/utils/inventoryLedger.js — stripLeadingDate + הבדיקה
// rest.startsWith('↓'/'↩'/'⚠') ב-parseInventoryLedger) — שני הצדדים
// חייבים להסכים על מה "שורת-תנועה" לעומת "הערה חופשית".
// ============================================================
const ITEM_LEADING_DATE_RE = /^(\d{4}-\d{2}-\d{2})[T ]?[\d:.,Z]*\s+/;
const ITEM_HIDDEN_RE = /^\[מלאי-מוסתר\](\{.*\})\s*$/;

function isLedgerLine(line) {
  const rest = String(line || '').replace(ITEM_LEADING_DATE_RE, '');
  return rest.startsWith('↓') || rest.startsWith('↩') || rest.startsWith('⚠');
}

/** קורא את רשימת השורות-המוסתרות הנוכחית מתוך שורת-הבקרה [מלאי-מוסתר] */
function readHiddenLedgerLines(notes) {
  for (const line of String(notes || '').split('\n')) {
    const m = ITEM_HIDDEN_RE.exec(line.trim());
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      return Array.isArray(parsed?.lines) ? parsed.lines : [];
    } catch (e) {
      console.error(`[inventory-notes] פענוח [מלאי-מוסתר] נכשל (JSON פגום): ${e.message}`);
      return [];
    }
  }
  return [];
}

/** כותב רשימת שורות-מוסתרות חדשה ל"הערות" — מחליף שורת-בקרה קיימת או מוסיף אחת בסוף */
function writeHiddenLedgerLines(notes, hiddenLines) {
  const controlLine = `[מלאי-מוסתר]${JSON.stringify({ lines: hiddenLines })}`;
  const lines = String(notes || '').split('\n');
  const idx = lines.findIndex((l) => ITEM_HIDDEN_RE.test(l.trim()));
  if (idx >= 0) lines[idx] = controlLine; else lines.push(controlLine);
  return lines.join('\n');
}

/** האם שורה היא "תגית" שאסור לאבד ממחיקת-הערה-חופשית — תנועה, או שורת-הבקרה עצמה */
function isInventoryTagLine(line) {
  return isLedgerLine(line) || ITEM_HIDDEN_RE.test(String(line || '').trim());
}

/** מסיר מהטקסט שהמשתמשת הקלידה כל שורה שנראית כמו תנועה/בקרה (הגנה — ר' sanitizeFreeNotes המקביל) */
export function sanitizeInventoryFreeNotes(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !isInventoryTagLine(line))
    .join('\n')
    .trim();
}

/** מחבר טקסט-חופשי נקי עם כל שורות-התנועה/הבקרה שקיימות כרגע ברשומה */
export function mergeInventoryFreeNotesWithTags(currentNotes, freeText) {
  const tagLines = String(currentNotes || '').split('\n').filter(isInventoryTagLine);
  const free = sanitizeInventoryFreeNotes(freeText);
  if (!tagLines.length) return free;
  return free ? `${free}\n${tagLines.join('\n')}` : tagLines.join('\n');
}

/**
 * כותבת טקסט-חופשי חדש ל"הערות" של פריט-מלאי — קוראת מחדש בתוך
 * נעילה (אותו מפתח `item:<id>` של deductFromInventoryItem, כדי לא
 * לדרוס שורת-תנועה שניתוח-מלאי מקביל (הוצאה/תעודת-משלוח/חשבונית)
 * הוסיף בדיוק עכשיו), ומדביקה את כל שורות-התנועה/הבקרה הנוכחיות.
 */
export async function updateInventoryFreeNotes(itemId, freeText) {
  return withKeyLock(`item:${itemId}`, async () => {
    const rec = await getBase()(INVENTORY_TABLE).find(itemId);
    const next = mergeInventoryFreeNotesWithTags(rec.fields['הערות'] || '', freeText);
    await updateRecord(INVENTORY_TABLE, itemId, { 'הערות': next || null });
    return next;
  });
}

/**
 * "מוחקת" שורת-תנועה בודדת מהתצוגה — בפועל רק מוסיפה אותה לרשימת
 * השורות-המוסתרות (ר' הערת הכותרת לעיל): הטקסט (כולל כל תגית-
 * אידמפוטנטיות) נשאר בשדה בדיוק כמו שהיה, "מלאי נוכחי" לא נוגע בכלל.
 * אידמפוטנטי: קריאה כפולה על שורה שכבר מוסתרת מחזירה ok:true בלי שינוי.
 * קריאה-מחדש-טרייה בתוך נעילה (item:<id>) — לא snapshot מהדפדפן.
 * @returns {{ok:true}|{ok:false, reason:'not-found'|'not-ledger-line'}}
 */
export async function hideInventoryLedgerLine(itemId, rawLine) {
  return withKeyLock(`item:${itemId}`, async () => {
    if (!isLedgerLine(rawLine)) return { ok: false, reason: 'not-ledger-line' };
    const rec = await getBase()(INVENTORY_TABLE).find(itemId);
    const notes = String(rec.fields['הערות'] || '');
    const lines = notes.split('\n').map((l) => l.trim());
    if (!lines.includes(String(rawLine).trim())) return { ok: false, reason: 'not-found' };
    const hidden = readHiddenLedgerLines(notes);
    if (hidden.includes(rawLine)) return { ok: true }; // כבר מוסתרת — אידמפוטנטי
    const nextNotes = writeHiddenLedgerLines(notes, [...hidden, rawLine]);
    await updateRecord(INVENTORY_TABLE, itemId, { 'הערות': nextNotes });
    return { ok: true };
  });
}

/**
 * יוצר רשומת הוצאה ידנית (ידני?=true) — כתיבה ישירה לאותם שדות -AI
 * שהניתוח האוטומטי כותב אליהם (השם היסטורי, לא משנים אותו), כולל קישור
 * אמיתי לרשומת הספק (שדה 'ספקים') ושם הספק לתאימות-לאחור ('ספק-AI').
 * **מהיר בכוונה** (תיקון-ביצועים, סעיף R 2026-10-07): רק קריאה אחת
 * ל-Airtable (create) — הורדת המלאי בפועל רצה בנפרד וברקע, ר'
 * runManualExpenseInventoryDeduction למטה, כדי שהתגובה ללקוח לא תחכה
 * ל-fetch של כל פריטי המלאי + updateRecord סדרתי לכל שורה. owner
 * בלבד (נאכף ב-route).
 */
export async function createManualExpense({ supplierId, supplierName, date, total, category, notes: freeNotes, lines }) {
  validateManualExpenseInput({ supplierId, date, total, category, lines });
  const fields = { 'ידני?': true };
  if (supplierId) fields['ספקים'] = [supplierId];
  if (supplierName) fields['ספק-AI'] = supplierName;
  if (date) fields['תאריך חשבונית-AI'] = date;
  if (total != null) fields['סכום כולל-AI'] = String(total);
  if (category) fields['קטגוריית חשבונית-AI'] = category;
  if (freeNotes) fields['הערות'] = freeNotes;

  const base = getBase();
  const created = await base(EXPENSES_TABLE).create(fields);
  return { id: created.id, ...created.fields };
}

/**
 * מבצע את הורדת-המלאי בפועל לשורות של הוצאה ידנית שכבר נוצרה — רץ
 * ברקע, **אחרי** שהרשומה כבר נוצרה והתגובה כבר נשלחה ללקוח (ר' route
 * ב-server.js: נקרא fire-and-forget, בדיוק כמו autoAnalyzeExpenseInventory
 * להוצאה שהועלתה עם AI). כשל כאן אף פעם לא זורק — נרשם ללוג בלבד,
 * בדיוק כמו autoAnalyzeExpenseInventory.
 */
export async function runManualExpenseInventoryDeduction(expenseId, { supplier, date, total, freeNotes, lines, expenseNum }) {
  const startNotes = freeNotes || '';
  const cleanLines = (lines || [])
    .map((l) => ({ description: String(l.description || '').trim(), quantity: l.quantity != null ? Number(l.quantity) : null, unitPrice: null, lineTotal: null, confidence: 1 }))
    .filter((l) => l.description);

  if (!cleanLines.length) {
    const state = { status: 'done', analyzedAt: new Date().toISOString(), supplier, date, total, results: [], note: 'מסמך ידני בלי שורות מלאי' };
    await saveState(expenseId, startNotes, state);
    return state;
  }

  let inventoryItems;
  try {
    inventoryItems = await fetchRecords(INVENTORY_TABLE, {});
  } catch (e) {
    const state = { status: 'failed', analyzedAt: new Date().toISOString(), supplier, date, total, error: `קריאת המלאי נכשלה: ${e.message}`, results: [] };
    await saveState(expenseId, startNotes, state);
    return state;
  }

  const matched = matchLinesToInventory(cleanLines, inventoryItems);
  const { status, results, notes: finalNotes } = await deductMatchedLines(
    expenseId, startNotes, matched,
    { supplier, date, total, expenseNum, supplierLabel: supplier || '', dateLabel: date || '' }
  );
  return { status, analyzedAt: new Date().toISOString(), supplier, date, total, results, notes: finalNotes };
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
  // הגנה-בעומק (סעיף E3): שורה שהגיעה מ-state היסטורי/מוזרק יכולה
  // להכיל כמות שלילית או Infinity — אישור בקליק אחד היה **מגדיל** את
  // המלאי (או מוחק את הערך לגמרי, כי Infinity נכתב כ-null).
  const approveQty = Number(line.quantity);
  if (!Number.isFinite(approveQty) || approveQty <= 0) {
    throw new Error(`לא ניתן לאשר שורה עם כמות לא חוקית (${line.quantity}) — יש לתקן את ההוצאה`);
  }

  const expenseNum = rec.fields['מספר הוצאה'];
  await deductFromInventoryItem(line.itemId, approveQty, `↓ ${qtyWithUnit(approveQty, line.itemUnit)} · הוצאה #${expenseNum ?? '?'} · ${state.supplier || 'ספק לא ידוע'} · ${state.date || new Date().toISOString().slice(0, 10)} · אושר ידנית`);

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
      // כמות שלילית = החזרה (ר' deductFromInventoryItem) — באותה נעילה
      // ועל ערך שנקרא מחדש, כך ששתי מחיקות במקביל לא מאבדות החזרה
      await deductFromInventoryItem(r.itemId, -Number(r.quantity), `↩ ביטול הורדה של ${qtyWithUnit(r.quantity, r.itemUnit)} · הוצאה #${expenseNum ?? '?'} נמחקה · ${new Date().toISOString().slice(0, 10)}`);
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
