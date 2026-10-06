// ============================================================
// סנכרון "סיכום שבועי" (תוספת 2026-10-06, סעיף D) — "הכנסות ותחזית
// 2026" ומסך "סיכום שבועי" מציגים אפסים/ריק כי אין רשומות בטבלה
// "סיכום שבועי" שמקושרות לחשבוניות/תעודות משלוח: למסמכים יש שדה
// "קוד שבוע" (מחושב בלקוח בהעלאה, ר' client/src/utils/invoices.js /
// deliveryNotes.js ו-/api/upload-document), אבל אף רשומת-שבוע תואמת
// לא נוצרת אוטומטית, ואין קישור בחזרה.
//
// קונבנציית קוד שבוע — "YYYYMMDD-YYYYMMDD", שבוע עסקי שבת–חמישי
// (יום שישי הוא יום אי-עבודה, לא חלק משום שבוע). אומת מול רשומות
// אמיתיות בחשבוניות/תעודות משלוח (ר' server/src/weekly-sync.manual-check.md
// בתיעוד המשימה) — תאריך מסמך כלשהו (כולל יום שישי, שבו המסמך
// מועלה "למחרת" סוף השבוע) ממופה לשבוע שמתחיל בשבת האחרונה שחלה
// בו-ביום או לפניו (inclusive), ומסתיים חמישה ימים אחריה (יום חמישי).
// ============================================================
import { fetchRecords, createRecord, updateRecord } from './airtable.js';

export const WEEK_CODE_RE = /^\d{8}-\d{8}$/;

const WEEKLY_TABLE = 'סיכום שבועי';
export const INVOICES_TABLE = 'חשבוניות';
export const NOTES_TABLE = 'תעודות משלוח';
const SOURCE_TABLES = [INVOICES_TABLE, NOTES_TABLE];

const CODE_FIELD = 'קוד שבוע';
const WEEK_LINK_FIELD = 'סיכום שבועי'; // שדה הקישור (דו-כיווני) על חשבוניות/תעודות משלוח

const pad2 = (n) => String(n).padStart(2, '0');
const fmtYmd = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;

/**
 * תאריך (Date / מחרוזת ISO "YYYY-MM-DD" או עם חלק זמן) → קוד שבוע
 * "YYYYMMDD-YYYYMMDD" (שבת–חמישי, inclusive). null אם התאריך לא תקין.
 *
 * אלגוריתם: מוצאים את יום השבת הקרוב ביותר שחל בתאריך הנתון או לפניו
 * (inclusive) — זה תחילת השבוע; הסוף הוא חמישה ימים אחריו (יום חמישי).
 * זה עובד אחיד לכל יום בשבוע *כולל* יום שישי: ליום שישי, השבת
 * "הקודמת-או-באותו-יום" היא השבת שלפני 6 ימים — כלומר יום שישי
 * ממופה לשבוע שהסתיים יום קודם (חמישי), לא לשבוע הבא. זה תואם בדיוק
 * את הנתונים האמיתיים (למשל מסמך מתאריך 2026-08-28 (שישי) → קוד
 * 20260822-20260827, השבוע שהסתיים יום לפני).
 */
export function weekCodeFromDate(dateInput) {
  let d;
  if (dateInput instanceof Date) {
    if (Number.isNaN(dateInput.getTime())) return null;
    d = new Date(Date.UTC(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate()));
  } else {
    const s = String(dateInput ?? '').slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(d.getTime())) return null;
  }
  const day = d.getUTCDay(); // 0=יום ראשון .. 6=שבת (JS)
  const daysSinceSaturday = (day - 6 + 7) % 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - daysSinceSaturday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 5);
  return `${fmtYmd(start)}-${fmtYmd(end)}`;
}

/** true אם ל-r יש שדה-קישור מקושר לרשומת-שבוע מסוימת (weekId) */
function isLinkedTo(record, field, weekId) {
  const linked = record?.[field];
  const ids = Array.isArray(linked) ? linked.map((x) => (x && typeof x === 'object' ? x.id : x)) : [];
  return ids.includes(weekId);
}

/**
 * מוצא/יוצר רשומת "סיכום שבועי" עבור קוד נתון. אם מועבר weekMap
 * (Map code→record, שנבנה מראש ע"י sweep) — משתמש בו כדי לא לקרוא
 * מ-Airtable שוב ולא ליצור כפילות כשכמה קריאות רצות על אותו קוד;
 * אחרת קורא ישירות עם filterByFormula (קריאה עצמאית, לנוחות שימוש
 * מבחוץ ל-sweep).
 */
export async function ensureWeekRecord(code, { weekMap } = {}) {
  if (!WEEK_CODE_RE.test(String(code || ''))) {
    throw new Error(`קוד שבוע לא תקין: "${code}" (צפוי YYYYMMDD-YYYYMMDD)`);
  }
  if (weekMap?.has(code)) return weekMap.get(code);
  if (!weekMap) {
    const escaped = code.replace(/"/g, '\\"');
    const existing = await fetchRecords(WEEKLY_TABLE, { filterByFormula: `{${CODE_FIELD}} = "${escaped}"` });
    if (existing[0]) return existing[0];
  }
  const created = await createRecord(WEEKLY_TABLE, { [CODE_FIELD]: code });
  weekMap?.set(code, created);
  return created;
}

/**
 * סוקר את כל החשבוניות + תעודות המשלוח, מבטיח שלכל "קוד שבוע" קיימת
 * רשומת "סיכום שבועי" מתאימה, ומקשר (שדה "סיכום שבועי" על המסמך —
 * קישור דו-כיווני, כך שהצד השני ב"סיכום שבועי" מתמלא אוטומטית).
 *
 * dryRun=true (ברירת מחדל): קריאה בלבד, שום כתיבה ל-Airtable — מחזיר
 * דוח מה *היה* נוצר/מקושר. dryRun=false: מבצע בפועל.
 */
export async function sweep({ dryRun = true } = {}) {
  const [invoices, notes, weeks] = await Promise.all([
    fetchRecords(INVOICES_TABLE, {}),
    fetchRecords(NOTES_TABLE, {}),
    fetchRecords(WEEKLY_TABLE, {}),
  ]);

  const weekMap = new Map();
  const orphanWeeks = [];
  for (const w of weeks) {
    const code = w[CODE_FIELD];
    if (code && WEEK_CODE_RE.test(code)) weekMap.set(code, w);
    else orphanWeeks.push({ id: w.id, fieldCount: Object.keys(w).filter((k) => k !== 'id').length });
  }

  const sources = [
    ...invoices.map((record) => ({ table: INVOICES_TABLE, record })),
    ...notes.map((record) => ({ table: NOTES_TABLE, record })),
  ];

  const report = {
    dryRun,
    totals: { invoices: invoices.length, deliveryNotes: notes.length, existingWeeks: weeks.length },
    weeksToCreate: [],      // קודי שבוע שאין להם עדיין רשומה (ייחודי, ממוין)
    linksToCreate: [],      // [{table, id, code}] — מסמכים שצריך לקשר/לעדכן קישור
    alreadyLinked: 0,       // מסמכים שכבר מקושרים נכון — אין מה לעשות
    skippedNoCode: 0,       // מסמכים בלי "קוד שבוע" בכלל — לא ניתן לקשר
    skippedInvalidCode: [], // [{table, id, code}] — "קוד שבוע" בפורמט לא תקין
    orphanWeeks,            // רשומות "סיכום שבועי" בלי קוד שבוע תקין (ר' תיעוד המשימה)
  };

  const codesNeedingWeek = new Set();
  for (const { table, record } of sources) {
    const code = record[CODE_FIELD];
    if (!code) { report.skippedNoCode++; continue; }
    if (!WEEK_CODE_RE.test(code)) { report.skippedInvalidCode.push({ table, id: record.id, code }); continue; }
    const targetWeek = weekMap.get(code);
    if (targetWeek && isLinkedTo(record, WEEK_LINK_FIELD, targetWeek.id)) { report.alreadyLinked++; continue; }
    if (!targetWeek) codesNeedingWeek.add(code);
    report.linksToCreate.push({ table, id: record.id, code });
  }
  report.weeksToCreate = [...codesNeedingWeek].sort();

  if (dryRun) return report;

  // ------ ריצה אמיתית: קודם יוצרים את כל השבועות החסרים, אחר כך מקשרים ------
  report.weeksCreated = [];
  for (const code of report.weeksToCreate) {
    const created = await ensureWeekRecord(code, { weekMap });
    report.weeksCreated.push({ code, id: created.id });
  }
  report.linksCreated = 0;
  report.linkErrors = [];
  for (const item of report.linksToCreate) {
    const week = weekMap.get(item.code);
    if (!week) { report.linkErrors.push({ ...item, error: 'רשומת שבוע לא נמצאה/נוצרה' }); continue; }
    try {
      await updateRecord(item.table, item.id, { [WEEK_LINK_FIELD]: [week.id] });
      report.linksCreated++;
    } catch (e) {
      // 2026-10-06 (M3, ליל-בדיקות): נשמר ב-linkErrors (הקורא דרך ה-API
      // יכול לפספס שדה הזה ברשימה) — console.error עם הקשר מלא כדי שגם
      // תקלה שלא נבדקת בתגובה תישאר גלויה ביומן השרת.
      console.error(`[weekly-sync] קישור ${item.table}/${item.id} לשבוע ${item.code} נכשל: ${e.message}`);
      report.linkErrors.push({ ...item, error: e.message });
    }
  }
  return report;
}

export default { weekCodeFromDate, ensureWeekRecord, sweep, WEEK_CODE_RE, INVOICES_TABLE, NOTES_TABLE };
