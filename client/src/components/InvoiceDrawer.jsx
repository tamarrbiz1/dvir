// ============================================================
// מגירת חשבונית — כרטיס חשבונית מלא (סעיף 28 + כללי אובייקטים מקושרים)
// ------------------------------------------------------------
// הכרטיס מציג: 7 KPI (ברוטו/נטו/משקל/קרטונים/משטחים/ניכוי/הובלה),
// פרטים עסקיים בלי שורות ריקות (+ "הוספת פרטים" למה שחסר), המסמך המצורף,
// פירוק "סיכום יומי" (תאריך · זן · קרטונים · משקל · פדיון · משטחים)
// וארבעת הגרפים שבאיפיון: פדיון לפי יום · פדיון לפי זן · משקל לפי יום · קרטונים לפי יום.
// כל אובייקט מקושר (משווק / שבוע / צ'ק / תעודה) לחיץ ונפתח בתוך אותה
// מגירה עם Breadcrumb וכפתור "חזרה".
//
// שימוש:
//   <InvoiceDrawer inv={i} invoices={all} api={app.api} onClose={...}
//                  canEdit={isOwner} onEdit={(inv) => ...} onDelete={(inv) => ...} />
//   פתיחה ישירה על אובייקט מקושר: initial={{ kind: 'marketer', id, name }}
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import { formatNumber, formatDate, formatWeight, formatPercent, formatMoney } from '../utils/format.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import {
  invNumber, invLabel, invTitle, invDate, invUploadDate, invStatus, invGross, invNet, invWeight, invCartons, invPallets,
  invNetPerKg, invGrossPerKg, invAvgCarton, invDeduction, invDeductionExpected, invDeductionPct, invDeductionDev,
  invDeductionCheck, invTransport, invTransportPerPallet, invTransportCheck, invWeekCode, invWeekLink, invDeliveryRef,
  invChecks, invMarketer, invDocument, isDeductionAnomaly, isTransportAnomaly, statusBadge, checkBadge,
  parseInvoiceDaily, invoicesOfMarketer, invoicesOfWeek, weekRange, shortDate,
} from '../utils/invoices.js';

const PIE = ['#08A878', '#2878D0', '#09A7B2', '#8B5CF6', '#F59E0B', '#F04444', '#6366F1'];

// ------------------------------------------------------------
// עטיפה: מחסנית אובייקטים + Breadcrumb
// ------------------------------------------------------------
export default function InvoiceDrawer({ inv, invoices = [], api, onClose, canEdit = false, onEdit, onDelete, initial = null }) {
  const [stack, setStack] = useState(() => {
    const base = inv ? [{ kind: 'invoice', inv }] : [];
    return initial ? [...base, initial] : base;
  });

  // אם החשבונית עודכנה (אחרי עריכה) — מרעננים את הרשומה שבמחסנית
  useEffect(() => {
    if (!inv) return;
    setStack((s) => s.map((e) => (e.kind === 'invoice' && e.inv?.id === inv.id ? { ...e, inv } : e)));
  }, [inv]);

  const top = stack[stack.length - 1];
  const push = (entry) => setStack((s) => [...s, entry]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const back = stack.length > 1 ? pop : onClose;
  useEscapeClose(back);

  if (!top) return null;
  const crumbs = stack.map(entryLabel);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={crumbs[crumbs.length - 1]}>
        <div className="drawer-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {stack.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={pop} aria-label="חזרה לאובייקט הקודם">→ חזרה</button>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🧾 {crumbs[crumbs.length - 1]}</span>
          </span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>

        {stack.length > 1 && (
          <nav className="crumbs" aria-label="מסלול ניווט">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span aria-hidden="true" className="crumb-sep">›</span>}
                {i < crumbs.length - 1
                  ? <button type="button" className="crumb-link" onClick={() => setStack((s) => s.slice(0, i + 1))}>{c}</button>
                  : <b>{c}</b>}
              </span>
            ))}
          </nav>
        )}

        <div className="drawer-body">
          {top.kind === 'invoice' && <InvoicePanel inv={top.inv} push={push} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />}
          {top.kind === 'marketer' && <MarketerPanel entry={top} invoices={invoices} api={api} push={push} />}
          {top.kind === 'week' && <WeekPanel entry={top} invoices={invoices} push={push} />}
        </div>
      </div>
    </div>
  );
}

function entryLabel(e) {
  if (e.kind === 'invoice') return invLabel(e.inv);
  if (e.kind === 'marketer') return e.name || 'משווק';
  if (e.kind === 'week') return `שבוע ${e.code || ''}`.trim();
  return '';
}

// ------------------------------------------------------------
// רכיבי עזר משותפים
// ------------------------------------------------------------
export function ObjChip({ icon, label, onClick, title }) {
  if (!label) return <span className="muted">לא זמין</span>;
  if (!onClick) return <span className="obj-chip static">{icon} {label}</span>;
  return (
    <span className="obj-chip" {...activatable((e) => { e.stopPropagation(); onClick(); }, title || `פתיחת ${label}`)}>
      {icon} {label}
    </span>
  );
}

// שורת פרטים — שדה ריק אינו מוצג (האיפיון: "פרטים חסרים אינם מוצגים כשורות ריקות")
function Row({ l, v }) {
  if (v === null || v === undefined || v === '' || v === '—') return null;
  return (
    <div className="obj-row">
      <span className="obj-row-label">{l}</span>
      <span className="obj-row-value">{v}</span>
    </div>
  );
}

export function StatusBadge({ status }) {
  const b = statusBadge(status);
  return <span className={`badge ${b.cls}`}><span aria-hidden="true">{b.icon}</span> {b.text}</span>;
}

export function CheckBadgeValue({ value }) {
  const b = checkBadge(value);
  return <span className={`badge ${b.cls}`}><span aria-hidden="true">{b.icon}</span> {b.text}</span>;
}

// ------------------------------------------------------------
// כרטיס החשבונית
// ------------------------------------------------------------
function InvoicePanel({ inv, push, canEdit, onEdit, onDelete }) {
  const navigate = useNavigate();
  const daily = useMemo(() => parseInvoiceDaily(inv['סיכום יומי']), [inv]);
  const marketer = invMarketer(inv);
  const weekCode = invWeekCode(inv);
  const weekLink = invWeekLink(inv);
  const doc = invDocument(inv);
  const checks = invChecks(inv);
  const deliveryRef = invDeliveryRef(inv);

  const gross = invGross(inv);
  const net = invNet(inv);
  const weight = invWeight(inv);
  const cartons = invCartons(inv);
  const pallets = invPallets(inv);
  const deduction = invDeduction(inv);
  const transport = invTransport(inv);

  const kpis = [
    { l: 'ברוטו', v: gross === null ? 'לא זמין' : formatMoney(gross), c: 'var(--revenue)' },
    { l: 'נטו', v: net === null ? 'לא זמין' : formatMoney(net), c: 'var(--profit)' },
    { l: 'משקל', v: weight === null ? 'לא זמין' : formatWeight(weight), c: 'var(--weight)' },
    { l: 'קרטונים', v: cartons === null ? 'לא זמין' : formatNumber(cartons), c: 'var(--cartons)' },
    { l: 'משטחים', v: pallets === null ? 'לא זמין' : formatNumber(pallets), c: 'var(--pallets)' },
    { l: 'ניכוי', v: deduction === null ? 'לא זמין' : formatMoney(deduction), c: 'var(--expense)' },
    { l: 'הובלה', v: transport === null ? 'לא זמין' : formatMoney(transport), c: 'var(--text-secondary)' },
  ];

  // שדות שניתן להשלים ידנית וחסרים ברשומה — "+ הוספת פרטים"
  const missing = [
    invStatus(inv) ? null : 'סטטוס תשלום',
    invDate(inv) ? null : 'תאריך',
    weekCode ? null : 'קוד שבוע',
    transport === null ? 'עלות הובלה' : null,
  ].filter(Boolean);

  const daysChart = daily.days.map((d) => ({
    label: shortDate(d.date),
    פדיון: Math.round(d.revenue),
    משקל: Math.round(d.weight),
    קרטונים: Math.round(d.cartons),
  }));
  const byVarietyRevenue = daily.products.map((p) => ({ name: p.variety, value: Math.round(p.revenue) })).filter((x) => x.value > 0);

  const netPerKg = invNetPerKg(inv);
  const grossPerKg = invGrossPerKg(inv);
  const avg = invAvgCarton(inv);
  const dedExpected = invDeductionExpected(inv);
  const dedPct = invDeductionPct(inv);
  const dedDev = invDeductionDev(inv);
  const perPallet = invTransportPerPallet(inv);

  return (
    <div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        {kpis.map((k) => (
          <div key={k.l} className="kpi-card" style={{ padding: '14px 14px 0' }}>
            <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{k.l}</span></div>
            <div className="kpi-value" style={{ fontSize: 17, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* פרטים */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>פרטי חשבונית</span>
          {canEdit && (
            <span style={{ display: 'flex', gap: 6 }}>
              {onEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(inv)} aria-label="עריכת החשבונית">✎ עריכה</button>}
              {onDelete && <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }} onClick={() => onDelete(inv)} aria-label="מחיקת החשבונית">🗑 מחיקה</button>}
            </span>
          )}
        </div>
        <Row l="כותרת" v={invTitle(inv)} />
        <Row l="משווק" v={marketer ? <ObjChip icon="🚚" label={marketer.name} onClick={marketer.id ? () => push({ kind: 'marketer', id: marketer.id, name: marketer.name }) : null} /> : null} />
        <Row l="תאריך" v={invDate(inv) ? formatDate(invDate(inv)) : null} />
        <Row l="סטטוס תשלום" v={invStatus(inv) ? <StatusBadge status={invStatus(inv)} /> : null} />
        <Row l="שבוע" v={weekCode ? <ObjChip icon="📆" label={weekCode} onClick={() => push({ kind: 'week', code: weekCode, id: weekLink?.id || null })} /> : null} />
        <Row l='מחיר נטו לק"ג' v={netPerKg === null ? null : formatMoney(netPerKg)} />
        <Row l='מחיר ברוטו לק"ג' v={grossPerKg === null ? null : formatMoney(grossPerKg)} />
        <Row l="משקל ממוצע לקרטון" v={avg === null ? null : formatWeight(Math.round(avg * 100) / 100)} />
        <Row l="הועלה בתאריך" v={invUploadDate(inv) ? formatDate(invUploadDate(inv)) : null} />
        {missing.length > 0 && canEdit && onEdit && (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(inv, missing)} aria-label="הוספת פרטים חסרים">+ הוספת פרטים</button>
            <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>חסר: {missing.join(' · ')}</span>
          </div>
        )}
      </div>

      {/* ניכוי משווק */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>ניכוי משווק</div>
        {deduction === null && dedExpected === null && !invDeductionCheck(inv) ? (
          <div className="empty-state" style={{ padding: '10px 0' }}>אין נתוני ניכוי לחשבונית זו</div>
        ) : (
          <>
            <Row l="ניכוי בפועל" v={deduction === null ? null : formatMoney(deduction)} />
            <Row l="ניכוי צפוי" v={dedExpected === null ? null : formatMoney(dedExpected)} />
            <Row l="אחוז ניכוי" v={dedPct === null ? null : formatPercent(dedPct)} />
            <Row l="סטיית ניכוי" v={dedDev === null ? null : <span style={{ color: isDeductionAnomaly(inv) ? 'var(--error)' : undefined }}>{formatMoney(dedDev)}</span>} />
            <Row l="בדיקת ניכוי" v={invDeductionCheck(inv) ? <CheckBadgeValue value={invDeductionCheck(inv)} /> : null} />
          </>
        )}
      </div>

      {/* הובלה */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>הובלה</div>
        {transport === null && perPallet === null && !invTransportCheck(inv) ? (
          <div className="empty-state" style={{ padding: '10px 0' }}>אין נתוני הובלה לחשבונית זו</div>
        ) : (
          <>
            <Row l="עלות הובלה" v={transport === null ? null : formatMoney(transport)} />
            <Row l="משטחים" v={pallets === null ? null : formatNumber(pallets)} />
            <Row l="הובלה למשטח" v={perPallet === null ? null : formatMoney(perPallet)} />
            <Row l="בדיקת הובלה" v={invTransportCheck(inv) ? <CheckBadgeValue value={invTransportCheck(inv)} /> : null} />
          </>
        )}
      </div>

      {/* מסמכים מקושרים */}
      {(checks.length > 0 || deliveryRef) && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="section-title" style={{ marginTop: 0 }}>קישורים</div>
          {checks.length > 0 && (
            <Row l="צ'קים" v={(
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                {checks.map((c) => <ObjChip key={c.id || c.name} icon="🧾" label={c.name} onClick={() => navigate('/finance?tab=checks')} title={`פתיחת ${c.name} במסך הכספים`} />)}
              </span>
            )} />
          )}
          <Row l="תעודת משלוח" v={deliveryRef ? <ObjChip icon="📄" label={`תעודה ${deliveryRef}`} onClick={() => navigate(`/delivery-notes?${marketer?.id ? `marketer=${encodeURIComponent(marketer.id)}` : ''}${weekCode ? `&week=${encodeURIComponent(weekCode)}` : ''}`)} title="פתיחת תעודות המשלוח של החשבונית" /> : null} />
        </div>
      )}

      {/* המסמך */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>מסמך</div>
        {doc ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {doc.thumb && (
              <a href={doc.url} target="_blank" rel="noopener noreferrer" aria-label="פתיחת המסמך בחלון חדש">
                <img src={doc.thumb} alt={`תצוגה מקדימה: ${doc.filename}`} style={{ width: 96, borderRadius: 8, border: '1px solid var(--border)' }} />
              </a>
            )}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 600 }}>{doc.isPdf ? '📄' : '🖼️'} {doc.filename}</div>
              {doc.size && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatNumber(Math.round(doc.size / 1024))} KB</div>}
              <a className="btn btn-primary btn-sm" style={{ marginTop: 10, display: 'inline-block' }} href={doc.url} target="_blank" rel="noopener noreferrer">פתח מסמך</a>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '14px 0' }}>
            לא צורף קובץ לחשבונית זו.{' '}
            <button type="button" className="crumb-link" onClick={() => navigate('/upload', { state: { docType: 'חשבונית הכנסה' } })}>העלאת מסמך</button>
          </div>
        )}
      </div>

      {/* סיכום יומי */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>סיכום יומי</div>
        {daily.rows.length === 0 ? (
          <div className="empty-state" style={{ padding: '14px 0' }}>אין פירוט יומי לחשבונית זו</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead><tr><th>תאריך</th><th>זן</th><th>קרטונים</th><th>משקל</th><th>פדיון</th><th>משטחים</th></tr></thead>
                <tbody>
                  {daily.rows.map((r, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td><b>{r.date ? formatDate(r.date) : 'לא זמין'}</b></td>
                      <td>{r.variety || <span className="muted">לא זמין</span>}</td>
                      <td>{formatNumber(r.cartons)}</td>
                      <td>{formatWeight(r.weight)}</td>
                      <td>{formatMoney(r.revenue)}</td>
                      <td>{r.pallets ? formatNumber(r.pallets) : '—'}</td>
                    </tr>
                  ))}
                  <tr style={{ cursor: 'default', background: 'var(--bg-secondary)', fontWeight: 700 }}>
                    <td colSpan={2}>סה"כ</td>
                    <td>{formatNumber(daily.totals.cartons)}</td>
                    <td>{formatWeight(daily.totals.weight)}</td>
                    <td>{formatMoney(daily.totals.revenue)}</td>
                    <td>{daily.totals.pallets ? formatNumber(daily.totals.pallets) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {daily.validation && daily.validation.document_totals_match === false && (
              <div className="hint" style={{ color: 'var(--error)' }}>⚠️ סיכומי הימים אינם תואמים לסיכום המסמך (ניתוח AI) — מומלץ לבדוק את הקובץ המקורי.</div>
            )}

            <div className="section-title">פדיון לפי יום</div>
            <DayBars data={daysChart} dataKey="פדיון" fill="#08A878" money />
            <div className="section-title">פדיון לפי זן</div>
            {byVarietyRevenue.length ? (
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={byVarietyRevenue} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65}>
                    {byVarietyRevenue.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="empty-state" style={{ padding: '10px 0' }}>אין נתונים</div>}
            <div className="section-title">משקל לפי יום</div>
            <DayBars data={daysChart} dataKey="משקל" fill="#2878D0" weight />
            <div className="section-title">קרטונים לפי יום</div>
            <DayBars data={daysChart} dataKey="קרטונים" fill="#8B5CF6" />
          </>
        )}
      </div>
    </div>
  );
}

function DayBars({ data, dataKey, fill, money, weight }) {
  if (!data.length) return <div className="empty-state" style={{ padding: '10px 0' }}>אין נתונים</div>;
  const fmt = money ? (v) => formatMoney(v) : weight ? (v) => formatWeight(v) : (v) => formatNumber(v);
  return (
    <div style={{ direction: 'ltr' }}>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} margin={CHART_MARGIN_ROTATED}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" {...xAxisProps(data.length, { rotate: data.length > 7 })} />
          <YAxis {...yAxisProps(money ? { money: true } : {})} />
          <Tooltip {...TOOLTIP_STYLE} formatter={fmt} />
          <Bar dataKey={dataKey} fill={fill} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// רשימת חשבוניות בתוך כרטיס אובייקט (משווק / שבוע)
// ------------------------------------------------------------
export function InvoicesMiniTable({ list, push, empty = 'אין חשבוניות' }) {
  if (!list.length) return <div className="empty-state" style={{ padding: '14px 0' }}>{empty}</div>;
  const sorted = [...list].sort((a, b) => (new Date(invDate(b) || invUploadDate(b) || 0)) - (new Date(invDate(a) || invUploadDate(a) || 0)));
  return (
    <div className="table-wrap">
      <table className="data-table compact">
        <thead><tr><th>מס'</th><th>תאריך</th><th>נטו</th><th>ברוטו</th><th>משקל</th><th>סטטוס</th></tr></thead>
        <tbody>
          {sorted.map((i) => (
            <tr key={i.id} {...activatable(() => push({ kind: 'invoice', inv: i }), `פתיחת ${invLabel(i)}`)}>
              <td>{invNumber(i) ?? '—'}</td>
              <td>{invDate(i) ? formatDate(invDate(i)) : 'לא זמין'}</td>
              <td>{invNet(i) === null ? 'לא זמין' : formatMoney(invNet(i))}</td>
              <td>{invGross(i) === null ? 'לא זמין' : formatMoney(invGross(i))}</td>
              <td>{invWeight(i) === null ? 'לא זמין' : formatWeight(invWeight(i))}</td>
              <td><StatusBadge status={invStatus(i)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ list }) {
  const nets = list.map(invNet).filter((v) => v !== null);
  const grosses = list.map(invGross).filter((v) => v !== null);
  const weights = list.map(invWeight).filter((v) => v !== null);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const cell = (l, v, c) => (
    <div className="kpi-card" style={{ padding: '14px 14px 0' }}>
      <div className="kpi-top"><span className="kpi-label" style={{ fontSize: 11 }}>{l}</span></div>
      <div className="kpi-value" style={{ fontSize: 17, color: c }}>{v}</div>
    </div>
  );
  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
      {cell('חשבוניות', formatNumber(list.length))}
      {cell('נטו', nets.length ? formatMoney(sum(nets)) : 'אין נתונים', 'var(--profit)')}
      {cell('ברוטו', grosses.length ? formatMoney(sum(grosses)) : 'אין נתונים', 'var(--revenue)')}
      {cell('משקל', weights.length ? formatWeight(sum(weights)) : 'אין נתונים', 'var(--weight)')}
    </div>
  );
}

// טוען רשומה בודדת לפי מזהה
function useRecord(api, table, id) {
  const [rec, setRec] = useState(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    let alive = true;
    if (!api || !id) { setState('error'); return undefined; }
    setState('loading');
    api.get(table, `/${id}`)
      .then((r) => { if (alive) { setRec(r); setState('ok'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [api, table, id]);
  return { rec, state };
}

// ------------------------------------------------------------
// כרטיס משווק (סעיף 27): פרטים · חשבוניות
// ------------------------------------------------------------
function MarketerPanel({ entry, invoices, api, push }) {
  const navigate = useNavigate();
  const { rec, state } = useRecord(api, 'משווקים', entry.id);
  const list = invoicesOfMarketer(invoices, entry.id);
  const deliveryCount = Array.isArray(rec?.['תעודות משלוח']) ? rec['תעודות משלוח'].length : null;
  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>🚚 {entry.name || rec?.['שם משווק'] || 'משווק'}</div>
        {state === 'loading' && <div className="skeleton" style={{ height: 60 }} />}
        {state === 'error' && <div className="empty-state" style={{ padding: '10px 0' }}>לא ניתן לטעון את פרטי המשווק</div>}
        {rec && (
          <>
            <Row l="איש קשר" v={rec['איש קשר']} />
            <Row l="טלפון" v={rec['טלפון']} />
            <Row l="אימייל" v={rec['אימייל']} />
            <Row l="כתובת" v={rec['כתובת']} />
            <Row l="תנאי תשלום" v={rec['תנאי תשלום']} />
            <Row l="הערות" v={rec['הערות']} />
            <Row l="תעודות משלוח" v={deliveryCount === null ? null : formatNumber(deliveryCount)} />
          </>
        )}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/finance?tab=marketers')}>פתח במסך הכספים</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/delivery-notes?marketer=${encodeURIComponent(entry.id)}`)}>תעודות המשלוח של המשווק</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>חשבוניות המשווק</div>
        <Totals list={list} />
        <div style={{ marginTop: 12 }}><InvoicesMiniTable list={list} push={push} empty="אין חשבוניות למשווק זה" /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// כרטיס שבוע: טווח · חשבוניות בשבוע · קישור לסיכום השבועי
// ------------------------------------------------------------
function WeekPanel({ entry, invoices, push }) {
  const navigate = useNavigate();
  const list = invoicesOfWeek(invoices, entry.code || '');
  const range = weekRange(entry.code);
  return (
    <div>
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>📆 שבוע {entry.code}</div>
        <Row l="מתאריך" v={range?.from ? formatDate(range.from) : null} />
        <Row l="עד תאריך" v={range?.to ? formatDate(range.to) : null} />
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/weekly?week=${encodeURIComponent(entry.code || '')}`)}>פתח בסיכום השבועי</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/delivery-notes?week=${encodeURIComponent(entry.code || '')}`)}>תעודות המשלוח של השבוע</button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>חשבוניות בשבוע</div>
        <Totals list={list} />
        <div style={{ marginTop: 12 }}><InvoicesMiniTable list={list} push={push} empty="אין חשבוניות לשבוע זה" /></div>
      </div>
    </div>
  );
}
