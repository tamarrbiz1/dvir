import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';

const ROLES = [
  { key: 'owner', label: 'בעל העסק / מנהל', icon: '👑' },
  { key: 'worker', label: 'עובד', icon: '👷' },
];

export default function LoginPage() {
  const { login } = useApp();
  const [role, setRole] = useState('owner');
  const [email, setEmail] = useState('');
  const [passport, setPassport] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // מעבר לעובד מנקה את ההקשר
  useEffect(() => {
    setError('');
  }, [role]);

  const handleOwnerManager = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/הרשאת מנהל?maxRecords=500');
      const data = await r.json();
      const list = Array.isArray(data) ? data : [];
      const norm = (s) => String(s || '').trim().toLowerCase();

      const found = list.find((u) => norm(u['מייל']) === norm(email));
      if (!found) {
        setError('לא נמצא משתמש עם מייל זה במערכת');
        setLoading(false);
        return;
      }
      // אימות קוד אישי
      if (norm(found['קוד אישי']) !== norm(code)) {
        setError('הקוד האישי שגוי');
        setLoading(false);
        return;
      }
      const type = String(found['סוג'] || 'owner').trim().toLowerCase();
      // "מנהל ראשי" = בעל העסק (גישה מלאה); רק "מנהל עבודה" מקבל תפקיד מצומצם
      const isManager = type.includes('עבודה') || type === 'manager';
      login({
        role: isManager ? 'manager' : 'owner',
        name: found['Name'] || 'משתמש',
        email: found['מייל'],
        record: found,
        source: 'admin',
      });
    } catch (err) {
      setError('שגיאת התחברות לשרת');
    }
    setLoading(false);
  };

  // כניסת עובד: אימות כפול — אימייל + מספר דרכון, נבדק בצד השרת
  const handleWorker = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/worker-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, passport }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error || 'ההתחברות נכשלה');
        setLoading(false);
        return;
      }
      const found = data.worker;
      const name = `${found['שם פרטי'] || ''} ${found['שם משפחה'] || ''}`.trim() || 'עובד';
      try { sessionStorage.setItem('zite_user_recId', found.id); } catch {}
      login({ role: 'worker', name, email: found['מייל'], record: found, source: 'workers' });
    } catch (err) {
      setError('שגיאת התחברות לשרת');
    }
    setLoading(false);
  };

  const handleSubmit = role === 'worker' ? handleWorker : handleOwnerManager;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)' }}>
      <div className="card" style={{ width: 460, maxWidth: '92vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/assets/logo.png" alt="לוגו" style={{ width: 88, height: 88, borderRadius: 18, objectFit: 'cover', marginBottom: 10 }} />
          <h1 style={{ fontSize: 'var(--fs-page)', margin: '4px 0' }}>משק חקלאי</h1>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRole(r.key)}
              style={{
                flex: 1, padding: '12px 6px', borderRadius: 10,
                border: role === r.key ? '2px solid var(--accent-top)' : '1px solid var(--border)',
                background: role === r.key ? 'var(--bg-secondary)' : '#fff',
                cursor: 'pointer', fontFamily: 'var(--font-main)', fontWeight: 600, fontSize: 14,
              }}
            >
              <div style={{ marginTop: 4 }}>{r.label}</div>
            </button>
          ))}
        </div>

        {error && (
          <div className="badge badge-error" style={{ marginBottom: 14, width: '100%' }}>⚠️ {error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>אימייל</label>
            <input className="input" style={{ width: '100%' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {role === 'worker' ? (
            <div className="form-group">
              <label>מספר דרכון</label>
              <input className="input" style={{ width: '100%' }} value={passport} onChange={(e) => setPassport(e.target.value)} placeholder="לדוגמה: AB1234567" />
            </div>
          ) : (
            <div className="form-group">
              <label>קוד אישי</label>
              <input className="input" style={{ width: '100%' }} type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="הקוד האישי" />
            </div>
          )}
          <button className="btn btn-primary" style={{ width: '100%', minHeight: 46 }} disabled={loading}>
            {loading ? 'מתחבר...' : 'התחבר'}
          </button>
        </form>
      </div>
    </div>
  );
}
