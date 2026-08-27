// ============================================================
// אפליקציית עובד — מסגרת Mobile-first
// ============================================================
import { useState } from 'react';
import { useApp } from '../App.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { t } from '../i18n.js';
import WorkerHome from './WorkerHome.jsx';
import WorkerEarnings from './WorkerEarnings.jsx';
import WorkerReport from './WorkerReport.jsx';

const VIEWS = [
  { key: 'home', icon: '🏠', labelKey: 'w_home' },
  { key: 'earnings', icon: '💰', labelKey: 'w_myEarningsBtn' },
  { key: 'report', icon: '📋', labelKey: 'w_report' },
];

export default function WorkerApp() {
  const { user, logout, lang, setAppLang, api } = useApp();
  const [view, setView] = useState('home');

  // נתוני העובד המחובר (מההתחברות)
  const worker = user?.record || {};

  return (
    <div className="worker-shell">
      {/* ראש אפליקציה */}
      <header className="worker-header">
        <div className="worker-brand">
          <img src="/assets/logo.png" alt="לוגו" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{t('w_hello')} {user?.name}</div>
            <div style={{ fontSize: 11, opacity: 0.8, direction: 'ltr' }}>{String(worker['מספר דרכון'] || '')}</div>
          </div>
        </div>
        <LanguageSwitcher lang={lang} onLang={setAppLang} compact />
      </header>

      {/* תוכן לפי תצוגה */}
      <main className="worker-body">
        {view === 'home' && <WorkerHome api={api} worker={worker} />}
        {view === 'earnings' && <WorkerEarnings api={api} worker={worker} />}
        {view === 'report' && <WorkerReport api={api} worker={worker} />}
      </main>

      {/* סרגל ניווט תחתון */}
      <nav className="worker-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`worker-tab ${view === v.key ? 'active' : ''}`}
            onClick={() => setView(v.key)}
          >
            <span className="worker-tab-icon">{v.icon}</span>
            <span>{t(v.labelKey)}</span>
          </button>
        ))}
        <button className="worker-tab" onClick={logout}>
          <span className="worker-tab-icon">🚪</span>
          <span>{t('logout')}</span>
        </button>
      </nav>
    </div>
  );
}
