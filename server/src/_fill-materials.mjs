import { getBase, getMeta } from './airtable.js';

// Names from image with their units
const FROM_IMAGE = [
  ['BB5', 'ליטר'], ['אביר', 'ליטר'], ['אגרוצלון', 'ליטר'], ['אגריטון', 'ליטר'], ['אגרירון', 'ליטר'],
  ['אדוכם סופר', 'ליטר'], ['אדיגן', 'ליטר'], ['אובליסק', 'ליטר'], ['אוברון', 'ליטר'], ['אודאון', 'ליטר'],
  ['אוואנט', 'ליטר'], ['אוויסקט-S', 'ק"ג'], ['אומי', 'ליטר'], ['אופיר 2000', 'ליטר'], ['אוקסיגל', 'ליטר'],
  ['אורבגו', 'ליטר'], ['איזידור', 'ליטר'], ['אינוויזור', 'ליטר'], ['איורורט', 'ליטר'], ['אינפיניטו', 'ליטר'],
  ['איפון', 'ק"ג'], ['אלבר סופר', 'ליטר'], ['אמפליגו', 'ליטר'], ['אמרלד אנרג\'', 'ליטר'], ['אפולו', 'ליטר'],
  ['אפלורד', 'ליטר'], ['אצאסטאר', 'ליטר'], ['אצן', 'ק"ג'], ['אקטררה', 'ק"ג'], ['אקסירל', 'ק"ג'],
  ['אקסמייט', 'ליטר'], ['אקרובט', 'ק"ג'], ['אקרימקטין', 'ליטר'], ['באיפידן', 'ליטר'], ['בוגירון', 'ליטר'],
  ['בז', 'ליטר'], ['ביסוקה', 'ליטר'], ['בלן שילד', 'ק"ג'], ['בליס', 'ק"ג'], ['בנג\'ו פורטה', 'ליטר'],
  ['בסטה 20', 'ליטר'], ['בראבו', 'ליטר'], ['בן', 'ליטר'], ['ברק', 'ליטר'], ['ברקוד', 'ליטר'],
  ['גול', 'ליטר'], ['דומארק', 'ליטר'], ['דומייט', 'ליטר'], ['דורסן', 'ליטר'], ['דיפנדר', 'ליטר'],
  ['דיקחול', 'ק"ג'], ['דלסן', ''],
];

try {
  const base = getBase();
  const recs = await base('חומרי ריסוס').select().all();
  const existing = recs.map((r) => r.fields['שם חומר'] || r.fields[Object.keys(r.fields)[0]]).filter(Boolean);

  // Find missing names
  const missing = FROM_IMAGE.filter(([name]) => {
    const match = existing.find((e) => e.includes(name) || name.includes(e));
    return !match;
  });
  console.log('=== Missing from Airtable ===');
  missing.forEach(([name, unit]) => console.log(`  ${name} (${unit})`));

  // Update unit for existing records
  console.log('\n=== Updating unit pricing ===');
  let updated = 0;
  for (const r of recs) {
    const name = r.fields['שם חומר'] || r.fields[Object.keys(r.fields)[0]];
    if (!name) continue;
    const match = FROM_IMAGE.find(([imgName]) => name.includes(imgName) || imgName.includes(name));
    if (match && match[1]) {
      const current = r.fields['יחידת תמחור'];
      if (current !== match[1]) {
        await base('חומרי ריסוס').update(r.id, { 'יחידת תמחור': match[1] });
        updated++;
      }
    }
  }
  console.log(`Updated ${updated} records with unit pricing`);
  console.log('Done!');
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
}
