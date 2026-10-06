// ============================================================
// טופס רשומה גנרי — יצירה / עריכה מול Airtable (סעיף 7: CRUD למנהל ראשי)
//
// fields: [{ name, label, type: 'text'|'number'|'date'|'select'|'multiselect'|'textarea'|'link', required }]
// אפשרויות ה-select/multiselect נטענות מהמטא של Airtable — לא מקודדות
// בקוד, כדי שלא ייכתב ערך שאינו ברשימה (כתיבה כזו נדחית).
//
// type 'link' — קישור לרשומה מטבלה אחרת (סעיף C, 2026-10-06): שדה
// נוסף חובה { linkTable, linkNameField, multiple? }. האפשרויות נטענות
// עם app.api.get(linkTable) (לא select-options — זה לא שדה-בחירה
// ב-Airtable). ברירת מחדל multiple=false: ה-UI הוא select יחיד, אבל
// הערך הנשלח ל-Airtable הוא תמיד מערך (שדה קישור מצפה למערך של
// Record IDs, גם כשיש בו רשומה אחת). אם הטבלה המקושרת ריקה — מוצג
// "אין <label> — הוסף" עם יצירה מהירה (שם בלבד) בלי לעזוב את הטופס.
// שדות ריקים אינם נשלחים; null לעולם אינו הופך ל-0.
// ============================================================
import { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../utils/ui.js';
import { authFetch } from '../utils/authFetch.js';

export default function RecordForm({ api, table, title, fields, record, onClose, onSaved }) {
  const [values, setValues] = useState(() => {
    const v = {};
    fields.forEach((f) => {
      let cur = record?.[f.name];
      if (f.type === 'date' && cur) cur = String(cur).slice(0, 10);
      if (f.type === 'multiselect') cur = Array.isArray(cur) ? cur : (cur ? [cur] : []);
      if (f.type === 'link') {
        const ids = Array.isArray(cur) ? cur.map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean) : [];
        cur = f.multiple ? ids : (ids[0] || '');
      }
      v[f.name] = cur ?? (f.type === 'multiselect' || (f.type === 'link' && f.multiple) ? [] : '');
    });
    return v;
  });
  const [options, setOptions] = useState({});
  const [linkOptions, setLinkOptions] = useState({}); // { [fieldName]: [{id, name}] }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // שדות "מחושבים" (formula/rollup/lookup/autoNumber/...) — Airtable דוחה כל
  // כתיבה אליהם. נטען פעם אחת מהמטא ומסונן אוטומטית מגוף הבקשה, בלי תלות
  // בכך שרשימת ה-fields של הטופס בנויה נכון (תקרית 2026-09-06: מסך מבנים).
  const [computedFields, setComputedFields] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/meta/${encodeURIComponent(table)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && Array.isArray(d?.computedFields)) setComputedFields(new Set(d.computedFields)); })
      .catch(() => {});
    fields.filter((f) => f.type === 'select' || f.type === 'multiselect').forEach((f) => {
      authFetch(`/api/select-options/${encodeURIComponent(table)}/${encodeURIComponent(f.name)}`)
        .then((r) => (r.ok ? r.json() : { choices: [] }))
        .then((d) => { if (!cancelled) setOptions((o) => ({ ...o, [f.name]: Array.isArray(d.choices) ? d.choices : [] })); })
        .catch(() => {});
    });
    fields.filter((f) => f.type === 'link' && f.linkTable).forEach((f) => {
      api.get(f.linkTable, '?maxRecords=200')
        .then((d) => { if (!cancelled) setLinkOptions((o) => ({ ...o, [f.name]: Array.isArray(d) ? d : [] })); })
        .catch(() => { if (!cancelled) setLinkOptions((o) => ({ ...o, [f.name]: [] })); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const set = (name, v) => setValues((cur) => ({ ...cur, [name]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    for (const f of fields) {
      if (computedFields.has(f.name)) continue; // לקריאה בלבד — לעולם לא שדה חובה מבחינת הטופס
      const v = values[f.name];
      const empty = Array.isArray(v) ? v.length === 0 : (v === '' || v == null);
      if (f.required && empty) {
        setError(`חסר שדה חובה: ${f.label}`);
        return;
      }
    }
    setSaving(true); setError('');
    const body = {};
    for (const f of fields) {
      if (computedFields.has(f.name)) continue; // לעולם לא נשלח — Airtable דוחה כתיבה לשדה מחושב
      const v = values[f.name];
      if (f.type === 'multiselect') {
        if (Array.isArray(v) && v.length) body[f.name] = v;
        else if (record?.id) body[f.name] = [];
        continue;
      }
      if (f.type === 'link') {
        // שדה קישור מצפה למערך של Record IDs (גם כשיש בו רשומה אחת)
        const ids = f.multiple ? (Array.isArray(v) ? v : []) : (v ? [v] : []);
        if (ids.length) body[f.name] = ids;
        else if (record?.id) body[f.name] = [];
        continue;
      }
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
                <label>{f.label}{f.required && !computedFields.has(f.name) && <span className="required" />}</label>
                {computedFields.has(f.name) ? (
                  <div className="input" style={{ width: '100%', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'default' }}
                    title="שדה מחושב אוטומטית ב-Airtable — לא ניתן לעריכה">
                    {values[f.name] === '' || values[f.name] == null ? 'מחושב אוטומטית' : String(values[f.name])}
                  </div>
                ) : f.type === 'multiselect' ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(options[f.name] || []).map((c) => {
                      const on = (values[f.name] || []).includes(c);
                      return (
                        <button type="button" key={c} className="badge"
                          style={{ cursor: 'pointer', border: `1px solid ${on ? 'var(--accent-top)' : 'var(--border)'}`, background: on ? 'var(--accent-top)' : '#fff', color: on ? '#fff' : 'var(--text-main)', padding: '6px 12px' }}
                          onClick={() => set(f.name, on ? (values[f.name] || []).filter((x) => x !== c) : [...(values[f.name] || []), c])}>
                          {c}
                        </button>
                      );
                    })}
                    {!(options[f.name] || []).length && <span className="muted" style={{ fontSize: 12 }}>טוען אפשרויות...</span>}
                  </div>
                ) : f.type === 'select' ? (
                  <select className="select" style={{ width: '100%' }} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                    <option value="">בחר...</option>
                    {(options[f.name] || (values[f.name] ? [values[f.name]] : [])).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : f.type === 'link' ? (
                  <LinkField
                    api={api}
                    linkTable={f.linkTable}
                    nameField={f.linkNameField || 'שם'}
                    label={f.label}
                    multiple={!!f.multiple}
                    value={values[f.name]}
                    options={linkOptions[f.name]}
                    onChange={(v) => set(f.name, v)}
                    onCreated={(rec) => setLinkOptions((o) => ({ ...o, [f.name]: [...(o[f.name] || []), rec] }))}
                  />
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

// ============================================================
// שדה 'link' — select יחיד (ברירת מחדל) או צ'קבוקסים (multiple) מתוך
// רשומות של טבלה אחרת. אם הטבלה ריקה (או עדיין בטעינה) מוצג "הוסף"
// עם יצירה מהירה (שם בלבד) שלא עוזבת את הטופס — הרשומה החדשה נבחרת
// אוטומטית. value: מחרוזת מזהה (יחיד) או מערך מזהים (multiple).
// ============================================================
function LinkField({ api, linkTable, nameField, label, multiple, value, options, onChange, onCreated }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const loaded = Array.isArray(options);
  const list = loaded ? options : [];
  const displayName = (rec) => rec?.[nameField] || 'ללא שם';

  const createQuick = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const rec = await api.create(linkTable, { [nameField]: name });
      onCreated(rec);
      onChange(multiple ? [...(Array.isArray(value) ? value : []), rec.id] : rec.id);
      setAdding(false); setNewName('');
    } catch (e) {
      toast(`לא ניתן היה ליצור ${label} חדש. (${e.message || e})`, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      {!loaded ? (
        <span className="muted" style={{ fontSize: 12 }}>טוען אפשרויות...</span>
      ) : multiple ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map((rec) => {
            const on = (Array.isArray(value) ? value : []).includes(rec.id);
            return (
              <button type="button" key={rec.id} className="badge"
                style={{ cursor: 'pointer', border: `1px solid ${on ? 'var(--accent-top)' : 'var(--border)'}`, background: on ? 'var(--accent-top)' : '#fff', color: on ? '#fff' : 'var(--text-main)', padding: '6px 12px' }}
                onClick={() => onChange(on ? value.filter((x) => x !== rec.id) : [...(Array.isArray(value) ? value : []), rec.id])}>
                {displayName(rec)}
              </button>
            );
          })}
          {!list.length && <span className="muted" style={{ fontSize: 12 }}>אין {label} עדיין</span>}
        </div>
      ) : (
        <select className="select" style={{ width: '100%' }} value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">בחר...</option>
          {list.map((rec) => <option key={rec.id} value={rec.id}>{displayName(rec)}</option>)}
        </select>
      )}
      {loaded && !list.length && !multiple && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>אין {label} — הוסף</div>
      )}
      {!adding ? (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6, padding: '2px 8px' }} onClick={() => setAdding(true)}>+ {label} חדש</button>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input className="input" style={{ flex: 1 }} placeholder={`שם ${label} חדש`} autoFocus value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createQuick(); } }} />
          <button type="button" className="btn btn-primary btn-sm" disabled={creating || !newName.trim()} onClick={createQuick}>{creating ? '...' : 'צור'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setNewName(''); }}>✕</button>
        </div>
      )}
    </div>
  );
}

/** מחיקה עם אישור (סעיף "ניהול מחיקה") — מחזירה true אם נמחק בפועל.
 *  הכפתור אדום, אין מחיקה בלחיצה ראשונה, ובכישלון הפריט אינו נעלם מהמסך. */
export async function removeRecord(api, table, id, label) {
  const ok = await confirmDialog({
    title: `מחיקת ${label}`,
    message: 'הפריט ימחק ולא יינתן לשחזור.\nהאם אתה בטוח שברצונך לבצע פעולה זו?',
    confirmLabel: 'מחק',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.remove(table, id);
  } catch (e) {
    toast('לא ניתן היה למחוק את הפריט.', 'error');
    return false;
  }
  toast('הפריט נמחק בהצלחה');
  return true;
}
