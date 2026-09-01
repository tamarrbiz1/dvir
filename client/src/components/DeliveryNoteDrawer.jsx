// ============================================================
// מגירת תעודת משלוח — כרטיס מלא עם ניווט עמוק (סעיף 29 + כללי אובייקטים)
// ------------------------------------------------------------
// הכרטיס מציג: פרטים עסקיים (בלי שדות ריקים/טכניים), המסמך המצורף,
// פירוק "סיכום יומי" (יום → זנים → משלוחים) וחמשת הגרפים שבאיפיון.
// כל אובייקט מקושר (משווק / מבנה / שבוע) לחיץ ונפתח בתוך אותה מגירה
// עם Breadcrumb וכפתור "חזרה" — המשתמש לא יוצא מהמסך אלא אם בחר
// במפורש "פתח עמוד מלא".
//
// שימוש:
//   <DeliveryNoteDrawer note={n} notes={allNotes} api={app.api} onClose={...}
//                       canEdit={isOwner} onEdit={(note) => ...} />
//   אפשר לפתוח ישירות על אובייקט מקושר: initial={{ kind: 'marketer', id, name }}
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import { formatNumber, formatDate, formatWeight, formatPercent } from '../utils/format.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import {
  noteNumber, noteDate, noteUploadDate, noteCartons, noteWeight, noteAvg, noteDeviation, noteCheck,
  noteWeekCode, noteWeekLink, noteStructure, noteMarketer, noteDocument, isWeightAnomaly,
  parseDailySummary, notesOfMarketer, notesOfStructure, notesOfWeek, shortDate,
} from '../utils/deliveryNotes.js';

const PIE = ['#2878D0', '#09A7B2', '#8B5CF6', '#F59E0B', '#F04444', '#10A66A', '#6366F1'];

// ------------------------------------------------------------
// עטיפה: מחסנית אובייקטים + Breadcrumb
// ------------------------------------------------------------
export default function DeliveryNoteDrawer({ note, notes = [], api, onClose, canEdit = false, onEdit, onDelete, initial = null }) {
  const [stack, setStack] = useState(() => {
    const base = note ? [{ kind: 'note', note }] : [];
    return initial ? [...base, initial] : base;
  });

  // אם התעודה עודכנה (אחרי עריכה) — מרעננים את הרשומה שבמחסנית
  useEffect(() => {
    if (!note) return;
    setStack((s) => s.map((e) => (e.kind === 'note' && e.note?.id === note.id ? { ...e, note } : e)));
  }, [note]);

  const top = stack[stack.length - 1];
  const push = (entry) => setStack((s) => [...s, entry]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const back = stack.length > 1 ? pop : onClose;
  useEscapeClose(back);

  if (!top) return null;

  const crumbs = stack.map(entryLabel);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer stru-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={crumbs[crumbs.length - 1]}>
        <div className="drawer-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {stack.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={pop} aria-label="חזרה לאובייקט הקודם">→ חזרה</button>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{crumbs[crumbs.length - 1]}</span>
          </span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>

        {stack.length > 1 && (
          <nav className="crumbs" aria-label="מסלול ניווט">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span aria-hidden="true" className="crumb-sep">›</span>}
                {i < crumbs.length - 1
                  ? <button type="button" className="crumb-link" onClick={() => setStack((s) => s.slice(0, i + 1))}>{c}</button>
                  : <b>{c}</b>}
              </span>
            ))}
          </nav>
        )}

        <div className="drawer-body">
          {top.kind === 'note' && <NotePanel note={top.note} push={push} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />}
          {top.kind === 'marketer' && <MarketerPanel entry={top} notes={notes} api={api} push={push} />}
          {top.kind === 'structure' && <StructurePanel entry={top} notes={notes} api={api} push={push} />}
          {top.kind === 'week' && <WeekPanel entry={top} notes={notes} push={push} />}
        </div>
      </div>
    </div>
  );
}

function entryLabel(e) {
  if (e.kind === 'note') return `תעודת משלוח ${noteNumber(e.note) ?? ''}`.trim();
  if (e.kind === 'marketer') return e.name || 'משווק';
  if (e.kind === 'structure') return e.name || 'מבנה';
  if (e.kind === 'week') return `שבוע ${e.code || ''}`.trim();
  return '';
}

// ------------------------------------------------------------
// Chip של אובייקט מקושר — לחיץ כשיש לאן לנווט
// ------------------------------------------------------------
export function ObjChip({ icon, label, onClick, title }) {
  if (!label) return <span style={{ color: 'var(--text-muted)' }}>לא זמין</span>;
  if (!onClick) return <span className="obj-chip static">{icon} {label}</span>;
  return (
    <span className="obj-chip" {...activatable((e) => { e.stopPropagation(); onClick(); }, title || `פתיחת ${label}`)}>
      {icon} {label}
    </span>
  );
}

function Row({ l, v }) {
  if (v === null || v === undefined || v === '' || v === '—') return null; // אין להציג שדות ריקים
  return (
    <div className="obj-row">
      <span className="obj-row-label">{l}</span>
      <span className="obj-row-value">{v}</span>
    </div>
  );
}

export function CheckBadge({ note }) {
  const c = noteCheck(note);
  if (!c) return <span className="badge badge-warn">לא זמין</span>;
  return <span className={`badge ${isWeightAnomaly(note) ? 'badge-error' : 'badge-ok'}`}>{String(c)}</span>;
}

// ------------------------------------------------------------
// כרטיס התעודה
// ------------------------------------------------------------
function NotePanel({ note, push, canEdit, onEdit, onDelete }) {
  const navigate = useNavigate();
  const daily = useMemo(() => parseDailySummary(note['סיכום יומי']), [note]);
  const marketer = noteMarketer(note);
  const structure = noteStructure(note);
  const weekCode = noteWeekCode(note);
  const weekLink = noteWeekLink(note);
  const doc = noteDocument(note);
  const cartons = noteCartons(note);
  const weight = noteWeight(note);
  const avg = noteAvg(note);
  const dev = noteDeviation(note);
  const [openDays, setOpenDays] = useState(() => new Set(daily.days.length === 1 ? [0] : []));
  const toggleDay = (i) => setOpenDays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const kpis = [
    { l: 'קרטונים', v: cartons === null ? 'לא זמין' : formatNumber(cartons), c: 'var(--cartons)' },
    { l: 'משקל', v: weight === null ? 'לא זמין' : formatWeight(weight), c: 'var(--weight)' },
    { l: 'ק"ג לקרטון', v: avg === null ? 'לא זמין' : formatNumber(avg, 2), c: 'var(--text-main)' },
    { l: 'משטחים', v: daily.totals.pallets ? formatNumber(daily.totals.pallets) : 'לא זמין', c: 'var(--pallets)' },
  ];

  const daysChart = daily.days.map((d) => ({ label: shortDate(d.date), משקל: Math.round(d.weight), קרטונים: Math.round(d.cartons), משטחים: Math.round(d.pallets) }));
  const pie = (key) => daily.products.map((p) => ({ name: p.variety, value: Math.round(p[key]) })).filter((x) => x.value > 0);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        {kpis.map((k) => (
          <div key={k.l} className="kpi-card" style={{ padding: '14px 14px 0' }}>
            <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{k.l}</span></div>
            <div className="kpi-value" style={{ fontSize: 17, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>פרטים</span>
          {canEdit && onEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(note)} aria-label="עריכת התעודה">✎ עריכה</button>}
          {canEdit && onDelete && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }} onClick={() => onDelete(note)} aria-label="מחיקת התעודה">🗑 מחיקה</button>}
        </div>
        <Row l="תאריך תעודה" v={noteDate(note) ? formatDate(noteDate(note)) : null} />
        <Row l="משווק" v={marketer ? <ObjChip icon="🚚" label={marketer.name} onClick={marketer.id ? () => push({ kind: 'marketer', id: marketer.id, name: marketer.name }) : null} /> : null} />
        <Row l="מבנה" v={structure ? <ObjChip icon="🏗️" label={structure.name} onClick={structure.id ? () => push({ kind: 'structure', id: structure.id, name: structure.name }) : null} /> : null} />
        <Row l="שבוע" v={weekCode ? <ObjChip icon="📆" label={weekCode} onClick={() => push({ kind: 'week', code: weekCode, id: weekLink?.id || null })} /> : null} />
        <Row l="סטיית משקל" v={dev === null ? null : formatPercent(dev)} />
        <Row l="בדיקת משקל" v={noteCheck(note) ? <CheckBadge note={note} /> : null} />
        <Row l="הועלה בתאריך" v={noteUploadDate(note) ? formatDate(noteUploadDate(note)) : null} />
      </div>

      {/* המסמך */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>מסמך</div>
        {doc ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {doc.thumb && (
              <a href={doc.url} target="_blank" rel="noopener noreferrer" aria-label="פתיחת המסמך בחלון חדש">
                <img src={doc.thumb} alt={`תצוגה מקדימה: ${doc.filename}`} style={{ width: 96, borderRadius: 8, border: '1px solid var(--border)' }} />
              </a>
            )}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 600 }}>{doc.isPdf ? '📄' : '🖼️'} {doc.filename}</div>
              {doc.size && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatNumber(Math.round(doc.size / 1024))} KB</div>}
              <a className="btn btn-primary btn-sm" style={{ marginTop: 10, display: 'inline-block' }} href={doc.url} target="_blank" rel="noopener noreferrer">פתח מסמך</a>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '14px 0' }}>
            לא צורף קובץ לתעודה זו.{' '}
            <button type="button" className="crumb-link" onClick={() => navigate('/upload')}>העלאת מסמך</button>
          </div>
        )}
      </div>

      {/* סיכום יומי: יום → זנים → משלוחים */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>סיכום יומי</div>
        {daily.days.length === 0 && daily.products.length === 0 ? (
          <div className="empty-state" style={{ padding: '14px 0' }}>אין פירוט יומי לתעודה זו</div>
        ) : (
          <>
            {daily.days.length > 0 && (
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th style={{ width: 28 }} /><th>יום</th><th>קרטונים</th><th>משקל</th><th>משטחים</th><th>משלוחים</th></tr></thead>
                  <tbody>
                    {daily.days.map((d, i) => {
                      const open = openDays.has(i);
                      return [
                        <tr key={`d${i}`} onClick={() => toggleDay(i)} aria-expanded={open} style={{ cursor: 'pointer' }}>
                          <td style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '◂'}</td>
                          <td><b>{formatDate(d.date)}</b></td>
                          <td>{formatNumber(d.cartons)}</td>
                          <td>{formatWeight(d.weight)}</td>
                          <td>{d.pallets ? formatNumber(d.pallets) : '—'}</td>
                          <td>{d.shipments.length || '—'}</td>
                        </tr>,
                        open && (
                          <tr key={`x${i}`} className="day-detail">
                            <td colSpan={6}>
                              {d.products.length > 0 && (
                                <>
                                  <div className="sub-title">זנים</div>
                                  <table className="data-table nested">
                                    <thead><tr><th>זן</th><th>קרטונים</th><th>משקל</th><th>משטחים</th></tr></thead>
                                    <tbody>
                                      {d.products.map((p, j) => (
                                        <tr key={j}><td>{p.variety}</td><td>{formatNumber(p.cartons)}</td><td>{formatWeight(p.weight)}</td><td>{p.pallets ? formatNumber(p.pallets) : '—'}</td></tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </>
                              )}
                              {d.shipments.length > 0 ? (
                                <>
                                  <div className="sub-title">משלוחים</div>
                                  <table className="data-table nested">
                                    <thead><tr><th>מס' משלוח</th><th>זן</th><th>קרטונים</th><th>משקל</th><th>משטחים</th></tr></thead>
                                    <tbody>
                                      {d.shipments.map((s, j) => (
                                        <tr key={j}><td>{s.number || '—'}</td><td>{s.variety || '—'}</td><td>{formatNumber(s.cartons)}</td><td>{formatWeight(s.weight)}</td><td>{s.pallets ? formatNumber(s.pallets) : '—'}</td></tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </>
                              ) : (
                                !d.products.length && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>אין פירוט משלוחים ליום זה</div>
                              )}
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {daysChart.length > 0 && (
              <div className="chart-pair">
                <div>
                  <div className="section-title">משקל לפי יום</div>
                  <div style={{ direction: 'ltr' }}>
                    <ResponsiveContainer width="100%" height={170}>
                      <BarChart data={daysChart} margin={CHART_MARGIN_ROTATED}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="label" {...xAxisProps(daysChart.length, { rotate: daysChart.length > 7 })} />
                        <YAxis {...yAxisProps()} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatWeight(v)} />
                        <Bar dataKey="משקל" fill="#2878D0" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <div className="section-title">קרטונים לפי יום</div>
                  <div style={{ direction: 'ltr' }}>
                    <ResponsiveContainer width="100%" height={170}>
                      <BarChart data={daysChart} margin={CHART_MARGIN_ROTATED}>
                        <CartesianGrid {...GRID_PROPS} />
                        <XAxis dataKey="label" {...xAxisProps(daysChart.length, { rotate: daysChart.length > 7 })} />
                        <YAxis {...yAxisProps()} />
                        <Tooltip {...TOOLTIP_STYLE} />
                        <Bar dataKey="קרטונים" fill="#09A7B2" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {daily.products.length > 0 && (
              <>
                <PieBlock title="משקל לפי זן" data={pie('weight')} fmt={(v) => formatWeight(v)} />
                <PieBlock title="קרטונים לפי זן" data={pie('cartons')} fmt={(v) => formatNumber(v)} />
                <PieBlock title="משטחים לפי זן" data={pie('pallets')} fmt={(v) => formatNumber(v)} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PieBlock({ title, data, fmt }) {
  return (
    <>
      <div className="section-title">{title}</div>
      {data.length ? (
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65}>
              {data.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={fmt} />
            <Legend wrapperStyle={LEGEND_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      ) : <div className="empty-state" style={{ padding: '10px 0' }}>אין נתונים</div>}
    </>
  );
}

// ------------------------------------------------------------
// רשימת תעודות בתוך כרטיס אובייקט (משווק / מבנה / שבוע)
// ------------------------------------------------------------
function NotesMiniTable({ list, push, empty = 'אין תעודות משלוח' }) {
  if (!list.length) return <div className="empty-state" style={{ padding: '14px 0' }}>{empty}</div>;
  const sorted = [...list].sort((a, b) => (new Date(noteDate(b) || 0)) - (new Date(noteDate(a) || 0)));
  return (
    <div className="table-wrap">
      <table className="data-table compact">
        <thead><tr><th>מס'</th><th>תאריך</th><th>משווק</th><th>קרטונים</th><th>משקל</th><th>בדיקה</th></tr></thead>
        <tbody>
          {sorted.map((n) => (
            <tr key={n.id} {...activatable(() => push({ kind: 'note', note: n }), `פתיחת תעודה ${noteNumber(n) ?? ''}`)}>
              <td>{noteNumber(n) ?? '—'}</td>
              <td>{noteDate(n) ? formatDate(noteDate(n)) : 'לא זמין'}</td>
              <td>{noteMarketer(n)?.name || 'לא זמין'}</td>
              <td>{noteCartons(n) === null ? 'לא זמין' : formatNumber(noteCartons(n))}</td>
              <td>{noteWeight(n) === null ? 'לא זמין' : formatWeight(noteWeight(n))}</td>
              <td><CheckBadge note={n} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ list }) {
  const cartons = list.reduce((s, n) => s + (noteCartons(n) ?? 0), 0);
  const weight = list.reduce((s, n) => s + (noteWeight(n) ?? 0), 0);
  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
      <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>תעודות</span></div><div className="kpi-value" style={{ fontSize: 17 }}>{list.length}</div></div>
      <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>קרטונים</span></div><div className="kpi-value" style={{ fontSize: 17, color: 'var(--cartons)' }}>{list.length ? formatNumber(cartons) : 'אין נתונים'}</div></div>
      <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>משקל</span></div><div className="kpi-value" style={{ fontSize: 17, color: 'var(--weight)' }}>{list.length ? formatWeight(weight) : 'אין נתונים'}</div></div>
    </div>
  );
}

// טוען רשומה בודדת לפי מזהה (ללא שדות טכניים בתצוגה)
function useRecord(api, table, id) {
  const [rec, setRec] = useState(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let alive = true;
    if (!api || !id) { setState('error'); return undefined; }
    setState('loading');
    api.get(table, `/${id}`)
      .then((r) => { if (alive) { setRec(r); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [api, table, id]);
  return { rec, state };
}

// ------------------------------------------------------------
// כרטיס משווק (סעיף 27): פרטים · חשבוניות · תעודות משלוח
// ------------------------------------------------------------
function MarketerPanel({ entry, notes, api, push }) {
  const navigate = useNavigate();
  const { rec, state } = useRecord(api, 'משווקים', entry.id);
  const list = notesOfMarketer(notes, entry.id);
  const invoicesCount = Array.isArray(rec?.['חשבוניות']) ? rec['חשבוניות'].length : null;
  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>🚚 {entry.name || rec?.['שם משווק'] || 'משווק'}</div>
        {state === 'loading' && <div className="skeleton" style={{ height: 60 }} />}
        {state === 'ok' && (
          <>
            <Row l="איש קשר" v={rec['איש קשר']} />
            <Row l="טלפון" v={rec['טלפון']} />
            <Row l="אימייל" v={rec['אימייל']} />
            <Row l="כתובת" v={rec['כתובת']} />
            <Row l="תנאי תשלום" v={rec['תנאי תשלום']} />
            <Row l="חשבוניות" v={invoicesCount === null ? null : formatNumber(invoicesCount)} />
            <Row l="הערות" v={rec['הערות']} />
          </>
        )}
        {state === 'error' && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>פרטי המשווק אינם זמינים כרגע</div>}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/finance', { state: { tab: 'משווקים' } })}>פתח עמוד מלא (כספים › משווקים)</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/delivery-notes?marketer=${encodeURIComponent(entry.id)}`)}>כל התעודות של המשווק</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>תעודות משלוח</div>
        <Totals list={list} />
        <div style={{ marginTop: 12 }}><NotesMiniTable list={list} push={push} empty="אין תעודות משלוח למשווק זה" /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// כרטיס מבנה מקוצר + התעודות שלו
// ------------------------------------------------------------
function StructurePanel({ entry, notes, api, push }) {
  const navigate = useNavigate();
  const { rec, state } = useRecord(api, 'מבנים', entry.id);
  const list = notesOfStructure(notes, entry.id);
  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>🏗️ {entry.name || 'מבנה'}</div>
        {state === 'loading' && <div className="skeleton" style={{ height: 60 }} />}
        {state === 'ok' && (
          <>
            <Row l="סוג מבנה" v={rec['סוג מבנה']} />
            <Row l="סטטוס" v={rec['סטטוס המבנה']} />
            <Row l="שטח" v={rec['שטח בדונם'] != null ? `${formatNumber(rec['שטח בדונם'])} דונם` : null} />
            <Row l="סוג כיסוי" v={rec['סוג כיסוי']} />
            <Row l="גידול" v={Array.isArray(rec['סוג גידול (from תוכניות שתילה)']) ? rec['סוג גידול (from תוכניות שתילה)'].filter(Boolean).join(', ') : null} />
          </>
        )}
        {state === 'error' && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>פרטי המבנה אינם זמינים כרגע</div>}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/structures', { state: { openStructure: { id: entry.id, ...(rec || {}) } } })}>פתח עמוד מלא</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>תעודות משלוח של המבנה</div>
        <Totals list={list} />
        <div style={{ marginTop: 12 }}><NotesMiniTable list={list} push={push} empty="אין תעודות משלוח משויכות למבנה זה" /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// כרטיס שבוע מקוצר + התעודות שלו
// ------------------------------------------------------------
function WeekPanel({ entry, notes, push }) {
  const navigate = useNavigate();
  const list = notesOfWeek(notes, entry.code || '');
  const range = weekRange(entry.code);
  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>📆 שבוע {entry.code}</div>
        <Row l="מתאריך" v={range?.from ? formatDate(range.from) : null} />
        <Row l="עד תאריך" v={range?.to ? formatDate(range.to) : null} />
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/weekly?week=${encodeURIComponent(entry.code || '')}`)}>פתח בסיכום השבועי</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>תעודות משלוח בשבוע</div>
        <Totals list={list} />
        <div style={{ marginTop: 12 }}><NotesMiniTable list={list} push={push} empty="אין תעודות משלוח לשבוע זה" /></div>
      </div>
    </div>
  );
}

// קוד שבוע YYYYMMDD-YYYYMMDD → טווח תאריכים
function weekRange(code) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/.exec(String(code || ''));
  if (!m) return null;
  return { from: `${m[1]}-${m[2]}-${m[3]}`, to: `${m[4]}-${m[5]}-${m[6]}` };
}
