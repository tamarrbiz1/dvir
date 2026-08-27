// ============================================================
// Smoke Test — בדיקת שרת Zite
// מריץ בדיקות אוטומטיות מול ה-API כדי לוודא שהכל תקין.
// ============================================================

const BASE = 'http://localhost:4000';

let pass = 0;
let fail = 0;
const errors = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    errors.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function get(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json };
}

async function run() {
  console.log('🧪 Smoke Test — בדיקת שרת Zite\n');

  // 1. רשימת טבלאות
  const tables = await get('/api/tables');
  check('GET /api/tables מחזיר 200', tables.status === 200, `status=${tables.status}`);
  check('יש טבלאות', Array.isArray(tables.json) && tables.json.length > 0, tables.json?.length);
  check('קיימת טבלת מבנים', Array.isArray(tables.json) && tables.json.some((t) => t.name === 'מבנים'));
  check('קיימת טבלת עבודות עובדים', Array.isArray(tables.json) && tables.json.some((t) => t.name === 'עבודות עובדים'));

  // 2. קריאת רשומות מטבלת מבנים
  const structs = await get('/api/מבנים?maxRecords=2');
  check('GET /api/מבנים מחזיר רשומות', structs.status === 200 && Array.isArray(structs.json));
  check('מבנים כוללים במקרה אובייקט מקושר מפורק (לא ID)', (() => {
    // אם יש שדה גידולים, הוא צריך להיות באובייקטים עם name, לא ID בלבד
    const rec = Array.isArray(structs.json) && structs.json[0];
    const g = rec && rec['גידולים'];
    if (!g) return true; // אין שדה — תקין
    if (!Array.isArray(g)) return false;
    return g.every((r) => r && (typeof r === 'object') && ('name' in r));
  })());

  // 3. קריאת מטא של טבלה
  const meta = await get('/api/meta/עובדים');
  check('GET /api/meta/עובדים מחזיר שדות', meta.status === 200 && Array.isArray(meta.json?.fields));
  check('יש שדה מייל בעובדים', meta.json?.fields?.includes('מייל'));

  // 4. הרשאת מנהל — התחברות
  const admins = await get('/api/הרשאת מנהל?maxRecords=50');
  check('GET /api/הרשאת מנהל מחזיר רשומות', admins.status === 200 && Array.isArray(admins.json));
  check('יש לפחות רשומת מנהל', Array.isArray(admins.json) && admins.json.length > 0);

  // 5. מסלולי אימות לקוח (פונקציונליות מחושבת בפרונט, כאן רק מבנה)
  const workers = await get('/api/עובדים?maxRecords=5');
  check('GET /api/עובדים מחזיר רשומות', workers.status === 200 && Array.isArray(workers.json));

  console.log(`\n${'='.repeat(40)}`);
  console.log(`סיכום: ${pass} ✅ · ${fail} ❌`);
  if (errors.length) {
    console.log('\nשגיאות:');
    errors.forEach((e) => console.log('  •', e));
  }
  console.log(fail === 0 ? '\n🎉 המערכת תקינה!' : '\n⚠️ יש בעיות לבדוק');
  process.exit(fail === 0 ? 0 : 1);
}

run();
