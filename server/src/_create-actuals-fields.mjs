// ============================================================
// יצירת השדות ש"מנוע הבפועל" (actuals-sync.js) כותב אליהם — חד-פעמי,
// דרך Meta API. אידמפוטנטי: מדלג על שדה שכבר קיים, ולכן אפשר להריץ
// שוב בלי נזק. אינו מדפיס את ה-PAT ואינו נוגע בנתונים.
// הרצה: node src/_create-actuals-fields.mjs   (מתוך תיקיית server)
//
// למה דרך ה-API ולא ביד: אותם שדות נדרשים גם בבסיס-בדיקה/שחזור, וכך
// הסכמה מתועדת בקוד. אם ה-PAT חסר הרשאת schema.bases:write — הסקריפט
// מדווח בעברית מה צריך ליצור ידנית ויוצא בקוד 2 (ולא נכשל בשקט).
// ============================================================
import './airtable.js';

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
const H = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };
const META = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;

// השדות הנדרשים, לפי טבלה. ר' actuals-sync.js (ACTUAL_* / PLAN_ACTUAL_*).
const WANTED = {
  'תחזית שתילה שבועית': [
    // currency בלי symbol — בדיוק כמו "מחיר לקג מעודכן" הקיים באותה טבלה
    { name: 'הכנסה בפועל', type: 'currency', options: { precision: 2, symbol: '' },
      description: 'חושב ע"י Zite: ק"ג בפועל × מחיר לק"ג. אין לערוך ידנית — יידרס בסנכרון הבא.' },
    { name: 'מקור בפועל', type: 'singleLineText',
      description: 'מאיפה הגיע "קג בפועל": קטיפים / מוערך מקרטונים / מוערך מעבודות קטיף / מוערך מתעודות. ריק = מולא ידנית, ו-Zite לא ידרוס אותו.' },
  ],
  'תוכניות שתילה': [
    { name: 'תחילת קטיף בפועל', type: 'date', options: { dateFormat: { name: 'iso' } },
      description: 'חושב ע"י Zite: תאריך הקטיף המשויך הראשון.' },
    { name: 'סוף קטיף בפועל', type: 'date', options: { dateFormat: { name: 'iso' } },
      description: 'חושב ע"י Zite: תאריך הקטיף המשויך האחרון.' },
  ],
};

const metaRes = await fetch(META, { headers: H });
const meta = await metaRes.json();
if (!metaRes.ok) {
  console.error('קריאת סכמת הבסיס נכשלה:', metaRes.status, JSON.stringify(meta).slice(0, 300));
  process.exit(1);
}

let created = 0;
let skipped = 0;
const failed = [];

for (const [tableName, fields] of Object.entries(WANTED)) {
  const table = meta.tables.find((t) => t.name === tableName);
  if (!table) { failed.push(`טבלה "${tableName}" לא נמצאה בבסיס`); continue; }
  const existing = new Set(table.fields.map((f) => f.name));
  for (const field of fields) {
    if (existing.has(field.name)) {
      console.log(`✓ "${tableName}" / "${field.name}" — כבר קיים, מדלג`);
      skipped += 1;
      continue;
    }
    const r = await fetch(`${META}/${table.id}/fields`, { method: 'POST', headers: H, body: JSON.stringify(field) });
    const j = await r.json();
    if (!r.ok) {
      const msg = j?.error?.message || j?.error?.type || JSON.stringify(j).slice(0, 200);
      console.error(`✗ "${tableName}" / "${field.name}" — נכשל (${r.status}): ${msg}`);
      failed.push(`${tableName} / ${field.name} — ${field.type}`);
      continue;
    }
    console.log(`+ "${tableName}" / "${field.name}" נוצר (${field.type})`);
    created += 1;
  }
}

console.log(`\nסיכום: ${created} נוצרו, ${skipped} כבר היו קיימים, ${failed.length} נכשלו.`);
if (failed.length) {
  console.error('\nיש ליצור ידנית ב-Airtable את השדות הבאים (ל-PAT כנראה אין schema.bases:write):');
  for (const f of failed) console.error('  · ' + f);
  process.exit(2);
}
