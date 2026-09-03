// ============================================================
// קטיפים (סעיף 18)
// ------------------------------------------------------------
// KPI · פילטרים (מבנה / סוג קטיף / טווח תאריכים) + חיפוש חופשי ·
// 5 גרפים לפי האיפיון · טבלה מלאה עם מיון ועימוד · יצירה/עריכה/
// מחיקה מול Airtable · ייצוא והדפסה של המסונן בלבד.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatWeight, formatDate, safeValue } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';
import PageHeader from '../components/PageHeader.jsx';
import { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import { useAutoRefresh } from '../utils/live.js';
import { exportCsv, fileStamp, inDateRange } from '../utils/table.js';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, TOOLTIP_STYLE, xAxisProps, yAxisProps, yCategoryProps } from '../utils/chart.js';

const TABLE = 'קטיפים';

export default function HarvestsPage() {
  const app = useApp();
  const canEdit = (app.user?.role || 'owner') === 'owner'; // עדכונים למנהל הראשי בלבד
  const [harvests, setHarvests] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fStructure, setFStructure] = useState('');
  const [fType, setFType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [form, setForm] = useState(null); // {} = חדש, רשומה = עריכה

  const load = useCallback(() => Promise.all([
    app.api.get(TABLE, '?maxRecords=1500'),
    app.api.get('מבנים', '?maxRecords=200'),
  ]).then(([h, s]) => {
    setHarvests(Array.isArray(h) ? h : []);
    setStructures(Array.isArray(s) ? s : []);
  }).catch(() => {}), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load);

  const structName = (h) => displayName(h['מבנה'], '');
  const types = useMemo(() => [...new Set(harvests.map((h) => h['סוג קטיף']).filter(Boolean))], [harvests]);
  const structOptions = useMemo(() => [...new Set(harvests.map(structName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [harvests]);

  const filtered = useMemo(() => harvests.filter((h) => {
    if (fStructure && structName(h) !== fStructure) return false;
    if (fType && h['סוג קטיף'] !== fType) return false;
    if (!inDateRange(h['תאריך'], from, to)) return false;
    if (search) {
      const hay = [structName(h), h['סוג קטיף'], h['הערות']].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => String(b['תאריך'] || '').localeCompare(String(a['תאריך'] || ''))), [harvests, fStructure, fType, from, to, search]);

  const num = (h, f) => Number(h[f]) || 0;
  const totalKg = filtered.reduce((s, h) => s + num(h, 'כמות ק"ג'), 0);
  const totalCartons = filtered.reduce((s, h) => s + num(h, 'מספר קרטונים'), 0);
  const totalPallets = filtered.reduce((s, h) => s + num(h, 'מספר משטחים'), 0);
  const avgPerCarton = totalCartons ? totalKg / totalCartons : null;

  // ---------- נתוני הגרפים ----------
  const byDate = useMemo(() => {
    const m = {};
    filtered.forEach((h) => {
      const k = String(h['תאריך'] || '').slice(0, 10);
      if (!k) return;
      m[k] = m[k] || { key: k, date: formatDate(h['תאריך']), kg: 0, cartons: 0 };
      m[k].kg += num(h, 'כמות ק"ג');
      m[k].cartons += num(h, 'מספר קרטונים');
    });
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({ ...r, kg: Math.round(r.kg), avg: r.cartons ? Math.round((r.kg / r.cartons) * 10) / 10 : null }));
  }, [filtered]);

  const byStructure = useMemo(() => {
    const m = {};
    filtered.forEach((h) => {
      const k = structName(h) || 'אחר';
      m[k] = m[k] || { name: k, kg: 0, cartons: 0 };
      m[k].kg += num(h, 'כמות ק"ג');
      m[k].cartons += num(h, 'מספר קרטונים');
    });
    return Object.values(m).map((r) => ({ ...r, kg: Math.round(r.kg) })).sort((a, b) => b.kg - a.kg);
  }, [filtered]);

  const hasFilters = search || fStructure || fType || from || to;

  const doExport = () => exportCsv(`קטיפים-${fileStamp()}`, [
    { label: 'תאריך', get: (h) => formatDate(h['תאריך']) },
    { label: 'מבנה', get: (h) => structName(h) },
    { label: 'סוג קטיף', get: (h) => h['סוג קטיף'] || '' },
    { label: 'כמות ק"ג', get: (h) => h['כמות ק"ג'] ?? '' },
    { label: 'קרטונים', get: (h) => h['מספר קרטונים'] ?? '' },
    { label: 'שקיות', get: (h) => h['מספר שקיות'] ?? '' },
    { label: 'משטחים', get: (h) => h['מספר משטחים'] ?? '' },
    { label: 'משקל ממוצע לקרטון', get: (h) => h['משקל ממוצע לקרטון'] ?? '' },
    { label: 'הערות', get: (h) => h['הערות'] || '' },
  ], filtered);

  return (
    <div>
      <PageHeader icon="🧺" title="קטיפים">
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>🖨️ הדפסה</button>
        <button type="button" className="btn btn-ghost no-print" onClick={doExport} disabled={!filtered.length}>⬇️ ייצוא</button>
        {canEdit && <button className="btn btn-primary no-print" onClick={() => setForm({})}>+ קטיף חדש</button>}
      </PageHeader>

      {/* פילטרים + חיפוש (עובדים יחד) */}
      <div className="filter-bar no-print">
        <input className="input" aria-label="חיפוש קטיף" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" aria-label="סינון לפי מבנה" value={fStructure} onChange={(e) => setFStructure(e.target.value)}>
          <option value="">כל המבנים</option>
          {structOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" aria-label="סינון לפי סוג קטיף" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">כל סוגי הקטיף</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="date-field">מתאריך<input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="date-field">עד תאריך<input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {hasFilters && <button className="btn btn-ghost" onClick={() => { setSearch(''); setFStructure(''); setFType(''); setFrom(''); setTo(''); }}>נקה פילטרים</button>}
      </div>

      {loading ? <div className="skeleton skeleton-card" /> : (
        <>
          {/* KPI */}
          <div className="kpi-grid">
            <Kpi icon="🧺" soft="var(--harvest-soft)" color="var(--harvest)" label={'סה"כ ק"ג'} value={filtered.length ? formatNumber(Math.round(totalKg)) : 'אין נתונים'} />
            <Kpi icon="📦" soft="var(--cartons-soft)" color="var(--cartons)" label={'סה"כ קרטונים'} value={filtered.length ? formatNumber(totalCartons) : 'אין נתונים'} />
            <Kpi icon="🛒" soft="var(--pallets-soft)" color="var(--pallets)" label={'סה"כ משטחים'} value={filtered.length ? formatNumber(totalPallets) : 'אין נתונים'} />
            <Kpi icon="⚖️" soft="var(--weight-soft)" color="var(--weight)" label="משקל ממוצע לקרטון" value={avgPerCarton !== null ? `${formatNumber(Math.round(avgPerCarton * 10) / 10)} ק"ג` : 'לא זמין'} />
          </div>

          {/* גרפים 1–2: ק"ג / קרטונים לאורך זמן */}
          <div className="grid-2" style={{ marginTop: 20 }}>
            <ChartCard title={'ק"ג לאורך זמן'}>
              <TimeBars data={byDate} dataKey="kg" color="#2E9B62" fmt={(v) => formatWeight(v)} />
            </ChartCard>
            <ChartCard title="קרטונים לאורך זמן">
              <TimeBars data={byDate} dataKey="cartons" color="#09A7B2" fmt={(v) => `${formatNumber(v)} קרטונים`} />
            </ChartCard>
          </div>

          {/* גרפים 3–4: לפי מבנה */}
          <div className="grid-2" style={{ marginTop: 16 }}>
            <ChartCard title={'ק"ג לפי מבנה'}>
              <HorizontalBars data={byStructure} dataKey="kg" color="#2E9B62" fmt={(v) => formatWeight(v)} />
            </ChartCard>
            <ChartCard title="קרטונים לפי מבנה">
              <HorizontalBars data={byStructure} dataKey="cartons" color="#09A7B2" fmt={(v) => `${formatNumber(v)} קרטונים`} />
            </ChartCard>
          </div>

          {/* גרף 5: משקל ממוצע לקרטון לאורך זמן */}
          <ChartCard title="משקל ממוצע לקרטון לאורך זמן" style={{ marginTop: 16 }}>
            {byDate.filter((d) => d.avg !== null).length ? (
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={byDate.filter((d) => d.avg !== null)} margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="date" {...xAxisProps(byDate.length, { rotate: byDate.length > 8 })} />
                    <YAxis {...yAxisProps()} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${formatNumber(v)} ק"ג`, 'ממוצע לקרטון']} />
                    <Line type="monotone" dataKey="avg" stroke="#2878D0" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="empty-state">אין נתונים לתקופה זו</div>}
          </ChartCard>

          {/* טבלה */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>רשימת קטיפים ({formatNumber(filtered.length)})</div>
            {filtered.length === 0 ? <div className="empty-state"><div className="icon">🧺</div>אין נתונים לתקופה זו</div> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>תאריך</th><th>מבנה</th><th>סוג קטיף</th><th>ק"ג</th><th>קרטונים</th>
                      <th>שקיות</th><th>משטחים</th><th>ממוצע לקרטון</th><th>הערות</th>
                      {canEdit && <th className="no-print">פעולות</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, limit).map((h) => (
                      <tr key={h.id} {...(canEdit ? activatable(() => setForm(h), 'עריכת קטיף') : {})}>
                        <td>{formatDate(h['תאריך'])}</td>
                        <td>{structName(h) ? <span className="obj-chip static">🏗️ {structName(h)}</span> : 'לא זמין'}</td>
                        <td>{safeValue(h['סוג קטיף'])}</td>
                        <td style={{ fontWeight: 700 }}>{h['כמות ק"ג'] != null ? formatNumber(h['כמות ק"ג']) : 'לא זמין'}</td>
                        <td>{h['מספר קרטונים'] != null ? formatNumber(h['מספר קרטונים']) : '—'}</td>
                        <td>{h['מספר שקיות'] != null ? formatNumber(h['מספר שקיות']) : '—'}</td>
                        <td>{h['מספר משטחים'] != null ? formatNumber(h['מספר משטחים']) : '—'}</td>
                        <td>{h['משקל ממוצע לקרטון'] != null ? formatNumber(h['משקל ממוצע לקרטון']) : '—'}</td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{h['הערות'] || ''}</td>
                        {canEdit && (
                          <td className="no-print">
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); setForm(h); }}>✎</button>
                              <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (await removeRecord(app.api, TABLE, h.id, 'הקטיף')) await load();
                                }}>🗑</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filtered.length > limit && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button className="btn btn-ghost no-print" onClick={() => setLimit((l) => l + 50)}>הצג עוד ({formatNumber(filtered.length - limit)} נוספים)</button>
              </div>
            )}
          </div>
        </>
      )}

      {form !== null && (
        <HarvestForm
          api={app.api}
          structures={structures}
          record={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); toast(form.id ? 'הקטיף עודכן בהצלחה' : 'הקטיף נשמר בהצלחה'); }}
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

function ChartCard({ title, children, style }) {
  return (
    <div className="card" style={style}>
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      {children}
    </div>
  );
}

function TimeBars({ data, dataKey, color, fmt }) {
  if (!data.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div style={{ direction: 'ltr' }}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...xAxisProps(data.length, { rotate: data.length > 8 })} />
          <YAxis {...yAxisProps()} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmt(v), '']} />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HorizontalBars({ data, dataKey, color, fmt }) {
  if (!data.length) return <div className="empty-state">אין נתונים לתקופה זו</div>;
  return (
    <div style={{ direction: 'ltr' }}>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
          <XAxis type="number" {...xAxisProps(0)} />
          <YAxis dataKey="name" {...yCategoryProps({ width: 110 })} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmt(v), '']} />
          <Bar dataKey={dataKey} fill={color} radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// טופס קטיף — כתיבה ישירה ל-Airtable ("מבנה" הוא שדה קישור)
// ============================================================
function HarvestForm({ api, structures, record, onClose, onSaved }) {
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [date, setDate] = useState(record?.['תאריך'] ? String(record['תאריך']).slice(0, 10) : todayStr());
  const [structure, setStructure] = useState(firstId(record?.['מבנה']) || '');
  const [type, setType] = useState(record?.['סוג קטיף'] || '');
  const [typeOptions, setTypeOptions] = useState([]);
  const [kg, setKg] = useState(record?.['כמות ק"ג'] ?? '');
  const [cartons, setCartons] = useState(record?.['מספר קרטונים'] ?? '');
  const [bags, setBags] = useState(record?.['מספר שקיות'] ?? '');
  const [pallets, setPallets] = useState(record?.['מספר משטחים'] ?? '');
  const [notes, setNotes] = useState(record?.['הערות'] || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  // אפשרויות "סוג קטיף" מהמטא — לא כותבים ערך שאינו ברשימה
  useEffect(() => {
    fetch(`/api/select-options/${encodeURIComponent(TABLE)}/${encodeURIComponent('סוג קטיף')}`)
      .then((r) => (r.ok ? r.json() : { choices: [] }))
      .then((d) => setTypeOptions(Array.isArray(d.choices) ? d.choices : []))
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!date) { setError('חסר שדה חובה: תאריך'); return; }
    if (!structure) { setError('חסר שדה חובה: מבנה'); return; }
    setSaving(true); setError('');
    const fields = {
      'תאריך': date,
      'מבנה': [structure],
      'סוג קטיף': type || null,
      'כמות ק"ג': kg !== '' ? Number(kg) : null,
      'מספר קרטונים': cartons !== '' ? Number(cartons) : null,
      'מספר שקיות': bags !== '' ? Number(bags) : null,
      'מספר משטחים': pallets !== '' ? Number(pallets) : null,
      'הערות': notes || null,
    };
    if (!record) Object.keys(fields).forEach((k) => { if (fields[k] == null) delete fields[k]; });
    try {
      if (record?.id) await api.update(TABLE, record.id, fields);
      else await api.create(TABLE, fields);
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>{record ? 'עריכת קטיף' : 'קטיף חדש'}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={submit}>
          <div className="form-grid-2" style={{ gap: '0 12px' }}>
            <div className="form-group"><label className="required">תאריך</label>
              <input type="date" className="input" style={{ width: '100%' }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="form-group"><label className="required">מבנה</label>
              <select className="select" style={{ width: '100%' }} value={structure} onChange={(e) => setStructure(e.target.value)}>
                <option value="">בחר מבנה...</option>
                {structures.map((s) => <option key={s.id} value={s.id}>{s['מספר מבנה'] || s['סוג מבנה'] || s.id}</option>)}
              </select></div>
            <div className="form-group"><label>סוג קטיף</label>
              <select className="select" style={{ width: '100%' }} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">בחר...</option>
                {(typeOptions.length ? typeOptions : (type ? [type] : [])).map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="form-group"><label>כמות ק"ג</label>
              <input type="number" step="any" min="0" className="input" style={{ width: '100%' }} value={kg} onChange={(e) => setKg(e.target.value)} /></div>
            <div className="form-group"><label>מספר קרטונים</label>
              <input type="number" min="0" className="input" style={{ width: '100%' }} value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
            <div className="form-group"><label>מספר שקיות</label>
              <input type="number" min="0" className="input" style={{ width: '100%' }} value={bags} onChange={(e) => setBags(e.target.value)} /></div>
            <div className="form-group"><label>מספר משטחים</label>
              <input type="number" min="0" className="input" style={{ width: '100%' }} value={pallets} onChange={(e) => setPallets(e.target.value)} /></div>
          </div>
          <div className="form-group"><label>הערות</label>
            <textarea className="input" style={{ width: '100%' }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : record ? 'שמור שינויים' : 'שמור קטיף'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
