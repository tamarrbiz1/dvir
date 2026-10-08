// ============================================================
// באנר חידוש אימות הניתוח האוטומטי (משימה AA, 8.10.2026)
// ------------------------------------------------------------
// הלקוחה אינה טכנולוגית, ולכן כל התהליך הוא: לוחצת "חדש אימות" →
// נפתח דפדפן לאישור → מעתיקה את הקוד שמוצג → מדביקה כאן → "אשר".
// בכוונה אין בטקסט אף מילה כמו "טוקן"/"OAuth"/"CLI".
//
// מוצג **רק למנהל ראשי** (owner) ורק כשיש מה לעשות:
//   • פחות מ-30 יום לתפוגה → אזהרה מקדימה (notice-warn)
//   • פג / לא מוגדר / ניתוח נכשל ב-AUTH_EXPIRED → שגיאה (notice-error)
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch.js';
import { toast } from '../utils/ui.js';

const WARN_DAYS = 30;

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL');
}

export default function CliAuthBanner({ isOwner, authExpired, onRenewed }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(null); // { url }
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(() => {
    if (!isOwner) return;
    authFetch('/api/cli-auth/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => {});
  }, [isOwner]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  if (!isOwner) return null;

  const daysLeft = status?.daysLeft;
  const expiringSoon = typeof daysLeft === 'number' && daysLeft <= WARN_DAYS && daysLeft > 0;
  const broken = authExpired || status?.configured === false || (typeof daysLeft === 'number' && daysLeft <= 0);
  if (!expiringSoon && !broken && !session) return null;

  const start = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await authFetch('/api/cli-auth/start', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'לא ניתן להתחיל את החידוש');
      setSession({ url: d.url });
      // חוסם-חלונות קופצים יחסום את זה בחלק מהדפדפנים — ולכן הקישור
      // מוצג גם כקישור לחיץ, ולא מסתמכים על window.open בלבד.
      try { window.open(d.url, '_blank', 'noopener'); } catch { /* הקישור מוצג ממילא */ }
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  const complete = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await authFetch('/api/cli-auth/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'האישור נכשל');
      setSession(null); setCode('');
      toast(`✓ האימות חודש עד ${formatDate(d.expiresAt)}`);
      loadStatus();
      await onRenewed?.();
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  return (
    <div className={`notice ${broken ? 'notice-error' : 'notice-warn'}`} role="status" style={{ maxWidth: 'min(760px, 92vw)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {broken
          ? '✕ הניתוח האוטומטי של חשבוניות מושבת כרגע'
          : `⚠ האימות של הניתוח האוטומטי פג ב-${formatDate(status?.expiresAt)} (בעוד ${daysLeft} ימים)`}
      </div>
      <div className="muted" style={{ marginBottom: 8 }}>
        {broken
          ? 'כדי שהמערכת תמשיך לקרוא חשבוניות אוטומטית, יש לחדש את האישור. לוחצים על הכפתור, מאשרים בדפדפן שייפתח, ומדביקים כאן את הקוד שיוצג.'
          : 'אפשר לחדש עכשיו — לוחצים על הכפתור, מאשרים בדפדפן שייפתח, ומדביקים כאן את הקוד שיוצג.'}
      </div>

      {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 8 }}>⚠️ {error}</div>}

      {!session ? (
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={start}>
          {busy ? 'פותח…' : '🔑 חדש אימות'}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13 }}>
            אם הדפדפן לא נפתח מעצמו —{' '}
            <a href={session.url} target="_blank" rel="noopener noreferrer" className="crumb-link" style={{ wordBreak: 'break-all' }}>
              לחצו כאן לפתיחת דף האישור
            </a>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input" style={{ flex: '1 1 220px', minWidth: 0, maxWidth: '100%' }}
              placeholder="הדביקו כאן את הקוד שהוצג" value={code}
              onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false}
            />
            <button type="button" className="btn btn-sm btn-success" disabled={busy || !code.trim()} onClick={complete}>
              {busy ? 'מאשר…' : 'אשר'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setSession(null); setCode(''); setError(''); }}>
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
