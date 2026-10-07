// ============================================================
// תעודות משלוח (סעיף 29 + סעיף 47 טבלאות + כללי אובייקטים)
// ------------------------------------------------------------
// טבלה ראשית: חיפוש · פילטרים (משווק / שבוע / בדיקת משקל) · סינון תאריך ·
// מיון בלחיצה על כותרת · עימוד · הדפסה.
// עמודות לפי האיפיון: תאריך · משווק · מבנה · קרטונים · משקל · ק"ג לקרטון ·
// סטיית משקל · בדיקת משקל · מסמך (+ מס' תעודה וקוד שבוע לחיפוש).
// לחיצה על שורה פותחת את כרטיס התעודה; לחיצה על משווק/מבנה/שבוע
// פותחת את האובייקט המקושר בתוך אותה מגירה.
//
// פרמטרי URL נתמכים (למעבר ממסכים אחרים):
//   ?open=<recId>  ?marketer=<recId>  ?structure=<recId>  ?week=<קוד שבוע>
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { sortStructures } from '../utils/structures.js';
import { useAutoRefresh } from '../utils/live.js';
import { formatNumber, formatDate, formatWeight, formatPercent, kpiValueClass } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import DeliveryNoteDrawer, { ObjChip, CheckBadge } from '../components/DeliveryNoteDrawer.jsx';
import { activatable } from '../utils/a11y.js';
import { paginate, pagerSummary, sortRows, dateValue } from '../utils/table.js';
import { periodRange, inPeriod, periodCaption } from '../utils/period.js';
import PeriodSelect from '../components/PeriodSelect.jsx';
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

// "משווק" הוא שדה קישור (link) לטבלת "משווקים", לא select-options רגיל —
// ר' RecordForm.jsx type:'link'. תוקן 2026-10-06 (סעיף C): השדה הזה היה
// חסר כליל מהטופס, ולכן לא הופיעה אף אפשרות בחירה ("בתעודות משלוח לא
// מופיע לי בחירה של משווק" — תמר).
const EDIT_FIELDS = [
  { name: 'תאריך תעודה', label: 'תאריך תעודה', type: 'date' },
  { name: 'משווק', label: 'משווק', type: 'link', linkTable: 'משווקים', linkNameField: 'שם משווק' },
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
  // תקופה — אותו בורר כמו בלוח הבקרה; ברירת מחדל: החודש. בהגעה מקישור
  // ממוקד (משווק/מבנה/שבוע) — "הכל", כדי שהרשומות המבוקשות לא יוסתרו
  const [preset, setPreset] = useState(() => (params.get('marketer') || params.get('structure') || params.get('week')) ? 'all' : 'month');
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

  const load = useCallback(() => app.api.get(DELIVERY_TABLE, '?maxRecords=1000')
    .then((d) => {
      const arr = Array.isArray(d) ? d : [];
      setItems(arr);
      setError('');
      // תעודה פתוחה ברענון ברקע מסונכרנת לרשומה העדכנית
      setDrawer((cur) => (cur?.note ? { ...cur, note: arr.find((x) => x.id === cur.note.id) || cur.note } : cur));
    })
    .catch((e) => setError(e.message || 'שגיאה בטעינת תעודות המשלוח')), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load);

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
  const range = useMemo(() => periodRange(preset, from, to), [preset, from, to]);
  const caption = periodCaption(preset, from, to);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      if (marketerF && !linkedTo(n, 'משווק', marketerF)) return false;
      if (structureF && !linkedTo(n, 'מבנה', structureF)) return false;
      if (weekF && noteWeekCode(n) !== weekF) return false;
      if (checkF === '__anomaly' ? !isWeightAnomaly(n) : (checkF && String(noteCheck(n) || '') !== checkF)) return false;
      if (!inPeriod(noteDate(n), range)) return false;
      if (q) {
        const hay = [noteNumber(n), noteMarketer(n)?.name, noteStructure(n)?.name, noteWeekCode(n), noteDocument(n)?.filename]
          .filter((x) => x !== null && x !== undefined).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, marketerF, structureF, weekF, checkF, range]);

  // תעודות שקיימות (עוברות שאר הפילטרים) אבל מוסתרות ע"י בורר-התקופה — למשל
  // תעודה שהועלתה היום אך "תאריך תעודה" (מה-AI) הוא חודש קודם. בלי זה "הרשימה
  // לא מתעדכנת" (ממצא 2026-10-06, K) למרות שהרשומה נוצרה בפועל.
  const hiddenByPeriod = useMemo(() => {
    if (preset === 'all') return 0;
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      if (marketerF && !linkedTo(n, 'משווק', marketerF)) return false;
      if (structureF && !linkedTo(n, 'מבנה', structureF)) return false;
      if (weekF && noteWeekCode(n) !== weekF) return false;
      if (checkF === '__anomaly' ? !isWeightAnomaly(n) : (checkF && String(noteCheck(n) || '') !== checkF)) return false;
      if (q) {
        const hay = [noteNumber(n), noteMarketer(n)?.name, noteStructure(n)?.name, noteWeekCode(n), noteDocument(n)?.filename]
          .filter((x) => x !== null && x !== undefined).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return !inPeriod(noteDate(n), range);
    }).length;
  }, [items, search, marketerF, structureF, weekF, checkF, range, preset]);

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

  const hasFilters = search || marketerF || structureF || weekF || checkF || preset !== 'month' || from || to;
  // כיתוב התקופה בכרטיסים — בדיוק מה שהטבלה מסננת
  const periodSub = (marketerF || structureF || weekF) ? `${caption} · לפי הסינון` : caption;
  const resetFilters = () => {
    setSearch(''); setMarketerF(''); setStructureF(''); setWeekF(''); setCheckF(''); setPreset('month'); setFrom(''); setTo(''); setPage(1);
    setParams({}, { replace: true });
  };
  const changeSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' }));
    setPage(1);
  };
  useEffect(() => { setPage(1); }, [search, marketerF, structureF, weekF, checkF, preset, from, to, pageSize]);

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
        <button type="button" className="btn btn-primary no-print" onClick={() => navigate('/upload', { state: { docType: 'תעודת משלוח' } })}>⬆️ העלאת תעודה</button>
      </PageHeader>

      {/* KPI */}
      <div className="kpi-grid">
        <Kpi icon="📄" soft="var(--docs-soft, #EAF3FC)" color="var(--docs, #4A90E2)" label="תעודות" value={formatNumber(kpi.count)} sub={periodSub} />
        <Kpi icon="📦" soft="var(--cartons-soft)" color="var(--cartons)" label='סה"כ קרטונים' value={kpi.cartons === null ? 'אין נתונים' : formatNumber(kpi.cartons)} sub={periodSub} />
        <Kpi icon="⚖️" soft="var(--weight-soft)" color="var(--weight)" label='סה"כ משקל' value={kpi.weight === null ? 'אין נתונים' : formatWeight(kpi.weight)} sub={periodSub} />
        <Kpi icon="📐" soft="var(--bg-secondary)" color="var(--text-main)" label='ק"ג לקרטון (ממוצע)' value={kpi.avg === null ? 'אין נתונים' : formatNumber(kpi.avg, 2)} sub={periodSub} />
        <Kpi icon="⚠️" soft={kpi.anomalies ? 'var(--expense-soft)' : 'var(--profit-soft)'} color={kpi.anomalies ? 'var(--expense)' : 'var(--profit)'} label="חריגות משקל" value={formatNumber(kpi.anomalies)} sub={periodSub} onClick={() => setCheckF(checkF === '__anomaly' ? '' : '__anomaly')} active={checkF === '__anomaly'} />
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
            {sortStructures(structures, (t) => t[1]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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
        <PeriodSelect preset={preset} from={from} to={to} onPreset={setPreset} onFrom={setFrom} onTo={setTo} />
        {hasFilters && <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>נקה סינון</button>}
      </div>

      {hiddenByPeriod > 0 && (
        <div className="badge badge-warn no-print" style={{ width: '100%', marginBottom: 12 }}>
          ⚠ {hiddenByPeriod} תעודות קיימות אך מוסתרות כי תאריך התעודה מחוץ ל"{caption}" (לדוגמה: תעודה שהועלתה היום עם תאריך-מסמך מחודש קודם).{' '}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreset('all')}>הצג הכל</button>
        </div>
      )}

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
              <span className="pager-info">{pagerSummary(paged, formatNumber)}</span>
              <div className="pager-controls">
                <label>שורות בעמוד
                  <select className="select" style={{ minHeight: 34, padding: '4px 8px', minWidth: 70, marginRight: 6 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="שורות בעמוד">
                    {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {paged.pages > 1 && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={paged.current <= 1} onClick={() => setPage(paged.current - 1)} aria-label="עמוד קודם">‹ הקודם</button>
                    <span>עמוד {paged.current} מתוך {paged.pages}</span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={paged.current >= paged.pages} onClick={() => setPage(paged.current + 1)} aria-label="עמוד הבא">הבא ›</button>
                  </>
                )}
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

function Kpi({ icon, soft, color, label, value, sub, onClick, active }) {
  const inner = (
    <>
      <div className="kpi-top"><div className="kpi-icon" style={{ background: soft }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className={kpiValueClass(value)} style={{ color }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  if (!onClick) return <div className="kpi-card">{inner}</div>;
  return (
    <div className={`kpi-card clickable ${active ? 'highlight' : ''}`} {...activatable(onClick, `סינון: ${label}`)} aria-pressed={active}>
      {inner}
    </div>
  );
}
