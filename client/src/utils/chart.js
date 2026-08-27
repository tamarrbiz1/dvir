// ============================================================
// הגדרות צירים משותפות לכל הגרפים במערכת
//
// הבעיה שזה פותר: ב-Recharts ציר ה-Y מקבל רוחב ברירת מחדל צר (60px)
// בלי מרווח בין הכיתוב לקו הציר, ולציר ה-X אין דילול תוויות. התוצאה
// היא מספרים שיושבים על קו הציר ותוויות שנדרסות זו על ידי זו.
//
// כל המסכים משתמשים בקובץ הזה, כדי שהתיקון יישאר אחיד ולא יתפורר.
// ============================================================

export const AXIS_TICK = { fontSize: 11, fill: '#667085' };
export const AXIS_LINE = { stroke: '#E5E9EF' };

/** מרווח פנימי לגרף — מונע חיתוך של התווית הראשונה והאחרונה */
export const CHART_MARGIN = { top: 10, right: 16, left: 8, bottom: 8 };
/** מרווח מורחב לגרף עם תוויות מסובבות בציר ה-X */
export const CHART_MARGIN_ROTATED = { top: 10, right: 16, left: 8, bottom: 28 };

/** קווי רשת עדינים, אופקיים בלבד (סעיף 41 באפיון) */
export const GRID_PROPS = {
  strokeDasharray: '3 3',
  stroke: '#EEF1F5',
  vertical: false,
};

/**
 * קיצור מספרים ארוכים כדי שכיתוב ציר ה-Y לא יגלוש:
 * 2400 → "2,400" · 24000 → "24K" · 1200000 → "1.2M"
 */
export function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString('he-IL', { maximumFractionDigits: 1 });
}

/**
 * מאפייני ציר X.
 * @param {number} count  מספר נקודות הנתונים — לפיו מדללים תוויות
 * @param {object} opts   rotate: לסובב את התוויות · maxLabels: תקרת תוויות
 */
export function xAxisProps(count = 0, opts = {}) {
  const { rotate = false, maxLabels = 12, ...rest } = opts;
  // interval=0 מציג הכל; ערך n מדלג על n תוויות בין אחת לשנייה
  const interval = count > maxLabels ? Math.ceil(count / maxLabels) - 1 : 0;

  return {
    tick: AXIS_TICK,
    tickMargin: 8,
    interval,
    minTickGap: 6,
    axisLine: AXIS_LINE,
    tickLine: false,
    ...(rotate
      ? { angle: -30, textAnchor: 'end', height: 62 }
      : { height: 32 }),
    ...rest,
  };
}

/**
 * מאפייני ציר Y מספרי.
 * הרוחב המפורש הוא העיקר — בלעדיו הכיתוב נדחק אל קו הציר.
 */
export function yAxisProps(opts = {}) {
  const { money = false, width, formatter, ...rest } = opts;
  return {
    tick: AXIS_TICK,
    tickMargin: 8,
    width: width ?? (money ? 72 : 60),
    tickFormatter: formatter ?? compactNumber,
    axisLine: AXIS_LINE,
    tickLine: false,
    ...rest,
  };
}

/**
 * מאפייני ציר Y מסוג קטגוריה (גרף עמודות אופקי).
 * שמות בעברית זקוקים לרוחב נדיב יותר.
 */
export function yCategoryProps(opts = {}) {
  const { width = 110, ...rest } = opts;
  return {
    type: 'category',
    tick: AXIS_TICK,
    tickMargin: 8,
    width,
    axisLine: AXIS_LINE,
    tickLine: false,
    ...rest,
  };
}

/** עיצוב אחיד ל-Tooltip */
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#fff',
    border: '1px solid #E5E9EF',
    borderRadius: 10,
    fontSize: 12,
    boxShadow: '0 4px 14px rgba(20,35,50,0.10)',
  },
  labelStyle: { fontWeight: 700, marginBottom: 4 },
};

/** מרווח אחיד מעל המקרא, כדי שלא יידבק לגרף */
export const LEGEND_STYLE = { fontSize: 12, paddingTop: 8 };
