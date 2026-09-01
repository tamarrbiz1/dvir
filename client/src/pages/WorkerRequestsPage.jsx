import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { t } from '../i18n.js';
import { formatDate } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';
import { REQUEST_TABLE, REQUEST_FIELDS, REQUEST_STATUS, isDateChangeReq, workerNotesOf, approvalExpiry, statusStyle, requestTimeLabel, MissingRequestsTable } from '../utils/requests.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';

// ============================================================
// בקשות עובדים — מסך המנהל (איפיון: "מסך מנהל — בקשות עובדים")
// טבלה: "בקשות עובדים". Airtable הוא מקור האמת: אישור/דחייה נכתבים
// ורק אחרי תשובת Airtable המסך נקרא מחדש.
// ============================================================

const TYPE_OPTIONS = ['חופש', 'מחלה', 'חופש לחלק מהיום', 'עדכון תאריך עבודה'];

// תרגום ערכי Airtable לתצוגה (הנתונים עצמם נשארים בעברית)
const typeDisplay = (type) => ({
  'חופש': t('w_reqVacation'),
  'מחלה': t('w_reqSick'),
  'חופש לחלק מהיום': t('w_reqPartial'),
  'עדכון תאריך עבודה': t('w_reqDateChange'),
}[type] || type);
const statusDisplay = (s) => ({
  [REQUEST_STATUS.pending]: t('w_stPending'),
  [REQUEST_STATUS.approved]: t('w_stApproved'),
  [REQUEST_STATUS.rejected]: t('w_stRejected'),
}[s] || s);

export default function WorkerRequestsPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState(REQUEST_STATUS.pending);
  const [drawer, setDrawer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // פילטרים (היסטוריית בקשות למנהל)
  const [fWorker, setFWorker] = useState('');
  const [fType, setFType] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [r, w] = await Promise.all([
        app.api.get(REQUEST_TABLE, '?maxRecords=1000'),
        app.api.get('עובדים', '?maxRecords=300'),
      ]);
      setItems(Array.isArray(r) ? r : []);
      setWorkers(Array.isArray(w) ? w : []);
      setMissing(false);
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('אינה קיימת')) setMissing(true);
      else setLoadError(msg);
    }
    setLoading(false);
  }, [app.api]);

  useEffect(() => { load(); }, [load]);

  // רענון אוטומטי — מחזורי + בכל חזרה לחלון (בלי כפתור ידני)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(); }, 60 * 1000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const enriched = useMemo(() => items.map((r) => ({
    id: r.id,
    raw: r,
    workerId: firstId(r[REQUEST_FIELDS.worker]),
    worker: displayName(r[REQUEST_FIELDS.worker], 'לא זמין'),
    type: isDateChangeReq(r) ? 'עדכון תאריך עבודה' : (r[REQUEST_FIELDS.type] || 'לא זמין'),
    isDateChange: isDateChangeReq(r),
    date: r[REQUEST_FIELDS.date] || '',
    time: requestTimeLabel(r),
    created: r[REQUEST_FIELDS.created] || '',
    status: r[REQUEST_FIELDS.status] || REQUEST_STATUS.pending,
    note: r[REQUEST_FIELDS.managerNote] || '',
    answeredAt: r[REQUEST_FIELDS.answeredAt] || '',
    allowsWork: !!r[REQUEST_FIELDS.allowsWork],
    workerNotes: workerNotesOf(r),
    expiry: approvalExpiry(r),
  })).sort((a, b) => String(b.created).localeCompare(String(a.created))), [items]);

  const counts = useMemo(() => ({
    [REQUEST_STATUS.pending]: enriched.filter((r) => r.status === REQUEST_STATUS.pending).length,
    [REQUEST_STATUS.approved]: enriched.filter((r) => r.status === REQUEST_STATUS.approved).length,
    [REQUEST_STATUS.rejected]: enriched.filter((r) => r.status === REQUEST_STATUS.rejected).length,
  }), [enriched]);

  const visible = useMemo(() => enriched.filter((r) => {
    if (tab !== 'all' && r.status !== tab) return false;
    if (fWorker && r.workerId !== fWorker) return false;
    if (fType && r.type !== fType) return false;
    if (fFrom && String(r.date).slice(0, 10) < fFrom) return false;
    if (fTo && String(r.date).slice(0, 10) > fTo) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [r.worker, r.type, r.note, r.workerNotes, r.time].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [enriched, tab, fWorker, fType, fFrom, fTo, search]);

  const answer = async (req, status, note, allowsWork, validityHours) => {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const fields = {
        [REQUEST_FIELDS.status]: status,
        [REQUEST_FIELDS.managerNote]: note || null,
        [REQUEST_FIELDS.answeredAt]: new Date().toISOString(),
        [REQUEST_FIELDS.allowsWork]: !!allowsWork,
      };
      // בקשת עדכון תאריך: זמן שהוקצב מראש לאישור (נשמר כתוקף)
      if (req.isDateChange) {
        fields[REQUEST_FIELDS.to] = (status === REQUEST_STATUS.approved && validityHours)
          ? new Date(Date.now() + validityHours * 3600 * 1000).toISOString()
          : null;
      }
      await app.api.update(REQUEST_TABLE, req.id, fields);
      await load();
      setDrawer(null);
    } catch (e) {
      setActionError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
    }
    setBusy(false);
  };

  if (loading) return <div><PageHeader icon="🗣️" title="בקשות עובדים" /><div className="skeleton skeleton-card" /></div>;
  if (missing) return <div><PageHeader icon="🗣️" title="בקשות עובדים" /><MissingRequestsTable /></div>;

  const tabs = [
    [REQUEST_STATUS.pending, `${t('m_tPending')} (${counts[REQUEST_STATUS.pending]})`],
    [REQUEST_STATUS.approved, `${t('m_tApproved')} (${counts[REQUEST_STATUS.approved]})`],
    [REQUEST_STATUS.rejected, `${t('m_tRejected')} (${counts[REQUEST_STATUS.rejected]})`],
    ['all', t('c_all')],
  ];

  return (
    <div>
      <PageHeader icon="🗣️" title="בקשות עובדים" />
      {loadError && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {loadError}</div>}

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {[REQUEST_STATUS.pending, REQUEST_STATUS.approved, REQUEST_STATUS.rejected].map((s) => {
          const st = statusStyle(s);
          return (
            <div key={s} className="kpi-card clickable" {...activatable(() => setTab(s), `סינון לפי בקשות בסטטוס ${s}`)} style={{ cursor: 'pointer' }}>
              <div className="kpi-top"><div className="kpi-icon" style={{ background: st.soft }}>{st.icon}</div><span className="kpi-label">{s === REQUEST_STATUS.pending ? t('m_reqPending') : s === REQUEST_STATUS.approved ? t('m_reqApproved') : t('m_reqRejected')}</span></div>
              <div className="kpi-value" style={{ color: st.color }}>{counts[s]}</div>
            </div>
          );
        })}
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        {tabs.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      <div className="filter-bar" style={{ alignItems: 'flex-end' }}>
        <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{t('m_worker')}</label>
          <select className="select" value={fWorker} onChange={(e) => setFWorker(e.target.value)}>
            <option value="">{t('c_all')}</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{`${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || 'עובד'}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{t('m_reqType')}</label>
          <select className="select" value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">{t('c_all')}</option>{TYPE_OPTIONS.map((o) => <option key={o} value={o}>{typeDisplay(o)}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{t('c_from')}</label><input type="date" className="input" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></div>
        <div><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{t('c_to')}</label><input type="date" className="input" value={fTo} onChange={(e) => setFTo(e.target.value)} /></div>
        <div style={{ flex: 1, minWidth: 160 }}><label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block' }}>{t('c_search').replace('...', '')}</label><input className="input" style={{ width: '100%' }} placeholder={t('c_search')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {(fWorker || fType || fFrom || fTo || search) && <button className="btn btn-sm btn-ghost" onClick={() => { setFWorker(''); setFType(''); setFFrom(''); setFTo(''); setSearch(''); }}>✕ נקה</button>}
      </div>

      {visible.length === 0 ? (
        <div className="card empty-state">{t('m_noRequests')}</div>
      ) : (
        <div className="grid">
          {visible.map((r) => {
            const st = statusStyle(r.status);
            return (
              <div key={r.id} className="card clickable"
                {...activatable(() => { setActionError(''); setDrawer(r); }, `פתיחת בקשת ${r.worker}`)}
                style={{ borderRight: `5px solid ${st.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <b style={{ fontSize: 16 }}>👤 {r.worker}</b>
                  <span className="badge" style={{ background: st.soft, color: st.color }}>{st.icon} {statusDisplay(r.status)}</span>
                </div>
                <div style={{ fontWeight: 600 }}>{typeDisplay(r.type)}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>📅 {formatDate(r.date)}{r.time ? ` · ${r.time}` : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>נשלח: {fmtDateTime(r.created)}</div>
                {r.note && <div style={{ fontSize: 13, marginTop: 8, background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: 8 }}>הערת מנהל: {r.note}</div>}
              </div>
            );
          })}
        </div>
      )}

      {drawer && <RequestDrawer canAct={(app.user?.role || 'owner') === 'owner'} req={drawer} busy={busy} error={actionError} onClose={() => setDrawer(null)} onAnswer={answer} />}
    </div>
  );
}

function RequestDrawer({ req, busy, error, onClose, onAnswer, canAct = true }) {
  useEscapeClose(onClose, !busy); // סגירה במקש Escape
  const [note, setNote] = useState(req.note || '');
  const [allowsWork, setAllowsWork] = useState(req.isDateChange ? true : req.allowsWork);
  const [validity, setValidity] = useState(48); // שעות תוקף לאישור עדכון-תאריך
  const st = statusStyle(req.status);
  const row = (l, v) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)' }}>{l}</span><b>{v}</b></div>;
  return (
    <div className="drawer-overlay" onClick={() => !busy && onClose()}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header"><span>🗣️ בקשה — {req.worker}</span><button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button></div>
        <div className="drawer-body">
          {error && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
          <div className="card">
            {row(t('m_theWorker'), req.worker)}
            {row(t('m_reqType'), typeDisplay(req.type))}
            {row(t('w_date'), formatDate(req.date))}
            {req.time && row(t('w_hours'), req.time)}
            {row(t('m_sent'), fmtDateTime(req.created))}
            {row(t('c_status'), <span className="badge" style={{ background: st.soft, color: st.color }}>{st.icon} {statusDisplay(req.status)}</span>)}
            {req.answeredAt && row(t('m_answerDate'), fmtDateTime(req.answeredAt))}
            {req.workerNotes && <div style={{ marginTop: 10, fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>{t('m_workerNote')}: </span>{req.workerNotes}</div>}
            {req.isDateChange && req.expiry && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('m_validUntil')}: </span>
                <b style={{ color: req.expiry.getTime() < Date.now() ? 'var(--error)' : 'var(--ok)' }}>{formatDate(req.expiry)} {String(req.expiry.getHours()).padStart(2, '0')}:{String(req.expiry.getMinutes()).padStart(2, '0')}</b>
              </div>
            )}
          </div>

          {!canAct && req.note && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="section-title" style={{ marginTop: 0 }}>{t('m_managerAnswer')}</div>
              <div style={{ fontSize: 14 }}>{req.note}</div>
            </div>
          )}
          {canAct && <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('m_managerAnswer')}</div>
            <div className="form-group">
              <label>{t('m_noteToWorker')}</label>
              <textarea className="input" style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('m_notePlaceholder')} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 14 }}>
              <input type="checkbox" checked={allowsWork} onChange={(e) => setAllowsWork(e.target.checked)} />
              {t('m_allowWork')}
            </label>
            {req.isDateChange && (
              <div className="form-group">
                <label>{t('m_validity')}</label>
                <select className="select" style={{ width: '100%' }} value={validity} onChange={(e) => setValidity(Number(e.target.value))}>
                  <option value={24}>24 {t('w_hoursUnit')}</option>
                  <option value={48}>48 {t('w_hoursUnit')}</option>
                  <option value={72}>72 {t('w_hoursUnit')}</option>
                  <option value={168}>{t('m_week1')}</option>
                  <option value={0}>{t('m_noLimit')}</option>
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-success" disabled={busy} onClick={() => onAnswer(req, REQUEST_STATUS.approved, note, allowsWork, validity)}>{t('m_approveSend')}</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => onAnswer(req, REQUEST_STATUS.rejected, note, false, 0)}>{t('m_rejectSend')}</button>
              {req.status !== REQUEST_STATUS.pending && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => onAnswer(req, REQUEST_STATUS.pending, note, false)}>{t('m_backToPending')}</button>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>{t('m_decisionSaved')}</div>
          </div>}
        </div>
      </div>
    </div>
  );
}

function fmtDateTime(v) {
  if (!v) return 'לא זמין';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
