// ============================================================
// ריסוסים (סעיף 19) + חומרי ריסוס (סעיף 20)
// ------------------------------------------------------------
// KPI לפי שפת העיצוב (סה"כ / היום / השבוע / הושלמו), חיפוש
// ופילטרים שעובדים יחד, יצירה/עריכה/מחיקה מול Airtable,
// וטאב "חומרי ריסוס" עם חיפוש, "מינון ברירת מחדל" ו-CRUD.
// כלל האיפיון נשמר: "בסיס מינון" נבחר ידנית ואינו מוצע אוטומטית.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatNumber, formatDate, formatMoney, safeValue } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { exportCsv, fileStamp, inDateRange } from '../utils/table.js';

const TABLE = 'ריסוסים';
const MATERIALS_TABLE = 'חומרי ריסוס';

const MATERIAL_FORM_FIELDS = [
  { name: 'שם חומר', label: 'שם חומר', type: 'text', required: true },
  { name: 'מחיר', label: 'מחיר (₪)', type: 'number' },
  { name: 'גודל האריזה', label: 'גודל אריזה', type: 'number' },
  { name: 'מינון בסמ"ק', label: 'מינון ברירת מחדל', type: 'number' },
  { name: 'יחידת תמחור', label: 'יחידת תמחור', type: 'select' },
];

export default function SprayingPage({ initialTab }) {
  const app = useApp();
  const canEdit = ['owner', 'manager'].includes(app.user?.role || 'owner');
  const isOwner = (app.user?.role || 'owner') === 'owner';
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(initialTab || (params.get('tab') === 'materials' ? 'materials' : 'sprays'));

  const [items, setItems] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [structures, setStructures] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // null | {} | רשומת ריסוס
  const [materialForm, setMaterialForm] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // פילטרים לריסוסים
  const [search, setSearch] = useState('');
  const [fStructure, setFStructure] = useState('');
  const [fMaterial, setFMaterial] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(30);
  const [materialSearch, setMaterialSearch] = useState('');

  const load = useCallback(() => Promise.all([
    app.api.get(TABLE, '?maxRecords=1000'),
    app.api.get(MATERIALS_TABLE, '?maxRecords=300'),
    app.api.get('מבנים', '?maxRecords=200'),
    app.api.get('עובדים', '?maxRecords=200'),
  ]).then(([r, m, s, w]) => {
    setItems(Array.isArray(r) ? r : []);
    setMaterials(Array.isArray(m) ? m : []);
    setStructures(Array.isArray(s) ? s : []);
    setWorkers(Array.isArray(w) ? w : []);
  }).catch(() => {}), [app.api]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // פעולה מהירה מלוח הבקרה: ?new=1 פותח את טופס הריסוס
    if (params.get('new') === '1') {
      setForm({});
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const structName = (r) => displayName(r['מבנה'], '');
  const materialName = (r) => displayName(r['חומר ריסוס'], '');
  const executorName = (r) => displayName(r['מבצע'], '');

  const filtered = useMemo(() => items.filter((r) => {
    if (fStructure && structName(r) !== fStructure) return false;
    if (fMaterial && materialName(r) !== fMaterial) return false;
    if (fStatus === 'done' && !r['בוצע']) return false;
    if (fStatus === 'pending' && r['בוצע']) return false;
    if (!inDateRange(r['תאריך'], from, to)) return false;
    if (search) {
      const hay = [structName(r), materialName(r), executorName(r), r['סוג מרסס'], r['הערות'], r['סטטוס']]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => String(b['תאריך'] || '').localeCompare(String(a['תאריך'] || ''))), [items, search, fStructure, fMaterial, fStatus, from, to]);

  // KPI לפי שפת העיצוב (סעיף 25 בעיצוב)
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(day0); weekStart.setDate(day0.getDate() - ((day0.getDay() + 1) % 7)); // שבת
  const inDay = (r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d >= day0 && d < new Date(day0.getTime() + 86400000); };
  const inWeek = (r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d >= weekStart && d < new Date(weekStart.getTime() + 6 * 86400000); };

  const structOptions = useMemo(() => [...new Set(items.map(structName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [items]);
  const materialOptions = useMemo(() => [...new Set(items.map(materialName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [items]);

  const hasFilters = search || fStructure || fMaterial || fStatus || from || to;

  const markDone = async (r) => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await app.api.update(TABLE, r.id, { 'בוצע': !r['בוצע'] });
      await load();
      toast(r['בוצע'] ? 'הריסוס סומן כלא בוצע' : 'הריסוס סומן כבוצע');
    } catch (e) {
      toast('לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו.', 'error');
    }
    setBusyId(null);
  };

  const doExport = () => exportCsv(`ריסוסים-${fileStamp()}`, [
    { label: 'תאריך', get: (r) => formatDate(r['תאריך']) },
    { label: 'מבנה', get: structName },
    { label: 'חומר', get: materialName },
    { label: 'מבצע', get: executorName },
    { label: 'מינון', get: (r) => r['מינון '] ?? r['מינון'] ?? '' },
    { label: 'בסיס מינון', get: (r) => r['בסיס מינון'] || '' },
    { label: 'סוג מרסס', get: (r) => r['סוג מרסס'] || '' },
    { label: 'כמות מחושבת', get: (r) => r['כמות מחושבת'] ?? '' },
    { label: 'סטטוס', get: (r) => (r['בוצע'] ? 'בוצע' : 'לא בוצע') },
    { label: 'הערות', get: (r) => r['הערות'] || '' },
  ], filtered);

  const filteredMaterials = materials.filter((m) => !materialSearch
    || String(m['שם חומר'] || '').toLowerCase().includes(materialSearch.toLowerCase()));

  return (
    <div>
      <PageHeader icon="🧴" title={tab === 'materials' ? 'חומרי ריסוס' : 'ריסוסים'}>
        {tab === 'sprays' && <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>🖨️ הדפסה</button>}
        {tab === 'sprays' && <button type="button" className="btn btn-ghost no-print" onClick={doExport} disabled={!filtered.length}>⬇️ ייצוא</button>}
        {tab === 'sprays' && canEdit && <button className="btn btn-primary no-print" onClick={() => setForm({})}>+ ריסוס חדש</button>}
        {tab === 'materials' && isOwner && <button className="btn btn-primary no-print" onClick={() => setMaterialForm({})}>+ חומר חדש</button>}
      </PageHeader>

      <div className="tabs no-print" style={{ marginBottom: 18 }}>
        <button className={`tab ${tab === 'sprays' ? 'active' : ''}`} onClick={() => setTab('sprays')}>🧴 ריסוסים</button>
        <button className={`tab ${tab === 'materials' ? 'active' : ''}`} onClick={() => setTab('materials')}>🧪 חומרי ריסוס</button>
      </div>

      {loading ? <div className="skeleton skeleton-card" /> : tab === 'sprays' ? (
        <>
          <div className="kpi-grid">
            <Kpi icon="🧴" soft="var(--spray-soft)" color="var(--spray)" label="סה&quot;כ טיפולים" value={formatNumber(filtered.length)} />
            <Kpi icon="📅" soft="var(--warning-soft)" color="var(--warning)" label="טיפולים היום" value={formatNumber(filtered.filter(inDay).length)} />
            <Kpi icon="🗓️" soft="var(--irrigation-soft)" color="var(--irrigation)" label="טיפולים השבוע" value={formatNumber(filtered.filter(inWeek).length)} />
            <Kpi icon="✅" soft="var(--ok-soft)" color="var(--ok)" label="הושלמו" value={formatNumber(filtered.filter((i) => i['בוצע']).length)} />
          </div>

          {/* חיפוש + פילטרים */}
          <div className="filter-bar no-print" style={{ marginTop: 18 }}>
            <input className="input" aria-label="חיפוש ריסוס" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="select" aria-label="סינון לפי מבנה" value={fStructure} onChange={(e) => setFStructure(e.target.value)}>
              <option value="">כל המבנים</option>
              {structOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="select" aria-label="סינון לפי חומר" value={fMaterial} onChange={(e) => setFMaterial(e.target.value)}>
              <option value="">כל החומרים</option>
              {materialOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="select" aria-label="סינון לפי סטטוס" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">כל הסטטוסים</option>
              <option value="done">בוצע</option>
              <option value="pending">לא בוצע</option>
            </select>
            <label className="date-field">מתאריך<input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="date-field">עד תאריך<input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            {hasFilters && <button className="btn btn-ghost" onClick={() => { setSearch(''); setFStructure(''); setFMaterial(''); setFStatus(''); setFrom(''); setTo(''); }}>נקה פילטרים</button>}
          </div>

          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>רשימת ריסוסים ({formatNumber(filtered.length)})</div>
            {filtered.length === 0 ? <div className="empty-state"><div className="icon">🧴</div>אין נתונים לתקופה זו</div> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>תאריך</th><th>מבנה</th><th>חומר</th><th>מבצע</th><th>מינון</th><th>בסיס</th><th>כמות מחושבת</th><th>סטטוס</th>
                      {canEdit && <th className="no-print">פעולות</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, limit).map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r['תאריך'])}</td>
                        <td>{structName(r) ? <span className="obj-chip static">🏗️ {structName(r)}</span> : 'לא זמין'}</td>
                        <td>{materialName(r) || 'לא זמין'}</td>
                        <td>{executorName(r) || '—'}</td>
                        <td>{safeValue(r['מינון '] ?? r['מינון'] ?? '—')}</td>
                        <td>{r['בסיס מינון'] || '—'}</td>
                        <td>{r['כמות מחושבת'] != null ? formatNumber(r['כמות מחושבת']) : '—'}</td>
                        <td><span className={`badge ${r['בוצע'] ? 'badge-ok' : 'badge-warn'}`}>{r['בוצע'] ? '✓ בוצע' : '● לא בוצע'}</span></td>
                        {canEdit && (
                          <td className="no-print">
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm btn-ghost" disabled={busyId === r.id}
                                aria-label={r['בוצע'] ? 'סמן כלא בוצע' : 'סמן כבוצע'} title={r['בוצע'] ? 'סמן כלא בוצע' : 'סמן כבוצע'}
                                onClick={() => markDone(r)}>{busyId === r.id ? '…' : r['בוצע'] ? '↩' : '✓'}</button>
                              <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setForm(r)}>✎</button>
                              <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                                onClick={async () => {
                                  if (await removeRecord(app.api, TABLE, r.id, 'הריסוס')) await load();
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
      ) : (
        // ============ חומרי ריסוס (סעיף 20) ============
        <>
          <div className="filter-bar no-print">
            <input className="input" aria-label="חיפוש חומר" placeholder="חיפוש חומר..." value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatNumber(filteredMaterials.length)} חומרים</span>
          </div>
          <div className="grid">
            {filteredMaterials.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}><div className="icon">🧪</div>אין נתונים לתקופה זו</div>}
            {filteredMaterials.map((m) => (
              <div key={m.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <b style={{ fontSize: 16 }}>🧪 {m['שם חומר'] || 'חומר'}</b>
                  {m['יחידת תמחור'] && <span className="badge" style={{ background: 'var(--spray-soft)', color: 'var(--spray)' }}>{m['יחידת תמחור']}</span>}
                </div>
                <div style={{ fontSize: 14 }}>
                  {m['מחיר'] != null && <div className="obj-row"><span className="obj-row-label">מחיר</span><span className="obj-row-value">{formatMoney(m['מחיר'])}</span></div>}
                  {m['גודל האריזה'] != null && <div className="obj-row"><span className="obj-row-label">גודל אריזה</span><span className="obj-row-value">{formatNumber(m['גודל האריזה'])}</span></div>}
                  {m['מינון בסמ"ק'] != null && <div className="obj-row"><span className="obj-row-label">מינון ברירת מחדל</span><span className="obj-row-value">{formatNumber(m['מינון בסמ"ק'])}</span></div>}
                  {m['מחיר לדונם בריסוס'] != null && <div className="obj-row"><span className="obj-row-label">מחיר לדונם</span><span className="obj-row-value">{formatMoney(m['מחיר לדונם בריסוס'])}</span></div>}
                </div>
                {isOwner && (
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setMaterialForm(m)}>✎</button>
                    <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                      onClick={async () => {
                        if (await removeRecord(app.api, MATERIALS_TABLE, m.id, m['שם חומר'] || 'החומר')) await load();
                      }}>🗑</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {form !== null && (
        <SprayForm
          record={form.id ? form : null}
          materials={materials}
          structures={structures}
          workers={workers}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); toast('הריסוס נשמר בהצלחה'); }}
          api={app.api}
        />
      )}

      {materialForm !== null && (
        <RecordForm
          api={app.api} table={MATERIALS_TABLE}
          title={materialForm.id ? `עריכת ${materialForm['שם חומר'] || 'חומר'}` : 'חומר ריסוס חדש'}
          record={materialForm.id ? materialForm : null}
          fields={MATERIAL_FORM_FIELDS}
          onClose={() => setMaterialForm(null)}
          onSaved={async () => { setMaterialForm(null); await load(); toast('החומר נשמר בהצלחה'); }}
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

// ============================================================
// טופס ריסוס (סעיף 19) — יצירה ועריכה
// לאחר בחירת חומר מוצע "מינון" כברירת מחדל (ניתן לעריכה).
// "בסיס מינון" נבחר ידנית בלבד — האיפיון אוסר בחירה אוטומטית.
// ============================================================
function SprayForm({ record, materials, structures, workers, onClose, onSaved, api }) {
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [date, setDate] = useState(record?.['תאריך'] ? String(record['תאריך']).slice(0, 10) : todayStr());
  const [structure, setStructure] = useState(firstId(record?.['מבנה']) || '');
  const [material, setMaterial] = useState(firstId(record?.['חומר ריסוס']) || '');
  const [executor, setExecutor] = useState(firstId(record?.['מבצע']) || '');
  const [sprayerType, setSprayerType] = useState(record?.['סוג מרסס'] || '');
  const [sprayerSize, setSprayerSize] = useState(record?.['גודל מרסס בליטר'] ?? '');
  const [basis, setBasis] = useState(record?.['בסיס מינון'] || '');
  const [basisOptions, setBasisOptions] = useState([]);
  const [dosage, setDosage] = useState(record?.['מינון '] ?? record?.['מינון'] ?? '');
  const [notes, setNotes] = useState(record?.['הערות'] || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  // אפשרויות "בסיס מינון" מהמטא של Airtable
  useEffect(() => {
    fetch(`/api/select-options/${encodeURIComponent(TABLE)}/${encodeURIComponent('בסיס מינון')}`)
      .then((r) => (r.ok ? r.json() : { choices: [] }))
      .then((d) => setBasisOptions(Array.isArray(d.choices) && d.choices.length ? d.choices : ['לדונם', 'ל-100 ליטר', 'לליטר', 'אחוז']))
      .catch(() => setBasisOptions(['לדונם', 'ל-100 ליטר', 'לליטר', 'אחוז']));
  }, []);

  // בחירת חומר → הצעת מינון ברירת מחדל בלבד (לא בסיס!)
  const pickMaterial = (id) => {
    setMaterial(id);
    const m = materials.find((x) => x.id === id);
    const defDosage = m?.['מינון בסמ"ק'];
    if (defDosage != null && !record) setDosage(String(defDosage));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!structure) { setError('חסר שדה חובה: מבנה'); return; }
    if (!material) { setError('חסר שדה חובה: חומר ריסוס'); return; }
    setSaving(true); setError('');
    try {
      const fields = {
        'תאריך': date,
        'מבנה': [structure],
        'חומר ריסוס': [material],
        'מבצע': executor ? [executor] : null,
        'סוג מרסס': sprayerType || null,
        'גודל מרסס בליטר': sprayerSize !== '' ? Number(sprayerSize) : null,
        'בסיס מינון': basis || null,
        'מינון ': dosage !== '' ? dosage : null,
        'הערות': notes || null,
      };
      if (!record) {
        fields['בוצע'] = false;
        Object.keys(fields).forEach((k) => { if (fields[k] == null) delete fields[k]; });
        await api.create(TABLE, fields);
      } else {
        await api.update(TABLE, record.id, fields);
      }
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
    }
  };

  const workerLabel = (w) => `${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || w.id;

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>{record ? 'עריכת ריסוס' : 'ריסוס חדש'}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}

        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div className="form-group"><label className="required">תאריך</label>
              <input type="date" className="input" style={{ width: '100%' }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="form-group"><label className="required">מבנה</label>
              <select className="select" style={{ width: '100%' }} value={structure} onChange={(e) => setStructure(e.target.value)}>
                <option value="">בחר מבנה...</option>
                {structures.map((s) => <option key={s.id} value={s.id}>{s['מספר מבנה'] || s['סוג מבנה'] || s.id}</option>)}
              </select></div>
            <div className="form-group"><label className="required">חומר ריסוס</label>
              <select className="select" style={{ width: '100%' }} value={material} onChange={(e) => pickMaterial(e.target.value)}>
                <option value="">בחר חומר...</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m['שם חומר'] || m.id}</option>)}
              </select></div>
            <div className="form-group"><label>מבצע</label>
              <select className="select" style={{ width: '100%' }} value={executor} onChange={(e) => setExecutor(e.target.value)}>
                <option value="">לא צוין</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{workerLabel(w)}</option>)}
              </select></div>
            <div className="form-group"><label>סוג מרסס</label>
              <input className="input" style={{ width: '100%' }} value={sprayerType} onChange={(e) => setSprayerType(e.target.value)} /></div>
            <div className="form-group"><label>גודל מרסס (ליטר)</label>
              <input className="input" style={{ width: '100%' }} type="number" min="0" value={sprayerSize} onChange={(e) => setSprayerSize(e.target.value)} /></div>
            <div className="form-group"><label>בסיס מינון (בחירה ידנית)</label>
              <select className="select" style={{ width: '100%' }} value={basis} onChange={(e) => setBasis(e.target.value)}>
                <option value="">בחר...</option>
                {(basisOptions.includes(basis) || !basis ? basisOptions : [basis, ...basisOptions]).map((b) => <option key={b} value={b}>{b}</option>)}
              </select></div>
            <div className="form-group"><label>מינון</label>
              <input className="input" style={{ width: '100%' }} value={dosage} onChange={(e) => setDosage(e.target.value)} />
            </div>
          </div>

          <div className="form-group"><label>הערות</label>
            <textarea className="input" style={{ width: '100%', minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : record ? 'שמור שינויים' : 'שמור ריסוס'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
