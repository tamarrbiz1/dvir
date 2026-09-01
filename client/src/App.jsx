import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react';
import { t, setLang } from './i18n.js';
import LanguageSwitcher from './components/LanguageSwitcher.jsx';
import { NAV_GROUPS, INITIAL_ROUTE, canSee, NavigationProvider } from './utils/navigation.jsx';

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
import SprayReportsPage from './pages/SprayReportsPage.jsx';
import HarvestsPage from './pages/HarvestsPage.jsx';
import SprayingPage from './pages/SprayingPage.jsx';
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

function Sidebar() {
  const { user, lang, setAppLang, logout, badges } = useApp();
  const role = user?.role || 'owner';
  return (
    <aside className="sidebar" role="navigation" aria-label={t('nav_mainNav')}>
      <div className="brand">
        <img src="/assets/logo.png" alt="לוגו" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />
        <span>משק חקלאי</span>
        {canSee(role, '/alerts') && (
          <NavLink
            to="/alerts"
            aria-label={badges.alerts ? `התראות — ${badges.alerts} פעילות` : 'התראות'}
            title="התראות"
            style={{ marginInlineStart: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 18 }}
          >
            🔔{badges.alerts > 0 && <span className="nav-badge">{badges.alerts}</span>}
          </NavLink>
        )}
      </div>
      {role !== 'owner' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <LanguageSwitcher lang={lang} onLang={setAppLang} />
        </div>
      )}
      {role === 'manager' && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--workers-soft)', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
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
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div style={{ padding: '0 12px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
          מחובר: <b style={{ color: 'var(--text-secondary)' }}>{user?.name || 'משתמש'}</b> · {role === 'owner' ? 'מנהל ראשי' : 'מנהל עבודה'}
        </div>
        <button type="button" className="nav-item" onClick={logout}>
          <span className="nav-icon" aria-hidden="true">🚪</span>
          <span>{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tables, setTables] = useState([]);
  const [lang, setUI] = useState('he');
  const [loadingTables, setLoadingTables] = useState(true);
  // מוני התראות/בקשות לסרגל הצד — מתרעננים ברקע (Near-Realtime לפי האיפיון)
  const [badges, setBadges] = useState({ requests: 0, alerts: 0 });

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
          if (d?.worker?.id && d.worker.id !== rec.id) {
            setUser((u) => {
              const nu = { ...u, record: { ...u.record, ...d.worker } };
              try { sessionStorage.setItem('zite_user', JSON.stringify(nu)); } catch {}
              return nu;
            });
          }
        } else if (user.email) {
          const r = await fetch('/api/admin-role', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email }),
          });
          if (!r.ok || cancelled) return;
          const d = await r.json();
          if (d?.role && (d.role !== user.role || d.name !== user.name)) {
            setUser((u) => {
              const nu = { ...u, role: d.role, name: d.name, record: { ...u.record, 'סוג': d.type, Name: d.name } };
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
      fetch(`/api/${enc(table)}?raw=1&fields=${fields.map(enc).join(',')}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    const refresh = async () => {
      const [reqs, stock, weeks] = await Promise.all([
        getLight('בקשות עובדים', ['סטטוס']),
        getLight('מלאי בסיסי', ['מלאי נוכחי', 'מלאי מינימום']),
        getLight('סיכום שבועי', ['סטטוס התאמה', 'סטטוס התאמת קטיף', 'שגיאת חישוב קג לפי מבנים']),
      ]);
      if (stop) return;
      const list = (v) => (Array.isArray(v) ? v : []);
      const pending = list(reqs).filter((r) => (r['סטטוס'] || 'ממתין לאישור') === 'ממתין לאישור').length;
      const low = list(stock).filter((i) => i['מלאי נוכחי'] != null && Number(i['מלאי נוכחי']) <= Number(i['מלאי מינימום'] || 0)).length;
      const badWeeks = list(weeks).filter((w) =>
        (w['סטטוס התאמה'] && w['סטטוס התאמה'] !== 'תקין')
        || (w['סטטוס התאמת קטיף'] && !String(w['סטטוס התאמת קטיף']).includes('תקין'))
        || w['שגיאת חישוב קג לפי מבנים']).length;
      setBadges({ requests: pending, alerts: pending + low + badWeeks });
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
    try { sessionStorage.removeItem('zite_user'); } catch {}
  }, []);

  // חשוב: אובייקט ה-API חייב להיות יציב בין רינדורים — אחרת כל מסך
  // שטוען נתונים לפי [app.api] נטען מחדש בכל עדכון מונים (כל 90 שניות)
  const api = useMemo(() => ({
    async get(table, qs = '') {
      const r = await fetch(`/api/${encodeURIComponent(table)}${qs}`);
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
    async create(table, body) {
      const r = await fetch(`/api/${encodeURIComponent(table)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
    async update(table, id, body) {
      const r = await fetch(`/api/${encodeURIComponent(table)}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
    async remove(table, id) {
      const r = await fetch(`/api/${encodeURIComponent(table)}/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'שגיאה');
      return r.json();
    },
  }), []);

  const appValue = useMemo(() => ({
    user,
    login,
    logout,
    lang,
    setAppLang,
    tables,
    loadingTables,
    badges,
    api,
  }), [user, login, logout, lang, setAppLang, tables, loadingTables, badges, api]);

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
      <NavigationProvider role={user.role}>
        <a className="skip-link" href="#main-content">{t('nav_skipToContent')}</a>
        <div className="app-shell">
          <Sidebar />
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
              <Route path="/spraying" element={<SprayingPage />} />
              <Route path="/materials" element={<SprayingPage initialTab="materials" />} />
              <Route path="/treatments" element={<TreatmentsPage />} />
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
              <Route path="/spray-reports" element={<SprayReportsPage />} />
              <Route path="/upload" element={<UploadDocumentPage />} />
              {/* מסלול בדיקה של אפליקציית העובד (לבעל העסק) */}
              <Route path="/worker" element={<WorkerApp />} />
              <Route path="*" element={<Navigate to={INITIAL_ROUTE(user.role)} replace />} />
            </Routes>
            </RoleGate>
          </main>
        </div>
      </NavigationProvider>
    </AppContext.Provider>
  );
}
