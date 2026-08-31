import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { formatNumber, formatMoney, formatDate, safeValue } from '../utils/format.js';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';

// ============================================================
// גידולים (סעיף 37) + מחירי גידול (38) + תפוקה רבעונית (39) + תחזית (40)
// גישה: בעל העסק
// ============================================================

const TABS = ['גידולים', 'מחירי גידול', 'תפוקה רבעונית', 'תחזית שתילה'];

export default function CropsPage() {
  const app = useApp();
  const [tab, setTab] = useState('גידולים');
  const [crops, setCrops] = useState([]);
  const [prices, setPrices] = useState([]);
  const [quarterly, setQuarterly] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      app.api.get('גידולים', '?maxRecords=200'),
      app.api.get('מחירי גידול משוערים', '?maxRecords=500'),
      app.api.get('תפוקה רבעונית', '?maxRecords=500'),
      app.api.get('תחזית שתילה שבועית', '?maxRecords=1500'),
      app.api.get('מבנים', '?maxRecords=200'),
    ])
      .then(([c, p, q, f, st]) => {
        setCrops(Array.isArray(c) ? c : []);
        setPrices(Array.isArray(p) ? p : []);
        setQuarterly(Array.isArray(q) ? q : []);
        setForecast(Array.isArray(f) ? f : []);
        setStructures(Array.isArray(st) ? st : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // תחזית שתילה שבועית — מתוך הטבלה הייעודית
  const rawYieldData = useMemo(() => {
    return forecast.map((f) => ({
      id: f.id,
      plan: f['תוכנית שתילה'] != null ? refName(f['תוכנית שתילה'], []) : f.id,
      structure: refName(f['מבנה'], structures),
      crop: f['גידול'] || '—',
      start: f['תחילת שבוע'],
      end: f['סוף שבוע'],
      quarter: f['רבעון'] || '—',
      expectedKg: f['ק\"ג צפוי'] ?? f['קג צפוי'],
      actualKg: f['קג בפועל'],
      expectedIncome: f['הכנסה צפויה'],
      perDunam: f['קג לדונם לשבוע (from תפוקה רבעונית)'],
      area: f['שטח בדונם (from מבנה) (from תוכנית שתילה)'],
      activeDays: f['ימי קטיף פעילים'],
      price: f['מחיר לקג מעודכן'] ?? f['מחיר משוער לקג (from מחירי גידול משוערים)'],
    }));
  }, [forecast, structures]);

  return (
    <div>
      <PageHeader icon="🌾" title="גידולים ותחזיות" />

      <div className="tabs" style={{ marginBottom: 18 }}>
        {TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : tab === 'גידולים' ? (
        <CropsTab crops={crops} api={app.api} canEdit={(app.user?.role || 'owner') === 'owner'}
          onChanged={() => app.api.get('גידולים', '?maxRecords=200').then((c) => setCrops(Array.isArray(c) ? c : [])).catch(() => {})} />
      ) : tab === 'מחירי גידול' ? (
        <PricesTab prices={prices} />
      ) : tab === 'תפוקה רבעונית' ? (
        <QuarterlyTab quarterly={quarterly} />
      ) : (
        <ForecastTab data={rawYieldData} />
      )}
    </div>
  );
}

// ---------- גידולים (כולל CRUD למנהל ראשי) ----------
const CROP_FORM_FIELDS = [
  { name: 'שם גידול', label: 'שם גידול', type: 'text', required: true },
  { name: 'קוד גידול', label: 'קוד גידול', type: 'text' },
  { name: 'תיאור', label: 'תיאור', type: 'textarea' },
];

function CropsTab({ crops, api, canEdit, onChanged }) {
  const [form, setForm] = useState(null);
  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-primary" onClick={() => setForm({})}>+ גידול חדש</button>
        </div>
      )}
      {!crops.length ? <div className="empty-state">אין נתונים לתקופה זו</div> : (
        <div className="grid">
          {crops.map((c) => (
            <div key={c.id} className="card">
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>🌱 {c['שם גידול'] || 'גידול'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {c['קוד גידול'] && <div>קוד: {c['קוד גידול']}</div>}
                {c['תיאור'] && <div>{c['תיאור']}</div>}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setForm(c)}>✎</button>
                  <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                    onClick={async () => {
                      try { if (await removeRecord(api, 'גידולים', c.id, c['שם גידול'] || 'הגידול')) await onChanged(); }
                      catch (err) { window.alert(`המחיקה נכשלה: ${err.message || err}`); }
                    }}>🗑</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {form !== null && (
        <RecordForm
          api={api} table="גידולים"
          title={form.id ? `עריכת ${form['שם גידול'] || 'גידול'}` : 'גידול חדש'}
          record={form.id ? form : null}
          fields={CROP_FORM_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); }}
        />
      )}
    </div>
  );
}

// ---------- מחירי גידול ----------
function PricesTab({ prices }) {
  const [year, setYear] = useState('');
  const [crop, setCrop] = useState('');
  const cropList = useMemo(() => [...new Set(prices.map((p) => p['גידול']).filter(Boolean))], [prices]);
  const yearList = useMemo(() => [...new Set(prices.map((p) => p['שנה']).filter(Boolean))], [prices]);

  const filtered = prices.filter((p) =>
    (!crop || p['גידול'] === crop) && (!year || String(p['שנה']) === String(year))
  );
  const chart = filtered.map((p) => ({ label: `${p['גידול']} (${p['שנה']})`, מחיר: Number(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער']) || 0 }));

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <select className="select" value={crop} onChange={(e) => setCrop(e.target.value)}>
            <option value="">כל הגידולים</option>
            {cropList.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">כל השנים</option>
            {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>גידול</th><th>שנה</th><th>מחיר משוער לק"ג</th><th>מתאריך</th><th>עד תאריך</th><th>ברירת מחדל שנתית</th></tr></thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{safeValue(p['גידול'])}</td>
                  <td>{safeValue(p['שנה'])}</td>
                  <td>{(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער']) != null ? formatMoney(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער']) : 'לא זמין'}</td>
                  <td>{formatDate(p['מתאריך'])}</td>
                  <td>{formatDate(p['עד תאריך'])}</td>
                  <td><span className="badge badge-ok">{p['ברירת מחדל שנתית'] ? 'כן' : 'לא'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {chart.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>מחיר משוער לאורך זמן</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chart} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: true })} />
                <YAxis {...yAxisProps({ money: true })} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="מחיר" stroke="#2878D0" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- תפוקה רבעונית ----------
function QuarterlyTab({ quarterly }) {
  const rows = useMemo(() => {
    const map = {};
    quarterly.forEach((q) => {
      const crop = q['גידול'] || '—';
      const qname = q['רבעון'] ? `Q${String(q['רבעון']).replace('Q', '')}` : '—';
      if (!map[crop]) map[crop] = { crop };
      map[crop][qname] = Number(q['קג לדונם לשבוע'] ?? q['ק"ג לדונם לשבוע']) || 0;
    });
    return Object.values(map);
  }, [quarterly]);
  if (!rows.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>גידול</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.crop}>
                <td><b>{r.crop}</b></td>
                <td>{formatNumber(r.Q1) || '—'}</td>
                <td>{formatNumber(r.Q2) || '—'}</td>
                <td>{formatNumber(r.Q3) || '—'}</td>
                <td>{formatNumber(r.Q4) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- תחזית שתילה שבועית ----------
function ForecastTab({ data }) {
  if (!data.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  const chart = data.slice(0, 30).map((r) => ({ label: `${r.crop}`, צפוי: Math.round(Number(r.expectedKg) || 0), בפועל: Math.round(Number(r.actualKg) || 0) }));
  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>תוכנית</th><th>מבנה</th><th>גידול</th><th>תחילת שבוע</th><th>סוף שבוע</th><th>רבעון</th><th>ק"ג צפוי</th><th>ק"ג בפועל</th><th>הכנסה צפויה</th><th>ל"דונם</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.plan}</b></td>
                  <td>{r.structure}</td>
                  <td>{r.crop}</td>
                  <td>{formatDate(r.start)}</td>
                  <td>{formatDate(r.end)}</td>
                  <td><span className="badge" style={{ background: 'var(--q4)' }}>{r.quarter}</span></td>
                  <td>{formatNumber(r.expectedKg)}</td>
                  <td>{formatNumber(r.actualKg)}</td>
                  <td>{r.expectedIncome != null ? formatMoney(r.expectedIncome) : '—'}</td>
                  <td>{formatNumber(r.perDunam)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {chart.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>ק"ג צפוי מול בפועל</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chart} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: true })} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="צפוי" fill="#3578E5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="בפועל" fill="#168A55" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function refName(val, list) {
  if (!val) return '—';
  if (Array.isArray(val)) {
    const id = val[0]?.id ?? val[0];
    const s = list.find((x) => x.id === id);
    return s ? (s['מספר מבנה'] || s['סוג מבנה'] || s.id) : (val[0]?.name ?? val.join(', '));
  }
  return val;
}
