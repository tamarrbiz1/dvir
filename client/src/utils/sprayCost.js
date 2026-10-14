// ============================================================
// יחידות מינון, מחיר ליחידה ועלות טיפול (סעיף AR, 14.10.2026)
// ------------------------------------------------------------
// מה נמדד מול הבסיס החי לפני הכתיבה (158 חומרים שיש להם מחיר + גודל
// אריזה + מינון בסמ"ק + מחיר לדונם בריסוס):
//
//   `מחיר` בטבלת "חומרי ריסוס" הוא מחיר ל**אריזה**, לא ליחידת תמחור.
//   88 חומרים תומכים בכך בלעדית, 0 תומכים ב"מחיר ליחידה", 0 לא תואמים
//   אף אחת מההשערות (70 הנותרים הם `גודל האריזה = 1`, שם שתי ההשערות
//   זהות מתמטית). דוגמה מכריעה: אמרלד אנרג'י — 1500 ₪, אריזה 5 ליטר,
//   מינון 60 → "מחיר לדונם בריסוס" בטבלה הוא 18 ₪. "מחיר לאריזה" נותן
//   18, "מחיר ליחידה" נותן 90.
//
// לכן: **מחיר ליחידה = מחיר ÷ גודל האריזה** — תמיד. השדה `יחידת תמחור`
// אינו נכנס לחישוב בכלל; הוא רק אומר מה **שם** היחידה (ליטר / ק"ג) ומה
// יחידת המינון שנגזרת ממנה (סמ"ק / גרם).
//
// אין `גודל האריזה` → אין מחיר ליחידה ואין עלות: "—" + רמז מה חסר.
// לא 0 ולא ניחוש (כלל 16 באיפיון).
//
// `מחיר מחושב` ב-Airtable:
//   ({כמות מחושבת} / ({גודל האריזה (from חומר ריסוס)} * 1000)) * {מחיר (from חומר ריסוס)}
// נכון מתמטית וזהה לחישוב כאן — (סמ"ק→ליטר) ÷ אריזה × ₪-לאריזה. הוא
// **לא** משתנה כאן ואין צורך לתקן אותו. מה שכן נבדל: בפערי-נתונים הוא
// מחזיר **0** (כש`כמות מחושבת` ריקה, כלומר כשאין `בסיס מינון`) או
// **#ERROR!** (כשחסר `גודל האריזה` — חילוק באפס), ולכן התצוגה לא
// נשענת עליו אלא מחשבת מקומית ומראה "—" עם רמז.
// ============================================================

import { formatNumber, formatMoney } from './format.js';

/** יחידות התמחור הקנוניות, ויחידות המינון הנגזרות מהן */
const UNITS = {
  'ליטר': { small: 'סמ"ק', large: 'ליטר' },
  'ק"ג': { small: 'גרם', large: 'ק"ג' },
};
/** סמ"ק→ליטר וגרם→ק"ג — שני המקרים 1000, כמו ב-`מחיר מחושב` של Airtable */
export const PER_LARGE = 1000;

/**
 * נרמול `יחידת תמחור` — **בקוד בלבד, בלי לשנות נתונים ב-Airtable**.
 * השדה הוא singleLineText, ובבסיס החי יש שני איותים לק"ג: "ק׳ג" (23
 * רשומות, גרש) ו-"ק\"ג" (8, גרשיים). מנורמל גם "קג" ו-"ק''ג".
 * מחזיר 'ליטר' | 'ק"ג' | null (ריק או איות לא מזוהה).
 */
export function pricingUnit(material) {
  const raw = String(material?.['יחידת תמחור'] ?? '').trim();
  if (!raw) return null;
  // הסרת כל סימני הגרש/גרשיים והרווחים — "ק׳ג" / "ק\"ג" / "ק''ג" / "קג" → "קג"
  const clean = raw.replace(/["'`׳״‘’“”\s]/g, '');
  if (clean === 'קג' || clean === 'קילו' || clean === 'קילוגרם') return 'ק"ג';
  if (clean === 'ליטר' || clean === 'ליטרים' || clean === 'ל') return 'ליטר';
  return null;
}

/** הערך הגולמי של `יחידת תמחור` כפי שהוא בבסיס (לרמז על איות לא מזוהה) */
export function rawPricingUnit(material) {
  return String(material?.['יחידת תמחור'] ?? '').trim();
}

/** יחידת המינון של החומר: 'סמ"ק' לליטר, 'גרם' לק"ג, '' כשאין יחידת תמחור */
export function dosageUnit(material) {
  const u = pricingUnit(material);
  return u ? UNITS[u].small : '';
}

/** היחידה הגדולה: 'ליטר' / 'ק"ג' / '' */
export function largeUnit(material) {
  const u = pricingUnit(material);
  return u ? UNITS[u].large : '';
}

/** רמז קצר כשאין יחידת מינון להציג, או null כשהכל בסדר */
export function unitHint(material) {
  if (pricingUnit(material)) return null;
  const raw = rawPricingUnit(material);
  return raw ? `יחידת תמחור לא מזוהה לחומר: "${raw}"` : 'חסרה יחידת תמחור לחומר';
}

/**
 * כמות בסמ"ק/גרם → טקסט לתצוגה, ביחידה הגדולה כשהיא 1000 ומעלה:
 * 2,400 סמ"ק → "2.4 ליטר"; 80,000 גרם → "80 ק"ג"; 400 גרם → "400 גרם".
 * בלי יחידת תמחור — מספר בלבד, בלי יחידה.
 */
export function formatSmallAmount(value, material) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
  const u = pricingUnit(material);
  if (!u) return formatNumber(n);
  if (Math.abs(n) >= PER_LARGE) return `${formatNumber(n / PER_LARGE)} ${UNITS[u].large}`;
  return `${formatNumber(n)} ${UNITS[u].small}`;
}

/** כמות שכבר ביחידה הגדולה (בסיס "אחוז") → "1.2 ליטר" */
export function formatLargeAmount(value, material) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
  const u = pricingUnit(material);
  return u ? `${formatNumber(n)} ${UNITS[u].large}` : formatNumber(n);
}

/** כמות כלשהי (לפי unitKind של החישוב) → טקסט */
export function formatAmount(value, material, unitKind) {
  return unitKind === 'large' ? formatLargeAmount(value, material) : formatSmallAmount(value, material);
}

/**
 * תווית המינון: "400 גרם לליטר", "65 סמ"ק לדונם", "0.5%".
 * basis — אחד מערכי `בסיס מינון`: לליטר | ל-100 ליטר | לדונם | אחוז.
 */
export function formatDosage(dosage, basis, material) {
  if (dosage === null || dosage === undefined || dosage === '' || !Number.isFinite(Number(dosage))) return null;
  const n = Number(dosage);
  const b = String(basis || '').trim();
  if (b === 'אחוז') return `${formatNumber(n)}%`;
  const unit = dosageUnit(material);
  return [formatNumber(n), unit, b].filter(Boolean).join(' ');
}

/**
 * אופי כל בסיס מינון:
 *   perSprayer — האם `כמות מחושבת` היא למרסס אחד (ולכן מוכפלת במספר
 *                המרססים), או לכל השטח ("לדונם" — כבר כולל את השטח).
 *   unitKind   — האם התוצאה ביחידה הקטנה (סמ"ק/גרם) או הגדולה.
 *
 * ⚠️ "אחוז" הוא **סטייה מכוונת** מ-`מחיר מחושב` של Airtable: ריסוס
 * ב-0.5% פירושו 0.5 ליטר חומר לכל 100 ליטר מים, כלומר מרסס 200 ליטר
 * צורך **ליטר אחד** — יחידה גדולה. Airtable מתייחס לתוצאה כאל סמ"ק
 * ולכן מחזיר שם עלות קטנה פי 1000. אין בבסיס החי אף ריסוס בבסיס
 * "אחוז" (10 רשומות "לדונם", 18 בלי בסיס), ולכן זו כרגע הבדלה
 * תיאורטית — מדווחת לתמר ולא מתוקנת בנוסחה (אין הרשאה).
 */
const BASES = {
  'לדונם': { perSprayer: false, unitKind: 'small' },
  'לליטר': { perSprayer: true, unitKind: 'small' },
  'ל-100 ליטר': { perSprayer: true, unitKind: 'small' },
  'אחוז': { perSprayer: true, unitKind: 'large' },
};

const DOSAGE_FIELDS = ['מינון ', 'מינון']; // השדה החי נקרא "מינון " (עם רווח בסוף)
function dosageOf(t) {
  for (const f of DOSAGE_FIELDS) {
    const v = t?.[f];
    if (v !== null && v !== undefined && v !== '') return Number(v);
  }
  return NaN;
}
/** מספר בלבד — Airtable מחזיר {error:'#ERROR!'} לנוסחה שנכשלה */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

/** מספר המרססים בפועל: ריק = 1, ולא פחות מ-1 */
export function sprayerCount(t) {
  const n = Number(t?.['מספר המרססים']);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * כמות החומר בטיפול.
 * מעדיף את `כמות מחושבת` של Airtable (כלל 4 — לא לשחזר חישובים), ונופל
 * לחישוב מקומי זהה כשהיא ריקה/שגויה, כדי שהתצוגה לא תתרוקן בגללה.
 *
 * @returns {{
 *   basis: string, unitKind: 'small'|'large', sprayers: number,
 *   perSprayer: number|null, total: number|null,
 *   fromAirtable: boolean, missing: string[]
 * }}
 */
export function treatmentQuantity(t) {
  const basis = String(t?.['בסיס מינון'] || '').trim();
  const spec = BASES[basis];
  const sprayers = sprayerCount(t);
  const missing = [];
  const dosage = dosageOf(t);
  if (!Number.isFinite(dosage) || dosage <= 0) missing.push('חסר מינון');
  if (!spec) missing.push('חסר בסיס מינון');

  let qty = num(t?.['כמות מחושבת']);
  let fromAirtable = Number.isFinite(qty);
  if (!fromAirtable && spec && Number.isFinite(dosage)) {
    // אותו חישוב בדיוק כמו הנוסחה `כמות מחושבת` ב-Airtable
    const area = num(t?.['חישוב שטח בדונם של כלל המבנים']);
    const size = Number(t?.['גודל מרסס בליטר']);
    if (basis === 'לדונם') {
      if (Number.isFinite(area)) qty = area * dosage;
      else missing.push('חסר שטח בדונם למבנה');
    } else if (Number.isFinite(size) && size > 0) {
      if (basis === 'לליטר') qty = size * dosage;
      else if (basis === 'ל-100 ליטר') qty = (size / 100) * dosage;
      else qty = size * (dosage / 100); // אחוז
    } else {
      missing.push('חסר גודל מרסס');
    }
  }
  if (!Number.isFinite(qty)) {
    return { basis, unitKind: spec?.unitKind || 'small', sprayers, perSprayer: null, total: null, fromAirtable: false, missing };
  }
  const perSprayer = spec.perSprayer ? qty : (sprayers > 1 ? qty / sprayers : null);
  const total = spec.perSprayer ? qty * sprayers : qty;
  return { basis, unitKind: spec.unitKind, sprayers, perSprayer, total, fromAirtable, missing };
}

/**
 * מחיר ליחידה של חומר = `מחיר` ÷ `גודל האריזה` (ר' ההסבר בראש הקובץ).
 * @returns {{ value: number|null, unit: string, missing: string[] }}
 */
export function unitPrice(material) {
  const missing = [];
  const price = Number(material?.['מחיר']);
  const pkg = Number(material?.['גודל האריזה']);
  const hasPrice = material?.['מחיר'] !== null && material?.['מחיר'] !== undefined && material?.['מחיר'] !== '' && Number.isFinite(price);
  const hasPkg = Number.isFinite(pkg) && pkg > 0;
  if (!material) missing.push('חסר חומר ריסוס');
  else {
    if (!hasPrice) missing.push('חסר מחיר לחומר');
    if (!hasPkg) missing.push('חסר גודל האריזה לחומר');
  }
  const unit = largeUnit(material);
  if (missing.length) return { value: null, unit, missing };
  return { value: price / pkg, unit, missing };
}

/** "מחיר לליטר" / "מחיר לק"ג" / "מחיר ליחידה" (כשאין יחידת תמחור) */
export function unitPriceLabel(material) {
  const u = largeUnit(material);
  return u ? `מחיר ל${u}` : 'מחיר ליחידה';
}

/** "₪17 לליטר" — מחיר ליחידה מעוצב, או null */
export function formatUnitPrice(material) {
  const { value, unit } = unitPrice(material);
  if (value == null) return null;
  return unit ? `${formatMoney(value)} ל${unit}` : formatMoney(value);
}

/**
 * עלות הטיפול = כמות כוללת ביחידה הגדולה × מחיר ליחידה.
 * שווה-ערך ל-`מחיר מחושב` של Airtable, אבל מחזיר null (→ "—" + רמז)
 * במקום 0 / #ERROR! כשחסר נתון.
 *
 * @returns {{ value: number|null, missing: string[], quantity: object, unitPrice: number|null }}
 */
export function treatmentCost(t, material) {
  const quantity = treatmentQuantity(t);
  const up = unitPrice(material);
  const missing = [...quantity.missing, ...up.missing];
  if (quantity.total == null || up.value == null) {
    return { value: null, missing, quantity, unitPrice: up.value };
  }
  const large = quantity.unitKind === 'large' ? quantity.total : quantity.total / PER_LARGE;
  return { value: large * up.value, missing, quantity, unitPrice: up.value };
}

/**
 * סיכום עלויות לאוסף טיפולים.
 * @param rows מערך של { raw, material } — raw = רשומת הריסוס, material = רשומת החומר
 * @returns {{ total: number, counted: number, unknown: number, missing: string[] }}
 */
export function costSummary(rows) {
  let total = 0, counted = 0, unknown = 0;
  const missing = new Set();
  for (const r of rows || []) {
    // שורה שכבר מחזיקה עלות מחושבת (אירוע ביומן) — לא מחשבים מחדש
    const c = r?.cost && typeof r.cost === 'object' && 'value' in r.cost
      ? r.cost : treatmentCost(r.raw ?? r, r.material);
    if (c.value == null) { unknown += 1; c.missing.forEach((m) => missing.add(m)); }
    else { total += c.value; counted += 1; }
  }
  return { total, counted, unknown, missing: [...missing] };
}

/** טקסט ה-tooltip לתא "—": מה חסר כדי לחשב */
export function missingText(missing) {
  const list = [...new Set(missing || [])];
  return list.length ? `אין עלות: ${list.join(' · ')}` : 'אין עלות — חסרים נתונים';
}
