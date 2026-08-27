// כלי אבחון זמני: מדפיס את אפשרויות שדות ה-select בטבלאות שהמסכים כותבים אליהן
import { getMeta } from './airtable.js';

const WANTED = ['ימי אי עבודה', 'תקופות תוכנית', 'ריסוסים', 'מלאי בסיסי', 'חשבוניות', 'צ׳קים'];

for (const t of (await getMeta()).filter((x) => WANTED.includes(x.name))) {
  const selects = t.fields.filter((f) => f.type === 'singleSelect' || f.type === 'multipleSelects');
  if (!selects.length) continue;
  console.log(`=== ${t.name} ===`);
  for (const f of selects) {
    const choices = (f.options?.choices || []).map((c) => c.name);
    console.log(`  ${f.name} (${f.type}): ${choices.length ? choices.join(' | ') : '(אין אפשרויות מוגדרות)'}`);
  }
}
