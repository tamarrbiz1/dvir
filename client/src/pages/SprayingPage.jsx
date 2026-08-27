import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber, formatDate, safeValue } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';

export default function SprayingPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [structures, setStructures] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      app.api.get('ריסוסים', '?maxRecords=300'),
      app.api.get('חומרי ריסוס', '?maxRecords=200'),
      app.api.get('מבנים', '?maxRecords=200'),
      app.api.get('עובדים', '?maxRecords=200'),
    ])
      .then(([r, m, s, w]) => {
        setItems(Array.isArray(r) ? r : []);
        setMaterials(Array.isArray(m) ? m : []);
        setStructures(Array.isArray(s) ? s : []);
        setWorkers(Array.isArray(w) ? w : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const workerSelect = (id) => {
    const w = workers.find((x) => x.id === id);
    return w ? `${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() : 'לא זמין';
  };

  return (
    <div>
      <div className="page-header">
        <h2>ריסוסים</h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ ריסוס חדש</button>
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--spray-soft)' }}>🧴</div><span className="kpi-label">סה"כ טיפולים</span></div>
              <div className="kpi-value" style={{ color: 'var(--spray)' }}>{items.length}</div>
              <div className="kpi-footer" style={{ background: 'var(--spray)' }}>ריסוסים</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--ok-soft)' }}>✅</div><span className="kpi-label">הושלמו</span></div>
              <div className="kpi-value" style={{ color: 'var(--ok)' }}>{items.filter((i) => i['בוצע']).length}</div>
              <div className="kpi-footer" style={{ background: 'var(--ok)' }}>בוצע</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginTop: 0 }}>רשימת ריסוסים</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>תאריך</th><th>מבנה</th><th>חומר</th><th>מבצע</th><th>מינון</th><th>יחידת תמחור</th><th>כמות מחושבת</th><th>סטטוס</th><th>פעולה</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 200).map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r['תאריך'])}</td>
                      <td>{displayName(r['מבנה'] || r['_display_מבנה'])}</td>
                      <td>{displayName(r['חומר ריסוס'] || r['_display_חומר ריסוס'])}</td>
                      <td>{displayName(r['מבצע'] || r['_display_מבצע'])}</td>
                      <td>{safeValue(r['מינון '] ?? r['מינון'] ?? '')}</td>
                      <td>{getUnit(r['חומר ריסוס'], materials)}</td>
                      <td>{safeValue(r['כמות מחושבת'] ? formatNumber(r['כמות מחושבת']) : '-')}</td>
                      <td><span className={`badge ${r['בוצע'] ? 'badge-ok' : 'badge-warn'}`}>{r['בוצע'] ? 'בוצע' : 'לא בוצע'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={async () => {
                              try { await app.api.update('ריסוסים', r.id, { 'בוצע': !r['בוצע'] }); load(); } catch {}
                            }}
                          >
                            {r['בוצע'] ? '↩' : '✓'}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ color: 'var(--error)' }}
                            onClick={async () => {
                              if (window.confirm('למחוק ריסוס זה?')) {
                                try { await app.api.remove('ריסוסים', r.id); load(); } catch {}
                              }
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="section-title" style={{ marginTop: 0 }}>חומרי ריסוס</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>שם חומר</th><th>מחיר</th><th>גודל אריזה</th><th>מינון ברירת מחדל</th></tr></thead>
                <tbody>
                  {materials.slice(0, 30).map((m) => (
                    <tr key={m.id}>
                      <td>{m['שם חומר'] || '—'}</td>
                      <td>{m['מחיר'] != null ? formatNumber(m['מחיר']) : '—'}</td>
                      <td>{m['גודל האריזה'] != null ? formatNumber(m['גודל האריזה']) : '—'}</td>
                      <td>{safeValue(m['מינון בסמ"ק (from חומר ריסוס)'] ?? m['מינון '] ?? m['מינון'] ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <SprayForm
          materials={materials}
          structures={structures}
          workers={workers}
          workerSelect={workerSelect}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
          api={app.api}
        />
      )}
    </div>
  );
}

// ============================================================
// טופס ריסוס חדש (סעיף 19)
// ============================================================
function SprayForm({ materials, structures, workers, workerSelect, onClose, onSaved, api }) {
  const [date, setDate] = useState(today());
  const [structure, setStructure] = useState('');
  const [material, setMaterial] = useState('');
  const [executor, setExecutor] = useState('');
  const [sprayerType, setSprayerType] = useState('');
  const [sprayerSize, setSprayerSize] = useState('');
  const [basis, setBasis] = useState('');
  const [dosage, setDosage] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // בחירת חומר → השלמת ברירות מחדל
  const pickMaterial = (id) => {
    setMaterial(id);
    const m = materials.find((x) => x.id === id);
    if (m) {
      const defDosage = m['מינון בסמ"ק (from חומר ריסוס)'] ?? m['מינון '] ?? m['מינון'];
      if (defDosage != null) setDosage(String(defDosage));
      const defBasis = m['בסיס מינון (from חומר ריסוס)'] || m['בסיס מינון'];
      if (defBasis) setBasis(defBasis);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    if (!structure) { setError('יש לבחור מבנה'); setSaving(false); return; }
    if (!material) { setError('יש לבחור חומר ריסוס'); setSaving(false); return; }
    try {
      const fields = {
        'תאריך': date,
        'מבנה': [structure],
        'חומר ריסוס': [material],
        'מבצע': executor ? [executor] : null,
        'סוג מרסס': sprayerType || null,
        'גודל מרסס בליטר': sprayerSize ? Number(sprayerSize) : null,
        'בסיס מינון': basis || null,
        'מינון ': dosage || null,
        'הערות': notes || null,
        'בוצע': false,
      };
      // הסרת מפתחות ריקים
      Object.keys(fields).forEach((k) => { if (fields[k] == null) delete fields[k]; });
      await api.create('ריסוסים', fields);
      onSaved();
    } catch (err) {
      setError(err.message || 'שגיאה בשמירת הריסוס');
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>ריסוס חדש</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}

        <form onSubmit={submit}>
          <div className="form-group"><label>תאריך</label><input type="date" className="input" style={{ width: '100%' }} value={date} onChange={(e) => setDate(e.target.value)} /></div>

          <div className="form-group">
            <label>מבנה</label>
            <select className="select" style={{ width: '100%' }} value={structure} onChange={(e) => setStructure(e.target.value)}>
              <option value="">בחר מבנה...</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s['מספר מבנה'] || s['סוג מבנה'] || s.id}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>חומר ריסוס</label>
            <select className="select" style={{ width: '100%' }} value={material} onChange={(e) => pickMaterial(e.target.value)}>
              <option value="">בחר חומר...</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m['שם חומר'] || m['חומר'] || m.id}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>מבצע</label>
            <select className="select" style={{ width: '100%' }} value={executor} onChange={(e) => setExecutor(e.target.value)}>
              <option value="">לא צוין</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{workerSelect(w.id)}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>סוג מרסס</label>
              <input className="input" style={{ width: '100%' }} value={sprayerType} onChange={(e) => setSprayerType(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>גודל מרסס (ליטר)</label>
              <input className="input" style={{ width: '100%' }} type="number" value={sprayerSize} onChange={(e) => setSprayerSize(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>בסיס מינון</label>
              <select className="select" style={{ width: '100%' }} value={basis} onChange={(e) => setBasis(e.target.value)}>
                <option value="">בחר</option>
                <option value="לדונם">לדונם</option>
                <option value="ל-100 ליטר">ל-100 ליטר</option>
                <option value="לליטר">לליטר</option>
                <option value="אחוז">אחוז</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>מינון</label>
            <input className="input" style={{ width: '100%' }} value={dosage} onChange={(e) => setDosage(e.target.value)} />
          </div>

          <div className="form-group"><label>הערות</label><textarea className="input" style={{ width: '100%', minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שותפות...' : 'שמור ריסוס'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getUnit(matLink, materials) {
  if (!matLink) return '—';
  const first = Array.isArray(matLink) ? matLink[0] : matLink;
  const id = first && typeof first === 'object' ? first.id : first;
  const m = id ? materials.find((x) => x.id === id) : null;
  const unit = m && m['יחידת תמחור'];
  if (!unit) return '—';
  return unit === 'ק׳ג' || unit === 'ק"ג' ? 'ק"ג' : 'ליטר';
}
