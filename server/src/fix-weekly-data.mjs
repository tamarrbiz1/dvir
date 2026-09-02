// ============================================================
// תיקון חד-פעמי לנתוני "סיכום שבועי" — מריצים: node server/src/fix-weekly-data.mjs
// ------------------------------------------------------------
// 1) שתי רשומות ללא קוד שבוע (תאריכי #ERROR!) וכפילות של "111" —
//    נמחקות רק אם אין להן שום מסמך/עבודה מקושרים.
// 2) הרשומה "111" שמחזיקה חשבונית + 2 תעודות (הועלו ב-11/08/2026
//    עם קוד ידני שגוי) — הקוד מתוקן לשבוע ההעלאה 20260808-20260813,
//    וגם בשלושת המסמכים עצמם.
// 3) הקוד "2026-07-11" מתוקן לפורמט התקין 20260711-20260716.
// 4) ה-JSON השבור בשבוע 20260830 (תווי \_ לא חוקיים) מתוקן,
//    ושדות "שגיאת חישוב קג לפי מבנים" מנוקים.
// הסקריפט בטוח להרצה חוזרת (מדלג על מה שכבר תוקן).
// ============================================================
const BASE = 'http://127.0.0.1:4000/api';
const enc = encodeURIComponent;
const api = async (m, p, b) => {
  const r = await fetch(`${BASE}/${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status}: ${j?.error}`);
  return j;
};
const W = 'סיכום שבועי';
const weeks = await api('GET', `${enc(W)}?raw=1`);
const hasLinks = (w) => (w['חשבוניות']?.length || 0) + (w['תעודות משלוח']?.length || 0) + (w['עבודות עובדים']?.length || 0) > 0;

// 1) מחיקת רשומות פגומות ריקות
for (const w of weeks) {
  const code = w['קוד שבוע'];
  const badCode = code == null || String(code) === '111';
  if (!badCode || hasLinks(w)) continue;
  await api('DELETE', `${enc(W)}/${w.id}`);
  console.log(`✓ נמחקה רשומה פגומה ריקה (קוד=${JSON.stringify(code)})`);
}

// 2) "111" עם המסמכים → שבוע ההעלאה 08/08–13/08/2026
const NEW_CODE = '20260808-20260813';
const w111 = weeks.find((w) => String(w['קוד שבוע']) === '111' && hasLinks(w));
if (w111) {
  await api('PATCH', `${enc(W)}/${w111.id}`, { 'קוד שבוע': NEW_CODE, 'שגיאת חישוב קג לפי מבנים': null });
  console.log(`✓ שבוע "111" תוקן ל-${NEW_CODE}`);
  for (const [table, key] of [['חשבוניות', 'חשבוניות'], ['תעודות משלוח', 'תעודות משלוח']]) {
    for (const link of w111[key] || []) {
      const id = link?.id || link;
      await api('PATCH', `${enc(table)}/${id}`, { 'קוד שבוע': NEW_CODE });
      console.log(`  ✓ ${table} ${String(id).slice(-6)} עודכן ל-${NEW_CODE}`);
    }
  }
}

// 3) "2026-07-11" → פורמט שבוע תקין (שבת 11/07 – חמישי 16/07)
const wJul = weeks.find((w) => String(w['קוד שבוע']) === '2026-07-11');
if (wJul) {
  await api('PATCH', `${enc(W)}/${wJul.id}`, { 'קוד שבוע': '20260711-20260716' });
  console.log('✓ "2026-07-11" תוקן ל-20260711-20260716');
}

// 4) תיקון ה-JSON השבור וניקוי שדה השגיאה
for (const w of weeks) {
  const raw = String(w['JSON עבודות קטיף לפי ימים'] || '');
  if (!raw) continue;
  let ok = true;
  try { JSON.parse(raw); } catch { ok = false; }
  if (ok) continue;
  const fixedJson = raw.replace(/\\_/g, '_');
  try { JSON.parse(fixedJson); } catch { console.log(`⚠ שבוע ${w['קוד שבוע']}: ה-JSON שבור בדרך אחרת — לא תוקן`); continue; }
  await api('PATCH', `${enc(W)}/${w.id}`, { 'JSON עבודות קטיף לפי ימים': fixedJson, 'שגיאת חישוב קג לפי מבנים': null });
  console.log(`✓ שבוע ${w['קוד שבוע']}: ה-JSON תוקן ושדה השגיאה נוקה`);
}

// אימות
const after = await api('GET', `${enc(W)}?raw=1&fields=${['קוד שבוע', 'תאריך התחלה', 'שגיאת חישוב קג לפי מבנים'].map(enc).join(',')}`);
console.log('--- מצב סופי ---');
after.forEach((w) => console.log(' ', JSON.stringify(w['קוד שבוע']), '| התחלה:', JSON.stringify(w['תאריך התחלה'])?.slice(0, 22), '| שגיאה:', String(w['שגיאת חישוב קג לפי מבנים'] || '').trim() ? 'יש' : '—'));
console.log('✅ סיום');
