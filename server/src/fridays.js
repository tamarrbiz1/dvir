// ============================================================
// ימי שישי תמיד ברשימת "ימי אי עבודה" — 2026-10-05 11:40
// ------------------------------------------------------------
// הלקוחה שינתה את סקריפטי Airtable ("חשב תוכנית"/"הזז תוכנית") כך
// שהם בודקים רק את טבלת "ימי אי עבודה" (בלי בדיקת שישי/שבת קשיחה).
// במקום ייבוא ידני כל שנה: בכל עליית שרת ופעם ביום בודקים את השנה
// הנוכחית והבאה, ומשלימים ימי שישי חסרים. שבת נשארת לפי בחירה
// (לעיתים עובדים במוצ"ש) — לא נוגעים בה כאן.
//
// פעם אחת בלבד לכל שנה: אם הלקוחה מוחקת יום שישי ספציפי כי עבדו בו,
// אסור להחזיר אותו באיסוף הבא. קובץ הסמן server/data/fridays-ensured.json
// (לא ב-git) מתעד אילו שנים כבר "טופלו" — ברגע שטופלה, לעולם לא
// נבדקת שוב (גם אם רשומות נמחקות ממנה אחר כך).
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRecords, createRecords, updateRecord } from './airtable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const MARKER_PATH = path.join(DATA_DIR, 'fridays-ensured.json');

const NONWORKDAYS_TABLE = 'ימי אי עבודה';
const PLANS_TABLE = 'תוכניות שתילה';
const JEWISH_VALUE = 'יהודי'; // הערך היחיד הקיים בשדה "סוג החג" שרלוונטי כאן — kindOf בצד הלקוח מזהה שישי/שבת ומציג "יום מנוחה" (ר' commit 19f58d9)

function loadMarker() {
  if (!existsSync(MARKER_PATH)) return {};
  try { return JSON.parse(readFileSync(MARKER_PATH, 'utf8')); } catch { return {}; }
}

function saveMarker(marker) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2), 'utf8');
}

/** כל תאריכי יום שישי (YYYY-MM-DD) של שנה גרגוריאנית — לוח מקומי, כמו NonWorkDaysPage.jsx */
function fridaysOfYear(year) {
  const pad = (n) => String(n).padStart(2, '0');
  const out = [];
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    if (d.getDay() === 5) out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** חישוב מחדש של תוכניות השתילה של שנה (false→true על "חשב תוכנית") — אותו דפוס כמו forceTrigger בלקוח */
async function recalcPlansOfYear(year) {
  const plans = await fetchRecords(PLANS_TABLE, {});
  const list = plans.filter((p) => String(p['שנת תוכנית'] || '') === String(year));
  for (const p of list) {
    await updateRecord(PLANS_TABLE, p.id, { 'חשב תוכנית': false });
    await updateRecord(PLANS_TABLE, p.id, { 'חשב תוכנית': true });
  }
  return list.length;
}

/**
 * מוודא שלשנה נתונה יש את כל ימי השישי ב"ימי אי עבודה" — רק פעם אחת
 * אי-פעם לכל שנה (ר' הסבר קובץ הסמן למעלה). לא זורק — כשל נרשם ללוג
 * ולא מפיל את השרת.
 */
export async function ensureFridays(year) {
  const marker = loadMarker();
  if (marker[year]) return; // השנה הזו כבר טופלה אי-פעם — לא בודקים שוב לעולם

  try {
    const existing = await fetchRecords(NONWORKDAYS_TABLE, {});
    const existingDates = new Set(
      existing
        .filter((r) => String(r['תאריך'] || '').slice(0, 4) === String(year))
        .map((r) => String(r['תאריך']).slice(0, 10))
    );
    const missing = fridaysOfYear(year).filter((d) => !existingDates.has(d));

    let created = 0;
    if (missing.length) {
      // createRecords כבר מחלקת ל-מנות של 10 (מגבלת Airtable) בעצמה
      await createRecords(NONWORKDAYS_TABLE, missing.map((date) => ({ 'תאריך': date, 'סוג החג': JEWISH_VALUE })));
      created = missing.length;
    }

    // הסימון נשמר **לפני** recalc בכוונה: גם אם recalc נכשל (למשל Airtable
    // איטי), השנה כבר "טופלה" ולא תיבדק שוב — זה בדיוק הכלל המבוקש
    // (פעם אחת לכל שנה, לא יותר), ולא תלוי בהצלחת שלב משני.
    marker[year] = true;
    saveMarker(marker);

    let recalced = 0;
    if (created > 0) {
      recalced = await recalcPlansOfYear(year).catch((e) => {
        console.error(`[fridays] ${year}: חישוב מחדש של תוכניות נכשל — ${e.message || e}`);
        return 0;
      });
    }
    console.log(`[fridays] ${year}: נוספו ${created} ימי שישי, ${recalced} תוכניות חושבו מחדש`);
  } catch (e) {
    console.error(`[fridays] ${year}: נכשל — ${e.message || e}`);
  }
}

/** מריץ מיד (שנה נוכחית + הבאה) ואז פעם ביום — לא חוסם, לא נקרא לפני app.listen */
export function scheduleFridaysCheck() {
  const run = () => {
    const y = new Date().getFullYear();
    ensureFridays(y);
    ensureFridays(y + 1);
  };
  run();
  setInterval(run, 24 * 60 * 60 * 1000);
}
