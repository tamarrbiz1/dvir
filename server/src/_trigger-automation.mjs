import { getBase } from './airtable.js';

const base = getBase();
const table = base('תמחור עבודות לפי מבנים');

console.log('Triggering automation for all pricing-by-structure records...');

let updated = 0;
let total = 0;

// נשתמש ב-eachPage עם async/await תקין
const processPage = (records, fetchNextPage) => {
  const promises = [];
  for (const r of records) {
    total++;
    // נשתמש בשדה קיים — נשים ערך ריק ב"הערות" (או נשתמש בשדה אחר)
    // חשוב: פשוט נעדכן את אותה רשומה עם אותם נתונים — זה יפעיל את האוטומציה
    const p = table.update(r.id, {
      'הערות': r.fields['הערות'] || ''  // שדה טקסט קיים, לא משנה את הערך
    }).then(() => {
      updated++;
      if (updated % 100 === 0) console.log(`Updated ${updated}...`);
    }).catch(e => {
      console.log(`Error updating ${r.id}: ${e.message?.slice(0, 100)}`);
    });
    promises.push(p);
  }
  return Promise.all(promises).then(() => fetchNextPage());
};

await table.select().eachPage(processPage);

console.log(`Total: ${total}, Updated: ${updated}`);
