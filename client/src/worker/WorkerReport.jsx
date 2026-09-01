// ============================================================
// דיווח עבודה — יצירת רשומת "עבודות עובדים" ב-Airtable
// ============================================================
import { useEffect, useState } from 'react';
import { t } from '../i18n.js';

export default function WorkerReport({ api, worker, approvedDate = null, onDone }) {
  const [structures, setStructures] = useState([]);
  const [pricing, setPricing] = useState([]);
  // כלל סופי באיפיון: תאריך העבודה הוא תמיד היום ואינו ניתן לעריכה —
  // אלא אם המנהל אישר בקשה שמאפשרת הזנה לתאריך אחר.
  const [date, setDate] = useState(approvedDate || today());
  useEffect(() => { setDate(approvedDate || today()); }, [approvedDate]);
  const [structure, setStructure] = useState('');
  const [workType, setWorkType] = useState('');
  const [amount, setAmount] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('מבנים', '?maxRecords=200'),
      api.get('תמחור עבודות', '?maxRecords=800&raw=1'),
    ])
      .then(([s, p]) => {
        setStructures(Array.isArray(s) ? s : []);
        setPricing(Array.isArray(p) ? p : []);
      })
      .catch(() => {});
  }, []);

  // סוג העבודה נבחר מרשומות "תמחור עבודות" — הקישור נכתב ל-Airtable
  // כדי ש"סכום לתשלום" יחושב לפי המחיר (בלי להציג את המחיר לעובד)
  const pricingOptions = pricing.map((p) => ({
    id: p.id,
    label: [p['סוג עבודה'], p['זן']].filter(Boolean).join(' · ') || p.id,
    unit: p['יחידת תמחור'],
  })).filter((p) => p.label !== p.id);

  const selectedPricing = pricingOptions.find((p) => p.id === workType);
  const amountLabel = dynamicUnitLabel(selectedPricing?.unit);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess(false);
    // המבנה הוא שדה חובה; סוג העבודה נבחר עבור תצוגה/תווית — אינו נכתב ל-Airtable
    if (!structure) {
      setError(t('w_requiredFields'));
      setSaving(false);
      return;
    }
    const workerId = worker?.id || userRecordId();
    try {
      // שדות בלבד הניתנים לכתיבה; Lookup/Formula נכתבים ע"י Airtable מעצמו
      const fields = {
        'תאריך': date,
        'מבנה': [structure],
        'תמחור עבודות': workType ? [workType] : null,
        'כמות': amount ? Number(amount) : null,
        'שעת התחלה': startTime ? `${date}T${startTime}:00.000Z` : null,
        'שעת סיום': endTime ? `${date}T${endTime}:00.000Z` : null,
        'הערות': notes || null,
      };
      if (workerId) fields['עובד'] = [workerId];
      Object.keys(fields).forEach((k) => { if (fields[k] == null) delete fields[k]; });
      const created = await api.create('עבודות עובדים', fields);
      // הפעלת אוטומציית חישוב "סכום לתשלום" ב-Airtable
      if (created?.id) {
        try {
          await api.update('עבודות עובדים', created.id, { 'עדכון מחיר': false });
          await api.update('עבודות עובדים', created.id, { 'עדכון מחיר': true });
        } catch {}
      }
      setSuccess(true);
      setAmount(''); setNotes(''); setStartTime(''); setEndTime(''); setWorkType('');
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.message || 'שגיאה בשמירת העבודה');
    }
    setSaving(false);
  };

  return (
    <div>
      <div className="page-header"><h2>{t('w_report')}</h2></div>

      {success && (
        <div className="badge badge-ok" style={{ width: '100%', marginBottom: 14 }}>✓ {t('w_reportSaved')}</div>
      )}
      {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 14 }}>⚠️ {error}</div>}

      <form className="card" onSubmit={submit}>
        <div className="form-group">
          <label>{t('w_date')}</label>
          <input type="date" className="input" style={{ width: '100%' }} value={date} readOnly disabled />
          <div style={{ fontSize: 12, color: approvedDate ? 'var(--ok)' : 'var(--text-muted)', marginTop: 4 }}>
            {approvedDate ? `✓ ${t('w_dateApproved')}` : t('w_dateLocked')}
          </div>
        </div>

        <div className="form-group">
          <label className="required">{t('w_structure')}</label>
          <select className="select" style={{ width: '100%' }} value={structure} onChange={(e) => setStructure(e.target.value)}>
            <option value="">{t('w_chooseStructure')}</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>{s['מספר מבנה'] || s['סוג מבנה'] || s.id}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{t('w_workType')}</label>
          <select className="select" style={{ width: '100%' }} value={workType} onChange={(e) => setWorkType(e.target.value)}>
            <option value="">{t('w_chooseWorkType')}</option>
            {pricingOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>{amountLabel}</label>
          <input className="input" style={{ width: '100%' }} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" min="0" />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('w_startHour')}</label>
            <input type="time" className="input" style={{ width: '100%' }} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('w_endHour')}</label>
            <input type="time" className="input" style={{ width: '100%' }} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>{t('w_notes')}</label>
          <textarea className="input" style={{ width: '100%', minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <button className="btn btn-primary" style={{ width: '100%', minHeight: 50 }} disabled={saving}>
          {saving ? t('w_saving') : t('w_sendReport')}
        </button>
      </form>
    </div>
  );
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function userRecordId() {
  try { return sessionStorage.getItem('zite_user_recId') || ''; } catch { return ''; }
}

// תווית דינמית של "כמות" לפי יחידת תמחור (סעיף 15 באיפיון)
function dynamicUnitLabel(unit) {
  const u = String(unit || '').trim();
  if (!u) return t('w_amount');
  if (u.includes('דונם')) return t('w_qtyRows');        // דונם → כמות שורות
  if (u.includes('קרטון')) return t('w_qtyCartons');    // קרטון/קרטונים → כמות קרטונים
  if (u.includes('גמלון')) return t('w_qtyGables');     // גמלון/גמלונים → כמות גמלונים
  return t('w_amount');
}
