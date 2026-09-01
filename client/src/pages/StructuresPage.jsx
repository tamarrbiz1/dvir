import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatNumber, formatMoney, formatDate, safeValue } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import DeliveryNoteDrawer, { CheckBadge } from '../components/DeliveryNoteDrawer.jsx';
import { DELIVERY_TABLE, noteNumber, noteDate, noteCartons, noteWeight, noteMarketer, noteWeekCode, noteDocument, notesOfStructure } from '../utils/deliveryNotes.js';

const TABS = ['סקירה', 'תוכנית שתילה', 'עבודות', 'קטיפים', 'ריסוסים', 'תפוקה', 'כספים', 'מסמכים'];

export default function StructuresPage() {
  const app = useApp();
  const location = useLocation();
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(null); // {} = חדש, רשומה = עריכה
  const canEdit = (app.user?.role || 'owner') === 'owner'; // CRUD למנהל ראשי בלבד

  const load = () => app.api.get('מבנים', '?maxRecords=200')
    .then((d) => {
      const arr = Array.isArray(d) ? d : [];
      setStructures(arr);
      return arr;
    })
    .catch(() => []);

  useEffect(() => {
    load().then((arr) => {
      // אם קפצנו מהדשבורד עם מבנה נבחר — פותחים את הפירוט שלו
      const open = location.state?.openStructure;
      if (open) setDrawer(arr.find((s) => s.id === open.id) || open);
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.api, location.state]);

  const filtered = structures.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(s['מספר מבנה'] || s['סוג מבנה'] || '').toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader icon="🏗️" title="מבנים">
        <input className="input" aria-label="חיפוש מבנה" placeholder="חיפוש מבנה..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {canEdit && <button className="btn btn-primary" onClick={() => setForm({})}>+ מבנה חדש</button>}
      </PageHeader>

      {loading ? (
        <div className="grid">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div className="grid">
          {filtered.map((s) => (
            <div key={s.id} className="card clickable" {...activatable(() => setDrawer(s), `פתיחת כרטיס מבנה ${s['מספר מבנה'] || s['סוג מבנה'] || ''}`)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <b style={{ fontSize: 18 }}>🏗️ {s['מספר מבנה'] || s['סוג מבנה'] || 'מבנה'}</b>
                <span className={`badge ${s['סטטוס המבנה'] === 'פעיל' ? 'badge-ok' : 'badge-warn'}`}>
                  {s['סטטוס המבנה'] || 'לא זמין'}
                </span>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                <div>סוג: {safeValue(s['סוג מבנה'])}</div>
                <div>שטח: {formatNumber(s['שטח בדונם'])} דונם</div>
                <div>גמלונים: {formatNumber(s['מספר גמלונים'])}</div>
                {displayLinks(s['גידולים']) && <div style={{ marginTop: 8 }}>גידולים: {displayLinks(s['גידולים'])}</div>}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button className="btn btn-sm btn-ghost" aria-label="פתח פרטים" title="פתח פרטים" onClick={(e) => { e.stopPropagation(); setDrawer(s); }}>👁</button>
                  <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); setForm(s); }}>✎</button>
                  <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await removeRecord(app.api, 'מבנים', s.id, s['מספר מבנה'] || 'המבנה')) await load();
                    }}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {drawer && <StructureDetails structure={drawer} api={app.api} onClose={() => setDrawer(null)} />}

      {form !== null && (
        <RecordForm
          api={app.api} table="מבנים"
          title={form.id ? `עריכת ${form['מספר מבנה'] || 'מבנה'}` : 'מבנה חדש'}
          record={form.id ? form : null}
          fields={STRUCTURE_FORM_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); }}
        />
      )}
    </div>
  );
}

// שדות הטופס — שדות קלט בלבד (לא Formula/Lookup/Rollup)
const STRUCTURE_FORM_FIELDS = [
  { name: 'מספר מבנה', label: 'מספר מבנה', type: 'text', required: true },
  { name: 'סוג מבנה', label: 'סוג מבנה', type: 'select' },
  { name: 'סטטוס המבנה', label: 'סטטוס המבנה', type: 'select' },
  { name: 'סוג כיסוי', label: 'סוג כיסוי', type: 'select' },
  { name: 'סוג רשת', label: 'סוג רשת', type: 'select' },
  { name: 'שטח בדונם', label: 'שטח בדונם', type: 'number' },
  { name: 'מספר גמלונים', label: 'מספר גמלונים', type: 'number' },
  { name: 'רוחב גמלון במטרים', label: 'רוחב גמלון (מ׳)', type: 'number' },
  { name: 'מספר שורות במבנה', label: 'מספר שורות', type: 'number' },
  { name: 'אורך שורה במטרים', label: 'אורך שורה (מ׳)', type: 'number' },
  { name: 'מספר שלוחות טפטוף בגמלון', label: 'שלוחות טפטוף בגמלון', type: 'number' },
  { name: 'הערות', label: 'הערות', type: 'textarea' },
];

// ============================================================
// כרטיס מבנה — Tabs (סעיף 11)
// ============================================================
function StructureDetails({ structure, api, onClose }) {
  useEscapeClose(onClose); // סגירה במקש Escape
  const [tab, setTab] = useState('סקירה');
  const [data, setData] = useState({ works: [], harvests: [], sprays: [], planting: [], invoices: [] });
  const [loading, setLoading] = useState(true);

  const structId = structure.id;
  const name = structure['מספר מבנה'] || structure['סוג מבנה'] || 'מבנה';

  useEffect(() => {
    const sid = structId;
    Promise.all([
      api.get('עבודות עובדים', '?maxRecords=2000'),
      api.get('קטיפים', '?maxRecords=1500'),
      api.get('ריסוסים', '?maxRecords=1500'),
      api.get('תוכניות שתילה', '?maxRecords=500'),
      api.get('חשבוניות', '?maxRecords=200&raw=1'),
      api.get(DELIVERY_TABLE, '?maxRecords=1000').catch(() => []),
    ])
      .then(([w, h, s, p, inv, notes]) => {
        const byStruct = (arr, fld) => (Array.isArray(arr) ? arr : []).filter((r) => {
          const v = r[fld];
          if (Array.isArray(v)) return v.some((x) => String(x?.id ?? x) === sid);
          return String(v ?? '') === sid;
        });
        setData({
          works: byStruct(w, 'מבנה'),
          harvests: byStruct(h, 'מבנה'),
          sprays: byStruct(s, 'מבנה'),
          planting: byStruct(p, 'מבנה'),
          invoices: Array.isArray(inv) ? inv : [],
          // תעודות משלוח: של המבנה (לטאב "מסמכים") + כל התעודות (לניווט עמוק בתוך הכרטיס)
          notes: notesOfStructure(Array.isArray(notes) ? notes : [], sid),
          allNotes: Array.isArray(notes) ? notes : [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [structId]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer struct-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>🏗️ מבנה {name}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>

        {/* TAB BAR */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#fff', zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'active' : ''}`} style={{ fontSize: 12, padding: '6px 10px' }}>{t}</button>
          ))}
        </div>

        <div className="drawer-body">
          {loading ? (
            <div className="skeleton skeleton-card" />
          ) : tab === 'סקירה' ? (
            <Overview s={structure} />
          ) : tab === 'תוכנית שתילה' ? (
            <TabPlanting list={data.planting} />
          ) : tab === 'עבודות' ? (
            <TabWorks list={data.works} />
          ) : tab === 'קטיפים' ? (
            <TabHarvests list={data.harvests} />
          ) : tab === 'ריסוסים' ? (
            <TabSprays list={data.sprays} />
          ) : tab === 'תפוקה' ? (
            <TabYield harvests={data.harvests} />
          ) : tab === 'כספים' ? (
            <TabFinance works={data.works} invoices={data.invoices} />
          ) : (
            <TabDocuments structure={structure} notes={data.notes || []} allNotes={data.allNotes || []} api={api} />
          )}
        </div>
      </div>
    </div>
  );
}

function Overview({ s }) {
  const row = (label, val) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span><b>{val}</b>
    </div>
  );
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>פרטים גיאומטריים</div>
      {row('שטח', `${formatNumber(s['שטח בדונם'])} דונם`)}
      {row('סוג מבנה', safeValue(s['סוג מבנה']))}
      {row('סוג כיסוי', safeValue(s['סוג כיסוי']))}
      {row('סוג רשת', safeValue(s['סוג רשת']))}
      {row('מס\' גמלונים', formatNumber(s['מספר גמלונים']))}
      {row('רוחב גמלון', `${formatNumber(s['רוחב גמלון במטרים'])} מטר`)}
      {row('אורך שורה', `${formatNumber(s['אורך שורה במטרים'])} מטר`)}
      {row('מספר שורות', formatNumber(s['מספר שורות במבנה']))}
      <div className="section-title">סקיצה</div>
      <div className="card" style={{ background: 'var(--bg-secondary)', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        {s['סקיצה'] ? <img src={Array.isArray(s['סקיצה']) ? (s['סקיצה'][0]?.url || s['סקיצה'][0]?.thumbnails?.large?.url || '') : (typeof s['סקיצה'] === 'string' ? s['סקיצה'] : '')} alt="סקיצה" style={{ maxWidth: '100%', borderRadius: 10 }} /> : 'אין סקיצה זמינה'}
      </div>
      {s['הערות'] && <div className="section-title">הערות</div>}
      {s['הערות'] && <div>{s['הערות']}</div>}
    </div>
  );
}

function TabPlanting({ list }) {
  if (!list.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div className="card">
      {list.map((p) => (
        <div key={p.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <b>{safeValue(p['סוג גידול'] || p['שם גידול'])}</b>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            שתילה: {formatDate(p['תחילת שתילה מקורית'])} – {formatDate(p['סוף שתילה מקורי'])}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            קטיף: {formatDate(p['תחילת קטיף מקורית'])} – {formatDate(p['סוף קטיף מקורי'])}
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows }) {
  if (!rows.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabWorks({ list }) {
  return (
    <Table
      head={['תאריך', 'עובד', 'סוג עבודה', 'כמות', 'שעות', 'סכום']}
      rows={list.map((r) => [
        formatDate(r['תאריך']),
        linkName(r['עובד']),
        r['סוג עבודה (from תמחור עבודות)'] ?? '—',
        formatNumber(r['כמות']),
        formatNumber(r['סכום שעות']),
        formatMoney(r['סכום לתשלום']),
      ])}
    />
  );
}

function TabHarvests({ list }) {
  return (
    <Table
      head={['תאריך', 'סוג קטיף', 'ק"ג', 'קרטונים', 'משטחים']}
      rows={list.map((h) => [
        formatDate(h['תאריך']),
        safeValue(h['סוג קטיף']),
        formatNumber(h['כמות ק"ג']),
        formatNumber(h['מספר קרטונים']),
        formatNumber(h['מספר משטחים']),
      ])}
    />
  );
}

function TabSprays({ list }) {
  return (
    <Table
      head={['תאריך', 'חומר', 'מבצע', 'מינון', 'סטטוס']}
      rows={list.map((r) => [
        formatDate(r['תאריך']),
        linkName(r['חומר ריסוס']),
        linkName(r['מבצע']),
        r['מינון'] ?? '—',
        r['בוצע'] ? 'בוצע' : 'לא בוצע',
      ])}
    />
  );
}

function TabYield({ harvests }) {
  const byDate = {};
  harvests.forEach((h) => {
    const d = formatDate(h['תאריך']);
    byDate[d] = (byDate[d] || 0) + (Number(h['כמות ק"ג']) || 0);
  });
  const data = Object.entries(byDate).map(([k, v]) => ({ label: k, value: Math.round(v) }));

  // מיון קטיפים לפי סוג
  const byType = {};
  harvests.forEach((h) => {
    const type = displayName(h['סוג קטיף'], 'אחר');
    byType[type] = (byType[type] || 0) + (Number(h['כמות ק"ג']) || 0);
  });
  const pieData = Object.entries(byType).map(([k, v]) => ({ name: k, value: Math.round(v) }));
  const COLORS = ['#2E9B62', '#4ECDC4', '#FFD93D', '#FF6B6B', '#6C5CE7'];

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">ק"ג בפועל</span></div><div className="kpi-value">{formatNumber(harvests.reduce((s, h) => s + (Number(h['כמות ק"ג']) || 0), 0))}</div></div>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-label">קרטונים</span></div><div className="kpi-value">{formatNumber(harvests.reduce((s, h) => s + (Number(h['מספר קרטונים']) || 0), 0))}</div></div>
      </div>

      {pieData.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>התפלגות קטיף לפי סוג</div>
          <div style={{ direction: 'ltr', display: 'flex', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                {/* השמות במקרא בלבד — תוויות על הפלחים נדרסו זו על ידי זו */}
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {data.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>גרף ק"ג לאורך זמן</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...xAxisProps(data.length, { rotate: true })} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="#2E9B62" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : <div className="empty-state">אין נתונים לתקופה זו</div>}
    </div>
  );
}

function TabFinance({ works, invoices }) {
  const invNum = (inv, f) => Number(inv[f]) || 0;
  const neto = invoices.reduce((s, inv) => s + invNum(inv, 'סכום נטו'), 0);
  const bruto = invoices.reduce((s, inv) => s + invNum(inv, 'סכום ברוטו'), 0);
  const kg = invoices.reduce((s, inv) => s + invNum(inv, 'משקל'), 0);
  const cartons = invoices.reduce((s, inv) => s + invNum(inv, 'כמות קרטונים'), 0);
  const labor = works.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);

  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>עלות עבודה</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--workers)' }}>
          {formatMoney(labor)}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          מתוך {works.length} עבודות
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>הכנסות (פדיון)</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>פדיון ברוטו</span><b>{formatMoney(bruto)}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>פדיון נטו</span><b>{formatMoney(neto)}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>ק"ג / קרטונים</span><b>{formatNumber(kg)} ק"ג · {formatNumber(cartons)} קרטונים</b>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          סך כל חשבוניות הפרויקט. החשבוניות אינן מקושרות לרמת מבנה ספציפי, לכן הפדיון מוצג בטוטאל ואינו מפולח למבנה.
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// טאב "מסמכים" בכרטיס מבנה: תעודות המשלוח המשויכות למבנה (סעיף 11/29).
// לחיצה על תעודה פותחת את כרטיס התעודה המלא מעל כרטיס המבנה.
// ------------------------------------------------------------
function TabDocuments({ structure, notes, allNotes, api }) {
  const [open, setOpen] = useState(null);
  const sorted = [...notes].sort((a, b) => new Date(noteDate(b) || 0) - new Date(noteDate(a) || 0));
  const cartons = notes.reduce((s, n) => s + (noteCartons(n) ?? 0), 0);
  const weight = notes.reduce((s, n) => s + (noteWeight(n) ?? 0), 0);
  const sketch = Array.isArray(structure['סקיצה']) && structure['סקיצה'][0];

  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>📄 תעודות משלוח</div>
        {notes.length === 0 ? (
          <div className="empty-state" style={{ padding: '14px 0' }}>אין תעודות משלוח משויכות למבנה זה</div>
        ) : (
          <>
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>תעודות</span></div><div className="kpi-value" style={{ fontSize: 17 }}>{notes.length}</div></div>
              <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>קרטונים</span></div><div className="kpi-value" style={{ fontSize: 17, color: 'var(--cartons)' }}>{formatNumber(cartons)}</div></div>
              <div className="kpi-card" style={{ padding: '14px 14px 0' }}><div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>משקל</span></div><div className="kpi-value" style={{ fontSize: 17, color: 'var(--weight)' }}>{formatNumber(weight)} ק"ג</div></div>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table compact">
                <thead><tr><th>מס'</th><th>תאריך</th><th>משווק</th><th>שבוע</th><th>קרטונים</th><th>משקל</th><th>בדיקה</th><th>מסמך</th></tr></thead>
                <tbody>
                  {sorted.map((n) => {
                    const doc = noteDocument(n);
                    return (
                      <tr key={n.id} {...activatable(() => setOpen(n), `פתיחת תעודה ${noteNumber(n) ?? ''}`)}>
                        <td><b>{noteNumber(n) ?? '—'}</b></td>
                        <td>{noteDate(n) ? formatDate(noteDate(n)) : 'לא זמין'}</td>
                        <td>{noteMarketer(n)?.name || 'לא זמין'}</td>
                        <td>{noteWeekCode(n) || '—'}</td>
                        <td>{noteCartons(n) === null ? 'לא זמין' : formatNumber(noteCartons(n))}</td>
                        <td>{noteWeight(n) === null ? 'לא זמין' : `${formatNumber(noteWeight(n))} ק"ג`}</td>
                        <td><CheckBadge note={n} /></td>
                        <td>{doc ? <a href={doc.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`פתיחת ${doc.filename}`}>📎</a> : <span className="badge badge-warn">חסר</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {(sketch || (Array.isArray(structure['מצגת 1']) && structure['מצגת 1'].length) || (Array.isArray(structure['מצגת 2']) && structure['מצגת 2'].length)) ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title" style={{ marginTop: 0 }}>קבצים של המבנה</div>
          {['סקיצה', 'מצגת 1', 'מצגת 2'].flatMap((f) => (Array.isArray(structure[f]) ? structure[f] : []).map((a, i) => (
            <div key={`${f}${i}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
              📎 <a href={a.url} target="_blank" rel="noopener noreferrer">{a.filename || f}</a> <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({f})</span>
            </div>
          )))}
        </div>
      ) : null}

      {open && <DeliveryNoteDrawer note={open} notes={allNotes} api={api} onClose={() => setOpen(null)} />}
    </div>
  );
}

function linkName(v) {
  return displayName(v, 'לא זמין');
}
function displayLinks(val) {
  return displayName(val, '');
}
