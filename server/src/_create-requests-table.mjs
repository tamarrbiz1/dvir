// ============================================================
// יצירת טבלת "בקשות עובדים" ב-Airtable (חד-פעמי) — דרך Meta API.
// אינו מדפיס את ה-PAT. מדלג אם הטבלה כבר קיימת.
// הרצה: node src/_create-requests-table.mjs (מתוך תיקיית server)
// ============================================================
import './airtable.js';

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_BASE_ID;
const H = { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' };
const META = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;

const meta = await (await fetch(META, { headers: H })).json();
if (meta.tables?.some((t) => t.name === 'בקשות עובדים')) {
  console.log('הטבלה "בקשות עובדים" כבר קיימת — אין צורך ליצור.');
  process.exit(0);
}
const workersId = meta.tables.find((t) => t.name === 'עובדים').id;

const body = {
  name: 'בקשות עובדים',
  description: 'בקשות עובדים למנהל (חופש / מחלה / חלק מהיום). נוצר על ידי Zite.',
  fields: [
    { name: 'מספר בקשה', type: 'autoNumber' },
    { name: 'עובד', type: 'multipleRecordLinks', options: { linkedTableId: workersId } },
    { name: 'סוג בקשה', type: 'singleSelect', options: { choices: [{ name: 'חופש / מחלה' }, { name: 'חופש לחלק מהיום' }] } },
    { name: 'תאריך', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'משעה', type: 'singleLineText' },
    { name: 'עד שעה', type: 'singleLineText' },
    { name: 'עד סוף היום', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'נוצר בתאריך', type: 'createdTime' },
    { name: 'סטטוס', type: 'singleSelect', options: { choices: [{ name: 'ממתין לאישור' }, { name: 'אושר' }, { name: 'לא אושר' }] } },
    { name: 'הערת מנהל', type: 'multilineText' },
    { name: 'תאריך תשובה', type: 'dateTime', options: { timeZone: 'Asia/Jerusalem', dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } } },
    { name: 'הוסתר על ידי העובד', type: 'checkbox', options: { icon: 'check', color: 'grayBright' } },
    { name: 'מאפשר הזנת עבודה לתאריך', type: 'checkbox', options: { icon: 'check', color: 'blueBright' } },
    { name: 'הערות עובד', type: 'multilineText' },
  ],
};

const r = await fetch(META, { method: 'POST', headers: H, body: JSON.stringify(body) });
const j = await r.json();
if (!r.ok) {
  console.error('יצירת הטבלה נכשלה:', r.status, JSON.stringify(j).slice(0, 500));
  process.exit(1);
}
console.log('נוצרה טבלה', j.name, '— שדות:', j.fields.map((f) => f.name).join(' · '));
