import { getBase } from './airtable.js';

const base = getBase();

const ALL_STRUCTURES = [
  'recQRN48QaBAMXCTb', // מבנה 1
  'receMGYkItHBUD8Pj', // מבנה 2
  'recsP0Jlr9tuHS6DG', // מבנה 3
  'recWIEkyObimQH7IV', // מבנה 4
  'recQUOumoMfZFeGC1', // מבנה 5
  'recGEWpRzbdeKdKlp', // מבנה 6
  'recZpudjSkLxaj6wY', // מבנה 7
  'reclygqB6E2MKPlxk', // מבנה 8
  'rectvL07NK38xZiTV', // מבנה 9: צד שמאל
  'recwCV2hVoO5lWBbj', // מבנה 9: צד ימין
  'recYyIoSGXFDeR4dB', // מבנה 9: חממה ישנה
  'recctsgvghsLKB57n', // מבנה 10
  'recMHZKJVrRNeiJCI', // (no name)
];

// Get all pricing entries (variety + work type + price)
const pricing = await base('תמחור עבודות').select().all();
const structTable = base('תמחור עבודות לפי מבנים');
const existing = await structTable.select().all();
const existingSet = new Set(existing.map(r => JSON.stringify([
  r.fields['תמחור עבודות'],
  Array.isArray(r.fields['מבנים']) ? r.fields['מבנים'][0] : r.fields['מבנים']
])));

let created = 0;
let skipped = 0;

for (const p of pricing) {
  const variety = p.fields['זן'];
  const workType = p.fields['סוג עבודה'];
  const price = p.fields['מחיר'];
  const unit = p.fields['יחידת תמחור'];
  const pricingId = p.id;

  for (const structId of ALL_STRUCTURES) {
    const key = JSON.stringify([pricingId, structId]);
    if (existingSet.has(key)) {
      skipped++;
      continue;
    }
    try {
      await structTable.create({
        'תמחור עבודות': [pricingId],
        'מבנים': [structId],
      });
      created++;
      if (created % 100 === 0) console.log(`Created ${created}...`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }
}

console.log(`Created: ${created}, Skipped: ${skipped}, Total needed: ${pricing.length * ALL_STRUCTURES.length}`);
