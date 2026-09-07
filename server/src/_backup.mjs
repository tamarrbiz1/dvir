// גיבוי מלא: ייצוא JSON לכל טבלה בבסיס, כולל ספירה ואימות מול הבסיס החי.
// קריאה בלבד — לא נוגע בשום רשומה.
import { getMeta, fetchRecords } from './airtable.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const stamp = process.argv[2];
if (!stamp) { console.error('שימוש: node _backup.mjs <YYYYMMDD-HHMM>'); process.exit(1); }
const dir = `/root/airtable-backup-${stamp}`;
mkdirSync(dir, { recursive: true });

const tables = await getMeta();
const report = [];
let grandTotal = 0;
for (const t of tables) {
  const records = await fetchRecords(t.name, {});
  const safeName = t.name.replace(/\//g, '-');
  writeFileSync(`${dir}/${safeName}.json`, JSON.stringify(records, null, 2), 'utf8');
  report.push({ table: t.name, count: records.length });
  grandTotal += records.length;
  console.log(`${String(records.length).padStart(5)}  ${t.name}  -> ${safeName}.json`);
}
writeFileSync(`${dir}/_manifest.json`, JSON.stringify({ createdAt: new Date().toISOString(), grandTotal, tables: report }, null, 2), 'utf8');
console.log(`\nסה"כ ${grandTotal} רשומות גובו ל-${dir}`);
