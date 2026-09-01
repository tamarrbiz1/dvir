// ============================================================
// בדיקות איכות ובקרה — מריצים: node server/src/qa-check.mjs
// ------------------------------------------------------------
// בודק מול השרת החי: קריאת כל הטבלאות (עם מדידת זמן), כל זרימות
// הכתיבה שהמסכים מבצעים (יצירה/עדכון/מחיקה על רשומות זמניות),
// כניסת עובד, העלאת מסמך ויצירה קבוצתית — עם ניקוי מלא בסוף.
// כל שורה מדווחת PASS/FAIL + משך בביצוע. יציאה 1 אם משהו נכשל.
// ============================================================
const BASE = process.env.QA_BASE || 'http://127.0.0.1:4000/api';
const MARK = 'QA-' + Date.now();
const enc = encodeURIComponent;
const results = [];
const cleanup = [];

const READ_WARN_MS = 2000;   // קריאה איטית מזה מסומנת באזהרה
const WRITE_WARN_MS = 3500;  // כתיבה איטית מזה מסומנת באזהרה

async function api(method, path, body, isForm = false) {
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: isForm ? body : (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${r.status}: ${json?.error || text.slice(0, 140)}`);
  return json;
}
const get = (t, qs = '?maxRecords=3&raw=1') => api('GET', `${enc(t)}${qs}`);
const create = async (t, fields) => {
  const rec = await api('POST', enc(t), fields);
  if (rec?.id) cleanup.push({ table: t, id: rec.id });
  if (Array.isArray(rec)) rec.forEach((x) => x?.id && cleanup.push({ table: t, id: x.id }));
  return rec;
};
const patch = (t, id, fields) => api('PATCH', `${enc(t)}/${id}`, fields);
const del = (t, id) => api('DELETE', `${enc(t)}/${id}`);

async function test(name, fn, warnMs = WRITE_WARN_MS) {
  const t0 = Date.now();
  try {
    const extra = await fn();
    const ms = Date.now() - t0;
    results.push([ms > warnMs ? 'SLOW' : 'PASS', name, ms, extra || '']);
  } catch (e) {
    results.push(['FAIL', name, Date.now() - t0, String(e.message || e).slice(0, 110)]);
  }
}

const today = new Date().toISOString().slice(0, 10);

// ============ 1. קריאת כל הטבלאות + זמני תגובה ============
const tables = await api('GET', 'tables');
for (const t of tables) {
  await test(`קריאה: ${t.name}`, async () => {
    const rows = await api('GET', `${enc(t.name)}?maxRecords=50`);
    return `${Array.isArray(rows) ? rows.length : 0} רשומות`;
  }, READ_WARN_MS);
}

// ============ 2. נתוני עזר ============
const structures = await get('מבנים');
const workers = await get('עובדים', '?maxRecords=5&raw=1');
const pricing = await get('תמחור עבודות', '?maxRecords=10&raw=1');
const materials = await get('חומרי ריסוס');
const suppliersList = await get('ספקים');
const sId = structures[0]?.id, wId = workers[0]?.id, mId = materials[0]?.id;
const priced = pricing.find((x) => x['מחיר'] != null);

// ============ 3. זרימות כתיבה ============
await test('עבודה חדשה (שעות dateTime + תמחור)', async () => {
  const rec = await create('עבודות עובדים', {
    'תאריך': today, 'עובד': [wId], 'מבנה': [sId], 'תמחור עבודות': [priced.id],
    'כמות': 2, 'שעת התחלה': `${today}T08:00:00.000Z`, 'שעת סיום': `${today}T12:00:00.000Z`, 'הערות': MARK,
  });
  return `id=${rec.id.slice(-5)}`;
});

await test('אוטומציית שכר (עדכון מחיר → סכום לתשלום)', async () => {
  const rec = cleanup.find((c) => c.table === 'עבודות עובדים');
  await patch('עבודות עובדים', rec.id, { 'עדכון מחיר': false });
  await patch('עבודות עובדים', rec.id, { 'עדכון מחיר': true });
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const back = await api('GET', `${enc('עבודות עובדים')}/${rec.id}`);
    if (back['סכום לתשלום'] != null) return `₪${back['סכום לתשלום']} (2×${priced['מחיר']})`;
  }
  throw new Error('הסכום לא חושב תוך 24 שניות');
}, 30000);

await test('טיפול/ריסוס: יצירה + בוצע + עריכה', async () => {
  const rec = await create('ריסוסים', { 'תאריך': today, 'מבנה': [sId], 'חומר ריסוס': [mId], 'מינון ': 100, 'הערות': MARK });
  await patch('ריסוסים', rec.id, { 'בוצע': true });
  await patch('ריסוסים', rec.id, { 'מינון ': 150 });
});

await test('קטיף: יצירה + הופעה מיידית ברשימה', async () => {
  await api('GET', `${enc('קטיפים')}?maxRecords=1500`); // חימום מטמון — מדמה מסך פתוח
  const rec = await create('קטיפים', { 'תאריך': today, 'מבנה': [sId], 'כמות ק"ג': 5, 'הערות': MARK });
  const list = await api('GET', `${enc('קטיפים')}?maxRecords=1500`);
  if (!list.some((x) => x.id === rec.id)) throw new Error('לא הופיע מיד ברשימה');
  return 'מופיע מיד';
});

await test('מלאי: יצירה (קטגוריה מהרשימה) + עדכון + תאריך', async () => {
  const opts = await api('GET', `select-options/${enc('מלאי בסיסי')}/${enc('קטגוריה')}`);
  const rec = await create('מלאי בסיסי', { 'קטגוריה': opts.choices[0], 'מלאי נוכחי': 5, 'מלאי מינימום': 1, 'הערות': MARK });
  await patch('מלאי בסיסי', rec.id, { 'מלאי נוכחי': 8, 'תאריך עדכון': today });
});

await test('ספק: יצירה + הוספת פרטים', async () => {
  const rec = await create('ספקים', { 'שם ספק': MARK });
  await patch('ספקים', rec.id, { 'טלפון': '050-1111111' });
});

await test('הוצאה: יצירה + קשר לספק', async () => {
  const rec = await create('הוצאות', { 'הערות': MARK, 'תאריך העלאת החשבונית': today });
  if (suppliersList[0]?.id) await patch('הוצאות', rec.id, { 'ספקים': [suppliersList[0].id] });
});

await test('ימי אי עבודה: יצירה קבוצתית (3 ימים בבקשה אחת)', async () => {
  const opts = await api('GET', `select-options/${enc('ימי אי עבודה')}/${enc('סוג החג')}`);
  const created = await create('ימי אי עבודה', [
    { 'תאריך': '2032-01-01', 'סוג החג': opts.choices[0] },
    { 'תאריך': '2032-01-02', 'סוג החג': opts.choices[0] },
    { 'תאריך': '2032-01-03', 'סוג החג': opts.choices[0] },
  ]);
  if (!Array.isArray(created) || created.length !== 3) throw new Error('לא נוצרו 3 רשומות');
  return '3 רשומות בבקשה אחת';
});

await test('חומר ריסוס: יצירה + עריכה', async () => {
  const rec = await create('חומרי ריסוס', { 'שם חומר': MARK, 'מחיר': 9 });
  await patch('חומרי ריסוס', rec.id, { 'מחיר': 11 });
});

await test('גידול: יצירה', async () => { await create('גידולים', { 'שם גידול': MARK }); });

await test('בקשת עובד: יצירה (חופש) + אישור מנהל', async () => {
  const rec = await create('בקשות עובדים', { 'עובד': [wId], 'סוג בקשה': 'חופש', 'תאריך': today, 'סטטוס': 'ממתין לאישור' });
  await patch('בקשות עובדים', rec.id, { 'סטטוס': 'אושר', 'הערת מנהל': MARK, 'תאריך תשובה': new Date().toISOString() });
});

await test('סיכום שבועי: יצירה עם קוד שבוע + מחיקה', async () => {
  const code = '20990101-20990106';
  const rec = await create('סיכום שבועי', { 'קוד שבוע': code });
  const back = await api('GET', `${enc('סיכום שבועי')}/${rec.id}`);
  if (back['קוד שבוע'] !== code) throw new Error('הקוד לא נשמר');
});

await test('תמחור עבודות: יצירה + עריכה', async () => {
  const rec = await create('תמחור עבודות', { 'סוג עבודה': MARK, 'מחיר': 5 });
  await patch('תמחור עבודות', rec.id, { 'מחיר': 6 });
});

await test('משווק: יצירה + עריכה', async () => {
  const rec = await create('משווקים', { 'שם משווק': MARK });
  await patch('משווקים', rec.id, { 'איש קשר': 'בדיקה' });
});

await test('חשבונית: יצירה + סטטוס תשלום', async () => {
  const opts = await api('GET', `select-options/${enc('חשבוניות')}/${enc('סטטוס תשלום')}`).catch(() => ({ choices: [] }));
  const rec = await create('חשבוניות', { 'קוד שבוע': MARK });
  if (opts.choices?.[0]) await patch('חשבוניות', rec.id, { 'סטטוס תשלום': opts.choices[0] });
});

await test('תעודת משלוח: יצירה + עדכון + מחיקה', async () => {
  const rec = await create('תעודות משלוח', { 'קוד שבוע': MARK });
  await patch('תעודות משלוח', rec.id, { 'קוד שבוע': MARK + 'b' });
});

await test("צ'ק: יצירה + סטטוס", async () => {
  const rec = await create('צ׳קים', { 'מוטב': MARK, 'סכום צ׳ק': '123', 'תאריך פירעון': '01/10/2026' });
  await patch('צ׳קים', rec.id, { 'סטטוס': 'נפרע' });
});

await test('כניסת עובד: אימייל+דרכון נכונים', async () => {
  const w = workers.find((x) => x['מייל'] && x['מספר דרכון']);
  if (!w) return 'דולג — אין עובד עם מייל+דרכון';
  const res = await api('POST', 'worker-login', { email: w['מייל'], passport: w['מספר דרכון'] });
  if (!res?.worker?.id) throw new Error('לא הוחזר עובד');
  return res.worker['שם פרטי'] || 'זוהה';
});

await test('כניסת עובד: פרטים שגויים נדחים', async () => {
  try {
    await api('POST', 'worker-login', { email: 'wrong@x.com', passport: 'ZZ000' });
    throw new Error('התקבלה כניסה עם פרטים שגויים!');
  } catch (e) {
    if (String(e.message).startsWith('401')) return 'נדחה כנדרש (401)';
    throw e;
  }
});

await test('העלאת מסמך: קובץ → רשומה עם צרופה', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'qa.png');
  fd.append('table', 'דוחות ריסוסים');
  fd.append('field', 'דוח ריסוסים');
  const j = await api('POST', 'upload-document', fd, true);
  if (!j?.record?.id) throw new Error('לא נוצרה רשומה');
  cleanup.push({ table: 'דוחות ריסוסים', id: j.record.id });
  const back = await api('GET', `${enc('דוחות ריסוסים')}/${j.record.id}`);
  if (!Array.isArray(back['דוח ריסוסים']) || !back['דוח ריסוסים'].length) throw new Error('הקובץ לא הוצמד');
  return 'קובץ מוצמד';
});

// ---- הרשאות מנהל (מקור אמת בצד השרת) ----
await test('כניסת מנהל: מייל+קוד נכונים → תפקיד מהטבלה', async () => {
  const admins = await get('הרשאת מנהל', '?raw=1');
  const admin = admins.find((a) => a['מייל'] && a['קוד אישי']);
  if (!admin) return 'דולג — אין רשומת מנהל עם קוד';
  const res = await api('POST', 'admin-login', { email: admin['מייל'], code: admin['קוד אישי'] });
  if (!res?.role) throw new Error('לא הוחזר תפקיד');
  return `${res.name} → ${res.role}`;
});
await test('כניסת מנהל: קוד שגוי נדחה', async () => {
  const admins = await get('הרשאת מנהל', '?raw=1');
  const admin = admins.find((a) => a['מייל']);
  try {
    await api('POST', 'admin-login', { email: admin['מייל'], code: 'wrong-code-000' });
    throw new Error('התקבלה כניסה עם קוד שגוי!');
  } catch (e) {
    if (String(e.message).startsWith('401')) return 'נדחה (401)';
    throw e;
  }
});
await test('רענון תפקיד חי (admin-role)', async () => {
  const admins = await get('הרשאת מנהל', '?raw=1');
  const admin = admins.find((a) => a['מייל']);
  const res = await api('POST', 'admin-role', { email: admin['מייל'] });
  if (!res?.role) throw new Error('לא הוחזר תפקיד');
  return `${res.role} (סוג: ${res.type || 'ריק'})`;
});

// ---- בקשת עדכון תאריך עבודה: עובד מבקש → מנהל מאשר עם תוקף ----
await test('עדכון תאריך: בקשה → אישור עם תוקף 48ש → הרשאה בתוקף', async () => {
  const MARKD = '[עדכון תאריך]';
  const rec = await create('בקשות עובדים', {
    'עובד': [wId], 'תאריך': today, 'סטטוס': 'ממתין לאישור',
    'הערות עובד': `${MARKD} ${MARK}`,
  });
  const expiry = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  await patch('בקשות עובדים', rec.id, {
    'סטטוס': 'אושר', 'מאפשר הזנת עבודה לתאריך': true, 'עד שעה': expiry, 'תאריך תשובה': new Date().toISOString(),
  });
  const back = await api('GET', `${enc('בקשות עובדים')}/${rec.id}`);
  if (!back['מאפשר הזנת עבודה לתאריך']) throw new Error('ההרשאה לא נשמרה');
  const exp = new Date(String(back['עד שעה']));
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) throw new Error('התוקף לא נשמר נכון');
  if (!String(back['הערות עובד'] || '').startsWith(MARKD)) throw new Error('סימון הסוג לא נשמר');
  return 'אושר, בתוקף 48ש';
});

// ============ 4. ניקוי מלא ============
let cleaned = 0, cleanFailed = 0;
for (const c of cleanup.reverse()) {
  try { await del(c.table, c.id); cleaned++; } catch { cleanFailed++; }
}

// ============ 5. דוח ============
const pad = (v, n) => String(v).padEnd(n);
console.log('\n================= דוח בדיקות איכות =================');
for (const [st, name, ms, extra] of results) {
  const mark = st === 'PASS' ? '✅' : st === 'SLOW' ? '🐢' : '❌';
  console.log(`${mark} ${pad(st, 5)} ${pad(ms + 'ms', 8)} ${name}${extra ? ' — ' + extra : ''}`);
}
const reads = results.filter(([, n]) => n.startsWith('קריאה:'));
const readTimes = reads.map(([, , ms]) => ms);
const writes = results.filter(([, n]) => !n.startsWith('קריאה:'));
console.log('----------------------------------------------------');
console.log(`קריאות: ${reads.length} טבלאות · ממוצע ${Math.round(readTimes.reduce((a, b) => a + b, 0) / (readTimes.length || 1))}ms · מקס ${Math.max(...readTimes, 0)}ms`);
console.log(`כתיבות/זרימות: ${writes.length} · ניקוי: ${cleaned} נמחקו${cleanFailed ? `, ${cleanFailed} נכשלו` : ''}`);
const fails = results.filter(([s]) => s === 'FAIL').length;
const slows = results.filter(([s]) => s === 'SLOW').length;
console.log(fails ? `❌ ${fails} נכשלו` : slows ? `⚠️ הכל עבר, ${slows} איטיות` : '✅ כל הבדיקות עברו במהירות תקינה');
process.exit(fails ? 1 : 0);
