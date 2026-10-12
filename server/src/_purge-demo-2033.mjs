// ============================================================
// מחיקת שנת הדמה 2033 במכה אחת (משימה AH, 12.10.2026)
// ------------------------------------------------------------
// הרצה:         node server/src/_purge-demo-2033.mjs
// רק להציג:     node server/src/_purge-demo-2033.mjs --dry-run
//
// מוחק **אך ורק** את מה ש-`_seed-demo-2033.mjs` יצר, ולפי סימון
// חד-משמעי: `שנת תוכנית = 2033` בתוכניות, ו-`שנה = 2033` במחירים.
// שנות-האמת הן 2025–2027 (ר' _plan-anomalies.mjs), ואין שום רשומת
// 2033 שאינה דמה.
//
// סדר המחיקה חשוב: קודם התחזיות השבועיות והתקופות (הילדים), ואז
// התוכניות (ההורה) — אחרת נשארות רשומות-יתומות בלי תוכנית מקושרת,
// בדיוק 112 הרשומות שתועדו ב-AF כשריד מריצות עבר.
// ============================================================
import { fetchRecords, deleteRecord } from './airtable.js';

const YEAR = 2033;
const DRY = process.argv.includes('--dry-run');
const linked = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const plans = (await fetchRecords('תוכניות שתילה', {})).filter((p) => Number(p['שנת תוכנית']) === YEAR);
const planIds = new Set(plans.map((p) => p.id));
const forecasts = (await fetchRecords('תחזית שתילה שבועית', {})).filter((f) => linked(f['תוכנית שתילה']).some((id) => planIds.has(id)));
const periods = (await fetchRecords('תקופות תוכנית', {})).filter((x) => linked(x['תוכנית שתילה']).some((id) => planIds.has(id)));
const prices = (await fetchRecords('מחירי גידול משוערים', {})).filter((p) => Number(p['שנה']) === YEAR);

console.log(`שנת דמה ${YEAR}:`);
console.log(`  תחזיות שבועיות: ${forecasts.length}`);
console.log(`  תקופות תוכנית:  ${periods.length}`);
console.log(`  תוכניות שתילה:  ${plans.length} (${plans.map((p) => p['מספר תוכנית']).join(', ')})`);
console.log(`  מחירי ${YEAR}:     ${prices.length}`);

if (DRY) { console.log('\n--dry-run — לא נמחק דבר.'); process.exit(0); }
if (!plans.length && !forecasts.length && !periods.length && !prices.length) { console.log('\nאין מה למחוק.'); process.exit(0); }

let ok = 0; const failed = [];
for (const [table, rows] of [
  ['תחזית שתילה שבועית', forecasts],
  ['תקופות תוכנית', periods],
  ['תוכניות שתילה', plans],
  ['מחירי גידול משוערים', prices],
]) {
  for (const r of rows) {
    try { await deleteRecord(table, r.id); ok += 1; }
    catch (e) {
      // ניסיון שני אחרי השהיה — מחיקה יכולה להתנגש באוטומציה שרצה
      await sleep(1500);
      try { await deleteRecord(table, r.id); ok += 1; }
      catch (e2) { failed.push(`${table}/${r.id}: ${e2.message}`); }
    }
    await sleep(200);
  }
  console.log(`  ✓ ${table}`);
}
console.log(`\nנמחקו ${ok} רשומות.`);
if (failed.length) {
  console.log(`⚠️ ${failed.length} נכשלו — יש להריץ שוב:`);
  for (const f of failed) console.log('   ', f);
  process.exit(1);
}
