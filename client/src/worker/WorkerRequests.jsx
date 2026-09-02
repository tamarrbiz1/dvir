// ============================================================
// "הבקשות שלי" — אזור אישי של העובד (עברית / תאילנדית)
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../i18n.js';
import { formatDate } from '../utils/format.js';
import { firstId } from '../utils/resolve.js';
import { REQUEST_TABLE, REQUEST_FIELDS, REQUEST_STATUS, REQUEST_TYPES, DATE_CHANGE_MARK, isDateChangeReq, workerNotesOf, approvalExpiry, approvalValid, statusStyle, requestTimeLabel } from '../utils/requests.jsx';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function WorkerRequests({ api, worker, onEnterWork, initialOpen = false, initialType = '' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(initialOpen || !!initialType);
  const [busy, setBusy] = useState(false);

  const workerId = worker?.id;

  const load = useCallback(async () => {
    try {
      const d = await api.get(REQUEST_TABLE, '?maxRecords=1000');
      setItems(Array.isArray(d) ? d : []);
      setMissing(false);
      setError('');
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('אינה קיימת')) setMissing(true); else setError(msg);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);
  // תשובת המנהל מגיעה בזמן אמת: רענון כל 15 שניות + בכל חזרה לאפליקציה
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(); }, 15 * 1000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const mine = useMemo(() => items
    .filter((r) => firstId(r[REQUEST_FIELDS.worker]) === workerId && !r[REQUEST_FIELDS.hidden])
    .sort((a, b) => String(b[REQUEST_FIELDS.created] || '').localeCompare(String(a[REQUEST_FIELDS.created] || ''))),
  [items, workerId]);

  const hide = async (r) => {
    if (busy) return;
    setBusy(true);
    try { await api.update(REQUEST_TABLE, r.id, { [REQUEST_FIELDS.hidden]: true }); await load(); }
    catch (e) { setError(e.message || 'שגיאה'); }
    setBusy(false);
  };

  return (
    <div>
      <div className="page-header">
        <h2>{t('w_myRequests')}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={missing}>+ {t('w_request')}</button>
      </div>
      {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
      {missing && <div className="badge badge-warn" style={{ width: '100%', marginBottom: 12 }}>{t('w_requestsUnavailable')}</div>}

      {loading ? <div className="skeleton skeleton-card" /> : mine.length === 0 ? (
        <div className="card empty-state">{t('w_noRequests')}</div>
      ) : mine.map((r) => {
        const status = r[REQUEST_FIELDS.status] || REQUEST_STATUS.pending;
        const st = statusStyle(status);
        const note = r[REQUEST_FIELDS.managerNote];
        const dateChange = isDateChangeReq(r);
        const expiry = approvalExpiry(r);
        const canEnterWork = status === REQUEST_STATUS.approved && approvalValid(r);
        return (
          <div key={r.id} className="card" style={{ marginBottom: 12, borderRight: `5px solid ${st.color}` }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{dateChange ? `🔓 ${t('w_reqDateChange')}` : typeLabel(r[REQUEST_FIELDS.type])}</div>
            <div style={{ fontSize: 14 }}>📅 {formatDate(r[REQUEST_FIELDS.date])}</div>
            {!dateChange && requestTimeLabel(r, t('w_untilEndOfDay')) && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>🕒 {requestTimeLabel(r, t('w_untilEndOfDay'))}</div>}
            {dateChange && status === REQUEST_STATUS.approved && (
              <div style={{ fontSize: 13, color: expiry && expiry.getTime() < Date.now() ? 'var(--error)' : 'var(--text-secondary)' }}>
                ⏳ {expiry
                  ? `${t('w_validUntil')}: ${formatDate(expiry)} ${String(expiry.getHours()).padStart(2, '0')}:${String(expiry.getMinutes()).padStart(2, '0')}`
                  : t('w_noExpiry')}
                {expiry && expiry.getTime() < Date.now() && ` — ${t('w_expired')}`}
              </div>
            )}
            {workerNotesOf(r) && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>📝 {workerNotesOf(r)}</div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('w_sentAt')}: {formatDate(r[REQUEST_FIELDS.created])}</div>
            <div style={{ marginTop: 8 }}>
              <span className="badge" style={{ background: st.soft, color: st.color }}>{st.icon} {statusLabel(status)}</span>
            </div>
            {note && (
              <div style={{ marginTop: 10, background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 8, fontSize: 13 }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{t('w_managerNote')} ({t('w_originalText')}):</div>
                <div>{note}</div>
                {r[REQUEST_FIELDS.answeredAt] && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('w_answeredAt')}: {formatDate(r[REQUEST_FIELDS.answeredAt])}</div>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {canEnterWork && <button className="btn btn-success btn-sm" onClick={() => onEnterWork?.(String(r[REQUEST_FIELDS.date]).slice(0, 10))}>📋 {t('w_enterWork')}</button>}
              {status !== REQUEST_STATUS.pending && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => hide(r)}>{t('w_hideRequest')}</button>}
            </div>
          </div>
        );
      })}

      {showForm && <RequestForm api={api} workerId={workerId} initialType={initialType && showForm ? initialType : ''} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />}
    </div>
  );
}

function RequestForm({ api, workerId, onClose, onSaved, initialType = '' }) {
  const [type, setType] = useState(initialType);
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [endOfDay, setEndOfDay] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if ((!type && type !== 'dateChange') || !date) { setError(t('w_requiredFields')); return; }
    if (type === REQUEST_TYPES.partial && (!from || (!to && !endOfDay))) { setError(t('w_requiredHours')); return; }
    if (!workerId) { setError(t('w_requiredFields')); return; }
    setSaving(true); setError('');
    const isDateChange = type === 'dateChange';
    const fields = {
      [REQUEST_FIELDS.worker]: [workerId],
      [REQUEST_FIELDS.date]: date,
      [REQUEST_FIELDS.status]: REQUEST_STATUS.pending,
    };
    // סוג "עדכון תאריך" אינו קיים ברשימת הסוגים — מסומן בהערות העובד
    if (!isDateChange) fields[REQUEST_FIELDS.type] = type;
    if (type === REQUEST_TYPES.partial) {
      fields[REQUEST_FIELDS.from] = from;
      fields[REQUEST_FIELDS.endOfDay] = endOfDay;
      if (!endOfDay) fields[REQUEST_FIELDS.to] = to;
    }
    if (isDateChange) fields[REQUEST_FIELDS.workerNotes] = `${DATE_CHANGE_MARK}${notes ? ` ${notes}` : ''}`;
    else if (notes) fields[REQUEST_FIELDS.workerNotes] = notes;
    try { await api.create(REQUEST_TABLE, fields); await onSaved(); }
    catch (err) { setError(err.message || 'שגיאה'); }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('w_request')}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        {!type ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="btn btn-ghost" style={{ minHeight: 56, fontSize: 16 }} onClick={() => setType(REQUEST_TYPES.vacation)}>🏖️ {t('w_reqVacation')}</button>
            <button className="btn btn-ghost" style={{ minHeight: 56, fontSize: 16 }} onClick={() => setType(REQUEST_TYPES.sick)}>🤒 {t('w_reqSick')}</button>
            <button className="btn btn-ghost" style={{ minHeight: 56, fontSize: 16 }} onClick={() => setType(REQUEST_TYPES.partial)}>⏰ {t('w_reqPartial')}</button>
            <button className="btn btn-ghost" style={{ minHeight: 56, fontSize: 16 }} onClick={() => setType('dateChange')}>🔓 {t('w_reqDateChange')}</button>
            <button className="btn btn-ghost" onClick={onClose}>{t('w_cancel')}</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ marginBottom: 12 }}><span className="badge badge-workers">{type === 'dateChange' ? `🔓 ${t('w_reqDateChange')}` : typeLabel(type)}</span> <button type="button" className="btn btn-sm btn-ghost" onClick={() => setType('')}>{t('w_change')}</button></div>
            {type === 'dateChange' && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>{t('w_dateChangeExplain')}</div>
            )}
            <div className="form-group"><label className="required">{type === 'dateChange' ? t('w_requestedDate') : t('w_date')}</label><input type="date" className="input" style={{ width: '100%' }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            {type === REQUEST_TYPES.partial && (
              <>
                <div className="form-group"><label className="required">{t('w_fromHour')}</label><input type="time" className="input" style={{ width: '100%' }} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div className="form-group"><label>{t('w_toHour')}</label><input type="time" className="input" style={{ width: '100%' }} value={to} disabled={endOfDay} onChange={(e) => setTo(e.target.value)} /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 14 }}>
                  <input type="checkbox" checked={endOfDay} onChange={(e) => { setEndOfDay(e.target.checked); if (e.target.checked) setTo(''); }} /> {t('w_untilEndOfDay')}
                </label>
              </>
            )}
            <div className="form-group"><label>{t('w_notes')}</label><textarea className="input" style={{ width: '100%' }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>{t('w_cancel')}</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t('w_saving') : t('w_sendRequest')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function typeLabel(v) {
  if (v === REQUEST_TYPES.vacation) return t('w_reqVacation');
  if (v === REQUEST_TYPES.sick) return t('w_reqSick');
  if (v === REQUEST_TYPES.partial) return t('w_reqPartial');
  return v || t('w_na_value');
}
function statusLabel(s) {
  if (s === REQUEST_STATUS.approved) return t('w_stApproved');
  if (s === REQUEST_STATUS.rejected) return t('w_stRejected');
  return t('w_stPending');
}
