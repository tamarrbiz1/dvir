import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatDate } from '../utils/format.js';

const TOPICS = [
  { key: 'income', label: 'חשבונית הכנסה', icon: '🧾', color: 'var(--revenue)', soft: 'var(--revenue-soft)' },
  { key: 'expense', label: 'חשבונית הוצאה', icon: '🧾', color: 'var(--expense)', soft: 'var(--expense-soft)' },
  { key: 'delivery', label: 'תעודת משלוח', icon: '📦', color: 'var(--docs)', soft: 'var(--docs-soft)' },
  { key: 'cheque', label: 'צ\'ק', icon: '🏦', color: 'var(--profit)', soft: 'var(--profit-soft)' },
  { key: 'spray', label: 'דוח ריסוסים', icon: '🧴', color: 'var(--pallets)', soft: 'var(--pallets-soft)' },
];

// שמות טבלאות ושדות לפי נושא
const TARGETS = {
  income: { table: 'חשבוניות', field: 'חשבונית' },
  expense: { table: 'הוצאות', field: 'חשבונית' },
  delivery: { table: 'תעודות משלוח', field: 'תעודת משלוח' },
  cheque: { table: 'צ׳קים', field: 'צילום צ\'ק' },
  spray: { table: 'דוחות ריסוסים', field: 'דוח ריסוסים' },
};

export default function UploadDocumentPage() {
  const app = useApp();
  const [topic, setTopic] = useState(null);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(true);

  useEffect(() => {
    const tables = ['חשבוניות', 'הוצאות', 'תעודות משלוח', 'צ׳קים', 'דוחות ריסוסים'];
    const fields = ['חשבונית', 'חשבונית', 'תעודת משלוח', "צילום צ'ק", 'דוח ריסוסים'];
    const dateFields = ['תאריך-AI', 'תאריך חשבונית-AI', 'תאריך תעודה', 'תאריך פירעון', 'תאריך'];
    Promise.all(tables.map((t, i) =>
      app.api.get(t, '?maxRecords=50').then((d) => (Array.isArray(d) ? d : []).map((r) => ({
        table: TOPICS.find((x) => TARGETS[x]?.table === t)?.label || t,
        date: formatDate(r[dateFields[i]] || r['תאריך']),
        name: r[fields[i]] ? (Array.isArray(r[fields[i]]) ? r[fields[i]][0]?.filename || r[fields[i]][0]?.url?.slice(-20) || 'קובץ' : 'קובץ') : '—',
      }))).catch(() => [])
    )).then((results) => {
      const flat = results.flat().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 15);
      setHistory(flat);
      setHistLoading(false);
    });
  }, []);

  // חישוב שבוע עסקי: שבת-חמישי (ברירת שבוע קודם)
  const getBusinessWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    // חזרה ליום שבת (ישראל: יום 6)
    let day = d.getDay(); // 0=ראשון ... 6=שבת
    const diffToSat = (6 - day + 7) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() + diffToSat);
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // חמישי
    const fmt = (dd) => {
      const y = dd.getFullYear();
      const m = String(dd.getMonth() + 1).padStart(2, '0');
      const day_ = String(dd.getDate()).padStart(2, '0');
      return { str: `${day_}/${m}/${y}`, code: `${y}${m}${day_}` };
    };
    return { start: fmt(start), end: fmt(end), code: `${fmt(start).code}-${fmt(end).code}` };
  };

  const week = getBusinessWeek();

  const needsWeek = () => topic === 'income' || topic === 'delivery';

  const handleUpload = async () => {
    if (!topic || !file) return;
    setStatus('uploading');
    try {
      const target = TARGETS[topic];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('table', target.table);
      formData.append('field', target.field);
      if (needsWeek()) formData.append('weekCode', week.code);

      const r = await fetch('/api/upload-document', { method: 'POST', body: formData });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setStatus('done');
      setMessage('המסמך הועלה בהצלחה');
    } catch (e) {
      setStatus('error');
      setMessage('לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו.');
    }
  };

  return (
    <div>
      <div className="page-header"><h2>העלאת מסמך</h2></div>

      <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* שלב 1 — נושא */}
        <div className="section-title" style={{ marginTop: 0 }}>📤 נושא המסמך</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {TOPICS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTopic(t.key); setStatus('idle'); setFile(null); }}
              style={{
                padding: '20px 12px', borderRadius: '14px', cursor: 'pointer', fontFamily: 'var(--font-main)',
                border: topic === t.key ? '2px solid var(--accent-top)' : '1px solid var(--border)',
                background: topic === t.key ? t.soft : '#fff', textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 30 }}>{t.icon}</div>
              <div style={{ fontWeight: 600, marginTop: 8 }}>{t.label}</div>
            </button>
          ))}
        </div>

        {/* שבוע (לחשבונית הכנסה + תעודת משלוח) */}
        {topic && needsWeek() && (
          <div style={{ marginTop: 22 }} className="card" style={{ background: 'var(--bg-secondary)' }}>
            <div className="section-title" style={{ marginTop: 0 }}>שבוע המסמך</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{week.start.str} – {week.end.str}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>קוד שבוע: {week.code}</div>
            <div style={{ marginTop: 8 }}>
              <span className="badge badge-ok">✓ השבוע נכון</span>
            </div>
          </div>
        )}

        {/* שלב 2 — בחירת קובץ */}
        {topic && (
          <div style={{ marginTop: 22 }}>
            <div className="section-title">בחר קובץ</div>
            <label
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '40px 20px', border: '2px dashed var(--border)', borderRadius: '14px',
                cursor: 'pointer', background: 'var(--bg-secondary)',
              }}
            >
              <div style={{ fontSize: 40 }}>⬆️</div>
              <div style={{ fontWeight: 600, marginTop: 10 }}>בחר קובץ מהמכשיר</div>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
            </label>
            {file && (
              <div className="card" style={{ marginTop: 14, background: 'var(--bg-main)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><b style={{ overflowWrap: 'anywhere' }}>📄 {file.name}</b></div>
                  <span className="badge badge-ok">✓ נבחר</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{file.size} בתים</div>
              </div>
            )}
          </div>
        )}

        {/* שלב 4 — שליחה */}
        {topic && file && (
          <div style={{ marginTop: 22 }}>
            <div className="card" style={{ background: 'var(--bg-secondary)', marginBottom: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>סיכום שליחה</div>
              <div>נושא: <b>{TOPICS.find((t) => t.key === topic)?.label}</b></div>
              <div>קובץ: <b>{file.name}</b></div>
              {needsWeek() && <div>שבוע: <b>{week.start.str} – {week.end.str}</b></div>}
              {needsWeek() && <div style={{ fontSize: 13 }}>קוד שבוע: {week.code}</div>}
            </div>

            {status === 'done' && (
              <div style={{ textAlign: 'center', padding: 20, marginBottom: 16, background: 'var(--ok-soft)', borderRadius: '14px' }}>
                <div style={{ fontSize: 34 }}>✅</div>
                <div style={{ fontWeight: 700, color: 'var(--ok)' }}>המסמך הועלה בהצלחה</div>
                <div style={{ color: 'var(--text-secondary)' }}>המסמך נשלח לעיבוד</div>
              </div>
            )}
            {status === 'error' && (
              <div style={{ padding: 14, marginBottom: 16, background: 'var(--error-soft)', borderRadius: '12px', color: 'var(--error)' }}>❌ {message}</div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%', minHeight: 52 }}
              disabled={status === 'uploading'}
              onClick={handleUpload}
            >
              {status === 'uploading' ? 'מעלה את המסמך...' : 'שלח את המסמך'}
            </button>
          </div>
        )}

        {!topic && (
          <div className="empty-state" style={{ padding: '30px 10px' }}>
            <div className="icon">📋</div>
            בחר תחילה את נושא המסמך להמשך
          </div>
        )}
      </div>

      {/* היסטוריית העלאות */}
      <div className="card" style={{ marginTop: 30 }}>
        <div className="section-title" style={{ marginTop: 0 }}>העלאות אחרונות</div>
        {histLoading ? (
          <div className="skeleton skeleton-card" />
        ) : history.length === 0 ? (
          <div className="empty-state">אין העלאות אחרונות</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>סוג</th><th>תאריך</th><th>קובץ</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td><span className="badge badge-ok">{h.table}</span></td>
                    <td>{h.date}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{h.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
