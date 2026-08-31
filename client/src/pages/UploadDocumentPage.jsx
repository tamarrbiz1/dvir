import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatDate } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';

// ============================================================
// העלאת מסמך — "גרסה סופית" באיפיון (שורות 3845–4118)
// שלב 1 נושא · שלב 2 שבוע (חובה לחשבונית הכנסה / תעודת משלוח)
// שלב 3 קובץ (מכשיר / גרירה / מצלמה) · שלב 4 סיכום ואישור
// ============================================================

const TOPICS = [
  { key: 'income', label: 'חשבונית הכנסה', icon: '🧾', color: '#08A878', soft: 'var(--revenue-soft)' },
  { key: 'expense', label: 'חשבונית הוצאה', icon: '🧾', color: '#F79009', soft: 'var(--warning-soft)' },
  { key: 'delivery', label: 'תעודת משלוח', icon: '📦', color: '#2878D0', soft: 'var(--weight-soft)' },
  { key: 'cheque', label: 'צ\'ק', icon: '🏦', color: '#10A66A', soft: 'var(--profit-soft)' },
  { key: 'spray', label: 'דוח ריסוסים', icon: '🧴', color: '#8B5CF6', soft: 'var(--pallets-soft)' },
];

// שמות טבלאות ושדות (חיים ב-Airtable) לפי נושא
const TARGETS = {
  income: { table: 'חשבוניות', field: 'חשבונית', dateField: 'תאריך-AI' },
  expense: { table: 'הוצאות', field: 'חשבונית', dateField: 'תאריך חשבונית-AI' },
  delivery: { table: 'תעודות משלוח', field: 'תעודת משלוח', dateField: 'תאריך תעודה' },
  cheque: { table: 'צ׳קים', field: 'צילום צ\'ק', dateField: 'תאריך פירעון' },
  spray: { table: 'דוחות ריסוסים', field: 'דוח ריסוסים', dateField: 'העלאה אחרונה של הקובץ' },
};

const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const MAX_MB = 15;

// ---------- שבוע עסקי: שבת → חמישי ----------
const pad = (n) => String(n).padStart(2, '0');
const dmy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** שבת שמתחילה את השבוע העסקי הקודם ביחס להיום */
function defaultWeekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // השבת האחרונה (כולל היום אם שבת) = תחילת השבוע הנוכחי; ברירת המחדל היא השבוע הקודם
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7) - 7);
  return d;
}
function weekOf(start) {
  const end = new Date(start);
  end.setDate(start.getDate() + 5); // שבת + 5 = חמישי
  return { start, end, label: `${dmy(start)} – ${dmy(end)}`, code: `${ymd(start)}-${ymd(end)}` };
}

export default function UploadDocumentPage() {
  const app = useApp();
  const [topic, setTopic] = useState(null);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [weekConfirmed, setWeekConfirmed] = useState(false);
  const [changingWeek, setChangingWeek] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const week = useMemo(() => weekOf(weekStart), [weekStart]);
  const needsWeek = topic === 'income' || topic === 'delivery';
  const topicMeta = TOPICS.find((t) => t.key === topic);

  const loadHistory = () => {
    setHistLoading(true);
    Promise.all(Object.entries(TARGETS).map(([key, t]) =>
      app.api.get(t.table, '?maxRecords=60&raw=1').then((d) => (Array.isArray(d) ? d : [])
        .filter((r) => Array.isArray(r[t.field]) && r[t.field].length)
        .map((r) => ({
          key, label: TOPICS.find((x) => x.key === key)?.label || t.table,
          date: r[t.dateField] || r['תאריך'] || r['תאריך העלאת קובץ'] || '',
          week: r['קוד שבוע'] || '',
          name: r[t.field][0]?.filename || 'קובץ',
          url: r[t.field][0]?.url || '',
        }))).catch(() => [])
    )).then((results) => {
      setHistory(results.flat().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20));
      setHistLoading(false);
    });
  };
  useEffect(loadHistory, []);

  // תצוגה מקדימה לתמונות
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickTopic = (key) => {
    setTopic(key); setStatus('idle'); setMessage(''); setFile(null);
    setWeekConfirmed(false); setChangingWeek(false); setWeekStart(defaultWeekStart());
  };

  const acceptFile = (f) => {
    if (!f) return;
    const okType = /\.(pdf|jpe?g|png)$/i.test(f.name) || ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type);
    if (!okType) { setStatus('error'); setMessage('סוג קובץ לא נתמך. יש להעלות PDF, JPG או PNG.'); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setStatus('error'); setMessage(`הקובץ גדול מדי (מקסימום ${MAX_MB}MB).`); return; }
    setFile(f); setStatus('idle'); setMessage('');
  };

  const shiftWeek = (weeks) => { const d = new Date(weekStart); d.setDate(d.getDate() + weeks * 7); setWeekStart(d); };

  const canSend = topic && file && (!needsWeek || weekConfirmed) && status !== 'uploading';

  const handleUpload = async () => {
    if (!canSend) return;
    setStatus('uploading'); setMessage('');
    try {
      const target = TARGETS[topic];
      const fd = new FormData();
      fd.append('file', file);
      fd.append('table', target.table);
      fd.append('field', target.field);
      if (needsWeek) fd.append('weekCode', week.code);
      const r = await fetch('/api/upload-document', { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) throw new Error(data.error || `שגיאה ${r.status}`);
      setStatus('done');
      setMessage('המסמך הועלה בהצלחה ונשמר ב-Airtable.');
      setFile(null);
      loadHistory();
    } catch (e) {
      setStatus('error');
      setMessage(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
    }
  };

  const sizeLabel = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  return (
    <div>
      <PageHeader icon="⬆️" title="העלאת מסמך" />

      <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* ===== שלב 1 — נושא ===== */}
        <div className="section-title" style={{ marginTop: 0 }}>1. נושא המסמך</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {TOPICS.map((t) => {
            const on = topic === t.key;
            return (
              <button key={t.key} type="button" onClick={() => pickTopic(t.key)} aria-pressed={on}
                style={{
                  padding: '18px 10px', borderRadius: 14, cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'center',
                  border: `2px solid ${on ? t.color : 'var(--border)'}`, background: on ? t.soft : '#fff',
                  boxShadow: on ? `inset 0 -4px 0 ${t.color}` : 'none',
                }}>
                <div style={{ fontSize: 30 }}>{t.icon}</div>
                <div style={{ fontWeight: 700, marginTop: 6, color: on ? t.color : 'var(--text-main)' }}>{t.label}</div>
              </button>
            );
          })}
        </div>

        {/* ===== שלב 2 — שבוע ===== */}
        {needsWeek && (
          <div className="card" style={{ marginTop: 22, background: weekConfirmed ? 'var(--ok-soft)' : 'var(--bg-secondary)', border: `1px solid ${weekConfirmed ? 'var(--ok)' : 'var(--border)'}` }}>
            <div className="section-title" style={{ marginTop: 0 }}>2. שבוע המסמך</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>שבוע עסקי: שבת → חמישי (יום שישי אינו נכלל)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {changingWeek && <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWeek(-1)}>‹ שבוע קודם</button>}
              <div style={{ fontWeight: 800, fontSize: 18, direction: 'ltr' }}>{week.label}</div>
              {changingWeek && <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWeek(1)}>שבוע הבא ›</button>}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>קוד שבוע: <b style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{week.code}</b></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {weekConfirmed ? (
                <>
                  <span className="badge badge-ok" style={{ padding: '8px 14px' }}>✓ השבוע אושר</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setWeekConfirmed(false); setChangingWeek(true); }}>שנה שבוע</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-success" onClick={() => { setWeekConfirmed(true); setChangingWeek(false); }}>✓ השבוע נכון</button>
                  {!changingWeek && <button type="button" className="btn btn-ghost" onClick={() => setChangingWeek(true)}>שנה שבוע</button>}
                </>
              )}
            </div>
          </div>
        )}

        {/* ===== שלב 3 — קובץ ===== */}
        {topic && (
          <div style={{ marginTop: 22 }}>
            <div className="section-title">{needsWeek ? '3' : '2'}. בחר קובץ</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '36px 20px', border: `2px dashed ${dragOver ? 'var(--accent-top)' : 'var(--border)'}`, borderRadius: 14,
                cursor: 'pointer', background: dragOver ? 'var(--docs-soft)' : 'var(--bg-secondary)',
              }}>
              <div style={{ fontSize: 40 }}>⬆️</div>
              <div style={{ fontWeight: 700 }}>בחר קובץ מהמכשיר או גרור לכאן</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>PDF · JPG · PNG · עד {MAX_MB}MB</div>
            </div>
            <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>📁 מהמכשיר</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => cameraRef.current?.click()}>📷 צלם מהטלפון</button>
            </div>

            {file && (
              <div className="card" style={{ marginTop: 14, background: 'var(--bg-main)', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                {preview ? <img src={preview} alt="תצוגה מקדימה" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                  : <div style={{ width: 90, height: 90, borderRadius: 10, background: 'var(--docs-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>📄</div>}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{file.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{topicMeta?.label} · {sizeLabel(file.size)}</div>
                  {needsWeek && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>שבוע {week.label} · <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{week.code}</span></div>}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>✕ הסר</button>
              </div>
            )}
          </div>
        )}

        {/* ===== שלב 4 — סיכום ושליחה ===== */}
        {topic && file && (
          <div style={{ marginTop: 22 }}>
            <div className="section-title">{needsWeek ? '4' : '3'}. אישור ושליחה</div>
            <div className="card" style={{ background: 'var(--bg-secondary)', marginBottom: 14 }}>
              <Row l="נושא" v={topicMeta?.label} />
              <Row l="קובץ" v={file.name} />
              <Row l="יישמר בטבלה" v={TARGETS[topic].table} />
              {needsWeek && <Row l="שבוע" v={week.label} />}
              {needsWeek && <Row l="קוד שבוע" v={<span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>{week.code}</span>} />}
            </div>
            {needsWeek && !weekConfirmed && <div className="badge badge-warn" style={{ width: '100%', marginBottom: 12 }}>⚠️ יש לאשר את השבוע לפני השליחה</div>}
            <button type="button" className="btn btn-primary" style={{ width: '100%', minHeight: 52, fontSize: 16 }} disabled={!canSend} onClick={handleUpload}>
              {status === 'uploading' ? 'מעלה את המסמך...' : '📤 שלח מסמך'}
            </button>
          </div>
        )}

        {status === 'done' && (
          <div style={{ textAlign: 'center', padding: 20, marginTop: 16, background: 'var(--ok-soft)', borderRadius: 14 }}>
            <div style={{ fontSize: 34 }}>✅</div>
            <div style={{ fontWeight: 700, color: 'var(--ok)' }}>{message}</div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => pickTopic(topic)}>העלה מסמך נוסף</button>
          </div>
        )}
        {status === 'error' && <div style={{ padding: 14, marginTop: 16, background: 'var(--error-soft)', borderRadius: 12, color: 'var(--error)' }}>❌ {message}</div>}

        {!topic && <div className="empty-state" style={{ padding: '30px 10px' }}><div className="icon">📋</div>בחר תחילה את נושא המסמך</div>}
      </div>

      {/* ===== היסטוריה ===== */}
      <div className="card" style={{ marginTop: 30 }}>
        <div className="section-title" style={{ marginTop: 0 }}>העלאות אחרונות</div>
        {histLoading ? <div className="skeleton skeleton-card" /> : history.length === 0 ? (
          <div className="empty-state">אין העלאות אחרונות</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>סוג</th><th>תאריך</th><th>שבוע</th><th>קובץ</th></tr></thead>
              <tbody>
                {history.map((h, i) => {
                  const meta = TOPICS.find((t) => t.key === h.key);
                  return (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td><span className="badge" style={{ background: meta?.soft, color: meta?.color }}>{meta?.icon} {h.label}</span></td>
                      <td>{h.date ? formatDate(h.date) : 'לא זמין'}</td>
                      <td style={{ direction: 'ltr', textAlign: 'right' }}>{h.week || '—'}</td>
                      <td style={{ overflowWrap: 'anywhere' }}>{h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.name}</a> : h.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ l, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><b style={{ overflowWrap: 'anywhere', textAlign: 'left' }}>{v}</b></div>;
}
