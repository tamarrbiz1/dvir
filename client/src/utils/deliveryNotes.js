// ============================================================
// תעודות משלוח — קריאה אחידה של שדות ופירוק "סיכום יומי" (סעיף 29)
// ------------------------------------------------------------
// כל המסכים שמציגים תעודות משלוח (המסך הראשי, כרטיס מבנה, כרטיס
// משווק, סיכום שבועי, חשבוניות) עוברים דרך הקובץ הזה, כך ששינוי
// שם שדה ב-Airtable מתוקן במקום אחד.
//
// שמות השדות החיים בטבלה "תעודות משלוח":
//   מספר תעודה · תאריך תעודה · משווק (קישור) · משווק-AI · שם משווק ·
//   מבנה (קישור) · סיכום שבועי (קישור) · קוד שבוע · תעודת משלוח (קובץ) ·
//   כמות קרטונים · משקל כולל · משקל ממוצע לקרטון · סטייה מממוצע 12.3 ·
//   בדיקת חריגת משקל · סיכום יומי (JSON) · תאריך העלאת קובץ
// ============================================================
import { pick } from './field.js';

export const DELIVERY_TABLE = 'תעודות משלוח';

// ------------------------------------------------------------
// עזרי קריאה — מחזירים null כשאין ערך (null לעולם לא הופך ל-0)
// ------------------------------------------------------------
export function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

// אובייקט מקושר ראשון: {id, name} או null
export function firstLink(v) {
  if (!v) return null;
  const item = Array.isArray(v) ? v[0] : v;
  if (!item) return null;
  if (typeof item === 'object') return { id: item.id || null, name: item.name || '' };
  return { id: null, name: String(item) };
}

// האם רשומה מקושרת (בשדה נתון) למזהה מסוים
export function linkedTo(record, field, id) {
  if (!record || !id) return false;
  const v = record[field];
  if (!Array.isArray(v)) return false;
  return v.some((x) => String(x?.id ?? x) === String(id));
}

export const noteNumber = (n) => pick(n, ['מספר תעודה']);
export const noteDate = (n) => pick(n, ['תאריך תעודה', 'תאריך', 'תאריך העלאת קובץ']);
export const noteUploadDate = (n) => pick(n, ['תאריך העלאת קובץ', 'העלאה אחרונה של תעודת המשלוח']);
export const noteCartons = (n) => numOrNull(pick(n, ['כמות קרטונים', 'קרטונים']));
export const noteWeight = (n) => numOrNull(pick(n, ['משקל כולל', 'משקל']));
export const noteAvg = (n) => numOrNull(pick(n, ['משקל ממוצע לקרטון', 'ק"ג לקרטון']));
export const noteDeviation = (n) => numOrNull(pick(n, ['סטייה מממוצע 12.3', 'סטיית משקל']));
export const noteCheck = (n) => pick(n, ['בדיקת חריגת משקל', 'בדיקת משקל']);
export const noteWeekCode = (n) => pick(n, ['קוד שבוע']) || firstLink(n?.['סיכום שבועי'])?.name || null;
export const noteWeekLink = (n) => firstLink(n?.['סיכום שבועי']);
export const noteStructure = (n) => firstLink(n?.['מבנה']);

// משווק: מעדיפים את האובייקט המקושר; נופלים לשם טקסטואלי בלי מזהה
export function noteMarketer(n) {
  const link = firstLink(n?.['משווק']);
  if (link && link.name) return link;
  const txt = pick(n, ['שם משווק', 'משווק-AI']);
  return txt ? { id: null, name: String(txt) } : null;
}

// המסמך המצורף (קובץ התעודה)
export function noteDocument(n) {
  const v = n?.['תעודת משלוח'];
  const att = Array.isArray(v) ? v[0] : null;
  if (!att || typeof att !== 'object' || !att.url) return null;
  const type = att.type || '';
  return {
    url: att.url,
    filename: att.filename || 'מסמך',
    type,
    isImage: type.startsWith('image/'),
    isPdf: type === 'application/pdf',
    thumb: att.thumbnails?.large?.url || att.thumbnails?.small?.url || null,
    size: att.size || null,
  };
}

// האם בדיקת המשקל מסמנת חריגה (ערך קיים ואינו "תקין")
export function isWeightAnomaly(n) {
  const c = noteCheck(n);
  if (!c) return false;
  const s = String(c);
  return !(s.includes('תקין') || s.includes('✓') || s.toLowerCase() === 'ok');
}

// ------------------------------------------------------------
// פירוק "סיכום יומי"
// המבנה בפועל: { days: [ { date, cartons, weight, pallets,
//                           products: [{variety, cartons, weight, pallets}],
//                           shipments: [{shipment_number, variety, cartons, weight, pallets}] } ] }
// יש גם גרסאות ישנות שבהן products/shipments נמצאים בשורש.
// ------------------------------------------------------------
const n0 = (v) => numOrNull(v) ?? 0;

function normProduct(p) {
  return {
    variety: p?.variety ?? p?.var ?? p?.['זן'] ?? 'אחר',
    cartons: n0(p?.cartons ?? p?.['קרטונים']),
    weight: n0(p?.weight ?? p?.['משקל']),
    pallets: n0(p?.pallets ?? p?.['משטחים']),
  };
}

function normShipment(s) {
  return {
    number: s?.shipment_number ?? s?.number ?? s?.['מספר משלוח'] ?? '',
    variety: s?.variety ?? s?.var ?? s?.['זן'] ?? '',
    cartons: n0(s?.cartons ?? s?.['קרטונים']),
    weight: n0(s?.weight ?? s?.['משקל']),
    pallets: n0(s?.pallets ?? s?.['משטחים']),
    date: s?.date ?? s?.['תאריך'] ?? null,
  };
}

export function parseDailySummary(json) {
  const empty = { days: [], products: [], shipments: [], totals: { cartons: 0, weight: 0, pallets: 0 } };
  if (!json) return empty;
  let p;
  try { p = typeof json === 'string' ? JSON.parse(json) : json; } catch { return empty; }
  if (!p || typeof p !== 'object') return empty;

  const rawDays = Array.isArray(p.days) ? p.days : (Array.isArray(p) ? p : []);
  const days = rawDays.map((d) => {
    const day = typeof d === 'object' && d ? d : { date: d };
    const products = (Array.isArray(day.products) ? day.products : []).map(normProduct);
    const shipments = (Array.isArray(day.shipments) ? day.shipments : []).map((s) => ({ ...normShipment(s), date: day.date ?? day['תאריך'] ?? null }));
    // אם אין סיכומי יום מפורשים — נצבור מהמשלוחים/מוצרים (סכימה בלבד, לא חישוב עסקי)
    const src = products.length ? products : shipments;
    const cartons = numOrNull(day.cartons ?? day['קרטונים']) ?? src.reduce((s, x) => s + x.cartons, 0);
    const weight = numOrNull(day.weight ?? day['משקל']) ?? src.reduce((s, x) => s + x.weight, 0);
    const pallets = numOrNull(day.pallets ?? day['משטחים']) ?? src.reduce((s, x) => s + x.pallets, 0);
    return { date: day.date ?? day['תאריך'] ?? null, cartons, weight, pallets, products, shipments };
  });

  // מוצרים/משלוחים ברמת השורש (גרסה ישנה) — מצטרפים לסיכום הכולל
  const rootProducts = (Array.isArray(p.products) ? p.products : []).map(normProduct);
  const rootShipments = (Array.isArray(p.shipments) ? p.shipments : []).map(normShipment);

  const byVariety = new Map();
  const addProduct = (pr) => {
    const cur = byVariety.get(pr.variety) || { variety: pr.variety, cartons: 0, weight: 0, pallets: 0 };
    cur.cartons += pr.cartons; cur.weight += pr.weight; cur.pallets += pr.pallets;
    byVariety.set(pr.variety, cur);
  };
  if (days.some((d) => d.products.length)) days.forEach((d) => d.products.forEach(addProduct));
  else if (rootProducts.length) rootProducts.forEach(addProduct);
  else days.forEach((d) => d.shipments.forEach(addProduct));

  const shipments = days.some((d) => d.shipments.length) ? days.flatMap((d) => d.shipments) : rootShipments;
  const products = [...byVariety.values()];
  const totals = {
    cartons: days.length ? days.reduce((s, d) => s + d.cartons, 0) : products.reduce((s, x) => s + x.cartons, 0),
    weight: days.length ? days.reduce((s, d) => s + d.weight, 0) : products.reduce((s, x) => s + x.weight, 0),
    pallets: days.length ? days.reduce((s, d) => s + d.pallets, 0) : products.reduce((s, x) => s + x.pallets, 0),
  };
  return { days, products, shipments, totals };
}

// ------------------------------------------------------------
// סינון תעודות לפי אובייקט מקושר
// ------------------------------------------------------------
export const notesOfMarketer = (notes, id) => notes.filter((n) => linkedTo(n, 'משווק', id));
export const notesOfStructure = (notes, id) => notes.filter((n) => linkedTo(n, 'מבנה', id));
export function notesOfWeek(notes, week) {
  if (!week) return [];
  const code = typeof week === 'string' ? week : week['קוד שבוע'];
  const id = typeof week === 'string' ? null : week.id;
  return notes.filter((n) => (code && noteWeekCode(n) === code) || (id && linkedTo(n, 'סיכום שבועי', id)));
}

// תאריך קצר לגרפים: 29/7
export function shortDate(d) {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d).slice(0, 5) : `${x.getDate()}/${x.getMonth() + 1}`;
}
