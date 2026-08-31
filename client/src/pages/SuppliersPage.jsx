import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatMoney, formatDate, safeValue } from '../utils/format.js';
import { pick, num } from '../utils/field.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import PageHeader from '../components/PageHeader.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';

// ============================================================
// ספקים (סעיף 24)
// ============================================================

const SUPPLIER_TABS = ['פרטים', 'הוצאות', "צ'קים", 'מלאי קשור'];

export default function SuppliersPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    Promise.all([
      app.api.get('ספקים', '?maxRecords=200'),
      app.api.get('הוצאות', '?maxRecords=400'),
      app.api.get('צ׳קים', '?maxRecords=300'),
    ])
      .then(([s, e, c]) => {
        setItems(Array.isArray(s) ? s : []);
        setExpenses(Array.isArray(e) ? e : []);
        setChecks(Array.isArray(c) ? c : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter((s) => {
    if (!search) return true;
    return String(pick(s, ['שם ספק', 'איש קשר']) || '').toLowerCase().includes(search.toLowerCase());
  });

  const supplierExpenses = (id) => expenses.filter((e) => {
    const ref = e['ספקים'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === id);
    return false;
  });

  const supplierChecks = (id) => checks.filter((c) => {
    const ref = c['ספק'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === id);
    return false;
  });

  return (
    <div>
      <PageHeader icon="🚚" title="ספקים">
        <input className="input" aria-label="חיפוש ספק" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </PageHeader>
      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <div className="grid">
          {filtered.map((s) => (
            <div key={s.id} className="card clickable" {...activatable(() => setDrawer(s), `פתיחת כרטיס ספק ${s['שם ספק'] || ''}`)}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>🚚 {s['שם ספק'] || 'ספק'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <div>איש קשר: {s['איש קשר'] || 'לא זמין'}</div>
                <div>טלפון: {s['טלפון'] || 'לא זמין'}</div>
                <div>{s['תחום אספקה'] || ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <SupplierDrawer
          supplier={drawer}
          expenses={supplierExpenses(drawer.id)}
          checks={supplierChecks(drawer.id)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

function SupplierDrawer({ supplier, expenses, checks, onClose }) {
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
          {tab === 'פרטים' && <DetailsTab s={supplier} />}
          {tab === 'הוצאות' && <ExpensesTab list={expenses} />}
          {tab === "צ'קים" && <ChecksTab list={checks} />}
          {tab === 'מלאי קשור' && <div className="empty-state">מידע מלאי קשור יוצג בעתיד</div>}
        </div>
      </div>
    </div>
  );
}

function DetailsTab({ s }) {
  const row = (l, v) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{l}</span><b>{v}</b>
    </div>
  );
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>פרטי ספק</div>
      {row('שם ספק', s['שם ספק'] || 'לא זמין')}
      {row('איש קשר', s['איש קשר'] || 'לא זמין')}
      {row('טלפון', s['טלפון'] || 'לא זמין')}
      {row('אימייל', s['אימייל'] || 'לא זמין')}
      {row('כתובת', s['כתובת'] || 'לא זמין')}
      {row('תחום אספקה', s['תחום אספקה'] || 'לא זמין')}
      {row('תנאי תשלום', s['תנאי תשלום'] || 'לא זמין')}
      {s['הערות'] && <div className="section-title">הערות</div>}
      {s['הערות'] && <div style={{ fontSize: 14 }}>{s['הערות']}</div>}
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

function ChecksTab({ list }) {
  if (!list.length) return <div className="empty-state">אין צ'קים רשומים לספק זה</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>סכום</th><th>תאריך פירעון</th><th>סטטוס</th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td>{formatMoney(c["סכום צ'ק"])}</td>
              <td>{formatDate(c['תאריך פירעון'])}</td>
              <td><span className={`badge ${String(c['סטטוס'] || '').trim() === 'מבוטל' ? 'badge-error' : 'badge-ok'}`}>{c['סטטוס'] || 'לא זמין'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
