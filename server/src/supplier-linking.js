// ============================================================
// קישור אוטומטי — ספקים/משווקים מתוך נתוני המערכת (2026-10-06, סעיף C)
// ------------------------------------------------------------
// שאלות תמר: "איך מקשרים ספקים למלאי, ואיך אוטומטית מתוך הנתונים
// שכבר יש? הוצאות/צ'קים מקושרים לספק? בתעודות משלוח אין בחירת משווק."
//
// הממצא בפועל ב-Airtable: שדה הקישור ("ספקים"/"משווק") ריק בהרבה
// רשומות, אבל יש טקסט חופשי שה-AI/Make כתבו (ספק-AI / מוטב / משווק-AI).
// המודול הזה מתאים את הטקסט לרשומת ספק/משווק קיימת, או — אם אין התאמה —
// מציע למלא שם ברשומת ספק/משווק *קיימת* בלי שם, או ליצור רשומה חדשה.
//
//   • הוצאות (ספק-AI) → "ספקים", שדה קישור "ספקים"
//   • צ׳קים (מוטב, או ירושה מהוצאה מקושרת) → "ספקים", שדה קישור "ספקים"
//   • חשבוניות (משווק-AI) → "משווקים", שדה קישור "משווק"
//   • תעודות משלוח (משווק-AI) → "משווקים", שדה קישור "משווק"
//
// (הערה: "חשבוניות" ב-Airtable הזה הן חשבוניות *הכנסה* למשווק, ואין
// בהן בכלל שדה "ספק-AI" — רק "משווק-AI". לכן חשבוניות מטופלות כאן
// כמו תעודות משלוח, לא כמו הוצאות. ר' UploadDocumentPage.jsx/TARGETS.)
//
// עקרונות בטיחות:
//   • computeSuggestions טהורה (קלט: רשומות גולמיות) — אין בה שום
//     קריאת/כתיבת רשת, אפשר לבדוק בלי Airtable בכלל.
//   • applyLinks/runAutoLink הן היחידות שכותבות, ורק עבור הצעה
//     שה-confidence שלה ≥ AUTO_THRESHOLD (או מילוי-שם/יצירה — ר' למטה).
//   • לעולם לא מסירים קישור קיים, לעולם לא דורסים ספק/משווק שכבר מקושר.
//   • לעולם לא יוצרים רשומת ספק/משווק כפולה בתוך ריצה אחת — מטמון לפי
//     שם מנורמל בתוך applyLinks.
//   • כתיבות ל-Airtable מרווחות (≥ 220ms, מגבלת 5 בקשות/שנייה, משותפת).
// ============================================================
import { fetchRecords, createRecord, updateRecord } from './airtable.js';

export const SUPPLIERS_TABLE = 'ספקים';
export const MARKETERS_TABLE = 'משווקים';
export const EXPENSES_TABLE = 'הוצאות';
export const CHECKS_TABLE = 'צ׳קים';
export const INVOICES_TABLE = 'חשבוניות';
export const DELIVERY_TABLE = 'תעודות משלוח';
export const AUTO_THRESHOLD = 0.9;
const WRITE_GAP_MS = 220;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idsOf = (v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean) : []);

// ============================================================
// נרמול שמות והשוואה
// ============================================================
const COMPANY_SUFFIXES = ['בע"מ', 'בע״מ', "בע'מ", 'בע׳מ', 'בעמ', 'ltd.', 'ltd', 'inc.', 'inc', 'llc', 'co.', 'חברה'];

/** נרמול שם להשוואה: אותיות קטנות, בלי גרשיים/גרש/מרכאות, בלי סיומות חברה, בלי פיסוק, רווח יחיד */
export function normalizeName(s) {
  let t = String(s ?? '').trim().toLowerCase();
  t = t.replace(/[״׳"'`"'‘’]/g, '');
  for (const suf of COMPANY_SUFFIXES) {
    const bare = suf.replace(/[״׳"'`.]/g, '');
    t = t.split(bare).join(' ');
  }
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** מרחק לוינשטיין רגיל (החלפה/הוספה/מחיקה = 1) */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 1;
}

function jaccard(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * מתאים טקסט חופשי לרשומה הכי קרובה ברשימת מועמדים, לפי שדה שם נתון.
 * מחזיר { candidate, confidence, reason } או null.
 * סולם: זהות אחרי נרמול 1.0 · הכלה (≥4 תווים) 0.9 · חפיפת מילים ≥0.6 → 0.8 ·
 * דמיון לוינשטיין ≥0.85 → 0.75. רק ≥ AUTO_THRESHOLD "בטוח" לקישור אוטומטי.
 */
export function matchEntity(text, candidates, nameField) {
  const q = normalizeName(text);
  if (!q) return null;
  let best = null;
  const consider = (candidate, confidence, reason) => {
    if (!best || confidence > best.confidence) best = { candidate, confidence, reason };
  };
  for (const c of candidates || []) {
    const name = normalizeName(c?.[nameField]);
    if (!name) continue; // רשומה בלי שם — לא מתאימים אליה כלום (היעד למילוי-שם, לא להתאמה)
    if (name === q) { consider(c, 1.0, 'התאמה מדויקת'); continue; }
    if ((q.length >= 4 && name.includes(q)) || (name.length >= 4 && q.includes(name))) { consider(c, 0.9, 'שם אחד מוכל בשני'); continue; }
    if (jaccard(q, name) >= 0.6) { consider(c, 0.8, 'חפיפת מילים'); continue; }
    if (similarity(q, name) >= 0.85) consider(c, 0.75, 'שמות דומים');
  }
  return best;
}

/** תאימות לשם הישן (שימוש חיצוני אפשרי) */
export function matchSupplier(text, suppliers) {
  const m = matchEntity(text, suppliers, 'שם ספק');
  return m ? { supplier: m.candidate, confidence: m.confidence, reason: m.reason } : null;
}

/**
 * מתכנן קישור טקסט חופשי לרשומת-יעד (ספק/משווק): התאמה לרשומה קיימת
 * עם שם, או — בלי התאמה — מילוי שם ברשומה קיימת בלי שם, או יצירת
 * רשומה חדשה. מחזיר null אם אין טקסט לעבוד איתו.
 *   kind: 'link'   → targetId קיים, targetName קיים
 *   kind: 'fill'    → targetId קיים (רשומה בלי שם עד כה), newName למילוי
 *   kind: 'create' → אין targetId, newName לרשומה חדשה
 */
export function planLink(text, candidates, nameField) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  const m = matchEntity(trimmed, candidates, nameField);
  if (m) {
    return {
      kind: 'link',
      targetId: m.candidate.id,
      targetName: m.candidate[nameField] || 'ללא שם',
      confidence: m.confidence,
      reason: m.reason,
    };
  }
  const unnamed = (candidates || []).find((c) => c && !normalizeName(c[nameField]));
  if (unnamed) {
    return { kind: 'fill', targetId: unnamed.id, newName: trimmed, confidence: 1.0, reason: 'מילוי שם ברשומה קיימת בלי שם' };
  }
  return { kind: 'create', newName: trimmed, confidence: 1.0, reason: 'יצירת רשומה חדשה' };
}

/** צ׳ק: ספק דרך הוצאה מקושרת (ירושה, ביטחון 1.0) — אחרת התאמת שם ל"מוטב" */
export function planCheckSupplier(check, suppliers, expensesById) {
  for (const expId of idsOf(check['הוצאות'])) {
    const exp = expensesById.get(expId);
    const supId = idsOf(exp?.['ספקים'])[0];
    const sup = supId && suppliers.find((s) => s.id === supId);
    if (sup) {
      return { kind: 'link', targetId: sup.id, targetName: sup['שם ספק'] || 'ללא שם', confidence: 1.0, reason: 'דרך ההוצאה המקושרת' };
    }
  }
  return check['מוטב'] ? planLink(check['מוטב'], suppliers, 'שם ספק') : null;
}

const willApply = (plan) => !!plan && plan.confidence >= AUTO_THRESHOLD;

// ============================================================
// חישוב ההצעות — פונקציה טהורה (קלט: רשומות גולמיות כפי שמחזיר
// fetchRecords), ניתנת לבדיקה בלי Airtable. הכתיבה בפועל נפרדת (applyLinks).
// ============================================================
function expenseEntry(e, plan) {
  return {
    id: e.id,
    num: e['מספר הוצאה'] ?? null,
    text: e['ספק-AI'] || '',
    date: e['תאריך חשבונית-AI'] || e['תאריך העלאת החשבונית'] || '',
    amount: e['סכום כולל-AI'] ?? '',
    category: e['קטגוריית חשבונית-AI'] || '',
    plan,
    willApply: willApply(plan),
  };
}

function checkEntry(c, plan) {
  return {
    id: c.id,
    num: c['מספר צ׳ק'] ?? null,
    text: c['מוטב'] || '',
    amount: c['סכום צ׳ק'] ?? '',
    due: c['תאריך פירעון'] || '',
    plan,
    willApply: willApply(plan),
  };
}

function invoiceEntry(i, plan) {
  return {
    id: i.id,
    num: i['מספר חשבונית'] ?? null,
    text: i['משווק-AI'] || '',
    date: i['תאריך-AI'] || '',
    amount: i['סכום נטו'] ?? i['סכום ברוטו'] ?? '',
    plan,
    willApply: willApply(plan),
  };
}

function noteEntry(n, plan) {
  return {
    id: n.id,
    num: n['מספר תעודה'] ?? null,
    text: n['משווק-AI'] || '',
    date: n['תאריך תעודה'] || '',
    cartons: n['כמות קרטונים'] ?? '',
    plan,
    willApply: willApply(plan),
  };
}

/**
 * מחשב את כל ההצעות מתוך רשומות גולמיות. מחזיר
 * { expenses, checks, invoices, deliveryNotes } — כל כניסה עם plan/willApply.
 */
export function computeSuggestions({ suppliers = [], marketers = [], expenses = [], checks = [], invoices = [], deliveryNotes = [] }) {
  const expensesById = new Map(expenses.map((e) => [e.id, e]));

  const expenseOut = expenses
    .filter((e) => !idsOf(e['ספקים']).length && String(e['ספק-AI'] || '').trim())
    .map((e) => expenseEntry(e, planLink(e['ספק-AI'], suppliers, 'שם ספק')));

  const checkOut = checks
    .filter((c) => !idsOf(c['ספקים']).length && (String(c['מוטב'] || '').trim() || idsOf(c['הוצאות']).length))
    .map((c) => checkEntry(c, planCheckSupplier(c, suppliers, expensesById)))
    .filter((c) => c.text || c.plan);

  const invoiceOut = invoices
    .filter((i) => !idsOf(i['משווק']).length && String(i['משווק-AI'] || '').trim())
    .map((i) => invoiceEntry(i, planLink(i['משווק-AI'], marketers, 'שם משווק')));

  const noteOut = deliveryNotes
    .filter((n) => !idsOf(n['משווק']).length && String(n['משווק-AI'] || '').trim())
    .map((n) => noteEntry(n, planLink(n['משווק-AI'], marketers, 'שם משווק')));

  return { expenses: expenseOut, checks: checkOut, invoices: invoiceOut, deliveryNotes: noteOut };
}

/** תקציר מספרי להצגה מהירה (preview / תוצאה) */
export function summarizeSuggestions(groups, flagKey = 'willApply') {
  const count = (arr) => ({
    total: arr.length,
    [flagKey]: arr.filter((x) => x[flagKey]).length,
    needsReview: arr.filter((x) => x.plan && !x[flagKey]).length,
    noMatch: arr.filter((x) => !x.plan).length,
  });
  return {
    expenses: count(groups.expenses),
    checks: count(groups.checks),
    invoices: count(groups.invoices),
    deliveryNotes: count(groups.deliveryNotes),
  };
}

// ============================================================
// כתיבה בפועל — רק הצעות עם willApply=true. מטמון לפי שם מנורמל,
// כך ששתי הצעות (למשל הוצאה וצ׳ק) שמצביעות על ספק חדש בשם זהה
// ייצרו רשומה אחת בלבד, לא שתי רשומות כפולות.
// ============================================================
function makeCache() { return { filled: new Set(), created: new Map() }; }

async function resolveTargetId(plan, { targetTable, nameField, cache }) {
  if (plan.kind === 'link') return plan.targetId;
  if (plan.kind === 'fill') {
    if (!cache.filled.has(plan.targetId)) {
      await updateRecord(targetTable, plan.targetId, { [nameField]: plan.newName });
      await sleep(WRITE_GAP_MS);
      cache.filled.add(plan.targetId);
    }
    return plan.targetId;
  }
  // 'create'
  const key = normalizeName(plan.newName);
  if (cache.created.has(key)) return cache.created.get(key);
  const created = await createRecord(targetTable, { [nameField]: plan.newName });
  await sleep(WRITE_GAP_MS);
  cache.created.set(key, created.id);
  return created.id;
}

async function applyGroup(entries, { sourceTable, linkField, targetTable, nameField, cache }) {
  const out = [];
  for (const entry of entries) {
    if (!entry.plan || !entry.willApply) { out.push({ ...entry, applied: false }); continue; }
    try {
      const targetId = await resolveTargetId(entry.plan, { targetTable, nameField, cache });
      await updateRecord(sourceTable, entry.id, { [linkField]: [targetId] });
      await sleep(WRITE_GAP_MS);
      out.push({ ...entry, applied: true, linkedTo: targetId });
    } catch (e) {
      out.push({ ...entry, applied: false, error: e.message || String(e) });
    }
  }
  return out;
}

/** כתיבה בפועל של כל ההצעות (רק willApply=true). לא קוראת Airtable — מקבלת suggestions מוכן. */
export async function applyLinks(suggestions) {
  const supplierCache = makeCache();
  const marketerCache = makeCache();
  const expenses = await applyGroup(suggestions.expenses, { sourceTable: EXPENSES_TABLE, linkField: 'ספקים', targetTable: SUPPLIERS_TABLE, nameField: 'שם ספק', cache: supplierCache });
  const checks = await applyGroup(suggestions.checks, { sourceTable: CHECKS_TABLE, linkField: 'ספקים', targetTable: SUPPLIERS_TABLE, nameField: 'שם ספק', cache: supplierCache });
  const invoices = await applyGroup(suggestions.invoices, { sourceTable: INVOICES_TABLE, linkField: 'משווק', targetTable: MARKETERS_TABLE, nameField: 'שם משווק', cache: marketerCache });
  const deliveryNotes = await applyGroup(suggestions.deliveryNotes, { sourceTable: DELIVERY_TABLE, linkField: 'משווק', targetTable: MARKETERS_TABLE, nameField: 'שם משווק', cache: marketerCache });
  return { expenses, checks, invoices, deliveryNotes };
}

// ============================================================
// נקודת הכניסה היחידה שהשרת קורא לה: שולפת רשומות, מחשבת הצעות,
// ובמצב לא-dryRun כותבת בפועל ומנקה מטמון קריאה.
// ============================================================
export async function runAutoLink({ dryRun = true } = {}) {
  const [suppliers, marketers, expenses, checks, invoices, deliveryNotes] = await Promise.all([
    fetchRecords(SUPPLIERS_TABLE, {}),
    fetchRecords(MARKETERS_TABLE, {}),
    fetchRecords(EXPENSES_TABLE, {}),
    fetchRecords(CHECKS_TABLE, {}),
    fetchRecords(INVOICES_TABLE, {}),
    fetchRecords(DELIVERY_TABLE, {}),
  ]);
  const suggestions = computeSuggestions({ suppliers, marketers, expenses, checks, invoices, deliveryNotes });

  if (dryRun) {
    return { dryRun: true, ...suggestions, summary: summarizeSuggestions(suggestions, 'willApply') };
  }

  // הכתיבה בפועל — invalidateReads (מטמון הקריאה) באחריות הקורא
  // (route ב-server.js), באותו דפוס כמו שאר נקודות הקצה בקובץ הזה.
  const applied = await applyLinks(suggestions);
  return { dryRun: false, ...applied, summary: summarizeSuggestions(applied, 'applied') };
}
