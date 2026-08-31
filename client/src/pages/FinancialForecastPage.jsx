import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatMoney, formatNumber } from '../utils/format.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

// ============================================================
// הכנסות ותחזית — לפי סיכום שבועי בלבד
//
// מקור הנתונים: טבלת "סיכום שבועי" — שדות ה-JSON הקיימים בה:
//   - JSON הכנסה לפי מבנים      -> הכנסה נטו לפי מבנה/שבוע
//   - JSON סיכום קטיף לפי מבנים  -> קרטונים לפי מבנה
//   - JSON לפי ימים מאוחד        -> משקל / קרטונים / משטחים ליום
//   - JSON קג בפועל לפי ימים ומבנים -> קג בפועל
// אין כאן ניתוח מסמכים חדש — רק קריאה של שדות שכבר קיימים ב-Airtable.
// ============================================================

// הערה: לפעמים ה-JSON יורד כטקסט (ייתכן עם תווי בריחה) — מנרמל בצורה בטוחה
function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  let s = String(value).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// נסיונות לקריאת שורש: לפעמים המחרוזת מוקפת בגרשיים
function parseAny(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  return parseJson(value) ?? parseJson(parseJson(value)) ?? null;
}

const num = (v) => (v === null || v === undefined || v === '' ? 0 : (Number(v) || 0));

export default function FinancialForecastPage() {
  const app = useApp();
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    app.api.get('סיכום שבועי', '?maxRecords=200&raw=1')
      .then((d) => setWeeks(Array.isArray(d) ? d : []))
      .catch((e) => setLoadError(e.message || 'לא ניתן לטעון את הנתונים.'))
      .finally(() => setLoading(false));
  }, [app.api]);

  // ---- נרמול כל רשומת סיכום שבועי ליחידת תצוגה ----
  const rows = useMemo(() => {
    return weeks
      .map((w) => {
        const code = String(w['קוד שבוע'] ?? '');
        const start = w['תאריך התחלה'];
        const end = w['תאריך סיום'];
        // דלג על רשומות עם תאריכים פגומים (#ERROR!) או חסרי קוד תקין
        if (typeof start !== 'string' || typeof end !== 'string') return null;
        const startDate = new Date(start.slice(0, 10));
        if (Number.isNaN(startDate.getTime())) return null;

        const incByStruct = parseAny(w['JSON הכנסה לפי מבנים']) || {};
        const daily = parseAny(w['JSON לפי ימים מאוחד']) || {};
        const kgActual = parseAny(w['JSON קג בפועל לפי ימים ומבנים']) || {};

        const days = Array.isArray(daily.days) ? daily.days : [];
        const totalWeight = days.reduce((s, d) => s + num(d.weight), 0);
        const totalCartons = days.reduce((s, d) => s + num(d.cartons), 0);
        const totalPallets = days.reduce((s, d) => s + num(d.pallets), 0);

        // הכנסה נטו לפי מבנה / גידולים — בפורמטים השונים שירדו מה-Airtable
        const structures = Array.isArray(incByStruct.structures) ? incByStruct.structures
          : (incByStruct.varieties && Array.isArray(incByStruct.varieties)
            ? incByStruct.varieties.flatMap((v) => (Array.isArray(v.structures) ? v.structures : []))
            : []);
        const totalNetIncome = num(incByStruct.weekly_net_income)
          || structures.reduce((s, st) => s + num(st.net_income), 0)
          || num(incByStruct.total_net_income);

        return {
          id: w.id,
          code,
          start: startDate,
          startLabel: start.slice(0, 10),
          endLabel: typeof end === 'string' ? end.slice(0, 10) : '',
          year: String(startDate.getFullYear()),
          totalWeight,
          totalCartons: num(incByStruct.total_cartons) || totalCartons,
          totalPallets,
          totalNetIncome,
          totalGross: num(incByStruct.total_gross_sales),
          structures,
          kgActual,
          daily,
          hasIncome: structures.length > 0 || totalNetIncome > 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
  }, [weeks]);

  // ---- שנים זמינות ----
  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort(), [rows]);
  const [year, setYear] = useState('');
  const selectedYear = year || (years.length ? years[years.length - 1] : String(new Date().getFullYear()));

  const yearRows = rows.filter((r) => r.year === selectedYear);

  // ---- סיכום לפי חודש, וסה"כ שנתי ----
  const byMonth = useMemo(() => {
    const map = new Map();
    for (const r of yearRows) {
      const key = `${r.year}-${r.start.getMonth()}`;
      if (!map.has(key)) map.set(key, {
        key,
        month: r.start.toLocaleDateString('he-IL', { month: 'long' }),
        net: 0, kg: 0, cartons: 0, pallets: 0,
      });
      const m = map.get(key);
      m.net += r.totalNetIncome;
      m.kg += r.totalWeight;
      m.cartons += r.totalCartons;
      m.pallets += r.totalPallets;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [yearRows]);

  const annual = useMemo(() => yearRows.reduce((a, r) => {
    a.net += r.totalNetIncome;
    a.kg += r.totalWeight;
    a.cartons += r.totalCartons;
    a.pallets += r.totalPallets;
    return a;
  }, { net: 0, kg: 0, cartons: 0, pallets: 0 }), [yearRows]);

  // ---- הכנסה לפי מבנה (מצטבר לשנה) ----
  const structureMap = useMemo(() => {
    const map = new Map();
    for (const r of yearRows) {
      for (const st of r.structures) {
        const key = st.structure_id || st.structure || 'לא ידוע';
        const name = st.structure || 'לא ידוע';
        if (!map.has(key)) map.set(key, { name, net: 0, cartons: 0, weeks: new Set() });
        const e = map.get(key);
        e.net += num(st.net_income);
        e.cartons += num(st.cartons);
        if (r.code) e.weeks.add(r.code);
      }
    }
    return [...map.values()].sort((a, b) => b.net - a.net);
  }, [yearRows]);

  // ---- נתונים לגרף חודשי ----
  const chartData = byMonth.map((m) => ({ name: m.month, 'הכנסה נטו': Math.round(m.net), 'משקל': Math.round(m.kg) }));

  if (loading) {
    return (
      <div>
        <div className="page-header"><h2>הכנסות ותחזית</h2></div>
        <div className="skeleton skeleton-chart" />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>הכנסות ותחזית — {selectedYear}</h2>
        <select className="select" value={selectedYear} onChange={(e) => setYear(e.target.value)}>
          {years.length ? years.map((y) => <option key={y} value={y}>{y}</option>) : <option value={selectedYear}>{selectedYear}</option>}
        </select>
      </div>

      {loadError && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {loadError}</div>}

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">הכנסה נטו שנתית</span></div>
          <div className="kpi-value" style={{ color: '#08A878' }}>{formatMoney(annual.net)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">סה"כ ק"ג</span></div>
          <div className="kpi-value">{formatNumber(annual.kg, 0)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">קרטונים</span></div>
          <div className="kpi-value">{formatNumber(annual.cartons, 0)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top"><span className="kpi-label">משטחים</span></div>
          <div className="kpi-value">{formatNumber(annual.pallets, 0)}</div>
        </div>
      </div>

      {yearRows.length === 0 && (
        <div className="card empty-state">אין נתוני סיכום שבועי לשנה זו.</div>
      )}

      {/* טבלת הכנסה לפי מבנה */}
      {structureMap.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>הכנסה לפי מבנים — {selectedYear}</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>מבנה</th><th>הכנסה נטו</th><th>קרטונים</th><th>שבועות</th></tr></thead>
              <tbody>
                {structureMap.map((st) => (
                  <tr key={st.name}>
                    <td>{st.name}</td>
                    <td style={{ color: '#08A878', fontWeight: 700 }}>{formatMoney(st.net)}</td>
                    <td>{formatNumber(st.cartons, 0)}</td>
                    <td>{st.weeks.size}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--docs-soft)', fontWeight: 800 }}>
                  <td>סה"כ</td>
                  <td>{formatMoney(structureMap.reduce((s, x) => s + x.net, 0))}</td>
                  <td>{formatNumber(structureMap.reduce((s, x) => s + x.cartons, 0), 0)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* טבלת שבועות */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>פירוט שבועי — {selectedYear}</div>
        <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="data-table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>שבוע</th><th>מתאריך</th><th>עד תאריך</th>
                <th>ק"ג</th><th>קרטונים</th><th>משטחים</th><th>הכנסה נטו</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.code || 'לא ידוע'}</b></td>
                  <td>{r.startLabel}</td>
                  <td>{r.endLabel}</td>
                  <td>{formatNumber(r.totalWeight, 0)}</td>
                  <td>{formatNumber(r.totalCartons, 0)}</td>
                  <td>{formatNumber(r.totalPallets, 0)}</td>
                  <td style={{ color: '#08A878', fontWeight: 600 }}>{formatMoney(r.totalNetIncome)}</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--docs-soft)', fontWeight: 800 }}>
                <td colSpan={3}>סה"כ שנתי</td>
                <td>{formatNumber(annual.kg, 0)}</td>
                <td>{formatNumber(annual.cartons, 0)}</td>
                <td>{formatNumber(annual.pallets, 0)}</td>
                <td>{formatMoney(annual.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* גרף חודשי */}
      {chartData.length > 0 && (
        <div className="grid-2" style={{ gap: 16 }}>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>הכנסה נטו לפי חודש</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...xAxisProps(chartData.length)} />
                <YAxis {...yAxisProps({ money: true })} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => formatMoney(v)} />
                <Bar dataKey="הכנסה נטו" fill="#08A878" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div className="section-title" style={{ marginTop: 0 }}>ק"ג לפי חודש</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...xAxisProps(chartData.length)} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${formatNumber(v, 0)} ק"ג`} />
                <Bar dataKey="משקל" fill="#2878D0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
