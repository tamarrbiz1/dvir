import './airtable.js';

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
const H = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };
const META = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;

const meta = await (await fetch(META, { headers: H })).json();
if (meta.tables?.some((t) => t.name === 'מכשירי כניסה')) {
  console.log('הטבלה "מכשירי כניסה" כבר קיימת — אין צורך ליצור.');
  process.exit(0);
}

const body = {
  name: 'מכשירי כניסה',
  description: 'רשימת מכשירים מאושרים לכניסה פר-משתמש (device binding). נוצר על ידי Zite.',
  fields: [
    { name: 'מספר', type: 'autoNumber' },
    { name: 'אימייל', type: 'singleLineText' },
    { name: 'שם משתמש', type: 'singleLineText' },
    { name: 'תפקיד', type: 'singleLineText' },
    { name: 'מזהה מכשיר', type: 'singleLineText' },
    { name: 'תיאור מכשיר', type: 'singleLineText' },
    { name: 'סטטוס', type: 'singleSelect', options: { choices: [{ name: 'מאושר' }, { name: 'ממתין לאישור' }, { name: 'נדחה' }] } },
    { name: 'נוצר בתאריך', type: 'createdTime' },
    { name: 'כניסה אחרונה', type: 'dateTime', options: { timeZone: 'Asia/Jerusalem', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
  ],
};

const r = await fetch(META, { method: 'POST', headers: H, body: JSON.stringify(body) });
const j = await r.json();
if (!r.ok) {
  console.error('יצירת הטבלה נכשלה:', r.status, JSON.stringify(j).slice(0, 500));
  process.exit(1);
}
console.log('נוצרה טבלה', j.name, '— שדות:', j.fields.map((f) => f.name).join(' · '));
