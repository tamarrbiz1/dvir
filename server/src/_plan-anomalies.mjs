// ============================================================
// דוח חריגות בנתוני תוכנית השתילה — **קריאה בלבד** (משימה AF, 12.10.2026)
// ------------------------------------------------------------
// הרצה:  node server/src/_plan-anomalies.mjs
//
// נולד מהשאלה של תמר "למה הנתונים בתחתית האקסל של 2026 ריקים?" ו"יש
// נתונים ב-2031". הסקריפט **אינו מוחק ואינו מתקן כלום** — הוא מדפיס
// בדיוק מה חסר ומה חריג, כדי שתמר תחליט. הכלל (CLAUDE.md): רשומה
// שאינה שריד-בדיקה מדווחת, לא נמחקת.
//
// שלושה דברים נבדקים:
//   1. מוכנות-תחזית לכל תוכנית (checkForecastPreflight) — מה חסר כדי
//      שהאוטומציה "רענן תחזית" תוכל לייצר שורות שבועיות.
//   2. שנים חריגות — תוכנית מחוץ ל-SANE_YEARS.
//   3. רשומות-יתומות — תחזית שבועית בלי תוכנית/גידול/מבנה, ורשומות
//      מחיר/תפוקה בלי גידול מקושר (הן "לא נתפסות" ע"י שום מסך).
// ============================================================
import { fetchRecords } from './airtable.js';
import { checkForecastPreflight } from './forecast-preflight.js';

const SANE_FROM = 2025;
const SANE_TO = 2027;
/** אותה תבנית כמו TEST_RECORD_PATTERN ב-server.js — רק לסימון בדוח */
const TEST_RECORD_PATTERN = /__PLANT_TEST_\d+__|\bQA-\d{10,}|\bPERF-TEST\b/;

const linked = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);

const plans = await fetchRecords('תוכניות שתילה', {});
const forecasts = await fetchRecords('תחזית שתילה שבועית', {});
const prices = await fetchRecords('מחירי גידול משוערים', {});
const yields = await fetchRecords('תפוקה רבעונית', {});
const crops = await fetchRecords('גידולים', {});
const cropName = new Map(crops.map((c) => [c.id, c['שם גידול'] || c.id]));

console.log('='.repeat(64));
console.log('1. מוכנות-תחזית לכל תוכנית');
console.log('='.repeat(64));
for (const p of plans) {
  const r = await checkForecastPreflight(p.id);
  const weeks = forecasts.filter((f) => linked(f['תוכנית שתילה']).includes(p.id)).length;
  const head = `תוכנית ${r.planNumber ?? '?'} (${p.id}) · שנה ${r.year ?? 'חסרה'} · גידול ${r.checkedCropNames.join(',') || '—'} · רבעונים ${r.checkedQuarters.join(',') || '—'} · ${weeks} שבועות`;
  console.log(r.ok ? `  ✓ ${head}` : `  ✗ ${head}`);
  for (const m of r.missing) console.log(`      חסר: ${m}`);
}

console.log('');
console.log('='.repeat(64));
console.log(`2. שנים חריגות (מחוץ ל-${SANE_FROM}–${SANE_TO})`);
console.log('='.repeat(64));
const odd = plans.filter((p) => {
  const y = Number(p['שנת תוכנית']);
  return !Number.isFinite(y) || y < SANE_FROM || y > SANE_TO;
});
if (!odd.length) console.log('  אין');
for (const p of odd) {
  const isTest = TEST_RECORD_PATTERN.test(JSON.stringify(p));
  console.log(`  ${isTest ? '🧪 שריד-בדיקה (מותר למחוק)' : '⚠️ רשומה אמיתית — לדווח, לא למחוק'}: תוכנית ${p['מספר תוכנית'] ?? '?'} (${p.id}) · שנה ${p['שנת תוכנית'] ?? 'חסרה'} · גידול ${linked(p['גידולים']).map((id) => cropName.get(id) || id).join(',') || '—'} · מבנה ${linked(p['מבנה']).join(',') || '—'}`);
}

console.log('');
console.log('='.repeat(64));
console.log('3. רשומות-יתומות');
console.log('='.repeat(64));
const orphanForecasts = forecasts.filter((f) => !linked(f['תוכנית שתילה']).length);
const byYear = {};
for (const f of orphanForecasts) {
  const y = f['תחילת שבוע'] ? new Date(f['תחילת שבוע']).getFullYear() : 'ללא-תאריך';
  byYear[y] = (byYear[y] || 0) + 1;
}
console.log(`  תחזית שבועית בלי תוכנית מקושרת: ${orphanForecasts.length} מתוך ${forecasts.length} · לפי שנה: ${JSON.stringify(byYear)}`);
if (orphanForecasts.length) {
  const nonZero = orphanForecasts.filter((f) => Number(f['ק"ג צפוי']) > 0).length;
  console.log(`     מהן עם ק"ג צפוי > 0: ${nonZero} (השאר 0 — אין להן שום השפעה על הגיליון של שנה אמיתית)`);
  console.log(`     מזהים: ${orphanForecasts.map((f) => f.id).join(' ')}`);
}
const orphanPrices = prices.filter((p) => !linked(p['גידול']).length);
if (orphanPrices.length) console.log(`  מחירי גידול משוערים בלי גידול מקושר: ${orphanPrices.length} → ${orphanPrices.map((p) => `${p.id}(שנה ${p['שנה'] ?? '—'})`).join(' ')}`);
const orphanYields = yields.filter((y) => !linked(y['גידול']).length);
if (orphanYields.length) console.log(`  תפוקה רבעונית בלי גידול מקושר: ${orphanYields.length} → ${orphanYields.map((y) => `${y.id}(רבעון ${y['רבעון'] ?? '—'})`).join(' ')}`);

// מחיר ששנתו אינה תואמת את טווח התאריכים שלו — חשד לשגיאת הקלדה
for (const p of prices) {
  const from = String(p['מתאריך'] || '').slice(0, 4);
  const to = String(p['עד תאריך'] || '').slice(0, 4);
  const y = String(p['שנה'] ?? '');
  if ((from && from !== y) || (to && to !== y)) {
    console.log(`  ⚠️ מחיר ${p.id}: שדה "שנה"=${y} אך טווח התאריכים ${p['מתאריך'] || '—'}..${p['עד תאריך'] || '—'} — חשד לשגיאת הקלדה`);
  }
}
console.log('');
console.log('(קריאה בלבד — שום דבר לא נמחק ולא שונה)');
