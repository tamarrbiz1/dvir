// ============================================================
// ספקים (סעיף 24 + כללי "אל תציג פרטים חסרים" ו"+ הוספת פרטים")
// ------------------------------------------------------------
// כרטיס ספק: פרטים (רק שדות מלאים) / הוצאות / צ'קים / מלאי קשור.
// CRUD מלא לבעל העסק, חיפוש, ייצוא. הכל נכתב ונקרא מ-Airtable.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatMoney, formatDate, formatNumber } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import { useAutoRefresh } from '../utils/live.js';
import { exportCsv, fileStamp } from '../utils/table.js';
import { CHECKS_TABLE, CHECK_FIELDS, checkBelongsToSupplier, checkNumber, checkPayee, sortByDue } from '../utils/checks.js';
import { StatusBadge } from '../components/ChecksTab.jsx';

const TABLE = 'ספקים';
const SUPPLIER_TABS = ['פרטים', 'הוצאות', "צ'קים", 'מלאי קשור'];

// שדות ההזנה הידנית של ספק — ל"הוספת פרטים" ולעריכה
const SUPPLIER_FIELDS = [
  { name: 'שם ספק', label: 'שם ספק', type: 'text', required: true },
  { name: 'איש קשר', label: 'איש קשר', type: 'text' },
  { name: 'טלפון', label: 'טלפון', type: 'text' },
  { name: 'אימייל', label: 'אימייל', type: 'text' },
  { name: 'כתובת', label: 'כתובת', type: 'text' },
  { name: 'תחום אספקה', label: 'תחום אספקה', type: 'multiselect' },
  { name: 'תנאי תשלום', label: 'תנאי תשלום', type: 'select' },
  { name: 'הערות', label: 'הערות', type: 'textarea' },
];

export default function SuppliersPage() {
  const app = useApp();
  const canEdit = (app.user?.role || 'owner') === 'owner';
  const [items, setItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [checks, setChecks] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(null); // {record, fields, title}
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const load = useCallback(() => Promise.all([
    app.api.get(TABLE, '?maxRecords=200'),
    app.api.get('הוצאות', '?maxRecords=500'),
    app.api.get(CHECKS_TABLE, '?maxRecords=300'),
    app.api.get('מלאי בסיסי', '?maxRecords=200'),
  ]).then(([s, e, c, inv]) => {
    const arr = Array.isArray(s) ? s : [];
    setItems(arr);
    setExpenses(Array.isArray(e) ? e : []);
    setChecks(Array.isArray(c) ? c : []);
    setInventory(Array.isArray(inv) ? inv : []);
    // כרטיס ספק פתוח ברענון ברקע מסונכרן לרשומה העדכנית
    setDrawer((cur) => (cur ? (arr.find((x) => x.id === cur.id) || cur) : cur));
    return arr;
  }).catch(() => []), [app.api]);

  // קישור עמוק: /suppliers?supplier=<id> פותח את כרטיס הספק (למשל מצ'ק)
  useEffect(() => {
    const id = searchParams.get('supplier');
    if (!id || !items.length) return;
    const found = items.find((x) => x.id === id);
    if (found) setDrawer(found);
  }, [items, searchParams]);

  const closeDrawer = () => {
    setDrawer(null);
    if (searchParams.has('supplier')) {
      const next = new URLSearchParams(searchParams);
      next.delete('supplier');
      setSearchParams(next, { replace: true });
    }
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load);

  const filtered = items.filter((s) => {
    if (!search) return true;
    const hay = [s['שם ספק'], s['איש קשר'], s['טלפון'], s['תחום אספקה']].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  const supplierExpenses = (id) => expenses.filter((e) => {
    const ref = e['ספקים'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === id);
    return false;
  });
  const supplierChecks = (id) => sortByDue(checks.filter((c) => checkBelongsToSupplier(c, id)));
  const supplierInventory = (id) => inventory.filter((i) => {
    const ref = i['ספקים'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === id);
    return false;
  });

  const doExport = () => exportCsv(`ספקים-${fileStamp()}`, [
    { label: 'שם ספק', get: (s) => s['שם ספק'] || '' },
    { label: 'איש קשר', get: (s) => s['איש קשר'] || '' },
    { label: 'טלפון', get: (s) => s['טלפון'] || '' },
    { label: 'אימייל', get: (s) => s['אימייל'] || '' },
    { label: 'כתובת', get: (s) => s['כתובת'] || '' },
    { label: 'תחום אספקה', get: (s) => (Array.isArray(s['תחום אספקה']) ? s['תחום אספקה'].join(' · ') : s['תחום אספקה']) || '' },
    { label: 'תנאי תשלום', get: (s) => s['תנאי תשלום'] || '' },
  ], filtered);

  // "+ הוספת פרטים": טופס עם השדות החסרים בלבד (ברירת המחדל באיפיון)
  const openAddDetails = (s) => {
    const missing = SUPPLIER_FIELDS.filter((f) => !f.required && (s[f.name] == null || s[f.name] === ''));
    setForm({ record: s, fields: missing.length ? missing : SUPPLIER_FIELDS, title: `הוספת פרטים — ${s['שם ספק'] || 'ספק'}` });
  };
  const openEditAll = (s) => setForm({ record: s, fields: SUPPLIER_FIELDS, title: `עריכת ${s['שם ספק'] || 'ספק'}` });

  return (
    <div>
      <PageHeader icon="🚚" title="ספקים">
        <input className="input no-print" aria-label="חיפוש ספק" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn btn-ghost no-print" onClick={doExport} disabled={!filtered.length}>⬇️ ייצוא</button>
        {canEdit && <button className="btn btn-primary no-print" onClick={() => setForm({ record: null, fields: SUPPLIER_FIELDS, title: 'ספק חדש' })}>+ ספק חדש</button>}
      </PageHeader>
      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <div className="grid">
          {filtered.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}>אין נתונים לתקופה זו</div>}
          {filtered.map((s) => (
            <div key={s.id} className="card clickable" {...activatable(() => setDrawer(s), `פתיחת כרטיס ספק ${s['שם ספק'] || ''}`)}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>🚚 {s['שם ספק'] || 'ספק'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {s['איש קשר'] && <div>איש קשר: {s['איש קשר']}</div>}
                {s['טלפון'] && <div>טלפון: {s['טלפון']}</div>}
                {s['תחום אספקה'] && <div>{Array.isArray(s['תחום אספקה']) ? s['תחום אספקה'].join(' · ') : s['תחום אספקה']}</div>}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button className="btn btn-sm btn-ghost" aria-label="פתח פרטים" title="פתח פרטים" onClick={(e) => { e.stopPropagation(); setDrawer(s); }}>👁</button>
                  <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); openEditAll(s); }}>✎</button>
                  <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await removeRecord(app.api, TABLE, s.id, s['שם ספק'] || 'הספק')) await load();
                    }}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <SupplierDrawer
          supplier={items.find((x) => x.id === drawer.id) || drawer}
          expenses={supplierExpenses(drawer.id)}
          checks={supplierChecks(drawer.id)}
          inventory={supplierInventory(drawer.id)}
          canEdit={canEdit}
          onAddDetails={() => openAddDetails(items.find((x) => x.id === drawer.id) || drawer)}
          onEdit={() => openEditAll(items.find((x) => x.id === drawer.id) || drawer)}
          onClose={closeDrawer}
          onAllChecks={() => navigate(`/finance?tab=checks&supplier=${encodeURIComponent(drawer['שם ספק'] || '')}`)}
        />
      )}

      {form !== null && (
        <RecordForm
          api={app.api} table={TABLE}
          title={form.title}
          record={form.record}
          fields={form.fields}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); }}
        />
      )}
    </div>
  );
}

function SupplierDrawer({ supplier, expenses, checks, inventory, canEdit, onAddDetails, onEdit, onClose, onAllChecks }) {
  useEscapeClose(onClose); // סגירה במקש Escape
  const [tab, setTab] = useState('פרטים');

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>🚚 {supplier['שם ספק'] || 'ספק'}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>

        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#fff', zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {SUPPLIER_TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'active' : ''}`} style={{ fontSize: 12, padding: '6px 10px' }}>{t}</button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'פרטים' && <DetailsTab s={supplier} canEdit={canEdit} onAddDetails={onAddDetails} onEdit={onEdit} />}
          {tab === 'הוצאות' && <ExpensesTab list={expenses} />}
          {tab === "צ'קים" && <ChecksList list={checks} onAllChecks={onAllChecks} />}
          {tab === 'מלאי קשור' && <InventoryTab list={inventory} />}
        </div>
      </div>
    </div>
  );
}

// פרטים — רק שדות שיש בהם מידע; "+ הוספת פרטים" כשחסרים
function DetailsTab({ s, canEdit, onAddDetails, onEdit }) {
  const rows = SUPPLIER_FIELDS
    .filter((f) => f.name !== 'הערות')
    .map((f) => [f.label, Array.isArray(s[f.name]) ? s[f.name].join(' · ') : s[f.name]])
    .filter(([, v]) => v != null && v !== '');
  const hasMissing = SUPPLIER_FIELDS.some((f) => s[f.name] == null || s[f.name] === '');

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>פרטי ספק</div>
      {rows.map(([l, v]) => (
        <div key={l} className="obj-row"><span className="obj-row-label">{l}</span><span className="obj-row-value">{v}</span></div>
      ))}
      {s['הערות'] && (
        <>
          <div className="section-title">הערות</div>
          <div style={{ fontSize: 14 }}>{s['הערות']}</div>
        </>
      )}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {hasMissing && <button className="btn btn-ghost" onClick={onAddDetails}>+ הוספת פרטים</button>}
          <button className="btn btn-ghost" onClick={onEdit}>✎ עריכת כל הפרטים</button>
        </div>
      )}
    </div>
  );
}

function ExpensesTab({ list }) {
  if (!list.length) return <div className="empty-state">אין הוצאות רשומות לספק זה</div>;
  const total = list.reduce((s, e) => s + num(e, ['סכום כולל-AI', 'סכום', 'סכום כולל']), 0);
  return (
    <div>
      <div className="kpi-card" style={{ marginBottom: 14, padding: '14px 14px 0' }}>
        <div className="kpi-top"><span className="kpi-label">סה"כ הוצאות</span></div>
        <div className="kpi-value" style={{ color: 'var(--expense)' }}>{formatMoney(total)}</div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>תאריך</th><th>קטגוריה</th><th>סכום</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(pick(e, ['תאריך חשבונית-AI', 'תאריך העלאת החשבונית', 'תאריך']))}</td>
                <td>{pick(e, ['קטגוריית חשבונית-AI', 'קטגוריה']) || '—'}</td>
                <td style={{ fontWeight: 700 }}>{formatMoney(num(e, ['סכום כולל-AI', 'סכום', 'סכום כולל']))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChecksList({ list, onAllChecks }) {
  if (!list.length) return <div className="empty-state">אין צ'קים רשומים לספק זה</div>;
  const total = list.reduce((s, c) => s + (Number(pick(c, CHECK_FIELDS.amount)) || 0), 0);
  return (
    <div>
      <div className="kpi-card" style={{ marginBottom: 14, padding: '14px 14px 0' }}>
        <div className="kpi-top"><span className="kpi-label">סה"כ צ'קים ({list.length})</span></div>
        <div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(total)}</div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>מס׳</th><th>מוטב</th><th>סכום</th><th>תאריך פירעון</th><th>סטטוס</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>{checkNumber(c) ?? '—'}</td>
                <td>{checkPayee(c) || 'לא זמין'}</td>
                <td style={{ fontWeight: 700 }}>{formatMoney(pick(c, CHECK_FIELDS.amount))}</td>
                <td>{formatDate(pick(c, CHECK_FIELDS.due))}</td>
                <td><StatusBadge check={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onAllChecks && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAllChecks}>כל הצ'קים של הספק במסך כספים ←</button>
        </div>
      )}
    </div>
  );
}

// מלאי קשור — פריטי "מלאי בסיסי" שהספק מקושר אליהם
function InventoryTab({ list }) {
  if (!list.length) return <div className="empty-state">אין פריטי מלאי מקושרים לספק זה</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>קטגוריה</th><th>מלאי נוכחי</th><th>מלאי מינימום</th><th>סטטוס</th></tr></thead>
        <tbody>
          {list.map((i) => {
            const cur = Number(i['מלאי נוכחי']) || 0;
            const min = Number(i['מלאי מינימום']) || 0;
            const low = cur <= min;
            return (
              <tr key={i.id}>
                <td><b>📦 {i['קטגוריה'] || 'פריט'}</b></td>
                <td>{formatNumber(cur)}</td>
                <td>{formatNumber(min)}</td>
                <td><span className={`badge ${low ? 'badge-error' : 'badge-ok'}`}>{low ? 'מלאי נמוך' : 'תקין'}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
