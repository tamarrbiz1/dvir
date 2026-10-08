// ============================================================
// איסוף מחזורי להורדת-מלאי נגזרת (תעודות משלוח/חשבוניות) — "task Y",
// 2026-10-08. ר' logistics-deduction.js להסבר המלא על ההורדה עצמה,
// ו-autoAnalyzeLogisticsInventory ב-server.js לריטריי-החי שרץ מיד
// אחרי העלאה (עד ~27 דקות, בזיכרון התהליך בלבד).
//
// למה צריך את זה בנוסף לריטריי-החי: הריטריי חי *רק בזיכרון* — אם
// השרת מתאתחל (deploy, restart, קריסה) באמצע ההמתנה ל-Make שימלא
// "כמות קרטונים"/"מספר משטחים", הריטריי נעלם ולא ממשיך. לתעודות
// משלוח/חשבוניות אין שדה "הערות" משלהן (ר' הערת הכותרת ב-
// logistics-deduction.js) — כך שאין שום state על המסמך-המקור עצמו
// לשחזר ממנו "איפה הפסקתי". הפתרון: לסרוק מתקופה-לתקופה את המסמכים
// עצמם ולבדוק אם השדה כבר התמלא אבל התגית-אידמפוטנטיות
// ([מלאי-D:<table>:<id>:<category>], ר' doneTag ב-logistics-deduction.js)
// עדיין לא נכתבה על פריט-המלאי — בדיוק התבנית של
// startSprayImportSweep/sweepSprayReports ב-spray-report-import.js,
// ששמנו כאן בכוונה (לא תבנית חדשה).
//
// ⚠️⚠️ תיחום-בטיחות קריטי (קרא לפני שינוי): פריטי "מלאי בסיסי" האמיתיים
// נוצרו-מחדש ביד הבוקר של 2026-10-08 עם record id חדשים — כלומר
// ה"הערות" שלהם *לא* מכילות את ההיסטוריה הישנה (אין בהן אף תגית
// [מלאי-D:...] שנכתבה לפני הבוקר הזה, גם אם המסמך המקורי כבר נוכה
// בפועל במערכת הישנה). אם האיסוף היה סורק "כל מסמך אי-פעם" הוא היה
// *מנכה בשנית* כל תעודה/חשבונית היסטורית (למשל כל התעודות מ-6-7.10
// שמופיעות ביומן — recJx50..., recPuhd0..., וכו') כי "אין תגית" ≠
// "לא נוכה מעולם", רק "לא נוכה מאז שהפריט נוצר-מחדש". זה היה *מזהם
// את המלאי האמיתי* (קרטונים/נילונים/כובעים/משטחי-עץ) בכפילויות.
//
// הבטיחות: בדיוק כמו spray-report-import.js — cutoff נשמר בקובץ
// (data/logistics-sweep-state.json) ונקבע ל"עכשיו" **פעם אחת בלבד**,
// בהפעלה הראשונה של הקוד הזה (כלומר הדיפלוי הזה, אחרי-הבוקר). מאותו
// רגע ואילך הוא קבוע-לנצח (נשרד restart/deploy עתידיים) — האיסוף
// *לעולם* לא סורק מסמך שנוצר לפני רגע-הדיפלוי, בלי קשר לכמה "ימים
// אחורה" מבקשים. זה אוטומטית חוסם גם את כל מה שקרה הבוקר (יצירת
// הפריטים מחדש) וגם את כל ההיסטוריה שלפניו. תיעוד הריצה בדוח-הסיום
// יפרט את ה-cutoff בפועל.
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

// אותה תבנית בדיוק כמו ב-server.js/spray-report-import.js — רשומות
// בדיקה (qa-check.mjs) לעולם לא נסרקות, גם אם "נשכחו" במקרה.
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}\b|\bPERF-TEST\b/;
const isTestRecord = (rec) => TEST_RECORD_PATTERN.test(JSON.stringify(rec));

// לכל טבלת-מקור: השדה שסימנו "Make סיים למלא" + הקטגוריות שהוא גוזר.
// בדיוק כמו deriveDeductions ב-logistics-deduction.js (לא כפילות-לוגיקה —
// זו רק בדיקת-סף זולה כדי לדעת אם שווה לקרוא ל-analyzeLogisticsInventory
// בכלל; הלוגיקה-האמיתית, כולל ההצלבה בין תעודה לחשבונית, עדיין קורית
// שם ושם בלבד).
const SOURCES = [
  { table: NOTES_TABLE, field: 'כמות קרטונים', categories: ['קרטונים', 'נילונים', 'כובעים'] },
  { table: INVOICES_TABLE, field: 'מספר משטחים', categories: ['משטחי עץ'] },
];

function filled(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (s === '') return false;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n !== 0; // "0"/ריק = Make עוד לא מילא (ר' num() ב-logistics-deduction.js)
}

function doneTag(table, id, category) {
  return `[מלאי-D:${table}:${id}:${category}]`;
}

/** כמו fetchRecords, אבל שומר גם createdTime (לא נחשף ע"י fetchRecords המשותף) */
async function fetchWithCreatedTime(table) {
  maybeFail('fetch', table);
  const base = getBase();
  const out = [];
  await new Promise((resolve, reject) => {
    base(table).select({}).eachPage(
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
  // ⚠️ ר' הערת הכותרת — cutoff = "עכשיו", פעם אחת, נשמר לצמיתות.
  const state = { cutoff: new Date().toISOString(), createdAt: new Date().toISOString() };
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[logistics-sweep] לא ניתן לשמור את קובץ המצב: ${e.message}`);
  }
  return state;
}

/**
 * סריקה בודדת: לכל מסמך (תעודה/חשבונית) שנוצר *אחרי* ה-cutoff, שהשדה
 * הרלוונטי שלו כבר מולא, אבל שלפריט-המלאי המתאים חסרה התגית לפחות
 * לקטגוריה אחת — מריץ עליו analyzeLogisticsInventory (אידמפוטנטי: אם
 * חלק כבר נוכה בעבר, רק מה שחסר יורד בפועל). `lock` הוא withInventoryLock
 * מ-server.js (מוזרק כפרמטר — אותו מנעול בדיוק שהריטריי-החי משתמש בו,
 * לפי אותו מפתח `logistics:<table>:<id>`, כדי שלעולם לא ירוצו שניהם
 * בבת-אחת על אותה רשומה).
 */
export async function sweepLogisticsInventory({ lock, onResult } = {}) {
  const state = loadState();
  const withLock = lock || ((key, fn) => fn());
  const report = { cutoff: state.cutoff, checked: 0, candidates: 0, processed: 0, errors: [] };

  const inventoryItems = await fetchRecords(INVENTORY_TABLE, {});
  const notesByCategory = new Map(); // category -> notes string
  for (const item of inventoryItems) {
    if (TEST_RECORD_PATTERN.test(String(item['קטגוריה'] || ''))) continue;
    notesByCategory.set(item['קטגוריה'], String(item['הערות'] || ''));
  }

  for (const src of SOURCES) {
    let records;
    try {
      records = await fetchWithCreatedTime(src.table);
    } catch (e) {
      report.errors.push(`קריאת "${src.table}" נכשלה: ${e.message}`);
      continue;
    }
    for (const rec of records) {
      report.checked++;
      if (!rec.createdTime || rec.createdTime < state.cutoff) continue; // ⚠️ לעולם לא לפני ה-cutoff
      if (isTestRecord({ id: rec.id, ...rec.fields })) continue; // רשומות-בדיקה — דילוג מלא, לא רק סינון תצוגה
      if (!filled(rec.fields[src.field])) continue; // Make עוד לא סיים — יתפס בסיבוב הבא (או ע"י הריטריי-החי)

      const missesSome = src.categories.some((cat) => {
        const notes = notesByCategory.get(cat);
        if (notes === undefined) return false; // אין פריט-מלאי בקטגוריה הזו בכלל — אין מה להשלים
        return !notes.includes(doneTag(src.table, rec.id, cat));
      });
      if (!missesSome) continue;

      report.candidates++;
      try {
        const result = await withLock(`logistics:${src.table}:${rec.id}`, () => analyzeLogisticsInventory(src.table, rec.id));
        report.processed++;
        onResult?.(src.table, rec.id, result);
        console.log(`[logistics-sweep] ${src.table} ${rec.id}: הושלם בהשלמה מחזורית — ${result.results.map((r) => r.deducted ? `${r.category}: ירד ${r.quantity}` : (r.skipped || r.category || '?')).join(' | ')}`);
      } catch (e) {
        report.errors.push(`${src.table}/${rec.id}: ${e.message}`);
        console.error(`[logistics-sweep] ${src.table} ${rec.id} נכשל: ${e.message}`);
      }
      // לא "מכבידים" על Airtable — מרווח קטן בין מסמך למסמך (האיסוף
      // רץ לעיתים רחוקות ולא תחת לחץ-זמן של משתמש מחכה).
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return report;
}

export function startLogisticsSweep({ lock, onResult, firstDelayMs = 90 * 1000, intervalMs = 5 * 60 * 1000 } = {}) {
  const run = () => sweepLogisticsInventory({ lock, onResult })
    .then((report) => {
      if (report.candidates > 0 || report.errors.length > 0) {
        console.log(`[logistics-sweep] סיכום: נבדקו ${report.checked}, מועמדים ${report.candidates}, הושלמו ${report.processed}, שגיאות ${report.errors.length}`);
      }
    })
    .catch((e) => console.error(`[logistics-sweep] הסריקה עצמה נכשלה: ${e.message}`));
  setTimeout(run, firstDelayMs);
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
