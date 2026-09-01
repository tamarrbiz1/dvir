// ============================================================
// הוצאות (סעיף 25) — טבלה מלאה, כרטיס הוצאה, ו"קשר לספק"
// ------------------------------------------------------------
// שמות תצוגה נקיים: ספק-AI → ספק · תאריך חשבונית-AI → תאריך ·
// סכום כולל-AI → סכום · קטגוריית חשבונית-AI → קטגוריה.
// כאשר קיים זיהוי AI בלי Linked Record — מוצג "ספק שזוהה" עם
// פעולת [קשר לספק] שכותבת את הקישור האמיתי ל-Airtable.
// ============================================================
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, formatDate } from '../utils/format.js';
import { pick, num, expenseCategory } from '../utils/field.js';
import { firstId } from '../utils/resolve.js';
import RecordForm from '../components/RecordForm.jsx';
import { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import { exportCsv, fileStamp, inDateRange } from '../utils/table.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

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

const EDIT_FIELDS = [
  { name: 'אמצעי תשלום', label: 'אמצעי תשלום', type: 'select' },
  { name: 'תאריך העלאת החשבונית', label: 'תאריך העלאה', type: 'date' },
  { name: 'ידני?', label: 'הוזן ידנית? (כן/ריק)', type: 'text' },
  { name: 'הערות', label: 'הערות', type: 'textarea' },
];

export default function ExpensesTab({ app, expenses, suppliers, onChanged }) {
  const navigate = useNavigate();
  const canEdit = (app.user?.role || 'owner') === 'owner';
  const [search, setSearch] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [drawer, setDrawer] = useState(null);
  const [linkFor, setLinkFor] = useState(null); // הוצאה שמקשרים לה ספק
  const [form, setForm] = useState(null);

  const categories = useMemo(() => [...new Set(expenses.map(expCategory).filter(Boolean))], [expenses]);
  const supplierNames = useMemo(() => [...new Set(expenses.map(supplierName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [expenses]);

  const filtered = useMemo(() => expenses.filter((e) => {
    if (fSupplier && supplierName(e) !== fSupplier) return false;
    if (fCategory && expCategory(e) !== fCategory) return false;
    if (!inDateRange(expDate(e), from, to)) return false;
    if (search) {
      const hay = [supplierName(e), expCategory(e), e['אמצעי תשלום'], e['הערות']].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => String(expDate(b) || '').localeCompare(String(expDate(a) || ''))), [expenses, search, fSupplier, fCategory, from, to]);

  const total = filtered.reduce((s, e) => s + expAmount(e), 0);
  const now = new Date();
  const thisMonth = filtered.filter((e) => {
    const d = new Date(expDate(e));
    return !Number.isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((s, e) => s + expAmount(e), 0);

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

  const hasFilters = search || fSupplier || fCategory || from || to;

  const doExport = () => exportCsv(`הוצאות-${fileStamp()}`, [
    { label: 'תאריך', get: (e) => (expDate(e) ? formatDate(expDate(e)) : '') },
    { label: 'ספק', get: supplierName },
    { label: 'קטגוריה', get: (e) => expCategory(e) || '' },
    { label: 'אמצעי תשלום', get: (e) => e['אמצעי תשלום'] || '' },
    { label: 'סכום (₪)', get: (e) => expAmount(e) || '' },
    { label: 'הערות', get: (e) => e['הערות'] || '' },
  ], filtered);

  return (
    <div>
      {/* KPI (סעיף 25) */}
      <div className="kpi-grid">
        <Kpi icon="🧾" soft="var(--expense-soft)" color="var(--expense)" label="סה&quot;כ הוצאות" value={filtered.length ? formatMoney(total) : 'אין נתונים'} />
        <Kpi icon="📅" soft="var(--expense-soft)" color="var(--expense)" label="הוצאות החודש" value={formatMoney(thisMonth)} />
        <Kpi icon="📄" soft="var(--docs-soft)" color="var(--docs)" label="מספר חשבוניות" value={filtered.length} />
        <Kpi icon="🚚" soft="var(--inventory-soft)" color="var(--inventory)" label="מספר ספקים" value={new Set(filtered.map(supplierName).filter(Boolean)).size} />
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
        <label className="date-field">מתאריך<input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="date-field">עד תאריך<input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {hasFilters && <button className="btn btn-ghost" onClick={() => { setSearch(''); setFSupplier(''); setFCategory(''); setFrom(''); setTo(''); }}>נקה פילטרים</button>}
        <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨️ הדפסה</button>
          <button type="button" className="btn btn-ghost" onClick={doExport} disabled={!filtered.length}>⬇️ ייצוא</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/upload', { state: { docType: 'חשבונית הוצאה' } })}>⬆️ העלאת חשבונית הוצאה</button>
        </span>
      </div>

      {/* טבלה */}
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>הוצאות ({filtered.length})</div>
        {filtered.length === 0 ? <div className="empty-state"><div className="icon">🧾</div>אין נתונים לתקופה זו</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>תאריך</th><th>ספק</th><th>קטגוריה</th><th>אמצעי תשלום</th><th>סכום</th><th>מסמך</th><th className="no-print">פעולות</th></tr></thead>
              <tbody>
                {filtered.slice(0, limit).map((e) => {
                  const link = expSupplierLink(e);
                  const doc = expDoc(e);
                  return (
                    <tr key={e.id} {...activatable(() => setDrawer(e), 'פתיחת פרטי ההוצאה')}>
                      <td>{expDate(e) ? formatDate(expDate(e)) : 'לא זמין'}</td>
                      <td>
                        {link ? (
                          <span className="obj-chip" role="button" tabIndex={0}
                            onClick={(ev) => { ev.stopPropagation(); navigate(`/suppliers?supplier=${firstId(e['ספקים'])}`); }}
                            onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); navigate(`/suppliers?supplier=${firstId(e['ספקים'])}`); } }}>
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
          <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי חודש</div>
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
          <div className="section-title" style={{ marginTop: 0 }}>הוצאות לפי ספק</div>
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
          onClose={() => setDrawer(null)}
          onLink={() => setLinkFor(expenses.find((x) => x.id === drawer.id) || drawer)}
          onEdit={() => setForm(expenses.find((x) => x.id === drawer.id) || drawer)}
          onOpenSupplier={(id) => navigate(`/suppliers?supplier=${id}`)}
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
    </div>
  );
}

function Kpi({ icon, soft, color, label, value }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top"><div className="kpi-icon" style={{ background: soft }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      <div style={{ height: 12 }} />
    </div>
  );
}

// כרטיס הוצאה — פרטים מלאים ללא שורות ריקות + פעולות
function ExpenseDrawer({ expense, canEdit, onClose, onLink, onEdit, onOpenSupplier }) {
  useEscapeClose(onClose);
  const link = expSupplierLink(expense);
  const doc = expDoc(expense);
  const rows = [
    ['תאריך', expDate(expense) ? formatDate(expDate(expense)) : null],
    ['קטגוריה', expCategory(expense)],
    ['סכום', expAmount(expense) ? formatMoney(expAmount(expense)) : null],
    ['אמצעי תשלום', expense['אמצעי תשלום']],
    ['הוזן ידנית', expense['ידני?'] ? 'כן' : null],
    ['הערות', expense['הערות']],
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
                  <span className="obj-chip" role="button" tabIndex={0} onClick={() => onOpenSupplier(firstId(expense['ספקים']))}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpenSupplier(firstId(expense['ספקים'])); }}>
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
