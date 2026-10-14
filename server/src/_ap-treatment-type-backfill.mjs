// ============================================================
// AP-4 — טיפולים שיובאו מדוחות לפני שנולד השדה "סוג טיפול" (14.10.2026)
// ------------------------------------------------------------
// עד משימה AP הייבוא מדוח כתב את סוג הטיפול מהדוח ("הגמעה") לשדה
// **"סוג מרסס"**, כי לא היה שדה "סוג טיפול". עכשיו יש, והייבוא כותר
// נכון — אבל הטיפולים שכבר יובאו נשארו עם הערך במקום הלא-נכון.
//
// ⚠️ **ברירת המחדל היא dryRun — דוח בלבד, בלי לשנות שום רשומה.**
// השינוי עצמו הוא החלטה של תמר (היא עשויה להעדיף שהערך יישאר, או
// לתקן ידנית). רק אחרי אישור מפורש:  APPLY=1 node src/_ap-treatment-type-backfill.mjs
//
// מה היה משתנה בהרצה מאושרת, לכל טיפול שההערות שלו נושאות את הסמן
// [מדוח ריסוסים #N] וש"סוג מרסס" שלו מזוהה כסוג טיפול:
//   • "סוג טיפול"  ← הסוג שזוהה (ריסוס / הגמעה)
//   • "סוג מרסס"   ← מתרוקן (הוא שדה לשם המכשיר)
//   • "בסיס מינון" ← **לא נוגעים** (ההוראה המפורשת של תמר)
// רשומות שה"סוג מרסס" שלהן אינו סוג טיפול ("מרסס א" — שם מכשיר תקין)
// מדווחות בנפרד ולא נוגעים בהן.
// ============================================================
import { fetchRecords, getBase, getMeta } from './airtable.js';
import { canonicalTreatmentType, matchChoice } from '../../shared/treatment-defaults.js';

const TABLE = 'ריסוסים';
const APPLY = process.env.APPLY === '1';
const MARKER_RE = /\[מדוח ריסוסים #(\d+)\]/;
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}|\bPERF-TEST\b/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const meta = await getMeta();
const typeChoices = (meta.find((t) => t.name === TABLE)?.fields?.find((f) => f.name === 'סוג טיפול')?.options?.choices || []).map((c) => c.name);
if (!typeChoices.length) {
  console.error('שדה "סוג טיפול" לא נמצא או שאין בו אפשרויות — עוצר.');
  process.exit(1);
}
console.log(`אפשרויות "סוג טיפול": ${typeChoices.join(', ')}`);

const all = await fetchRecords(TABLE, { fields: ['הערות', 'סוג מרסס', 'סוג טיפול', 'בסיס מינון'] });
const imported = all.filter((t) => MARKER_RE.test(String(t['הערות'] || '')) && !TEST_RECORD_PATTERN.test(JSON.stringify(t)));

const toFix = [];        // "סוג מרסס" שהוא בעצם סוג טיפול
const deviceNames = new Map(); // "סוג מרסס" שנראה כשם מכשיר — לא נוגעים
const already = [];     // כבר יש "סוג טיפול"

for (const t of imported) {
  if (String(t['סוג טיפול'] || '').trim()) { already.push(t); continue; }
  const sprayer = String(t['סוג מרסס'] || '').trim();
  if (!sprayer) continue;
  const canon = canonicalTreatmentType(sprayer);
  const option = canon ? matchChoice(canon, typeChoices) : null;
  // "מרסס א" מזוהה כ"ריסוס" לפי השורש, אבל הוא שם מכשיר תקין ולא סוג.
  // מפרידים: ערך שהוא **בדיוק** אחת האפשרויות (אחרי נרמול) הוא סוג;
  // כל השאר הוא שם מכשיר שתמר צריכה להחליט עליו.
  const isExactType = !!matchChoice(sprayer, typeChoices);
  if (option && isExactType) toFix.push({ id: t.id, from: sprayer, to: option, basis: t['בסיס מינון'] || null });
  else deviceNames.set(sprayer, (deviceNames.get(sprayer) || 0) + 1);
}

console.log(`\n=== ${imported.length} טיפולים מיובאים (סמן [מדוח ריסוסים #N]), מתוך ${all.length} טיפולים בסך הכל`);
console.log(`${already.length} כבר יש בהם "סוג טיפול" — לא נוגעים`);
console.log(`\n--- ${toFix.length} טיפולים שבהם "סוג מרסס" הוא בעצם סוג טיפול:`);
const byType = new Map();
for (const r of toFix) byType.set(r.to, (byType.get(r.to) || 0) + 1);
for (const [k, v] of byType) console.log(`   "${k}" × ${v}  (בסיס מינון נשאר כמו שהוא)`);
console.log(`\n--- ${[...deviceNames.values()].reduce((a, b) => a + b, 0)} טיפולים שבהם "סוג מרסס" נראה כשם מכשיר — **לא נוגעים**, להחלטת תמר:`);
for (const [k, v] of [...deviceNames].sort((a, b) => b[1] - a[1])) console.log(`   "${k}" × ${v}`);

if (!APPLY) {
  console.log(`\n=== dryRun — לא שונתה אף רשומה. להרצה אמיתית (רק אחרי אישור תמר): APPLY=1 node src/_ap-treatment-type-backfill.mjs`);
  process.exit(0);
}

const base = getBase();
let updated = 0;
for (let i = 0; i < toFix.length; i += 10) {
  const chunk = toFix.slice(i, i + 10);
  await base(TABLE).update(chunk.map((r) => ({ id: r.id, fields: { 'סוג טיפול': r.to, 'סוג מרסס': '' } })));
  updated += chunk.length;
  if (i + 10 < toFix.length) await sleep(250);
}
console.log(`\n=== עודכנו ${updated} טיפולים. "בסיס מינון" לא שונה באף רשומה.`);
