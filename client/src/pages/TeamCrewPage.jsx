import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, monthShort, translateStructureName } from '../i18n.js';
import { useApp } from '../App.jsx';
import { workHours , workTypeName } from '../utils/field.js';
import { activatable } from '../utils/a11y.js';
import { useAutoRefresh } from '../utils/live.js';
import { formatMoney, formatNumber } from '../utils/format.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps, yCategoryProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';

const MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

export default function TeamCrewPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [workers, setWorkers] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 0 = הכל
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => Promise.all([
    app.api.get('עובדים', '?maxRecords=300'),
    app.api.get('עבודות עובדים', '?maxRecords=3000'),
  ])
    .then(([w, r]) => {
      setWorkers(Array.isArray(w) ? w : []);
      setRecords(Array.isArray(r) ? r : []);
    })
    .catch(() => {}), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load); // עדכון ממקום אחר מופיע בלי רענון ידני

  // סינון לפי שנה/חודש/טווח
  const filtered = useMemo(() => records.filter((r) => {
    const d = new Date(r['תאריך']);
    if (Number.isNaN(d.getTime())) return false;
    if (month !== 0 && (d.getFullYear() !== year || d.getMonth() !== month - 1)) return false;
    if (month === 0 && d.getFullYear() !== year) return false;
    if (from && d < new Date(from)) return false;
    if (to) { const e = new Date(to); e.setHours(23, 59, 59); if (d > e) return false; }
    return true;
  }), [records, year, month, from, to]);

  const sumHours = filtered.reduce((s, r) => s + workHours(r), 0);
  const sumPaid = filtered.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0);

  const workerRecs = (w) => filtered.filter((r) => {
    const ref = r['עובד'];
    if (Array.isArray(ref)) return ref.some((x) => String(x?.id ?? x) === String(w.id));
    return String(r['עובד'] ?? '') === String(w.id);
  });
  const activeWorkers = workers.filter((w) => w['סטטוס'] === 'פעיל' || w['סטטוס'] === undefined);
  const avgPerWorker = activeWorkers.length ? sumPaid / activeWorkers.length : 0;

  // פרטים תוך שורת עובד
  const perWorker = workers
    .map((w) => {
      const recs = workerRecs(w);
      return {
        id: w.id,
        name: `${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim() || t('m_workerFallback'),
        hours: recs.reduce((s, r) => s + workHours(r), 0),
        paid: recs.reduce((s, r) => s + (Number(r['סכום לתשלום']) || 0), 0),
        jobs: recs.length,
      };
    })
    .filter((w) => w.jobs > 0)
    .sort((a, b) => b.paid - a.paid);

  // גרף 1: משכורת לפי עובד (Horizontal) — מיין מהגבוה
  const salaryByWorker = perWorker.map((w) => ({ name: w.name, value: Math.round(w.paid) }));

  // גרף 2: משכורות לאורך זמן (סדרה לפי עובד, X חודש)
  const salaryOverTime = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      const d = new Date(r['תאריך']);
      if (Number.isNaN(d.getTime())) return;
      const label = `${monthShort(d.getMonth())} ${String(d.getFullYear()).slice(2)}`;
      const ref = r['עובד'];
      let wId = Array.isArray(ref) ? (ref[0]?.id ?? ref[0]) : ref;
      const w = workers.find((x) => String(x.id) === String(wId));
      const wname = w ? (`${w['שם פרטי'] || ''} ${w['שם משפחה'] || ''}`.trim()) : t('c_other');
      if (!map[label]) map[label] = {};
      map[label][wname] = (map[label][wname] || 0) + (Number(r['סכום לתשלום']) || 0);
    });
    const allNames = [...new Set(Object.values(map).flatMap((m) => Object.keys(m)))];
    return Object.entries(map).sort((a, b) => a[0] > b[0] ? 1 : -1).map(([label, m]) => {
      const row = { label };
      allNames.forEach((n) => { row[n] = Math.round(m[n] || 0); });
      return row;
    });
  }, [filtered, workers]);

  // גרף 3: שעות לפי עובד
  const hoursByWorker = perWorker.map((w) => ({ name: w.name, value: Math.round(w.hours) }));

  // גרף 4: עלות לפי סוג עבודה
  const costByType = useMemo(() => {
    const b = {};
    filtered.forEach((r) => {
      const k = workTypeName(r, t('c_other'));
      b[k] = (b[k] || 0) + (Number(r['סכום לתשלום']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: Math.round(v) }));
  }, [filtered]);

  // גרף 5: עלות עובדים לפי מבנה
  const costByStructure = useMemo(() => {
    const b = {};
    filtered.forEach((r) => {
      let nm = r['מבנה'];
      if (Array.isArray(nm)) nm = nm.map((x) => (x?.name ?? x)).join(', ');
      nm = translateStructureName(nm) || t('c_other');
      b[nm] = (b[nm] || 0) + (Number(r['סכום לתשלום']) || 0);
    });
    return Object.entries(b).map(([k, v]) => ({ name: k, value: Math.round(v) }));
  }, [filtered]);

  const kpis = [
    { icon: '👷', label: t('m_activeWorkers'), value: formatNumber(activeWorkers.filter((w) => workerRecs(w).length > 0 || w['סטטוס'] === 'פעיל').length), color: 'var(--workers)' },
    { icon: '⏱️', label: t('m_totalHours'), value: formatNumber(sumHours), color: 'var(--hours)' },
    { icon: '💰', label: t('m_totalPay'), value: formatMoney(sumPaid), color: 'var(--revenue)' },
    { icon: '📈', label: t('m_avgPay'), value: formatMoney(avgPerWorker), color: 'var(--profit)' },
  ];

  return (
    <div>
      <PageHeader icon="👷" title={t('crew')} />

      {/* פילטרים */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          <div className="form-group"><label>{t('c_year')}</label>
            <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="form-group"><label>{t('c_month')}</label>
            <select className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              <option value={0}>{t('c_all')}</option>
              {MONTHS.map((_, i) => <option key={i} value={i + 1}>{monthShort(i)}</option>)}
            </select>
          </div>
          <div className="form-group"><label>{t('c_from')}</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="form-group"><label>{t('c_to')}</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="btn btn-ghost" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); setFrom(''); setTo(''); }}>{t('c_reset')}</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <>
          {/* KPI */}
          <div className="kpi-grid">
            {kpis.map((k) => (
              <div key={k.label} className="kpi-card">
                <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--bg-secondary)' }}>{k.icon}</div><span className="kpi-label">{k.label}</span></div>
                <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* כרטיסי עובדים */}
          <div style={{ marginTop: 20 }} className="grid">
            {perWorker.map((w) => (
              <div key={w.id} className="card clickable" {...activatable(() => navigate('/workers', { state: { openWorkerId: w.id } }), `פתיחת כרטיס העובד ${w.name}`)}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>👤 {w.name}</div>
                <div className="form-grid-2" style={{ gap: 6, fontSize: 13 }}>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('w_hours')}: </span><b>{formatNumber(w.hours)}</b></div>
                  <div><span style={{ color: 'var(--text-muted)' }}>{t('m_jobs')}: </span><b>{w.jobs}</b></div>
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--text-muted)' }}>{t('m_income')}: </span><b style={{ color: 'var(--revenue)' }}>{formatMoney(w.paid)}</b></div>
                </div>
              </div>
            ))}
            {perWorker.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}>{t('c_noData')}</div>}
          </div>

          {/* גרף 1: משכורת לפי עובד (Horizontal) */}
          {salaryByWorker.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginTop: 0 }}>{t('m_cSalaryWorker')}</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={Math.max(180, salaryByWorker.length * 42)}>
                  <BarChart data={salaryByWorker} layout="vertical" margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                    <XAxis type="number" {...xAxisProps(0)} />
                    <YAxis dataKey="name" {...yCategoryProps({ width: 124 })} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                    <Bar dataKey="value" fill="#7C4DFF" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* גרף 2: משכורות עובדים לאורך זמן */}
          {salaryOverTime.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginTop: 0 }}>{t('m_cSalaryTime')}</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={salaryOverTime} margin={CHART_MARGIN_ROTATED}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...xAxisProps(salaryOverTime.length, { rotate: salaryOverTime.length > 8 })} />
                    <YAxis {...yAxisProps({ money: true })} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                    <Legend wrapperStyle={LEGEND_STYLE} />
                    {salaryOverTime.length && Object.keys(salaryOverTime[0]).filter((k) => k !== 'label').map((n, i) => (
                      <Bar key={n} dataKey={n} stackId="a" fill={['#7C4DFF', '#2878D0', '#09A7B2', '#F59E0B', '#F04444', '#2E9B62', '#8B5CF6'][i % 7]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* גרף 3: שעות לפי עובד */}
          {hoursByWorker.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginTop: 0 }}>{t('m_cHoursWorker')}</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={hoursByWorker} margin={CHART_MARGIN_ROTATED}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="name" {...xAxisProps(hoursByWorker.length, { rotate: true })} />
                    <YAxis {...yAxisProps()} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v)} ${t('w_hours')}`} />
                    <Bar dataKey="value" fill="#09A7B2" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* גרף 4: עלות לפי סוג עבודה */}
          {costByType.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginTop: 0 }}>{t('m_cCostType')}</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={costByType} margin={CHART_MARGIN_ROTATED}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="name" {...xAxisProps(costByType.length, { rotate: true })} />
                    <YAxis {...yAxisProps({ money: true })} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                    <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* גרף 5: עלות עובדים לפי מבנה */}
          {costByStructure.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginTop: 0 }}>{t('m_cCostStruct')}</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={costByStructure} margin={CHART_MARGIN_ROTATED}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="name" {...xAxisProps(costByStructure.length, { rotate: true })} />
                    <YAxis {...yAxisProps({ money: true })} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                    <Bar dataKey="value" fill="#2878D0" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
