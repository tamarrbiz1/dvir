// ============================================================
// שנת דמה 2033 — זריעת נתונים לתוכנית שתילה (משימה AH, 12.10.2026)
// ------------------------------------------------------------
// הרצה:  node server/src/_seed-demo-2033.mjs
// מחיקה: node server/src/_purge-demo-2033.mjs
//
// תמר: "אני רוצה שימלא שנה חדשה — 2033 — את כל הפרטים שלה, נתוני דמה
// יפים." המטרה: שנה שנראית אמיתית ומלאה בכל מסכי תוכנית השתילה —
// גיליון שנתי, לוח חודש/שבוע, שורות הסיכום בתחתית, פירוט שבוע.
//
// ⚠️ **אותם מנגנונים שהאפליקציה משתמשת בהם**, לא כתיבה ישירה שעוקפת
// את הלוגיקה (דרישה מפורשת במשימה):
//   1. יוצרים רשומת `תוכניות שתילה` עם מבנה+גידול+שנה+תאריכים.
//   2. מסמנים `חשב תוכנית` → אוטומציית Airtable מחשבת את `תקופות
//      תוכנית` (שתילה/קטיף) ואת תאריכי-הסיום לפי מספר-הימים.
//   3. מסמנים `רענן תחזית` (false→true, בדיוק כמו forceTrigger
//      ב-PlantingPlanPage.jsx ו-forecast-sync.js) → האוטומציה מייצרת
//      את שורות `תחזית שתילה שבועית` עם ק"ג צפוי והכנסה צפויה.
// לכן השורות בתחתית הגיליון מתמלאות בדיוק כמו בשנה אמיתית.
//
// ============================================================
// שתי החלטות שהתקבלו לבד (ומתועדות ל-תמר)
// ============================================================
// 1. **הסימון**: המשימה ביקשה לסמן `הערות` = "דמה 2033". בטבלת
//    `תוכניות שתילה` **אין שדה `הערות`** (אומת במטא 12.10), ויצירת
//    שדה חדש הייתה משנה סכמה של טבלה שהמסכים קוראים — ולכן לא נעשתה.
//    הסימון בפועל הוא `שנת תוכנית = 2033`: הוא חד-משמעי (שנות-אמת הן
//    2025–2027, ואין ולא הייתה שום רשומת 2033), והוא **אינו** בתבנית
//    `TEST_RECORD_PATTERN` ולכן ניקוי-הלילה לא ייגע בו — בדיוק כפי
//    שהמשימה דרשה. `_purge-demo-2033.mjs` מוחק לפי אותו סימון.
// 2. **הגידולים והרבעונים מוגבלים למה שקיים**: `תפוקה רבעונית` היא
//    נתון **גלובלי לגידול** (לא לפי שנה). לפלפל ולחציל יש תפוקה
//    לרבעון 1 בלבד, ולעגבניה לרבעונים 1–3. יצירת תפוקה חסרה הייתה
//    משפיעה גם על התוכניות **האמיתיות** של 2026 (ר' משימה AF —
//    תוכניות 346/33 מדווחות "חסרה תפוקה לרבעון 4") ובכך הייתה ממציאה
//    נתון אגרונומי אמיתי. לכן עונות-הקטיף של הדמה נקבעו רק ברבעונים
//    שיש להם תפוקה. מחירים, לעומת זאת, הם **לפי שנה** — ולכן נוצרים
//    כאן מחירי 2033 בלי שום השפעה על 2026.
// ============================================================
import { fetchRecords, createRecord, updateRecord } from './airtable.js';

const YEAR = 2033;
const PLANS = 'תוכניות שתילה';
const PRICES = 'מחירי גידול משוערים';
const CROPS = 'גידולים';
const YIELDS = 'תפוקה רבעונית';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const linked = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean);

/** מחיר משוער לק"ג לשנת 2033 — מספרים לא-עגולים בכוונה ("יפה", לא סינתטי) */
const DEMO_PRICES = { 'מלפפון': 7.4, 'עגבניה': 9.3, 'פלפל': 12.6, 'חציל': 8.7 };

/**
 * מחזורי-הגידול של שנת הדמה. `harvestDays` הוא **מספר ימי הקטיף
 * בעונה** — האוטומציה גוזרת ממנו את תאריך-הסיום (נבדק: 4 ימים → שבוע
 * אחד), ולכן 33–58 ימים נותנים עונה של 5–9 שבועות, כמו עונה אמיתית.
 * התאריכים מדורגים בין המבנים (לא כולם באותו יום) והמספרים לא-עגולים.
 */
const CYCLE_1 = [
  { structure: 'recGEWpRzbdeKdKlp', crop: 'מלפפון', plant: '2033-01-09', plantDays: 3, harvest: '2033-02-07', harvestDays: 38 },
  { structure: 'recQRN48QaBAMXCTb', crop: 'עגבניה', plant: '2033-01-16', plantDays: 4, harvest: '2033-02-14', harvestDays: 47 },
  { structure: 'recQUOumoMfZFeGC1', crop: 'מלפפון', plant: '2033-01-11', plantDays: 3, harvest: '2033-02-21', harvestDays: 36 },
  { structure: 'recWIEkyObimQH7IV', crop: 'פלפל', plant: '2033-01-03', plantDays: 4, harvest: '2033-01-24', harvestDays: 52 },
  { structure: 'recYyIoSGXFDeR4dB', crop: 'חציל', plant: '2033-01-05', plantDays: 2, harvest: '2033-02-02', harvestDays: 41 },
  { structure: 'recZlzAHW3TuMptAj', crop: 'עגבניה', plant: '2033-01-04', plantDays: 4, harvest: '2033-01-31', harvestDays: 56 },
  { structure: 'recZpudjSkLxaj6wY', crop: 'מלפפון', plant: '2033-01-13', plantDays: 3, harvest: '2033-02-11', harvestDays: 34 },
  { structure: 'recctsgvghsLKB57n', crop: 'פלפל', plant: '2033-01-02', plantDays: 2, harvest: '2033-01-17', harvestDays: 58 },
  { structure: 'receMGYkItHBUD8Pj', crop: 'עגבניה', plant: '2033-01-19', plantDays: 4, harvest: '2033-02-18', harvestDays: 44 },
  { structure: 'reclygqB6E2MKPlxk', crop: 'מלפפון', plant: '2033-01-06', plantDays: 3, harvest: '2033-01-27', harvestDays: 51 },
  { structure: 'recsP0Jlr9tuHS6DG', crop: 'חציל', plant: '2033-01-10', plantDays: 2, harvest: '2033-02-09', harvestDays: 36 },
  { structure: 'rectvL07NK38xZiTV', crop: 'מלפפון', plant: '2033-01-23', plantDays: 3, harvest: '2033-02-23', harvestDays: 43 },
  { structure: 'recwCV2hVoO5lWBbj', crop: 'עגבניה', plant: '2033-01-07', plantDays: 2, harvest: '2033-01-20', harvestDays: 49 },
];

/**
 * מחזור שני ל-5 מבנים ("חלק מהמבנים עם שני מחזורים בשנה"). קטיף
 * ברבעון 3 — ולכן רק מלפפון (60 ק"ג/דונם/שבוע) ועגבניה (30), השניים
 * היחידים שיש להם תפוקה לרבעון הזה.
 */
const CYCLE_2 = [
  { structure: 'recGEWpRzbdeKdKlp', crop: 'עגבניה', plant: '2033-06-06', plantDays: 3, harvest: '2033-07-18', harvestDays: 53 },
  { structure: 'recQRN48QaBAMXCTb', crop: 'מלפפון', plant: '2033-06-13', plantDays: 2, harvest: '2033-07-25', harvestDays: 47 },
  { structure: 'recZlzAHW3TuMptAj', crop: 'מלפפון', plant: '2033-06-20', plantDays: 4, harvest: '2033-08-01', harvestDays: 39 },
  { structure: 'receMGYkItHBUD8Pj', crop: 'עגבניה', plant: '2033-06-27', plantDays: 3, harvest: '2033-08-08', harvestDays: 42 },
  { structure: 'reclygqB6E2MKPlxk', crop: 'מלפפון', plant: '2033-07-04', plantDays: 2, harvest: '2033-08-15', harvestDays: 33 },
];

const crops = await fetchRecords(CROPS, {});
const cropIdByName = new Map(crops.map((c) => [c['שם גידול'], c.id]));

// ---- 1. מחירי 2033 (לפי שנה — אין שום השפעה על 2026) ----
const prices = await fetchRecords(PRICES, {});
for (const [name, perKg] of Object.entries(DEMO_PRICES)) {
  const cropId = cropIdByName.get(name);
  if (!cropId) { console.log(`  ⚠️ גידול "${name}" לא קיים — מדולג`); continue; }
  const exists = prices.find((p) => Number(p['שנה']) === YEAR && linked(p['גידול']).includes(cropId));
  if (exists) { console.log(`  = מחיר ${YEAR} ל${name} קיים (${exists.id})`); continue; }
  const rec = await createRecord(PRICES, { 'גידול': [cropId], 'שנה': YEAR, 'מחיר משוער לקג': perKg, 'ברירת מחדל שנתית': true });
  console.log(`  + מחיר ${YEAR} ל${name}: ${perKg} ₪/ק"ג (${rec.id})`);
  await sleep(300);
}

// ---- 2. אימות שיש תפוקה רבעונית לכל גידול+רבעון שהדמה משתמשת בו ----
const yields = await fetchRecords(YIELDS, {});
const quarterOf = (iso) => Math.floor(Number(String(iso).slice(5, 7)) / 3.01) + 1;
const hasYield = (cropId, q) => yields.some((y) => linked(y['גידול']).includes(cropId) && String(y['רבעון']) === String(q));
const problems = [];
for (const c of [...CYCLE_1, ...CYCLE_2]) {
  const cropId = cropIdByName.get(c.crop);
  const q = quarterOf(c.harvest);
  if (!hasYield(cropId, q)) problems.push(`${c.crop} רבעון ${q} (מבנה ${c.structure})`);
}
if (problems.length) {
  console.error('⛔ עצירה: חסרה תפוקה רבעונית — האוטומציה לא תייצר שורות, והמשימה אוסרת להמציא נתון אגרונומי:');
  for (const p of problems) console.error('   ', p);
  process.exit(1);
}

// ---- 3. התוכניות עצמן ----
const existing = (await fetchRecords(PLANS, {})).filter((p) => Number(p['שנת תוכנית']) === YEAR);
const key = (c) => `${c.structure}|${c.plant}`;
const existingKeys = new Set(existing.map((p) => `${linked(p['מבנה'])[0]}|${String(p['תחילת שתילה מקורית'] || '').slice(0, 10)}`));
console.log(`\nקיימות כבר ${existing.length} תוכניות ${YEAR} — מדלג על כאלה שתואמות מבנה+תאריך-שתילה`);

const created = [];
let cycleNum = 0;
for (const cycle of [CYCLE_1, CYCLE_2]) {
  cycleNum += 1;
  for (const c of cycle) {
    if (existingKeys.has(key(c))) { console.log(`  = מחזור ${cycleNum} ${c.structure} (${c.plant}) כבר קיים`); continue; }
    const cropId = cropIdByName.get(c.crop);
    const plan = await createRecord(PLANS, {
      'מבנה': [c.structure],
      'גידולים': [cropId],
      'שנת תוכנית': YEAR,
      'תחילת שתילה מקורית': c.plant,
      'תחילת קטיף מקורית': c.harvest,
      'מספר ימי שתילה': c.plantDays,
      'מספר ימי קטיף': c.harvestDays,
    });
    created.push({ id: plan.id, num: plan['מספר תוכנית'], cycle: cycleNum, ...c });
    console.log(`  + מחזור ${cycleNum}: תוכנית ${plan['מספר תוכנית']} (${plan.id}) · ${c.crop} · מבנה ${c.structure} · קטיף מ-${c.harvest} (${c.harvestDays} ימים)`);
    await sleep(400);
  }
}

// ---- 4. הפעלת האוטומציות (חשב תוכנית → רענן תחזית) ----
// אחת-אחת ולא במקביל: אוטומציות Airtable על אותה טבלה נדחקות לתור,
// ו-vCPU אחד כאן ממילא.
const toTrigger = created.length ? created : existing.map((p) => ({ id: p.id, num: p['מספר תוכנית'] }));
console.log(`\nמפעיל "חשב תוכנית" ל-${toTrigger.length} תוכניות…`);
for (const p of toTrigger) {
  await updateRecord(PLANS, p.id, { 'חשב תוכנית': true });
  await sleep(900);
}
console.log('ממתין לאוטומציה…');
await sleep(20000);

console.log(`מפעיל "רענן תחזית" ל-${toTrigger.length} תוכניות…`);
for (const p of toTrigger) {
  await updateRecord(PLANS, p.id, { 'רענן תחזית': false });
  await sleep(400);
  await updateRecord(PLANS, p.id, { 'רענן תחזית': true });
  await sleep(900);
}
console.log('ממתין לאוטומציה…');
await sleep(45000);

// ---- 5. דוח ----
const after = (await fetchRecords(PLANS, {})).filter((p) => Number(p['שנת תוכנית']) === YEAR);
const forecasts = await fetchRecords('תחזית שתילה שבועית', {});
const periods = await fetchRecords('תקופות תוכנית', {});
const planIds = new Set(after.map((p) => p.id));
const mineF = forecasts.filter((f) => linked(f['תוכנית שתילה']).some((id) => planIds.has(id)));
const mineP = periods.filter((x) => linked(x['תוכנית שתילה']).some((id) => planIds.has(id)));
const kg = mineF.reduce((s, f) => s + (Number(f['ק"ג צפוי']) || 0), 0);
const rev = mineF.reduce((s, f) => s + (Number(f['הכנסה צפויה']) || 0), 0);
const empty = after.filter((p) => !linked(p['תחזית שתילה שבועית']).length);

console.log('\n' + '='.repeat(60));
console.log(`סיכום שנת הדמה ${YEAR}`);
console.log('='.repeat(60));
console.log(`  תוכניות שתילה:        ${after.length}`);
console.log(`  תקופות תוכנית:        ${mineP.length}`);
console.log(`  תחזיות שבועיות:       ${mineF.length}`);
console.log(`  סה"כ ק"ג צפוי לשנה:   ${Math.round(kg).toLocaleString('he-IL')}`);
console.log(`  סה"כ הכנסה צפויה:     ${Math.round(rev).toLocaleString('he-IL')} ₪`);
console.log(`  מבנים מכוסים:         ${new Set(after.map((p) => linked(p['מבנה'])[0])).size}`);
console.log(`  גידולים בשנה:         ${[...new Set(after.flatMap((p) => p['סוג גידול'] || []))].join(', ')}`);
if (empty.length) console.log(`  ⚠️ תוכניות בלי תחזית: ${empty.map((p) => p['מספר תוכנית']).join(', ')}`);
console.log(`\n  "בפועל" נשאר ריק בכוונה — זו שנה עתידית.`);
console.log(`  מחיקה: node server/src/_purge-demo-2033.mjs`);
