// ============================================================
// בחירת תקופה אחידה — היום / השבוע / החודש / חודש קודם / השנה / הכל / טווח מותאם.
// משותף ללוח הבקרה ולטאב "עבודות" (עובדים ועבודות), כדי שכל סכום תלוי-זמן
// יציין את התקופה באותה לשון בדיוק.
// ============================================================
import { yearProgressLabel } from './format.js';

export const PERIOD_PRESETS = [
  { key: 'today', label: 'היום' },
  { key: 'week', label: 'השבוע' },
  { key: 'month', label: 'החודש' },
  { key: 'prevMonth', label: 'חודש קודם' },
  { key: 'year', label: 'השנה' },
  { key: 'all', label: 'הכל' },
  { key: 'custom', label: 'טווח מותאם' },
];

// תחום תאריכים [start, end] לפי הבחירה; null = ללא סינון
export function periodRange(preset, from, to) {
  const now = new Date();
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  if (preset === 'today') return [day0(now), end0(now)];
  if (preset === 'week') {
    // שבוע עסקי: שבת עד חמישי (לפי האיפיון)
    const s = day0(now);
    const back = (s.getDay() + 1) % 7; // שבת=6 → 0 ימים אחורה
    s.setDate(s.getDate() - back);
    const e = new Date(s); e.setDate(s.getDate() + 5); e.setHours(23, 59, 59);
    return [s, e];
  }
  if (preset === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), end0(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (preset === 'prevMonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), end0(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (preset === 'year') return [new Date(now.getFullYear(), 0, 1), end0(new Date(now.getFullYear(), 11, 31))];
  if (preset === 'custom') {
    const s = from ? new Date(`${from}T00:00:00`) : null;
    const e = to ? new Date(`${to}T23:59:59`) : null;
    return (s || e) ? [s || new Date(2000, 0, 1), e || new Date(2100, 0, 1)] : null;
  }
  return null;
}

// האם ערך תאריך נופל בתחום שנבחר (null = הכל)
export function inPeriod(dateValue, range) {
  if (!range) return true;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  return d >= range[0] && d <= range[1];
}

// תווית קצרה לתקופה — "היום" / "החודש" / ... ; ב"השנה" מציינים כמה מהשנה נאסף בפועל
export function periodLabel(preset) {
  return PERIOD_PRESETS.find((p) => p.key === preset)?.label || '';
}
export function periodDisclosure(preset) {
  return preset === 'year' ? yearProgressLabel() : periodLabel(preset);
}
