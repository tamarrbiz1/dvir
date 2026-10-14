// ============================================================
// ייבוא דוחות ריסוסים לטיפולים — 2026-10-06
// ------------------------------------------------------------
// זרימת ההעלאה: המשתמש מעלה צילום/PDF של דוח ריסוסים → נוצרת רשומה
// ב"דוחות ריסוסים" → אוטומציית Make מנתחת את הקובץ וכותבת לשדה
// "Attachment Summary" מערך JSON של שורות (סוג טיפול, תאריך/טווח,
// מבנים, גידול/זן, חומר, מינון). השורות האלה הופכות לרשומות "ריסוסים"
// ביומן הטיפולים:
//
// ⚠️ **"סוג טיפול" מול "סוג מרסס" (משימה AP, 14.10.2026)** — הסוג מהדוח
// ("ריסוס"/"הגמעה") נכתב לשדה **"סוג טיפול"** (singleSelect). השדה
// **"סוג מרסס"** הוא טקסט לשם המכשיר ("מרסס א") והייבוא לא כותב אליו
// לעולם. מהסוג נגזרת גם ברירת המחדל של "בסיס מינון" — ר'
// shared/treatment-defaults.js, המקור המשותף ללקוח ולשרת.
//
//   importSprayReport(reportId)  — שורה בדוח → רשומת "ריסוסים" אחת
//   sprayReportsHistory()        — היסטוריית הדוחות + מצב הניתוח/הייבוא
//   scheduleSprayReportImport()  — אחרי העלאה: ממתין לניתוח ומסמן "ממתין לאישור"
//   startSprayImportSweep()      — איסוף מחזורי: אותו סימון לדוחות שנפלו בין הכיסאות
//
// ⚠️ **אין ייבוא אוטומטי — החלטת תמר, 14.10.2026 (משימה AN).** עד 14.10
// שתי הפונקציות האחרונות ייבאו בעצמן את כל שורות הדוח ליומן ברגע
// שהניתוח הסתיים, ולכן הופיעו ביומן טיפולים שהלקוחה לא אישרה. מעתה הן
// **רק** ממתינות לניתוח ומסמנות את הדוח "ממתין לאישור" (ר'
// isAwaitingApproval). השמות נשארו — הם מוזכרים בהערות ובמשימות לרוחב
// הקוד — אבל אף אחת מהן לא יוצרת יותר שום רשומת "ריסוסים". היצירה
// קורית **רק** ב-importSprayReport, כלומר רק מלחיצה מפורשת של המנהלת
// הראשית על "ייבא לטיפולים" (POST /api/spray-reports/:id/import,
// requireOwner).
//
// סמן המקור: כל טיפול מיובא מתחיל ב"הערות" בשורה
//   [מדוח ריסוסים #<מספור אוטומטי>] שורה <n>
// זה מה שגורם ל-UI (treatmentSource ב-TreatmentsPage.jsx) להציג "מדוח",
// וזה גם מפתח האידמפוטנטיות — ייבוא חוזר של אותו דוח לא יוצר כפילויות.
// ============================================================
import { getBase, fetchRecords, createRecord, deleteRecord, getMeta } from './airtable.js';
import { treatmentTypeOption, defaultBasisForType, matchChoice } from '../../shared/treatment-defaults.js';

export const REPORTS_TABLE = 'דוחות ריסוסים';
export const TREATMENTS_TABLE = 'ריסוסים';
const MATERIALS_TABLE = 'חומרי ריסוס';
const STRUCTURES_TABLE = 'מבנים';
const PLANS_TABLE = 'תוכניות שתילה';
const CROPS_TABLE = 'גידולים';

const SUMMARY_FIELD = 'Attachment Summary';
const REPORT_FILE_FIELD = 'דוח ריסוסים';
const REPORT_NUMBER_FIELD = 'מספור אוטומטי';
const REPORT_UPLOADED_FIELD = 'העלאה אחרונה של הקובץ';
const DOSAGE_FIELD = 'מינון '; // שם השדה החי כולל רווח בסוף — לא טעות

// אותה תבנית כמו TEST_RECORD_PATTERN ב-server.js: רשומות בדיקה (qa-check.mjs)
// לעולם לא מיובאות אוטומטית ולא מוצגות בהיסטוריה למשתמש אמיתי.
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}|\bPERF-TEST\b/;
export const isTestRecord = (rec) => TEST_RECORD_PATTERN.test(JSON.stringify(rec));

/**
 * אפשרויות שדה בחירה מהמטא של Airtable (משימה AP). כתיבת ערך שאינו
 * ברשימה נדחית, ולכן "סוג טיפול" ו"בסיס מינון" נכתבים רק אחרי התאמה
 * לאפשרות קיימת. כשל בקריאת המטא לא מפיל ייבוא — מחזיר [] ואז
 * matchChoice מחזיר את הערך הקנוני כמו שהוא.
 */
async function selectChoices(table, field) {
  try {
    const meta = await getMeta();
    const t = meta.find((x) => x.name === table);
    const f = t?.fields?.find((x) => x.name === field);
    return (f?.options?.choices || []).map((c) => c.name);
  } catch (e) {
    console.warn(`[spray-import] לא ניתן לקרוא את אפשרויות "${field}": ${e.message}`);
    return [];
  }
}

export const markerOf = (number) => `[מדוח ריסוסים #${number}]`;
const MARKER_RE = /\[מדוח ריסוסים #(\d+)\] שורה (\d+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');
const normSpaces = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normName = (s) => normSpaces(s).toLowerCase().replace(/["'״׳]/g, '');

// ============================================================
// פענוח "Attachment Summary"
// ------------------------------------------------------------
// Make כותב מחרוזת JSON; לפעמים עטופה ב-```json, לפעמים "[]" כשלא זוהו
// שורות, ולפעמים השדה עדיין ריק (הניתוח רץ). מחזיר status + rows.
// ============================================================
export function parseSummary(raw) {
  if (raw == null) return { status: 'pending', rows: [] };
  if (typeof raw === 'object') {
    // שדה AI/אובייקט מצב — לא מחרוזת תוצאה אמיתית
    if (typeof raw.value === 'string') return parseSummary(raw.value);
    return Array.isArray(raw) ? fromArray(raw) : { status: 'pending', rows: [] };
  }
  const text = String(raw).trim();
  if (!text) return { status: 'pending', rows: [] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { /* נופל ל-invalid למטה */ }
    }
  }
  if (parsed === undefined) return { status: 'invalid', rows: [] };
  if (!Array.isArray(parsed)) {
    // לפעמים המודל עוטף: { "rows": [...] } / { "data": [...] }
    const inner = parsed && typeof parsed === 'object' ? Object.values(parsed).find(Array.isArray) : null;
    if (!inner) return { status: 'invalid', rows: [] };
    parsed = inner;
  }
  return fromArray(parsed);
}
function fromArray(arr) {
  const rows = arr.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  return rows.length ? { status: 'ready', rows } : { status: 'empty', rows: [] };
}

// ============================================================
// תאריכים: "dd/mm/yyyy", "dd/mm/yyyy-dd/mm/yyyy", "dd.mm.yyyy", "yyyy-mm-dd"
// (גם טווח עם "–" / "עד"). מחזיר { start: 'YYYY-MM-DD', end } או null.
// ============================================================
const DATE_TOKEN_RE = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g;
export function parseDateRange(text) {
  const s = String(text ?? '');
  const found = [];
  for (const m of s.matchAll(DATE_TOKEN_RE)) {
    const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) continue;
    found.push(`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`);
    if (found.length === 2) break;
  }
  if (!found.length) return null;
  let [start, end] = [found[0], found[1] || found[0]];
  if (end < start) [start, end] = [end, start];
  return { start, end };
}
const toDMY = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

// ============================================================
// מינון: "40" → 40; "1 ליטר לדונם" → 1 + בסיס "לדונם" + הטקסט המלא בהערות;
// "50 סמ"ק ל-100 ליטר" → 50 + "ל-100 ליטר". מספר לא-חד-משמעי → בלי ערך.
// ============================================================
// מספר בודד: פסיק עם **בדיוק** 3 ספרות ובלי נקודה בנוסף → מפריד אלפים
// ("40,000" → 40000, לא 40.000) — אחרת (נקודה, או פסיק עם 1-2 ספרות) → עשרוני
// ("1,5"/"2.5" → 1.5/2.5). בדיקת-קצה 2026-10-06: בלי זה "40,000" (ארבעים אלף,
// מופיע בדוחות אמיתיים) היה הופך בשקט ל-40.
function parseNumToken(raw) {
  const m = /^(-?\d+),(\d{3})$/.exec(raw);
  if (m) return Number(m[1] + m[2]);
  return Number(raw.replace(',', '.'));
}
export function parseDosage(text) {
  const s = normSpaces(text);
  if (!s) return { value: null, basis: null, note: null };
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return { value: parseNumToken(s), basis: null, note: null };
  let basis = null;
  // (?!\d) חשוב: "ל-1000 ליטר" לא אמור להיתפס כ"ל-100 ליטר" (מצא-בדיקה
  // 2026-10-06 — בלי העוגן, "ל-100" הוא תת-מחרוזת של "ל-1000" ומתאים בטעות)
  if (/100\s*ליטר/.test(s) || /ל-?100(?!\d)/.test(s)) basis = 'ל-100 ליטר';
  else if (/לדונם|דונם/.test(s)) basis = 'לדונם';
  else if (/לליטר|ל-?1\s*ליטר|לכל ליטר/.test(s)) basis = 'לליטר';
  else if (/%|אחוז/.test(s)) basis = 'אחוז';
  // מורידים את ביטוי הבסיס ("ל-100 ליטר", "ל-1 ליטר") לפני חיפוש המספר, כדי שלא ייחשב כמינון
  const stripped = s.replace(/ל-?\s*100\s*ליטר/g, ' ').replace(/ל-?\s*1\s*ליטר/g, ' ');
  const nums = stripped.match(/\d+(?:[.,]\d+)?/g) || [];
  const value = nums.length === 1 ? parseNumToken(nums[0]) : null;
  return { value, basis, note: s };
}

// ============================================================
// פתרון מבנים: "מבנה 3" / "3" / "מבנה  3 " → הרשומה שמספר המבנה שלה "מבנה 3".
// "מבנה 9" לבד לא יתאים ל"מבנה 9: חממה ישנה" (כמה מועמדים) → לא זוהה.
// ============================================================
function structureIndex(structures) {
  const byFull = new Map();
  const byNumber = new Map();
  for (const s of structures) {
    const name = normSpaces(s['מספר מבנה']);
    if (!name) continue;
    byFull.set(normName(name), s.id);
    const numKey = normName(name.replace(/^מבנה\s*/, ''));
    if (numKey) byNumber.set(numKey, s.id);
  }
  return (rawName) => {
    const name = normName(rawName);
    if (!name) return null;
    if (byFull.has(name)) return byFull.get(name);
    const numKey = name.replace(/^מבנה\s*/, '');
    if (byNumber.has(numKey)) return byNumber.get(numKey);
    // "מבנה 3" כשהרשומה היא "3" בלבד, או "3" כשהרשומה היא "מבנה 3"
    if (byFull.has(`מבנה ${numKey}`)) return byFull.get(`מבנה ${numKey}`);
    return null;
  };
}

// ============================================================
// פתרון הגידול מתוכנית השתילה (הוראת תמר 7.10.2026)
// ------------------------------------------------------------
// "בגידול אני רוצה שיופיע הגידול שקיים באותה תקופה לפי תוכנית
// השתילה המתאימה". שורת דוח נוקבת במבנה ובתאריך; הגידול אינו בהכרח
// כתוב בדוח. לכן מחפשים את תוכנית השתילה של אותו מבנה שטווח הקטיף
// שלה (המעודכן אם קיים, אחרת המקורי) מכיל את תאריך הריסוס.
// מחזירים גם את מזהה התוכנית — הוא נשמר בשדה 'תוכנית שתילה' (טקסט
// ב-Airtable, בדיוק כמו בטופס הידני) וכך מסך הטיפולים מציג גידול+זן.
// ============================================================
function cropResolver(plans, crops, structureIds) {
  // שם גידול לפי מזהה רשומת "גידולים"; נפילה-לאחור ל"סוג גידול" (lookup)
  const cropNameById = new Map(crops.map((c) => [c.id, normSpaces(c['שם גידול'])]));
  const wanted = new Set(structureIds);
  const candidates = plans
    .map((plan) => {
      const planStructs = (Array.isArray(plan['מבנה']) ? plan['מבנה'] : []).map((x) => (x && typeof x === 'object' ? x.id : String(x)));
      const cropId = (Array.isArray(plan['גידולים']) ? plan['גידולים'] : []).map((x) => (x && typeof x === 'object' ? x.id : String(x)))[0] || null;
      // הטווח המעודכן גובר, ותחילת/סוף קטיף קודמים לשתילה בשם
      const from = plan['תחילת קטיף מעודכנת'] || plan['תחילת קטיף מקורית'] || plan['תחילת שתילה מעודכנת'] || plan['תחילת שתילה מקורית'] || null;
      const to = plan['סוף קטיף מעודכן'] || plan['סוף קטיף מקורי'] || plan['סוף שתילה מעודכן'] || plan['סוף שתילה מקורי'] || null;
      const name = cropId ? (cropNameById.get(cropId) || '') : '';
      return { id: plan.id, number: plan['מספר תוכנית'], structs: planStructs, cropId, name: name || normSpaces([].concat(plan['סוג גידול'] || [])[0]), from, to };
    })
    .filter((c) => c.name && c.structs.some((id) => wanted.has(id)));
  const dayKey = (d) => (d ? String(d).slice(0, 10) : null);
  return (date) => {
    const day = dayKey(date);
    if (!day) return null;
    for (const c of candidates) {
      if (c.from && c.to && c.from <= day && day <= c.to) return c;
    }
    return null;
  };
}

// ============================================================
// פתרון חומרים: התאמה מדויקת (ללא רגישות לרווחים/אותיות), ואז "מכיל"
// כשיש מועמד יחיד. אין התאמה → יוצרים חומר חדש (הלקוחה רוצה שכל מה
// שבדוח ינחת ביומן), וזוכרים אותו לשורות הבאות של אותו ייבוא.
// ============================================================
function materialResolver(materials, { dryRun }) {
  const list = materials.map((m) => ({ id: m.id, name: normSpaces(m['שם חומר']), key: normName(m['שם חומר']) })).filter((m) => m.key);
  const created = [];
  const pending = new Map(); // key -> שם (ב-dryRun: חומרים ש"היו נוצרים")
  return {
    created,
    async resolve(rawName) {
      const name = normSpaces(rawName);
      const key = normName(name);
      if (!key) return { id: null, name: '', isNew: false };
      const exact = list.find((m) => m.key === key);
      if (exact) return { id: exact.id, name: exact.name, isNew: false };
      const contains = list.filter((m) => m.key.includes(key) || key.includes(m.key));
      if (contains.length === 1) return { id: contains[0].id, name: contains[0].name, isNew: false };
      if (pending.has(key)) return { id: pending.get(key), name, isNew: true };
      if (dryRun) { pending.set(key, null); created.push(name); return { id: null, name, isNew: true }; }
      const rec = await createRecord(MATERIALS_TABLE, { 'שם חומר': name });
      list.push({ id: rec.id, name, key });
      pending.set(key, rec.id);
      created.push(name);
      return { id: rec.id, name, isNew: true };
    },
  };
}

/** שורות שכבר יובאו מדוח מסוים: Set של מספרי שורה (לפי הסמן בהערות) */
async function importedLinesOf(number) {
  const existing = await fetchRecords(TREATMENTS_TABLE, {
    filterByFormula: `FIND('${markerOf(number)}', {הערות})`,
    fields: ['הערות'],
  });
  const lines = new Set();
  for (const t of existing) {
    const m = MARKER_RE.exec(String(t['הערות'] || ''));
    if (m && Number(m[1]) === Number(number)) lines.add(Number(m[2]));
  }
  return { lines, count: existing.length };
}

/**
 * בניית שדות רשומת "ריסוסים" משורת דוח אחת (ללא כתיבה).
 * מיוצא בשביל qa-check.mjs — כל התלויות מוזרקות, ולכן הבדיקה טהורה
 * (בלי Airtable ובלי Make).
 */
export async function buildRow(row, { line, number, resolveStructure, materials, attachment, cropResolverFor, typeChoices = [], basisChoices = [] }) {
  const warnings = [];
  const notes = [`${markerOf(number)} שורה ${line}`];
  const type = normSpaces(row['סוג טיפול']);
  const location = normSpaces(row['מיקום']);
  const crop = normSpaces(row['גידול']);
  const variety = normSpaces(row['זן']);
  const sprayNo = normSpaces(row['מספר ריסוס']);
  if (type) notes.push(`סוג טיפול: ${type}`);
  if (location) notes.push(`מיקום: ${location}`);
  if (crop || variety) notes.push(`גידול/זן: ${[crop, variety].filter(Boolean).join(' · ')}`);
  if (sprayNo) notes.push(`מספר ריסוס: ${sprayNo}`);

  const range = parseDateRange(row['תאריך']);
  if (!range) warnings.push('תאריך לא זוהה');

  const structNames = (Array.isArray(row['מבנה']) ? row['מבנה'] : String(row['מבנה'] ?? '').split(/[,;]/))
    .map(normSpaces).filter(Boolean);
  const structureIds = [];
  const unresolvedStructures = [];
  for (const n of structNames) {
    const id = resolveStructure(n);
    if (id) { if (!structureIds.includes(id)) structureIds.push(id); } else unresolvedStructures.push(n);
  }
  for (const n of unresolvedStructures) notes.push(`מבנה לא זוהה: ${n}`);
  if (unresolvedStructures.length) warnings.push(`מבנה לא זוהה: ${unresolvedStructures.join(', ')}`);

  const material = await materials.resolve(row['חומר']);
  if (!material.name) warnings.push('חומר חסר בשורה');

  const dosage = parseDosage(row['מינון']);
  if (dosage.note) notes.push(`מינון מהדוח: ${dosage.note}`);
  if (dosage.note && dosage.value == null) warnings.push('מינון לא חד-משמעי — נשמר כטקסט בהערות');

  // ---------- סוג טיפול ובסיס מינון (משימה AP, 14.10.2026) ----------
  // 1. "סוג טיפול" הוא שדה אמיתי ב"ריסוסים" (singleSelect) — הסוג מהדוח
  //    נכתב אליו אחרי התאמה לאפשרות קיימת. לא זוהה → לא כותבים, והסוג
  //    הגולמי נשאר בהערות ("סוג טיפול: X") כמו קודם.
  // 2. בסיס מינון: אם **הדוח עצמו** נקב בבסיס בטקסט המינון ("1 ליטר
  //    לדונם") — הוא גובר, הוא המידע המדויק. אחרת ברירת המחדל לפי הסוג
  //    (AP-1: ריסוס → ל-100 ליטר, הגמעה → לדונם). אחרת ריק.
  const treatmentType = treatmentTypeOption(type, typeChoices);
  if (type && !treatmentType) warnings.push(`סוג הטיפול "${type}" אינו אפשרות בשדה "סוג טיפול" — נשמר בהערות בלבד`);
  const basisFromReport = dosage.basis ? matchChoice(dosage.basis, basisChoices) : null;
  const basisDefault = basisFromReport ? null : defaultBasisForType(type, basisChoices);
  const basis = basisFromReport || basisDefault;
  const basisSource = basisFromReport ? 'report' : (basisDefault ? 'default' : null);

  if (range && range.end !== range.start) notes.push(`תאריך סיום: ${toDMY(range.end)}`);

  // דוח ריסוסים מתעד ריסוס שתוכנן/בוצע בשטח, אבל במערכת הוא נוצר כהצעה
  // שממתינה לאישור תמר — ולכן 'מתוכנן' ובוצע=false. היא תסמן "בוצע" בעצמה
  // אחרי שתאמת. (הוראת תמר 7.10.2026)
  // הגידול מתוכנית השתילה של אותו מבנה שטווח הקטיף שלה מכיל את תאריך
  // הריסוס (הוראת תמר 7.10). אם הרשומה זוהתה — נשמר מזהה התוכנית בשדה
  // 'תוכנית שתילה', ומסך הטיפולים יגזור ממנו גידול+זן בעצמו. הגידול
  // שבדוח עצמו נשאר בהערות כמידע גולמי.
  const matchedPlan = range && cropResolverFor && structureIds.length ? cropResolverFor(structureIds)(range.start) : null;
  const fields = {
    'סטטוס': 'מתוכנן',
    'בוצע': false,
    'הערות': notes.join('\n'),
  };
  if (range) fields['תאריך'] = range.start;
  if (structureIds.length) fields['מבנה'] = structureIds;
  if (material.id) fields['חומר ריסוס'] = [material.id];
  if (dosage.value != null) fields[DOSAGE_FIELD] = dosage.value;
  if (basis) fields['בסיס מינון'] = basis;
  if (treatmentType) fields['סוג טיפול'] = treatmentType;
  // ⚠️ "סוג מרסס" — הוראת תמר (AP-3.1): **"תשאיר ריק תמיד** (שם כותבים את
  // שם המכשיר)". עד 14.10.2026 נכתב לשם סוג הטיפול מהדוח, כי לא היה שדה
  // "סוג טיפול" — עכשיו יש, והסוג עובר לשם.
  //
  // למה **כן** כותבים אליו מחרוזת ריקה, ולא פשוט מדלגים עליו: לשדה
  // `סוג מרסס` ב-Airtable יש **ערך ברירת-מחדל "מרסס א"** (אומת בכתיבת
  // רשומת-QA ב-14.10 — זה גם המקור ל-19 הטיפולים המיובאים שנושאים אותו
  // היום, ולא הקוד). בלי כתיבה מפורשת, Airtable היה ממלא לכל טיפול מיובא
  // שם-מכשיר שאף אחד לא קבע — בדיוק המידע השגוי שההוראה באה למנוע.
  // אם תמר תעדיף להסיר את ברירת-המחדל בשדה עצמו (אין ל-PAT הרשאת
  // סכמה), אפשר להחזיר לכאן דילוג פשוט — ההתנהגות תהיה זהה.
  fields['סוג מרסס'] = '';
  if (matchedPlan) fields['תוכנית שתילה'] = matchedPlan.id;
  if (attachment) fields[REPORT_FILE_FIELD] = [{ url: attachment.url, filename: attachment.filename || 'דוח ריסוסים' }];

  return {
    line, fields, warnings,
    summary: {
      line, type, treatmentType, date: range?.start || null, endDate: range && range.end !== range.start ? range.end : null,
      structures: structureIds.length, structureNames: structNames, unresolvedStructures,
      material: material.name, materialIsNew: material.isNew,
      dosage: dosage.value, basis, basisSource, dosageText: dosage.note, crop, variety, sprayNo, location,
      cropFromPlan: matchedPlan ? matchedPlan.name : null, planNumber: matchedPlan?.number ?? null,
      warnings,
    },
  };
}

/** יצירה במנות של 10 עם השהיה קצרה (Airtable: 5 בקשות/שנייה); כשל בצרופה-לפי-URL → ניסיון חוזר בלי הצרופה */
async function createInBatches(fieldsList) {
  const base = getBase();
  let created = 0;
  let attachmentDropped = false;
  for (let i = 0; i < fieldsList.length; i += 10) {
    const chunk = fieldsList.slice(i, i + 10);
    try {
      const out = await base(TREATMENTS_TABLE).create(chunk.map((fields) => ({ fields })));
      created += out.length;
    } catch (e) {
      if (!chunk.some((f) => f[REPORT_FILE_FIELD])) throw e;
      // הסמן בהערות מספיק כדי שה-UI יזהה "מדוח" — הצרופה היא נוחות בלבד
      const bare = chunk.map((f) => { const c = { ...f }; delete c[REPORT_FILE_FIELD]; return { fields: c }; });
      const out = await base(TREATMENTS_TABLE).create(bare);
      created += out.length;
      attachmentDropped = true;
    }
    if (i + 10 < fieldsList.length) await sleep(250);
  }
  return { created, attachmentDropped };
}

/**
 * ייבוא דוח אחד לטיפולים. אידמפוטנטי: שורות שכבר יובאו (לפי "שורה n"
 * בסמן) מדולגות. dryRun — מחשב ומחזיר מה היה נוצר, בלי לכתוב כלום
 * (גם לא חומרים חדשים).
 */
export async function importSprayReport(reportId, { dryRun = false } = {}) {
  const base = getBase();
  const rec = await base(REPORTS_TABLE).find(reportId);
  const number = rec.fields[REPORT_NUMBER_FIELD];
  const attachments = Array.isArray(rec.fields[REPORT_FILE_FIELD]) ? rec.fields[REPORT_FILE_FIELD] : [];
  const parsed = parseSummary(rec.fields[SUMMARY_FIELD]);
  const result = {
    reportId, number, dryRun, status: parsed.status, created: 0, skipped: 0,
    unresolvedStructures: [], createdMaterials: [], rows: [], attachmentDropped: false,
  };
  if (parsed.status === 'pending' && !attachments.length) result.status = 'no-file';
  if (parsed.status !== 'ready') return result;

  const [structures, materialsList, plans, cropsList, imported, typeChoices, basisChoices] = await Promise.all([
    fetchRecords(STRUCTURES_TABLE, { fields: ['מספר מבנה'] }),
    fetchRecords(MATERIALS_TABLE, { fields: ['שם חומר'] }),
    fetchRecords(PLANS_TABLE, { fields: ['מספר תוכנית', 'מבנה', 'גידולים', 'סוג גידול',
      'תחילת שתילה מקורית', 'סוף שתילה מקורי', 'תחילת קטיף מקורית', 'סוף קטיף מקורי',
      'תחילת שתילה מעודכנת', 'סוף שתילה מעודכן', 'תחילת קטיף מעודכנת', 'סוף קטיף מעודכן'] }),
    fetchRecords(CROPS_TABLE, { fields: ['שם גידול'] }),
    importedLinesOf(number),
    selectChoices(TREATMENTS_TABLE, 'סוג טיפול'),
    selectChoices(TREATMENTS_TABLE, 'בסיס מינון'),
  ]);
  const resolveStructure = structureIndex(structures);
  const materials = materialResolver(materialsList, { dryRun });
  const attachment = attachments[0] ? { url: attachments[0].url, filename: attachments[0].filename } : null;

  const toCreate = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const line = i + 1;
    if (imported.lines.has(line)) {
      result.skipped++;
      result.rows.push({ line, status: 'exists' });
      continue;
    }
    const built = await buildRow(parsed.rows[i], {
      line, number, resolveStructure, materials, attachment, typeChoices, basisChoices,
      cropResolverFor: (ids) => cropResolver(plans, cropsList, ids),
    });
    for (const u of built.summary.unresolvedStructures) if (!result.unresolvedStructures.includes(u)) result.unresolvedStructures.push(u);
    if (!built.fields['תאריך']) {
      // בלי תאריך הטיפול לא יופיע ביומן — לא יוצרים רשומה "עיוורת"
      result.skipped++;
      result.rows.push({ ...built.summary, status: 'no-date' });
      continue;
    }
    toCreate.push(built);
    result.rows.push({ ...built.summary, status: dryRun ? 'would-create' : 'created' });
  }
  result.createdMaterials = materials.created;

  if (dryRun || !toCreate.length) {
    result.wouldCreate = toCreate.length;
    result.status = 'imported';
    return result;
  }
  const { created, attachmentDropped } = await createInBatches(toCreate.map((b) => b.fields));
  // הדוח יצא ממצב "ממתין לאישור" (או ש"ממתין" שלו השתנה) — שהסריקה
  // המחזורית תכריז עליו שוב רק אם באמת נשארו שורות לא-מיובאות.
  announcedAwaiting.delete(reportId);
  result.created = created;
  result.attachmentDropped = attachmentDropped;
  result.status = 'imported';
  console.log(`[spray-import] דוח #${number}: נוצרו ${created} טיפולים, ${result.skipped} דולגו, ${materials.created.length} חומרים חדשים${attachmentDropped ? ' (הצרופה לא הועתקה)' : ''}`);
  return result;
}

// ============================================================
// היסטוריית הדוחות — לטאב "דוחות" במסך הטיפולים
// ============================================================
export const DELETED_REPORT_NOTE_RE = /^⚠ הדוח המקורי נמחק \(/m;

/**
 * ההערה שנוספת לטיפול שהדוח שממנו הוא נוצר נמחק. פונקציה טהורה —
 * אידמפוטנטית: אם השורה כבר קיימת בהערות, מוחזר הטקסט ללא שינוי.
 * @param {string} notes הערות הטיפול כמו שהן ב-Airtable
 * @param {Date} when מועד המחיקה
 */
export function deletedReportNote(notes, when = new Date()) {
  const current = String(notes ?? '').trim();
  if (DELETED_REPORT_NOTE_RE.test(current)) return current;
  const stamp = `${pad2(when.getDate())}.${pad2(when.getMonth() + 1)}.${when.getFullYear()}`;
  const line = `⚠ הדוח המקורי נמחק (${stamp})`;
  return current ? `${current}\n${line}` : line;
}

/**
 * מחיקת דוח ריסוסים — **רשומת הדוח בלבד**.
 *
 * ⚠️ **שינוי התנהגות, 14.10.2026 (משימה AN) — החלטת תמר:** "בהערה
 * כשמוחקים את הדוח ברשימה יכתב: המחיקה לא תגרום למחיקת טיפולים
 * שנוצרו". ההוראה מ-7.10.2026 (מחיקת הדוח מוחקת גם את הטיפולים שיובאו
 * ממנו, חוץ מאלה שסומנו "בוצע") **הוחלפה** — מחיקת דוח היא מעתה
 * מחיקה של המסמך, לא ביטול של עבודה שכבר נרשמה ביומן.
 *
 * מה קורה: רשומת הדוח נמחקת; כל רשומת "ריסוסים" שההערות שלה נושאות
 * את הסמן [מדוח ריסוסים #N] **נשארת ביומן כמו שהיא**, ומקבלת בהערות
 * את השורה "⚠ הדוח המקורי נמחק (DD.MM.YYYY)" — אותו מנגנון שהיה קיים
 * לטיפולים שסומנו "בוצע" — כדי שלא יאבד המקור.
 *
 * מחזיר { ok, number, keptTreatments, noted, errors } לפידבק ב-UI.
 */
export async function deleteSprayReport(reportId) {
  const base = getBase();
  const rec = await base(REPORTS_TABLE).find(reportId);
  const number = rec.fields[REPORT_NUMBER_FIELD];
  const marker = number != null ? markerOf(number) : null;

  // 1. איסוף הטיפולים שיובאו מהדוח הזה (לא כדי למחוק — כדי לסמן)
  let treatments = [];
  if (marker) {
    treatments = await fetchRecords(TREATMENTS_TABLE, {
      filterByFormula: `FIND('${marker}', {הערות})`,
      fields: ['הערות', 'בוצע', 'תאריך'],
    });
  }

  // 2. מנקים את הדוח קודם, כדי שתגובת ההצלחה למשתמשת לא תהיה תלויה
  //    בסימון ההערות (שהוא תיעוד, לא הפעולה שהיא ביקשה).
  await deleteRecord(REPORTS_TABLE, reportId);
  announcedAwaiting.delete(reportId);

  // 3. ההערה "הדוח המקורי נמחק" לכל טיפול שיובא ממנו — במנות של 10
  //    (Airtable: 10 רשומות לבקשה).
  const when = new Date();
  const errors = [];
  let noted = 0;
  for (let i = 0; i < treatments.length; i += 10) {
    const chunk = treatments.slice(i, i + 10);
    const updates = chunk.map((t) => ({ id: t.id, fields: { 'הערות': deletedReportNote(t['הערות'], when) } }));
    try {
      await base(TREATMENTS_TABLE).update(updates);
      noted += chunk.length;
    } catch (e) {
      errors.push(e.message);
      console.error(`[spray-delete] סימון "הדוח המקורי נמחק" לטיפולים מדוח #${number} נכשל בחלק מהמנות: ${e.message}`);
    }
    if (i + 10 < treatments.length) await sleep(250);
  }

  console.log(`[spray-delete] דוח #${number ?? reportId} נמחק: ${treatments.length} טיפולים נשארו ביומן, ${noted} סומנו${errors.length ? `, ${errors.length} שגיאות סימון` : ''}`);
  return { ok: true, number, keptTreatments: treatments.length, noted, errors };
}

/**
 * "ממתין לאישור" (משימה AN, 14.10.2026) — פונקציה טהורה על שורת
 * היסטוריה. דוח ממתין לאישור כשהניתוח הסתיים בהצלחה (`ready`), יש בו
 * שורות, ולא כולן יובאו ליומן. זה **המצב הנגזר** ולא שדה ב-Airtable:
 * אין הרשאת סכמה ליצור שדה, והמידע קיים ממילא (הסמן בהערות של
 * הטיפולים הוא מקור-האמת ל"מה כבר יובא").
 * @param {{summary?: string, rows?: number, imported?: number}} report
 */
export function isAwaitingApproval(report) {
  if (!report || report.summary !== 'ready') return false;
  const rows = Number(report.rows) || 0;
  return rows > 0 && (Number(report.imported) || 0) < rows;
}

export async function sprayReportsHistory() {
  const [reports, marked] = await Promise.all([
    fetchRecords(REPORTS_TABLE, {}),
    fetchRecords(TREATMENTS_TABLE, { filterByFormula: `FIND('[מדוח ריסוסים #', {הערות})`, fields: ['הערות'] }),
  ]);
  const importedByNumber = new Map(); // מספר דוח -> Set של שורות שיובאו
  for (const t of marked) {
    const m = MARKER_RE.exec(String(t['הערות'] || ''));
    if (!m) continue;
    const n = Number(m[1]);
    if (!importedByNumber.has(n)) importedByNumber.set(n, new Set());
    importedByNumber.get(n).add(Number(m[2]));
  }
  return reports.map((r) => {
    const number = r[REPORT_NUMBER_FIELD];
    const file = Array.isArray(r[REPORT_FILE_FIELD]) && r[REPORT_FILE_FIELD][0] ? r[REPORT_FILE_FIELD][0] : null;
    const parsed = parseSummary(r[SUMMARY_FIELD]);
    let summary = parsed.status;
    if (summary === 'pending' && !file) summary = 'no-file';
    let from = null, to = null;
    for (const row of parsed.rows) {
      const range = parseDateRange(row['תאריך']);
      if (!range) continue;
      if (!from || range.start < from) from = range.start;
      if (!to || range.end > to) to = range.end;
    }
    const row = {
      id: r.id,
      number,
      uploadedAt: r[REPORT_UPLOADED_FIELD] || null,
      file: file ? { filename: file.filename, url: file.url, type: file.type, thumbnail: file.thumbnails?.large?.url || file.thumbnails?.small?.url || null } : null,
      summary, // pending | no-file | empty | invalid | ready
      rows: parsed.rows.length,
      imported: importedByNumber.get(Number(number))?.size || 0,
      range: from ? { from, to } : null,
      isTest: isTestRecord(r),
    };
    // משימה AN: המסך מציג "ממתין לאישור — N שורות" ולא מייבא לבד
    return { ...row, awaitingApproval: isAwaitingApproval(row) };
  }).sort((a, b) => (b.number || 0) - (a.number || 0));
}

// ============================================================
// המתנה לניתוח וסימון "ממתין לאישור" (משימה AN, 14.10.2026)
// ------------------------------------------------------------
// ⚠️ **שתי הפונקציות כאן לא מייבאות כלום.** עד 14.10 הן קראו ל-
// importSprayReport בעצמן, וכך נוצרו ביומן טיפולים שהלקוחה לא אישרה.
// מה שנשאר מהן:
// 1) אחרי העלאה: Make מנתח ברקע (שניות עד דקות) — בודקים כל 15 שניות
//    עד 10 דקות, וברגע שהסיכום מתמלא מסמנים את הדוח "ממתין לאישור"
//    ומנקים את מטמון-הקריאה (onChange), כדי שהתג יופיע במסך מיד.
// 2) איסוף מחזורי (כל 10 דקות + ~60 שניות אחרי עליית השרת): דוח שהניתוח
//    שלו מוכן ולא כל שורותיו יובאו — מסומן "ממתין לאישור". זו רשת
//    ביטחון למקרה שהפולינג של ההעלאה נקטע (restart/deploy מוחק אותו —
//    הוא חי בזיכרון התהליך).
//
// תאריך-הסף (cutoff) שהיה שמור ב-server/data/spray-import-state.json
// **אינו בשימוש יותר**: הוא נועד למנוע ייבוא-בשקט של דוחות ישנים, ואין
// יותר שום ייבוא בשקט. (הקובץ נשאר על הדיסק ומתעלמים ממנו.)
//
// רשומות בדיקה (QA-...) מדולגות לגמרי, כמו קודם.
// ============================================================

// דוחות שכבר הוכרזו "ממתין לאישור" → מספר השורות שבגינן הוכרזו.
// in-memory בלבד (אין הרשאת סכמה ליצור שדה, והמצב נגזר ממילא ב-
// sprayReportsHistory). התפקיד היחיד: שהאיסוף המחזורי לא יכתוב את אותה
// שורת-לוג ולא ינקה את המטמון כל 10 דקות לנצח. מספר השורות הוא חלק
// מהמפתח כדי שניתוח שהתעדכן (Make כתב מחדש) יוכרז שוב.
const announcedAwaiting = new Map(); // reportId -> rows

/** מכריז "ממתין לאישור" פעם אחת לכל (דוח, מספר-שורות). מחזיר אם הוכרז עכשיו */
function announceAwaitingApproval({ id, number, rows }, onChange) {
  if (announcedAwaiting.get(id) === rows) return false;
  announcedAwaiting.set(id, rows);
  console.log(`[spray-approval] דוח #${number ?? id}: הניתוח הסתיים — ${rows} שורות **ממתינות לאישור**. אין ייבוא אוטומטי; הלקוחה מייבאת ממסך הטיפולים ← דוחות.`);
  if (onChange) onChange({ reportId: id, number, rows });
  return true;
}

const activePolls = new Set();

/**
 * אחרי העלאת דוח: ממתין שהניתוח של Make יסתיים, ואז מסמן "ממתין
 * לאישור". **לא מייבא.** (השם נשאר כמו שהיה — ר' כותרת הקובץ.)
 */
export function scheduleSprayReportImport(reportId, { onChange, intervalMs = 15000, maxMs = 10 * 60 * 1000 } = {}) {
  if (activePolls.has(reportId)) return;
  activePolls.add(reportId);
  const startedAt = Date.now();
  const tick = async () => {
    try {
      const rec = await getBase()(REPORTS_TABLE).find(reportId);
      if (isTestRecord({ id: rec.id, ...rec.fields })) { activePolls.delete(reportId); return; }
      const parsed = parseSummary(rec.fields[SUMMARY_FIELD]);
      if (parsed.status === 'pending') {
        if (Date.now() - startedAt < maxMs) { setTimeout(tick, intervalMs); return; }
        console.warn(`[spray-import] דוח ${reportId}: הניתוח לא הסתיים תוך ${Math.round(maxMs / 60000)} דקות — האיסוף המחזורי ישלים`);
        activePolls.delete(reportId);
        return;
      }
      activePolls.delete(reportId);
      const number = rec.fields[REPORT_NUMBER_FIELD];
      if (parsed.status !== 'ready') { console.log(`[spray-import] דוח #${number}: סיכום ${parsed.status} — אין שורות לאישור`); return; }
      announceAwaitingApproval({ id: reportId, number, rows: parsed.rows.length }, onChange);
    } catch (e) {
      activePolls.delete(reportId);
      // הרשומה נמחקה בינתיים (למשל ניקוי בדיקות) — עוצרים בשקט
      if (!/NOT_FOUND|not found|404/i.test(String(e.message || e))) console.error(`[spray-import] דוח ${reportId}: ${e.message}`);
    }
  };
  setTimeout(tick, intervalMs);
}

/**
 * סריקה מחזורית. **לא מייבאת כלום** — רק מסמנת דוחות שממתינים לאישור.
 * מחזירה { awaiting, announced }: כמה ממתינים בסך הכל, וכמה מהם הוכרזו
 * עכשיו (ראשונה אחרי עליית השרת תכריז את כולם).
 */
export async function sweepSprayReports({ onChange } = {}) {
  const history = await sprayReportsHistory();
  let awaiting = 0;
  let announced = 0;
  for (const r of history) {
    if (r.isTest || !isAwaitingApproval(r)) continue;
    awaiting++;
    if (announceAwaitingApproval({ id: r.id, number: r.number, rows: r.rows }, onChange)) announced++;
  }
  return { awaiting, announced };
}

export function startSprayImportSweep({ onChange, firstDelayMs = 60 * 1000, intervalMs = 10 * 60 * 1000 } = {}) {
  const run = () => sweepSprayReports({ onChange }).catch((e) => console.error(`[spray-approval] סריקה נכשלה: ${e.message}`));
  setTimeout(run, firstDelayMs);
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
