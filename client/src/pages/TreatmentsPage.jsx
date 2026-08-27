import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatDate, safeValue } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import { displayName } from '../utils/resolve.js';

// ============================================================
// תכנון טיפולים — לוח שנה + תצוגת שבוע + רשימה (סעיף 22)
// ============================================================

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const TYPE_COLORS = {
  'ריסוס': { bg: '#FFF3D6', border: '#E5A900', label: 'ריסוס' },
  'הגמעה': { bg: '#D6E9FF', border: '#3B82F6', label: 'הגמעה' },
  'פיזור מועילים': { bg: '#DFF5E5', border: '#168A55', label: 'פיזור מועילים' },
};

export default function TreatmentsPage() {
  const app = useApp();
  const [treatments, setTreatments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('calendar');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [inset, setInset] = useState(null);

  useEffect(() => {
    app.api.get('ריסוסים', '?maxRecords=500')
      .then((d) => setTreatments(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // פירוק תאריכי טווח (16/07/2026-23/07/2026) לאירועים מרובי ימים
  const events = useMemo(() => {
    const evts = [];
    treatments.forEach((t) => {
      const ds = t['תאריך'];
      if (!ds) return;
      let dates = [];
      // טווח
      if (typeof ds === 'string' && ds.includes('-')) {
        const parts = ds.split('-').filter(Boolean);
        if (parts.length === 2) {
          const start = parseDate(parts[0]);
          const end = parseDate(parts[1]);
          if (start && end) {
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              dates.push(new Date(d));
            }
          }
        }
      } else {
        // יום בודד
        const d = parseDate(ds);
        if (d) dates.push(d);
      }
      dates.forEach((d) => {
        const key = dateKey(d);
        evts.push({
          date: d,
          dateKey: key,
          id: t.id,
          material: displayName(t['חומר ריסוס'], 'טיפול'),
          structure: displayName(t['מבנה']),
          dosage: safeValue(t['מינון']),
          type: inferType(t),
          raw: t,
        });
      });
    });
    return evts;
  }, [treatments]);

  const now = new Date();
  const today = dateKey(now);

  const prevMonth = () => { if (month === 0) { setYear(year - 1); setMonth(11); } else { setMonth(month - 1); } };
  const nextMonth = () => { if (month === 11) { setYear(year + 1); setMonth(0); } else { setMonth(month + 1); } };

  // אירועים בחודש זה
  const monthEvents = events.filter((e) => e.date.getFullYear() === year && e.date.getMonth() === month);

  return (
    <div>
      <div className="page-header"><h2>תכנון טיפולים</h2></div>

      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={`tab ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>📋 לוח שנה</button>
        <button className={`tab ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>🗓️ שבוע</button>
        <button className={`tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>📄 רשימה</button>
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : view === 'calendar' ? (
        <div>
          <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <button className="btn btn-ghost btn-sm" onClick={prevMonth}>◀</button>
              <b style={{ fontSize: 16 }}>{MONTHS[month]} {year}</b>
              <button className="btn btn-ghost btn-sm" onClick={nextMonth}>▶</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontWeight: 700, marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              {DAYS.map((d) => <div key={d}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
              {buildGrid(year, month).map((cell, i) => {
                const ev = cell.date ? monthEvents.filter((e) => e.dateKey === dateKey(cell.date)) : [];
                const isToday = cell.date && dateKey(cell.date) === today;
                const isSelected = cell.date && selectedDate && dateKey(cell.date) === dateKey(selectedDate);
                return (
                  <div
                    key={i}
                    onClick={() => { setSelectedDate(cell.date || null); if (ev.length) setInset(ev); else setInset(null); }}
                    style={{
                      aspectRatio: '1', minHeight: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 8, cursor: cell.date ? 'pointer' : 'default',
                      background: isSelected ? 'var(--accent-top)' : isToday ? '#FFF9DB' : 'transparent',
                      color: isSelected ? '#fff' : (cell.otherMonth ? 'var(--text-muted)' : 'var(--text-main)'),
                      border: isToday && !isSelected ? '2px solid #F59E0B' : 'none',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: isToday ? 800 : 500 }}>{cell.label}</span>
                    {ev.length > 0 && <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>{ev.slice(0, 4).map((e) => <div key={e.id} style={{ width: 6, height: 6, borderRadius: '50%', background: getColor(e.type).border }} />)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          {inset && <EventDrawer events={inset} onClose={() => setInset(null)} />}
        </div>
      ) : view === 'week' ? (
        <WeekView events={events} today={today} />
      ) : (
        <ListView events={events} />
      )}
    </div>
  );
}

// ---------- View: Week ----------
function WeekView({ events, today }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() + weekOffset * 7 - startOfWeek.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const dayEvents = events.filter((e) => e.dateKey === key);
    return { date: d, key, events: dayEvents, isToday: key === today };
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center', marginBottom: 18 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(weekOffset - 1)}>◀</button>
        <b>שבוע {weekOffset === 0 ? 'נוכחי' : `+${weekOffset}`}</b>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(weekOffset + 1)}>▶</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setWeekOffset(0)}>היום</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {days.map((d) => (
          <div key={d.key} className="card" style={{ padding: '10px 8px', minHeight: 100, background: d.isToday ? '#FFF9DB' : 'var(--card-bg)' }}>
            <div style={{ fontWeight: 700, fontSize: 12, textAlign: 'center', marginBottom: 6, color: d.isToday ? '#F59E0B' : 'var(--text-main)' }}>
              {DAYS[d.date.getDay()]}<br />{d.date.getDate()}/{d.date.getMonth() + 1}
            </div>
            {d.events.slice(0, 6).map((e) => {
              const c = getColor(e.type);
              return (
                <div key={e.id} style={{ fontSize: 10, padding: '3px 4px', marginBottom: 3, borderRadius: 4, background: c.bg, border: `1px solid ${c.border}` }}>
                  <div style={{ fontWeight: 600 }}>{e.material}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{e.structure}</div>
                </div>
              );
            })}
            {d.events.length > 6 && <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>+{d.events.length - 6} עוד</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- View: List ----------
function ListView({ events }) {
  const today = dateKey(new Date());
  const sorted = [...events].sort((a, b) => a.date - b.date);
  const [macro, setMacro] = useState(100);
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>תאריך</th><th>סוג טיפול</th><th>מבנה</th><th>חומר</th><th>מינון</th></tr></thead>
          <tbody>
            {sorted.slice(0, macro).map((e) => {
              const c = getColor(e.type);
              const isActive = e.dateKey === today;
              return (
                <tr key={eventKey(e)} style={{ background: isActive ? '#FFF9DB' : 'transparent', borderRight: isActive ? `4px solid #F59E0B` : 'none' }}>
                  <td><b>{formatDate(e.date)}</b>{isActive && <span className="badge badge-warn" style={{ fontSize: 10, marginRight: 6 }}>היום</span>}</td>
                  <td><span className="badge" style={{ background: c.bg, color: c.border, border: `1px solid ${c.border}` }}>{c.label}</span></td>
                  <td>{e.structure}</td>
                  <td>{e.material}</td>
                  <td>{e.dosage}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > macro && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setMacro(macro + 100)}>טען עוד ({sorted.length - macro} נותרו)</button>
        </div>
      )}
    </div>
  );
}

// ---------- Event Drawer ----------
function EventDrawer({ events, onClose }) {
  const unique = events.filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>טיפולים — {formatDate(events[0]?.date)}</span>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {unique.map((e) => {
            const c = getColor(e.type);
            return (
              <div key={e.id} className="card" style={{ marginBottom: 12, background: c.bg, border: `1px solid ${c.border}` }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>🧴 {e.material}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <div>מבנה: {e.structure}</div>
                  <div>מינון: {e.dosage}</div>
                  <div>סוג: {c.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Helpers ----------
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  // DD/MM/YYYY
  const parts = String(v).split('/');
  if (parts.length === 3) {
    const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKey(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildGrid(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay();
  const days = [];
  const prevMonth = new Date(year, month, 0);
  for (let i = startDay - 1; i >= 0; i--) {
    days.push({ label: prevMonth.getDate() - i, date: null, otherMonth: true });
  }
  for (let i = 1; i <= last.getDate(); i++) {
    days.push({ label: i, date: new Date(year, month, i), otherMonth: false });
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push({ label: i, date: null, otherMonth: true });
  }
  return days;
}

function inferType(t) {
  const tag = String(t['סוג טיפול'] || t['סוג מרסס'] || t['בסיס מינון'] || '').toLowerCase();
  if (tag.includes('ריסוס')) return 'ריסוס';
  if (tag.includes('הגמעה')) return 'הגמעה';
  if (tag.includes('מועיל')) return 'פיזור מועילים';
  return 'ריסוס';
}

function getColor(type) {
  return TYPE_COLORS[type] || { bg: '#E8F1FF', border: '#3B82F6', label: 'אחר' };
}

function eventKey(e) {
  return `${e.id}-${e.dateKey}`;
}
