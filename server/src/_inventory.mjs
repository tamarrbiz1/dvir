// סקריפט חד-פעמי: מיפוי כל הטבלאות בבסיס + ספירת רשומות בכל אחת.
// לא מוחק ולא כותב שום דבר — קריאה בלבד.
import { getMeta, fetchRecords } from './airtable.js';

const tables = await getMeta();
console.log(`סה"כ ${tables.length} טבלאות בבסיס:\n`);
let grandTotal = 0;
for (const t of tables) {
  const records = await fetchRecords(t.name, {});
  grandTotal += records.length;
  console.log(`${records.length}\t${t.name}`);
}
console.log(`\nסה"כ רשומות בכל הבסיס: ${grandTotal}`);
