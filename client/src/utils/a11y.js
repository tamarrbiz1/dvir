// ============================================================
// עזרי נגישות משותפים
// ============================================================

/**
 * הופך אלמנט שאינו אינטראקטיבי מטבעו (div / span / tr) לכפתור נגיש:
 * מקבל פוקוס מהמקלדת, מופעל ב-Enter וב-Space, ובעל שם נגיש.
 *
 * שימוש:  <div className="card clickable" {...activatable(() => open(x), 'פתיחת כרטיס')}>
 */
export function activatable(onActivate, label) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate(e);
      }
    },
  };
}
