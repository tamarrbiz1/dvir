// ============================================================
// מייצר קובץ SCHEMA.md — מפה מלאה של הטבלאות והשדות בפועל.
// נקרא פעם אחת אחרי שהחיבור מצליח; נשמר כל פעם מחדש.
// אינו מכיל נתוני רשומות ואינו חושף סודות.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMeta } from './airtable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const tables = await getMeta();
  const lines = [];

  lines.push('<!-- דו"ח אוטומטי — מפת Airtable (אין בו נתונים או סודות) -->');
  lines.push('');
  lines.push(`# מפת ה-Airtable — נצפתה ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`סה"כ טבלאות: ${tables.length}`);
  lines.push('');
  lines.push('| # | טבלה | שדות | שמות שדות |');
  lines.push('|---|------|------|-----------|');

  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const fieldNames = t.fields.map((f) => f.name);
    lines.push(`| ${i + 1} | ${t.name} | ${fieldNames.length} | ${fieldNames.join(' · ')} |`);
  }

  const outPath = path.resolve(__dirname, '../../SCHEMA.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`✅ דו"ח נשמר אל ${outPath}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
