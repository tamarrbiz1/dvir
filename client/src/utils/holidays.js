// ============================================================
// חגים וימי אי-עבודה — עזר משותף ללוחות השנה
//
// הטבלה "ימי אי עבודה" ב-Airtable מחזיקה רק תאריך + סוג החג
// (יהודי / תילאנדי). שם החג מחושב כאן מהתאריך:
//   - חג יהודי: לפי הלוח העברי (Intl, ללא ספרייה חיצונית).
//   - חג תאילנדי: לפי תאריכים קבועים בלוח הגרגוריאני.
//   - אין ימי אי-עבודה אוטומטיים (גם לא שבת): מודגש רק מה שיובא/נוסף
//     לטבלה — במשק עובדים לעיתים במוצאי שבת וההחלטה בידי הלקוח (5.10.2026).
// ============================================================

export const KIND_STYLE = {
  jewish: { bg: '#DCEEFF', border: '#3578E5', label: 'חג יהודי', th: 'วันหยุดยิว' },
  thai: { bg: '#FFE7CC', border: '#F79009', label: 'חג תאילנדי', th: 'วันหยุดไทย' },
  shabbat: { bg: '#EDE9FE', border: '#8B5CF6', label: 'יום מנוחה', th: 'วันพักผ่อน' },
  other: { bg: '#F1F5F9', border: '#98A2B3', label: 'יום אי עבודה', th: 'วันหยุด' },
};

/** ממפה את ערך "סוג החג" מ-Airtable לסוג פנימי */
export function kindOf(type) {
  const s = String(type || '');
  if (s.includes('יהוד')) return 'jewish';
  if (s.includes('תיל') || s.includes('תאיל')) return 'thai';
  if (s.includes('שבת')) return 'shabbat';
  return 'other';
}

// ---------- לוח עברי ----------
const HEB_FMT = new Intl.DateTimeFormat('en-u-ca-hebrew', { month: 'long', day: 'numeric' });

/** {month:'Tishri', day:15} עבור תאריך גרגוריאני */
export function hebrewDate(date) {
  const parts = HEB_FMT.formatToParts(date);
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = Number(parts.find((p) => p.type === 'day')?.value || 0);
  return { month, day };
}

// שמות החגים לפי חודש עברי ויום (he/th)
const JEWISH = {
  Tishri: {
    1: ['ראש השנה', 'โรช ฮาชานา'], 2: ['ראש השנה', 'โรช ฮาชานา'],
    9: ['ערב יום כיפור', 'วันก่อนโยม คิปปูร์'], 10: ['יום כיפור', 'โยม คิปปูร์'],
    14: ['ערב סוכות', 'วันก่อนซุกโคท'], 15: ['סוכות', 'ซุกโคท'],
    16: ['חול המועד סוכות', 'ชอล ฮาโมเอด ซุกโคท'], 17: ['חול המועד סוכות', 'ชอล ฮาโมเอด ซุกโคท'],
    18: ['חול המועד סוכות', 'ชอล ฮาโมเอด ซุกโคท'], 19: ['חול המועד סוכות', 'ชอล ฮาโมเอด ซุกโคท'],
    20: ['חול המועד סוכות', 'ชอล ฮาโมเอด ซุกโคท'], 21: ['הושענא רבה', 'โฮชานา รับบา'],
    22: ['שמחת תורה', 'ซิมชัท โทราห์'],
  },
  Nisan: {
    14: ['ערב פסח', 'วันก่อนเปสัค'], 15: ['פסח', 'เปสัค'],
    16: ['חול המועד פסח', 'ชอล ฮาโมเอด เปสัค'], 17: ['חול המועד פסח', 'ชอล ฮาโมเอด เปสัค'],
    18: ['חול המועד פסח', 'ชอล ฮาโมเอด เปสัค'], 19: ['חול המועד פסח', 'ชอล ฮาโมเอด เปสัค'],
    20: ['חול המועד פסח', 'ชอล ฮาโมเอด เปสัค'], 21: ['שביעי של פסח', 'วันที่เจ็ดของเปสัค'],
  },
  Sivan: { 5: ['ערב שבועות', 'วันก่อนชาวูโอท'], 6: ['שבועות', 'ชาวูโอท'] },
  Adar: { 14: ['פורים', 'ปูริม'] },
  'Adar II': { 14: ['פורים', 'ปูริม'] },
  Av: { 9: ['תשעה באב', 'ทิชา เบอัฟ'] },
};

/** שם חג יהודי לתאריך (או null) */
export function jewishHoliday(date) {
  const { month, day } = hebrewDate(date);
  const entry = JEWISH[month]?.[day];
  return entry ? { he: entry[0], th: entry[1] } : null;
}

// ---------- חגי תאילנד (תאריכים קבועים) ----------
const THAI = {
  '01-01': ['ראש השנה האזרחי', 'วันขึ้นปีใหม่'],
  '04-06': ['יום צ׳אקרי', 'วันจักรี'],
  '04-13': ['סונגקראן', 'วันสงกรานต์'], '04-14': ['סונגקראן', 'วันสงกรานต์'], '04-15': ['סונגקראן', 'วันสงกรานต์'],
  '05-01': ['יום העבודה', 'วันแรงงาน'],
  '05-04': ['יום ההכתרה', 'วันฉัตรมงคล'],
  '06-03': ['יום הולדת המלכה', 'วันเฉลิมพระชนมพรรษาพระราชินี'],
  '07-28': ['יום הולדת המלך', 'วันเฉลิมพระชนมพรรษาพระเจ้าอยู่หัว'],
  '08-12': ['יום האם', 'วันแม่แห่งชาติ'],
  '10-13': ['יום זיכרון למלך ראמה ט׳', 'วันคล้ายวันสวรรคต ร.9'],
  '10-23': ['יום צ׳ולאלונגקורן', 'วันปิยมหาราช'],
  '12-05': ['יום האב', 'วันพ่อแห่งชาติ'],
  '12-10': ['יום החוקה', 'วันรัฐธรรมนูญ'],
  '12-31': ['ערב השנה החדשה', 'วันสิ้นปี'],
};

export function thaiHoliday(date) {
  const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const entry = THAI[key];
  return entry ? { he: entry[0], th: entry[1] } : null;
}

/** כל חגי ישראל של שנה גרגוריאנית — [{iso, he, th}] */
export function jewishHolidaysOfYear(year) {
  const out = [];
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    const h = jewishHoliday(d);
    if (h) out.push({ iso: toISO(d), ...h });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function thaiHolidaysOfYear(year) {
  return Object.entries(THAI).map(([md, [he, th]]) => ({ iso: `${year}-${md}`, he, th }));
}

export const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * מידע להצגת תא בלוח: {kind, name:{he,th}, style} או null.
 * @param date   התאריך
 * @param record רשומת "ימי אי עבודה" לתאריך (אם קיימת)
 */
export function holidayInfo(date, record) {
  if (!record) return null;
  const rawKind = kindOf(record['סוג החג']);
  const holiday = rawKind === 'jewish' ? jewishHoliday(date) : rawKind === 'thai' ? thaiHoliday(date) : null;
  if (holiday) return { kind: rawKind, name: holiday, style: KIND_STYLE[rawKind] };
  // שישי/שבת שיובאו לרשימה (השדה ב-Airtable מכיל רק "יהודי"/"תילאנדי", לכן
  // מזהים לפי היום בשבוע) — "יום מנוחה", לא "חג יהודי". שם היום לצד התווית.
  const wd = date.getDay();
  if (rawKind === 'jewish' && (wd === 5 || wd === 6)) {
    const dayName = wd === 6 ? { he: 'שבת', th: 'วันเสาร์' } : { he: 'יום שישי', th: 'วันศุกร์' };
    return { kind: 'shabbat', name: { he: `יום מנוחה · ${dayName.he}`, th: `${KIND_STYLE.shabbat.th} · ${dayName.th}` }, style: KIND_STYLE.shabbat };
  }
  return { kind: rawKind, name: { he: KIND_STYLE[rawKind].label, th: KIND_STYLE[rawKind].th }, style: KIND_STYLE[rawKind] };
}
