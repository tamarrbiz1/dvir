import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
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

// ============================================================
// הקשר גלובלי: שפה, משתמש, נתוני מטה
// ============================================================
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// ============================================================
// נתוני ניווט לפי הקבוצות (עברית)
// ============================================================
const NAV_TEST = [
  { group: 'main', items: [{ to: '/', icon: '📊', labelKey: 'dashboard' }] },
  {
    group: 'operations',
    items: [
      { to: '/structures', icon: '🏗️', labelKey: 'structures' },
      { to: '/planting', icon: '🌱', labelKey: 'planting' },
      { to: '/crops', icon: '🌾', labelKey: 'crops' },
      { to: '/harvests', icon: '🧺', labelKey: 'harvests' },
      { to: '/spraying', icon: '🧴', labelKey: 'spraying' },
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
const INITIAL_ROUTE = (role) => {
  if (role === 'worker') return '/worker';
  if (role === 'manager') return '/workers'; // דף צוות עובדים (מנהל עבודה)
  return '/';
};

// כתובות שמותרות למנהל עבודה (owner רואה הכל)
const OPERATIONS = ['/structures', '/planting', '/harvests', '/spraying', '/treatments', '/workers', '/crew', '/requests', '/spray-reports'];

function canSee(role, to) {
  if (role === 'owner') return true;
  if (role === 'manager') return OPERATIONS.includes(to);
  return false; // worker לא מגיע כאן
}

function Sidebar() {
  const { user, lang, setAppLang } = useApp();
  const role = user?.role || 'owner';
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/assets/logo.png" alt="לוגו" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />
        <span>משק חקלאי</span>
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
      {NAV_TEST.map((group) => {
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
              </NavLink>
            ))}
          </div>
        );
      })}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div className="nav-item" onClick={() => { user?.logout?.(); }}>
          <span className="nav-icon">🚪</span>
          <span>{t('logout')}</span>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tables, setTables] = useState([]);
  const [lang, setUI] = useState('he');
  const [loadingTables, setLoadingTables] = useState(true);

  // מעדכן שפה: state, מודול i18n, ומאפיין data-lang לסקיילינג CSS בתאילנדית
  const setAppLang = (l) => {
    setUI(l);
    setLang(l);
    try { document.documentElement.setAttribute('data-lang', l); } catch {}
  };

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

  // טעינת משתמש שמור ב-sessionStorage (התחברות קודמת)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('zite_user');
      if (saved) setUser(JSON.parse(saved));
    } catch {}
  }, []);

  const login = (u) => {
    setUser(u);
    try { sessionStorage.setItem('zite_user', JSON.stringify(u)); } catch {}
  };
  const logout = () => {
    setUser(null);
    try { sessionStorage.removeItem('zite_user'); } catch {}
  };

  const appValue = {
    user,
    login,
    logout,
    lang,
    setAppLang,
    tables,
    loadingTables,
    api: {
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
    },
  };

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
      <div className="app-shell">
        <Sidebar />
        <main className="main-area">
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
        </main>
      </div>
    </AppContext.Provider>
  );
}
