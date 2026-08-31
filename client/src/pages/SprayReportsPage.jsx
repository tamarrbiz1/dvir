import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { formatDate, safeValue } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

// ============================================================
// דוחות ריסוסים (סעיף 21)
// ============================================================

const PIE_COLORS = ['#E5A900', '#3B82F6', '#168A55', '#8B5CF6', '#F04444', '#09A7B2', '#10A66A'];

export default function SprayReportsPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    app.api.get('דוחות ריסוסים', '?maxRecords=100')
      .then((d) => setReports(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // פירוק JSON מתוך Attachment Summary (התוצאה המפוענחת)
  const parsed = useMemo(() => {
    const list = [];
    reports.forEach((r) => {
      const raw = r['Attachment Summary'] || r['פירוק טבלת דוח (AI ניתוח טבלה)'];
      let items = [];
      try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(p)) items = p;
        else if (p && Array.isArray(p.data)) items = p.data;
        else if (p && Array.isArray(p.records)) items = p.records;
      } catch {}
      items.forEach((it) => list.push({
        reportId: r.id,
        type: it['סוג טיפול'] || it.type || 'ריסוס',
        date: it['תאריך'] || it.date,
        structure: Array.isArray(it['מבנה']) ? it['מבנה'].join(', ') : (it['מבנה'] || it.structure || ''),
        location: it['מיקום'] || it.location || '',
        crop: it['גידול'] || it.crop || '',
        variety: it['זן'] || it.variety || '',
        sprayNum: it['מספר ריסוס'] || it.sprayNum || '',
        material: it['חומר'] || it.material || '',
        dosage: it['מינון'] || it.dosage || '',
      }));
    });
    return list;
  }, [reports]);

  return (
    <div>
      <PageHeader icon="📋" title="דוחות ריסוסים">
        {/* ניווט פנימי (ולא רענון עמוד מלא), כדי לשמר את היסטוריית החזרה */}
        <button className="btn btn-ghost" onClick={() => navigate('/spraying')}>🧴 מעבר לריסוסים</button>
      </PageHeader>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        תוצאות מפוענחות מה-AI
      </div>

      {/* טבלת הדוחות המקוריים — עם מחיקה */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ marginTop: 0 }}>רשימת דוחות</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>תאריך</th><th>מסמך</th><th>סטטוס</th><th>פעולות</th></tr></thead>
            <tbody>
              {!loading && reports.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r['תאריך'] || r['createdTime'])}</td>
                  <td>{r['Attachment Summary'] ? '✓ פוענח' : '—'}</td>
                  <td>{r['Attachment Summary'] ? <span className="badge badge-ok">מוכן</span> : <span className="badge badge-warn">ממתין</span>}</td>
                  <td>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--error)' }}
                      onClick={async () => {
                        if (window.confirm('למחוק דוח זה?')) {
                          try { await app.api.remove('דוחות ריסוסים', r.id); load(); } catch {}
                        }
                      }}
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* נתונים מפורקים מהדוחות */}
      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : parsed.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <div>אין דוחות ריסוסים מפוענחים</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>העלה דוח ריסוסים במסך "העלאת מסמך" כדי לראות תוצאות כאן</div>
        </div>
      ) : (
        <div className="grid">
          {parsed.map((p, i) => {
            const tag = String(p.type).toLowerCase();
            const color = tag.includes('ריסוס') ? '#E5A900' : tag.includes('הגמעה') ? '#3B82F6' : tag.includes('מועיל') ? '#168A55' : '#8B5CF6';
            return (
              <div key={`${p.reportId}-${i}`} className="card" style={{ borderRight: `4px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="badge" style={{ background: color + '22', color }}>🧴 {p.type}</span>
                </div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.material}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {p.date && <div>תאריך: {p.date}</div>}
                  {p.structure && <div>מבנה: {p.structure}</div>}
                  {p.location && <div>מיקום: {p.location}</div>}
                  {p.crop && <div>גידול: {p.crop}</div>}
                  {p.variety && <div>זן: {p.variety}</div>}
                  {p.sprayNum && <div>מספר ריסוס: {p.sprayNum}</div>}
                  {p.dosage && <div>מינון: {p.dosage}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
