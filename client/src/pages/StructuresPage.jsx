import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatMoney, formatDate, safeValue } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

const TABS = ['סקירה', 'תוכנית שתילה', 'עבודות', 'קטיפים', 'ריסוסים', 'תפוקה', 'כספים', 'מסמכים'];

export default function StructuresPage() {
  const app = useApp();
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null);

  useEffect(() => {
    app.api.get('מבנים', '?maxRecords=200')
      .then((d) => setStructures(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = structures.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(s['מספר מבנה'] || s['סוג מבנה'] || '').toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="page-header">
        <h2>מבנים</h2>
        <input className="input" placeholder="חיפוש מבנה..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="grid">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div className="grid">
          {filtered.map((s) => (
            <div key={s.id} className="card clickable" onClick={() => setDrawer(s)}>
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
            </div>
          ))}
        </div>
      )}

      {drawer && <StructureDetails structure={drawer} api={app.api} onClose={() => setDrawer(null)} />}
    </div>
  );
}

// ============================================================
// כרטיס מבנה — Tabs (סעיף 11)
// ============================================================
function StructureDetails({ structure, api, onClose }) {
  const [tab, setTab] = useState('סקירה');
  const [data, setData] = useState({ works: [], harvests: [], sprays: [], planting: [] });
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
    ])
      .then(([w, h, s, p]) => {
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
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [structId]);

  const sumHours = data.works.reduce((s, r) => s + (Number(r['סכום שעות'] ?? r['שעות']) || 0), 0);
  const sumPaid = data.works.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);
  const sumKg = data.harvests.reduce((s, r) => s + (Number(r['כמות ק"ג']) || 0), 0);
  const sumCartons = data.harvests.reduce((s, r) => s + (Number(r['מספר קרטונים']) || 0), 0);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer struct-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>🏗️ מבנה {name}</span>
          <button className="drawer-close" onClick={onClose}>✕</button>
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
            <TabFinance works={data.works} />
          ) : (
            <div className="empty-state">📄 אין מסמכים שמורים למבנה זה</div>
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

function TabFinance({ works }) {
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>עלות עבודה</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--workers)' }}>
        {formatMoney(works.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0))}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        מתוך {works.length} עבודות
      </div>
      <div className="section-title">הכנסה</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>מקור: "JSON הכנסה לפי מבנים" — לא זמין עדיין בכרטיס זה.</div>
    </div>
  );
}

function linkName(v) {
  return displayName(v, 'לא זמין');
}
function displayLinks(val) {
  return displayName(val, '');
}
