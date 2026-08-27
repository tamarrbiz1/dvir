// ============================================================
// בדיקת חיבור ל-Airtable
// מדפיס רק: שמות הטבלאות ובכל אחת כמה שדות.
// לעולם אינו מדפיס את הטוקן או מזהי רשומות.
// ============================================================

import { getMeta } from './airtable.js';

async function main() {
  console.log('🔌 מתחבר ל-Airtable...');
  try {
    const tables = await getMeta();
    console.log(`\n✅ החיבור הצליח! נמצאו ${tables.length} טבלאות:\n`);
    for (const t of tables) {
      const fieldNames = t.fields.map((f) => f.name);
      console.log(`▸ ${t.name}  (${fieldNames.length} שדות)`);
    }
    // רשימת שמות טבלאות בלבד לשמור למטה
    const names = tables.map((t) => t.name);
    console.log('\nשמות הטבלאות:', names.join(', '));
  } catch (err) {
    console.error('\n❌ החיבור נכשל');
    console.error('סיבה:', err.message);
    process.exit(1);
  }
}

main();
