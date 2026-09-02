// ============================================================
// מלאי (סעיף 23 + "ניהול מלאי — הוספה והפחתה")
// ------------------------------------------------------------
// Airtable הוא מקור האמת. האפליקציה כותבת ישירות ל"מלאי נוכחי"
// לאחר אישור המשתמש, מעדכנת "תאריך עדכון", קוראת מחדש ומרעננת
// גם את ההתראות. "מלאי להורדה" מחושב כברירת מחדל מנתוני השבוע
// האחרון (שקית/כובע לקרטון, משטחים מהחשבוניות) וניתן לעריכה.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { formatNumber, formatDate } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { toast, confirmDialog } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import { exportCsv, fileStamp } from '../utils/table.js';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

const TABLE = 'מלאי בסיסי';

const ITEM_FORM_FIELDS = [
  { name: 'קטגוריה', label: 'קטגוריה', type: 'select', required: true },
  { name: 'מלאי נוכחי', label: 'מלאי נוכחי', type: 'number' },
  { name: 'מלאי מינימום', label: 'מלאי מינימום', type: 'number' },
  { name: 'תאריך עדכון', label: 'תאריך עדכון', type: 'date' },
  { name: 'הערות', label: 'הערות', type: 'textarea' },
];

// סטטוס פריט: תקין / קרוב למינימום / מלאי נמוך (צבע + טקסט, לא צבע בלבד)
function itemStatus(item) {
  const cur = Number(item['מלאי נוכחי']);
  const min = Number(item['מלאי מינימום']) || 0;
  if (item['מלאי נוכחי'] == null || Number.isNaN(cur)) return { key: 'na', label: 'לא זמין', color: 'var(--text-muted)', soft: 'var(--bg-secondary)' };
  if (cur <= min) return { key: 'low', label: 'מלאי נמוך', color: 'var(--error)', soft: 'var(--error-soft)' };
  if (min > 0 && cur <= min * 1.25) return { key: 'near', label: 'קרוב למינימום', color: 'var(--warning)', soft: 'var(--warning-soft)' };
  return { key: 'ok', label: 'תקין', color: 'var(--ok)', soft: 'var(--ok-soft)' };
}

const parseAny = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};

export default function InventoryPage() {
  const app = useApp();
  const canEdit = (app.user?.role || 'owner') === 'owner';
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' | ok | near | low
  const [editItem, setEditItem] = useState(null); // {item, mode: 'add'|'reduce', defaultAmount?}
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(null);
  const [lastWeek, setLastWeek] = useState(null); // {code, cartons, pallets}

  const load = useCallback(() => app.api.get(TABLE, '?maxRecords=200')
    .then((d) => { const arr = Array.isArray(d) ? d : []; setItems(arr); return arr; })
    .catch(() => []), [app.api]);

  useEffect(() => {
    load().then((arr) => {
      const id = params.get('open');
      if (id) {
        const found = arr.find((x) => x.id === id);
        if (found) setDrawer(found);
        const next = new URLSearchParams(params);
        next.delete('open');
        setParams(next, { replace: true });
      }
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // השבוע האחרון מ"סיכום שבועי" — לחישוב "מלאי להורדה"
  useEffect(() => {
    const enc = encodeURIComponent;
    const fields = ['קוד שבוע', 'תאריך התחלה', 'JSON לפי ימים מאוחד'].map(enc).join(',');
    fetch(`/api/${enc('סיכום שבועי')}?raw=1&fields=${fields}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const list = (Array.isArray(rows) ? rows : [])
          .filter((w) => typeof w['תאריך התחלה'] === 'string')
          .sort((a, b) => String(b['תאריך התחלה']).localeCompare(String(a['תאריך התחלה'])));
        const w = list[0];
        if (!w) return;
        const daily = parseAny(w['JSON לפי ימים מאוחד']);
        const days = Array.isArray(daily?.days) ? daily.days : [];
        const cartons = days.reduce((s, d) => s + (Number(d.cartons) || 0), 0);
        const pallets = days.reduce((s, d) => s + (Number(d.pallets) || 0), 0);
        if (cartons || pallets) setLastWeek({ code: w['קוד שבוע'], cartons, pallets });
      })
      .catch(() => {});
  }, []);

  const filtered = items.filter((i) => {
    if (statusFilter && itemStatus(i).key !== statusFilter) return false;
    if (!search) return true;
    return String(i['קטגוריה'] || '').toLowerCase().includes(search.toLowerCase());
  });

  const counts = useMemo(() => {
    const c = { ok: 0, near: 0, low: 0 };
    items.forEach((i) => { const s = itemStatus(i); if (c[s.key] !== undefined) c[s.key] += 1; });
    return c;
  }, [items]);

  const chartData = useMemo(() => filtered.map((i) => ({
    name: i['קטגוריה'] || 'פריט',
    'מלאי נוכחי': Number(i['מלאי נוכחי']) || 0,
    'מלאי מינימום': Number(i['מלאי מינימום']) || 0,
  })), [filtered]);

  // ברירת מחדל של "מלאי להורדה" לפי האיפיון: שקית/כובע = קרטון; משטחים לפי החשבוניות
  const plannedFor = (item) => {
    if (!lastWeek) return null;
    const cat = String(item['קטגוריה'] || '');
    if (cat.includes('שקי') || cat.includes('כובע')) return lastWeek.cartons || null;
    if (cat.includes('משטח')) return lastWeek.pallets || null;
    return null;
  };

  const doExport = () => exportCsv(`מלאי-${fileStamp()}`, [
    { label: 'קטגוריה', get: (i) => i['קטגוריה'] || '' },
    { label: 'מלאי נוכחי', get: (i) => i['מלאי נוכחי'] ?? '' },
    { label: 'מלאי מינימום', get: (i) => i['מלאי מינימום'] ?? '' },
    { label: 'סטטוס', get: (i) => itemStatus(i).label },
    { label: 'תאריך עדכון', get: (i) => (i['תאריך עדכון'] ? formatDate(i['תאריך עדכון']) : '') },
    { label: 'ספקים', get: (i) => displayName(i['ספקים'], '') },
    { label: 'הערות', get: (i) => i['הערות'] || '' },
  ], filtered);

  return (
    <div>
      <PageHeader icon="📦" title="מלאי">
        <input className="input no-print" aria-label="חיפוש פריט מלאי" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>🖨️ הדפסה</button>
        <button type="button" className="btn btn-ghost no-print" onClick={doExport} disabled={!filtered.length}>⬇️ ייצוא</button>
        {canEdit && <button className="btn btn-primary no-print" onClick={() => setForm({})}>+ פריט מלאי</button>}
      </PageHeader>

      {loading ? <div className="skeleton skeleton-card" /> : (
        <>
          {/* KPI */}
          <div className="kpi-grid">
            <Kpi icon="📦" soft="var(--inventory-soft)" color="var(--inventory)" label="סה&quot;כ פריטים" value={items.length}
              active={statusFilter === ''} onClick={() => setStatusFilter('')} />
            <Kpi icon="✅" soft="var(--ok-soft)" color="var(--ok)" label="פריטים תקינים" value={counts.ok}
              active={statusFilter === 'ok'} onClick={() => setStatusFilter(statusFilter === 'ok' ? '' : 'ok')} />
            <Kpi icon="🟠" soft="var(--warning-soft)" color="var(--warning)" label="קרוב למינימום" value={counts.near}
              active={statusFilter === 'near'} onClick={() => setStatusFilter(statusFilter === 'near' ? '' : 'near')} />
            <Kpi icon="⚠️" soft="var(--error-soft)" color="var(--error)" label="מתחת למינימום" value={counts.low}
              active={statusFilter === 'low'} onClick={() => setStatusFilter(statusFilter === 'low' ? '' : 'low')} />
          </div>
          {statusFilter && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setStatusFilter('')}>✕ נקה סינון סטטוס</button>
            </div>
          )}

          {/* מלאי להורדה — הצעה מחושבת מהשבוע האחרון */}
          {lastWeek && filtered.some((i) => plannedFor(i)) && (
            <div className="card" style={{ marginTop: 18, borderRight: '4px solid var(--inventory)' }}>
              <div className="section-title" style={{ marginTop: 0 }}>
                מלאי להורדה — לפי שבוע {lastWeek.code || 'אחרון'}
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-secondary)', marginInlineStart: 8 }}>
                  ({formatNumber(lastWeek.cartons)} קרטונים · {formatNumber(lastWeek.pallets)} משטחים)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {filtered.filter((i) => plannedFor(i)).map((i) => (
                  <button key={i.id} type="button" className="btn btn-ghost"
                    onClick={() => setEditItem({ item: i, mode: 'reduce', defaultAmount: plannedFor(i) })}>
                    ➖ {i['קטגוריה']}: {formatNumber(plannedFor(i))}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* כרטיסי פריטים */}
          <div style={{ marginTop: 18 }} className="grid">
            {filtered.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}><div className="icon">📦</div>אין נתונים לתקופה זו</div>}
            {filtered.map((item) => {
              const cur = Number(item['מלאי נוכחי']) || 0;
              const min = Number(item['מלאי מינימום']) || 0;
              const st = itemStatus(item);
              const denom = Math.max(cur, min * 2, 1);
              return (
                <div key={item.id} className="card clickable" {...activatable(() => setDrawer(item), `פתיחת פריט ${item['קטגוריה'] || ''}`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <b style={{ fontSize: 16 }}>📦 {item['קטגוריה'] || 'פריט'}</b>
                    <span className="badge" style={{ background: st.soft, color: st.color }}>{st.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
                    <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>נוכחי</div><b style={{ fontSize: 24, color: st.color }}>{formatNumber(cur)}</b></div>
                    <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>מינימום</div><b style={{ fontSize: 18 }}>{formatNumber(min)}</b></div>
                    {item['תאריך עדכון'] && (
                      <div style={{ marginInlineStart: 'auto', textAlign: 'left' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>עודכן</div>
                        <div style={{ fontSize: 13 }}>{formatDate(item['תאריך עדכון'])}</div>
                      </div>
                    )}
                  </div>
                  <div className="progress" style={{ marginBottom: 12 }} aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.round((cur / denom) * 100))}%`, background: st.color }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); setEditItem({ item, mode: 'add' }); }}>+ הוספת מלאי</button>
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setEditItem({ item, mode: 'reduce', defaultAmount: plannedFor(item) }); }}>➖ הורדה</button>
                    {canEdit && (
                      <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" onClick={(e) => { e.stopPropagation(); setForm(item); }}>✎</button>
                        <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (await removeRecord(app.api, TABLE, item.id, item['קטגוריה'] || 'הפריט')) await load();
                          }}>🗑</button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* גרף מלאי לפי קטגוריה */}
          {chartData.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginTop: 0 }}>מלאי לפי קטגוריה</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="name" {...xAxisProps(chartData.length, { rotate: chartData.length > 6 })} />
                    <YAxis {...yAxisProps()} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [formatNumber(v), n]} />
                    <Legend wrapperStyle={LEGEND_STYLE} />
                    <Bar dataKey="מלאי נוכחי" fill="#078B8D" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="מלאי מינימום" fill="#F79009" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {editItem && (
        <StockModal
          api={app.api}
          item={editItem.item}
          mode={editItem.mode}
          defaultAmount={editItem.defaultAmount}
          onClose={() => setEditItem(null)}
          onSaved={async () => { setEditItem(null); await load(); toast('המלאי עודכן בהצלחה'); }}
        />
      )}

      {drawer && (
        <ItemDrawer
          item={items.find((x) => x.id === drawer.id) || drawer}
          canEdit={canEdit}
          onClose={() => setDrawer(null)}
          onAdd={() => setEditItem({ item: drawer, mode: 'add' })}
          onEdit={() => setForm(drawer)}
        />
      )}

      {form !== null && (
        <RecordForm
          api={app.api} table={TABLE}
          title={form.id ? `עריכת ${form['קטגוריה'] || 'פריט'}` : 'פריט מלאי חדש'}
          record={form.id ? form : null}
          fields={ITEM_FORM_FIELDS}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await load(); }}
        />
      )}
    </div>
  );
}

function Kpi({ icon, soft, color, label, value, active, onClick }) {
  return (
    <div className={`kpi-card ${onClick ? 'clickable' : ''}`}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e) => { if (e.key === 'Enter') onClick(); } } : {})}
      style={active && onClick ? { outline: `2px solid ${color.startsWith('var') ? color : color}`, outlineOffset: -2 } : undefined}>
      <div className="kpi-top"><div className="kpi-icon" style={{ background: soft }}>{icon}</div><span className="kpi-label">{label}</span></div>
      <div className="kpi-value" style={{ color }}>{formatNumber(value)}</div>
      <div style={{ height: 12 }} />
    </div>
  );
}

// ============================================================
// חלון הוספה/הורדה — לפי האיפיון: נוכחי, כמות, "מלאי לאחר",
// אזהרת מינימום, חסימת הורדה מעבר למלאי, מניעת לחיצה כפולה.
// ============================================================
function StockModal({ api, item, mode, defaultAmount, onClose, onSaved }) {
  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onClose, !saving);

  const cur = Number(item['מלאי נוכחי']) || 0;
  const min = Number(item['מלאי מינימום']) || 0;
  const amt = Number(amount) || 0;
  const next = mode === 'add' ? cur + amt : cur - amt;
  const belowAfter = mode === 'reduce' && amt > 0 && next <= min;
  const notEnough = mode === 'reduce' && amt > cur;

  const apply = async () => {
    if (saving) return;
    if (!amt || amt <= 0) { setError('יש להזין כמות גדולה מאפס'); return; }
    if (notEnough) { setError('אין מספיק מלאי לביצוע ההפחתה'); return; }
    if (belowAfter) {
      const ok = await confirmDialog({
        title: 'אזהרת מלאי מינימום',
        message: 'לאחר ההורדה המלאי יהיה מתחת למלאי המינימום.\nהאם להמשיך?',
        confirmLabel: 'אשר הורדת מלאי',
        danger: true,
      });
      if (!ok) return;
    }
    setSaving(true); setError('');
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try {
      try {
        await api.update(TABLE, item.id, { 'מלאי נוכחי': next, 'תאריך עדכון': iso });
      } catch {
        // אם "תאריך עדכון" אינו ניתן לכתיבה — מעדכנים רק את המלאי
        await api.update(TABLE, item.id, { 'מלאי נוכחי': next });
      }
      await onSaved();
    } catch (e) {
      setError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center' }}>{mode === 'add' ? '+ הוספת מלאי' : '➖ הורדת מלאי'}</h3>
        {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 12 }}>⚠️ {error}</div>}
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 18, marginBottom: 12 }}>{item['קטגוריה']}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 26, marginBottom: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>מלאי נוכחי</div>
            <b style={{ fontSize: 22 }}>{formatNumber(cur)}</b>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mode === 'add' ? 'מלאי לאחר ההוספה' : 'מלאי לאחר ההורדה'}</div>
            <b style={{ fontSize: 22, color: mode === 'add' ? 'var(--ok)' : (belowAfter || notEnough ? 'var(--error)' : 'var(--text-main)') }}>
              {amt > 0 ? formatNumber(next) : '—'}
            </b>
          </div>
        </div>
        <div className="form-group">
          <label>כמות {mode === 'add' ? 'להוספה' : 'להורדה'}</label>
          <input className="input" style={{ width: '100%' }} type="number" min="0" autoFocus
            value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
        </div>
        {notEnough && <div className="badge badge-error" style={{ marginBottom: 10 }}>אין מספיק מלאי לביצוע ההפחתה</div>}
        {!notEnough && belowAfter && <div className="badge badge-warn" style={{ marginBottom: 10 }}>⚠️ לאחר ההורדה המלאי יהיה מתחת למלאי המינימום</div>}
        <div className="form-actions">
          <button className="btn btn-ghost" disabled={saving} onClick={onClose}>ביטול</button>
          <button className={`btn ${mode === 'add' ? 'btn-success' : 'btn-primary'}`} disabled={saving || notEnough} onClick={apply}>
            {saving ? 'מעדכן מלאי...' : mode === 'add' ? 'הוסף למלאי' : 'אשר הורדת מלאי'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// כרטיס פריט — פרטים מלאים (רק שדות שיש בהם מידע) + פעולות
// ============================================================
function ItemDrawer({ item, canEdit, onClose, onAdd, onEdit }) {
  useEscapeClose(onClose);
  const st = itemStatus(item);
  const rows = [
    ['קטגוריה', item['קטגוריה']],
    ['מלאי נוכחי', item['מלאי נוכחי'] != null ? formatNumber(item['מלאי נוכחי']) : null],
    ['מלאי מינימום', item['מלאי מינימום'] != null ? formatNumber(item['מלאי מינימום']) : null],
    ['תאריך עדכון', item['תאריך עדכון'] ? formatDate(item['תאריך עדכון']) : null],
    ['ספקים', displayName(item['ספקים'], '') || null],
    ['הערות', item['הערות'] || null],
  ].filter(([, v]) => v != null && v !== '');

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <span>📦 {item['קטגוריה'] || 'פריט מלאי'}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0 }}>פרטי פריט</div>
              <span className="badge" style={{ background: st.soft, color: st.color }}>{st.label}</span>
            </div>
            {rows.map(([l, v]) => (
              <div key={l} className="obj-row"><span className="obj-row-label">{l}</span><span className="obj-row-value">{v}</span></div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-success" onClick={onAdd}>+ הוספת מלאי</button>
              {canEdit && <button className="btn btn-ghost" onClick={onEdit}>✎ עריכה</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
