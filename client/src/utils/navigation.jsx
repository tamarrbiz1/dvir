// ============================================================
// ניווט מרכזי — מקור אמת יחיד למסלולים, הרשאות והיסטוריית ניווט
// ------------------------------------------------------------
// כאן מרוכזים: קבוצות הניווט של סרגל הצד, ההרשאות לפי תפקיד,
// שרשרת עמודי־האב (לאן חוזרים כשאין היסטוריה) ומעקב אחר
// היסטוריית הניווט הפנימית של האפליקציה.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { t } from '../i18n.js';

// ============================================================
// קבוצות הניווט (סרגל הצד) — משמשות גם לבניית מפת המסלולים
// ============================================================
export const NAV_GROUPS = [
  { group: 'main', items: [{ to: '/', icon: '📊', labelKey: 'dashboard' }] },
  {
    group: 'operations',
    items: [
      { to: '/structures', icon: '🏗️', labelKey: 'structures' },
      { to: '/planting', icon: '🌱', labelKey: 'planting' },
      { to: '/crops', icon: '🌾', labelKey: 'crops' },
      { to: '/harvests', icon: '🧺', labelKey: 'harvests' },
      { to: '/spraying', icon: '🧴', labelKey: 'spraying' },
      { to: '/materials', icon: '🧪', labelKey: 'sprayMaterials' },
      { to: '/spray-reports', icon: '📋', labelKey: 'sprayReports' },
      { to: '/treatments', icon: '📅', labelKey: 'treatments' },
    ],
  },
  {
    group: 'human',
    items: [
      { to: '/crew', icon: '👷', labelKey: 'crew' },
      { to: '/workers', icon: '👥', labelKey: 'workers' },
      { to: '/requests', icon: '🗣️', labelKey: 'requests' },
    ],
  },
  {
    group: 'inventory',
    items: [
      { to: '/inventory', icon: '📦', labelKey: 'inventory' },
      { to: '/suppliers', icon: '🚚', labelKey: 'suppliers' },
    ],
  },
  {
    group: 'finance',
    items: [
      { to: '/finance', icon: '💰', labelKey: 'finance' },
      { to: '/finance-forecast', icon: '📈', labelKey: 'financeForecast' },
      { to: '/pricing', icon: '🏷️', labelKey: 'pricing' },
      { to: '/invoices', icon: '🧾', labelKey: 'invoices' },
      { to: '/delivery-notes', icon: '📄', labelKey: 'deliveryNotes' },
    ],
  },
  {
    group: 'docs',
    items: [
      { to: '/weekly', icon: '📆', labelKey: 'weekly' },
      { to: '/alerts', icon: '🔔', labelKey: 'alerts' },
      { to: '/nonworkdays', icon: '🗓️', labelKey: 'nonworkdays' },
      { to: '/upload', icon: '⬆️', labelKey: 'upload' },
    ],
  },
];

// ============================================================
// הרשאות לפי תפקיד (סעיף 7 באיפיון)
// ============================================================

// כתובות שמותרות למנהל עבודה (owner רואה הכל)
export const OPERATIONS = [
  '/structures', '/planting', '/harvests', '/spraying', '/materials', '/treatments',
  '/workers', '/crew', '/requests', '/spray-reports',
];

export const INITIAL_ROUTE = (role) => {
  if (role === 'worker') return '/worker';
  if (role === 'manager') return '/workers'; // דף צוות עובדים (מנהל עבודה)
  return '/';
};

export function canSee(role, to) {
  if (role === 'owner') return true;
  if (role === 'manager') return OPERATIONS.includes(to);
  return false; // worker לא מגיע כאן
}

// ============================================================
// מפת מסלולים — כותרת ואייקון לכל עמוד
// ============================================================
export const ROUTE_META = {};
NAV_GROUPS.forEach((group) => {
  group.items.forEach((item) => {
    ROUTE_META[item.to] = { labelKey: item.labelKey, icon: item.icon, group: group.group };
  });
});
// מסלול שאינו בסרגל הצד (תצוגת אפליקציית העובד לבעל העסק)
ROUTE_META['/worker'] = { labelKey: 'nav_workerApp', icon: '📱', group: 'main' };

// כותרת קריאה של מסלול, לפי השפה הפעילה
export function routeTitle(path) {
  const meta = ROUTE_META[path];
  return meta ? t(meta.labelKey) : t('dashboard');
}

export function routeIcon(path) {
  return ROUTE_META[path]?.icon || '';
}

// ============================================================
// שרשרת עמודי־אב — לאן חוזרים כשאין היסטוריית ניווט
// (למשל כשמשתמש הדביק URL של עמוד פנימי ישירות בדפדפן)
// ============================================================
const PARENT_ROUTE = {
  '/materials': '/spraying',
  '/planting': '/structures',
  '/nonworkdays': '/planting',
  '/treatments': '/planting',
  '/harvests': '/crops',
  '/spray-reports': '/spraying',
  '/crew': '/workers',
  '/requests': '/workers',
  '/suppliers': '/inventory',
  '/finance-forecast': '/finance',
  '/pricing': '/finance',
  '/invoices': '/finance',
  '/delivery-notes': '/finance',
};

// מחזיר את עמוד הבסיס שאליו נחזור כשאין היסטוריה.
// עולה בשרשרת עמודי־האב עד לעמוד שהתפקיד רשאי לראות,
// ואם אין כזה — נופל לעמוד הבית של התפקיד.
export function fallbackPath(path, role) {
  const home = INITIAL_ROUTE(role);
  const seen = new Set([path]);
  let parent = PARENT_ROUTE[path];
  while (parent && !seen.has(parent)) {
    if (canSee(role, parent)) return parent;
    seen.add(parent);
    parent = PARENT_ROUTE[parent];
  }
  return home;
}

// ============================================================
// ספק ההקשר — עוקב אחרי היסטוריית הניווט הפנימית
// ============================================================
const NavContext = createContext(null);

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavigationProvider');
  return ctx;
}

// גרסה סלחנית — מחזירה null מחוץ לספק (למשל באפליקציית העובד,
// שמוצגת גם ללא ה-Router shell של המנהל)
export function useOptionalNav() {
  return useContext(NavContext);
}

export function NavigationProvider({ role = 'owner', children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();

  // מחסנית שמשקפת את היסטוריית הדפדפן בתוך האפליקציה
  const stackRef = useRef([]);
  const [prevPath, setPrevPath] = useState(null);

  useEffect(() => {
    const entry = { path: location.pathname, key: location.key };
    const stack = stackRef.current;
    const top = stack[stack.length - 1];

    if (top && top.key === entry.key) {
      // אותה רשומת היסטוריה (רינדור חוזר) — אין מה לעדכן
    } else if (navType === 'REPLACE' && stack.length) {
      stack[stack.length - 1] = entry;
    } else if (navType === 'POP') {
      // חזרה אחורה: אם זו אכן הרשומה הקודמת — מסירים את העליונה.
      // אחרת (למשל "קדימה" בדפדפן, או טעינה ראשונה) מאתחלים,
      // כדי לא להציג יעד חזרה שגוי.
      if (stack.length > 1 && stack[stack.length - 2].key === entry.key) stack.pop();
      else stackRef.current = [entry];
    } else {
      stack.push(entry);
    }

    const current = stackRef.current;
    setPrevPath(current.length > 1 ? current[current.length - 2].path : null);
  }, [location.key, location.pathname, navType]);

  const home = INITIAL_ROUTE(role);
  const isHome = location.pathname === home;
  const canGoBack = Boolean(prevPath);
  const backPath = prevPath || fallbackPath(location.pathname, role);

  const back = useCallback(() => {
    // יש היסטוריה פנימית — חוזרים בה ומשמרים את מצב המסך הקודם
    if (prevPath) navigate(-1);
    // אין היסטוריה (כניסה ישירה ל-URL) — עוברים לעמוד הבסיס
    else navigate(fallbackPath(location.pathname, role), { replace: true });
  }, [prevPath, navigate, location.pathname, role]);

  const goHome = useCallback(() => navigate(home), [navigate, home]);

  const value = useMemo(() => ({
    role,
    home,
    isHome,
    canGoBack,
    backPath,
    back,
    goHome,
    currentPath: location.pathname,
  }), [role, home, isHome, canGoBack, backPath, back, goHome, location.pathname]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// ============================================================
// סגירת שכבות־על (מגירה/מודאל) במקש Escape
// ============================================================
export function useEscapeClose(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== 'function') return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, active]);
}
