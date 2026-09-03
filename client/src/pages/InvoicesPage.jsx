// ============================================================
// חשבוניות (סעיף 28 + סעיף 47 טבלאות + כללי אובייקטים מקושרים)
// ------------------------------------------------------------
// טבלה ראשית: חיפוש · פילטרים (משווק / שבוע / סטטוס תשלום / חריגות) ·
// סינון תאריך · מיון בלחיצה על כותרת · עימוד · הדפסה · ייצוא CSV.
// עמודות לפי האיפיון: חשבונית · משווק · תאריך · סטטוס תשלום · ברוטו · נטו ·
// משקל · מחיר נטו לק"ג · מחיר ברוטו לק"ג · קרטונים · משקל ממוצע לקרטון ·
// ניכוי משווק · אחוז ניכוי · סטיית ניכוי · בדיקת ניכוי · עלות הובלה ·
// משטחים · הובלה למשטח · בדיקת הובלה. (ללא Autonumber טכני / JSON / שדות מערכת)
// לחיצה על שורה פותחת את כרטיס החשבונית; לחיצה על משווק/שבוע פותחת
// את האובייקט המקושר בתוך אותה מגירה.
//
// פרמטרי URL נתמכים (למעבר ממסכים אחרים):
//   ?open=<recId>  ?marketer=<recId>  ?week=<קוד שבוע>  ?status=<סטטוס>
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useAutoRefresh } from '../utils/live.js';
import { formatNumber, formatDate, formatWeight, formatPercent, formatMoney } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm from '../components/RecordForm.jsx';
import InvoiceDrawer, { ObjChip, StatusBadge, CheckBadgeValue } from '../components/InvoiceDrawer.jsx';
import { activatable } from '../utils/a11y.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { exportCsv, fileStamp, inDateRange, paginate, sortRows, dateValue } from '../utils/table.js';
import {
  INVOICES_TABLE, invNumber, invLabel, invTitle, invDate, invStatus, invGross, invNet, invWeight, invCartons, invPallets,
  invNetPerKg, invGrossPerKg, invAvgCarton, invDeduction, invDeductionPct, invDeductionDev, invDeductionCheck,
  invTransport, invTransportPerPallet, invTransportCheck, invWeekCode, invMarketer, invDocument,
  isDeductionAnomaly, isTransportAnomaly, hasAnomaly, linkedTo,
} from '../utils/invoices.js';

const PAGE_SIZES = [25, 50, 100];

// מפתחות מיון → פונקציית ערך
const SORTERS = {
  number: (i) => invNumber(i) ?? null,
  title: (i) => invTitle(i) || null,
  marketer: (i) => invMarketer(i)?.name || null,
  date: (i) => dateValue(invDate(i)),
  status: (i) => invStatus(i) || null,
  gross: invGross,
  net: invNet,
  weight: invWeight,
  netPerKg: invNetPerKg,
  grossPerKg: invGrossPerKg,
  cartons: invCartons,
  avg: invAvgCarton,
  deduction: invDeduction,
  deductionPct: invDeductionPct,
  deductionDev: invDeductionDev,
  deductionCheck: (i) => invDeductionCheck(i) || null,
  transport: invTransport,
  pallets: invPallets,
  perPallet: invTransportPerPallet,
  transportCheck: (i) => invTransportCheck(i) || null,
};

// שדות שניתן לערוך ידנית (Formula / Lookup / AI אינם ניתנים לעריכה)
const EDIT_FIELDS = [
  { name: 'סטטוס תשלום', label: 'סטטוס תשלום', type: 'select' },
  { name: 'תאריך-AI', label: 'תאריך', type: 'date' },
  { name: 'קוד שבוע', label: 'קוד שבוע (YYYYMMDD-YYYYMMDD)', type: 'text' },
  { name: 'עלות הובלה', label: 'עלות הובלה (₪)', type: 'text' },
  { name: 'מספר משטחים', label: 'מספר משטחים', type: 'text' },
];
const FIELD_BY_LABEL = { 'סטטוס תשלום': 'סטטוס תשלום', 'תאריך': 'תאריך-AI', 'קוד שבוע': 'קוד שבוע', 'עלות הובלה': 'עלות הובלה' };

const cell = (v, fmt) => (v === null || v === undefined ? <span className="muted">לא זמין</span> : fmt(v));

export default function InvoicesPage() {
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
  const [weekF, setWeekF] = useState(params.get('week') || '');
  const [statusF, setStatusF] = useState(params.get('status') || '');
  const [checkF, setCheckF] = useState(''); // '' | '__any' | '__deduction' | '__transport'
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // מיון / עימוד
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [printing, setPrinting] = useState(false);

  // מגירה / עריכה / מחיקה / הודעה
  const [drawer, setDrawer] = useState(null); // { inv, initial? }
  const [form, setForm] = useState(null); // { record, fields }
  const [confirmDel, setConfirmDel] = useState(null); // רשומה למחיקה
  const [toast, setToast] = useState('');

  const load = useCallback(() => app.api.get(INVOICES_TABLE, '?maxRecords=1000')
    .then((d) => {
      const arr = Array.isArray(d) ? d : [];
      setItems(arr);
      setError('');
      // חשבונית פתוחה ברענון ברקע מסונכרנת לרשומה העדכנית
      setDrawer((cur) => (cur?.inv ? { ...cur, inv: arr.find((x) => x.id === cur.inv.id) || cur.inv } : cur));
    })
    .catch((e) => setError(e.message || 'שגיאה בטעינת החשבוניות')), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load);

  // פתיחה ישירה של חשבונית מתוך URL (?open=recId) — פעם אחת אחרי הטעינה
  useEffect(() => {
    const id = params.get('open');
    if (!id || !items.length) return;
    const inv = items.find((x) => x.id === id);
    if (inv) setDrawer({ inv });
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

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // אפשרויות לפילטרים — נגזרות מהנתונים עצמם
  const marketers = useMemo(() => {
    const m = new Map();
    items.forEach((i) => { const mk = invMarketer(i); if (mk?.id) m.set(mk.id, mk.name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'he'));
  }, [items]);
  const weeks = useMemo(() => [...new Set(items.map(invWeekCode).filter(Boolean))].sort().reverse(), [items]);
  const statuses = useMemo(() => [...new Set(items.map(invStatus).filter(Boolean).map(String))], [items]);

  // סינון (החיפוש עובד יחד עם הפילטרים, לא במקומם)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (marketerF && !linkedTo(i, 'משווק', marketerF)) return false;
      if (weekF && invWeekCode(i) !== weekF) return false;
      if (statusF === '__none' ? Boolean(invStatus(i)) : (statusF && String(invStatus(i) || '') !== statusF)) return false;
      if (checkF === '__any' && !hasAnomaly(i)) return false;
      if (checkF === '__deduction' && !isDeductionAnomaly(i)) return false;
      if (checkF === '__transport' && !isTransportAnomaly(i)) return false;
      if (!inDateRange(invDate(i), from, to)) return false;
      if (q) {
        const hay = [invNumber(i), invTitle(i), invMarketer(i)?.name, invWeekCode(i), invStatus(i), invDocument(i)?.filename]
          .filter((x) => x !== null && x !== undefined).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, marketerF, weekF, statusF, checkF, from, to]);

  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir, SORTERS), [filtered, sort]);
  const paged = useMemo(() => paginate(sorted, page, printing ? Math.max(sorted.length, 1) : pageSize), [sorted, page, pageSize, printing]);

  // KPI על הנתונים המסוננים (null נשאר "אין נתונים", לא 0)
  const kpi = useMemo(() => {
    const sumOf = (fn) => { const a = filtered.map(fn).filter((v) => v !== null); return a.length ? a.reduce((s, v) => s + v, 0) : null; };
    return {
      count: filtered.length,
      gross: sumOf(invGross),
      net: sumOf(invNet),
      weight: sumOf(invWeight),
      cartons: sumOf(invCartons),
      anomalies: filtered.filter(hasAnomaly).length,
      missingDoc: filtered.filter((i) => !invDocument(i)).length,
    };
  }, [filtered]);

  const hasFilters = search || marketerF || weekF || statusF || checkF || from || to;
  const resetFilters = () => {
    setSearch(''); setMarketerF(''); setWeekF(''); setStatusF(''); setCheckF(''); setFrom(''); setTo(''); setPage(1);
    setParams({}, { replace: true });
  };
  const changeSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' }));
    setPage(1);
  };
  useEffect(() => { setPage(1); }, [search, marketerF, weekF, statusF, checkF, from, to, pageSize]);

  const round2 = (v) => (v === null ? '' : Math.round(v * 100) / 100);
  const doExport = () => exportCsv(`חשבוניות-${fileStamp()}`, [
    { label: 'חשבונית', get: (i) => invLabel(i) },
    { label: 'כותרת', get: (i) => invTitle(i) || '' },
    { label: 'משווק', get: (i) => invMarketer(i)?.name || '' },
    { label: 'תאריך', get: (i) => (invDate(i) ? formatDate(invDate(i)) : '') },
    { label: 'קוד שבוע', get: (i) => invWeekCode(i) || '' },
    { label: 'סטטוס תשלום', get: (i) => invStatus(i) || '' },
    { label: 'ברוטו (₪)', get: (i) => round2(invGross(i)) },
    { label: 'נטו (₪)', get: (i) => round2(invNet(i)) },
    { label: 'משקל (ק"ג)', get: (i) => round2(invWeight(i)) },
    { label: 'מחיר נטו לק"ג', get: (i) => round2(invNetPerKg(i)) },
    { label: 'מחיר ברוטו לק"ג', get: (i) => round2(invGrossPerKg(i)) },
    { label: 'קרטונים', get: (i) => invCartons(i) ?? '' },
    { label: 'משקל ממוצע לקרטון', get: (i) => round2(invAvgCarton(i)) },
    { label: 'ניכוי משווק (₪)', get: (i) => round2(invDeduction(i)) },
    { label: 'אחוז ניכוי (%)', get: (i) => (invDeductionPct(i) === null ? '' : Math.round(invDeductionPct(i) * 1000) / 10) },
    { label: 'סטיית ניכוי (₪)', get: (i) => round2(invDeductionDev(i)) },
    { label: 'בדיקת ניכוי', get: (i) => invDeductionCheck(i) || '' },
    { label: 'עלות הובלה (₪)', get: (i) => round2(invTransport(i)) },
    { label: 'משטחים', get: (i) => invPallets(i) ?? '' },
    { label: 'הובלה למשטח (₪)', get: (i) => round2(invTransportPerPallet(i)) },
    { label: 'בדיקת הובלה', get: (i) => invTransportCheck(i) || '' },
    { label: 'מסמך', get: (i) => invDocument(i)?.filename || '' },
  ], sorted);

  const openObject = (inv, initial) => setDrawer({ inv, initial });

  // עריכה: כל השדות, או רק החסרים ("+ הוספת פרטים" — קודם כל השדות החסרים)
  const openEdit = (inv, missingLabels) => {
    const fields = Array.isArray(missingLabels) && missingLabels.length
      ? EDIT_FIELDS.filter((f) => missingLabels.map((l) => FIELD_BY_LABEL[l]).includes(f.name))
      : EDIT_FIELDS;
    setForm({ record: inv, fields: fields.length ? fields : EDIT_FIELDS, title: missingLabels ? `הוספת פרטים — ${invLabel(inv)}` : `עריכת ${invLabel(inv)}` });
  };

  // מחיקה — רק אחרי אישור מפורש; הפריט לא נעלם מהמסך לפני אישור מ-Airtable
  const doDelete = async (inv) => {
    try {
      await app.api.remove(INVOICES_TABLE, inv.id);
      await load();
      setConfirmDel(null);
      setDrawer(null);
      setToast('הפריט נמחק בהצלחה');
    } catch {
      setConfirmDel(null);
      setToast('לא ניתן היה למחוק את הפריט.');
    }
  };

  const Th = ({ k, children }) => {
    const active = sort.key === k;
    return (
      <th className={`sortable ${active ? 'active' : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="th-btn" onClick={() => changeSort(k)}>
          {children} <span className="sort-ind" aria-hidden="true">{active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="invoices-page">
      <PageHeader icon="🧾" title="חשבוניות">
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()} aria-label="הדפסת הרשימה המוצגת">🖨️ הדפסה</button>
        <button type="button" className="btn btn-ghost no-print" onClick={doExport} disabled={!sorted.length} aria-label="ייצוא הרשימה המוצגת לקובץ CSV">⬇️ ייצוא</button>
        <button type="button" className="btn btn-primary no-print" onClick={() => navigate('/upload', { state: { docType: 'חשבונית הכנסה' } })}>⬆️ העלאת חשבונית</button>
      </PageHeader>

      {/* KPI */}
      <div className="kpi-grid">
        <Kpi icon="🧾" soft="var(--docs-soft)" color="var(--docs)" label="חשבוניות" value={formatNumber(kpi.count)} />
        <Kpi icon="💵" soft="var(--revenue-soft)" color="var(--revenue)" label='סה"כ ברוטו' value={kpi.gross === null ? 'אין נתונים' : formatMoney(kpi.gross)} />
        <Kpi icon="💸" soft="var(--profit-soft)" color="var(--profit)" label='סה"כ נטו' value={kpi.net === null ? 'אין נתונים' : formatMoney(kpi.net)} />
        <Kpi icon="⚖️" soft="var(--weight-soft)" color="var(--weight)" label='סה"כ משקל' value={kpi.weight === null ? 'אין נתונים' : formatWeight(kpi.weight)} />
        <Kpi icon="📦" soft="var(--cartons-soft)" color="var(--cartons)" label='סה"כ קרטונים' value={kpi.cartons === null ? 'אין נתונים' : formatNumber(kpi.cartons)} />
        <Kpi icon="⚠️" soft={kpi.anomalies ? 'var(--error-soft)' : 'var(--ok-soft)'} color={kpi.anomalies ? 'var(--error)' : 'var(--ok)'} label="חריגות ניכוי / הובלה" value={formatNumber(kpi.anomalies)} onClick={() => setCheckF(checkF === '__any' ? '' : '__any')} active={checkF === '__any'} />
      </div>

      {/* סרגל סינון */}
      <div className="filter-bar no-print" role="search" aria-label="סינון חשבוניות">
        <input className="input" style={{ flex: '1 1 220px' }} aria-label="חיפוש חשבוניות" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" aria-label="סינון לפי משווק" value={marketerF} onChange={(e) => setMarketerF(e.target.value)}>
          <option value="">כל המשווקים</option>
          {marketers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="select" aria-label="סינון לפי שבוע" value={weekF} onChange={(e) => setWeekF(e.target.value)}>
          <option value="">כל השבועות</option>
          {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select className="select" aria-label="סינון לפי סטטוס תשלום" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">כל הסטטוסים</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="__none">ללא סטטוס</option>
        </select>
        <select className="select" aria-label="סינון לפי חריגות" value={checkF} onChange={(e) => setCheckF(e.target.value)}>
          <option value="">כל הבדיקות</option>
          <option value="__any">חריגות בלבד</option>
          <option value="__deduction">חריגת ניכוי משווק</option>
          <option value="__transport">חריגת מחיר משטח</option>
        </select>
        <label className="date-field"><span>מתאריך</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="מתאריך" /></label>
        <label className="date-field"><span>עד תאריך</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="עד תאריך" /></label>
        {hasFilters && <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>נקה פילטרים</button>}
      </div>

      {/* הטבלה */}
      <div className="card">
        {loading ? (
          <div className="skeleton skeleton-card" />
        ) : error ? (
          <div className="empty-state">⚠️ {error}</div>
        ) : items.length === 0 ? (
          <div className="empty-state"><div className="icon">🧾</div>אין חשבוניות במערכת עדיין</div>
        ) : sorted.length === 0 ? (
          <div className="empty-state"><div className="icon">🔍</div>אין חשבוניות התואמות לסינון</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <Th k="number">חשבונית</Th>
                    <Th k="marketer">משווק</Th>
                    <Th k="date">תאריך</Th>
                    <Th k="status">סטטוס תשלום</Th>
                    <Th k="gross">ברוטו</Th>
                    <Th k="net">נטו</Th>
                    <Th k="weight">משקל</Th>
                    <Th k="netPerKg">נטו לק"ג</Th>
                    <Th k="grossPerKg">ברוטו לק"ג</Th>
                    <Th k="cartons">קרטונים</Th>
                    <Th k="avg">ק"ג לקרטון</Th>
                    <Th k="deduction">ניכוי משווק</Th>
                    <Th k="deductionPct">אחוז ניכוי</Th>
                    <Th k="deductionDev">סטיית ניכוי</Th>
                    <Th k="deductionCheck">בדיקת ניכוי</Th>
                    <Th k="transport">עלות הובלה</Th>
                    <Th k="pallets">משטחים</Th>
                    <Th k="perPallet">הובלה למשטח</Th>
                    <Th k="transportCheck">בדיקת הובלה</Th>
                    <th>מסמך</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((i) => {
                    const mk = invMarketer(i);
                    const wk = invWeekCode(i);
                    const doc = invDocument(i);
                    return (
                      <tr key={i.id} className="row-clickable" {...activatable(() => openObject(i), `פתיחת ${invLabel(i)}`)}>
                        <td>
                          <b>{invLabel(i)}</b>
                          {invTitle(i) && invNumber(i) != null && <div className="muted" style={{ fontSize: 12 }}>{invTitle(i)}</div>}
                          {wk && <div style={{ marginTop: 4 }}><ObjChip icon="📆" label={wk} onClick={() => openObject(i, { kind: 'week', code: wk })} /></div>}
                        </td>
                        <td><ObjChip icon="🚚" label={mk?.name} onClick={mk?.id ? () => openObject(i, { kind: 'marketer', id: mk.id, name: mk.name }) : null} /></td>
                        <td>{invDate(i) ? formatDate(invDate(i)) : <span className="muted">לא זמין</span>}</td>
                        <td><StatusBadge status={invStatus(i)} /></td>
                        <td>{cell(invGross(i), formatMoney)}</td>
                        <td>{cell(invNet(i), formatMoney)}</td>
                        <td>{cell(invWeight(i), formatWeight)}</td>
                        <td>{cell(invNetPerKg(i), (v) => formatMoney(Math.round(v * 100) / 100))}</td>
                        <td>{cell(invGrossPerKg(i), (v) => formatMoney(Math.round(v * 100) / 100))}</td>
                        <td>{cell(invCartons(i), formatNumber)}</td>
                        <td>{cell(invAvgCarton(i), (v) => formatNumber(v, 2))}</td>
                        <td>{cell(invDeduction(i), formatMoney)}</td>
                        <td>{cell(invDeductionPct(i), formatPercent)}</td>
                        <td>{cell(invDeductionDev(i), (v) => <span style={{ color: isDeductionAnomaly(i) ? 'var(--error)' : undefined }}>{formatMoney(v)}</span>)}</td>
                        <td>{invDeductionCheck(i) ? <CheckBadgeValue value={invDeductionCheck(i)} /> : <span className="muted">לא זמין</span>}</td>
                        <td>{cell(invTransport(i), formatMoney)}</td>
                        <td>{cell(invPallets(i), formatNumber)}</td>
                        <td>{cell(invTransportPerPallet(i), formatMoney)}</td>
                        <td>{invTransportCheck(i) ? <CheckBadgeValue value={invTransportCheck(i)} /> : <span className="muted">לא זמין</span>}</td>
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

      {kpi.missingDoc > 0 && !loading && (
        <div className="hint no-print">{formatNumber(kpi.missingDoc)} חשבוניות ללא קובץ מצורף — <button type="button" className="crumb-link" onClick={() => navigate('/upload')}>העלאת מסמך</button></div>
      )}

      {drawer && (
        <InvoiceDrawer
          inv={items.find((x) => x.id === drawer.inv?.id) || drawer.inv}
          initial={drawer.initial || null}
          invoices={items}
          api={app.api}
          canEdit={canEdit}
          onEdit={openEdit}
          onDelete={(inv) => setConfirmDel(inv)}
          onClose={() => setDrawer(null)}
        />
      )}

      {form && (
        <RecordForm
          api={app.api}
          table={INVOICES_TABLE}
          title={form.title}
          fields={form.fields}
          record={form.record}
          onClose={() => setForm(null)}
          onSaved={async () => {
            // הנתון מוצג רק אחרי שהתקבל מחדש מ-Airtable (ללא Optimistic UI)
            await load();
            setForm(null);
            setToast('הפרטים עודכנו בהצלחה');
          }}
        />
      )}

      {confirmDel && <DeleteConfirm label={invLabel(confirmDel)} onCancel={() => setConfirmDel(null)} onConfirm={() => doDelete(confirmDel)} />}

      {toast && (
        <div role="status" aria-live="polite" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text-main)', color: '#fff', padding: '10px 18px', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.2)', zIndex: 80, fontSize: 14 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// חלון אישור מחיקה — הנוסח והכפתורים לפי סעיף "ניהול מחיקה" באיפיון
function DeleteConfirm({ label, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  useEscapeClose(onCancel, !busy);
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-labelledby="del-title" aria-describedby="del-desc">
        <h3 id="del-title">מחיקת {label}</h3>
        <p id="del-desc" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
          הפריט ימחק ולא יינתן לשחזור.<br />האם אתה בטוח שברצונך לבצע פעולה זו?
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>ביטול</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>{busy ? 'מוחק...' : 'מחק'}</button>
        </div>
      </div>
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
