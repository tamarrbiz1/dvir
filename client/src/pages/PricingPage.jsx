import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, safeValue } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { toast } from '../utils/ui.js';

const PRICING_FORM_FIELDS = [
  { name: 'זן', label: 'זן', type: 'text' },
  { name: 'סוג עבודה', label: 'סוג עבודה', type: 'text', required: true },
  { name: 'סוג עבודה-תאילנדית', label: 'סוג עבודה בתאילנדית', type: 'text' },
  { name: 'יחידת תמחור', label: 'יחידת תמחור', type: 'text' },
  { name: 'מחיר', label: 'מחיר (₪)', type: 'number', required: true },
];

// ============================================================
// תמחור עבודות (סעיף 16) + תמחור לפי מבנים (סעיף 17)
// גישה: בעל העסק בלבד
// ============================================================

export default function PricingPage() {
  const app = useApp();
  const canEdit = (app.user?.role || 'owner') === 'owner';
  const [form, setForm] = useState(null);
  const [view, setView] = useState('pricing'); // pricing | byStructure
  const [pricing, setPricing] = useState([]);
  const [pricingByStruct, setPricingByStruct] = useState([]);
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);

  // פילטרים לפי זן / סוג עבודה / יחידה
  const [fZan, setFZan] = useState('');
  const [fWorkType, setFWorkType] = useState('');
  const [fUnit, setFUnit] = useState('');

  const reload = () => Promise.all([
    app.api.get('תמחור עבודות', '?maxRecords=800'),
    app.api.get('תמחור עבודות לפי מבנים', '?maxRecords=800'),
  ]).then(([p, ps]) => {
    setPricing(Array.isArray(p) ? p : []);
    setPricingByStruct(Array.isArray(ps) ? ps : []);
  }).catch(() => {});

  useEffect(() => {
    Promise.all([
      app.api.get('תמחור עבודות', '?maxRecords=800'),
      app.api.get('תמחור עבודות לפי מבנים', '?maxRecords=800'),
      app.api.get('מבנים', '?maxRecords=200'),
    ])
      .then(([p, ps, st]) => {
        setPricing(Array.isArray(p) ? p : []);
        setPricingByStruct(Array.isArray(ps) ? ps : []);
        setStructures(Array.isArray(st) ? st : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const zanim = useMemo(() => [...new Set(pricing.map((p) => p['זן']).filter(Boolean))], [pricing]);
  const workTypes = useMemo(() => [...new Set(pricing.map((p) => p['סוג עבודה']).filter(Boolean))], [pricing]);
  const units = useMemo(() => [...new Set(pricing.map((p) => p['יחידת תמחור']).filter(Boolean))], [pricing]);

  const filtered = pricing.filter((p) => {
    if (fZan && p['זן'] !== fZan) return false;
    if (fWorkType && p['סוג עבודה'] !== fWorkType) return false;
    if (fUnit && p['יחידת תמחור'] !== fUnit) return false;
    return true;
  });

  const structName = (val) => {
    const first = Array.isArray(val) ? val[0] : val;
    if (first && typeof first === 'object') return first.name ?? first.id ?? '';
    const s = structures.find((x) => x.id === first);
    return s ? (s['מספר מבנה'] || s['סוג מבנה'] || s.id) : (first ?? '');
  };
  const pricingName = (val) => {
    if (Array.isArray(val)) return val.map((x) => (typeof x === 'object' ? x.name : x)).join(', ');
    return val ?? '';
  };

  return (
    <div>
      <PageHeader icon="🏷️" title="תמחור עבודות">
        {canEdit && view === 'pricing' && <button className="btn btn-primary no-print" onClick={() => setForm({})}>+ תמחור חדש</button>}
      </PageHeader>

      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={`tab ${view === 'pricing' ? 'active' : ''}`} onClick={() => setView('pricing')}>תמחור עבודות</button>
        <button className={`tab ${view === 'byStructure' ? 'active' : ''}`} onClick={() => setView('byStructure')}>תמחור לפי מבנים</button>
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : view === 'pricing' ? (
        <>
          {/* פילטרים */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <select className="select" value={fZan} onChange={(e) => setFZan(e.target.value)}>
                <option value="">כל הזנים</option>
                {zanim.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="select" value={fWorkType} onChange={(e) => setFWorkType(e.target.value)}>
                <option value="">כל סוגי העבודה</option>
                {workTypes.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <select className="select" value={fUnit} onChange={(e) => setFUnit(e.target.value)}>
                <option value="">כל יחידות התמחור</option>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>זן</th><th>סוג עבודה</th><th>סוג עבודה בתאילנדית</th><th>יחידת תמחור</th><th>מחיר</th>{canEdit && <th className="no-print">פעולות</th>}</tr></thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id}>
                      <td>{safeValue(p['זן'])}</td>
                      <td>{safeValue(p['סוג עבודה'])}</td>
                      <td>{safeValue(p['סוג עבודה-תאילנדית'])}</td>
                      <td>{safeValue(p['יחידת תמחור'])}</td>
                      <td style={{ fontWeight: 700 }}>{p['מחיר'] != null ? `${formatNumber(p['מחיר'])} ₪` : 'לא זמין'}</td>
                      {canEdit && (
                        <td className="no-print">
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setForm(p)}>✎</button>
                            <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                              onClick={async () => {
                                if (await removeRecord(app.api, 'תמחור עבודות', p.id, p['סוג עבודה'] || 'התמחור')) await reload();
                              }}>🗑</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <StructurePricingTable items={pricingByStruct} structName={structName} pricingName={pricingName}
          canEdit={canEdit} api={app.api} structures={structures} pricing={pricing} onChanged={reload} />
      )}

      {form !== null && (
        <RecordForm
          api={app.api} table="תמחור עבודות"
          title={form.id ? `עריכת ${form['סוג עבודה'] || 'תמחור'}` : 'תמחור חדש'}
          record={form.id ? form : null}
          fields={PRICING_FORM_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await reload(); toast('התמחור נשמר בהצלחה'); }}
        />
      )}
    </div>
  );
}

// ============================================================
// תמחור לפי מבנים — טבלה + Drawer גיאומטרי
// ============================================================
function StructurePricingTable({ items, structName, pricingName, canEdit, api, structures, pricing, onChanged }) {
  const [drawer, setDrawer] = useState(null);
  const [geom, setGeom] = useState(null); // המבנה לגיאומטריה
  const [addForm, setAddForm] = useState(null); // {structure, price}
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');

  const saveLink = async () => {
    if (saving || !addForm?.structure || !addForm?.price) { setAddError('יש לבחור מבנה ותמחור'); return; }
    setSaving(true); setAddError('');
    try {
      await api.create('תמחור עבודות לפי מבנים', { 'מבנים': [addForm.structure], 'תמחור עבודות': [addForm.price] });
      setAddForm(null);
      await onChanged();
      toast('השיוך נשמר בהצלחה');
    } catch (e) {
      setAddError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
    }
    setSaving(false);
  };

  const open = (row) => {
    setDrawer(row);
    // איתור המבנה (קישור — העמודה בפועל: "מבנים")
    const link = row['מבנים'] ?? row['מבנה'];
    if (Array.isArray(link) && link[0]) {
      setGeom(link[0]); // {id, name, fields?}
    }
  };

  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 14 }}>
          <button className="btn btn-primary no-print" onClick={() => { setAddError(''); setAddForm({ structure: '', price: '' }); }}>+ שיוך תמחור למבנה</button>
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>מבנה</th><th>תמחור עבודה</th><th>יחידת תמחור</th><th>מחיר</th><th>מחיר לגמלון ראשון</th>{canEdit && <th className="no-print" />}</tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} onClick={() => open(r)} style={{ cursor: 'pointer' }}>
                  <td>{structName(r['מבנים'] ?? r['מבנה'])}</td>
                  <td>{pricingName(r['תמחור עבודות'])}</td>
                  <td>{safeValue(r['יחידת תמחור'])}</td>
                  <td>{r['מחיר'] != null ? `${formatNumber(r['מחיר'])} ₪` : 'לא זמין'}</td>
                  <td>{r['מחיר לגמלון ראשון'] != null ? `${formatNumber(r['מחיר לגמלון ראשון'])} ₪` : '—'}</td>
                  {canEdit && (
                    <td className="no-print" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-ghost" aria-label="מחיקת השיוך" title="מחיקת השיוך" style={{ color: 'var(--error)' }}
                        onClick={async () => {
                          if (await removeRecord(api, 'תמחור עבודות לפי מבנים', r.id, 'שיוך התמחור')) await onChanged();
                        }}>🗑</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addForm && (
        <div className="modal-overlay" onClick={() => !saving && setAddForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>שיוך תמחור למבנה</h3>
            {addError && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {addError}</div>}
            <div className="form-group"><label className="required">מבנה</label>
              <select className="select" style={{ width: '100%' }} value={addForm.structure} onChange={(e) => setAddForm({ ...addForm, structure: e.target.value })}>
                <option value="">בחר מבנה...</option>
                {structures.map((st) => <option key={st.id} value={st.id}>{st['מספר מבנה'] || st['סוג מבנה'] || st.id}</option>)}
              </select></div>
            <div className="form-group"><label className="required">תמחור עבודה</label>
              <select className="select" style={{ width: '100%' }} value={addForm.price} onChange={(e) => setAddForm({ ...addForm, price: e.target.value })}>
                <option value="">בחר תמחור...</option>
                {pricing.map((pr) => <option key={pr.id} value={pr.id}>{[pr['סוג עבודה'], pr['זן'], pr['מחיר'] != null ? `₪${pr['מחיר']}` : null].filter(Boolean).join(' · ')}</option>)}
              </select></div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setAddForm(null)}>ביטול</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveLink}>{saving ? 'שומר...' : 'שמור שיוך'}</button>
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <div className="drawer-overlay" onClick={() => setDrawer(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <span>תמחור — {structName(drawer['מבנים'] ?? drawer['מבנה'])}</span>
              <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label="סגירה" title="סגירה">✕</button>
            </div>
            <div className="drawer-body">
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="section-title" style={{ marginTop: 0 }}>פרטי תמחור</div>
                <Row label="תמחור עבודה" val={pricingName(drawer['תמחור עבודות'])} />
                <Row label="יחידת תמחור" val={safeValue(drawer['יחידת תמחור'])} />
                <Row label="מחיר" val={drawer['מחיר'] != null ? `${formatNumber(drawer['מחיר'])} ₪` : 'לא זמין'} />
                <Row label="מחיר לגמלון ראשון" val={drawer['מחיר לגמלון ראשון'] != null ? `${formatNumber(drawer['מחיר לגמלון ראשון'])} ₪` : '—'} />
                <Row label="מחיר לחלקה" val={drawer['מחיר לחלקה'] != null ? `${formatNumber(drawer['מחיר לחלקה'])} ₪` : '—'} />
                <Row label="מחיר לקרטון" val={drawer['מחיר יחידה לקרטון'] != null ? `${formatNumber(drawer['מחיר יחידה לקרטון'])} ₪` : '—'} />
                <Row label="מחיר לשורה" val={drawer['מחיר יחידה לשורה'] != null ? `${formatNumber(drawer['מחיר יחידה לשורה'])} ₪` : '—'} />
                <Row label="מחיר לגמלון" val={drawer['מחיר יחידה לגמלון'] != null ? `${formatNumber(drawer['מחיר יחידה לגמלון'])} ₪` : '—'} />
              </div>
              <div className="card">
                <div className="section-title" style={{ marginTop: 0 }}>מידע גיאומטרי</div>
                <Row label="שטח" val={drawer['שטח בדונם (from מבנים)'] != null ? `${formatNumber(drawer['שטח בדונם (from מבנים)'])} דונם` : 'לא זמין'} />
                <Row label="מספר שורות" val={formatNumber(drawer['מספר שורות במבנה (from מבנים)'] ?? geom?.fields?.['מספר שורות במבנה'])} />
                <Row label="אורך שורה" val={drawer['אורך שורה במטרים (from מבנים)'] != null ? `${formatNumber(drawer['אורך שורה במטרים (from מבנים)'])} מטר` : 'לא זמין'} />
                <Row label="מספר גמלונים" val={formatNumber(drawer['מספר גמלונים (from מבנים)'] ?? geom?.fields?.['מספר גמלונים'])} />
                <Row label="שלוחות טפטוף" val={formatNumber(drawer['מספר שלוחות טפטוף בגמלון (from מבנים)'] ?? geom?.fields?.['מספר שלוחות טפטוף בגמלון'])} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, val }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span><b>{val ?? 'לא זמין'}</b>
    </div>
  );
}
