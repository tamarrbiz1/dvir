// ============================================================
// המרסס של הטיפול — תצוגה (משימה AS-1, 14.10.2026)
// ------------------------------------------------------------
// תמר: "בטיפולים — שהמרסס המשויך יוכלו לראות אותו בלחיצה."
//
// ⚠️ **אין טבלת מרססים/כלים ב-Airtable** — ר' ההסבר המלא ועל אילו שדות
// הנתונים יושבים ב-`utils/sprayer.js`, שבו גם החישוב (JS טהור, נבדק
// בסוויטה). כאן התצוגה בלבד.
//
// הרכיבים כאן משותפים למסך הטיפולים (כרטיס/לוח/רשימה) ולהיסטוריית
// הריסוסים של המבנה, כדי שהתצוגה תהיה זהה בשלושת המקומות.
// ============================================================
import { formatNumber } from '../utils/format.js';
import { sprayerInfo } from '../utils/sprayer.js';

const NOT_SET = 'לא צוין';

export { sprayerInfo };

/** תג קטן ליד שם החומר בלוח/ברשימה — רואים את המרסס בלי לפתוח את הכרטיס */
export function SprayerTag({ raw, info, small }) {
  const s = info || sprayerInfo(raw);
  if (!s.name && !s.size) return null;
  const label = s.name || `${formatNumber(s.size, 0)} ליטר`;
  const title = `מרסס: ${s.name || NOT_SET}${s.size ? ` · מיכל ${formatNumber(s.size, 0)} ליטר` : ''}${s.count ? ` · ${formatNumber(s.count, 0)} מרססים` : ''}`;
  return (
    <span className="badge" title={title}
      style={{ background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: small ? 10 : 11, padding: small ? '0 5px' : '1px 7px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      🛢️ {label}
    </span>
  );
}

/**
 * בלוק "מרסס" בכרטיס הטיפול. `row` מוזרקת מהכרטיס כדי שהשורות ייראו
 * בדיוק כמו שאר שורות הכרטיס (אותו מפריד, אותו גודל גופן); בלי הזרקה
 * יש ברירת-מחדל זהה, לשימוש מחוץ למסך הטיפולים.
 *
 * `omit` — שורות שהמסך הקורא כבר מציג בעצמו, כדי שלא תהיה כפילות.
 * במסך הטיפולים `count` ו-`water` מושמטים: `TreatmentAmounts` של סעיף AR
 * מציג אותם עם לוגיקת ה"לדונם" שלו, והוא ה**מקור היחיד** שם.
 */
export function SprayerBlock({ raw, row, omit = [] }) {
  const s = sprayerInfo(raw);
  const show = (key) => !omit.includes(key);
  const line = row || ((l, v) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{l}</span><b>{v}</b>
    </div>
  ));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        🛢️ מרסס
        {!s.any && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>— לא הוזנו נתוני מרסס לטיפול הזה</span>}
      </div>
      {show('name') && line('שם המכשיר', s.name || NOT_SET)}
      {show('size') && line('גודל מיכל', s.size ? `${formatNumber(s.size, 0)} ליטר` : NOT_SET)}
      {show('count') && line('מספר מרססים', s.count ? formatNumber(s.count, 0) : NOT_SET)}
      {show('water') && line('סה"כ ליטר מים', s.water ? `${formatNumber(s.water, 0)} ליטר` : NOT_SET)}
    </div>
  );
}
