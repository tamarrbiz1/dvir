import { useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatNumber } from '../utils/format.js';
import PageHeader from '../components/PageHeader.jsx';

export default function InventoryPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('add'); // add | reduce

  const load = () => {
    setLoading(true);
    app.api.get('מלאי בסיסי', '?maxRecords=200')
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const belowMin = items.filter((i) => Number(i['מלאי נוכחי']) <= Number(i['מלאי מינימום']));

  const apply = async () => {
    const amt = Number(amount);
    if (!editItem || !amt || amt <= 0) return;
    const current = Number(editItem['מלאי נוכחי']) || 0;
    const next = mode === 'add' ? current + amt : current - amt;
    if (mode === 'reduce' && amt > current) {
      alert('אין מספיק מלאי לביצוע ההפחתה');
      return;
    }
    try {
      await app.api.update('מלאי בסיסי', editItem.id, {
        'מלאי נוכחי': next,
        ...(editItem['תאריך עדכון'] !== undefined ? {} : {}),
      });
      setEditItem(null);
      load();
    } catch (e) {
      alert('נכשלה העדכון: ' + e.message);
    }
  };

  return (
    <div>
      <PageHeader icon="📦" title="מלאי" />

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--inventory-soft)' }}>📦</div><span className="kpi-label">סה"כ פריטים</span></div>
          <div className="kpi-value" style={{ color: 'var(--inventory)' }}>{items.length}</div>
          <div className="kpi-footer" style={{ background: 'var(--inventory)' }}>מלאי</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--warn-soft, var(--warning-soft))' }}>⚠️</div><span className="kpi-label">מתחת למינימום</span></div>
          <div className="kpi-value" style={{ color: 'var(--warning)' }}>{belowMin.length}</div>
          <div className="kpi-footer" style={{ background: 'var(--warning)' }}>דורש טיפול</div>
        </div>
      </div>

      <div style={{ marginTop: 22 }} className="grid">
        {items.map((item) => {
          const current = Number(item['מלאי נוכחי']) || 0;
          const min = Number(item['מלאי מינימום']) || 0;
          const isLow = current <= min;
          return (
            <div key={item.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <b>{item['קטגוריה'] || 'פריט'}</b>
                <span className={`badge ${isLow ? 'badge-error' : 'badge-ok'}`}>{isLow ? 'מלאי נמוך' : 'תקין'}</span>
              </div>
              <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
                <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>נוכחי</div><b style={{ fontSize: 22 }}>{formatNumber(current)}</b></div>
                <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>מינימום</div><b>{formatNumber(min)}</b></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => { setEditItem(item); setMode('add'); setAmount(''); }}>+ הוספת מלאי</button>
                <button className="btn btn-sm btn-ghost" onClick={() => { setEditItem(item); setMode('reduce'); setAmount(''); }}>➖ הורדה</button>
              </div>
            </div>
          );
        })}
      </div>

      {editItem && (
        <div className="modal-overlay" onClick={() => setEditItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{mode === 'add' ? '+ הוספת מלאי' : '➖ הורדת מלאי'}</h3>
            <div style={{ marginBottom: 10 }}>
              <b>{editItem['קטגוריה']}</b>
            </div>
            <div className="form-group">
              <label>מלאי נוכחי</label>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{formatNumber(editItem['מלאי נוכחי'])}</div>
            </div>
            <div className="form-group">
              <label>כמות {mode === 'add' ? 'להוספה' : 'להורדה'}</label>
              <input className="input" style={{ width: '100%' }} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
              מלאי לאחר: {formatNumber((Number(editItem['מלאי נוכחי']) || 0) + (mode === 'add' ? (Number(amount) || 0) : -(Number(amount) || 0)))}
            </div>
            {mode === 'reduce' && (Number(editItem['מלאי נוכחי']) || 0) - (Number(amount) || 0) <= Number(editItem['מלאי מינימום']) && (
              <div className="badge badge-warn" style={{ marginBottom: 10 }}>⚠️ המלאי יהיה מתחת למינימום</div>
            )}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setEditItem(null)}>ביטול</button>
              <button className="btn btn-primary" onClick={apply}>אישור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
