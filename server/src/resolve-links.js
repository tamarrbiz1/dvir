// ============================================================
// פתרון שדות-קישור: הופך מערך של Record IDs למבנה {id, name, table}
// כך שהפרונט לעולם אינו רואה מזהה טכני.
//
// ארכיטקטורה (batch):
// 1. מהמטא של Airtable בונים מפה: טבלה -> שדות-קישור אמיתיים + טבלת היעד.
//    טבלת היעד נלקחת מ-options.linkedTableId (המאפיין הנכון לשדה קישור).
// 2. לכל טבלת יעד נדרשת טוענים אינדקס אחד מלא (id -> שם תצוגה) ושומרים במטמון,
//    ואז פותרים את כל המזהים בזיכרון — בלי קריאת רשת לכל מזהה בנפרד.
// ============================================================

import { getBase, getMeta } from './airtable.js';

const INDEX_TTL_MS = 5 * 60 * 1000; // רענון אינדקס טבלה כל 5 דקות

let metaCache = null;
async function meta() {
  if (!metaCache) metaCache = await getMeta();
  return metaCache;
}

// ============================================================
// שם תצוגה לכל טבלה — מפורש היכן שהשדה הראשי אינו קריא לאדם
// ============================================================
/**
 * מוסיף תווית לפני מספר סידורי — אך ורק כשהערך הוא מספר בלבד,
 * כדי שערך טקסטואלי כמו "מבנה 1" לא יהפוך ל"מבנה מבנה 1".
 */
function labeled(label, value) {
  if (value == null) return null;
  const text = String(Array.isArray(value) ? value[0] : value).trim();
  if (!text) return null;
  return /^\d+$/.test(text) ? `${label} ${text}` : text;
}

const DISPLAY_BY_TABLE = {
  'עובדים': (f) => [f['שם פרטי'], f['שם משפחה']].filter(Boolean).join(' '),
  'מבנים': (f) => labeled('מבנה', f['מספר מבנה']),
  'תמחור עבודות': (f) => [f['סוג עבודה'], f['זן']].filter(Boolean).join(' · '),
  'גידולים': (f) => f['שם גידול'],
  'ספקים': (f) => f['שם ספק'],
  'משווקים': (f) => f['שם משווק'],
  'חומרי ריסוס': (f) => f['שם חומר'],
  'סיכום שבועי': (f) => f['קוד שבוע'],
  'תעודות משלוח': (f) => labeled('תעודה', f['מספר תעודה']),
  'חשבוניות': (f) => labeled('חשבונית', f['מספר חשבונית']),
  'צ׳קים': (f) => labeled('צ׳ק', f['מספר צ׳ק']),
  'תוכניות שתילה': (f) => labeled('תוכנית', f['מספר תוכנית']),
  'קטיפים': (f) => labeled('קטיף', f['מספר קטיף']),
  'ריסוסים': (f) => labeled('ריסוס', f['מספר ריסוס']),
  'עבודות עובדים': (f) => labeled('עבודה', f['מספר עבודה']),
  'הוצאות': (f) => labeled('הוצאה', f['מספר הוצאה']),
  'מלאי בסיסי': (f) => f['קטגוריה'] || labeled('פריט', f['מספר פריט']),
  'תקופות תוכנית': (f) => f['תקופת תוכנית'],
  'תפוקה רבעונית': (f) => f['רבעון גידול'],
  'תחזית שתילה שבועית': (f) => f['תחזית שבועית'],
  'מחירי גידול משוערים': (f) => f['מחיר גידול משוער'],
  'דוחות ריסוסים': (f) => labeled('דוח', f['מספור אוטומטי']),
  'תמחור עבודות לפי מבנים': (f) => labeled('שורה', f['מספור שורה']),
};

// שמות שדה נפוצים לשם תצוגה, כשאין כלל מפורש לטבלה
const GENERIC_NAME_FIELDS = ['שם', 'Name', 'תיאור', 'קוד שבוע', 'רבעון', 'תקופת תוכנית', 'סוג החג'];

// שדה ראשי לפי המטא (ב-Airtable השדה הראשון הוא תמיד השדה הראשי)
let primaryFieldCache = null;
async function primaryFieldOf(tableName) {
  if (!primaryFieldCache) {
    primaryFieldCache = {};
    for (const t of await meta()) primaryFieldCache[t.name] = t.fields[0]?.name;
  }
  return primaryFieldCache[tableName];
}

function firstScalar(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null || typeof v === 'object') return null;
  const s = String(v).trim();
  return s || null;
}

/** בונה פונקציית שם-תצוגה סינכרונית לטבלה (השדה הראשי נפתר מראש). */
async function displayNamerFor(tableName) {
  const custom = DISPLAY_BY_TABLE[tableName];
  const primary = await primaryFieldOf(tableName);

  return (fields) => {
    if (custom) {
      const value = firstScalar(custom(fields));
      if (value) return value;
    }
    for (const key of GENERIC_NAME_FIELDS) {
      const value = firstScalar(fields[key]);
      if (value) return value;
    }
    if (primary) {
      const value = firstScalar(fields[primary]);
      if (value) return value;
    }
    const anyText = Object.values(fields).find((v) => typeof v === 'string' && v.trim());
    return anyText ? anyText.trim() : 'לא זמין';
  };
}

// ============================================================
// מפת קישורים: טבלה -> [{ name, targetTable }]
//
// נכללים שני סוגים:
// 1. שדה קישור אמיתי (multipleRecordLinks) — טבלת היעד ב-options.linkedTableId.
// 2. שדה lookup שמושך שדה-קישור מטבלה אחרת — הוא מחזיר Record IDs גולמיים,
//    ולכן חייב להיפתר גם הוא. טבלת היעד נלקחת מהשדה הפנימי שנשלף.
// שאר שדות ה-lookup מחזירים ערכים רגילים ואין לגעת בהם.
// ============================================================
let linkMapCache = null;
async function buildLinkMap() {
  if (linkMapCache) return linkMapCache;
  const tables = await meta();
  const tableNameById = {};
  const fieldById = {};
  for (const t of tables) {
    tableNameById[t.id] = t.name;
    for (const f of t.fields) fieldById[f.id] = f;
  }

  const targetOf = (field) => {
    if (field.type === 'multipleRecordLinks') {
      return tableNameById[field.options?.linkedTableId] || null;
    }
    if (field.type === 'multipleLookupValues') {
      const inner = fieldById[field.options?.fieldIdInLinkedTable];
      // רק אם השדה הנשלף הוא בעצמו קישור — אחרת זהו ערך רגיל
      if (inner?.type === 'multipleRecordLinks') {
        return tableNameById[inner.options?.linkedTableId] || null;
      }
    }
    return null;
  };

  const map = {};
  for (const t of tables) {
    map[t.name] = t.fields
      .map((f) => ({ name: f.name, targetTable: targetOf(f) }))
      .filter((f) => f.targetTable);
  }
  linkMapCache = map;
  return map;
}

// ============================================================
// אינדקס טבלה: id -> שם תצוגה. נטען פעם אחת לכל טבלה ונשמר במטמון.
// ============================================================
const indexCache = new Map(); // tableName -> { at, byId: Map }
const inFlight = new Map(); // מונע טעינה כפולה במקביל של אותה טבלה

async function loadIndex(tableName) {
  const nameOf = await displayNamerFor(tableName);
  const byId = new Map();
  const base = getBase();
  await base(tableName)
    .select({ pageSize: 100 })
    .eachPage((page, fetchNextPage) => {
      for (const rec of page) byId.set(rec.id, nameOf(rec.fields));
      fetchNextPage();
    });
  indexCache.set(tableName, { at: Date.now(), byId });
  return byId;
}

async function tableIndex(tableName) {
  const cached = indexCache.get(tableName);
  if (cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.byId;
  if (inFlight.has(tableName)) return inFlight.get(tableName);

  const promise = loadIndex(tableName)
    .catch(() => new Map()) // טבלה שאי אפשר לקרוא — נחזיר מזהים כמו שהם
    .finally(() => inFlight.delete(tableName));
  inFlight.set(tableName, promise);
  return promise;
}

/** מנקה את המטמון אחרי כתיבה, כדי שרשומה חדשה תיפתר לשם ולא למזהה. */
export function invalidateIndex(tableName) {
  if (tableName) indexCache.delete(tableName);
  else indexCache.clear();
}

function isRecordIdArray(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((v) => typeof v === 'string' && /^rec[A-Za-z0-9]{14}$/.test(v));
}

// ============================================================
// פונקציית ההעשרה הראשית
// ============================================================
export async function attachLinkedNames(tableName, records) {
  if (!records || !records.length) return records;
  try {
    const linkMap = await buildLinkMap();
    const linkFields = linkMap[tableName] || [];
    if (!linkFields.length) return records;

    // אילו שדות באמת מכילים מזהים ברשומות שהתקבלו
    const activeFields = linkFields.filter((lf) =>
      records.some((rec) => isRecordIdArray(rec[lf.name]))
    );
    if (!activeFields.length) return records;

    // טוענים במקביל אינדקס אחד לכל טבלת יעד נדרשת
    const targets = [...new Set(activeFields.map((lf) => lf.targetTable))];
    const indexes = new Map(
      await Promise.all(targets.map(async (t) => [t, await tableIndex(t)]))
    );

    return records.map((rec) => {
      const out = { ...rec };
      for (const lf of activeFields) {
        const ids = rec[lf.name];
        if (!isRecordIdArray(ids)) continue;
        const byId = indexes.get(lf.targetTable);
        const resolved = ids.map((id) => ({
          id,
          name: byId.get(id) || 'לא זמין',
          table: lf.targetTable,
        }));
        out[lf.name] = resolved;
        out['_display_' + lf.name] = resolved.map((r) => r.name).join(', ');
      }
      return out;
    });
  } catch {
    return records; // כשל בהעשרה לא יפיל את הבקשה
  }
}
