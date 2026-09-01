// ============================================================
// דוחות ריסוסים (סעיף 21)
// ------------------------------------------------------------
// הטיפולים שפוענחו מהדוח הם רשומות אמיתיות בטבלת "ריסוסים"
// (עם קובץ הדוח מצורף) — לכן כל כרטיס ניתן לסימון "בוצע",
// לעריכה ולמחיקה ישירות מול Airtable. תצוגת לוח שנה מלאה
// נמצאת במסך "תכנון טיפולים".
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { formatDate, formatNumber } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import { confirmDialog, toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';

const TYPE_COLORS = [
  { match: 'הגמעה', color: '#3B82F6' },
  { match: 'מועיל', color: '#168A55' },
  { match: 'ריסוס', color: '#E5A900' },
];
const colorOf = (t) => {
  const tag = [t['סטטוס'], t['סוג מרסס'], displayName(t['חומר ריסוס'], '')].join(' ');
  return (TYPE_COLORS.find((c) => tag.includes(c.match)) || TYPE_COLORS[2]).color;
};

// "תאריך" עשוי להיות ISO או טווח טקסטואלי "DD/MM/YYYY-DD/MM/YYYY"
function dateLabel(v) {
  const s = String(v || '').trim();
  if (!s) return 'לא זמין';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  return formatDate(s);
}

export default function SprayReportsPage() {
  const app = useApp();
  const navigate = useNavigate();
  const canEdit = (app.user?.role || 'owner') === 'owner'; // עדכונים למנהל הראשי בלבד
  const [sprays, setSprays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => app.api.get('ריסוסים', '?maxRecords=1000')
    .then((d) => setSprays(Array.isArray(d) ? d : []))
    .catch(() => {}), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // טיפולים שמקורם בדוח — יש להם קובץ דוח מצורף או פירוק AI
  const items = useMemo(() => sprays
    .filter((r) => (Array.isArray(r['דוח ריסוסים']) && r['דוח ריסוסים'].length) || r['פירוק טבלת דוח (AI ניתוח טבלה)'])
    .filter((r) => {
      if (!search) return true;
      const hay = [displayName(r['מבנה'], ''), displayName(r['חומר ריסוס'], ''), r['תוכנית שתילה'], r['סטטוס'], String(r['תאריך'] || '')]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search.toLowerCase());
    })
    .sort((a, b) => String(b['תאריך'] || '').localeCompare(String(a['תאריך'] || ''))), [sprays, search]);

  const toggleDone = async (r) => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await app.api.update('ריסוסים', r.id, { 'בוצע': !r['בוצע'] });
      await load();
      toast(r['בוצע'] ? 'הטיפול סומן כלא בוצע' : 'הטיפול סומן כבוצע');
    } catch {
      toast('לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו.', 'error');
    }
    setBusyId(null);
  };

  const remove = async (r) => {
    const yes = await confirmDialog({
      title: 'מחיקת טיפול',
      message: 'הפריט ימחק ולא יינתן לשחזור.\nהאם אתה בטוח שברצונך לבצע פעולה זו?',
      confirmLabel: 'מחק', danger: true,
    });
    if (!yes) return;
    try {
      await app.api.remove('ריסוסים', r.id);
      await load();
      toast('הפריט נמחק בהצלחה');
    } catch {
      toast('לא ניתן היה למחוק את הפריט.', 'error');
    }
  };

  return (
    <div>
      <PageHeader icon="📋" title="דוחות ריסוסים">
        <input className="input no-print" aria-label="חיפוש" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-ghost no-print" onClick={() => navigate('/treatments')}>📅 לוח שנה</button>
        <button className="btn btn-primary no-print" onClick={() => navigate('/upload', { state: { docType: 'דוח ריסוסים' } })}>⬆️ העלאת דוח</button>
      </PageHeader>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <div>אין טיפולים מדוחות ריסוסים</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>העלה דוח ריסוסים במסך "העלאת מסמך" והטיפולים יופיעו כאן</div>
        </div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 18 }}>
            <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--spray-soft)' }}>🧴</div><span className="kpi-label">טיפולים מהדוחות</span></div><div className="kpi-value" style={{ color: 'var(--spray)' }}>{formatNumber(items.length)}</div><div style={{ height: 12 }} /></div>
            <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--ok-soft)' }}>✅</div><span className="kpi-label">בוצעו</span></div><div className="kpi-value" style={{ color: 'var(--ok)' }}>{formatNumber(items.filter((r) => r['בוצע']).length)}</div><div style={{ height: 12 }} /></div>
            <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--warning-soft)' }}>●</div><span className="kpi-label">ממתינים לביצוע</span></div><div className="kpi-value" style={{ color: 'var(--warning)' }}>{formatNumber(items.filter((r) => !r['בוצע']).length)}</div><div style={{ height: 12 }} /></div>
          </div>

          <div className="grid">
            {items.map((r) => {
              const color = colorOf(r);
              const doc = Array.isArray(r['דוח ריסוסים']) && r['דוח ריסוסים'][0];
              const structs = Array.isArray(r['מבנה']) ? r['מבנה'] : [];
              return (
                <div key={r.id} className="card" style={{ borderRight: `4px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <b>🧴 {displayName(r['חומר ריסוס'], 'טיפול')}</b>
                    <span className={`badge ${r['בוצע'] ? 'badge-ok' : 'badge-warn'}`}>{r['בוצע'] ? '✓ בוצע' : '● לא בוצע'}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', display: 'grid', gap: 3 }}>
                    <div>תאריך: <b style={{ color: 'var(--text-main)' }}>{dateLabel(r['תאריך'])}</b></div>
                    {structs.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        מבנה: {structs.map((s, i) => <span key={i} className="obj-chip static">🏗️ {typeof s === 'object' ? s.name : s}</span>)}
                      </div>
                    )}
                    {r['תוכנית שתילה'] && <div>גידול / זן: {r['תוכנית שתילה']}</div>}
                    {(r['מינון '] ?? r['מינון']) != null && <div>מינון: {r['מינון '] ?? r['מינון']}</div>}
                    {r['בסיס מינון'] && <div>בסיס מינון: {r['בסיס מינון']}</div>}
                    {r['סטטוס'] && <div>סטטוס: {r['סטטוס']}</div>}
                    {doc && <div>📎 <a href={doc.url} target="_blank" rel="noopener noreferrer">{doc.filename || 'קובץ הדוח'}</a></div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <button className="btn btn-sm btn-ghost" disabled={busyId === r.id}
                        aria-label={r['בוצע'] ? 'סמן כלא בוצע' : 'סמן כבוצע'} title={r['בוצע'] ? 'סמן כלא בוצע' : 'סמן כבוצע'}
                        onClick={() => toggleDone(r)}>{busyId === r.id ? '…' : r['בוצע'] ? '↩' : '✓ בוצע'}</button>
                      <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setForm(r)}>✎</button>
                      <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }} onClick={() => remove(r)}>🗑</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {form && (
        <QuickEdit
          api={app.api}
          record={form}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); toast('הטיפול עודכן בהצלחה'); }}
        />
      )}
    </div>
  );
}

// עריכה מהירה — שדות ההזנה הידנית בלבד (הכמות והמחיר מחושבים ב-Airtable)
function QuickEdit({ api, record, onClose, onSaved }) {
  const [dosage, setDosage] = useState(record['מינון '] ?? record['מינון'] ?? '');
  const [notes, setNotes] = useState(record['הערות'] || '');
  const [done, setDone] = useState(!!record['בוצע']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.update('ריסוסים', record.id, {
        'מינון ': dosage === '' ? null : Number(dosage),
        'הערות': notes || null,
        'בוצע': done,
      });
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>עריכת טיפול — {displayName(record['חומר ריסוס'], '')}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={submit}>
          <div className="form-group"><label>מינון</label>
            <input className="input" type="number" step="any" min="0" style={{ width: '100%' }} value={dosage} onChange={(e) => setDosage(e.target.value)} /></div>
          <div className="form-group"><label>הערות</label>
            <textarea className="input" style={{ width: '100%' }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> בוצע
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : 'שמור שינויים'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
