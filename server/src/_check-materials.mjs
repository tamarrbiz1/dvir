import { getMeta } from './airtable.js';

const FROM_IMAGE = [
  'BB5', 'אביר', 'אגרוצלון', 'אגריטון', 'אגרירון', 'אדוכם סופר', 'אדיגן', 'אובליסק', 'אוברון', 'אודאון',
  'אוואנט', 'אוויסקט-S', 'אומי', 'אופיר 2000', 'אוקסיגל', 'אורבגו', 'איזידור', 'אינוויזור', 'איורורט', 'אינפיניטו',
  'איפון', 'אלבר סופר', 'אמפליגו', 'אמרלד אנרג\'', 'אפולו', 'אפלורד', 'אצאסטאר', 'אצן', 'אקטררה', 'אקסירל',
  'אקסמייט', 'אקרובט', 'אקרימקטין', 'באיפידן', 'בוגירון', 'בז', 'ביסוקה', 'בלן שילד', 'בליס', 'בנג\'ו פורטה',
  'בסטה 20', 'בראבו', 'בן', 'ברק', 'ברקוד', 'גול', 'דומארק', 'דומייט', 'דורסן', 'דיפנדר',
  'דיקחול', 'דלסן',
];

try {
  const meta = await getMeta();
  const matTable = meta.find((t) => t.name === 'חומרי ריסוס');
  if (!matTable) { console.log('NO MATERIALS TABLE'); process.exit(1); }
  const fieldNames = matTable.fields.map((f) => f.name);
  console.log('Fields:', fieldNames.join(', '));
  // check which name-field exists
  const nameFields = fieldNames.filter((f) => f.includes('שם') || f.includes('חומר'));
  console.log('Name-candidate fields:', nameFields.join(', '));

  let missing = [];
  // The image data needs to be fetched from Airtable to compare
  // We'll just print instructions
  console.log('\nTo compare, run:');
  console.log('node -e "const {getBase}=await import(\'./src/airtable.js\'); const base=getBase(); const recs=await base(\'חומרי ריסוס\').select().all(); recs.forEach(r=>console.log(r.fields[\'שם חומר\'] || r.fields[\'חומר\'] || r.fields[Object.keys(r.fields)[0]]))"');
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
}
