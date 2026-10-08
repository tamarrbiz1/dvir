// ============================================================
// איסוף מחזורי להורדת-מלאי נגזרת (תעודות משלוח/חשבוניות) — "task Y",
// 2026-10-08. ר' logistics-deduction.js להסבר המלא על ההורדה עצמה,
// ו-autoAnalyzeLogisticsInventory ב-server.js לריטריי-החי שרץ מיד אחרי
// העלאה (עד ~29 דקות, בזיכרון התהליך בלבד).
//
// למה צריך את זה *בנוסף* לריטריי-החי: הריטריי חי רק בזיכרון — אם השרת
// מתאתחל (deploy, restart, קריסה) באמצע ההמתנה ל-Make שימלא "כמות
// קרטונים"/"מספר משטחים", הריטריי נעלם ולא ממשיך, והמשתמשת חוזרת בדיוק
// לתסמין המקורי: ההורדה קורית רק בלחיצה ידנית. לתעודות משלוח/חשבוניות
// אין שדה "הערות" משלהן (ר' הערת הכותרת ב-logistics-deduction.js), כך
// שאין שום state על המסמך-המקור לשחזר ממנו "איפה הפסקתי". הפתרון: לסרוק
// מדי פעם את המסמכים ולבדוק אם השדה כבר התמלא אבל התגית
// [מלאי-D:<table>:<id>:<category>] (ר' doneTag ב-logistics-deduction.js)
// עדיין לא נכתבה על פריט-המלאי — בדיוק התבנית של
// startSprayImportSweep/sweepSprayReports ב-spray-report-import.js.
//
// ============================================================
// ⚠️⚠️ תיחום-בטיחות קריטי — קרא לפני כל שינוי כאן
// ============================================================
// פריטי "מלאי בסיסי" האמיתיים בקטגוריות משטחי עץ/נילונים/קרטונים/כובעים
// **נוצרו מחדש ביד בבוקר 2026-10-08 עם record id חדשים** (במתכוון; לא
// שוחזרו מהאשפה). לכן שדה "הערות" שלהם ריק מההיסטוריה: אין בו אף תגית
// [מלאי-D:...] שנכתבה לפני אותו בוקר — גם עבור מסמכים שבאמת נוכו בפועל.
//
// כלומר, עבור כל מסמך היסטורי, "אין תגית" **אינו** אומר "לא נוכה מעולם",
// אלא רק "לא נוכה מאז שהפריט נוצר-מחדש". אם האיסוף היה סורק "כל מסמך
// אי-פעם", הוא היה מנכה בשנית כל תעודה/חשבונית היסטורית (למשל כל התעודות
// מ-6-7.10 שביומן — recJx50..., recPuhd0..., recQ8cmL..., recoBwKN...) —
// כלומר מזהם את המלאי האמיתי בכפילויות. זה הכיוון המסוכן, והוא חייב
// להישאר חסום.
//
// שתי חסימות בלתי-תלויות, ו**שתיהן** חייבות לעבור כדי שמסמך ייסרק:
//
//   1. רצפת-דיפלוי קבועה (cutoff): נקבעת פעם אחת בלבד, לרגע עליית
//      התהליך הראשון שמריץ את הקוד הזה (כלומר הדיפלוי הזה — אחרי בוקר
//      ה-8.10), ונשמרת לצמיתות ב-data/logistics-sweep-state.json. היא
//      שורדת restart/deploy עתידיים ולעולם לא זזה קדימה. כל מה שנוצר
//      לפני רגע הדיפלוי — כולל יצירת-הפריטים-מחדש של הבוקר וכל
//      ההיסטוריה שלפניה — מחוץ לתחום, לנצח.
//   2. חלון מתגלגל (LOOKBACK_DAYS): גם אחרי שהרצפה נקבעה, סורקים רק
//      מסמכים מ-3 הימים האחרונים. זה חוסם "זחילה" של היקף-הסריקה עם
//      הזמן (בלעדיו, בעוד חצי שנה האיסוף היה סורק חצי שנה של מסמכים
//      כל 10 דקות) ושומר על עומס-Airtable קבוע.
//
// הרצפה האפקטיבית היא **המאוחר מהשניים**. בנוסף, אם כתיבת קובץ-המצב
// נכשלת — loadState מחזיר cutoff="עכשיו" בכל ריצה, כלומר האיסוף לא
// יסרוק שום דבר. זה כיוון-הכשל הנכון (fail closed): מוטב שהאיסוף לא
// יעבוד מאשר שינכה פעמיים.
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBase, fetchRecords } from './airtable.js';
import { maybeFail } from './fault-inject.js';
import { analyzeLogisticsInventory } from './logistics-deduction.js';
import { INVOICES_TABLE, NOTES_TABLE } from './weekly-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'logistics-sweep-state.json');

const INVENTORY_TABLE = 'מלאי בסיסי';

// רגע עליית התהליך (זמן ייבוא המודול — server.js מייבא אותו בעלייה).
// משמש כ-cutoff בפעם הראשונה בלבד, כדי שגם מסמך שהועלה בדקות שבין
// העלייה לסריקה הראשונה ייכנס לתחום, ובלי לפתוח שום חלון לאחור.
const PROCESS_START = new Date().toISOString();

// ר' תיחום-הבטיחות בכותרת — החלון המתגלגל מעל רצפת-הדיפלוי.
const LOOKBACK_DAYS = 3;

// אותה תבנית בדיוק כמו ב-server.js/spray-report-import.js — רשומות
// בדיקה (qa-check.mjs) לעולם לא נסרקות, גם אם "נשכחו" במקרה. קריטי
// כאן: רשומת-QA בטבלה מנוטרת-Make מקבלת כמויות אמיתיות מהקובץ-האמת
// שהיא חייבת לצרף, והקטגוריות שלה מצביעות על פריט-המלאי האמיתי.
// ⚠️ גבול-המילה בסוף חלופת-QA הוסר ב-8.10 — בלעדיו "QA-<ספרות>b" חמק
// מהזיהוי, וזה בדיוק מה שאפשר לתעודת-QA לנכות 1648 יחידות אמיתיות.
// ר' ההערה המלאה ליד TEST_RECORD_PATTERN ב-server.js.
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}|\bPERF-TEST\b/;
const isTestRecord = (rec) => TEST_RECORD_PATTERN.test(JSON.stringify(rec));

// לכל טבלת-מקור: השדה שמסמן "Make סיים למלא" + הקטגוריות שהוא גוזר.
// זו בדיקת-סף זולה בלבד, כדי לדעת אם שווה לקרוא ל-analyzeLogisticsInventory
// בכלל; הלוגיקה האמיתית (כולל ההצלבה בין תעודה לחשבונית וסכומי-השבוע)
// נשארת ב-deriveDeductions/analyzeLogisticsInventory ושם בלבד.
const SOURCES = [
  { table: NOTES_TABLE, field: 'כמות קרטונים', categories: ['קרטונים', 'נילונים', 'כובעים'] },
  { table: INVOICES_TABLE, field: 'מספר משטחים', categories: ['משטחי עץ'] },
];

// זהה ל-num() ב-logistics-deduction.js: ריק/0 = "Make עוד לא מילא".
function filled(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (s === '') return false;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n !== 0;
}

function doneTag(table, id, category) {
  return `[מלאי-D:${table}:${id}:${category}]`;
}

/**
 * פונקציה טהורה (נבדקת ב-qa-check.mjs): הרצפה האפקטיבית לסריקה —
 * המאוחר מבין רצפת-הדיפלוי הקבועה לבין החלון המתגלגל. ר' כותרת הקובץ.
 */
export function sweepFloor(cutoffIso, nowMs = Date.now(), lookbackDays = LOOKBACK_DAYS) {
  const rolling = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  return cutoffIso && cutoffIso > rolling ? cutoffIso : rolling;
}

/**
 * פונקציה טהורה (נבדקת ב-qa-check.mjs): האם המסמך הזה מועמד להשלמה?
 * מחזירה סיבת-דילוג מפורשת (string) או null אם הוא מועמד — כך שהבדיקות
 * יכולות לאמת *למה* מסמך נדחה, ולא רק שנדחה.
 */
export function sweepCandidateReason(rec, src, floorIso, notesByCategory) {
  if (!rec.createdTime) return 'אין createdTime';
  if (rec.createdTime < floorIso) return 'לפני רצפת-הסריקה'; // ⚠️ החסימה שמונעת ניכוי-כפול היסטורי
  if (isTestRecord({ id: rec.id, ...rec.fields })) return 'רשומת-בדיקה';
  if (!filled(rec.fields[src.field])) return `"${src.field}" עוד לא מולא`;
  const missing = src.categories.filter((cat) => {
    const notes = notesByCategory.get(cat);
    if (notes === undefined) return false; // אין פריט-מלאי בקטגוריה — אין מה להשלים
    return !notes.includes(doneTag(src.table, rec.id, cat));
  });
  if (!missing.length) return 'כל הקטגוריות כבר נוכו';
  return null;
}

/**
 * קורא את המסמכים שנוצרו אחרי הרצפה. התיחום נעשה **גם** ב-Airtable
 * (filterByFormula על CREATED_TIME — חוסך משיכת טבלה שלמה כל 10 דקות)
 * **וגם** בקוד (ר' sweepCandidateReason) — הגנה כפולה, כי תקלה בנוסחה
 * לא אמורה להיות מה שמפריד בין "לא מנכים היסטוריה" ל"מנכים".
 */
async function fetchSince(table, floorIso) {
  maybeFail('fetch', table);
  const base = getBase();
  const out = [];
  await new Promise((resolve, reject) => {
    base(table)
      .select({ filterByFormula: `IS_AFTER(CREATED_TIME(), DATETIME_PARSE('${floorIso}'))` })
      .eachPage(
        (page, fetchNextPage) => {
          for (const r of page) out.push({ id: r.id, fields: r.fields, createdTime: r._rawJson?.createdTime || null });
          fetchNextPage();
        },
        (err) => (err ? reject(err) : resolve()),
      );
  });
  return out;
}

function loadState() {
  if (existsSync(STATE_PATH)) {
    try {
      const s = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      if (s?.cutoff) return s;
    } catch { /* נבנה מחדש למטה */ }
  }
  // ⚠️ ר' תיחום-הבטיחות בכותרת — נקבע פעם אחת, לרגע עליית התהליך.
  const state = { cutoff: PROCESS_START, createdAt: new Date().toISOString() };
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    console.log(`[logistics-sweep] נקבעה רצפת-דיפלוי קבועה: ${state.cutoff} (מסמכים מלפני כן לעולם לא ייסרקו)`);
  } catch (e) {
    // fail closed: בלי קובץ-מצב ה-cutoff יהיה "עכשיו" בכל ריצה, כלומר
    // האיסוף לא יטפל בכלום — מוטב כך מאשר לנכות פעמיים.
    console.warn(`[logistics-sweep] לא ניתן לשמור קובץ-מצב (${e.message}) — האיסוף לא יטפל במסמכים עד שייפתר`);
  }
  return state;
}

/**
 * סריקה בודדת. `lock` הוא withInventoryLock מ-server.js (מוזרק) — אותו
 * מנעול ואותו מפתח `logistics:<table>:<id>` שהריטריי-החי משתמש בהם, כדי
 * ששניהם לעולם לא ירוצו יחד על אותה רשומה.
 */
export async function sweepLogisticsInventory({ lock, onResult } = {}) {
  const state = loadState();
  const floor = sweepFloor(state.cutoff);
  const withLock = lock || ((key, fn) => fn());
  const report = { cutoff: state.cutoff, floor, checked: 0, candidates: 0, processed: 0, errors: [] };

  const inventoryItems = await fetchRecords(INVENTORY_TABLE, {});
  const notesByCategory = new Map(); // category -> notes
  for (const item of inventoryItems) {
    notesByCategory.set(item['קטגוריה'], String(item['הערות'] || ''));
  }

  for (const src of SOURCES) {
    let records;
    try {
      records = await fetchSince(src.table, floor);
    } catch (e) {
      report.errors.push(`קריאת "${src.table}" נכשלה: ${e.message}`);
      continue;
    }
    for (const rec of records) {
      report.checked++;
      if (sweepCandidateReason(rec, src, floor, notesByCategory) !== null) continue;

      report.candidates++;
      try {
        const result = await withLock(`logistics:${src.table}:${rec.id}`, () => analyzeLogisticsInventory(src.table, rec.id));
        report.processed++;
        onResult?.(src.table, rec.id, result);
        // עדכון המפה המקומית: מה שירד עכשיו שינה את הערות-הפריט בפועל,
        // ובלי זה מסמך נוסף באותה סריקה היה ממשיך לראות את הקטגוריה
        // כ"חסרת תגית" ומריץ עליה ניתוח מיותר.
        for (const r of result.results || []) {
          if (r.deducted && r.category) {
            notesByCategory.set(r.category, `${notesByCategory.get(r.category) || ''}\n${doneTag(src.table, rec.id, r.category)}`);
          }
        }
        console.log(`[logistics-sweep] ${src.table} ${rec.id}: הושלם בהשלמה מחזורית — ${(result.results || []).map((r) => (r.deducted ? `${r.category}: ירד ${r.quantity}` : (r.skipped || r.category || '?'))).join(' | ')}`);
      } catch (e) {
        report.errors.push(`${src.table}/${rec.id}: ${e.message}`);
        console.error(`[logistics-sweep] ${src.table} ${rec.id} נכשל: ${e.message}`);
      }
      // לא מכבידים על Airtable (תקרה ~5 בקשות/שנ' לבסיס); האיסוף רץ
      // לעיתים רחוקות ואף אחד לא מחכה לו.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return report;
}

export function startLogisticsSweep({ lock, onResult, firstDelayMs = 90 * 1000, intervalMs = 10 * 60 * 1000 } = {}) {
  const run = () => sweepLogisticsInventory({ lock, onResult })
    .then((report) => {
      if (report.candidates > 0 || report.errors.length > 0) {
        console.log(`[logistics-sweep] סיכום: נבדקו ${report.checked}, מועמדים ${report.candidates}, הושלמו ${report.processed}, שגיאות ${report.errors.length} (רצפה ${report.floor})`);
      }
    })
    .catch((e) => console.error(`[logistics-sweep] הסריקה עצמה נכשלה: ${e.message}`));
  setTimeout(run, firstDelayMs);
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
