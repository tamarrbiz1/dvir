import { t } from '../i18n.js';

// מתג שפה [ עברית | ไทย ] — מוצג לבעל/מנהל/עובד בתוך מעדיפות התצוגה
export default function LanguageSwitcher({ lang, onLang }) {
  return (
    <div className="lang-switch">
      <button
        className={lang === 'he' ? 'active' : ''}
        onClick={() => onLang('he')}
        aria-label="עברית"
      >
        עברית
      </button>
      <button
        className={lang === 'th' ? 'active' : ''}
        onClick={() => onLang('th')}
        aria-label="ไทย"
      >
        ไทย
      </button>
    </div>
  );
}
