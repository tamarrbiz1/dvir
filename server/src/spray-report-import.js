// ============================================================
// ייבוא דוחות ריסוסים לטיפולים — 2026-10-06
// ------------------------------------------------------------
// זרימת ההעלאה: המשתמש מעלה צילום/PDF של דוח ריסוסים → נוצרת רשומה
// ב"דוחות ריסוסים" → אוטומציית Make מנתחת את הקובץ וכותבת לשדה
// "Attachment Summary" מערך JSON של שורות (סוג טיפול, תאריך/טווח,
// מבנים, גידול/זן, חומר, מינון). עד עכשיו אף אחד לא הפך את השורות
// האלה לרשומות "ריסוסים" — ולכן דוח שהועלה מעולם לא הופיע ביומן
// הטיפולים (תלונת הלקוחה). הקובץ הזה סוגר את הפער:
//
//   importSprayReport(reportId)  — שורה בדוח → רשומת "ריסוסים" אחת
//   sprayReportsHistory()        — היסטוריית הדוחות + מצב הניתוח/הייבוא
//   scheduleSprayReportImport()  — אחרי העלאה: מחכים ל-Make ומייבאים
//   startSprayImportSweep()      — איסוף מחזורי לדוחות שנפלו בין הכיסאות
//
// סמן המקור: כל טיפול מיובא מתחיל ב"הערות" בשורה
//   [מדוח ריסוסים #<מספור אוטומטי>] שורה <n>
// זה מה שגורם ל-UI (treatmentSource ב-TreatmentsPage.jsx) להציג "מדוח",
// וזה גם מפתח האידמפוטנטיות — ייבוא חוזר של אותו דוח לא יוצר כפילויות.
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBase, fetchRecords, createRecord } from './airtable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'spray-import-state.json');

export const REPORTS_TABLE = 'דוחות ריסוסים';
export const TREATMENTS_TABLE = 'ריסוסים';
const MATERIALS_TABLE = 'חומרי ריסוס';
const STRUCTURES_TABLE = 'מבנים';

const SUMMARY_FIELD = 'Attachment Summary';
const REPORT_FILE_FIELD = 'דוח ריסוסים';
const REPORT_NUMBER_FIELD = 'מספור אוטומטי';
const REPORT_UPLOADED_FIELD = 'העלאה אחרונה של הקובץ';
const DOSAGE_FIELD = 'מינון '; // שם השדה החי כולל רווח בסוף — לא טעות

// אותה תבנית כמו TEST_RECORD_PATTERN ב-server.js: רשומות בדיקה (qa-check.mjs)
// לעולם לא מיובאות אוטומטית ולא מוצגות בהיסטוריה למשתמש אמיתי.
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}\b|\bPERF-TEST\b/;
export const isTestRecord = (rec) => TEST_RECORD_PATTERN.test(JSON.stringify(rec));

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
export function parseDosage(text) {
  const s = normSpaces(text);
  if (!s) return { value: null, basis: null, note: null };
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return { value: Number(s.replace(',', '.')), basis: null, note: null };
  let basis = null;
  if (/100\s*ליטר/.test(s) || /ל-?100/.test(s)) basis = 'ל-100 ליטר';
  else if (/לדונם|דונם/.test(s)) basis = 'לדונם';
  else if (/לליטר|ל-?1\s*ליטר|לכל ליטר/.test(s)) basis = 'לליטר';
  else if (/%|אחוז/.test(s)) basis = 'אחוז';
  // מורידים את ביטוי הבסיס ("ל-100 ליטר", "ל-1 ליטר") לפני חיפוש המספר, כדי שלא ייחשב כמינון
  const stripped = s.replace(/ל-?\s*100\s*ליטר/g, ' ').replace(/ל-?\s*1\s*ליטר/g, ' ');
  const nums = stripped.match(/\d+(?:[.,]\d+)?/g) || [];
  const value = nums.length === 1 ? Number(nums[0].replace(',', '.')) : null;
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

/** בניית שדות רשומת "ריסוסים" משורת דוח אחת (ללא כתיבה) */
async function buildRow(row, { line, number, resolveStructure, materials, attachment }) {
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

  if (range && range.end !== range.start) notes.push(`תאריך סיום: ${toDMY(range.end)}`);

  const fields = {
    'סטטוס': 'בוצע', // דוח מתעד ריסוסים שכבר בוצעו
    'בוצע': true,
    'הערות': notes.join('\n'),
  };
  if (range) fields['תאריך'] = range.start;
  if (structureIds.length) fields['מבנה'] = structureIds;
  if (material.id) fields['חומר ריסוס'] = [material.id];
  if (dosage.value != null) fields[DOSAGE_FIELD] = dosage.value;
  if (dosage.basis) fields['בסיס מינון'] = dosage.basis;
  // אין שדה "סוג טיפול" ב"ריסוסים"; inferType בלקוח קורא גם את "סוג מרסס" —
  // כך הגמעה/פיזור מועילים מהדוח מקבלים את הצבע הנכון ביומן
  if (type && type !== 'ריסוס') fields['סוג מרסס'] = type;
  if (attachment) fields[REPORT_FILE_FIELD] = [{ url: attachment.url, filename: attachment.filename || 'דוח ריסוסים' }];

  return {
    line, fields, warnings,
    summary: {
      line, type, date: range?.start || null, endDate: range && range.end !== range.start ? range.end : null,
      structures: structureIds.length, structureNames: structNames, unresolvedStructures,
      material: material.name, materialIsNew: material.isNew,
      dosage: dosage.value, basis: dosage.basis, dosageText: dosage.note, crop, variety, sprayNo, location,
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

  const [structures, materialsList, imported] = await Promise.all([
    fetchRecords(STRUCTURES_TABLE, { fields: ['מספר מבנה'] }),
    fetchRecords(MATERIALS_TABLE, { fields: ['שם חומר'] }),
    importedLinesOf(number),
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
    const built = await buildRow(parsed.rows[i], { line, number, resolveStructure, materials, attachment });
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
  result.created = created;
  result.attachmentDropped = attachmentDropped;
  result.status = 'imported';
  console.log(`[spray-import] דוח #${number}: נוצרו ${created} טיפולים, ${result.skipped} דולגו, ${materials.created.length} חומרים חדשים${attachmentDropped ? ' (הצרופה לא הועתקה)' : ''}`);
  return result;
}

// ============================================================
// היסטוריית הדוחות — לטאב "דוחות" במסך הטיפולים
// ============================================================
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
    return {
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
  }).sort((a, b) => (b.number || 0) - (a.number || 0));
}

// ============================================================
// ייבוא אוטומטי
// ------------------------------------------------------------
// 1) אחרי העלאה: Make מנתח ברקע (שניות עד דקות) — בודקים כל 15 שניות
//    עד 10 דקות, ומייבאים ברגע שהסיכום מתמלא.
// 2) איסוף מחזורי (כל 10 דקות + ~60 שניות אחרי עליית השרת): דוח עם
//    סיכום מוכן ו-0 טיפולים מיובאים → מיובא. רק דוחות שהועלו אחרי
//    תאריך-הסף (cutoff) — נשמר ב-server/data/spray-import-state.json,
//    ברירת מחדל: זמן ההרצה הראשונה. דוחות ישנים (לפני הפיצ'ר) לא
//    מיובאים בשקט — הלקוחה מחליטה עליהם מהכפתור במסך.
// רשומות בדיקה (QA-...) לעולם לא מיובאות אוטומטית.
// ============================================================
function loadState() {
  if (existsSync(STATE_PATH)) {
    try { const s = JSON.parse(readFileSync(STATE_PATH, 'utf8')); if (s?.cutoff) return s; } catch { /* נבנה מחדש למטה */ }
  }
  const state = { cutoff: new Date().toISOString(), createdAt: new Date().toISOString() };
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8'); }
  catch (e) { console.warn(`[spray-import] לא ניתן לשמור את קובץ המצב: ${e.message}`); }
  return state;
}

const activePolls = new Set();

export function scheduleSprayReportImport(reportId, { afterImport, intervalMs = 15000, maxMs = 10 * 60 * 1000 } = {}) {
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
      if (parsed.status !== 'ready') { console.log(`[spray-import] דוח #${rec.fields[REPORT_NUMBER_FIELD]}: סיכום ${parsed.status} — אין מה לייבא`); return; }
      const result = await importSprayReport(reportId);
      if (result.created && afterImport) afterImport(result);
    } catch (e) {
      activePolls.delete(reportId);
      // הרשומה נמחקה בינתיים (למשל ניקוי בדיקות) — עוצרים בשקט
      if (!/NOT_FOUND|not found|404/i.test(String(e.message || e))) console.error(`[spray-import] דוח ${reportId}: ${e.message}`);
    }
  };
  setTimeout(tick, intervalMs);
}

export async function sweepSprayReports({ afterImport } = {}) {
  const state = loadState();
  const history = await sprayReportsHistory();
  let imported = 0;
  for (const r of history) {
    if (r.isTest || r.summary !== 'ready' || r.imported > 0) continue;
    if (!r.uploadedAt || r.uploadedAt < state.cutoff) continue;
    try {
      const result = await importSprayReport(r.id);
      if (result.created) { imported++; if (afterImport) afterImport(result); }
    } catch (e) {
      console.error(`[spray-import] איסוף — דוח #${r.number}: ${e.message}`);
    }
  }
  return imported;
}

export function startSprayImportSweep({ afterImport, firstDelayMs = 60 * 1000, intervalMs = 10 * 60 * 1000 } = {}) {
  const run = () => sweepSprayReports({ afterImport }).catch((e) => console.error(`[spray-import] איסוף נכשל: ${e.message}`));
  setTimeout(run, firstDelayMs);
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
