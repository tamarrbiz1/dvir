// ============================================================
// גידולים (37) + מחירי גידול (38) + תפוקה רבעונית (39) + תחזית (40)
// ------------------------------------------------------------
// כרטיס גידול נפתח ל-Drawer עם טאבים (תוכניות שתילה / מחירים /
// תפוקה / תחזית). בתחזית: "מחיר לק"ג מעודכן" ניתן לעריכה עם הצעת
// ברירת מחדל מ"מחיר משוער לק"ג" — בלי לדרוס ערך קיים (סעיף 40).
// כל כתיבה — ישירות ל-Airtable, ואחריה קריאה מחדש.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { formatNumber, formatMoney, formatDate, safeValue } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';
import { toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import { useAutoRefresh } from '../utils/live.js';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

const TABS = ['גידולים', 'מחירי גידול', 'תפוקה רבעונית', 'תחזית שתילה'];
const FORECAST_TABLE = 'תחזית שתילה שבועית';
const PRICES_TABLE = 'מחירי גידול משוערים';
const QUARTER_TABLE = 'תפוקה רבעונית';

// אייקון גידול (סעיף 6 באיפיון תוכנית השתילה)
export function cropIcon(name) {
  const n = String(name || '');
  if (n.includes('מלפפון')) return '🥒';
  if (n.includes('עגבני')) return '🍅';
  if (n.includes('פלפל')) return '🫑';
  if (n.includes('חציל')) return '🍆';
  if (n.includes('תות')) return '🍓';
  if (n.includes('אבטיח')) return '🍉';
  if (n.includes('מלון')) return '🍈';
  return '🌱';
}

export default function CropsPage() {
  const app = useApp();
  const isOwner = (app.user?.role || 'owner') === 'owner';
  const [tab, setTab] = useState('גידולים');
  const [crops, setCrops] = useState([]);
  const [prices, setPrices] = useState([]);
  const [quarterly, setQuarterly] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [structures, setStructures] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cropDrawer, setCropDrawer] = useState(null);

  const load = useCallback(() => Promise.all([
    app.api.get('גידולים', '?maxRecords=200'),
    app.api.get(PRICES_TABLE, '?maxRecords=500'),
    app.api.get(QUARTER_TABLE, '?maxRecords=500'),
    app.api.get(FORECAST_TABLE, '?maxRecords=1500'),
    app.api.get('מבנים', '?maxRecords=200'),
    app.api.get('תוכניות שתילה', '?maxRecords=500').catch(() => []),
  ]).then(([c, p, q, f, st, pl]) => {
    setCrops(Array.isArray(c) ? c : []);
    setPrices(Array.isArray(p) ? p : []);
    setQuarterly(Array.isArray(q) ? q : []);
    setForecast(Array.isArray(f) ? f : []);
    setStructures(Array.isArray(st) ? st : []);
    setPlans(Array.isArray(pl) ? pl : []);
  }).catch(() => {}), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load); // עדכון ממקום אחר (מסך/משתמש אחר) מופיע בלי רענון ידני

  // תחזית שתילה שבועית — שורות מנורמלות
  const forecastRows = useMemo(() => forecast.map((f) => ({
    id: f.id,
    raw: f,
    plan: f['תוכנית שתילה'] != null ? displayName(f['תוכנית שתילה'], '') : '',
    structure: displayName(f['מבנה'], '') || refName(f['מבנה'], structures),
    crop: displayName(f['גידול'], '') || f['גידול'] || '—',
    start: f['תחילת שבוע'],
    end: f['סוף שבוע'],
    quarter: f['רבעון'] || '—',
    expectedKg: f['ק"ג צפוי'] ?? f['קג צפוי'],
    actualKg: f['קג בפועל'],
    expectedIncome: f['הכנסה צפויה'],
    perDunam: f['קג לדונם לשבוע (from תפוקה רבעונית)'],
    activeDays: f['ימי קטיף פעילים'],
    priceUpdated: f['מחיר לקג מעודכן'],
    priceSuggested: f['מחיר משוער לקג (from מחירי גידול משוערים)'],
  })), [forecast, structures]);

  return (
    <div>
      <PageTitle tab={tab} setTab={setTab} />

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : tab === 'גידולים' ? (
        <CropsTab crops={crops} api={app.api} canEdit={isOwner} onOpen={setCropDrawer} onChanged={load} />
      ) : tab === 'מחירי גידול' ? (
        <PricesTab prices={prices} crops={crops} api={app.api} canEdit={isOwner} onChanged={load} />
      ) : tab === 'תפוקה רבעונית' ? (
        <QuarterlyTab quarterly={quarterly} crops={crops} api={app.api} canEdit={isOwner} onChanged={load} />
      ) : (
        <ForecastTab rows={forecastRows} api={app.api} canEdit={isOwner} onChanged={load} />
      )}

      {cropDrawer && (
        <CropDrawer
          crop={crops.find((c) => c.id === cropDrawer.id) || cropDrawer}
          plans={plans}
          prices={prices}
          quarterly={quarterly}
          forecastRows={forecastRows}
          onClose={() => setCropDrawer(null)}
        />
      )}
    </div>
  );
}

function PageTitle({ tab, setTab }) {
  return (
    <>
      <PageHeader icon="🌾" title="גידולים ותחזיות" />
      <div className="tabs no-print" style={{ marginBottom: 18 }}>
        {TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
    </>
  );
}

// ---------- גידולים (כרטיסים + Drawer + CRUD) ----------
const CROP_FORM_FIELDS = [
  { name: 'שם גידול', label: 'שם גידול', type: 'text', required: true },
  { name: 'קוד גידול', label: 'קוד גידול', type: 'text' },
  { name: 'תיאור', label: 'תיאור', type: 'textarea' },
];

function CropsTab({ crops, api, canEdit, onOpen, onChanged }) {
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
            <div key={c.id} className="card clickable" {...activatable(() => onOpen(c), `פתיחת כרטיס הגידול ${c['שם גידול'] || ''}`)}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{cropIcon(c['שם גידול'])} {c['שם גידול'] || 'גידול'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {c['קוד גידול'] && <div>קוד: {c['קוד גידול']}</div>}
                {c['תיאור'] && <div>{c['תיאור']}</div>}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button className="btn btn-sm btn-ghost" aria-label="פתח פרטים" title="פתח פרטים" onClick={(e) => { e.stopPropagation(); onOpen(c); }}>👁</button>
                  <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); setForm(c); }}>✎</button>
                  <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await removeRecord(api, 'גידולים', c.id, c['שם גידול'] || 'הגידול')) await onChanged();
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

// כרטיס גידול — טאבים לפי סעיף 37
function CropDrawer({ crop, plans, prices, quarterly, forecastRows, onClose }) {
  useEscapeClose(onClose);
  const [tab, setTab] = useState('תוכניות שתילה');
  const name = crop['שם גידול'] || 'גידול';
  const matches = (v) => String(displayName(v, '') || v || '').includes(name);

  const cropPlans = plans.filter((p) => matches(p['גידולים']) || matches(p['סוג גידול']));
  const cropPrices = prices.filter((p) => matches(p['גידול']));
  const cropQuarterly = quarterly.filter((q) => matches(q['גידול']));
  const cropForecast = forecastRows.filter((r) => String(r.crop).includes(name));

  const drawerTabs = ['תוכניות שתילה', 'מחירי גידול', 'תפוקה', 'תחזית'];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer struct-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>{cropIcon(name)} {name}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {drawerTabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'active' : ''}`} style={{ fontSize: 12, padding: '6px 10px' }}>{t}</button>
          ))}
        </div>
        <div className="drawer-body">
          {tab === 'תוכניות שתילה' && (
            cropPlans.length === 0 ? <div className="empty-state">אין תוכניות שתילה לגידול זה</div> : (
              <div className="card">
                {cropPlans.map((p) => (
                  <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <b>תוכנית {p['מספר תוכנית'] ?? ''} · {displayName(p['מבנה'], '')}</b>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      שתילה: {formatDate(p['תחילת שתילה מקורית'])} – {formatDate(p['סוף שתילה מקורי'])} ·
                      קטיף: {formatDate(p['תחילת קטיף מקורית'])} – {formatDate(p['סוף קטיף מקורי'])}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
          {tab === 'מחירי גידול' && (
            cropPrices.length === 0 ? <div className="empty-state">אין מחירים משוערים לגידול זה</div> : (
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>שנה</th><th>מחיר משוער לק"ג</th><th>מתאריך</th><th>עד תאריך</th><th>ברירת מחדל</th></tr></thead>
                  <tbody>
                    {cropPrices.map((p) => (
                      <tr key={p.id}>
                        <td>{safeValue(p['שנה'])}</td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער'])}</td>
                        <td>{formatDate(p['מתאריך'])}</td>
                        <td>{formatDate(p['עד תאריך'])}</td>
                        <td>{p['ברירת מחדל שנתית'] ? '✓' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === 'תפוקה' && (
            cropQuarterly.length === 0 ? <div className="empty-state">אין נתוני תפוקה לגידול זה</div> : (
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>רבעון</th><th>ק"ג לדונם לשבוע</th></tr></thead>
                  <tbody>
                    {cropQuarterly.map((q) => (
                      <tr key={q.id}><td>{safeValue(q['רבעון'])}</td><td style={{ fontWeight: 700 }}>{formatNumber(q['קג לדונם לשבוע'])}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === 'תחזית' && (
            cropForecast.length === 0 ? <div className="empty-state">אין תחזית שבועית לגידול זה</div> : (
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>שבוע</th><th>מבנה</th><th>רבעון</th><th>ק"ג צפוי</th><th>ק"ג בפועל</th><th>הכנסה צפויה</th></tr></thead>
                  <tbody>
                    {cropForecast.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.start)}</td>
                        <td>{r.structure}</td>
                        <td>{r.quarter}</td>
                        <td>{formatNumber(r.expectedKg)}</td>
                        <td style={{ color: 'var(--actual)', fontWeight: 700 }}>{r.actualKg != null ? formatNumber(r.actualKg) : 'טרם'}</td>
                        <td>{r.expectedIncome != null ? formatMoney(r.expectedIncome) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- מחירי גידול (עם CRUD) ----------
function PricesTab({ prices, crops, api, canEdit, onChanged }) {
  const [year, setYear] = useState('');
  const [crop, setCrop] = useState('');
  const [form, setForm] = useState(null);
  const cropList = useMemo(() => [...new Set(prices.map((p) => displayName(p['גידול'], '') || p['גידול']).filter(Boolean))], [prices]);
  const yearList = useMemo(() => [...new Set(prices.map((p) => p['שנה']).filter(Boolean))], [prices]);

  const cropName = (p) => displayName(p['גידול'], '') || p['גידול'] || '';
  const filtered = prices.filter((p) =>
    (!crop || cropName(p) === crop) && (!year || String(p['שנה']) === String(year))
  );
  const chart = filtered.map((p) => ({ label: `${cropName(p)} (${p['שנה'] ?? ''})`, מחיר: Number(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער']) || 0 }));

  return (
    <div>
      <div className="filter-bar no-print">
        <select className="select" value={crop} onChange={(e) => setCrop(e.target.value)}>
          <option value="">כל הגידולים</option>
          {cropList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">כל השנים</option>
          {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {canEdit && <button className="btn btn-primary" style={{ marginInlineStart: 'auto' }} onClick={() => setForm({})}>+ מחיר חדש</button>}
      </div>
      <div className="card">
        {filtered.length === 0 ? <div className="empty-state">אין נתונים לתקופה זו</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>גידול</th><th>שנה</th><th>מחיר משוער לק"ג</th><th>מתאריך</th><th>עד תאריך</th><th>ברירת מחדל שנתית</th>{canEdit && <th className="no-print">פעולות</th>}</tr></thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>{cropIcon(cropName(p))} {safeValue(cropName(p))}</td>
                    <td>{safeValue(p['שנה'])}</td>
                    <td style={{ fontWeight: 700 }}>{(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער']) != null ? formatMoney(p['מחיר משוער לקג'] ?? p['מחיר גידול משוער']) : 'לא זמין'}</td>
                    <td>{formatDate(p['מתאריך'])}</td>
                    <td>{formatDate(p['עד תאריך'])}</td>
                    <td><span className={`badge ${p['ברירת מחדל שנתית'] ? 'badge-ok' : ''}`}>{p['ברירת מחדל שנתית'] ? 'כן' : 'לא'}</span></td>
                    {canEdit && (
                      <td className="no-print">
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setForm(p)}>✎</button>
                          <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                            onClick={async () => { if (await removeRecord(api, PRICES_TABLE, p.id, 'המחיר')) await onChanged(); }}>🗑</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {chart.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>מחיר משוער לאורך זמן</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chart} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: true, maxLabels: 8 })} angle={-40} height={92} interval={chart.length > 8 ? Math.ceil(chart.length / 8) - 1 : 0} />
                <YAxis {...yAxisProps({ money: true })} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="מחיר" stroke="#2878D0" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {form !== null && (
        <CropLinkedForm
          api={api} table={PRICES_TABLE} crops={crops} record={form.id ? form : null}
          title={form.id ? 'עריכת מחיר משוער' : 'מחיר משוער חדש'}
          fields={[
            { name: 'שנה', label: 'שנה', type: 'number' },
            { name: 'מחיר משוער לקג', label: 'מחיר משוער לק"ג (₪)', type: 'number' },
            { name: 'מתאריך', label: 'מתאריך', type: 'date' },
            { name: 'עד תאריך', label: 'עד תאריך', type: 'date' },
          ]}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); toast('המחיר נשמר בהצלחה'); }}
        />
      )}
    </div>
  );
}

// ---------- תפוקה רבעונית (Matrix + CRUD) ----------
function QuarterlyTab({ quarterly, crops, api, canEdit, onChanged }) {
  const [form, setForm] = useState(null);
  const cropName = (q) => displayName(q['גידול'], '') || q['גידול'] || '—';
  const rows = useMemo(() => {
    const map = {};
    quarterly.forEach((q) => {
      const crop = cropName(q);
      const qname = q['רבעון'] ? `Q${String(q['רבעון']).replace('Q', '')}` : '—';
      if (!map[crop]) map[crop] = { crop, recs: {} };
      map[crop][qname] = Number(q['קג לדונם לשבוע'] ?? q['ק"ג לדונם לשבוע']) || 0;
      map[crop].recs[qname] = q;
    });
    return Object.values(map);
  }, [quarterly]);

  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-primary" onClick={() => setForm({})}>+ תפוקה רבעונית</button>
        </div>
      )}
      {!rows.length ? <div className="empty-state">אין נתונים לתקופה זו</div> : (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>גידול</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.crop}>
                    <td><b>{cropIcon(r.crop)} {r.crop}</b></td>
                    {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                      <td key={q}>
                        {r[q] != null ? formatNumber(r[q]) : '—'}
                        {canEdit && r.recs[q] && (
                          <button className="btn btn-sm btn-ghost no-print" style={{ marginInlineStart: 4, minHeight: 24, padding: '0 6px' }}
                            aria-label={`עריכת תפוקת ${q}`} title="עריכה" onClick={() => setForm(r.recs[q])}>✎</button>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {form !== null && (
        <CropLinkedForm
          api={api} table={QUARTER_TABLE} crops={crops} record={form.id ? form : null}
          title={form.id ? 'עריכת תפוקה רבעונית' : 'תפוקה רבעונית חדשה'}
          fields={[
            { name: 'רבעון', label: 'רבעון', type: 'select' },
            { name: 'קג לדונם לשבוע', label: 'ק"ג לדונם לשבוע', type: 'number' },
          ]}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); toast('התפוקה נשמרה בהצלחה'); }}
        />
      )}
    </div>
  );
}

// טופס עם קישור לגידול (שדה Link) + שדות פשוטים
function CropLinkedForm({ api, table, crops, record, title, fields, onClose, onSaved }) {
  const [cropId, setCropId] = useState(firstId(record?.['גידול']) || '');
  const [values, setValues] = useState(() => {
    const v = {};
    fields.forEach((f) => {
      let cur = record?.[f.name];
      if (f.type === 'date' && cur) cur = String(cur).slice(0, 10);
      v[f.name] = cur ?? '';
    });
    return v;
  });
  const [options, setOptions] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  useEffect(() => {
    fields.filter((f) => f.type === 'select').forEach((f) => {
      fetch(`/api/select-options/${encodeURIComponent(table)}/${encodeURIComponent(f.name)}`)
        .then((r) => (r.ok ? r.json() : { choices: [] }))
        .then((d) => setOptions((o) => ({ ...o, [f.name]: Array.isArray(d.choices) ? d.choices : [] })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!cropId) { setError('חסר שדה חובה: גידול'); return; }
    setSaving(true); setError('');
    const body = { 'גידול': [cropId] };
    fields.forEach((f) => {
      const v = values[f.name];
      if (v === '' || v == null) { if (record?.id) body[f.name] = null; return; }
      body[f.name] = f.type === 'number' ? Number(v) : v;
    });
    try {
      if (record?.id) await api.update(table, record.id, body);
      else await api.create(table, body);
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>{title}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={submit}>
          <div className="form-group"><label className="required">גידול</label>
            <select className="select" style={{ width: '100%' }} value={cropId} onChange={(e) => setCropId(e.target.value)}>
              <option value="">בחר גידול...</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{c['שם גידול'] || c.id}</option>)}
            </select></div>
          {fields.map((f) => (
            <div className="form-group" key={f.name}>
              <label>{f.label}</label>
              {f.type === 'select' ? (
                <select className="select" style={{ width: '100%' }} value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                  <option value="">בחר...</option>
                  {(options[f.name] || (values[f.name] ? [values[f.name]] : [])).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input className="input" style={{ width: '100%' }} type={f.type === 'number' ? 'number' : f.type}
                  step={f.type === 'number' ? 'any' : undefined}
                  value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
              )}
            </div>
          ))}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : 'שמור'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- תחזית שתילה שבועית (סעיף 40) ----------
function ForecastTab({ rows, api, canEdit, onChanged }) {
  const [fCrop, setFCrop] = useState('');
  const [fStructure, setFStructure] = useState('');
  const [search, setSearch] = useState('');
  const [priceEdit, setPriceEdit] = useState(null); // שורת תחזית לעריכת מחיר

  const cropList = useMemo(() => [...new Set(rows.map((r) => r.crop).filter((c) => c && c !== '—'))], [rows]);
  const structList = useMemo(() => [...new Set(rows.map((r) => r.structure).filter(Boolean))], [rows]);

  const filtered = rows.filter((r) => {
    if (fCrop && r.crop !== fCrop) return false;
    if (fStructure && r.structure !== fStructure) return false;
    if (search) {
      const hay = [r.crop, r.structure, r.quarter, r.plan].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  if (!rows.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  const chart = filtered.slice(0, 30).map((r) => ({ label: `${r.crop}`, צפוי: Math.round(Number(r.expectedKg) || 0), בפועל: Math.round(Number(r.actualKg) || 0) }));

  return (
    <div>
      <div className="filter-bar no-print">
        <input className="input" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" value={fCrop} onChange={(e) => setFCrop(e.target.value)}>
          <option value="">כל הגידולים</option>
          {cropList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" value={fStructure} onChange={(e) => setFStructure(e.target.value)}>
          <option value="">כל המבנים</option>
          {structList.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="card">
        {filtered.length === 0 ? <div className="empty-state">אין נתונים לתקופה זו</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>מבנה</th><th>גידול</th><th>תחילת שבוע</th><th>סוף שבוע</th><th>רבעון</th><th>ק"ג צפוי</th><th>ק"ג בפועל</th><th>מחיר לק"ג מעודכן</th><th>הכנסה צפויה</th><th>ק"ג לדונם</th></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.structure}</td>
                    <td>{cropIcon(r.crop)} {r.crop}</td>
                    <td>{formatDate(r.start)}</td>
                    <td>{formatDate(r.end)}</td>
                    <td><span className="badge" style={{ background: quarterColor(r.quarter) }}>{r.quarter}</span></td>
                    <td style={{ color: 'var(--planned)', fontWeight: 700 }}>{formatNumber(r.expectedKg)}</td>
                    <td style={{ color: 'var(--actual)', fontWeight: 700 }}>{r.actualKg != null ? formatNumber(r.actualKg) : 'טרם התקבל ביצוע'}</td>
                    <td>
                      {r.priceUpdated != null
                        ? <b>{formatMoney(r.priceUpdated)}</b>
                        : r.priceSuggested != null
                          ? <span className="muted" title="הצעת ברירת מחדל מהמחיר המשוער">{formatMoney(r.priceSuggested)} (משוער)</span>
                          : 'לא זמין'}
                      {canEdit && (
                        <button className="btn btn-sm btn-ghost no-print" style={{ marginInlineStart: 4, minHeight: 24, padding: '0 6px' }}
                          aria-label="עדכון מחיר לק&quot;ג" title="עדכון מחיר לק&quot;ג" onClick={() => setPriceEdit(r)}>✎</button>
                      )}
                    </td>
                    <td>{r.expectedIncome != null ? formatMoney(r.expectedIncome) : '—'}</td>
                    <td>{formatNumber(r.perDunam)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {chart.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>ק"ג צפוי מול בפועל</div>
          <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chart} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...xAxisProps(chart.length, { rotate: true, maxLabels: 8 })} angle={-40} height={92} interval={chart.length > 8 ? Math.ceil(chart.length / 8) - 1 : 0} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
                <Bar dataKey="צפוי" fill="#3578E5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="בפועל" fill="#168A55" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {priceEdit && (
        <PriceEditModal
          row={priceEdit}
          api={api}
          onClose={() => setPriceEdit(null)}
          onSaved={async () => { setPriceEdit(null); await onChanged(); toast('המחיר עודכן בהצלחה'); }}
        />
      )}
    </div>
  );
}

function quarterColor(q) {
  const s = String(q || '');
  if (s.includes('1')) return 'var(--q1)';
  if (s.includes('2')) return 'var(--q2)';
  if (s.includes('3')) return 'var(--q3)';
  return 'var(--q4)';
}

// עריכת "מחיר לקג מעודכן" — ברירת מחדל מהמחיר המשוער כשהשדה ריק,
// בלי לדרוס מחיר מעודכן קיים (סעיף 40). Airtable מחשב את ההכנסה.
function PriceEditModal({ row, api, onClose, onSaved }) {
  const initial = row.priceUpdated != null ? row.priceUpdated : (row.priceSuggested != null ? row.priceSuggested : '');
  const [price, setPrice] = useState(String(initial ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.update(FORECAST_TABLE, row.id, { 'מחיר לקג מעודכן': price === '' ? null : Number(price) });
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>מחיר לק"ג מעודכן</h3>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: 12 }}>
          {cropIcon(row.crop)} {row.crop} · {row.structure} · שבוע {formatDate(row.start)}
        </div>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={submit}>
          <div className="form-group"><label>מחיר לק"ג (₪)</label>
            <input type="number" step="any" min="0" className="input" style={{ width: '100%' }} autoFocus
              value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : 'שמור מחיר'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function refName(val, list) {
  if (!val) return '—';
  if (Array.isArray(val)) {
    const id = val[0]?.id ?? val[0];
    const s = list.find((x) => x.id === id);
    return s ? (s['מספר מבנה'] || s['סוג מבנה'] || s.id) : (val[0]?.name ?? '');
  }
  return val;
}
