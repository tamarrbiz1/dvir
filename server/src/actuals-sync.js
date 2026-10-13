// ============================================================
// מנוע "בפועל" (משימה AJ, 13.10.2026)
// ------------------------------------------------------------
// תמר: "אני צריכה שהנתונים בפועל כולם יעודכנו בדיוק — כל הנתונים שיש
// מהם תכנון."
//
// מה היה עד היום: לכל נתון מתוכנן בטבלת "תחזית שתילה שבועית" יש עמודה
// מתוכננת (`ק"ג צפוי`, `הכנסה צפויה`) — אבל `קג בפועל` היה **ריק בכל
// 250 השורות ושום קוד בעולם לא כתב אליו**. השרשרת שאמורה למלא אותו
// (`JSON עבודות קטיף לפי ימים` → `JSON סיכום קטיף לפי מבנים` → `JSON קג
// בפועל לפי ימים ומבנים`) רצה בסקריפטי-Airtable שאין לנו גישה אליהם,
// והיא נכשלת שם מזה שבועות ("ממתין לנתוני מקור", "חסרים דיווחי קטיף").
// המנוע הזה **עצמאי לגמרי** ולא תלוי בהם.
//
// ------------------------------------------------------------
// מקור ה"בפועל" — אחד ויחיד (תיקון מתמר, 13.10.2026)
// ------------------------------------------------------------
// **דיווחי הקטיף של העובדים** בטבלת "עבודות עובדים": רשומה שהתמחור
// שלה הוא מסוג קטיף ("קטיף סוג א'" / "קטיף סוג ב'"), יחידת התמחור
// "קרטון", ויש לה מבנה ותאריך.
//
//   ק"ג = `כמות` (קרטונים) × משקל-ממוצע-לקרטון
//
// משקל-ממוצע-לקרטון נלקח **מתעודות המשלוח של אותו יום ואותו זן**
// (משקל ÷ קרטונים מתוך `סיכום יומי`) — בדיוק השיטה של סקריפט
// "ק"ג בפועל לפי מבנים" ב-Airtable. אם אין תעודה לאותו יום+זן —
// ברירת המחדל 12.3 ק"ג, **והשורה מסומנת "מוערך"**.
//
// שלושה דברים שבוטלו במפורש, ואסור להחזיר אותם:
//   · **חלוקת תעודות משלוח לפי שטח** (סעיף 1.3 במשימה המקורית) —
//     בוטלה. אין הערכה כשאין דיווח קטיף.
//   · **טבלת `קטיפים` אינה נספרת** — כדי למנוע ספירה כפולה מול
//     דיווחי העובדים, שהם אותה תוצרת. היא רק **מדווחת** (ר'
//     `harvestTable` בדוח), ושום דבר בה אינו נכתב/משונה.
//   · **אפס לשבוע שעבר** — בוטל. שבוע שהסתיים בלי דיווח קטיף נשאר
//     **ריק** ומוצג "טרם דווח קטיף"; 0 היה נקרא "נבדק ולא נקטף כלום",
//     וזו אמירה שאין לנו בסיס לה.
//
// ------------------------------------------------------------
// למה רק `קג בפועל` נכתב ל-Airtable
// ------------------------------------------------------------
// המשימה ביקשה ליצור ארבעה שדות חדשים (`הכנסה בפועל` + `מקור בפועל`
// על התחזית, `תחילת/סוף קטיף בפועל` על התוכנית). נוסה דרך Meta API
// (ר' `_create-actuals-fields.mjs`, אידמפוטנטי — אפשר להריץ שוב ביום
// שבו תתווסף ההרשאה) וחזר **403 על כל הארבעה**: ל-PAT אין
// `schema.bases:write` (אותו חוסר שמתועד גם בכותרת analysis-retry.js).
//
// לכן הפיצול: `קג בפועל` — השדה היחיד שקיים — נכתב ל-Airtable, כדי
// שגם Airtable עצמו וגם המסכים שקוראים אותו ישר מהטבלה (CropsPage,
// PlantingPlanPage) יראו אותו. כל השאר — מקור/הערכה/הכנסה-בפועל/
// תאריכי-קטיף-בפועל — מוחזר מ-`GET /api/actuals/report` ונצרך בלקוח.
// זה גם *נכון יותר* מהשדות שביקשנו: נתון נגזר שנשמר בטבלה מתיישן
// ברגע שמשתנה נתון-מקור, ונתון שמחושב בקריאה לא מתיישן אף פעם.
//
// ------------------------------------------------------------
// אידמפוטנטיות והגנה על קלט-יד
// ------------------------------------------------------------
// הרצה כפולה לא משנה כלום: לפני כל כתיבה משווים לערך הקיים (מעוגל
// לשני מקומות) ומדלגים אם זהה.
//
// `קג בפועל` הוא שדה שתמר *יכולה* למלא ביד, ואין שדה "מקור בפועל"
// שיבדיל (403 למעלה). לכן יש **פנקס** — `server/data/actuals-ledger.json`
// — שזוכר איזה ערך המנוע כתב לכל שורה. הכלל: תא ריק → כותבים; תא
// שתואם את מה שהפנקס אומר שאנחנו כתבנו → מעדכנים (וגם מנקים, אם
// הדיווח שממנו הוא נגזר נמחק); תא עם ערך שאיננו שלנו → **לא נוגעים**
// ומדווחים כ"התנגשות". אם הפנקס לא נקרא/לא נכתב, כל תא לא-ריק נחשב
// קלט-יד (fail closed, בדיוק כמו logistics-sweep.js) — מוטב שלא
// נעדכן מאשר שנדרוס עבודה של אדם.
//
// ⚠️ בעלות על קובץ הפנקס (נתפס בלוג הייצור, 13.10): השירות רץ כמשתמש
// `zite`. אם מריצים את המנוע ידנית **כ-root** (`node -e "...syncActuals..."`)
// לפני שהשירות יצר את הקובץ — הוא נוצר בבעלות root, והשירות מקבל אחר כך
// EACCES בכל כתיבה. התוצאה אינה נזק (fail closed: ערכים קיימים לא
// נדרסים) אבל המנוע מפסיק לזכור מה כתב. אחרי הרצה ידנית כ-root:
//   chown zite:zite server/data/actuals-ledger.json
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRecords, updateRecord } from './airtable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'actuals-ledger.json');

export const PLANS_TABLE = 'תוכניות שתילה';
export const FORECAST_TABLE = 'תחזית שתילה שבועית';
export const HARVESTS_TABLE = 'קטיפים';
export const WORKS_TABLE = 'עבודות עובדים';
export const NOTES_TABLE = 'תעודות משלוח';
export const INVOICES_TABLE = 'חשבוניות';
export const STRUCTURES_TABLE = 'מבנים';
export const CROPS_TABLE = 'גידולים';

const KG_ACTUAL_FIELD = 'קג בפועל';

/** משקל-ברירת-מחדל לקרטון — אותו קבוע שהלקוח מציג בו קרטונים
 *  (KG_PER_CARTON ב-PlantingPlanPage.jsx). מוחזק גם כאן כדי שהשרת
 *  והלקוח לא ייפרדו בשקט. */
export const KG_PER_CARTON = 12.3;

/** תגיות-מקור — מוחזרות ללקוח וגם מוצגות לתמר בדוח */
export const SOURCE = {
  reported: 'דיווחי קטיף',                 // קרטונים × ממוצע מתעודה של אותו יום+זן
  estimated: 'דיווחי קטיף (משקל מוערך)',   // קרטונים × 12.3 — אין תעודה לאותו יום+זן
  none: 'טרם דווח קטיף',
};

// ------------------------------------------------------------
// עזרי-נתונים
// ------------------------------------------------------------

const linkedIds = (value) => {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => (v && typeof v === 'object' ? v.id : v)).filter(Boolean);
};
const firstLinkedId = (value) => linkedIds(value)[0] || null;

/** "2026-10-12T..." / "2026-10-12" → "2026-10-12"; כל השאר → null.
 *  עובדים במחרוזות ולא ב-Date בכוונה: כל ההשוואות כאן הן על ימים
 *  קלנדריים, והשוואת-מחרוזות ISO היא בדיוק השוואה כרונולוגית — בלי
 *  שום חשיפה להסטת אזור-זמן (הבאג הקלאסי של new Date('YYYY-MM-DD')). */
export function ymd(value) {
  const s = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const round2 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);

/** שם ראשון מתוך lookup/קישור שהתרחש למחרוזת */
const firstName = (value) => {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  const v = arr.find((x) => typeof x === 'string' && x.trim());
  return v ? v.trim() : null;
};

/**
 * `סיכום יומי` — ה-JSON שה-AI כותב לתעודות/חשבוניות. מחזיר
 * `days[]` או [] אם לא נותח/לא תקין. סובלני ל-code-fence.
 */
export function parseDailyJson(raw) {
  if (!raw) return [];
  let text = String(raw).trim();
  if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.days) ? parsed.days : [];
  } catch {
    return [];
  }
}

/**
 * שם-זן מהמסמך/מהתמחור ("מלפפון מובחר", "שרי") → שם גידול מטבלת
 * "גידולים". התאמה מדויקת קודם, ואחר כך "הזן מתחיל בשם הגידול" — כך
 * "מלפפון מובחר" נקלט כמלפפון, ו"קישוא"/"שרי" (זנים שאין להם רשומת
 * גידול) נשארים null במקום להידחף בכוח לגידול שגוי.
 */
export function normalizeCrop(variety, cropNames) {
  const v = String(variety ?? '').trim();
  if (!v) return null;
  if (cropNames.includes(v)) return v;
  const prefix = cropNames.find((c) => v.startsWith(c));
  return prefix || null;
}

// ------------------------------------------------------------
// הפנקס (ר' כותרת)
// ------------------------------------------------------------

/** מחזיר { rows: {id: value}, ok } — ok=false אומר "אין פנקס אמין" */
export function loadLedger() {
  try {
    if (!existsSync(LEDGER_PATH)) return { rows: {}, ok: true };
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    return { rows: parsed?.rows && typeof parsed.rows === 'object' ? parsed.rows : {}, ok: true };
  } catch (e) {
    console.error(`[actuals] קריאת הפנקס נכשלה (${LEDGER_PATH}): ${e.message} — כל ערך קיים ייחשב קלט-יד ולא יידרס`);
    return { rows: {}, ok: false };
  }
}

export function saveLedger(rows) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LEDGER_PATH, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), rows }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[actuals] כתיבת הפנקס נכשלה (${LEDGER_PATH}): ${e.message} — העדכון הבא לא ידרוס ערכים קיימים`);
    return false;
  }
}

// ------------------------------------------------------------
// נרמול רשומות-מקור
// ------------------------------------------------------------

/** טווח הקטיף של התוכנית — מעודכן אם קיים, אחרת מקורי (אותה עדיפות
 *  בדיוק כמו computePlanRanges בלקוח ו-relevantQuarters בפריפלייט) */
export function planHarvestRange(plan) {
  const start = ymd(plan['תחילת קטיף מעודכנת']) || ymd(plan['תחילת קטיף מקורית']);
  const end = ymd(plan['סוף קטיף מעודכן']) || ymd(plan['סוף קטיף מקורי']) || start;
  if (!start) return null;
  return end && end >= start ? { start, end } : { start, end: start };
}

function normalizePlans(plans, structById, cropById) {
  return plans.map((p) => {
    const range = planHarvestRange(p);
    const structureId = firstLinkedId(p['מבנה']);
    const cropId = firstLinkedId(p['גידולים']);
    return {
      id: p.id,
      number: p['מספר תוכנית'] ?? null,
      year: num(p['שנת תוכנית']),
      structureId,
      structureName: structById.get(structureId)?.['מספר מבנה'] || null,
      area: num(structById.get(structureId)?.['שטח בדונם']),
      cropId,
      cropName: cropById.get(cropId)?.['שם גידול'] || firstName(p['סוג גידול']) || null,
      harvestStart: range?.start || null,
      harvestEnd: range?.end || null,
    };
  });
}

/**
 * דיווח-קטיף של עובד: התמחור המקושר הוא מסוג קטיף, יחידת התמחור
 * "קרטון", ויש מבנה ותאריך. `זן (from תמחור עבודות)` הוא הגידול.
 *
 * `invalid` מחזיק רשומות שנראות כמו דיווח-קטיף אבל חסר בהן משהו —
 * הן נכנסות לדוח ולא נעלמות בשקט.
 */
export function normalizeHarvestReports(works, structById, cropNames) {
  const reports = [];
  const invalid = [];
  for (const w of works) {
    const kind = firstName(w['סוג עבודה (from תמחור עבודות)']);
    if (!kind || !kind.includes('קטיף')) continue;
    const unit = firstName(w['יחידת תמחור (from תמחור עבודות)']);
    const structureId = firstLinkedId(w['מבנה']);
    const base = {
      id: w.id,
      number: w['מספר עבודה'] ?? null,
      date: ymd(w['תאריך']),
      structureId,
      structureName: structById.get(structureId)?.['מספר מבנה'] || null,
      kind,
      unit,
      cartons: num(w['כמות']),
      cropName: normalizeCrop(firstName(w['זן (from תמחור עבודות)']), cropNames),
    };
    const missing = [];
    if (unit !== 'קרטון') missing.push(`יחידת התמחור היא "${unit || 'לא ידועה'}" ולא "קרטון"`);
    if (base.cartons === null) missing.push('שדה "כמות" (קרטונים) ריק');
    if (!base.date) missing.push('אין תאריך');
    if (!structureId) missing.push('אין מבנה');
    if (missing.length) invalid.push({ ...base, missing });
    else reports.push(base);
  }
  return { reports, invalid };
}

/**
 * מסמכים (תעודות/חשבוניות) → ניכוי כפילויות על רמת המסמך: שני
 * מסמכים עם אותה חתימה (תאריך+משקל+קרטונים+משווק) הם אותו PDF
 * שהועלה פעמיים, ונספרים פעם אחת (נשמר זה עם המספר הנמוך — הראשון
 * שהועלה).
 *
 * שים לב: השיוך ליום נעשה לפי **תאריך היום שבתוך ה-JSON**, ולא לפי
 * `קוד שבוע` של המסמך. בנתונים האמיתיים `קוד שבוע` משקף את תאריך
 * ההעלאה ולא את תאריך המסמך (תעודות יולי מתויגות לשבועות אוקטובר),
 * ולכן שימוש בו היה מצמיד תוצרת ליום הלא-נכון.
 */
export function dedupeDocuments(records, { dateField, weightField, cartonsField, numberField }) {
  const bySignature = new Map();
  const duplicates = [];
  const sorted = [...records].sort((a, b) => (num(a[numberField]) ?? 0) - (num(b[numberField]) ?? 0));
  for (const r of sorted) {
    const date = ymd(r[dateField]);
    const weight = num(r[weightField]);
    const cartons = num(r[cartonsField]);
    const marketer = String(r['שם משווק'] || r['משווק-AI'] || '').replace(/[\s.]+/g, '');
    if (!date && weight === null && cartons === null) continue; // רשומה ריקה — מטופלת בבעיות-נתונים
    const signature = `${date}|${weight}|${cartons}|${marketer}`;
    if (bySignature.has(signature)) {
      duplicates.push({ id: r.id, number: r[numberField] ?? null, keptNumber: bySignature.get(signature)[numberField] ?? null, date, weight, cartons });
      continue;
    }
    bySignature.set(signature, r);
  }
  return { unique: [...bySignature.values()], duplicates };
}

/**
 * טבלת משקל-ממוצע-לקרטון לפי יום+זן, מתוך `סיכום יומי` של תעודות
 * המשלוח: Map "YYYY-MM-DD|גידול" → { kg, cartons, avg, docNumbers }.
 * זהו בדיוק הנתון שסקריפט "ק"ג בפועל לפי מבנים" ב-Airtable משתמש בו.
 */
export function cartonWeightIndex(uniqueNotes, cropNames) {
  const index = new Map();
  for (const n of uniqueNotes) {
    const docDate = ymd(n['תאריך תעודה']);
    for (const day of parseDailyJson(n['סיכום יומי'])) {
      const date = ymd(day.date) || docDate;
      if (!date) continue;
      const products = Array.isArray(day.products) && day.products.length
        ? day.products : [{ variety: null, weight: day.weight, cartons: day.cartons }];
      for (const p of products) {
        const cropName = normalizeCrop(p.variety, cropNames);
        const weight = num(p.weight);
        const cartons = num(p.cartons);
        if (!cropName || weight === null || !cartons) continue;
        const key = `${date}|${cropName}`;
        if (!index.has(key)) index.set(key, { kg: 0, cartons: 0, docNumbers: [] });
        const entry = index.get(key);
        entry.kg += weight;
        entry.cartons += cartons;
        if (!entry.docNumbers.includes(n['מספר תעודה'])) entry.docNumbers.push(n['מספר תעודה']);
      }
    }
  }
  for (const entry of index.values()) entry.avg = entry.kg / entry.cartons;
  return index;
}

// ------------------------------------------------------------
// החישוב (טהור — בלי שום I/O, כדי שיהיה נבדק)
// ------------------------------------------------------------

/**
 * @param {object} data   כל הטבלאות כפי שהוחזרו מ-Airtable
 * @param {object} opts   { today: 'YYYY-MM-DD', ledger: {rows, ok} }
 * @returns דוח מלא (ר' סוף הפונקציה) — בלי לכתוב כלום.
 */
export function computeActuals(data, { today, ledger = { rows: {}, ok: true } } = {}) {
  const todayYmd = ymd(today) || new Date().toISOString().slice(0, 10);
  const structById = new Map((data.structures || []).map((s) => [s.id, s]));
  const cropById = new Map((data.crops || []).map((c) => [c.id, c]));
  const cropNames = (data.crops || []).map((c) => c['שם גידול']).filter(Boolean);

  const plans = normalizePlans(data.plans || [], structById, cropById);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const { reports, invalid: invalidReports } = normalizeHarvestReports(data.works || [], structById, cropNames);

  const needsDecision = [];
  const dataIssues = [];

  for (const r of invalidReports) {
    dataIssues.push({ kind: 'דיווח קטיף חסר נתון', table: WORKS_TABLE, id: r.id, number: r.number,
      detail: `עבודה #${r.number} (${r.kind}${r.date ? ', ' + r.date : ''}) אינה ניתנת לחישוב: ${r.missing.join('; ')}` });
  }

  // ---------- 1. מסמכים: ניכוי כפילויות ----------
  const notesDedupe = dedupeDocuments(data.notes || [], { dateField: 'תאריך תעודה', weightField: 'משקל כולל', cartonsField: 'כמות קרטונים', numberField: 'מספר תעודה' });
  const invoicesDedupe = dedupeDocuments(data.invoices || [], { dateField: 'תאריך-AI', weightField: 'משקל', cartonsField: 'כמות קרטונים', numberField: 'מספר חשבונית' });

  for (const d of notesDedupe.duplicates) {
    dataIssues.push({ kind: 'תעודה כפולה', table: NOTES_TABLE, id: d.id, number: d.number,
      detail: `תעודה #${d.number} זהה לתעודה #${d.keptNumber} (${d.date}, ${d.weight} ק"ג, ${d.cartons} קרטונים) — נספרת פעם אחת בלבד` });
  }
  for (const d of invoicesDedupe.duplicates) {
    dataIssues.push({ kind: 'חשבונית כפולה', table: INVOICES_TABLE, id: d.id, number: d.number,
      detail: `חשבונית #${d.number} זהה לחשבונית #${d.keptNumber} (${d.date}, ${d.weight} ק"ג) — נספרת פעם אחת בלבד` });
  }

  for (const n of (data.notes || [])) {
    if (!ymd(n['תאריך תעודה']) && num(n['משקל כולל']) === null) {
      dataIssues.push({ kind: 'מסמך ריק', table: NOTES_TABLE, id: n.id, number: n['מספר תעודה'] ?? null,
        detail: `תעודה #${n['מספר תעודה']} בלי תאריך ובלי משקל — לא נותחה. לא נספרת.` });
    }
  }
  for (const i of (data.invoices || [])) {
    if (!ymd(i['תאריך-AI']) && num(i['משקל']) === null) {
      dataIssues.push({ kind: 'מסמך ריק', table: INVOICES_TABLE, id: i.id, number: i['מספר חשבונית'] ?? null,
        detail: `חשבונית #${i['מספר חשבונית']} בלי תאריך ובלי משקל — לא נותחה. לא נספרת.` });
    }
  }

  // אי-התאמה בין השדה הגלובלי לפירוט היומי בתוך אותו מסמך
  for (const n of notesDedupe.unique) {
    const days = parseDailyJson(n['סיכום יומי']);
    const jsonCartons = days.reduce((s, d) => s + (num(d.cartons) || 0), 0);
    const fieldCartons = num(n['כמות קרטונים']);
    if (days.length && fieldCartons !== null && jsonCartons && Math.abs(jsonCartons - fieldCartons) > 0.5) {
      dataIssues.push({ kind: 'אי-התאמה בתוך המסמך', table: NOTES_TABLE, id: n.id, number: n['מספר תעודה'] ?? null,
        detail: `תעודה #${n['מספר תעודה']}: השדה "כמות קרטונים" אומר ${fieldCartons} אבל הפירוט היומי מסתכם ל-${jsonCartons}. החישוב מעדיף את הפירוט היומי.` });
    }
  }

  // תאריך מסמך מול השבוע שהוא משויך אליו — דיווח בלבד (אנחנו לא
  // משתמשים ב"קוד שבוע" בחישוב, אבל תמר צריכה לדעת שההעלאה שייכה
  // תוצרת של יולי לשבוע של אוקטובר).
  for (const [table, records, dateField, numberField] of [
    [NOTES_TABLE, notesDedupe.unique, 'תאריך תעודה', 'מספר תעודה'],
    [INVOICES_TABLE, invoicesDedupe.unique, 'תאריך-AI', 'מספר חשבונית'],
  ]) {
    for (const r of records) {
      const date = ymd(r[dateField]);
      const code = String(r['קוד שבוע'] || '');
      if (!date || !/^\d{8}-\d{8}$/.test(code)) continue;
      const codeStart = `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}`;
      const codeEnd = `${code.slice(9, 13)}-${code.slice(13, 15)}-${code.slice(15, 17)}`;
      if (date < codeStart || date > codeEnd) {
        dataIssues.push({ kind: 'תאריך לא בשבוע שלו', table, id: r.id, number: r[numberField] ?? null,
          detail: `${table === NOTES_TABLE ? 'תעודה' : 'חשבונית'} #${r[numberField]}: התאריך שבמסמך הוא ${date} אבל היא משויכת לשבוע ${codeStart}..${codeEnd} (לפי תאריך ההעלאה). כדאי לבדוק שהתאריך שה-AI קרא נכון.` });
      }
    }
  }

  const cartonIndex = cartonWeightIndex(notesDedupe.unique, cropNames);

  // ---------- 2. שיוך דיווחי הקטיף לתוכניות ----------
  for (const r of reports) {
    const candidates = plans.filter((p) => p.structureId === r.structureId && p.harvestStart
      && r.date >= p.harvestStart && r.date <= p.harvestEnd);
    const byCrop = r.cropName ? candidates.filter((p) => p.cropName === r.cropName) : [];
    if (candidates.length === 1) { r.planId = candidates[0].id; continue; }
    if (byCrop.length === 1) { r.planId = byCrop[0].id; r.matchedByCrop = true; continue; }
    if (candidates.length === 0) {
      needsDecision.push({ kind: 'דיווח קטיף בלי תוכנית', id: r.id, number: r.number,
        question: `דיווח קטיף #${r.number} (${r.kind}, ${r.structureName || 'מבנה לא ידוע'}, ${r.date}, ${r.cartons} קרטון): אין תוכנית שתילה שתקופת הקטיף שלה מכסה את התאריך הזה במבנה הזה. לאיזו תוכנית הדיווח הזה שייך?` });
    } else {
      needsDecision.push({ kind: 'כמה תוכניות חופפות', id: r.id, number: r.number,
        question: `דיווח קטיף #${r.number} (${r.structureName}, ${r.date}): ${candidates.length} תוכניות פעילות באותו מבנה באותו תאריך (${candidates.map((c) => `${c.number}/${c.cropName || 'בלי גידול'}`).join(', ')}), והזן שבתמחור (${r.cropName || 'לא ידוע'}) אינו מכריע. לא נספר. לאיזו תוכנית לשייך?`,
        candidates: candidates.map((c) => ({ planId: c.id, planNumber: c.number, cropName: c.cropName })) });
    }
  }

  // ---------- 3. מחיר נטו בפועל מהחשבוניות (ליום + זן) ----------
  /** [{date, cropName, weight, netPricePerKg, docNumber}] */
  const invoiceDays = [];
  for (const inv of invoicesDedupe.unique) {
    const netPrice = num(inv['מחיר נטו לק"ג']);
    if (netPrice === null) continue;
    const docDate = ymd(inv['תאריך-AI']);
    const jsonDays = parseDailyJson(inv['סיכום יומי']);
    const days = jsonDays.length ? jsonDays : (docDate ? [{ date: docDate, weight: num(inv['משקל']) }] : []);
    for (const day of days) {
      const date = ymd(day.date) || docDate;
      if (!date) continue;
      const products = Array.isArray(day.products) && day.products.length ? day.products : [{ variety: null, weight: day.weight }];
      for (const p of products) {
        const weight = num(p.weight);
        if (weight === null) continue;
        invoiceDays.push({ date, cropName: normalizeCrop(p.variety, cropNames), weight, netPricePerKg: netPrice, docNumber: inv['מספר חשבונית'] ?? null });
      }
    }
  }

  // ---------- 4. שורות התחזית ----------
  const rows = [];
  const kgWrites = [];
  const conflicts = [];

  const forecasts = (data.forecasts || []).filter((f) => firstLinkedId(f['תוכנית שתילה']));
  const orphanForecasts = (data.forecasts || []).length - forecasts.length;

  for (const f of forecasts) {
    const planId = firstLinkedId(f['תוכנית שתילה']);
    const plan = planById.get(planId);
    const weekStart = ymd(f['תחילת שבוע']);
    const weekEnd = ymd(f['סוף שבוע']);
    const cropName = firstName(f['גידול']) || plan?.cropName || null;
    const inWeek = (d) => !!d && !!weekStart && !!weekEnd && d >= weekStart && d <= weekEnd;

    let kg = 0;
    let anyEstimated = false;
    const parts = [];

    for (const r of reports) {
      if (r.planId !== planId || !inWeek(r.date)) continue;
      // משקל ממוצע לקרטון: מתעודות אותו יום ואותו זן. אין כזו → 12.3
      // ומסמנים מוערך (תיקון תמר, 13.10).
      const key = `${r.date}|${r.cropName || cropName || ''}`;
      const fromNotes = cartonIndex.get(key);
      const per = fromNotes?.avg ?? KG_PER_CARTON;
      const estimated = !fromNotes;
      const kgPart = r.cartons * per;
      kg += kgPart;
      if (estimated) anyEstimated = true;
      parts.push({
        ref: `עבודה #${r.number}`,
        date: r.date,
        cartons: r.cartons,
        kgPerCarton: round2(per),
        kg: round2(kgPart),
        estimated,
        detail: estimated
          ? `${r.cartons} קרטון × ${KG_PER_CARTON} ק"ג (ברירת מחדל — אין תעודת משלוח ל${r.cropName || cropName || 'גידול זה'} בתאריך ${r.date})`
          : `${r.cartons} קרטון × ${round2(per)} ק"ג (ממוצע מתעודה ${fromNotes.docNumbers.map((n) => '#' + n).join(', ')} מאותו יום)`,
      });
    }

    // מחיר בפועל (להכנסה בפועל)
    const weekInvoices = invoiceDays.filter((d) => inWeek(d.date) && (!cropName || d.cropName === cropName));
    const invWeight = weekInvoices.reduce((s, d) => s + d.weight, 0);
    const invPriceWeighted = invWeight > 0 ? weekInvoices.reduce((s, d) => s + d.netPricePerKg * d.weight, 0) / invWeight : null;
    const plannedPrice = num(f['מחיר לקג מעודכן']) ?? num(firstName(f['מחיר משוער לקג (from מחירי גידול משוערים)'])) ?? null;
    const pricePerKg = invPriceWeighted ?? plannedPrice;
    const priceSource = invPriceWeighted !== null ? 'חשבוניות' : (plannedPrice !== null ? 'מחיר מתוכנן (מוערך)' : null);

    // שבוע בלי דיווח קטיף נשאר **ריק** — לא 0 (תיקון תמר, 13.10).
    const actualKg = parts.length ? round2(kg) : null;
    const source = parts.length ? (anyEstimated ? SOURCE.estimated : SOURCE.reported) : SOURCE.none;

    const row = {
      forecastId: f.id,
      planId,
      planNumber: plan?.number ?? null,
      structureName: plan?.structureName || firstName(f['מבנה']) || null,
      cropName,
      weekStart,
      weekEnd,
      weekEnded: !!weekEnd && weekEnd < todayYmd,
      expectedKg: num(f['ק"ג צפוי']),
      expectedRevenue: num(f['הכנסה צפויה']),
      actualKg,
      source,
      estimated: anyEstimated,
      parts,
      pricePerKg: round2(pricePerKg),
      priceSource,
      actualRevenue: actualKg !== null && pricePerKg !== null ? round2(actualKg * pricePerKg) : null,
      currentKgInAirtable: num(f[KG_ACTUAL_FIELD]),
    };
    rows.push(row);

    // ---- האם לכתוב? (ר' "אידמפוטנטיות והגנה על קלט-יד" בכותרת) ----
    const current = row.currentKgInAirtable;
    const ours = ledger.ok ? round2(num(ledger.rows?.[f.id])) : null;
    if (actualKg === null) {
      // אין דיווח. אם בתא יש ערך שאנחנו כתבנו בעבר (והדיווח שממנו הוא
      // נגזר נמחק מאז) — מנקים אותו. ערך של אדם לא נוגעים בו בכלל.
      if (current !== null && ours !== null && ours === round2(current)) {
        kgWrites.push({ forecastId: f.id, planNumber: row.planNumber, weekStart, from: round2(current), to: null, source });
      } else if (current !== null) {
        conflicts.push({ forecastId: f.id, planNumber: row.planNumber, weekStart,
          detail: `שורת ${weekStart} של תוכנית ${row.planNumber}: ב-Airtable יש ${round2(current)} ק"ג שלא נכתב ע"י המערכת (כנראה מולא ביד), ואין לו דיווח קטיף מקביל. לא נגעתי.` });
      }
      continue;
    }
    if (current !== null && round2(current) === actualKg) continue; // כבר נכון
    if (current === null) {
      kgWrites.push({ forecastId: f.id, planNumber: row.planNumber, weekStart, from: null, to: actualKg, source });
    } else if (ours !== null && ours === round2(current)) {
      kgWrites.push({ forecastId: f.id, planNumber: row.planNumber, weekStart, from: round2(current), to: actualKg, source });
    } else {
      conflicts.push({ forecastId: f.id, planNumber: row.planNumber, weekStart,
        detail: `שורת ${weekStart} של תוכנית ${row.planNumber}: ב-Airtable יש ${round2(current)} ק"ג שלא נכתב ע"י המערכת (כנראה מולא ביד), והחישוב אומר ${actualKg}. לא נגעתי.` });
    }
  }

  // ---------- 5. תאריכי קטיף בפועל + סיכום לכל תוכנית ----------
  const planActuals = plans.map((p) => {
    const events = reports.filter((r) => r.planId === p.id && r.date).map((r) => r.date).sort();
    const planRows = rows.filter((r) => r.planId === p.id);
    const withActual = planRows.filter((r) => r.actualKg !== null);
    return {
      planId: p.id,
      planNumber: p.number,
      year: p.year,
      structureName: p.structureName,
      cropName: p.cropName,
      plannedHarvestStart: p.harvestStart,
      plannedHarvestEnd: p.harvestEnd,
      actualHarvestStart: events[0] || null,
      actualHarvestEnd: events[events.length - 1] || null,
      harvestReportCount: events.length,
      forecastRows: planRows.length,
      expectedKg: round2(planRows.reduce((s, r) => s + (r.expectedKg || 0), 0)),
      actualKg: withActual.length ? round2(withActual.reduce((s, r) => s + (r.actualKg || 0), 0)) : null,
      expectedRevenue: round2(planRows.reduce((s, r) => s + (r.expectedRevenue || 0), 0)),
      actualRevenue: withActual.length ? round2(withActual.reduce((s, r) => s + (r.actualRevenue || 0), 0)) : null,
      estimated: planRows.some((r) => r.estimated),
    };
  });

  // ---------- 6. טבלת "קטיפים" — דיווח בלבד, לא נספרת ----------
  // תמר, 13.10: הטבלה הזו אינה מקור ה"בפועל" (למנוע ספירה כפולה מול
  // דיווחי העובדים). לא נכתב ולא משויך בה כלום — רק מוצג מה יש בה,
  // כדי שתמר תראה אם יש שם תוצרת שלא דווחה כעבודה.
  const harvestTable = (data.harvests || []).map((h) => {
    const structureId = firstLinkedId(h['מבנה']);
    const date = ymd(h['תאריך']);
    const matching = plans.filter((p) => p.structureId === structureId && p.harvestStart
      && date && date >= p.harvestStart && date <= p.harvestEnd);
    const hasReport = reports.some((r) => r.structureId === structureId && r.date === date);
    return {
      id: h.id,
      number: h['מספר קטיף'] ?? null,
      date,
      structureName: structById.get(structureId)?.['מספר מבנה'] || null,
      kg: num(h['כמות ק"ג']),
      cartons: num(h['מספר קרטונים']),
      grade: h['סוג קטיף'] || null,
      linkedPlanIds: linkedIds(h['תוכניות שתילה']),
      matchingPlanNumbers: matching.map((p) => p.number),
      hasMatchingHarvestReport: hasReport,
      empty: !date && !structureId && num(h['כמות ק"ג']) === null && num(h['מספר קרטונים']) === null,
    };
  });
  for (const h of harvestTable) {
    if (h.empty) {
      dataIssues.push({ kind: 'רשומה ריקה', table: HARVESTS_TABLE, id: h.id, number: h.number,
        detail: `קטיף #${h.number} ריק לגמרי (בלי תאריך, מבנה או כמות)` });
    } else if (!h.hasMatchingHarvestReport) {
      dataIssues.push({ kind: 'קטיף בלי דיווח עבודה', table: HARVESTS_TABLE, id: h.id, number: h.number,
        detail: `קטיף #${h.number} (${h.structureName || 'מבנה לא ידוע'}, ${h.date || 'בלי תאריך'}, ${h.kg ?? '?'} ק"ג / ${h.cartons ?? '?'} קרטון) — אין דיווח עבודה מסוג קטיף לאותו מבנה ותאריך, ולכן התוצרת הזו **אינה נספרת** בבפועל. אם זה קטיף אמיתי — צריך דיווח עבודה מתאים.` });
    }
  }

  return {
    today: todayYmd,
    ledgerOk: ledger.ok,
    totals: {
      plans: plans.length,
      forecastRows: forecasts.length,
      orphanForecastRows: orphanForecasts,
      harvestReports: reports.length,
      harvestReportsAssigned: reports.filter((r) => r.planId).length,
      harvestTableRecords: (data.harvests || []).length,
      deliveryNotes: (data.notes || []).length,
      invoices: (data.invoices || []).length,
    },
    rows,
    plans: planActuals,
    kgWrites,
    conflicts,
    needsDecision,
    dataIssues,
    harvestTable,
    // השדות שהמשימה ביקשה ולא ניתן היה ליצור (403) — מוצג לתמר בדוח
    missingAirtableFields: [
      { table: FORECAST_TABLE, field: 'הכנסה בפועל', workaround: 'מחושב ומוחזר מ-/api/actuals/report' },
      { table: FORECAST_TABLE, field: 'מקור בפועל', workaround: 'מחושב ומוחזר מ-/api/actuals/report' },
      { table: PLANS_TABLE, field: 'תחילת קטיף בפועל', workaround: 'נגזר מדיווחי הקטיף' },
      { table: PLANS_TABLE, field: 'סוף קטיף בפועל', workaround: 'נגזר מדיווחי הקטיף' },
    ],
  };
}

// ------------------------------------------------------------
// הקריאה מ-Airtable + הכתיבה
// ------------------------------------------------------------

export async function fetchActualsData() {
  const [plans, forecasts, harvests, works, notes, invoices, structures, crops] = await Promise.all([
    fetchRecords(PLANS_TABLE, {}),
    fetchRecords(FORECAST_TABLE, {}),
    fetchRecords(HARVESTS_TABLE, {}),
    fetchRecords(WORKS_TABLE, {}),
    fetchRecords(NOTES_TABLE, {}),
    fetchRecords(INVOICES_TABLE, {}),
    fetchRecords(STRUCTURES_TABLE, {}),
    fetchRecords(CROPS_TABLE, {}),
  ]);
  return { plans, forecasts, harvests, works, notes, invoices, structures, crops };
}

/**
 * מחשב ומעדכן. dryRun=true (ברירת מחדל) — קריאה בלבד, מחזיר מה *היה*
 * משתנה. אידמפוטנטי: הרצה שנייה מיד אחרי הראשונה מחזירה 0 כתיבות.
 *
 * הטבלה היחידה שנכתבת היא `תחזית שתילה שבועית` (השדה `קג בפועל`).
 */
export async function syncActuals({ dryRun = true, today } = {}) {
  const data = await fetchActualsData();
  const ledger = loadLedger();
  const report = computeActuals(data, { today, ledger });
  report.dryRun = dryRun;

  if (dryRun) return report;

  report.kgUpdated = 0;
  report.kgCleared = 0;
  report.writeErrors = [];

  const ledgerRows = { ...ledger.rows };
  for (const w of report.kgWrites) {
    try {
      await updateRecord(FORECAST_TABLE, w.forecastId, { [KG_ACTUAL_FIELD]: w.to });
      if (w.to === null) { delete ledgerRows[w.forecastId]; report.kgCleared += 1; } else { ledgerRows[w.forecastId] = w.to; report.kgUpdated += 1; }
    } catch (e) {
      console.error(`[actuals] כתיבת "${KG_ACTUAL_FIELD}" לשורה ${w.forecastId} נכשלה: ${e.message}`);
      report.writeErrors.push({ kind: 'קג בפועל', id: w.forecastId, error: e.message });
    }
  }
  // גם שורות שלא נכתבו עכשיו (כי הן כבר נכונות) נרשמות בפנקס — אחרת
  // ערך שהמנוע כתב בריצה קודמת שבה הפנקס נכשל ייחשב לנצח "קלט-יד".
  for (const row of report.rows) {
    if (row.actualKg !== null && row.currentKgInAirtable !== null
      && round2(row.currentKgInAirtable) === row.actualKg && ledgerRows[row.forecastId] === undefined) {
      ledgerRows[row.forecastId] = row.actualKg;
    }
  }
  report.ledgerSaved = saveLedger(ledgerRows);
  invalidateActualsReport();
  return report;
}

// ------------------------------------------------------------
// מטמון-קריאה לדוח
// ------------------------------------------------------------
// כל חישוב-דוח הוא שמונה קריאות-טבלה מלאות ל-Airtable. מסך תוכנית
// השתילה קורא את הדוח בכל טעינה (וגם ב-useAutoRefresh), ועל vCPU אחד
// זה עומס מיותר: הנתונים משתנים רק כשנשמר דיווח/תעודה, ואז בכל מקרה
// רצה סריקה מדובנסת. 60 שניות הוא אותו סדר-גודל של READ_TTL_MS (30
// שניות) ב-server.js. כתיבה אמיתית (`syncActuals({dryRun:false})`)
// תמיד מחשבת מחדש ומאפסת את המטמון.
export const REPORT_TTL_MS = 60 * 1000;
let cachedReport = null;
let cachedAt = 0;

export function invalidateActualsReport() {
  cachedReport = null;
  cachedAt = 0;
}

export async function getActualsReport({ maxAgeMs = REPORT_TTL_MS } = {}) {
  if (cachedReport && Date.now() - cachedAt < maxAgeMs) return { ...cachedReport, cached: true };
  const report = await syncActuals({ dryRun: true });
  cachedReport = report;
  cachedAt = Date.now();
  return { ...report, cached: false };
}

// ------------------------------------------------------------
// מתזמן: בעלייה ואחר כך תקופתית, + טריגר מדובנס אחרי שמירה
// ------------------------------------------------------------

export const FIRST_RUN_MS = 3 * 60 * 1000;   // ~3 דק' אחרי העלייה (כמו analysis-retry)
export const INTERVAL_MS = 15 * 60 * 1000;   // ואחר כך כל 15 דקות
export const DEBOUNCE_MS = 30 * 1000;        // אחרי שמירת עבודה/תעודה

let running = false;
let debounceTimer = null;
let onDone = null;

/** הרצה אחת, בלי לזרוק — vCPU אחד, לכן אין שתי ריצות במקביל */
export async function runActualsSyncOnce(reason) {
  if (running) {
    console.log(`[actuals] ${reason}: ריצה כבר מתבצעת — מדלג`);
    return null;
  }
  running = true;
  try {
    const report = await syncActuals({ dryRun: false });
    const bits = [`${report.kgUpdated} שורות עודכנו`, `${report.kgCleared} נוקו`,
      `${report.totals.harvestReportsAssigned}/${report.totals.harvestReports} דיווחי קטיף שויכו`,
      `${report.needsDecision.length} דורשים החלטה`];
    if (report.conflicts.length) bits.push(`${report.conflicts.length} התנגשויות (לא נדרסו)`);
    if (report.writeErrors.length) bits.push(`${report.writeErrors.length} כשלי כתיבה`);
    console.log(`[actuals] ${reason}: ${bits.join(', ')}`);
    if ((report.kgUpdated || report.kgCleared) && onDone) onDone();
    return report;
  } catch (e) {
    console.error(`[actuals] ${reason}: כשל כללי — ${e.message}`);
    return null;
  } finally {
    running = false;
  }
}

/**
 * טריגר מדובנס: נקרא אחרי שמירת עבודת-קטיף / תעודת משלוח. כמה
 * שמירות רצופות (למשל הזנת חמישה דיווחים בשורה) מתכנסות לריצה אחת.
 */
export function scheduleActualsSync(reason) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runActualsSyncOnce(reason);
  }, DEBOUNCE_MS);
  if (debounceTimer.unref) debounceTimer.unref();
}

/** @param {{ invalidate?: () => void }} opts */
export function startActualsSync({ invalidate } = {}) {
  onDone = invalidate || null;
  const first = setTimeout(() => {
    runActualsSyncOnce('סריקה ראשונה אחרי עלייה');
    const timer = setInterval(() => runActualsSyncOnce('סריקה תקופתית'), INTERVAL_MS);
    if (timer.unref) timer.unref();
  }, FIRST_RUN_MS);
  if (first.unref) first.unref();
}

export default { computeActuals, syncActuals, startActualsSync, scheduleActualsSync, runActualsSyncOnce };
