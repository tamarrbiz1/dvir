// ============================================================
// חשבוניות — קריאה אחידה של שדות ופירוק "סיכום יומי" (סעיף 28)
// ------------------------------------------------------------
// כל המסכים שמציגים חשבוניות (המסך הראשי, כרטיס משווק, סיכום שבועי,
// חריגות) עוברים דרך הקובץ הזה, כך ששינוי שם שדה ב-Airtable מתוקן
// במקום אחד. null לעולם אינו הופך ל-0.
//
// שמות השדות החיים בטבלה "חשבוניות":
//   מספר חשבונית · כותרת (חשבונית) · משווק (קישור) · משווק-AI · שם משווק ·
//   תאריך-AI · תאריך העלאת קובץ · סטטוס תשלום · חשבונית (קובץ) ·
//   סכום ברוטו · סכום נטו · פדיון כולל · משקל · כמות קרטונים · מספר משטחים ·
//   מחיר נטו לק"ג · מחיר ברוטו לק"ג · משקל ממוצע לקרטון ·
//   ניכוי משווק בפועל · ניכוי משווק צפוי · אחוז ניכוי בפועל · סטיית ניכוי ·
//   בדיקת ניכוי משווק · עלות הובלה · עלות הובלה-AI (אובייקט AI) ·
//   עלות הובלה למשטח · בדיקת חריגת מחיר משטח · קוד שבוע · סיכום שבועי (קישור) ·
//   קישור לתעודת משלוח (טקסט) · צ׳קים (קישור) · סיכום יומי (JSON)
// ============================================================
import { pick } from './field.js';

export const INVOICES_TABLE = 'חשבוניות';

// ערכי "סטטוס תשלום" ב-Airtable (singleSelect)
export const PAYMENT_STATUS = {
  PAID: 'שולם',
  PENDING: 'ממתין לתשלום',
  PARTIAL: 'שולם חלקית',
  CANCELLED: 'מבוטל',
};

// ------------------------------------------------------------
// עזרי קריאה
// ------------------------------------------------------------
export function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  // שדות AI מוחזרים לעיתים כאובייקט {state, value}
  if (typeof v === 'object' && !Array.isArray(v)) return numOrNull(v.value);
  const n = Number(String(Array.isArray(v) ? v[0] : v).replace(/,/g, ''));
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

// כל האובייקטים המקושרים: [{id, name}]
export function allLinks(v) {
  if (!Array.isArray(v)) return [];
  return v.map(firstLink).filter((x) => x && x.name);
}

export function linkedTo(record, field, id) {
  if (!record || !id) return false;
  const v = record[field];
  if (!Array.isArray(v)) return false;
  return v.some((x) => String(x?.id ?? x) === String(id));
}

export const invNumber = (i) => pick(i, ['מספר חשבונית']);
export const invTitle = (i) => pick(i, ['כותרת (חשבונית)', 'כותרת']);
export const invDate = (i) => pick(i, ['תאריך-AI', 'תאריך חשבונית', 'תאריך']);
export const invUploadDate = (i) => pick(i, ['תאריך העלאת קובץ', 'העלאה אחרונה של החשבונית']);
export const invStatus = (i) => pick(i, ['סטטוס תשלום']);
export const invGross = (i) => numOrNull(pick(i, ['סכום ברוטו', 'פדיון כולל', 'ברוטו']));
export const invNet = (i) => numOrNull(pick(i, ['סכום נטו', 'נטו']));
export const invWeight = (i) => numOrNull(pick(i, ['משקל']));
export const invCartons = (i) => numOrNull(pick(i, ['כמות קרטונים', 'קרטונים']));
export const invPallets = (i) => numOrNull(pick(i, ['מספר משטחים', 'משטחים']));
export const invNetPerKg = (i) => numOrNull(pick(i, ['מחיר נטו לק"ג']));
export const invGrossPerKg = (i) => numOrNull(pick(i, ['מחיר ברוטו לק"ג']));
export const invAvgCarton = (i) => numOrNull(pick(i, ['משקל ממוצע לקרטון']));
export const invDeduction = (i) => numOrNull(pick(i, ['ניכוי משווק בפועל', 'ניכוי משווק']));
export const invDeductionExpected = (i) => numOrNull(pick(i, ['ניכוי משווק צפוי']));
export const invDeductionPct = (i) => numOrNull(pick(i, ['אחוז ניכוי בפועל', 'אחוז ניכוי']));
export const invDeductionDev = (i) => numOrNull(pick(i, ['סטיית ניכוי']));
export const invDeductionCheck = (i) => pick(i, ['בדיקת ניכוי משווק', 'בדיקת ניכוי']);
export const invTransport = (i) => numOrNull(pick(i, ['עלות הובלה'])) ?? numOrNull(i?.['עלות הובלה-AI']);
export const invTransportPerPallet = (i) => numOrNull(pick(i, ['עלות הובלה למשטח', 'הובלה למשטח']));
export const invTransportCheck = (i) => pick(i, ['בדיקת חריגת מחיר משטח', 'בדיקת הובלה']);
export const invWeekCode = (i) => pick(i, ['קוד שבוע']) || firstLink(i?.['סיכום שבועי'])?.name || null;
export const invWeekLink = (i) => firstLink(i?.['סיכום שבועי']);
export const invDeliveryRef = (i) => pick(i, ['קישור לתעודת משלוח']);
export const invChecks = (i) => allLinks(i?.['צ׳קים'] ?? i?.["צ'קים"]);

// משווק: מעדיפים את האובייקט המקושר; נופלים לשם טקסטואלי בלי מזהה
export function invMarketer(i) {
  const link = firstLink(i?.['משווק']);
  if (link && link.name) return link;
  const txt = pick(i, ['שם משווק', 'משווק-AI']);
  return txt ? { id: null, name: String(txt) } : null;
}

// כותרת תצוגה: "חשבונית 21" / "חשבונית מס (קניה)"
export function invLabel(i) {
  const n = invNumber(i);
  return n != null && n !== '' ? `חשבונית ${n}` : (invTitle(i) || 'חשבונית');
}

// המסמך המצורף (קובץ החשבונית)
export function invDocument(i) {
  const v = i?.['חשבונית'];
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

// ------------------------------------------------------------
// בדיקות / חריגות — ערך קיים שאינו "תקין" נחשב חריגה
// ------------------------------------------------------------
function isAnomalyValue(c) {
  if (!c) return false;
  const s = String(c).trim();
  return !(s === 'תקין' || s.startsWith('תקין') || s.includes('✓') || s.toLowerCase() === 'ok');
}
export const isDeductionAnomaly = (i) => isAnomalyValue(invDeductionCheck(i));
export const isTransportAnomaly = (i) => isAnomalyValue(invTransportCheck(i));
export const hasAnomaly = (i) => isDeductionAnomaly(i) || isTransportAnomaly(i);

// סוג ה-Badge לסטטוס תשלום (צבע + אייקון + טקסט, לא צבע בלבד)
export function statusBadge(status) {
  const s = String(status || '').trim();
  if (!s) return { cls: 'badge-warn', icon: '⏳', text: 'לא זמין' };
  if (s === PAYMENT_STATUS.PAID) return { cls: 'badge-ok', icon: '✓', text: s };
  if (s === PAYMENT_STATUS.PARTIAL) return { cls: 'badge-warn', icon: '◐', text: s };
  if (s === PAYMENT_STATUS.CANCELLED) return { cls: 'badge-error', icon: '✕', text: s };
  return { cls: 'badge-warn', icon: '⏳', text: s }; // ממתין לתשלום / ערך אחר
}

export function checkBadge(value) {
  if (!value) return { cls: 'badge-warn', icon: '?', text: 'לא זמין' };
  return isAnomalyValue(value)
    ? { cls: 'badge-error', icon: '⚠️', text: String(value) }
    : { cls: 'badge-ok', icon: '✓', text: String(value) };
}

// ------------------------------------------------------------
// פירוק "סיכום יומי"
// המבנה בפועל: { days: [ { date, cartons, weight, pallets, gross_sales_amount,
//                           references: [], products: [{variety, cartons, weight, pallets, gross_sales_amount}] } ],
//                validation: { ... } }
// גרסאות ישנות: מערך שטוח של ימים עם value/var.
// ------------------------------------------------------------
const n0 = (v) => numOrNull(v) ?? 0;

function normProduct(p) {
  return {
    variety: p?.variety ?? p?.var ?? p?.['זן'] ?? 'אחר',
    cartons: n0(p?.cartons ?? p?.['קרטונים']),
    weight: n0(p?.weight ?? p?.['משקל']),
    pallets: n0(p?.pallets ?? p?.['משטחים']),
    revenue: n0(p?.gross_sales_amount ?? p?.revenue ?? p?.value ?? p?.['פדיון']),
  };
}

export function parseInvoiceDaily(json) {
  const empty = { days: [], products: [], rows: [], totals: { cartons: 0, weight: 0, pallets: 0, revenue: 0 }, validation: null };
  if (!json) return empty;
  let p;
  try { p = typeof json === 'string' ? JSON.parse(json) : json; } catch { return empty; }
  if (!p || typeof p !== 'object') return empty;

  const rawDays = Array.isArray(p.days) ? p.days : (Array.isArray(p) ? p : []);
  const days = rawDays.map((d) => {
    const day = typeof d === 'object' && d ? d : { date: d };
    const products = (Array.isArray(day.products) ? day.products : []).map(normProduct);
    const cartons = numOrNull(day.cartons ?? day['קרטונים']) ?? products.reduce((s, x) => s + x.cartons, 0);
    const weight = numOrNull(day.weight ?? day['משקל']) ?? products.reduce((s, x) => s + x.weight, 0);
    const pallets = numOrNull(day.pallets ?? day['משטחים']) ?? products.reduce((s, x) => s + x.pallets, 0);
    const revenue = numOrNull(day.gross_sales_amount ?? day.revenue ?? day.value ?? day['פדיון']) ?? products.reduce((s, x) => s + x.revenue, 0);
    const variety = day.var ?? day.variety ?? day['זן'] ?? null;
    return { date: day.date ?? day['תאריך'] ?? null, cartons, weight, pallets, revenue, variety, products, references: Array.isArray(day.references) ? day.references : [] };
  });

  // שורות תצוגה: תאריך · זן · קרטונים · משקל · פדיון · משטחים (שורה לכל זן ביום)
  const rows = days.flatMap((d) => (
    d.products.length
      ? d.products.map((pr) => ({ date: d.date, variety: pr.variety, cartons: pr.cartons, weight: pr.weight, revenue: pr.revenue, pallets: pr.pallets }))
      : [{ date: d.date, variety: d.variety, cartons: d.cartons, weight: d.weight, revenue: d.revenue, pallets: d.pallets }]
  ));

  const byVariety = new Map();
  rows.forEach((r) => {
    const key = r.variety || 'אחר';
    const cur = byVariety.get(key) || { variety: key, cartons: 0, weight: 0, pallets: 0, revenue: 0 };
    cur.cartons += r.cartons; cur.weight += r.weight; cur.pallets += r.pallets; cur.revenue += r.revenue;
    byVariety.set(key, cur);
  });

  const totals = {
    cartons: days.reduce((s, d) => s + d.cartons, 0),
    weight: days.reduce((s, d) => s + d.weight, 0),
    pallets: days.reduce((s, d) => s + d.pallets, 0),
    revenue: days.reduce((s, d) => s + d.revenue, 0),
  };
  const validation = p.validation && typeof p.validation === 'object' ? p.validation : null;
  return { days, products: [...byVariety.values()], rows, totals, validation };
}

// ------------------------------------------------------------
// סינון חשבוניות לפי אובייקט מקושר
// ------------------------------------------------------------
export const invoicesOfMarketer = (list, id) => list.filter((i) => linkedTo(i, 'משווק', id));
export function invoicesOfWeek(list, week) {
  if (!week) return [];
  const code = typeof week === 'string' ? week : week['קוד שבוע'];
  const id = typeof week === 'string' ? null : week.id;
  return list.filter((i) => (code && invWeekCode(i) === code) || (id && linkedTo(i, 'סיכום שבועי', id)));
}

// קוד שבוע YYYYMMDD-YYYYMMDD → טווח תאריכים
export function weekRange(code) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/.exec(String(code || ''));
  if (!m) return null;
  return { from: `${m[1]}-${m[2]}-${m[3]}`, to: `${m[4]}-${m[5]}-${m[6]}` };
}

// תאריך קצר לגרפים: 29/7
export function shortDate(d) {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d).slice(0, 5) : `${x.getDate()}/${x.getMonth() + 1}`;
}
