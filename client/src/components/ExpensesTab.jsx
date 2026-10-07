// ============================================================
// הוצאות (סעיף 25) — טבלה מלאה, כרטיס הוצאה, ו"קשר לספק"
// ------------------------------------------------------------
// שמות תצוגה נקיים: ספק-AI → ספק · תאריך חשבונית-AI → תאריך ·
// סכום כולל-AI → סכום · קטגוריית חשבונית-AI → קטגוריה.
// כאשר קיים זיהוי AI בלי Linked Record — מוצג "ספק שזוהה" עם
// פעולת [קשר לספק] שכותבת את הקישור האמיתי ל-Airtable.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatDate, kpiMoney, kpiValueClass } from '../utils/format.js';
import { pick, num, expenseCategory } from '../utils/field.js';
import { firstId } from '../utils/resolve.js';
import RecordForm from '../components/RecordForm.jsx';
import { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';

import { periodRange, inPeriod, periodCaption } from '../utils/period.js';
import PeriodSelect from './PeriodSelect.jsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import { authFetch } from '../utils/authFetch.js';
import { readInventoryAiState, inventoryAiSummary, stripInventoryAiMarker, withPreservedInventoryTags } from '../utils/inventoryAi.js';

const TABLE = 'הוצאות';

const expDate = (e) => pick(e, ['תאריך חשבונית-AI', 'תאריך העלאת החשבונית', 'תאריך']);
const expAmount = (e) => num(e, ['סכום כולל-AI', 'סכום', 'סכום כולל']);
const expCategory = (e) => expenseCategory(e);
const expSupplierLink = (e) => (Array.isArray(e['ספקים']) && e['ספקים'][0]) || null;
const expSupplierAI = (e) => pick(e, ['שם ספק', 'ספק-AI']);
const expDoc = (e) => (Array.isArray(e['חשבונית']) && e['חשבונית'][0]) || null;

// שם הספק להצגה: Linked Record קודם ל-AI (כלל הכרעה באיפיון)
function supplierName(e) {
  const link = expSupplierLink(e);
  if (link) return typeof link === 'object' ? (link.name || '') : '';
  return expSupplierAI(e) || '';
}

// שדה "הערות" הוסר מכאן בכוונה (סעיף R, 2026-10-07): RecordForm הגנרי
// עורך/שומר את הערך הגולמי כמו שהוא, מה שהיה מוחק את סמן [מלאי-AI]
// בלי משים ברגע שנשמר עריכה. עריכת הערות להוצאה נעשית במקום זאת דרך
// NotesRow למטה, ששומרת את התגיות הפנימיות בדיוק כפי שהיו.
const EDIT_FIELDS = [
  { name: 'אמצעי תשלום', label: 'אמצעי תשלום', type: 'select' },
  { name: 'תאריך העלאת החשבונית', label: 'תאריך העלאה', type: 'date' },
  { name: 'ידני?', label: 'הוזן ידנית? (כן/ריק)', type: 'text' },
];

export default function ExpensesTab({ app, expenses, suppliers, onChanged, openId, onOpened }) {
  const navigate = useNavigate();
  const canEdit = (app.user?.role || 'owner') === 'owner';
  const [search, setSearch] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fCategory, setFCategory] = useState('');
  // תקופה — אותו בורר כמו בלוח הבקרה; ברירת מחדל: החודש
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [drawer, setDrawer] = useState(null);
  const [linkFor, setLinkFor] = useState(null); // הוצאה שמקשרים לה ספק
  const [form, setForm] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);

  // כרטיס הוצאה פתוח ברענון ברקע של המסך ההורה מסונכרן לרשומה העדכנית
  useEffect(() => {
    setDrawer((cur) => (cur ? (expenses.find((x) => x.id === cur.id) || cur) : cur));
  }, [expenses]);

  // פתיחה ישירה מקישור חיצוני (סעיף P — יומן-ירידות במלאי, "?open=" דרך
  // FinancePage) — ממתינים שהוצאות ייטענו, בדיוק כמו InvoicesPage/DeliveryNotesPage
  useEffect(() => {
    if (!openId || !expenses.length) return;
    const e = expenses.find((x) => x.id === openId);
    if (e) setDrawer(e);
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, expenses]);

  const categories = useMemo(() => [...new Set(expenses.map(expCategory).filter(Boolean))], [expenses]);
  const supplierNames = useMemo(() => [...new Set(expenses.map(supplierName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [expenses]);

  const range = useMemo(() => periodRange(preset, from, to), [preset, from, to]);
  const filtered = useMemo(() => expenses.filter((e) => {
    if (fSupplier && supplierName(e) !== fSupplier) return false;
    if (fCategory && expCategory(e) !== fCategory) return false;
    if (!inPeriod(expDate(e), range)) return false;
    if (search) {
      const hay = [supplierName(e), expCategory(e), e['אמצעי תשלום'], e['הערות']].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => String(expDate(b) || '').localeCompare(String(expDate(a) || ''))), [expenses, search, fSupplier, fCategory, range]);

  const total = filtered.reduce((s, e) => s + expAmount(e), 0);
  // כיתוב התקופה בכרטיסים ובגרפים — בדיוק מה שהטבלה מסננת
  const caption = periodCaption(preset, from, to);
  const periodSub = (fSupplier || fCategory) ? `${caption} · לפי הסינון` : caption;

  const byMonth = useMemo(() => {
    const b = {};
    filtered.forEach((e) => {
      const d = new Date(expDate(e));
      if (Number.isNaN(d.getTime())) return;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      b[k] = (b[k] || 0) + expAmount(e);
    });
    return Object.entries(b).sort((a, b2) => a[0].localeCompare(b2[0])).map(([k, v]) => ({ month: k, סכום: Math.round(v) }));
  }, [filtered]);

  const bySupplier = useMemo(() => {
    const b = {};
    filtered.forEach((e) => { const k = supplierName(e) || 'אחר'; b[k] = (b[k] || 0) + expAmount(e); });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: Math.round(v) })).filter((x) => x.value > 0);
  }, [filtered]);

  const hasFilters = search || fSupplier || fCategory || preset !== 'month' || from || to;

  return (
    <div>
      {/* KPI (סעיף 25) */}
      <div className="kpi-grid">
        <Kpi icon="🧾" soft="var(--expense-soft)" color="var(--expense)" label="סה&quot;כ הוצאות" value={filtered.length ? kpiMoney(total) : 'אין נתונים'} sub={periodSub} />
        <Kpi icon="📄" soft="var(--docs-soft)" color="var(--docs)" label="מספר חשבוניות" value={filtered.length} sub={periodSub} />
        <Kpi icon="🚚" soft="var(--inventory-soft)" color="var(--inventory)" label="מספר ספקים" value={new Set(filtered.map(supplierName).filter(Boolean)).size} sub={periodSub} />
      </div>

      {/* חיפוש + פילטרים */}
      <div className="filter-bar no-print" style={{ marginTop: 18 }}>
        <input className="input" aria-label="חיפוש הוצאה" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" aria-label="סינון לפי ספק" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}>
          <option value="">כל הספקים</option>
          {supplierNames.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" aria-label="סינון לפי קטגוריה" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
          <option value="">כל הקטגוריות</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <PeriodSelect preset={preset} from={from} to={to} onPreset={setPreset} onFrom={setFrom} onTo={setTo} />
        {hasFilters && <button className="btn btn-ghost" onClick={() => { setSearch(''); setFSupplier(''); setFCategory(''); setPreset('month'); setFrom(''); setTo(''); }}>נקה פילטרים</button>}
        <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨️ הדפסה</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/upload', { state: { docType: 'חשבונית הוצאה' } })}>⬆️ העלאת חשבונית הוצאה</button>
          {canEdit && <button type="button" className="btn btn-ghost" onClick={() => setManualOpen(true)}>➕ הוצאה ידנית</button>}
        </span>
      </div>

      {/* טבלה */}
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>הוצאות ({filtered.length})</div>
        {filtered.length === 0 ? <div className="empty-state"><div className="icon">🧾</div>אין נתונים לתקופה זו</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>תאריך</th><th>ספק</th><th>קטגוריה</th><th>אמצעי תשלום</th><th>סכום</th><th>מסמך</th><th>מלאי</th><th className="no-print">פעולות</th></tr></thead>
              <tbody>
                {filtered.slice(0, limit).map((e) => {
                  const link = expSupplierLink(e);
                  const doc = expDoc(e);
                  const aiSummary = inventoryAiSummary(readInventoryAiState(e['הערות']));
                  return (
                    <tr key={e.id} {...activatable(() => setDrawer(e), 'פתיחת פרטי ההוצאה')}>
                      <td>{expDate(e) ? formatDate(expDate(e)) : 'לא זמין'}</td>
                      <td>
                        {link ? (
                          <span className="obj-chip"
                            {...activatable((ev) => { ev.stopPropagation(); navigate(`/suppliers?supplier=${firstId(e['ספקים'])}`); }, `פתיחת כרטיס הספק ${supplierName(e) || ''}`)}>
                            🚚 {supplierName(e) || 'ספק'}
                          </span>
                        ) : supplierName(e) ? (
                          <span title="זוהה על ידי AI — עדיין ללא קישור לרשומת ספק">{supplierName(e)} <span className="muted" style={{ fontSize: 11 }}>(זוהה)</span></span>
                        ) : 'לא זמין'}
                      </td>
                      <td>{expCategory(e) || '—'}</td>
                      <td>{e['אמצעי תשלום'] || '—'}</td>
                      <td style={{ fontWeight: 700, color: 'var(--expense)' }}>{formatMoney(expAmount(e))}</td>
                      <td>{doc ? <a href={doc.url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} aria-label="פתיחת המסמך">📎</a> : <span className="badge badge-warn">חסר</span>}</td>
                      <td>
                        {aiSummary ? (
                          <span className={`badge ${aiSummary.kind === 'ok' ? 'badge-ok' : aiSummary.kind === 'warn' ? 'badge-warn' : aiSummary.kind === 'error' ? 'badge-error' : ''}`} title={aiSummary.text}>
                            📦 {aiSummary.kind === 'ok' ? '✓' : aiSummary.kind === 'warn' ? '⚠' : aiSummary.kind === 'error' ? '✕' : '—'}
                          </span>
                        ) : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                      </td>
                      <td className="no-print">
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-ghost" aria-label="פתח פרטים" title="פתח פרטים" onClick={(ev) => { ev.stopPropagation(); setDrawer(e); }}>👁</button>
                          {canEdit && !link && supplierName(e) && (
                            <button className="btn btn-sm btn-ghost" title="קשר לספק" onClick={(ev) => { ev.stopPropagation(); setLinkFor(e); }}>🔗 קשר לספק</button>
                          )}
                          {canEdit && (
                            <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                              onClick={async (ev) => {
                                ev.stopPropagation();
                                if (await removeRecord(app.api, TABLE, e.id, 'ההוצאה')) await onChanged();
                              }}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button className="btn btn-ghost no-print" onClick={() => setLimit((l) => l + 50)}>הצג עוד ({filtered.length - limit} נוספות)</button>
          </div>
        )}
      </div>

      {/* גרפים */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 16, marginTop: 18 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי חודש · {caption}</div>
          {byMonth.length ? (
            <div style={{ direction: 'ltr' }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byMonth} margin={CHART_MARGIN}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...xAxisProps(byMonth.length)} />
                  <YAxis {...yAxisProps({ money: true })} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                  <Bar dataKey="סכום" fill="#F04444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="empty-state">אין נתונים לתקופה זו</div>}
        </div>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי ספק · {caption}</div>
          {bySupplier.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={bySupplier} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78}>
                  {bySupplier.map((_, i) => <Cell key={i} fill={['#F79009', '#F04444', '#09A7B2', '#8B5CF6', '#2878D0'][i % 5]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                <Legend wrapperStyle={LEGEND_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="empty-state">אין נתונים לתקופה זו</div>}
        </div>
      </div>

      {drawer && (
        <ExpenseDrawer
          expense={expenses.find((x) => x.id === drawer.id) || drawer}
          canEdit={canEdit}
          api={app.api}
          onClose={() => setDrawer(null)}
          onLink={() => setLinkFor(expenses.find((x) => x.id === drawer.id) || drawer)}
          onEdit={() => setForm(expenses.find((x) => x.id === drawer.id) || drawer)}
          onOpenSupplier={(id) => navigate(`/suppliers?supplier=${id}`)}
          onChanged={onChanged}
        />
      )}

      {linkFor && (
        <LinkSupplierModal
          api={app.api}
          expense={linkFor}
          suppliers={suppliers}
          onClose={() => setLinkFor(null)}
          onLinked={async () => { setLinkFor(null); await onChanged(); toast('הספק קושר בהצלחה'); }}
        />
      )}

      {form !== null && (
        <RecordForm
          api={app.api} table={TABLE}
          title="עריכת הוצאה"
          record={form}
          fields={EDIT_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); }}
        />
      )}

      {manualOpen && (
        <ManualExpenseModal
          categories={categories}
          suppliers={suppliers}
          onClose={() => setManualOpen(false)}
          // תיקון-ביצועים (סעיף R, 2026-10-07): לא ממתינים ל-onChanged —
          // החלון נסגר מיד, הרשימה מתרעננת ברקע (ר' גם server.js: הורדת
          // המלאי עצמה הפכה fire-and-forget, אז אין סיבה שהלקוח יחסום כאן)
          onSaved={() => { setManualOpen(false); toast('ההוצאה הידנית נשמרה'); onChanged(); }}
        />
      )}
    </div>
  );
}

function Kpi({ icon, soft, color, label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top"><div className="kpi-icon" style={{ background: soft }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className={kpiValueClass(value)} style={{ color }}>{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : <div style={{ height: 12 }} />}
    </div>
  );
}

// כרטיס הוצאה — פרטים מלאים ללא שורות ריקות + פעולות
function ExpenseDrawer({ expense, canEdit, api, onClose, onLink, onEdit, onOpenSupplier, onChanged }) {
  useEscapeClose(onClose);
  const link = expSupplierLink(expense);
  const doc = expDoc(expense);
  const rows = [
    ['תאריך', expDate(expense) ? formatDate(expDate(expense)) : null],
    ['קטגוריה', expCategory(expense)],
    ['סכום', expAmount(expense) ? formatMoney(expAmount(expense)) : null],
    ['אמצעי תשלום', expense['אמצעי תשלום']],
    ['הוזן ידנית', expense['ידני?'] ? 'כן' : null],
  ].filter(([, v]) => v != null && v !== '');

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>🧾 הוצאה {supplierName(expense) ? `· ${supplierName(expense)}` : ''}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>פרטי ההוצאה</div>
            <div className="obj-row">
              <span className="obj-row-label">ספק</span>
              <span className="obj-row-value">
                {link ? (
                  <span className="obj-chip"
                    {...activatable(() => onOpenSupplier(firstId(expense['ספקים'])), `פתיחת כרטיס הספק ${supplierName(expense) || ''}`)}>
                    🚚 {supplierName(expense) || 'ספק'}
                  </span>
                ) : supplierName(expense) ? (
                  <span>
                    ספק שזוהה: <b>{supplierName(expense)}</b>{' '}
                    {canEdit && <button type="button" className="btn btn-sm btn-ghost" onClick={onLink}>🔗 קשר לספק</button>}
                  </span>
                ) : 'לא זמין'}
              </span>
            </div>
            {rows.map(([l, v]) => (
              <div key={l} className="obj-row"><span className="obj-row-label">{l}</span><span className="obj-row-value">{v}</span></div>
            ))}
            <NotesRow api={api} expense={expense} canEdit={canEdit} onChanged={onChanged} />
            {canEdit && (
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-ghost" onClick={onEdit}>✎ עריכה</button>
              </div>
            )}
          </div>

          {doc && (
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>המסמך המצורף</div>
              {String(doc.type || '').startsWith('image/') && (
                <img src={doc.thumbnails?.large?.url || doc.url} alt={doc.filename || 'חשבונית'} style={{ maxWidth: '100%', borderRadius: 10, marginBottom: 10 }} />
              )}
              <a className="btn btn-ghost" href={doc.url} target="_blank" rel="noopener noreferrer">📎 פתח מסמך {doc.filename ? `(${doc.filename})` : ''}</a>
            </div>
          )}

          {canEdit && <InventoryAiSection expense={expense} onChanged={onChanged} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// שורת "הערות" בכרטיס הוצאה (סעיף R, 2026-10-07) — מציגה את ההערות
// עם הסמן הפנימי [מלאי-AI]{...} מוסתר (ר' stripInventoryAiMarker),
// ומאפשרת עריכה ישירה (בלי לעבור דרך RecordForm הגנרי, כדי לא לאבד
// את הסמן בשמירה — ר' withPreservedInventoryTags: רק הטקסט החופשי
// מוחלף, התגיות הפנימיות נשמרות בדיוק כפי שהיו).
// ============================================================
function NotesRow({ api, expense, canEdit, onChanged }) {
  const raw = expense['הערות'];
  const display = stripInventoryAiMarker(raw);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);
  const [saving, setSaving] = useState(false);

  if (!editing && !display && !canEdit) return null;

  if (!editing) {
    return (
      <div className="obj-row">
        <span className="obj-row-label">הערות</span>
        <span className="obj-row-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {display || <span className="muted">—</span>}
          {canEdit && (
            <button type="button" className="btn btn-sm btn-ghost" aria-label="עריכת הערות" title="עריכת הערות"
              onClick={() => { setDraft(display); setEditing(true); }}>✎</button>
          )}
        </span>
      </div>
    );
  }

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = withPreservedInventoryTags(raw, draft);
      await api.update(TABLE, expense.id, { 'הערות': next || null });
      setEditing(false);
      await onChanged?.();
    } catch (e) {
      toast(`שמירת ההערות נכשלה: ${e.message || e}`, 'error');
    }
    setSaving(false);
  };

  return (
    <div className="obj-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <span className="obj-row-label">הערות</span>
      <textarea className="input" rows={2} aria-label="הערות להוצאה" autoFocus value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" className="btn btn-sm btn-ghost" disabled={saving} onClick={() => setEditing(false)}>ביטול</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={save}>{saving ? 'שומר...' : 'שמירה'}</button>
      </div>
    </div>
  );
}

// ============================================================
// "המסמך גרם להורדה של: <כמות> ממלאי: <שם הסוג>" — תצוגת תוצאת
// ניתוח המלאי האוטומטי + כפתור ניתוח/ניתוח-מחדש + אישור שורות
// שסומנו "דורש אישור" (ביטחון נמוך/יחידת מידה לא ברורה).
// ============================================================
function InventoryAiSection({ expense, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = readInventoryAiState(expense['הערות']);
  const results = Array.isArray(state?.results) ? state.results : [];

  const run = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await authFetch(`/api/expenses/${expense.id}/analyze-inventory`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'שגיאה');
      await onChanged?.();
    } catch (e) {
      setError(`הניתוח נכשל: ${e.message || e}`);
    }
    setBusy(false);
  };

  const approve = async (lineIndex) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await authFetch(`/api/expenses/${expense.id}/analyze-inventory/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineIndex }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'שגיאה');
      await onChanged?.();
    } catch (e) {
      setError(`האישור נכשל: ${e.message || e}`);
    }
    setBusy(false);
  };

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>📦 ניתוח מלאי אוטומטי</div>
      {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 10 }}>⚠️ {error}</div>}

      {!state && <div className="muted" style={{ marginBottom: 10 }}>המסמך עדיין לא נותח למלאי.</div>}
      {state?.status === 'failed' && (
        <div className="badge badge-error" style={{ width: '100%', marginBottom: 10 }}>✕ הניתוח נכשל: {state.error || 'שגיאה לא ידועה'}</div>
      )}
      {state && state.status !== 'failed' && !results.length && (
        <div className="muted" style={{ marginBottom: 10 }}>לא נמצאו פריטי מלאי במסמך.</div>
      )}

      {results.map((r, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none' }}>
          {r.deducted ? (
            <div className="badge badge-ok" style={{ width: '100%' }}>
              📦 המסמך גרם להורדה של: {r.quantity} ממלאי: {r.category}
              {r.approvedManually && <span className="muted"> (אושר ידנית)</span>}
            </div>
          ) : r.error ? (
            <div className="badge badge-error" style={{ width: '100%' }}>✕ {r.description} — {r.error}</div>
          ) : r.needsApproval ? (
            <div className="badge badge-warn" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>⚠ {r.description} ({r.quantity ?? '?'} {r.unit || ''}) → {r.category} — {r.reason}</span>
              <button type="button" className="btn btn-sm btn-success" disabled={busy} onClick={() => approve(i)}>✓ אשר הורדה</button>
            </div>
          ) : null}
        </div>
      ))}

      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={run}>
          {busy ? 'מנתח...' : state ? '🔄 נתח מחדש' : '🔍 נתח מלאי'}
        </button>
      </div>
    </div>
  );
}

const MANUAL_FILE_MAX_MB = 15;

// תמונות גדולות מוקטנות בצד הלקוח לפני השליחה (בדיוק כמו ב-UploadDocumentPage) —
// מקצר זמן העלאה ועוזר לעמוד במגבלת 5MB של Airtable; PDF לא משתנה.
async function shrinkManualExpenseImage(f, maxDim = 2000, quality = 0.85) {
  if (!f.type.startsWith('image/') || f.size < 1.2 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.(png|jpe?g)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch { return f; }
}

// שדות "יחידה"/"unitOther" הוסרו בכוונה (סעיף R, 2026-10-07): לא
// רלוונטיים להפחתת כמות מהמלאי (ר' matchLinesToInventory — מתעלם
// מיחידת-מידה כשאינה מוגדרת, ועדיין מוריד לפי כמות גרידא).
const emptyLine = () => ({ description: '', quantity: '' });

// ============================================================
// הוצאה ידנית (תוספת 2026-10-06; עודכן סעיף J; עודכן סעיף R —
// ספק מרשימה קיימת בלבד, בלי שדה "יחידה") — טופס להזנת הוצאה עם או
// בלי קובץ מצורף, שנשמרת בדיוק כמו הוצאה שהועלתה ונותחה אוטומטית
// (ידני?=true, אותם שדות -AI, אותה הורדת מלאי ואותה לוגיקת ביטול
// במחיקה). כל 4 שדות הראש (ספק/תאריך/סכום/קטגוריה) חובה, ושורת פריט
// שאינה ריקה-לגמרי חייבת למלא את שני שדותיה — הוולידציה חוזרת גם
// בשרת (ר' validateManualExpenseInput), לא רק כאן.
// ============================================================
function ManualExpenseModal({ categories, suppliers, onClose, onSaved }) {
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState('');
  const [total, setTotal] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [itemOptions, setItemOptions] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [lineErrs, setLineErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // עקביות עם LinkSupplierModal (אותו קובץ) ועם DeleteConfirm: Escape סוגר,
  // אבל לא באמצע שמירה — אותה הגנה בדיוק שיש ללחיצה על הרקע
  useEscapeClose(onClose, !saving);
  useEscapeClose(onClose, !saving);

  // רשימת-בחירה ל"מה נקנה" — קטגוריות המלאי הקיימות בפועל (datalist,
  // עדיין עם טקסט חופשי). אלו גם הקטגוריות ש-matchLinesToInventory
  // מתאים אליהן בפועל, כך שבחירה מהרשימה מבטיחה הורדת מלאי תקינה.
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/select-options/${encodeURIComponent('מלאי בסיסי')}/${encodeURIComponent('קטגוריה')}`)
      .then((r) => (r.ok ? r.json() : { choices: [] }))
      .then((d) => { if (!cancelled) setItemOptions(Array.isArray(d.choices) ? d.choices : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const pickFile = async (f) => {
    if (!f) return;
    const okType = /\.(pdf|jpe?g|png)$/i.test(f.name) || ['application/pdf', 'image/jpeg', 'image/png'].includes(f.type);
    if (!okType) { setFileError('סוג קובץ לא נתמך. יש להעלות PDF, JPG או PNG.'); return; }
    if (f.size > MANUAL_FILE_MAX_MB * 1024 * 1024) { setFileError(`הקובץ גדול מדי (מקסימום ${MANUAL_FILE_MAX_MB}MB).`); return; }
    const small = await shrinkManualExpenseImage(f);
    if (small.size > 5 * 1024 * 1024) { setFileError('הקובץ גדול מ-5MB גם לאחר כיווץ — יש להעלות קובץ קטן יותר.'); return; }
    setFile(small); setFileError('');
  };

  // בדיקה מקומית לפני שליחה — אותם כללים שהשרת אוכף גם כן (לא תחליף
  // לבדיקת השרת, רק כדי להציג הודעה ליד השדה בלי סיבוב-שרת מיותר)
  const validate = () => {
    const fe = {
      supplier: !supplierId,
      date: !date,
      total: total === '' || total == null || Number.isNaN(Number(total)),
      category: !category.trim(),
    };
    const le = {};
    lines.forEach((l, i) => {
      const desc = l.description.trim();
      const hasQty = l.quantity !== '';
      if (!desc && !hasQty) return; // שורה ריקה-לגמרי — מתעלמים
      const missing = [];
      if (!desc) missing.push('מה נקנה');
      if (!hasQty || Number.isNaN(Number(l.quantity))) missing.push('כמות');
      if (missing.length) le[i] = `שורה ${i + 1}: חסר/ה ${missing.join(', ')}`;
    });
    const ok = !Object.values(fe).some(Boolean) && !Object.keys(le).length;
    return { fe, le, ok };
  };

  const save = async () => {
    if (saving) return;
    const { fe, le, ok } = validate();
    setFieldErrors(fe); setLineErrs(le);
    if (!ok) { setError('יש להשלים את השדות המסומנים'); return; }
    setSaving(true); setError('');
    try {
      const cleanLines = lines
        .filter((l) => l.description.trim() || l.quantity !== '')
        .map((l) => ({
          description: l.description.trim(),
          quantity: l.quantity === '' ? null : Number(l.quantity),
        }));

      let r;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('supplierId', supplierId);
        fd.append('date', date);
        fd.append('total', total);
        fd.append('category', category.trim());
        if (notes.trim()) fd.append('notes', notes.trim());
        fd.append('lines', JSON.stringify(cleanLines));
        r = await authFetch('/api/expenses/manual', { method: 'POST', body: fd });
      } else {
        r = await authFetch('/api/expenses/manual', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supplierId, date, total: Number(total), category: category.trim(), notes: notes.trim() || null, lines: cleanLines }),
        });
      }
      const data = await r.json().catch(() => ({}));
      if (data.invalidFile) { setError(data.error || 'הקובץ אינו תקין.'); setSaving(false); return; }
      if (!r.ok) throw new Error(data.error || 'שגיאה');
      if (data.fileError) toast(data.fileError, 'error');
      // תיקון-ביצועים (סעיף R): לא ממתינים יותר ל-onSaved (שעלול לכלול
      // רענון-רשימה) לפני שהחלון נסגר — ר' onSaved שהועבר מההורה.
      onSaved();
    } catch (e) {
      setError(`השמירה נכשלה: ${e.message || e}`);
      setSaving(false);
    }
  };

  const errText = (msg) => <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{msg}</div>;

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      {/* min(...) כדי לא לבטל את `max-width: 92vw` של `.modal` — maxWidth:620
          לבדו היה עוקף אותו לגמרי (סטייל אינליין > CSS), והמודאל (width:480
          מה-CSS) היה גולש מעבר לרוחב-מסך של נייד (ר' תיקון דומה בדראור
          יומן-הירידות במלאי, מקבץ 2 של משימה U) */}
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(620px, 92vw)' }}>
        <h3 style={{ textAlign: 'center' }}>➕ הוצאה ידנית</h3>
        <div className="muted" style={{ textAlign: 'center', marginBottom: 12, fontSize: 13 }}>
          ניתן להזין הוצאה עם או בלי קובץ מצורף — הנתונים נכנסים לכל הדוחות בדיוק כמו הוצאה שהועלתה.
        </div>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}

        <div className="form-grid-2" style={{ gap: '0 12px' }}>
          <div className="form-group">
            <label>ספק<span className="required" /></label>
            {suppliers.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                אין ספקים —{' '}
                {/* ניווט פנימי: כפתור עם .crumb-link (הדפוס הקיים לקישור-טקסט במערכת),
                    לא <a href> — תג עוגן גורם לטעינה-מחדש מלאה אם ה-preventDefault נכשל */}
                <button type="button" className="crumb-link"
                  onClick={() => { onClose(); navigate('/suppliers'); }}>הוסיפי במסך ספקים</button>
              </div>
            ) : (
              <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">בחר ספק...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s['שם ספק'] || 'ספק ללא שם'}</option>)}
              </select>
            )}
            {fieldErrors.supplier && errText('שדה חובה')}
          </div>
          <div className="form-group">
            <label>תאריך<span className="required" /></label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            {fieldErrors.date && errText('שדה חובה')}
          </div>
          <div className="form-group">
            <label>סכום כולל (₪)<span className="required" /></label>
            <input type="number" className="input" value={total} onChange={(e) => setTotal(e.target.value)} />
            {fieldErrors.total && errText('שדה חובה')}
          </div>
          <div className="form-group">
            <label>קטגוריה<span className="required" /></label>
            <input className="input" list="manual-expense-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="manual-expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            {fieldErrors.category && errText('שדה חובה')}
          </div>
        </div>
        <label style={{ display: 'block', marginTop: 10 }}>הערות<textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        <div className="section-title" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          פריטים שיורדים מהמלאי (לא חובה)
          <span className="muted" style={{ fontSize: 13, cursor: 'help' }} title={'כמות שהוזנה כאן נחשבת סופית — יורדת מהמלאי אוטומטית (ללא "דורש אישור"), בכפוף להתאמת קטגוריה קיימת.'}>ⓘ</span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          רשמי מה נקנה במסמך הזה. כל שורה תוריד את הכמות מהמלאי לפי הקטגוריה המתאימה.
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 2, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          <span style={{ flex: 2 }}>מה נקנה</span>
          <span style={{ flex: 1 }}>כמות</span>
          <span style={{ width: 30 }} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
          <span style={{ flex: 2 }}>לדוגמה: שקיות ניילון</span>
          <span style={{ flex: 1 }}>500</span>
          <span style={{ width: 30 }} />
        </div>

        {lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input" style={{ flex: 2 }} aria-label="מה נקנה" list="manual-expense-items"
                value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              <input type="number" className="input" style={{ flex: 1 }} aria-label="כמות"
                value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <button type="button" className="btn btn-sm btn-ghost" aria-label="הסרת שורה" onClick={() => removeLine(i)} disabled={lines.length === 1}>✕</button>
            </div>
            {lineErrs[i] && errText(lineErrs[i])}
          </div>
        ))}
        <datalist id="manual-expense-items">{itemOptions.map((c) => <option key={c} value={c} />)}</datalist>
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLine}>+ הוספת פריט נוסף</button>

        <div className="section-title" style={{ marginTop: 16 }}>קובץ המסמך (לא חובה)</div>
        {!file ? (
          <label className="btn btn-ghost" style={{ display: 'inline-flex', cursor: 'pointer' }}>
            📎 בחירת קובץ
            <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        ) : (
          <div className="card" style={{ background: 'var(--bg-main)', display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}>
            <span style={{ fontSize: 22 }}>📄</span>
            <span style={{ flex: 1, overflowWrap: 'anywhere', fontSize: 13 }}>{file.name}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFile(null)}>✕ הסר</button>
          </div>
        )}
        {fileError && errText(fileError)}

        <div className="form-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'שומר...' : 'שמירה'}</button>
        </div>
      </div>
    </div>
  );
}

// חלון "קשר לספק" — חיפוש, בחירה, כתיבת הקישור ל-Airtable
function LinkSupplierModal({ api, expense, suppliers, onClose, onLinked }) {
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  const list = suppliers.filter((s) => !q || String(s['שם ספק'] || '').toLowerCase().includes(q.toLowerCase()));
  const detected = expSupplierAI(expense);

  const choose = async (s) => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.update(TABLE, expense.id, { 'ספקים': [s.id] });
      await onLinked();
    } catch (e) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>קשר לספק</h3>
        {detected && <div style={{ textAlign: 'center', marginBottom: 10, color: 'var(--text-secondary)' }}>ספק שזוהה: <b>{detected}</b></div>}
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <input className="input" style={{ width: '100%', marginBottom: 12 }} placeholder="חיפוש ספק..." autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {list.length === 0 && <div className="empty-state">לא נמצאו ספקים</div>}
          {list.map((s) => (
            <button key={s.id} type="button" className="btn btn-ghost" disabled={saving}
              style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6 }}
              onClick={() => choose(s)}>
              🚚 {s['שם ספק'] || 'ספק'}{s['תחום אספקה'] ? ` · ${s['תחום אספקה']}` : ''}
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}
