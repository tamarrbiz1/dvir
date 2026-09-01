// ============================================================
// תעודות משלוח (סעיף 29 + סעיף 47 טבלאות + כללי אובייקטים)
// ------------------------------------------------------------
// טבלה ראשית: חיפוש · פילטרים (משווק / שבוע / בדיקת משקל) · סינון תאריך ·
// מיון בלחיצה על כותרת · עימוד · הדפסה · ייצוא CSV.
// עמודות לפי האיפיון: תאריך · משווק · מבנה · קרטונים · משקל · ק"ג לקרטון ·
// סטיית משקל · בדיקת משקל · מסמך (+ מס' תעודה וקוד שבוע לחיפוש).
// לחיצה על שורה פותחת את כרטיס התעודה; לחיצה על משווק/מבנה/שבוע
// פותחת את האובייקט המקושר בתוך אותה מגירה.
//
// פרמטרי URL נתמכים (למעבר ממסכים אחרים):
//   ?open=<recId>  ?marketer=<recId>  ?structure=<recId>  ?week=<קוד שבוע>
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatNumber, formatDate, formatWeight, formatPercent } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import DeliveryNoteDrawer, { ObjChip, CheckBadge } from '../components/DeliveryNoteDrawer.jsx';
import { activatable } from '../utils/a11y.js';
import { exportCsv, fileStamp, inDateRange, paginate, sortRows, dateValue } from '../utils/table.js';
import {
  DELIVERY_TABLE, noteNumber, noteDate, noteCartons, noteWeight, noteAvg, noteDeviation, noteCheck,
  noteWeekCode, noteStructure, noteMarketer, noteDocument, isWeightAnomaly, linkedTo,
} from '../utils/deliveryNotes.js';

const PAGE_SIZES = [25, 50, 100];

// מפתחות מיון → פונקציית ערך
const SORTERS = {
  number: (n) => noteNumber(n) ?? null,
  date: (n) => dateValue(noteDate(n)),
  marketer: (n) => noteMarketer(n)?.name || null,
  structure: (n) => noteStructure(n)?.name || null,
  week: (n) => noteWeekCode(n),
  cartons: noteCartons,
  weight: noteWeight,
  avg: noteAvg,
  dev: noteDeviation,
  check: (n) => noteCheck(n) || null,
};

const EDIT_FIELDS = [
  { name: 'תאריך תעודה', label: 'תאריך תעודה', type: 'date' },
  { name: 'כמות קרטונים', label: 'כמות קרטונים', type: 'text' },
  { name: 'משקל כולל', label: 'משקל כולל (ק"ג)', type: 'text' },
  { name: 'קוד שבוע', label: 'קוד שבוע (YYYYMMDD-YYYYMMDD)', type: 'text' },
];

export default function DeliveryNotesPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canEdit = (app.user?.role || 'owner') === 'owner';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // פילטרים
  const [search, setSearch] = useState('');
  const [marketerF, setMarketerF] = useState(params.get('marketer') || '');
  const [structureF, setStructureF] = useState(params.get('structure') || '');
  const [weekF, setWeekF] = useState(params.get('week') || '');
  const [checkF, setCheckF] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // מיון / עימוד
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [printing, setPrinting] = useState(false);

  // מגירה / עריכה
  const [drawer, setDrawer] = useState(null); // { note, initial? }
  const [form, setForm] = useState(null);

  const load = () => app.api.get(DELIVERY_TABLE, '?maxRecords=1000')
    .then((d) => { setItems(Array.isArray(d) ? d : []); setError(''); })
    .catch((e) => setError(e.message || 'שגיאה בטעינת תעודות המשלוח'));

  useEffect(() => { load().finally(() => setLoading(false)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // פתיחה ישירה של תעודה מתוך URL (?open=recId) — פעם אחת אחרי הטעינה
  useEffect(() => {
    const id = params.get('open');
    if (!id || !items.length) return;
    const n = items.find((x) => x.id === id);
    if (n) setDrawer({ note: n });
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // בהדפסה מציגים את כל השורות המסוננות, לא רק את העמוד הנוכחי
  useEffect(() => {
    const on = () => setPrinting(true);
    const off = () => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => { window.removeEventListener('beforeprint', on); window.removeEventListener('afterprint', off); };
  }, []);

  // אפשרויות לפילטרים — נגזרות מהנתונים עצמם
  const marketers = useMemo(() => {
    const m = new Map();
    items.forEach((n) => { const mk = noteMarketer(n); if (mk?.id) m.set(mk.id, mk.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  }, [items]);
  const structures = useMemo(() => {
    const m = new Map();
    items.forEach((n) => { const s = noteStructure(n); if (s?.id) m.set(s.id, s.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  }, [items]);
  const weeks = useMemo(() => [...new Set(items.map(noteWeekCode).filter(Boolean))].sort().reverse(), [items]);
  const checks = useMemo(() => [...new Set(items.map(noteCheck).filter(Boolean).map(String))], [items]);

  // סינון (החיפוש עובד יחד עם הפילטרים, לא במקומם)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      if (marketerF && !linkedTo(n, 'משווק', marketerF)) return false;
      if (structureF && !linkedTo(n, 'מבנה', structureF)) return false;
      if (weekF && noteWeekCode(n) !== weekF) return false;
      if (checkF === '__anomaly' ? !isWeightAnomaly(n) : (checkF && String(noteCheck(n) || '') !== checkF)) return false;
      if (!inDateRange(noteDate(n), from, to)) return false;
      if (q) {
        const hay = [noteNumber(n), noteMarketer(n)?.name, noteStructure(n)?.name, noteWeekCode(n), noteDocument(n)?.filename]
          .filter((x) => x !== null && x !== undefined).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, marketerF, structureF, weekF, checkF, from, to]);

  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir, SORTERS), [filtered, sort]);
  const paged = useMemo(() => paginate(sorted, page, printing ? Math.max(sorted.length, 1) : pageSize), [sorted, page, pageSize, printing]);

  // KPI על הנתונים המסוננים
  const kpi = useMemo(() => {
    const withC = filtered.map(noteCartons).filter((v) => v !== null);
    const withW = filtered.map(noteWeight).filter((v) => v !== null);
    const withA = filtered.map(noteAvg).filter((v) => v !== null);
    return {
      count: filtered.length,
      cartons: withC.length ? withC.reduce((s, v) => s + v, 0) : null,
      weight: withW.length ? withW.reduce((s, v) => s + v, 0) : null,
      avg: withA.length ? withA.reduce((s, v) => s + v, 0) / withA.length : null,
      anomalies: filtered.filter(isWeightAnomaly).length,
      missingDoc: filtered.filter((n) => !noteDocument(n)).length,
    };
  }, [filtered]);

  const hasFilters = search || marketerF || structureF || weekF || checkF || from || to;
  const resetFilters = () => {
    setSearch(''); setMarketerF(''); setStructureF(''); setWeekF(''); setCheckF(''); setFrom(''); setTo(''); setPage(1);
    setParams({}, { replace: true });
  };
  const changeSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' }));
    setPage(1);
  };
  useEffect(() => { setPage(1); }, [search, marketerF, structureF, weekF, checkF, from, to, pageSize]);

  const doExport = () => exportCsv(`תעודות-משלוח-${fileStamp()}`, [
    { label: 'מספר תעודה', get: (n) => noteNumber(n) ?? '' },
    { label: 'תאריך', get: (n) => (noteDate(n) ? formatDate(noteDate(n)) : '') },
    { label: 'משווק', get: (n) => noteMarketer(n)?.name || '' },
    { label: 'מבנה', get: (n) => noteStructure(n)?.name || '' },
    { label: 'קוד שבוע', get: (n) => noteWeekCode(n) || '' },
    { label: 'קרטונים', get: (n) => noteCartons(n) ?? '' },
    { label: 'משקל (ק"ג)', get: (n) => noteWeight(n) ?? '' },
    { label: 'ק"ג לקרטון', get: (n) => (noteAvg(n) === null ? '' : Math.round(noteAvg(n) * 100) / 100) },
    { label: 'סטיית משקל (%)', get: (n) => (noteDeviation(n) === null ? '' : Math.round(noteDeviation(n) * 1000) / 10) },
    { label: 'בדיקת משקל', get: (n) => noteCheck(n) || '' },
    { label: 'מסמך', get: (n) => noteDocument(n)?.filename || '' },
  ], sorted);

  const openObject = (note, initial) => setDrawer({ note, initial });

  const Th = ({ k, children, numeric }) => {
    const active = sort.key === k;
    return (
      <th
        className={`sortable ${active ? 'active' : ''}`}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        style={numeric ? { textAlign: 'right' } : undefined}
      >
        <button type="button" className="th-btn" onClick={() => changeSort(k)}>
          {children} <span className="sort-ind" aria-hidden="true">{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="delivery-page">
      <PageHeader icon="📄" title="תעודות משלוח">
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()} aria-label="הדפסת הרשימה המוצגת">🖨️ הדפסה</button>
        <button type="button" className="btn btn-ghost no-print" onClick={doExport} disabled={!sorted.length} aria-label="ייצוא הרשימה המוצגת לקובץ CSV">⬇️ ייצוא</button>
        <button type="button" className="btn btn-primary no-print" onClick={() => navigate('/upload', { state: { docType: 'תעודת משלוח' } })}>⬆️ העלאת תעודה</button>
      </PageHeader>

      {/* KPI */}
      <div className="kpi-grid">
        <Kpi icon="📄" soft="var(--docs-soft, #EAF3FC)" color="var(--docs, #4A90E2)" label="תעודות" value={formatNumber(kpi.count)} />
        <Kpi icon="📦" soft="var(--cartons-soft)" color="var(--cartons)" label='סה"כ קרטונים' value={kpi.cartons === null ? 'אין נתונים' : formatNumber(kpi.cartons)} />
        <Kpi icon="⚖️" soft="var(--weight-soft)" color="var(--weight)" label='סה"כ משקל' value={kpi.weight === null ? 'אין נתונים' : formatWeight(kpi.weight)} />
        <Kpi icon="📐" soft="var(--bg-secondary)" color="var(--text-main)" label='ק"ג לקרטון (ממוצע)' value={kpi.avg === null ? 'אין נתונים' : formatNumber(kpi.avg, 2)} />
        <Kpi icon="⚠️" soft={kpi.anomalies ? 'var(--expense-soft)' : 'var(--profit-soft)'} color={kpi.anomalies ? 'var(--expense)' : 'var(--profit)'} label="חריגות משקל" value={formatNumber(kpi.anomalies)} onClick={() => setCheckF(checkF === '__anomaly' ? '' : '__anomaly')} active={checkF === '__anomaly'} />
      </div>

      {/* סרגל סינון */}
      <div className="filter-bar no-print" role="search" aria-label="סינון תעודות משלוח">
        <input className="input" style={{ flex: '1 1 200px' }} aria-label="חיפוש תעודות" placeholder="חיפוש: משווק, קוד שבוע, מס' תעודה, שם קובץ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" aria-label="סינון לפי משווק" value={marketerF} onChange={(e) => setMarketerF(e.target.value)}>
          <option value="">כל המשווקים</option>
          {marketers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {structures.length > 0 && (
          <select className="select" aria-label="סינון לפי מבנה" value={structureF} onChange={(e) => setStructureF(e.target.value)}>
            <option value="">כל המבנים</option>
            {structures.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <select className="select" aria-label="סינון לפי שבוע" value={weekF} onChange={(e) => setWeekF(e.target.value)}>
          <option value="">כל השבועות</option>
          {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select className="select" aria-label="סינון לפי בדיקת משקל" value={checkF} onChange={(e) => setCheckF(e.target.value)}>
          <option value="">כל הבדיקות</option>
          <option value="__anomaly">חריגות בלבד</option>
          {checks.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="date-field"><span>מתאריך</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="מתאריך" /></label>
        <label className="date-field"><span>עד תאריך</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="עד תאריך" /></label>
        {hasFilters && <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>נקה סינון</button>}
      </div>

      {/* הטבלה */}
      <div className="card">
        {loading ? (
          <div className="skeleton skeleton-card" />
        ) : error ? (
          <div className="empty-state">⚠️ {error}</div>
        ) : items.length === 0 ? (
          <div className="empty-state"><div className="icon">📄</div>אין תעודות משלוח במערכת עדיין</div>
        ) : sorted.length === 0 ? (
          <div className="empty-state">אין תעודות משלוח התואמות לסינון</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <Th k="number">מס'</Th>
                    <Th k="date">תאריך</Th>
                    <Th k="marketer">משווק</Th>
                    <Th k="structure">מבנה</Th>
                    <Th k="week">שבוע</Th>
                    <Th k="cartons">קרטונים</Th>
                    <Th k="weight">משקל</Th>
                    <Th k="avg">ק"ג לקרטון</Th>
                    <Th k="dev">סטיית משקל</Th>
                    <Th k="check">בדיקת משקל</Th>
                    <th>מסמך</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((n) => {
                    const mk = noteMarketer(n);
                    const st = noteStructure(n);
                    const wk = noteWeekCode(n);
                    const doc = noteDocument(n);
                    const dev = noteDeviation(n);
                    return (
                      <tr key={n.id} {...activatable(() => openObject(n), `פתיחת תעודה ${noteNumber(n) ?? ''}`)}>
                        <td><b>{noteNumber(n) ?? '—'}</b></td>
                        <td>{noteDate(n) ? formatDate(noteDate(n)) : <span className="muted">לא זמין</span>}</td>
                        <td><ObjChip icon="🚚" label={mk?.name} onClick={mk?.id ? () => openObject(n, { kind: 'marketer', id: mk.id, name: mk.name }) : null} /></td>
                        <td><ObjChip icon="🏗️" label={st?.name} onClick={st?.id ? () => openObject(n, { kind: 'structure', id: st.id, name: st.name }) : null} /></td>
                        <td><ObjChip icon="📆" label={wk} onClick={wk ? () => openObject(n, { kind: 'week', code: wk }) : null} /></td>
                        <td>{noteCartons(n) === null ? <span className="muted">לא זמין</span> : formatNumber(noteCartons(n))}</td>
                        <td>{noteWeight(n) === null ? <span className="muted">לא זמין</span> : formatWeight(noteWeight(n))}</td>
                        <td>{noteAvg(n) === null ? <span className="muted">לא זמין</span> : formatNumber(noteAvg(n), 2)}</td>
                        <td>{dev === null ? <span className="muted">לא זמין</span> : <span style={{ color: isWeightAnomaly(n) ? 'var(--expense)' : undefined }}>{formatPercent(dev)}</span>}</td>
                        <td><CheckBadge note={n} /></td>
                        <td>
                          {doc ? (
                            <a className="doc-link" href={doc.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={doc.filename} aria-label={`פתיחת המסמך ${doc.filename}`}>
                              {doc.isPdf ? '📄' : '🖼️'} <span className="doc-name">{doc.filename}</span>
                            </a>
                          ) : <span className="badge badge-warn">חסר</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* עימוד */}
            <div className="pager no-print">
              <span className="pager-info">מציג {formatNumber(paged.start + 1)}–{formatNumber(paged.end)} מתוך {formatNumber(paged.total)}</span>
              <div className="pager-controls">
                <label>שורות בעמוד
                  <select className="select" style={{ minHeight: 34, padding: '4px 8px', minWidth: 70, marginRight: 6 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="שורות בעמוד">
                    {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-ghost btn-sm" disabled={paged.current <= 1} onClick={() => setPage(paged.current - 1)} aria-label="עמוד קודם">‹ הקודם</button>
                <span>עמוד {paged.current} מתוך {paged.pages}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={paged.current >= paged.pages} onClick={() => setPage(paged.current + 1)} aria-label="עמוד הבא">הבא ›</button>
              </div>
            </div>
          </>
        )}
      </div>

      {drawer && (
        <DeliveryNoteDrawer
          note={drawer.note}
          initial={drawer.initial || null}
          notes={items}
          api={app.api}
          canEdit={canEdit}
          onEdit={(n) => setForm(n)}
          onDelete={async (n) => {
            if (await removeRecord(app.api, DELIVERY_TABLE, n.id, `תעודת המשלוח ${noteNumber(n) ?? ''}`)) {
              setDrawer(null);
              await load();
            }
          }}
          onClose={() => setDrawer(null)}
        />
      )}

      {form && (
        <RecordForm
          api={app.api}
          table={DELIVERY_TABLE}
          title={`עריכת תעודת משלוח ${noteNumber(form) ?? ''}`}
          fields={EDIT_FIELDS}
          record={form}
          onClose={() => setForm(null)}
          onSaved={async () => {
            // הנתון מוצג רק אחרי שהתקבל מחדש מ-Airtable (ללא Optimistic UI)
            await load();
            setForm(null);
            setDrawer((d) => (d ? { ...d } : d));
          }}
        />
      )}
    </div>
  );
}

function Kpi({ icon, soft, color, label, value, onClick, active }) {
  const inner = (
    <>
      <div className="kpi-top"><div className="kpi-icon" style={{ background: soft }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color }}>{value}</div>
    </>
  );
  if (!onClick) return <div className="kpi-card">{inner}</div>;
  return (
    <div className={`kpi-card clickable ${active ? 'highlight' : ''}`} {...activatable(onClick, `סינון: ${label}`)} aria-pressed={active}>
      {inner}
    </div>
  );
}
