// ============================================================
// טופס רשומה גנרי — יצירה / עריכה מול Airtable (סעיף 7: CRUD למנהל ראשי)
//
// fields: [{ name, label, type: 'text'|'number'|'date'|'select'|'textarea', required }]
// אפשרויות ה-select נטענות מהמטא של Airtable — לא מקודדות בקוד,
// כדי שלא ייכתב ערך שאינו ברשימה (כתיבה כזו נדחית).
// שדות ריקים אינם נשלחים; null לעולם אינו הופך ל-0.
// ============================================================
import { useEffect, useState } from 'react';

export default function RecordForm({ api, table, title, fields, record, onClose, onSaved }) {
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

  useEffect(() => {
    let cancelled = false;
    fields.filter((f) => f.type === 'select').forEach((f) => {
      fetch(`/api/select-options/${encodeURIComponent(table)}/${encodeURIComponent(f.name)}`)
        .then((r) => (r.ok ? r.json() : { choices: [] }))
        .then((d) => { if (!cancelled) setOptions((o) => ({ ...o, [f.name]: Array.isArray(d.choices) ? d.choices : [] })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const set = (name, v) => setValues((cur) => ({ ...cur, [name]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    for (const f of fields) {
      if (f.required && (values[f.name] === '' || values[f.name] == null)) {
        setError(`חסר שדה חובה: ${f.label}`);
        return;
      }
    }
    setSaving(true); setError('');
    const body = {};
    for (const f of fields) {
      const v = values[f.name];
      if (v === '' || v == null) { if (record?.id) body[f.name] = null; continue; }
      body[f.name] = f.type === 'number' ? Number(v) : v;
    }
    try {
      if (record?.id) await api.update(table, record.id, body);
      else await api.create(table, body);
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0 12px' }}>
            {fields.map((f) => (
              <div className="form-group" key={f.name} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                <label>{f.label}{f.required && <span className="required" />}</label>
                {f.type === 'select' ? (
                  <select className="select" style={{ width: '100%' }} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                    <option value="">בחר...</option>
                    {(options[f.name] || (values[f.name] ? [values[f.name]] : [])).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea className="input" style={{ width: '100%' }} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
                ) : (
                  <input className="input" style={{ width: '100%' }} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    step={f.type === 'number' ? 'any' : undefined}
                    value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : record?.id ? 'שמור שינויים' : 'צור'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** מחיקה עם אישור (סעיף "ניהול מחיקה") — מחזירה true אם נמחק בפועל */
export async function removeRecord(api, table, id, label) {
  if (!window.confirm(`למחוק את ${label}?\nהפעולה נכתבת ל-Airtable ואינה הפיכה.`)) return false;
  await api.remove(table, id);
  return true;
}
