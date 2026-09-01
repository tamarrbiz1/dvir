// ============================================================
// צ'קים (סעיף 26 באיפיון) — טאב מלא במסך "כספים"
// ------------------------------------------------------------
// כולל: KPI (לפירעון השבוע / החודש / סכום לפירעון / מבוטלים),
// פילטרים (חודש, שנה, טווח תאריך פירעון, ספק, סטטוס) שעובדים יחד עם
// חיפוש חופשי (מוטב / ספק / סטטוס), מתג "הצג מבוטלים", טבלה עם כל
// העמודות שבאיפיון (צילום, הערות, סכום, פירעון, מוטב, בעל הצ'ק, ספק,
// חשבוניות, סטטוס), מגירת פרטים עם קישור לספק ולחשבוניות, וסימון
// סטטוס (נפרע / לא נפרע / מבוטל). אין מחיקה — לפי האיפיון.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { confirmDialog } from '../utils/ui.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatMoney, formatDate } from '../utils/format.js';
import { pick } from '../utils/field.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import {
  CHECKS_TABLE, CHECK_FIELDS, STATUS,
  checkNumber, checkTitle, checkStatus, isCancelled, isPaid, isPending,
  checkAmount, checkDueDate, checkPayee, checkOwner, checkNotes,
  checkSupplierName, checkSupplierId, checkInvoices, checkExpenses, checkPhoto, sortByDue,
} from '../utils/checks.js';

const PAGE_SIZE = 50;
const NO_STATUS = '__none__';
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const DAY_MS = 24 * 3600 * 1000;
const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

export default function ChecksTab({ checks, onRefresh }) {
  const app = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ---- פילטרים וחיפוש (עובדים יחד, לא במקום זה את זה) ----
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [supplier, setSupplier] = useState(searchParams.get('supplier') || '');
  const [status, setStatus] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const [drawerId, setDrawerId] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [statusChoices, setStatusChoices] = useState(null); // null = עדיין לא נטען

  // אפשרויות הסטטוס האמיתיות מ-Airtable — כדי לא לכתוב ערך שאינו ברשימה
  useEffect(() => {
    fetch(`/api/select-options/${encodeURIComponent(CHECKS_TABLE)}/${encodeURIComponent('סטטוס')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatusChoices(Array.isArray(d?.choices) ? d.choices : []))
      .catch(() => setStatusChoices([]));
  }, []);

  // איפוס העימוד בכל שינוי פילטר
  useEffect(() => { setLimit(PAGE_SIZE); }, [search, year, month, dueFrom, dueTo, supplier, status, showCancelled]);

  // רשימות לבחירה — נגזרות מהנתונים עצמם
  const years = useMemo(() => {
    const s = new Set();
    checks.forEach((c) => { const d = checkDueDate(c); if (d) s.add(d.getFullYear()); });
    return [...s].sort((a, b) => b - a);
  }, [checks]);

  const supplierNames = useMemo(() => {
    const s = new Set();
    checks.forEach((c) => { const n = checkSupplierName(c); if (n) s.add(n); });
    return [...s].sort((a, b) => a.localeCompare(b, 'he'));
  }, [checks]);

  const statusOptions = useMemo(() => {
    const s = new Set([...(statusChoices || []), STATUS.PAID, STATUS.UNPAID, STATUS.CANCELLED]);
    checks.forEach((c) => { const st = checkStatus(c); if (st) s.add(st); });
    return [...s];
  }, [checks, statusChoices]);

  // ---- סינון (ללא מתג המבוטלים — כדי שה-KPI "מבוטלים" יישאר נכון) ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dueFrom ? new Date(dueFrom) : null;
    const to = dueTo ? endOfDay(new Date(dueTo)) : null;
    return checks.filter((c) => {
      const due = checkDueDate(c);
      if (year && (!due || String(due.getFullYear()) !== year)) return false;
      if (month && (!due || String(due.getMonth() + 1) !== month)) return false;
      if (from && (!due || due < from)) return false;
      if (to && (!due || due > to)) return false;
      if (supplier && checkSupplierName(c) !== supplier) return false;
      if (status) {
        const st = checkStatus(c);
        if (status === NO_STATUS ? st !== '' : st !== status) return false;
      }
      if (q) {
        const hay = [checkPayee(c), checkOwner(c), checkSupplierName(c), checkStatus(c), checkNumber(c)]
          .filter((x) => x != null && x !== '').join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [checks, search, year, month, dueFrom, dueTo, supplier, status]);

  // ---- KPI ----
  const kpi = useMemo(() => {
    const pending = filtered.filter(isPending);
    const today = startOfToday();
    const weekEnd = new Date(today.getTime() + 7 * DAY_MS);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    const sumIn = (end) => pending
      .filter((c) => { const d = checkDueDate(c); return d && d >= today && d <= end; })
      .reduce((s, c) => s + checkAmount(c), 0);
    return {
      dueWeek: sumIn(weekEnd),
      dueMonth: sumIn(monthEnd),
      totalPending: pending.reduce((s, c) => s + checkAmount(c), 0),
      pendingCount: pending.length,
      cancelled: filtered.filter(isCancelled).length,
    };
  }, [filtered]);

  const visible = useMemo(
    () => sortByDue(filtered.filter((c) => showCancelled || !isCancelled(c))),
    [filtered, showCancelled],
  );
  const shown = visible.slice(0, limit);

  const hasFilters = Boolean(search || year || month || dueFrom || dueTo || supplier || status);
  const clearFilters = () => { setSearch(''); setYear(''); setMonth(''); setDueFrom(''); setDueTo(''); setSupplier(''); setStatus(''); };

  const drawerCheck = drawerId ? checks.find((c) => c.id === drawerId) : null;

  // סגירת התצוגה המוגדלת ב-Escape (המגירה מתחתיה לא נסגרת באותה לחיצה)
  useEscapeClose(() => setLightbox(null), Boolean(lightbox));

  return (
    <div>
      {/* ---- KPI ---- */}
      <div className="kpi-grid">
        <Kpi icon="📅" label="לפירעון השבוע" value={formatMoney(kpi.dueWeek)} color="var(--revenue)" soft="var(--revenue-soft)" />
        <Kpi icon="🗓️" label="לפירעון החודש" value={formatMoney(kpi.dueMonth)} color="var(--revenue)" soft="var(--revenue-soft)" />
        <Kpi icon="🏦" label="סכום לפירעון" value={formatMoney(kpi.totalPending)} sub={`${kpi.pendingCount} צ'קים ממתינים`} color="var(--revenue)" soft="var(--revenue-soft)" />
        <Kpi icon="❌" label="מבוטלים" value={kpi.cancelled} color="var(--error)" soft="var(--error-soft)" />
      </div>

      {/* ---- פילטרים + חיפוש ---- */}
      <div className="filter-bar" style={{ marginTop: 18 }}>
        <input
          className="input"
          aria-label="חיפוש צ'ק לפי מוטב, ספק או סטטוס"
          placeholder="חיפוש: מוטב / ספק / סטטוס"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select className="select" aria-label="שנה" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">כל השנים</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <select className="select" aria-label="חודש" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">כל החודשים</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          פירעון מ־
          <input className="input" type="date" aria-label="תאריך פירעון — מתאריך" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          עד
          <input className="input" type="date" aria-label="תאריך פירעון — עד תאריך" value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
        </label>
        <select className="select" aria-label="ספק" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">כל הספקים</option>
          {supplierNames.map((n) => <option key={n} value={n}>{n}</option>)}
          {supplier && !supplierNames.includes(supplier) && <option value={supplier}>{supplier}</option>}
        </select>
        <select className="select" aria-label="סטטוס" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">כל הסטטוסים</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={NO_STATUS}>ללא סטטוס</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
          הצג מבוטלים
        </label>
        {hasFilters && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>נקה פילטרים</button>
        )}
      </div>

      {/* ---- טבלה ---- */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>רשימת צ'קים</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            מוצגים {shown.length} מתוך {visible.length}
            {!showCancelled && kpi.cancelled > 0 && ` (${kpi.cancelled} מבוטלים מוסתרים)`}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏦</div>
            {checks.length === 0 ? 'אין צ׳קים רשומים' : 'אין צ׳קים שמתאימים לפילטרים שנבחרו'}
          </div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>צילום</th><th>מס׳</th><th>מוטב</th><th>שם בעל הצ׳ק</th><th>סכום</th>
                  <th>תאריך פירעון</th><th>ספק</th><th>חשבוניות</th><th>סטטוס</th><th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const photo = checkPhoto(c);
                  const invoices = checkInvoices(c);
                  const notes = checkNotes(c);
                  const open = () => setDrawerId(c.id);
                  return (
                    <tr
                      key={c.id}
                      className="row-clickable"
                      tabIndex={0}
                      aria-label={`פתיחת ${checkTitle(c)}`}
                      onClick={open}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                    >
                      <td>
                        {photo ? (
                          <img
                            className="check-thumb"
                            src={photo.thumb}
                            alt={`צילום ${checkTitle(c)}`}
                            onClick={(e) => { e.stopPropagation(); setLightbox(photo); }}
                          />
                        ) : <span className="check-thumb check-thumb-empty">אין</span>}
                      </td>
                      <td>{checkNumber(c) ?? '—'}</td>
                      <td>{checkPayee(c) || 'לא זמין'}</td>
                      <td>{checkOwner(c) || 'לא זמין'}</td>
                      <td style={{ fontWeight: 700 }}>{formatMoney(pick(c, CHECK_FIELDS.amount))}</td>
                      <td><DueCell check={c} /></td>
                      <td>{checkSupplierName(c) || '—'}</td>
                      <td>{invoices.length ? invoices.map((i) => i?.name || i).join(', ') : '—'}</td>
                      <td><StatusBadge check={c} /></td>
                      <td title={notes} style={{ maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {visible.length > shown.length && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
              הצג עוד ({visible.length - shown.length} נוספים)
            </button>
          </div>
        )}
      </div>

      {drawerCheck && (
        <CheckDrawer
          check={drawerCheck}
          statusChoices={statusChoices}
          escapeEnabled={!lightbox}
          onClose={() => setDrawerId(null)}
          onZoom={(p) => setLightbox(p)}
          onOpenSupplier={(id) => navigate(`/suppliers?supplier=${encodeURIComponent(id)}`)}
          onOpenInvoice={(id) => navigate(`/invoices?invoice=${encodeURIComponent(id)}`)}
          onSetStatus={async (next) => {
            await app.api.update(CHECKS_TABLE, drawerCheck.id, { 'סטטוס': next });
            if (typeof onRefresh === 'function') await onRefresh();
          }}
        />
      )}

      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ============================================================
// רכיבי עזר
// ============================================================
function Kpi({ icon, label, value, sub, color, soft }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ background: soft }}>{icon}</div>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function StatusBadge({ check }) {
  const st = checkStatus(check);
  const cls = isCancelled(check) ? 'badge-error' : isPaid(check) ? 'badge-ok' : 'badge-warn';
  return <span className={`badge ${cls}`}>{st || STATUS.UNPAID}</span>;
}

// תאריך פירעון + סימון איחור לצ'ק ממתין שתאריכו עבר
function DueCell({ check }) {
  const d = checkDueDate(check);
  if (!d) return <span>לא זמין</span>;
  const overdue = isPending(check) && d < startOfToday();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {formatDate(d)}
      {overdue && <span className="badge badge-error" style={{ fontSize: 11 }}>באיחור</span>}
    </span>
  );
}

function daysUntil(d) {
  if (!d) return null;
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startOfToday()) / DAY_MS);
}

// ============================================================
// מגירת פרטי צ'ק — כולל קישורים לאובייקטים מקושרים וסימון סטטוס
// ============================================================
function CheckDrawer({ check, statusChoices, escapeEnabled, onClose, onZoom, onOpenSupplier, onOpenInvoice, onSetStatus }) {
  useEscapeClose(onClose, escapeEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const photo = checkPhoto(check);
  const supplierName = checkSupplierName(check);
  const supplierId = checkSupplierId(check);
  const invoices = checkInvoices(check);
  const expenses = checkExpenses(check);
  const due = checkDueDate(check);
  const days = daysUntil(due);
  const st = checkStatus(check);

  // ביטול אפשרי רק אם האפשרות "מבוטל" קיימת בשדה הסטטוס ב-Airtable
  // (כשהרשימה לא נטענה — ננסה, והשרת ידווח אם נדחה)
  const cancelAllowed = statusChoices === null || statusChoices.length === 0 || statusChoices.includes(STATUS.CANCELLED);

  const setStatus = async (next, confirmText) => {
    if (confirmText && !(await confirmDialog({ title: 'אישור פעולה', message: confirmText, confirmLabel: 'אישור', danger: true }))) return;
    setSaving(true);
    setError('');
    try {
      await onSetStatus(next);
    } catch (e) {
      setError(e?.message || 'העדכון נכשל');
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</span>
    </div>
  );

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={checkTitle(check)}>
        <div className="drawer-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>🏦 {checkTitle(check)} <StatusBadge check={check} /></span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>

        <div className="drawer-body">
          {/* צילום */}
          {photo ? (
            photo.isImage ? (
              <img
                className="check-photo-large"
                src={photo.large}
                alt={`צילום ${checkTitle(check)}`}
                title="לחיצה להגדלה"
                onClick={() => onZoom(photo)}
              />
            ) : (
              <a className="btn btn-ghost" href={photo.full} target="_blank" rel="noreferrer">📎 פתח קובץ ({photo.filename})</a>
            )
          ) : (
            <div className="empty-state" style={{ padding: 18 }}>אין צילום צ׳ק</div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>פרטי הצ׳ק</div>
            <Row label="סכום"><span style={{ fontSize: 17 }}>{formatMoney(pick(check, CHECK_FIELDS.amount))}</span></Row>
            <Row label="תאריך פירעון">
              {formatDate(pick(check, CHECK_FIELDS.due))}
              {days != null && isPending(check) && (
                <span className={`badge ${days < 0 ? 'badge-error' : days <= 7 ? 'badge-warn' : 'badge-ok'}`} style={{ fontSize: 11 }}>
                  {days < 0 ? `באיחור ${-days} ימים` : days === 0 ? 'היום' : `בעוד ${days} ימים`}
                </span>
              )}
            </Row>
            <Row label="מוטב">{checkPayee(check) || 'לא זמין'}</Row>
            <Row label="שם בעל הצ׳ק">{checkOwner(check) || 'לא זמין'}</Row>
            <Row label="סטטוס">{st || `${STATUS.UNPAID} (לא הוגדר)`}</Row>
            <Row label="עודכן לאחרונה">{formatDate(pick(check, CHECK_FIELDS.uploadedAt))}</Row>
          </div>

          {/* אובייקטים מקושרים — כל אחד נפתח בכרטיס שלו (Breadcrumb דרך כפתור החזרה) */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>קישורים</div>
            <Row label="ספק">
              {supplierName || '—'}
              {supplierId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenSupplier(supplierId)}>פתח ספק ←</button>
              )}
            </Row>
            <Row label="חשבוניות">
              {invoices.length === 0 ? '—' : invoices.map((inv) => (
                <button key={inv?.id || inv} type="button" className="btn btn-ghost btn-sm" onClick={() => inv?.id && onOpenInvoice(inv.id)} disabled={!inv?.id}>
                  {inv?.name || inv} ←
                </button>
              ))}
            </Row>
            <Row label="הוצאות">{expenses.length ? expenses.map((e) => e?.name || e).join(', ') : '—'}</Row>
          </div>

          {checkNotes(check) && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="section-title" style={{ marginTop: 0 }}>הערות</div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{checkNotes(check)}</div>
            </div>
          )}

          {/* סימון צ'ק — שינוי סטטוס בלבד; אין מחיקה לפי האיפיון */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>סימון צ׳ק</div>
            <div className="check-actions">
              {!isPaid(check) && (
                <button type="button" className="btn btn-success" disabled={saving} onClick={() => setStatus(STATUS.PAID)}>✓ סמן כנפרע</button>
              )}
              {st !== STATUS.UNPAID && (
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setStatus(STATUS.UNPAID)}>↩ סמן כלא נפרע</button>
              )}
              {!isCancelled(check) && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saving || !cancelAllowed}
                  title={cancelAllowed ? 'הצ׳ק יסומן כמבוטל ויוסתר מהתצוגה (ניתן להציגו דרך "הצג מבוטלים")' : 'האפשרות "מבוטל" אינה קיימת עדיין בשדה הסטטוס ב-Airtable'}
                  onClick={() => setStatus(STATUS.CANCELLED, `לבטל את ${checkTitle(check)}? הצ׳ק לא יימחק — הוא יסומן כמבוטל ויוסתר מהתצוגה.`)}
                >
                  ✕ בטל צ׳ק
                </button>
              )}
            </div>
            {!cancelAllowed && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                כדי לאפשר ביטול, יש להוסיף פעם אחת את האפשרות ״מבוטל״ לשדה ״סטטוס״ בטבלת צ׳קים ב-Airtable.
              </div>
            )}
            {saving && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>שומר...</div>}
            {error && <div style={{ fontSize: 13, color: 'var(--error)', marginTop: 8 }}>שגיאה: {error}</div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              צ׳קים אינם נמחקים מהמערכת. צ׳ק שאינו רלוונטי מסומן כמבוטל ומוסתר מהתצוגה.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// תצוגה מוגדלת של צילום הצ'ק
// ============================================================
function Lightbox({ photo, onClose }) {
  return (
    <div className="modal-overlay lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="צילום צ׳ק מוגדל">
      <img src={photo.full} alt={photo.filename} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="drawer-close lightbox-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
    </div>
  );
}
