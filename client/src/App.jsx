import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react';
import { t, setLang } from './i18n.js';
import LanguageSwitcher from './components/LanguageSwitcher.jsx';
import { NAV_GROUPS, INITIAL_ROUTE, canSee, NavigationProvider } from './utils/navigation.jsx';
import { authFetch } from './utils/authFetch.js';

// ============================================================
// אפליקציית עובד (Mobile-first)
// ============================================================
import WorkerApp from './worker/WorkerApp.jsx';

// ============================================================
// מסכים
// ============================================================
import DashboardPage from './pages/DashboardPage.jsx';
import StructuresPage from './pages/StructuresPage.jsx';
import PlantingPlanPage from './pages/PlantingPlanPage.jsx';
import WorkersPage from './pages/WorkersPage.jsx';
import TeamCrewPage from './pages/TeamCrewPage.jsx';
import WorkerRequestsPage from './pages/WorkerRequestsPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import CropsPage from './pages/CropsPage.jsx';
import NonWorkDaysPage from './pages/NonWorkDaysPage.jsx';
import HarvestsPage from './pages/HarvestsPage.jsx';
import TreatmentsPage from './pages/TreatmentsPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import SuppliersPage from './pages/SuppliersPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import DeliveryNotesPage from './pages/DeliveryNotesPage.jsx';
import InvoicesPage from './pages/InvoicesPage.jsx';
import WeeklySummaryPage from './pages/WeeklySummaryPage.jsx';
import AlertsPage from './pages/AlertsPage.jsx';
import UploadDocumentPage from './pages/UploadDocumentPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import FinancialForecastPage from './pages/FinancialForecastPage.jsx';

// שער הרשאות: כתובת שאינה מותרת לתפקיד מנותבת לעמוד הבית שלו
function RoleGate({ role, children }) {
  const location = useLocation();
  const path = location.pathname;
  if (role !== 'owner' && path !== '/worker' && !canSee(role, path)) {
    return <Navigate to={INITIAL_ROUTE(role)} replace />;
  }
  return children;
}

// ============================================================
// הקשר גלובלי: שפה, משתמש, נתוני מטה
// ============================================================
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

function Sidebar({ mobileOpen, onClose }) {
  const { user, lang, setAppLang, logout, badges, api, realRole, viewAsManager, toggleViewAsManager, tables } = useApp();
  const role = user?.role || 'owner';
  const [devicesOpen, setDevicesOpen] = useState(false);
  // 2026-09-08: הטבלה "מכשירי כניסה" עדיין לא נוצרה ב-Airtable (חסם
  // הרשאת סכמה, ר' checkDeviceBinding בשרת) — עד שהיא תיווצר, האייקון
  // לא מוצג בכלל (במקום להראות מגירה ריקה עם הודעת "הטבלה לא קיימת").
  // ברגע שהטבלה תיווצר היא תופיע ב-tables אוטומטית וזה יחזור לבד,
  // בלי צורך בשינוי קוד נוסף.
  const devicesTableExists = Array.isArray(tables) && tables.some((t) => t.name === DEVICES_TABLE);
  return (
    <>
      {mobileOpen && <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />}
      <aside
        className={'sidebar' + (mobileOpen ? ' mobile-open' : '')}
        role="navigation"
        aria-label={t('nav_mainNav')}
      >
        <div className="brand">
          <img src="/assets/logo.png" alt="לוגו" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          <span className="brand-text">
            <span className="brand-title">משק ספאיה</span>
            <span className="brand-subtitle">מערכת גידול</span>
          </span>
          <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {role === 'owner' && devicesTableExists && (
              <button
                type="button"
                onClick={() => setDevicesOpen(true)}
                aria-label={badges.devices ? `מכשירים ממתינים לאישור — ${badges.devices}` : 'מכשירים מאושרים'}
                title="מכשירי כניסה"
                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 18, padding: 0 }}
              >
                📱{badges.devices > 0 && <span className="nav-badge glow">{badges.devices}</span>}
              </button>
            )}
            {canSee(role, '/alerts') && (
              <NavLink
                to="/alerts"
                onClick={onClose}
                aria-label={badges.alerts ? `התראות — ${badges.alerts} פעילות` : 'התראות'}
                title="התראות"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 18 }}
              >
                🔔{badges.alerts > 0 && <span className="nav-badge">{badges.alerts}</span>}
              </NavLink>
            )}
            <button
              type="button"
              className="sidebar-close no-print"
              onClick={onClose}
              aria-label={t('nav_closeMenu')}
            >
              ✕
            </button>
          </span>
        </div>
        {role !== 'owner' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <LanguageSwitcher lang={lang} onLang={setAppLang} />
          </div>
        )}
        {role === 'manager' && (
          <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: '#fff', position: 'relative', zIndex: 1 }}>
            <span>👷</span><span>מנהל עבודה</span>
          </div>
        )}
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => canSee(role, item.to));
          if (!items.length) return null;
          return (
            <div key={group.group}>
              <div className="group-title">{t('group_' + group.group)}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                  end={item.to === '/'}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{t(item.labelKey)}</span>
                  {item.to === '/requests' && badges.requests > 0 && (
                    <span className="nav-badge glow" title={`${badges.requests} בקשות ממתינות לאישור`}>{badges.requests}</span>
                  )}
                  {item.to === '/alerts' && badges.alerts > 0 && (
                    <span className="nav-badge" title={`${badges.alerts} התראות פעילות`}>{badges.alerts}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.16)', paddingTop: 16, position: 'relative', zIndex: 1 }}>
          <div style={{ padding: '0 12px 8px', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
            מחובר: <b style={{ color: '#fff' }}>{user?.name || 'משתמש'}</b> · {role === 'owner' ? 'מנהל ראשי' : 'מנהל עבודה'}
            {viewAsManager && <span style={{ color: '#FCD34D' }}> (תצוגת מנהל עבודה)</span>}
          </div>
          {realRole === 'owner' && (
            <button
              type="button"
              className="nav-item"
              onClick={toggleViewAsManager}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'inherit', font: 'inherit' }}
            >
              <span className="nav-icon" aria-hidden="true">👁️</span>
              <span>{viewAsManager ? 'חזרה לתצוגת מנהל ראשי' : 'צפה כמנהל עבודה'}</span>
            </button>
          )}
          <button type="button" className="nav-item" onClick={logout}>
            <span className="nav-icon" aria-hidden="true">🚪</span>
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>
      {devicesOpen && <DevicesDrawer api={api} onClose={() => setDevicesOpen(false)} />}
    </>
  );
}

const DEVICES_TABLE = 'מכשירי כניסה';

// ============================================================
// אישור מכשירי כניסה — רק למנהל הראשי. אם הטבלה עדיין לא קיימת
// ב-Airtable (טרם נוצרה שם) — מוצגת הודעה מסבירה במקום שגיאה סתומה.
// ============================================================
function DevicesDrawer({ api, onClose }) {
  const [devices, setDevices] = useState(null); // null = טוען, [] = נטען וריק
  const [missing, setMissing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = () => api.get(DEVICES_TABLE, '?maxRecords=200')
    .then((d) => { setDevices(Array.isArray(d) ? d : []); setMissing(false); })
    .catch((e) => {
      if (String(e.message || '').includes('אינה קיימת')) setMissing(true);
      setDevices([]);
    });

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (id, status) => {
    setBusyId(id);
    try { await api.update(DEVICES_TABLE, id, { 'סטטוס': status }); await load(); } catch {}
    setBusyId(null);
  };

  const sorted = (devices || []).slice().sort((a, b) => {
    const rank = (s) => (s === 'ממתין לאישור' ? 0 : s === 'מאושר' ? 1 : 2);
    return rank(a['סטטוס']) - rank(b['סטטוס']) || String(b['כניסה אחרונה'] || '').localeCompare(String(a['כניסה אחרונה'] || ''));
  });

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="מכשירי כניסה">
        <div className="drawer-header">
          <span>📱 מכשירי כניסה</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          {missing ? (
            <div className="empty-state">
              טבלת "מכשירי כניסה" עדיין לא קיימת ב-Airtable — מנגנון אישור המכשירים
              יתחיל לפעול ברגע שהיא תיווצר. פרטים בדוח שנשלח.
            </div>
          ) : devices === null ? (
            <div className="skeleton skeleton-card" />
          ) : sorted.length === 0 ? (
            <div className="empty-state">אין מכשירים רשומים עדיין</div>
          ) : (
            sorted.map((d) => (
              <div key={d.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <b>{d['שם משתמש'] || d['אימייל'] || 'משתמש'}</b>
                  <span className={`badge ${d['סטטוס'] === 'מאושר' ? 'badge-ok' : d['סטטוס'] === 'נדחה' ? 'badge-error' : 'badge-warn'}`}>{d['סטטוס'] || 'לא ידוע'}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{d['תפקיד']} · {d['תיאור מכשיר'] || 'מכשיר לא ידוע'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{d['אימייל']}</div>
                {d['סטטוس'] !== 'מאושר' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-success btn-sm" disabled={busyId === d.id} onClick={() => setStatus(d.id, 'מאושר')}>✓ אשר מכשיר</button>
                    {d['סטטוס'] !== 'נדחה' && (
                      <button className="btn btn-danger btn-sm" disabled={busyId === d.id} onClick={() => setStatus(d.id, 'נדחה')}>✕ דחה</button>
                    )}
                  </div>
                )}
                {d['סטטוס'] === 'מאושר' && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }} disabled={busyId === d.id} onClick={() => setStatus(d.id, 'נדחה')}>בטל אישור מכשיר זה</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// סרגל עליון מובייל בלבד — כפתור המבורגר לפתיחת הניווט.
// למנהל עבודה אין תפריט צד נייד בכלל (ר' ManagerMobileTabs) — כאן
// מוצג במקום כפתור ההמבורגר מתג השפה (בדיוק כמו בכותרת אפליקציית העובד).
function MobileTopbar({ onOpenMenu, role, lang, onLang }) {
  const { badges } = useApp();
  const alertsAndRequests = (badges?.alerts || 0) + (badges?.requests || 0);
  return (
    <div className="mobile-topbar no-print">
      {role === 'manager' ? (
        <LanguageSwitcher lang={lang} onLang={onLang} compact />
      ) : (
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onOpenMenu}
          aria-label={t('nav_openMenu')}
        >
          <span aria-hidden="true">☰</span>
          {alertsAndRequests > 0 && <span className="nav-badge mobile-menu-badge">{alertsAndRequests}</span>}
        </button>
      )}
      <div className="mobile-topbar-brand">
        <img src="/assets/logo.png" alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} />
        <span>משק ספאיה</span>
      </div>
    </div>
  );
}

// ============================================================
// ניווט תחתון למנהל עבודה במובייל — באותו סגנון בדיוק כמו אפליקציית
// העובד (worker-tabs/worker-tab), במקום תפריט-צד נגרר. למנהל עבודה יש
// רק 3 מסכים (כוח אדם) — טאב תחתון קבוע מתאים להם הרבה יותר מתפריט צד.
// מוצג רק במובייל (ר' .manager-tabs ב-CSS); בדסקטופ נשאר סרגל הצד הרגיל.
// ============================================================
function ManagerMobileTabs() {
  const { user, logout, badges } = useApp();
  const role = user?.role || 'owner';
  const items = NAV_GROUPS.flatMap((g) => g.items).filter((item) => canSee(role, item.to));
  return (
    <nav className="worker-tabs manager-tabs no-print" aria-label={t('nav_mainNav')}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end
          className={({ isActive }) => `worker-tab${isActive ? ' active' : ''}`}>
          <span className="worker-tab-icon" aria-hidden="true">{item.icon}</span>
          <span>{t(item.labelKey)}</span>
          {item.to === '/requests' && badges.requests > 0 && (
            <span className="nav-badge glow" style={{ position: 'absolute', top: 2, insetInlineEnd: '18%' }}>{badges.requests}</span>
          )}
        </NavLink>
      ))}
      <button type="button" className="worker-tab" onClick={logout}>
        <span className="worker-tab-icon" aria-hidden="true">🚪</span>
        <span>{t('logout')}</span>
      </button>
    </nav>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tables, setTables] = useState([]);
  const [lang, setUI] = useState('he');
  const [loadingTables, setLoadingTables] = useState(true);
  // מוני התראות/בקשות לסרגל הצד — מתרעננים ברקע (Near-Realtime לפי האיפיון)
  const [badges, setBadges] = useState({ requests: 0, alerts: 0, devices: 0 });

  // ============================================================
  // "צפה כמנהל עבודה" (2026-09-08) — מתג תצוגה למנהל ראשי בלבד.
  // משנה רק את מה שמוצג ומה שהתפריט/העמודים מרשים בצד הלקוח (role
  // חשוף כ-'manager'); הטוקן עצמו נשאר טוקן מנהל-ראשי לגמרי ללא
  // שינוי, כך שאין שום סיכון "נעילה עצמית" — כל קריאת API עדיין
  // עובדת עם כל ההרשאות האמיתיות, ברגע שחוזרים לתצוגה הרגילה (או
  // גם באמצע, אם מסך-בת כלשהו קורא ישירות ל-api עם טבלה שהתצוגה
  // המדומה לא הייתה מציגה — זה עדיין יעבוד, כי השרת לא רואה הבדל).
  const [viewAsManager, setViewAsManager] = useState(() => {
    try { return sessionStorage.getItem('zite_view_as') === 'manager'; } catch { return false; }
  });
  const toggleViewAsManager = useCallback(() => {
    setViewAsManager((v) => {
      const next = !v;
      try { sessionStorage.setItem('zite_view_as', next ? 'manager' : ''); } catch {}
      return next;
    });
  }, []);
  const realRole = user?.role;
  const effectiveUser = useMemo(() => {
    if (user && realRole === 'owner' && viewAsManager) return { ...user, role: 'manager' };
    return user;
  }, [user, realRole, viewAsManager]);

  // מעדכן שפה: state, מודול i18n, ומאפיין data-lang לסקיילינג CSS בתאילנדית
  const setAppLang = useCallback((l) => {
    setUI(l);
    setLang(l);
    try { document.documentElement.setAttribute('data-lang', l); } catch {}
  }, []);

  // טעינת המטא-נתונים (רשימת טבלאות) מהשרת
  useEffect(() => {
    fetch('/api/tables')
      .then((r) => r.json())
      .then((data) => {
        setTables(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => setLoadingTables(false));
  }, []);

  // סנכרון תפקיד חי מול מקור האמת (טבלת ההרשאות / העובדים):
  // שינוי "סוג" ב-Airtable נתפס בטעינה ומחזורית — בלי להתנתק
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const revalidate = async () => {
      try {
        if (user.role === 'worker' || user.source === 'workers') {
          const rec = user.record || {};
          if (!rec['מייל'] || !rec['מספר דרכון']) return;
          const r = await fetch('/api/worker-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: rec['מייל'], passport: rec['מספר דרכון'] }),
          });
          if (!r.ok || cancelled) return;
          const d = await r.json();
          if (d?.worker?.id) {
            setUser((u) => {
              const nu = { ...u, token: d.token || u.token, record: { ...u.record, ...d.worker } };
              try { sessionStorage.setItem('zite_user', JSON.stringify(nu)); } catch {}
              return nu;
            });
          }
        } else if (user.email) {
          // אימייל נלקח מהטוקן עצמו בצד השרת — לא נשלח יותר בגוף הבקשה
          const r = await authFetch('/api/admin-role', { method: 'POST' });
          if (!r.ok || cancelled) return;
          const d = await r.json();
          if (d?.role) {
            setUser((u) => {
              const nu = { ...u, role: d.role, name: d.name, token: d.token || u.token, record: { ...u.record, 'סוג': d.type, Name: d.name } };
              try { sessionStorage.setItem('zite_user', JSON.stringify(nu)); } catch {}
              return nu;
            });
          }
        }
      } catch {}
    };
    revalidate();
    const id = setInterval(revalidate, 90 * 1000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role, user?.source]);

  // רענון מוני ההתראות והבקשות — כל 90 שניות וגם בחזרה לחלון
  useEffect(() => {
    if (!user || user.role === 'worker') return undefined;
    let stop = false;
    const enc = encodeURIComponent;
    const getLight = (table, fields) =>
      authFetch(`/api/${enc(table)}?raw=1&fields=${fields.map(enc).join(',')}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    const refresh = async () => {
      const [reqs, stock, weeks, devices] = await Promise.all([
        getLight('בקשות עובדים', ['סטטוס']),
        getLight('מלאי בסיסי', ['מלאי נוכחי', 'מלאי מינימום']),
        // סיכום שבועי: לא בהרשאת קריאה של מנהל עבודה — רלוונטי לבעלים בלבד
        user.role === 'owner' ? getLight('סיכום שבועי', ['סטטוס התאמה', 'סטטוס התאמת קטיף', 'שגיאת חישוב קג לפי מבנים']) : Promise.resolve([]),
        user.role === 'owner' && tables.some((tb) => tb.name === 'מכשירי כניסה') ? getLight('מכשירי כניסה', ['סטטוס']) : Promise.resolve([]),
      ]);
      if (stop) return;
      const list = (v) => (Array.isArray(v) ? v : []);
      const pending = list(reqs).filter((r) => (r['סטטוס'] || 'ממתין לאישור') === 'ממתין לאישור').length;
      const low = list(stock).filter((i) => i['מלאי נוכחי'] != null && Number(i['מלאי נוכחי']) <= Number(i['מלאי מינימום'] || 0)).length;
      const badWeeks = list(weeks).filter((w) =>
        (w['סטטוס התאמה'] && w['סטטוס התאמה'] !== 'תקין')
        || (w['סטטוס התאמת קטיף'] && !String(w['סטטוס התאמת קטיף']).includes('תקין'))
        || String(w['שגיאת חישוב קג לפי מבנים'] || '').trim()).length;
      const pendingDevices = list(devices).filter((d) => d['סטטוס'] === 'ממתין לאישור').length;
      setBadges({ requests: pending, alerts: pending + low + badWeeks, devices: pendingDevices });
    };
    refresh();
    const id = setInterval(refresh, 90 * 1000);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [user]);

  // טעינת משתמש שמור ב-sessionStorage (התחברות קודמת)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('zite_user');
      if (saved) {
        const u = JSON.parse(saved);
        // תיקון לסשנים ששמרו תפקיד ישן: "מנהל ראשי" הוא בעל העסק —
        // רק מי שסוגו כולל "עבודה" הוא מנהל עבודה מצומצם
        const t = String(u?.record?.['סוג'] || '').trim();
        if (u?.role === 'manager' && t && !t.includes('עבודה')) {
          u.role = 'owner';
          try { sessionStorage.setItem('zite_user', JSON.stringify(u)); } catch {}
        }
        setUser(u);
      }
    } catch {}
  }, []);

  const login = useCallback((u) => {
    setUser(u);
    try { sessionStorage.setItem('zite_user', JSON.stringify(u)); } catch {}
  }, []);
  const logout = useCallback(() => {
    setUser(null);
    setViewAsManager(false);
    try { sessionStorage.removeItem('zite_user'); sessionStorage.removeItem('zite_view_as'); } catch {}
  }, []);

  // חשוב: אובייקט ה-API חייב להיות יציב בין רינדורים — אחרת כל מסך
  // שטוען נתונים לפי [app.api] נטען מחדש בכל עדכון מונים (כל 90 שניות)
  const api = useMemo(() => ({
    async get(table, qs = '') {
      const r = await authFetch(`/api/${encodeURIComponent(table)}${qs}`);
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
    async create(table, body) {
      const r = await authFetch(`/api/${encodeURIComponent(table)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
    async update(table, id, body) {
      const r = await authFetch(`/api/${encodeURIComponent(table)}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
    async remove(table, id) {
      const r = await authFetch(`/api/${encodeURIComponent(table)}/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
  }), []);

  const appValue = useMemo(() => ({
    user: effectiveUser,
    realRole,
    viewAsManager,
    toggleViewAsManager,
    login,
    logout,
    lang,
    setAppLang,
    tables,
    loadingTables,
    badges,
    api,
  }), [effectiveUser, realRole, viewAsManager, toggleViewAsManager, login, logout, lang, setAppLang, tables, loadingTables, badges, api]);

  // אם אין משתמש מחובר — מסך התחברות
  if (!user) {
    return (
      <AppContext.Provider value={appValue}>
        <LoginPage />
      </AppContext.Provider>
    );
  }

  // עובד — אפליקציית Mobile-first נפרדת
  if (user.role === 'worker') {
    return (
      <AppContext.Provider value={appValue}>
        <WorkerApp />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={appValue}>
      <NavigationProvider role={effectiveUser.role}>
        <AppShell />
      </NavigationProvider>
    </AppContext.Provider>
  );
}

// מכיל את מבנה העמוד עצמו — נפרד מ-App כדי שיוכל להשתמש ב-useLocation
// (הזמין רק בתוך NavigationProvider/Router) לסגירת התפריט הנייד במעבר מסך.
function AppShell() {
  const { user, lang, setAppLang, viewAsManager, toggleViewAsManager } = useApp();
  const role = user.role || 'owner';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  return (
    <div className={`role-${role}`}>
      <a className="skip-link" href="#main-content">{t('nav_skipToContent')}</a>
      {viewAsManager && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 80, background: '#B45309', color: '#fff',
          padding: '8px 16px', fontSize: 14, fontWeight: 600, textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span>👁️ אתה צופה כמנהל עבודה</span>
          <button type="button" onClick={toggleViewAsManager}
            style={{ background: '#fff', color: '#B45309', border: 'none', borderRadius: 6, padding: '4px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            חזור למנהל ראשי
          </button>
        </div>
      )}
      <MobileTopbar onOpenMenu={() => setMobileNavOpen(true)} role={role} lang={lang} onLang={setAppLang} />
      <div className="app-shell">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <main className="main-area" id="main-content" tabIndex={-1}>
          <RoleGate role={user.role}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/structures" element={<StructuresPage />} />
              <Route path="/planting" element={<PlantingPlanPage />} />
              <Route path="/crops" element={<CropsPage />} />
              <Route path="/crew" element={<TeamCrewPage />} />
              <Route path="/workers" element={<WorkersPage />} />
              <Route path="/requests" element={<WorkerRequestsPage />} />
              <Route path="/harvests" element={<HarvestsPage />} />
              <Route path="/spraying" element={<TreatmentsPage initialTab="list" />} />
              <Route path="/materials" element={<TreatmentsPage initialTab="materials" />} />
              <Route path="/treatments" element={<TreatmentsPage initialTab="calendar" />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/finance-forecast" element={<FinancialForecastPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/delivery-notes" element={<DeliveryNotesPage />} />
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/weekly" element={<WeeklySummaryPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/nonworkdays" element={<NonWorkDaysPage />} />
              <Route path="/spray-reports" element={<TreatmentsPage initialTab="reports" />} />
              <Route path="/upload" element={<UploadDocumentPage />} />
              {/* מסלול בדיקה של אפליקציית העובד (לבעל העסק) */}
              <Route path="/worker" element={<WorkerApp />} />
              <Route path="*" element={<Navigate to={INITIAL_ROUTE(user.role)} replace />} />
            </Routes>
          </RoleGate>
        </main>
      </div>
      {role === 'manager' && <ManagerMobileTabs />}
    </div>
  );
}
