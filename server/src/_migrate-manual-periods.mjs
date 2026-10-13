// ============================================================
// המרה חד-פעמית: שורות `תקופות תוכנית` עם `מקור='שינוי ידני'`
// (משימה AK, 13.10.2026)
// ------------------------------------------------------------
// עד AK הכפתור "שינוי תקופה" יצר שורה ידנית ב`תקופות תוכנית` **בלי**
// לגעת בתאריכי התוכנית ובלי לגעת בתחזית. התוצאה: שורה שנראית כמו
// שינוי אבל לא שינתה כלום, ליד שורת-המערכת שממשיכה להציג את המצב
// הקודם. מאז AK התאריכים המעודכנים בתוכנית הם מקור האמת, והתקופות
// הן תוצר שלהם.
//
// הסקריפט הזה סוגר את הפער עבור השורות שנוצרו **לפני** AK: לכל שורה
// ידנית הוא מחיל את התאריכים שלה על השדות המעודכנים של אותו שלב
// בתוכנית, מעדכן את שורת-המערכת, מוחק את השורה הידנית, ובונה את
// התחזית מחדש — בדיוק מה ש"שינוי תקופה" החדש עושה.
//
// הרצה:
//   node src/_migrate-manual-periods.mjs --dry-run   ← דוח בלבד
//   node src/_migrate-manual-periods.mjs             ← מבצע
//
// בטיחות:
//   · ברירת המחדל היא **דוח בלבד**; צריך להריץ בלי --dry-run כדי לכתוב.
//   · שורה ידנית **יתומה** (בלי תוכנית מקושרת) מדווחת ולא נוגעת —
//     אין לה תוכנית להחיל עליה את התאריכים. ר' גם 271 התקופות
//     היתומות בבסיס, שתמר הנחתה במפורש לא למחוק.
//   · אם לתוכנית יש כמה שורות ידניות לאותו שלב — מוחלת **המאוחרת**
//     (מספר התקופה הגבוה = השינוי האחרון שתמר עשתה), והשאר נמחקות.
//   · שנות-דמה (2033) מדווחות בנפרד ולא נוגעות אלא אם יש בהן שורה
//     ידנית — ואז הן מטופלות כמו כל שורה אחרת, עם דיווח מפורש.
// ============================================================
import { fetchRecords } from './airtable.js';
import { changePlanPeriod, PHASES } from './plan-periods.js';
import { deleteRecord } from './airtable.js';

const DRY_RUN = process.argv.includes('--dry-run');
const PERIODS_TABLE = 'תקופות תוכנית';
const PLANS_TABLE = 'תוכניות שתילה';
const DEMO_YEARS = [2031, 2032, 2033, 2034, 2035, 2036, 2037];

const ymd = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const linkedIds = (value) => {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => (v && typeof v === 'object' ? v.id : v)).filter(Boolean);
};

const [periods, plans] = await Promise.all([
  fetchRecords(PERIODS_TABLE, {}),
  fetchRecords(PLANS_TABLE, {}),
]);
const planById = new Map(plans.map((p) => [p.id, p]));

const manual = periods.filter((p) => String(p['מקור'] || '') === 'שינוי ידני');
console.log(`${DRY_RUN ? '[דוח בלבד]' : '[מבצע]'} מתוך ${periods.length} תקופות — ${manual.length} עם מקור "שינוי ידני".\n`);

if (!manual.length) {
  console.log('אין שורות ידניות להמרה. (אם הכפתור "שינוי תקופה" החדש כבר בשימוש — זה המצב הצפוי.)');
  process.exit(0);
}

// קיבוץ: תוכנית + שלב → השורות הידניות שלו
const groups = new Map();
const orphans = [];
for (const row of manual) {
  const planId = linkedIds(row['תוכנית שתילה'])[0];
  if (!planId || !planById.has(planId)) { orphans.push(row); continue; }
  const status = String(row['סטטוס'] || '');
  const phase = Object.keys(PHASES).find((k) => PHASES[k].status === status);
  if (!phase) { orphans.push({ ...row, _reason: `סטטוס לא מוכר: "${status}"` }); continue; }
  const key = `${planId}|${phase}`;
  if (!groups.has(key)) groups.set(key, { planId, phase, rows: [] });
  groups.get(key).rows.push(row);
}

if (orphans.length) {
  console.log(`⚠️ ${orphans.length} שורות ידניות שלא ניתן להמיר (אין תוכנית מקושרת / סטטוס לא מוכר) — מדווחות ולא נוגעות:`);
  for (const o of orphans) console.log(`   ${o.id} | תקופה #${o['תקופת תוכנית']} | ${o['סטטוס'] || '(בלי סטטוס)'} | ${ymd(o['מתאריך'])}..${ymd(o['עד תאריך'])}${o._reason ? ' | ' + o._reason : ''}`);
  console.log('');
}

console.log(`${groups.size} צירופי תוכנית+שלב להמרה:\n`);
const planned = [];
for (const g of groups.values()) {
  const plan = planById.get(g.planId);
  const info = PHASES[g.phase];
  // המאוחרת = `תקופת תוכנית` (autoNumber) הגבוה — השינוי האחרון
  const sorted = [...g.rows].sort((a, b) => (Number(a['תקופת תוכנית']) || 0) - (Number(b['תקופת תוכנית']) || 0));
  const winner = sorted[sorted.length - 1];
  const extra = sorted.slice(0, -1);
  const from = ymd(winner['מתאריך']);
  const to = ymd(winner['עד תאריך']);
  const year = Number(plan['שנת תוכנית']) || null;
  const item = {
    planId: g.planId, planNumber: plan['מספר תוכנית'] ?? null, phase: g.phase, from, to, year,
    winnerId: winner.id, extraIds: extra.map((r) => r.id),
    beforeFrom: ymd(plan[info.from]), beforeTo: ymd(plan[info.to]),
    demo: DEMO_YEARS.includes(year),
    skip: !from || !to ? 'השורה הידנית בלי תאריכים' : null,
  };
  planned.push(item);
  console.log(`· תוכנית ${item.planNumber}${item.demo ? ' (שנת דמה ' + year + ')' : ''} — שלב ${info.label}`);
  console.log(`    ${info.from}: ${item.beforeFrom} → ${from}`);
  console.log(`    ${info.to}:  ${item.beforeTo} → ${to}`);
  console.log(`    תקופה ידנית שתימחק: ${winner.id}${extra.length ? ` (+${extra.length} ידניות עודפות)` : ''}`);
  if (item.skip) console.log(`    ⚠️ מדולג: ${item.skip}`);
}

if (DRY_RUN) {
  console.log(`\n[דוח בלבד] שום דבר לא נכתב. להרצה בפועל: node src/_migrate-manual-periods.mjs`);
  process.exit(0);
}

console.log('\n--- מבצע ---');
let done = 0;
const errors = [];
for (const item of planned) {
  if (item.skip) continue;
  try {
    // בדיוק אותו מסלול של "שינוי תקופה" החדש: כותב לתוכנית, מסנכרן
    // את שורת-המערכת, **מוחק את השורות הידניות של אותו שלב**, ובונה
    // את התחזית מחדש. אין כאן לוגיקה שנייה.
    const res = await changePlanPeriod(item.planId, { phase: item.phase, from: item.from, to: item.to });
    for (const id of item.extraIds) await deleteRecord(PERIODS_TABLE, id).catch(() => {});
    done += 1;
    console.log(`✓ תוכנית ${item.planNumber} / ${PHASES[item.phase].label}: ${item.from}..${item.to} · תקופות ${JSON.stringify(res.periods)} · תחזית ${res.forecast.ok ? res.forecast.weeks + ' שבועות' : 'לא נבנתה (' + res.forecast.missing.join('; ') + ')'}`);
  } catch (e) {
    errors.push({ planNumber: item.planNumber, phase: item.phase, error: e.message });
    console.error(`✗ תוכנית ${item.planNumber} / ${PHASES[item.phase].label}: ${e.message}`);
  }
}

const left = (await fetchRecords(PERIODS_TABLE, {})).filter((p) => String(p['מקור'] || '') === 'שינוי ידני');
console.log(`\nסיכום: ${done} הומרו, ${errors.length} נכשלו, ${left.length} שורות ידניות נשארו${left.length ? ' (' + left.map((r) => r.id).join(', ') + ')' : ''}.`);
if (errors.length) process.exit(1);
