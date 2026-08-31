// ============================================================
// כותרת עמוד אחידה — כפתורי חזרה ובית + כותרת + פעולות
// ------------------------------------------------------------
// רכיב יחיד לכל מסכי המערכת, כדי שהניווט ייראה ויתנהג אותו דבר
// בכל עמוד. הוא אינו מסתמך על כפתור ה-Back של הדפדפן: החזרה
// מחושבת מהיסטוריית הניווט הפנימית, ובכניסה ישירה ל-URL היא
// נופלת לעמוד בסיס הגיוני (ראו utils/navigation.jsx).
// ============================================================
import { t } from '../i18n.js';
import { routeTitle, useOptionalNav } from '../utils/navigation.jsx';

// ============================================================
// שורת הניווט (חזרה + בית)
// ============================================================
export function PageNav() {
  const nav = useOptionalNav();

  // מחוץ ל-Router shell (אפליקציית העובד) אין ניווט בין מסלולים
  if (!nav) return null;

  const { back, goHome, backPath, isHome, home, currentPath } = nav;

  // בעמוד הבית אין לאן לחזור ואין לאן "לעלות"
  if (isHome) return null;

  const targetTitle = routeTitle(backPath);
  const backLabel = t('nav_backTo') + targetTitle;
  const showHome = backPath !== home;

  return (
    <nav className="page-nav" aria-label={t('nav_pageNav')}>
      <button
        type="button"
        className="btn btn-ghost btn-nav"
        onClick={back}
        aria-label={backLabel}
        title={backLabel}
      >
        <span className="nav-arrow" aria-hidden="true">→</span>
        <span>{t('nav_back')}</span>
        <span className="nav-target">{t('nav_toPrefix')}{targetTitle}</span>
      </button>

      {showHome && (
        <button
          type="button"
          className="btn btn-ghost btn-nav"
          onClick={goHome}
          aria-label={t('nav_goHome')}
          title={t('nav_goHome')}
        >
          <span aria-hidden="true">🏠</span>
          <span>{t('nav_home')}</span>
        </button>
      )}

      {/* מציין למשתמש היכן הוא נמצא — נקרא על ידי קורא מסך בלבד */}
      <span className="sr-only">{t('nav_youAreOn')} {routeTitle(currentPath)}</span>
    </nav>
  );
}

// ============================================================
// כותרת העמוד המלאה
// ============================================================
export default function PageHeader({ title, icon, actions, children }) {
  const extras = actions ?? children;
  return (
    <div className="page-head">
      <PageNav />
      <div className="page-header">
        <h2>
          {icon && <span aria-hidden="true">{icon} </span>}
          {title}
        </h2>
        {extras ? <div className="page-header-actions">{extras}</div> : null}
      </div>
    </div>
  );
}
