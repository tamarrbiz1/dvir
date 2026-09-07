import { useState } from 'react';
import { t } from '../i18n.js';

// ============================================================
// כפתור "תרגם" לטקסט חופשי בעברית (הערת מנהל, הערה על עבודה וכו') —
// קורא ל-/api/translate (שירות MyMemory חינמי, ר' server.js). שגיאה
// מוצגת ברור, לא נבלעת. משותף לכל מקום באפליקציית העובד שמציג טקסט
// חופשי שנכתב ע"י מנהל/בעל העסק (2026-09-07: רוכז לקובץ אחד אחרי
// שנמצא שהיו מקומות עם הערה בלי כפתור).
// ============================================================
export default function TranslatableNote({ text }) {
  const [translated, setTranslated] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOriginal, setShowOriginal] = useState(true);

  const doTranslate = async () => {
    setBusy(true); setError('');
    try {
      const resp = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target: 'th' }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || t('w_translateFailed'));
      setTranslated(data.translated);
      setShowOriginal(false);
    } catch (e) {
      setError(e.message || t('w_translateFailed'));
    }
    setBusy(false);
  };

  return (
    <div>
      <div>{showOriginal || !translated ? text : translated}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {!translated ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={doTranslate}>
            {busy ? t('w_translating') : `🌐 ${t('w_translate')}`}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? `🌐 ${t('w_translated')}` : t('w_showOriginal')}
          </button>
        )}
        {error && <span style={{ fontSize: 11, color: 'var(--error)' }}>{error}</span>}
      </div>
    </div>
  );
}
