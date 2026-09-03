import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { useAutoRefresh } from '../utils/live.js';
import { formatMoney, formatNumber, formatDate } from '../utils/format.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { CHART_MARGIN, CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';
import PageHeader from '../components/PageHeader.jsx';
import { useEscapeClose } from '../utils/navigation.jsx';
import { INVOICES_TABLE, invLabel, invMarketer, invWeekCode, invDeductionCheck, invTransportCheck, invDeductionDev, invTransportPerPallet, isDeductionAnomaly, isTransportAnomaly } from '../utils/invoices.js';

// ============================================================
// חריגות והתאמות (סעיף 35)
// מקורות: שדות JSON מתוך "סיכום שבועי"
// ============================================================

const CATEGORIES = [
  { key: 'missingInvoice', label: 'חסרה חשבונית', color: '#F04444' },
  { key: 'missingDelivery', label: 'חסרה תעודת משלוח', color: '#F79009' },
  { key: 'cartonDiff', label: 'אי התאמת קרטונים', color: '#F59E0B' },
  { key: 'harvestDiff', label: 'אי התאמת קטיף', color: '#8B5CF6' },
  { key: 'weightDiff', label: 'חריגת משקל', color: '#2878D0' },
  { key: 'unassigned', label: 'קרטונים לא משויכים', color: '#09A7B2' },
  { key: 'calcError', label: 'שגיאת חישוב', color: '#D92D20' },
  { key: 'deduction', label: 'חריגת ניכוי משווק', color: '#DC6803' },
  { key: 'palletPrice', label: 'חריגת מחיר משטח', color: '#7A5AF8' },
];

export default function AlertsPage() {
  const app = useApp();
  const [weeks, setWeeks] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState(null);

  const load = useCallback(() => Promise.all([
    app.api.get('סיכום שבועי', '?maxRecords=200'),
    app.api.get('מלאי בסיסי', '?maxRecords=200'),
    app.api.get(INVOICES_TABLE, '?maxRecords=1000').catch(() => []),
  ])
    .then(([w, inv, invs]) => {
      const arr = Array.isArray(w) ? w : [];
      setWeeks(arr);
      setInventory(Array.isArray(inv) ? inv : []);
      setInvoices(Array.isArray(invs) ? invs : []);
      // כרטיס שבוע פתוח ברענון ברקע מסונכרן לרשומה העדכנית
      setWeek((cur) => (cur ? (arr.find((x) => x['קוד שבוע'] === cur['קוד שבוע']) || cur) : cur));
    })
    .catch(() => {}), [app.api]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);
  useAutoRefresh(load);

  // ניתוח חריגות מכל שבוע
  const anomalies = useMemo(() => {
    const out = [];
    weeks.forEach((w) => {
      const code = w['קוד שבוע'] || 'שבוע';
      const daily = parseJson(w['JSON בדיקת התאמה יומית']);
      const harvest = parseJson(w['JSON התאמת קטיף לתעודות משלוח']);
      const status = w['סטטוס התאמה'];
      const harvestStatus = w['סטטוס התאמת קטיף'];
      const calcErr = String(w['שגיאת חישוב קג לפי מבנים'] || '').trim();
      const notes = parseArray(w['רשימת הערות התאמה']);

      // א. סטטוס מסמכים לא תקין
      if (status && status !== 'תקין') {
        out.push({ week: code, type: status, cat: 'missingInvoice', label: `מסמכים: ${status}` });
      }
      // ב. סטטוס קטיף לא תקין
      if (harvestStatus && !String(harvestStatus).includes('תקין')) {
        out.push({ week: code, type: harvestStatus, cat: 'harvestDiff', label: `קטיף: ${harvestStatus}` });
      }
      // ג. שגיאת חישוב
      if (calcErr) {
        out.push({ week: code, type: String(calcErr), cat: 'calcError', label: 'שגיאת חישוב ק"ג לפי מבנים' });
      }
      // ד. פריטים מה-JSON היומי
      if (Array.isArray(daily)) {
        daily.forEach((d) => {
          const note = d.note || d['הערה'] || d.notes;
          if (note && String(note).toLowerCase().includes('קרטון')) out.push({ week: code, type: String(note), cat: 'cartonDiff', label: String(note) });
          if (note && String(note).toLowerCase().includes('משקל')) out.push({ week: code, type: String(note), cat: 'weightDiff', label: String(note) });
        });
      }
      // ה. רשימת הערות נוספות
      if (Array.isArray(notes)) {
        notes.forEach((n) => {
          const s = String(n).replace(/^\d+\.\s*/, ''); // בלי המספור הטכני
          const cat = s.includes('קרטון') ? 'cartonDiff'
            : (s.includes('חסרה תעודת') || s.includes('חסרה חשבונית') || s.includes('חשבונית')) ? 'missingInvoice'
            : s.includes('משקל') ? 'weightDiff' : 'harvestDiff';
          out.push({ week: code, type: s, cat, label: s });
        });
      }
    });
    // ו. חריגות מתוך החשבוניות (סעיף 28: בדיקת ניכוי / בדיקת הובלה) — עם קישור לאובייקט
    invoices.forEach((inv) => {
      const week = invWeekCode(inv) || 'ללא שבוע';
      const who = invMarketer(inv)?.name ? ` · ${invMarketer(inv).name}` : '';
      if (isDeductionAnomaly(inv)) {
        const dev = invDeductionDev(inv);
        out.push({ week, cat: 'deduction', type: `${invLabel(inv)}${who}: ${invDeductionCheck(inv)}${dev !== null ? ` (סטייה ${formatMoney(dev)})` : ''}`, label: 'חריגת ניכוי משווק', open: `/invoices?open=${inv.id}`, objectLabel: invLabel(inv) });
      }
      if (isTransportAnomaly(inv)) {
        const pp = invTransportPerPallet(inv);
        out.push({ week, cat: 'palletPrice', type: `${invLabel(inv)}${who}: ${invTransportCheck(inv)}${pp !== null ? ` (${formatMoney(pp)} למשטח)` : ''}`, label: 'חריגת מחיר משטח', open: `/invoices?open=${inv.id}`, objectLabel: invLabel(inv) });
      }
    });
    return out;
  }, [weeks, invoices]);

  // צבירה לפי קטגוריה
  const byCategory = useMemo(() => {
    const b = {};
    anomalies.forEach((a) => { b[a.cat] = (b[a.cat] || 0) + 1; });
    return CATEGORIES.map((c) => ({ name: c.label, value: b[c.key] || 0, color: c.color }));
  }, [anomalies]);

  // צבירה לפי שבוע
  const byWeek = useMemo(() => {
    const b = {};
    anomalies.forEach((a) => { b[a.week] = (b[a.week] || 0) + 1; });
    return Object.entries(b).map(([k, v]) => ({ label: k, value: v }));
  }, [anomalies]);

  // מלאי נמוך: פריטים מ"מלאי בסיסי" שהכמות הנוכחית בהם ירדה מתחת למינימום שהוגדר.
  // לא חלק מהאיפיון המקורי של מסך זה, אבל שימושי כאן כי מי שבודק חריגות שבועיות
  // רוצה לראות גם התרעות מלאי בו-זמנית. אותו נתון בדיוק מוצג גם במסך "מלאי".
  const lowStock = inventory.filter((i) => Number(i['מלאי נוכחי']) <= Number(i['מלאי מינימום']));

  return (
    <div>
      <PageHeader icon="🔔" title="חריגות והתאמות" />

      {loading ? (
        <div className="skeleton skeleton-card" />
      ) : (
        <>
          {/* KPI */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--warning-soft)' }}>⚠️</div><span className="kpi-label">סה"כ חריגות</span></div>
              <div className="kpi-value" style={{ color: 'var(--warning)' }}>{anomalies.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--error-soft)' }}>🔴</div><span className="kpi-label">שבועות לא תקינים</span></div>
              <div className="kpi-value" style={{ color: 'var(--error)' }}>{new Set(anomalies.map((a) => a.week)).size}</div>
            </div>
          </div>

          {/* גרפי חריגות */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 20 }}>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>חריגות לפי סוג</div>
              {byCategory.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75}>
                      {byCategory.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Legend wrapperStyle={LEGEND_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="empty-state">אין חריגות</div>}
            </div>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>חריגות לפי שבוע</div>
              {byWeek.length ? (
                <div style={{ direction: 'ltr' }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={byWeek} margin={CHART_MARGIN_ROTATED}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="label" {...xAxisProps(byWeek.length, { rotate: true })} />
                      <YAxis {...yAxisProps({ width: 48, allowDecimals: false })} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Bar dataKey="value" fill="#F79009" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="empty-state">אין חריגות</div>}
            </div>
          </div>

          {/* רשימת חריגות */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="section-title" style={{ marginTop: 0 }}>רשימת חריגות מפורטת</div>
            {anomalies.length === 0 ? (
              <div className="empty-state">
                <div className="icon">✅</div>אין חריגות פעילות
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>שבוע</th><th>קטגוריה</th><th>תיאור</th><th>אובייקט</th></tr></thead>
                  <tbody>
                    {anomalies.map((a, i) => {
                      const cat = CATEGORIES.find((c) => c.key === a.cat);
                      return (
                        <tr key={i} onClick={() => (a.open ? navigate(a.open) : a.week && setWeek(weeks.find((w) => w['קוד שבוע'] === a.week)))}>
                          <td><b>{a.week}</b></td>
                          <td><span className="badge" style={{ background: (cat?.color || '#888') + '22', color: cat?.color }}>{cat?.label || a.cat}</span></td>
                          <td style={{ fontSize: 13, whiteSpace: 'normal', maxWidth: 480, lineHeight: 1.5 }}>{a.type}</td>
                          <td>
                            {a.open
                              ? <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(a.open); }} aria-label={`פתיחת ${a.objectLabel}`}>🧾 פתח אובייקט</button>
                              : <span className="muted" style={{ fontSize: 12 }}>שבוע</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* מלאי נמוך */}
          <div style={{ marginTop: 22 }}>
            <div className="section-title">מלאי נמוך</div>
            {lowStock.length === 0 ? (
              <div className="empty-state">אין פריטי מלאי מתחת למינימום</div>
            ) : (
              <div className="grid">
                {lowStock.map((item) => (
                  <div key={item.id} className="card" style={{ borderRight: '4px solid var(--warning)' }}>
                    <b>⚠️ {item['קטגוריה']}</b>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                      נוכחי: {Number(item['מלאי נוכחי']) || 0} · מינימום: {Number(item['מלאי מינימום']) || 0}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {week && <WeekDrawer week={week} onClose={() => setWeek(null)} />}
    </div>
  );
}

// Drawer עם פרטי התאמה מלאים של שבוע
function WeekDrawer({ week, onClose }) {
  useEscapeClose(onClose); // סגירה במקש Escape
  const navigate = useNavigate();
  const code = week['קוד שבוע'];
  const daily = parseJson(week['JSON בדיקת התאמה יומית']);
  const harvest = parseJson(week['JSON התאמת קטיף לתעודות משלוח']);
  const income = parseJson(week['JSON הכנסה לפי מבנים']);
  const yieldByStruct = parseJson(week['JSON קג בפועל לפי ימים ומבנים']);
  const notes = parseArray(week['רשימת הערות התאמה']);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>שבוע {week['קוד שבוע']}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>כללי</div>
            <div>שליחת: {formatDate(week['תאריך התחלה'])} – {formatDate(week['תאריך סיום'])}</div>
            <div>סטטוס התאמה: <b>{week['סטטוס התאמה'] || 'לא זמין'}</b></div>
            <div>סטטוס קטיף: <b>{week['סטטוס התאמת קטיף'] || 'לא זמין'}</b></div>
            {/* קישור מההתראה לאובייקטים הקשורים (סעיף "קישור מהתראה לאובייקט") */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/delivery-notes?week=${encodeURIComponent(code || '')}`)}>📄 תעודות משלוח של השבוע</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/weekly?week=${encodeURIComponent(code || '')}`)}>📆 פתח סיכום שבועי</button>
            </div>
          </div>

          {notes.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="section-title" style={{ marginTop: 0 }}>הערות התאמה</div>
              {notes.map((n, i) => <div key={i} style={{ padding: '4px 0' }}>• {n}</div>)}
            </div>
          )}
          {daily.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="section-title" style={{ marginTop: 0 }}>בדיקת התאמה יומית</div>
              <div style={{ fontSize: 13 }}>{daily.length} פריטי התאמה — תוצאות מסוכמות ב"סטטוס התאמה" (אין כאן תצוגת JSON גולמי)</div>
            </div>
          )}
          {harvest.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="section-title" style={{ marginTop: 0 }}>התאמת קטיף לתעודות משלוח</div>
              <div style={{ fontSize: 13 }}>{harvest.length} פריטי התאמה — תוצאות מסוכמות ב"סטטוס התאמת קטיף"</div>
            </div>
          )}
          {!daily.length && !harvest.length && !notes.length && (
            <div className="empty-state">אין נתוני התאמה לשדה זה</div>
          )}
        </div>
      </div>
    </div>
  );
}

function parseJson(v) {
  if (!v) return [];
  try {
    const p = typeof v === 'string' ? JSON.parse(v) : v;
    if (Array.isArray(p)) return p;
    return [];
  } catch { return []; }
}
function parseArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  try {
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p.map(String).filter(Boolean);
  } catch {}
  // טקסט רב-שורות (כמו בסיכום השבועי) — כל שורה היא הערה נפרדת
  return String(v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
