// ============================================================
// עובדים ועבודות (סעיפים 12 + 15)
// ------------------------------------------------------------
// טאב "עובדים": כרטיסים + כרטיס עובד מלא (KPI, פילטר, 6 גרפים).
// טאב "עבודות": טבלת "עבודות עובדים" עם חיפוש ופילטרים, תווית
// כמות דינמית לפי יחידת התמחור, פעולת "רענן מחיר" (עדכון מחיר
// false → true → המתנה לאוטומציה → קריאה מחדש), יצירה/עריכה/מחיקה.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { t, monthShort } from '../i18n.js';
import { useApp } from '../App.jsx';
import { workHours , workTypeName } from '../utils/field.js';
import { formatMoney, formatNumber, formatDate } from '../utils/format.js';
import { displayName, firstId } from '../utils/resolve.js';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { toast } from '../utils/ui.js';
import { exportCsv, fileStamp, inDateRange } from '../utils/table.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { useAutoRefresh } from '../utils/live.js';
import { activatable } from '../utils/a11y.js';

const SHORT_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const WORKS_TABLE = 'עבודות עובדים';

// dateTime של Airtable (אזור זמן UTC) → "HH:mm" לשדה time בטופס
function timeOf(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// תווית כמות דינמית (סעיף 15): דונם → שורות · קרטון → קרטונים · גמלון → גמלונים
function unitLabel(unit) {
  const u = String(unit || '').trim();
  if (!u) return t('w_amount');
  if (u.includes('דונם')) return t('w_qtyRows');
  if (u.includes('קרטון')) return t('w_qtyCartons');
  if (u.includes('גמלון')) return t('w_qtyGables');
  return t('w_amount');
}

export default function WorkersPage() {
  const app = useApp();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'jobs' ? 'jobs' : 'workers');
  // ניווט עם ?tab= בזמן שהמסך פתוח — הטאב מסתנכרן
  useEffect(() => { setTab(params.get('tab') === 'jobs' ? 'jobs' : 'workers'); }, [params]);
  const [workers, setWorkers] = useState([]);
  const [workRecords, setWorkRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(null); // {} = עובד חדש, רשומה = עריכה
  const [search, setSearch] = useState('');
  const canEdit = (app.user?.role || 'owner') === 'owner'; // עדכונים למנהל הראשי בלבד
  const canEditJobs = canEdit; // מנהל עבודה צופה בלבד

  const load = useCallback(() => Promise.all([
    app.api.get('עובדים', '?maxRecords=200'),
    app.api.get(WORKS_TABLE, '?maxRecords=3000'),
  ])
    .then(([w, wr]) => {
      setWorkers(Array.isArray(w) ? w : []);
      setWorkRecords(Array.isArray(wr) ? wr : []);
      return Array.isArray(w) ? w : [];
    })
    .catch(() => []), [app.api]);

  useAutoRefresh(load); // עדכון ממקום אחר מופיע בלי רענון ידני

  useEffect(() => {
    load().then((arr) => {
      // הגעה מ"צוות עובדים": פתיחת כרטיס העובד שנבחר
      const openId = location.state?.openWorkerId;
      if (openId) {
        const found = arr.find((w) => w.id === openId);
        if (found) { setTab('workers'); setDrawer(found); }
      }
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // סיוע: שעות וסכום
  const hoursOf = (arr) => arr.reduce((s, r) => s + workHours(r), 0);
  const paidOf = (arr) => arr.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);

  // עבודות עובד ספציפי
  const recordsFor = (w) => workRecords.filter((r) => {
    const ref = r['עובד'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === String(w.id));
    return String(r['עובד'] ?? '') === String(w.id);
  });

  const inMonth = (r, monthOffset) => {
    const d = new Date(r['תאריך']);
    if (Number.isNaN(d.getTime())) return false;
    const t = new Date();
    const tgt = new Date(t.getFullYear(), t.getMonth() + monthOffset, 1);
    return d.getFullYear() === tgt.getFullYear() && d.getMonth() === tgt.getMonth();
  };

  const filteredWorkers = workers.filter((w) => {
    if (!search) return true;
    const hay = [w['שם פרטי'], w['שם משפחה'], w['טלפון'], w['סוג עובד']].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  const switchTab = (t) => {
    setTab(t);
    const next = new URLSearchParams(params);
    if (t === 'jobs') next.set('tab', 'jobs'); else next.delete('tab');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader icon="👥" title="עובדים ועבודות">
        {tab === 'workers' && (
          <input className="input no-print" aria-label="חיפוש עובד" placeholder={t('c_search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {tab === 'workers' && canEdit && <button className="btn btn-primary no-print" onClick={() => setForm({})}>{t('m_newWorker')}</button>}
      </PageHeader>

      <div className="tabs no-print" style={{ marginBottom: 18 }}>
        <button className={`tab ${tab === 'workers' ? 'active' : ''}`} onClick={() => switchTab('workers')}>👥 {t('m_tabWorkers')}</button>
        <button className={`tab ${tab === 'jobs' ? 'active' : ''}`} onClick={() => switchTab('jobs')}>📋 {t('m_tabJobs')}</button>
      </div>

      {loading ? (
        <div className="grid">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : tab === 'jobs' ? (
        <JobsTab
          app={app}
          works={workRecords}
          workers={workers}
          canEdit={canEditJobs}
          onChanged={load}
          openNew={params.get('new') === '1'}
          clearNew={() => {
            const next = new URLSearchParams(params);
            next.delete('new');
            setParams(next, { replace: true });
          }}
        />
      ) : (
        <div className="grid">
          {filteredWorkers.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}>{t('c_noData')}</div>}
          {filteredWorkers.map((w) => {
            const name = `${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || 'עובד';
            const recs = recordsFor(w);
            const cur = recs.filter((r) => inMonth(r, 0));
            const prev = recs.filter((r) => inMonth(r, -1));
            return (
              <div key={w.id} className="card clickable" {...activatable(() => setDrawer(w), `פתיחת כרטיס העובד ${name}`)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--workers-soft)', color: 'var(--workers)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
                    {name[0] || '👤'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{w['סוג עובד'] ?? t('c_notAvailable')}</div>
                  </div>
                  <span className={`badge ${w['סטטוס'] === 'פעיל' ? 'badge-ok' : 'badge-warn'}`}>{w['סטטוס'] || t('c_notAvailable')}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('m_hoursMonth')}: </span><b>{formatNumber(hoursOf(cur))}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('m_jobs')}: </span><b>{cur.length}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('m_earnedMonth')}: </span><b style={{ color: 'var(--revenue)' }}>{formatMoney(paidOf(cur))}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('m_prevMonth')}: </span><b style={{ color: 'var(--workers)' }}>{formatMoney(paidOf(prev))}</b></div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <button className="btn btn-sm btn-ghost" aria-label="פתח פרטים" title="פתח פרטים" onClick={(e) => { e.stopPropagation(); setDrawer(w); }}>👁</button>
                    <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); setForm(w); }}>✎</button>
                    <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await removeRecord(app.api, 'עובדים', w.id, name)) await load();
                      }}>🗑</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {drawer && <WorkerDetails worker={drawer} records={recordsFor(drawer)} onClose={() => setDrawer(null)} />}

      {form !== null && (
        <RecordForm
          api={app.api} table="עובדים"
          title={form.id ? `עריכת ${`${form['שם פרטי'] || ''} ${form['שם משפחה'] || ''}`.trim() || 'עובד'}` : 'עובד חדש'}
          record={form.id ? form : null}
          fields={WORKER_FORM_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); }}
        />
      )}
    </div>
  );
}

const WORKER_FORM_FIELDS = [
  { name: 'שם פרטי', label: 'שם פרטי', type: 'text', required: true },
  { name: 'שם משפחה', label: 'שם משפחה', type: 'text' },
  { name: 'טלפון', label: 'טלפון', type: 'text' },
  { name: 'מייל', label: 'מייל', type: 'text' },
  { name: 'כתובת', label: 'כתובת', type: 'text' },
  { name: 'מספר דרכון', label: 'מספר דרכון', type: 'text' },
  { name: 'תאריך תחילת עבודה', label: 'תחילת עבודה', type: 'date' },
  { name: 'סוג עובד', label: 'סוג עובד', type: 'select' },
  { name: 'סטטוס', label: 'סטטוס', type: 'select' },
  { name: 'הערות', label: 'הערות', type: 'textarea' },
];

// ============================================================
// טאב עבודות (סעיף 15) — טבלה + "רענן מחיר" + טופס עבודה
// ============================================================
function JobsTab({ app, works, workers, canEdit, onChanged, openNew, clearNew }) {
  const [search, setSearch] = useState('');
  const [fWorker, setFWorker] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(30);
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (openNew) { setForm({}); clearNew(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew]);

  const workerName = (r) => displayName(r['עובד'], '');
  const structName = (r) => displayName(r['מבנה'], '');
  const workType = (r) => workTypeName(r);
  const unit = (r) => r['יחידת תמחור (from תמחור עבודות)'];

  const filtered = useMemo(() => works.filter((r) => {
    if (fWorker && String(firstId(r['עובד']) || '') !== fWorker) return false;
    if (!inDateRange(r['תאריך'], from, to)) return false;
    if (search) {
      const hay = [workerName(r), structName(r), workType(r), r['זן (from תמחור עבודות)'], r['הערות']]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => String(b['תאריך'] || '').localeCompare(String(a['תאריך'] || ''))), [works, search, fWorker, from, to]);

  const totalPaid = filtered.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);
  const totalHours = filtered.reduce((s, r) => s + workHours(r), 0);
  const hasFilters = search || fWorker || from || to;

  // "רענן מחיר" (סעיף 15): עדכון מחיר=false → true → המתנה לאוטומציה → קריאה מחדש.
  // אין חישוב מחיר ב-Zite — הערך המעודכן נקרא מ-Airtable בלבד.
  const refreshPrice = async (r) => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await app.api.update(WORKS_TABLE, r.id, { 'עדכון מחיר': false });
      await app.api.update(WORKS_TABLE, r.id, { 'עדכון מחיר': true });
      toast('המחיר מחושב מחדש — הסכום יתעדכן בעוד רגע');
      // האוטומציה נמדדה כ~13 שניות; רענון ראשון מהיר ושני אחרי סיום
      setTimeout(() => { onChanged(); }, 5000);
      setTimeout(() => { onChanged(); }, 14000);
    } catch {
      toast('לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו.', 'error');
    }
    setBusyId(null);
  };

  const doExport = () => exportCsv(`עבודות-עובדים-${fileStamp()}`, [
    { label: 'תאריך', get: (r) => formatDate(r['תאריך']) },
    { label: 'עובד', get: workerName },
    { label: 'מבנה', get: structName },
    { label: 'סוג עבודה', get: workType },
    { label: 'זן', get: (r) => r['זן (from תמחור עבודות)'] || '' },
    { label: 'כמות', get: (r) => r['כמות'] ?? '' },
    { label: 'יחידת תמחור', get: (r) => unit(r) || '' },
    { label: 'שעות', get: (r) => r['סכום שעות'] ?? '' },
    { label: 'מחיר', get: (r) => r['מחיר (from תמחור עבודות)'] ?? '' },
    { label: 'סכום לתשלום (₪)', get: (r) => r['סכום לתשלום'] ?? '' },
    { label: 'הערות', get: (r) => r['הערות'] || '' },
  ], filtered);

  return (
    <div>
      {/* KPI קטן על המסונן */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--workers-soft)' }}>📋</div><span className="kpi-label">{t('m_jobs')}</span></div><div className="kpi-value" style={{ color: 'var(--workers)' }}>{formatNumber(filtered.length)}</div><div style={{ height: 12 }} /></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--hours-soft)' }}>⏱️</div><span className="kpi-label">{t('w_hours')}</span></div><div className="kpi-value" style={{ color: 'var(--hours)' }}>{formatNumber(Math.round(totalHours * 10) / 10)}</div><div style={{ height: 12 }} /></div>
        <div className="kpi-card"><div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--revenue-soft)' }}>💰</div><span className="kpi-label">{t('m_pay')}</span></div><div className="kpi-value" style={{ color: 'var(--revenue)' }}>{formatMoney(totalPaid)}</div><div style={{ height: 12 }} /></div>
      </div>

      <div className="filter-bar no-print">
        <input className="input" aria-label="חיפוש עבודה" placeholder={t('c_search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" aria-label="סינון לפי עובד" value={fWorker} onChange={(e) => setFWorker(e.target.value)}>
          <option value="">{t('m_allWorkers')}</option>
          {workers.map((w) => <option key={w.id} value={w.id}>{`${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || w.id}</option>)}
        </select>
        <label className="date-field">{t('c_from')}<input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="date-field">{t('c_to')}<input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {hasFilters && <button className="btn btn-ghost" onClick={() => { setSearch(''); setFWorker(''); setFrom(''); setTo(''); }}>{t('c_clearFilters')}</button>}
        <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨️ {t('c_print')}</button>
          <button type="button" className="btn btn-ghost" onClick={doExport} disabled={!filtered.length}>⬇️ {t('c_export')}</button>
          {canEdit && <button className="btn btn-primary" onClick={() => setForm({})}>{t('m_newJob')}</button>}
        </span>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>{t('m_jobsList')} ({formatNumber(filtered.length)})</div>
        {filtered.length === 0 ? <div className="empty-state"><div className="icon">📋</div>{t('c_noData')}</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('w_date')}</th><th>{t('m_worker')}</th><th>{t('w_structure')}</th><th>{t('m_workType')}</th><th>{t('m_variety')}</th><th>{t('w_amount')}</th><th>{t('w_hours')}</th><th>{t('m_price')}</th><th>{t('m_pay')}</th>
                  {canEdit && <th className="no-print">{t('c_actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r['תאריך'])}</td>
                    <td>{workerName(r) ? <span className="obj-chip static">👤 {workerName(r)}</span> : 'לא זמין'}</td>
                    <td>{structName(r) ? <span className="obj-chip static">🏗️ {structName(r)}</span> : '—'}</td>
                    <td>{workType(r) || '—'}</td>
                    <td>{r['זן (from תמחור עבודות)'] || '—'}</td>
                    <td>
                      {r['כמות'] != null ? formatNumber(r['כמות']) : '—'}
                      {r['כמות'] != null && unit(r) && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>{unitLabel(unit(r))}</span>
                      )}
                    </td>
                    <td>{r['סכום שעות'] != null ? formatNumber(r['סכום שעות']) : '—'}</td>
                    <td>{r['מחיר (from תמחור עבודות)'] != null ? formatMoney(r['מחיר (from תמחור עבודות)']) : '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--revenue)' }}>{r['סכום לתשלום'] != null ? formatMoney(r['סכום לתשלום']) : 'לא זמין'}</td>
                    {canEdit && (
                      <td className="no-print">
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-ghost" disabled={busyId === r.id} aria-label={t('m_refreshPrice')} title={t('m_refreshPrice')}
                            onClick={() => refreshPrice(r)}>{busyId === r.id ? '…' : '🔄'}</button>
                          <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={() => setForm(r)}>✎</button>
                          <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                            onClick={async () => {
                              if (await removeRecord(app.api, WORKS_TABLE, r.id, 'העבודה')) await onChanged();
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
            <button className="btn btn-ghost no-print" onClick={() => setLimit((l) => l + 50)}>{t('c_showMore')} ({formatNumber(filtered.length - limit)})</button>
          </div>
        )}
      </div>

      {form !== null && (
        <WorkForm
          api={app.api}
          workers={workers}
          record={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null); await onChanged();
            toast('העבודה נשמרה — הסכום לתשלום יופיע בעוד רגע');
            setTimeout(() => { onChanged(); }, 13000);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// טופס עבודה — "תמחור עבודות" הוא הקישור שקובע סוג/מחיר/יחידה;
// Airtable מחשב את "סכום לתשלום" (אין חישוב ב-Zite).
// ============================================================
function WorkForm({ api, workers, record, onClose, onSaved }) {
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [structures, setStructures] = useState([]);
  const [pricing, setPricing] = useState([]);
  const [date, setDate] = useState(record?.['תאריך'] ? String(record['תאריך']).slice(0, 10) : todayStr());
  const [worker, setWorker] = useState(firstId(record?.['עובד']) || '');
  const [structure, setStructure] = useState(firstId(record?.['מבנה']) || '');
  const [priceId, setPriceId] = useState(firstId(record?.['תמחור עבודות']) || '');
  const [amount, setAmount] = useState(record?.['כמות'] ?? '');
  const [startTime, setStartTime] = useState(timeOf(record?.['שעת התחלה']));
  const [endTime, setEndTime] = useState(timeOf(record?.['שעת סיום']));
  const [notes, setNotes] = useState(record?.['הערות'] || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  useEffect(() => {
    Promise.all([
      api.get('מבנים', '?maxRecords=200'),
      api.get('תמחור עבודות', '?maxRecords=800&raw=1'),
    ]).then(([s, p]) => {
      setStructures(Array.isArray(s) ? s : []);
      setPricing(Array.isArray(p) ? p : []);
    }).catch(() => {});
  }, [api]);

  const selected = pricing.find((p) => p.id === priceId);
  const amtLabel = unitLabel(selected?.['יחידת תמחור']);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!worker) { setError('חסר שדה חובה: עובד'); return; }
    if (!structure) { setError('חסר שדה חובה: מבנה'); return; }
    setSaving(true); setError('');
    const fields = {
      'תאריך': date,
      'עובד': [worker],
      'מבנה': [structure],
      'תמחור עבודות': priceId ? [priceId] : null,
      'כמות': amount !== '' ? Number(amount) : null,
      // השדות ב-Airtable הם dateTime (UTC) — נשלח תאריך+שעה מלאים
      'שעת התחלה': startTime ? `${date}T${startTime}:00.000Z` : null,
      'שעת סיום': endTime ? `${date}T${endTime}:00.000Z` : null,
      'הערות': notes || null,
    };
    if (!record) Object.keys(fields).forEach((k) => { if (fields[k] == null) delete fields[k]; });
    try {
      let rid = record?.id;
      if (rid) await api.update(WORKS_TABLE, rid, fields);
      else rid = (await api.create(WORKS_TABLE, fields))?.id;
      // "סכום לתשלום" מתמלא רק על ידי אוטומציית "עדכון מחיר" — מפעילים אותה (false → true)
      if (rid) {
        try {
          await api.update(WORKS_TABLE, rid, { 'עדכון מחיר': false });
          await api.update(WORKS_TABLE, rid, { 'עדכון מחיר': true });
        } catch {}
      }
      await onSaved();
    } catch (err) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${err.message || err})`);
      setSaving(false);
    }
  };

  const priceLabel = (p) => [p['סוג עבודה'], p['זן'], p['מחיר'] != null ? `₪${p['מחיר']}` : null, p['יחידת תמחור'] ? `ל${p['יחידת תמחור']}` : null]
    .filter(Boolean).join(' · ');

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>{record ? 'עריכת עבודה' : 'עבודה חדשה'}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div className="form-group"><label className="required">תאריך</label>
              <input type="date" className="input" style={{ width: '100%' }} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="form-group"><label className="required">עובד</label>
              <select className="select" style={{ width: '100%' }} value={worker} onChange={(e) => setWorker(e.target.value)}>
                <option value="">בחר עובד...</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{`${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || w.id}</option>)}
              </select></div>
            <div className="form-group"><label className="required">מבנה</label>
              <select className="select" style={{ width: '100%' }} value={structure} onChange={(e) => setStructure(e.target.value)}>
                <option value="">בחר מבנה...</option>
                {structures.map((s) => <option key={s.id} value={s.id}>{s['מספר מבנה'] || s['סוג מבנה'] || s.id}</option>)}
              </select></div>
            <div className="form-group"><label>סוג עבודה (תמחור)</label>
              <select className="select" style={{ width: '100%' }} value={priceId} onChange={(e) => setPriceId(e.target.value)}>
                <option value="">בחר תמחור...</option>
                {pricing.map((p) => <option key={p.id} value={p.id}>{priceLabel(p)}</option>)}
              </select></div>
            <div className="form-group"><label>{amtLabel}</label>
              <input type="number" step="any" min="0" className="input" style={{ width: '100%' }} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="form-group"><label>שעת התחלה</label>
              <input type="time" className="input" style={{ width: '100%' }} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div className="form-group"><label>שעת סיום</label>
              <input type="time" className="input" style={{ width: '100%' }} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
          </div>
          <div className="form-group"><label>הערות</label>
            <textarea className="input" style={{ width: '100%' }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : record ? 'שמור שינויים' : 'שמור עבודה'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// כרטיס עובד מפורט — KPI + פילטר + 6 גרפים (סעיף 12)
// ============================================================
function WorkerDetails({ worker, records, onClose }) {
  useEscapeClose(onClose); // סגירה במקש Escape
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const name = `${worker['שם פרטי'] || ''} ${worker['שם משפחה'] || ''}`.trim() || 'עובד';

  // פילטרים
  const filtered = useMemo(() => records.filter((r) => {
    const d = new Date(r['תאריך']);
    if (Number.isNaN(d.getTime())) return true;
    if (from && d < new Date(from)) return false;
    if (to) { const end = new Date(to); end.setHours(23, 59, 59); if (d > end) return false; }
    return true;
  }), [records, from, to]);

  const totalHours = filtered.reduce((s, r) => s + workHours(r), 0);
  const totalPaid = filtered.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);
  const workDays = new Set(filtered.map((r) => (r['תאריך'] ? new Date(r['תאריך']).toDateString() : 'x'))).size;
  const avgPerDay = workDays ? totalPaid / workDays : 0;

  // KPI ראשי — יום/שבוע/חודש נוכחי
  const now = new Date();
  const dayRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d.toDateString() === now.toDateString(); });
  const monthRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const weeksStart = new Date(now); weeksStart.setDate(now.getDate() - now.getDay());
  const weekRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d >= weeksStart; });
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthRecs = filtered.filter((r) => { const d = new Date(r['תאריך']); return !Number.isNaN(d.getTime()) && d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth(); });

  const sumField = (arr, f) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);

  const byDays = () => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const k = `${d.getDate()}/${d.getMonth() + 1}`;
      b[k] = (b[k] || 0) + (Number(r['סכום לתשלום']) || 0);
    });
    return Object.entries(b).sort((a, b) => a[0] > b[0] ? 1 : -1).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const hourDays = () => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const k = `${d.getDate()}/${d.getMonth() + 1}`;
      b[k] = (b[k] || 0) + workHours(r);
    });
    return Object.entries(b).sort((a, b) => a[0] > b[0] ? 1 : -1).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const byMonth = (field) => {
    const b = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const label = monthShort(d.getMonth());
      b[label] = (b[label] || 0) + (Number(r[field === 'hours' ? 'סכום שעות' : 'סכום לתשלום']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ label: k, value: Math.round(v) }));
  };
  const byWorkType = (field) => {
    const b = {};
    filtered.forEach((r) => {
      const k = workTypeName(r, 'אחר');
      b[k] = (b[k] || 0) + (Number(r[field === 'hours' ? 'סכום שעות' : 'סכום לתשלום']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: Math.round(v) }));
  };
  const byStructure = () => {
    const b = {};
    filtered.forEach((r) => {
      let nm = r['מבנה'];
      if (Array.isArray(nm)) nm = displayName(nm);
      b[nm || 'אחר'] = (b[nm || 'אחר'] || 0) + 1;
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: v }));
  };

  const incomeChart = byDays();
  const hoursChart = hourDays();
  const monthIncome = byMonth('income');
  const typeIncome = byWorkType('income');
  const typeHours = byWorkType('hours');
  const structChart = byStructure();

  const kpis = [
    { label: t('m_hToday'), value: formatNumber(sumField(dayRecs, 'סכום שעות')), color: 'var(--hours)' },
    { label: t('m_hWeek'), value: formatNumber(sumField(weekRecs, 'סכום שעות')), color: 'var(--weight)' },
    { label: t('m_hoursMonth'), value: formatNumber(sumField(monthRecs, 'סכום שעות')), color: 'var(--cartons)' },
    { label: t('m_incMonth'), value: formatMoney(sumField(monthRecs, 'סכום לתשלום')), color: 'var(--revenue)' },
    { label: t('m_incPrev'), value: formatMoney(sumField(prevMonthRecs, 'סכום לתשלום')), color: 'var(--workers)' },
    { label: t('m_numJobs'), value: formatNumber(filtered.length), color: 'var(--pallets)' },
  ];

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer worker-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>👤 {name}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">

          {/* KPI */}
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {kpis.map((k) => (
              <div key={k.label} className="kpi-card" style={{ padding: '14px 14px 0' }}>
                <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{k.label}</span></div>
                <div className="kpi-value" style={{ fontSize: 18, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* פילטר טווח */}
          <div className="card" style={{ marginTop: 16, background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="form-group"><label>{t('c_from')}</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="form-group"><label>{t('c_to')}</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>
              {t('m_periodTotal')}: {formatNumber(totalHours)} {t('w_hoursUnit')} · {formatMoney(totalPaid)} · {formatNumber(filtered.length)} {t('m_jobs')} · {t('m_avgDay')} {formatMoney(avgPerDay)}
            </div>
          </div>

          {/* גרף 1: שעות לאורך זמן */}
          <Chart title={t('m_cHoursTime')} data={hoursChart} barColor="var(--hours)" />
          {/* גרף 2: הכנסה לאורך זמן */}
          <Chart title={t('m_cIncTime')} data={incomeChart} barColor="var(--revenue)" money />

          {/* גרפים לפי חודש */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('m_cIncMonth')}</div>
            <PieChartWrap data={monthIncome.map((x) => ({ name: x.label, value: x.value }))} money />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('m_cHoursType')}</div>
            <PieChartWrap data={typeHours} />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('m_cIncType')}</div>
            <PieChartWrap data={typeIncome} money />
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{t('m_cJobsStruct')}</div>
            <PieChartWrap data={structChart} />
          </div>

        </div>
      </div>
    </div>
  );
}

function Chart({ title, data, barColor, money }) {
  if (!data || !data.length) return <div className="card" style={{ marginTop: 16 }}><div className="section-title" style={{ marginTop: 0 }}>{title}</div><div className="empty-state">{t('c_noData')}</div></div>;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      <div style={{ direction: 'ltr' }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...xAxisProps(data.length, { rotate: true })} />
            <YAxis {...yAxisProps({ money })} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => money ? formatMoney(v) : formatNumber(v)} />
            <Bar dataKey="value" fill={barColor} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const PIE_COLORS = ['#08A878', '#2878D0', '#8B5CF6', '#F59E0B', '#F04444', '#09A7B2', '#10A66A'];
function PieChartWrap({ data, money }) {
  if (!data || !data.length) return <div className="empty-state">{t('c_noData')}</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        {/* השמות במקרא בלבד — תוויות על הפלחים נדרסו זו על ידי זו */}
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75}>
          {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
        </Pie>
        <Tooltip {...TOOLTIP_STYLE} formatter={(v) => money ? formatMoney(v) : formatNumber(v)} />
        <Legend wrapperStyle={LEGEND_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}
