// ============================================================
// דיווח עבודה — יצירת רשומת "עבודות עובדים" ב-Airtable
// ============================================================
import { useEffect, useState } from 'react';
import { t, translateStructureName, translateVariety } from '../i18n.js';
import { workTypeName, pricingForStructureOnDate } from '../utils/field.js';
import { formatMoney, localDateTimeToISO } from '../utils/format.js';

export default function WorkerReport({ api, worker, approvedDate = null, onDone, onAskDateChange }) {
  const [structures, setStructures] = useState([]);
  const [pricing, setPricing] = useState([]);
  const [plans, setPlans] = useState([]);
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
  // הסכום שחושב ב-Airtable לדיווח האחרון: null = עדיין מחשב, number = הגיע, 'pending' = לא הגיע בזמן
  const [computedSum, setComputedSum] = useState(null);
  // תקציר "הדיווח האחרון שלך" — נלכד לפני איפוס הטופס, מוצג אחרי שמירה מוצלחת
  const [lastReport, setLastReport] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('מבנים', '?maxRecords=200'),
      api.get('תמחור עבודות', '?maxRecords=800&raw=1'),
      api.get('תוכניות שתילה', '?maxRecords=500&raw=1').catch(() => []), // כשל כאן לא מפיל את הטופס — רק מבטל את הסינון
    ])
      .then(([s, p, pl]) => {
        setStructures(Array.isArray(s) ? s : []);
        setPricing(Array.isArray(p) ? p : []);
        setPlans(Array.isArray(pl) ? pl : []);
      })
      .catch(() => {});
  }, []);

  // סוג העבודה נבחר מרשומות "תמחור עבודות" — הקישור נכתב ל-Airtable
  // כדי ש"סכום לתשלום" יחושב לפי המחיר (בלי להציג את המחיר לעובד).
  // מסוננות לפי הגידול של תוכנית השתילה הפעילה במבנה בתאריך הדיווח
  // (סעיף 2026-10-05.1, תיקון מתמר) — אין תוכנית פעילה → כל האפשרויות
  // עם רמז למשתמש.
  const { options: relevantPricing, noActivePlan } = pricingForStructureOnDate(pricing, plans, structure, date);
  const pricingOptions = relevantPricing.map((p) => ({
    id: p.id,
    label: [workTypeName(p) || p['סוג עבודה'], translateVariety(p['זן'])].filter(Boolean).join(' · ') || p.id,
    unit: p['יחידת תמחור'],
  })).filter((p) => p.label !== p.id);

  // איפוס סוג העבודה כשהוא כבר לא ברשימה המסוננת (למשל אחרי החלפת מבנה/תאריך)
  useEffect(() => {
    if (workType && !pricingOptions.some((p) => p.id === workType)) setWorkType('');
  }, [structure, date, pricing, plans]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPricing = pricingOptions.find((p) => p.id === workType);
  const amountLabel = dynamicUnitLabel(selectedPricing?.unit);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(''); setSuccess(false); setComputedSum(null);
    // המבנה וסוג העבודה הם שדות חובה (סוג העבודה קובע את התמחור בפועל)
    if (!structure || !workType) {
      setError(t('w_requiredFields'));
      setSaving(false);
      return;
    }
    const workerId = worker?.id || userRecordId();
    try {
      // שדות בלבד הניתנים לכתיבה; Lookup/Formula נכתבים ע"י Airtable מעצמו
      // שעת התחלה/סיום: בונים Date מקומי ושולחים .toISOString() (UTC נכון) —
      // לא הדבקת מחרוזת עם "Z" (שהייתה מסמנת שעה מקומית כ-UTC בטעות).
      const fields = {
        'תאריך': date,
        'מבנה': [structure],
        'תמחור עבודות': workType ? [workType] : null,
        'כמות': amount ? Number(amount) : null,
        'שעת התחלה': localDateTimeToISO(date, startTime),
        'שעת סיום': localDateTimeToISO(date, endTime),
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
      // תקציר "הדיווח האחרון שלך" — נלכד כאן, לפני איפוס השדות למטה
      setLastReport({
        date,
        structureLabel: translateStructureName(structures.find((s) => s.id === structure)?.['מספר מבנה'] || structures.find((s) => s.id === structure)?.['סוג מבנה'] || structure),
        workTypeLabel: selectedPricing?.label || '',
        amount,
        amountLabel,
      });
      setAmount(''); setNotes(''); setStartTime(''); setEndTime(''); setWorkType('');
      // האוטומציה ב-Airtable כותבת את "סכום לתשלום" כמה שניות אחרי השמירה —
      // ממתינים לה (קריאת רשומה בודדת, לא מהמטמון) ומציגים לעובד את הסכום.
      if (created?.id) waitForComputedSum(created.id);
      else setComputedSum('pending');
    } catch (err) {
      setError(err.message || t('w_saveError'));
    }
    setSaving(false);
  };

  // עד ~20 שניות של ניסיונות (כל 2 שניות) — האוטומציה בדרך כלל מסיימת תוך 2-5 שניות
  const waitForComputedSum = async (id) => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const rec = await api.get('עבודות עובדים', '/' + id);
        const sum = Number(rec?.['סכום לתשלום']);
        if (rec && rec['סכום לתשלום'] != null && !Number.isNaN(sum)) { setComputedSum(sum); return; }
      } catch { /* ננסה שוב */ }
    }
    setComputedSum('pending');
  };

  return (
    <div>
      <div className="page-header"><h2>{t('w_report')}</h2></div>

      {success && lastReport && (
        <div className="badge badge-ok" style={{ width: '100%', marginBottom: 14, display: 'block' }}>
          <div>✓ {t('w_reportSaved')}</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{t('w_lastReport')}</div>
            <div>{t('w_date')}: {lastReport.date}</div>
            <div>{t('w_structure')}: {lastReport.structureLabel}</div>
            {lastReport.workTypeLabel && <div>{t('w_workType')}: {lastReport.workTypeLabel}</div>}
            {lastReport.amount && <div>{lastReport.amountLabel}: {lastReport.amount}</div>}
          </div>
          <div style={{ marginTop: 6, fontSize: 15 }}>
            {computedSum === null && <span><span className="spinner" /> {t('w_computingSum')}</span>}
            {computedSum === 'pending' && <span>{t('w_sumPending')}</span>}
            {typeof computedSum === 'number' && <span>💰 {t('w_computedSum')}: <b>{formatMoney(computedSum)}</b></span>}
          </div>
        </div>
      )}
      {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 14 }}>⚠️ {error}</div>}

      <form className="card" onSubmit={submit}>
        <div className="form-group">
          <label>{t('w_date')}</label>
          <input type="date" className="input" style={{ width: '100%' }} value={date} readOnly disabled />
          <div style={{ fontSize: 12, color: approvedDate ? 'var(--ok)' : 'var(--text-muted)', marginTop: 4 }}>
            {approvedDate ? `✓ ${t('w_dateApproved')}` : t('w_dateLocked')}
          </div>
          {!approvedDate && onAskDateChange && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onAskDateChange}>
              🔓 {t('w_askDateChange')}
            </button>
          )}
        </div>

        <div className="form-group">
          <label className="required">{t('w_structure')}</label>
          <select className="select" style={{ width: '100%' }} value={structure} onChange={(e) => setStructure(e.target.value)}>
            <option value="">{t('w_chooseStructure')}</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>{translateStructureName(s['מספר מבנה'] || s['סוג מבנה'] || s.id)}</option>
            ))}
          </select>
          {structure && noActivePlan && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>ℹ️ {t('w_noCropHint')}</div>
          )}
        </div>

        <div className="form-group">
          <label className="required">{t('w_workType')}</label>
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
