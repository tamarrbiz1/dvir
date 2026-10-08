// ============================================================
// מלאי (סעיף 23 + "ניהול מלאי — הוספה והפחתה")
// ------------------------------------------------------------
// Airtable הוא מקור האמת. האפליקציה כותבת ישירות ל"מלאי נוכחי"
// לאחר אישור המשתמש, מעדכנת "תאריך עדכון", קוראת מחדש ומרעננת
// גם את ההתראות.
// ⚠️ סעיף P1 (2026-10-07, הוראת תמר): "מלאי להורדה" (הצעה מחושבת
// מהשבוע האחרון) **הוסר** — ההורדה כבר אוטומטית-לגמרי מהמסמכים עצמם
// (תעודות משלוח/חשבוניות/הוצאות, ר' logistics-deduction.js/
// inventory-deduction.js). כפתור "➖ הורדה" ידני נשאר לתיקון-ידני בלבד.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { authFetch } from '../utils/authFetch.js';
import { formatNumber, formatDate, kpiValueClass } from '../utils/format.js';
import { displayName } from '../utils/resolve.js';
import PageHeader from '../components/PageHeader.jsx';
import RecordForm, { removeRecord } from '../components/RecordForm.jsx';
import { toast, confirmDialog } from '../utils/ui.js';
import { useEscapeClose } from '../utils/navigation.jsx';
import { activatable } from '../utils/a11y.js';
import { useAutoRefresh } from '../utils/live.js';
import { parseInventoryLedger, resolveExpenseLinks, summarizeRecentDrops } from '../utils/inventoryLedger.js';
import { UNIT_OPTIONS, itemUnit } from '../utils/inventoryUnits.js';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { CHART_MARGIN_ROTATED, GRID_PROPS, LEGEND_STYLE, TOOLTIP_STYLE, xAxisProps, yAxisProps } from '../utils/chart.js';

const TABLE = 'מלאי בסיסי';

// "ספקים" נוסף 2026-10-06 (סעיף C) — שדה קישור (link) לטבלת "ספקים",
// כך שאפשר לקשר ספק לפריט מלאי ישירות מהטופס (לא רק דרך הקישור ההפוך
// בכרטיס הספק עצמו). ר' RecordForm.jsx type:'link'.
//
// ⚠️ סעיף Q (7.10.2026, הוראת תמר): "קטגוריה אחת = פריט מלאי אחד". רשימת
// השדות נבנית כפונקציה (לא קבוע סטטי) כדי שאפשר לסמן קטגוריות-תפוסות
// כ-disabledOptions על בסיס הפריטים שכבר נטענו במסך — הקטגוריה של
// הרשומה הנערכת עצמה (אם יש) לא נספרת כ"תפוסה". הגנה אמיתית בשרת (409)
// קיימת תמיד; זו רק נוחות-UI שמונעת את הטעות מראש.
function buildItemFields(items, record) {
  // הקטגוריה של הרשומה הנערכת עצמה לא "תפוסה" (RecordForm כבר לא
  // משבית את הערך הנוכחי, אבל ההשמטה כאן מונעת תלות בכך)
  const taken = new Set(
    items
      .filter((it) => it.id !== record?.id && it['קטגוריה'] && normCat(it['קטגוריה']) !== normCat(record?.['קטגוריה']))
      .map((it) => String(it['קטגוריה']).trim())
  );
  return [
    { name: 'קטגוריה', label: 'קטגוריה', type: 'select', required: true, allowNew: true, disabledOptions: taken },
    { name: 'ספקים', label: 'ספק', type: 'link', linkTable: 'ספקים', linkNameField: 'שם ספק', multiple: true },
    { name: 'מלאי נוכחי', label: 'מלאי נוכחי', type: 'number' },
    // סעיף Z (8.10.2026) — חובה: לפי כל פריט נקבע איך מורידים ממנו מלאי
    // (ר' server/src/inventory-matching.js + logistics-deduction.js)
    { name: 'יחידת מידה', label: 'יחידת מידה', type: 'select', required: true, allowNew: true, staticOptions: UNIT_OPTIONS },
    { name: 'מלאי מינימום', label: 'מלאי מינימום', type: 'number' },
    { name: 'תאריך עדכון', label: 'תאריך עדכון', type: 'date' },
    { name: 'הערות', label: 'הערות', type: 'textarea' },
  ];
}

/** ולידציית-לקוח (סעיף Q): אותה הודעה כמו ה-409 בשרת, מוצגת לפני שליחה */
function normCat(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
}

function validateItemCategory(items, record) {
  return (values) => {
    const cat = String(values['קטגוריה'] || '').trim();
    if (!cat) return null;
    // ⚠️ 7.10.2026 (לילה 3), באג שנתפס חי: RecordForm שולח את **כל** שדות
    // הטופס, גם כשרק "מלאי נוכחי" שונה. לכן עריכת אחת משתי רשומות
    // "נילונים" הכפולות (כפילות-אמת שממתינה להחלטת תמר) נחסמה כאן —
    // ובשרת ב-409 — כלומר שתי הרשומות היו בלתי-ניתנות-לעריכה בכלל.
    // כתיבה שלא *משנה* את הקטגוריה לא יכולה ליצור כפילות חדשה.
    if (record && normCat(record['קטגוריה']) === normCat(cat)) return null;
    const dup = items.find((it) => it.id !== record?.id && normCat(it['קטגוריה']) === normCat(cat));
    if (dup) return `כבר קיים פריט בקטגוריה "${cat}" — פתח אותו ועדכן את הכמות במקום ליצור כפול`;
    return null;
  };
}

// סטטוס פריט: תקין / קרוב למינימום / מלאי נמוך (צבע + טקסט, לא צבע בלבד)
function itemStatus(item) {
  const cur = Number(item['מלאי נוכחי']);
  const min = Number(item['מלאי מינימום']) || 0;
  if (item['מלאי נוכחי'] == null || Number.isNaN(cur)) return { key: 'na', label: 'לא זמין', color: 'var(--text-muted)', soft: 'var(--bg-secondary)' };
  if (cur <= min) return { key: 'low', label: 'מלאי נמוך', color: 'var(--error)', soft: 'var(--error-soft)' };
  if (min > 0 && cur <= min * 1.25) return { key: 'near', label: 'קרוב למינימום', color: 'var(--warning)', soft: 'var(--warning-soft)' };
  return { key: 'ok', label: 'תקין', color: 'var(--ok)', soft: 'var(--ok-soft)' };
}

/** פיצול freeNotes (מחרוזת מחוברת ב-\n, ר' parseInventoryLedger) לרשימת שורות — למחיקה פר-שורה (תוספת 2026-10-08) */
function splitFreeLines(text) {
  return text ? text.split('\n').filter((l) => l.trim()) : [];
}

export default function InventoryPage() {
  const app = useApp();
  // חריג שני להרשאת מנהל-עבודה (2026-09-07): עדכון מלאי מותר גם לו,
  // בנוסף לבעל העסק — ר' הערה ב-navigation.jsx (OPERATIONS/canWrite).
  const canEdit = ['owner', 'manager'].includes(app.user?.role || 'owner');
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' | ok | near | low
  const [editItem, setEditItem] = useState(null); // {item, mode: 'add'|'reduce', defaultAmount?}
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(null);
  const [ledgerItem, setLedgerItem] = useState(null); // פריט שה"היסטוריית ירידות" שלו פתוחה (סעיף P2)

  const load = useCallback(() => app.api.get(TABLE, '?maxRecords=200')
    .then((d) => {
      const arr = Array.isArray(d) ? d : [];
      setItems(arr);
      setDrawer((cur) => (cur ? (arr.find((x) => x.id === cur.id) || cur) : cur));
      return arr;
    })
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
  useAutoRefresh(load);

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
    // סעיף Z: היחידה נשמרת בשורת-הגרף כדי שה-tooltip יוכל לנקוב בה. היא
    // **לא** נכנסת לציר-ה-Y: הגרף משווה קטגוריות שעשויות להיות ביחידות
    // שונות, ולכן היחידה היא נתון לכל עמודה, לא לציר כולו.
    unit: itemUnit(i),
    'מלאי נוכחי': Number(i['מלאי נוכחי']) || 0,
    'מלאי מינימום': Number(i['מלאי מינימום']) || 0,
  })), [filtered]);

  // סעיף Q (7.10.2026): קיבוץ פריטים לפי קטגוריה מנורמלת — כפילויות
  // שכבר קיימות בנתונים (למשל "נילונים" הכפולה) מוצגות כאן כבאנר-אזהרה,
  // לא נמחקות/ממוזגות אוטומטית (זו החלטת-מיזוג של תמר).
  // סעיף P2: "ירד היום/השבוע" לכל כרטיס. ממוזכר לפי items — קודם
  // parseInventoryLedger רץ בתוך ה-render של כל כרטיס, כלומר מחדש בכל
  // הקלדה בתיבת-החיפוש; עם הערות-פריט בנות 200+ שורות (תרחיש אמיתי —
  // ההערות של פריט-מלאי גדלות לצמיתות) זו עבודה מיותרת בכל keystroke.
  const recentByItem = useMemo(() => {
    const out = {};
    items.forEach((it) => { out[it.id] = summarizeRecentDrops(parseInventoryLedger(it['הערות']).movements); });
    return out;
  }, [items]);

  const duplicateGroups = useMemo(() => {
    const byCat = {};
    items.forEach((it) => {
      const cat = String(it['קטגוריה'] || '').trim();
      if (cat) (byCat[cat] ||= []).push(it);
    });
    return Object.entries(byCat).filter(([, arr]) => arr.length > 1);
  }, [items]);

  return (
    <div>
      <PageHeader icon="📦" title="מלאי">
        <input className="input no-print" aria-label="חיפוש פריט מלאי" placeholder="חיפוש..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>🖨️ הדפסה</button>
        {canEdit && <button className="btn btn-primary no-print" onClick={() => setForm({})}>+ פריט מלאי</button>}
      </PageHeader>

      {duplicateGroups.length > 0 && (
        <div className="notice notice-warn" role="status">
          ⚠️ נמצאו קטגוריות עם יותר מפריט מלאי אחד — יש למזג/למחוק ידנית (לא נעשה אוטומטית):
          {duplicateGroups.map(([cat, arr]) => (
            <div key={cat} style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{cat}:</b>
              {arr.map((it) => (
                <span key={it.id} className="obj-chip"
                  title={it['תאריך עדכון'] ? `עודכן ${formatDate(it['תאריך עדכון'])}` : 'אין תאריך עדכון'}
                  {...activatable(() => setDrawer(it), `פתיחת פריט ${cat} — ${formatNumber(it['מלאי נוכחי'] ?? 0)} ${itemUnit(it)}`)}>
                  {formatNumber(it['מלאי נוכחי'] ?? 0)} {itemUnit(it)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

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

          {/* כרטיסי פריטים */}
          <div style={{ marginTop: 18 }} className="grid">
            {filtered.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}><div className="icon">📦</div>אין נתונים לתקופה זו</div>}
            {filtered.map((item) => {
              const cur = Number(item['מלאי נוכחי']) || 0;
              const min = Number(item['מלאי מינימום']) || 0;
              const st = itemStatus(item);
              const denom = Math.max(cur, min * 2, 1);
              // אחוז מילוי חסום ל-0..100: מלאי שלילי או ערך לא-סופי לא ישברו את הפס
              const ratio = (cur / denom) * 100;
              const pct = Number.isFinite(ratio) ? Math.min(100, Math.max(0, Math.round(ratio))) : 0;
              const recent = recentByItem[item.id] || { today: 0, week: 0 };
              return (
                <div key={item.id} className="card clickable" {...activatable(() => setDrawer(item), `פתיחת פריט ${item['קטגוריה'] || ''}`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <b style={{ fontSize: 16 }}>📦 {item['קטגוריה'] || 'פריט'}</b>
                    <span className="badge" style={{ background: st.soft, color: st.color }}>{st.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginBottom: 4 }}>
                    <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>נוכחי</div><b style={{ fontSize: 24, color: st.color }}>{formatNumber(cur)} <span style={{ fontSize: 14, fontWeight: 400 }}>{itemUnit(item)}</span></b></div>
                    <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>מינימום</div><b style={{ fontSize: 18 }}>{formatNumber(min)} <span style={{ fontSize: 12, fontWeight: 400 }}>{itemUnit(item)}</span></b></div>
                    {item['תאריך עדכון'] && (
                      <div style={{ marginInlineStart: 'auto', textAlign: 'left' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>עודכן</div>
                        <div style={{ fontSize: 13 }}>{formatDate(item['תאריך עדכון'])}</div>
                      </div>
                    )}
                  </div>
                  {(recent.today > 0 || recent.week > 0) && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                      ירד היום: {formatNumber(recent.today)} · השבוע: {formatNumber(recent.week)}
                    </div>
                  )}
                  <div className="progress" style={{ marginBottom: 12 }} aria-hidden="true">
                    <span style={{ width: `${pct}%`, background: st.color }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); setEditItem({ item, mode: 'add' }); }}>+ הוספת מלאי</button>
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setEditItem({ item, mode: 'reduce' }); }}>➖ הורדה</button>
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
              <div className="section-title" style={{ marginTop: 0 }}>מלאי לפי קטגוריה · כרגע</div>
              <div style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={CHART_MARGIN_ROTATED}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="name" {...xAxisProps(chartData.length, { rotate: chartData.length > 6 })} />
                    <YAxis {...yAxisProps()} />
                    <Tooltip {...TOOLTIP_STYLE} formatter={(v, n, p) => [`${formatNumber(v)} ${p?.payload?.unit || ''}`.trim(), n]} />
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
          onOpenLedger={() => setLedgerItem(items.find((x) => x.id === drawer.id) || drawer)}
          // Escape כשיומן-הירידות פתוח צריך לסגור רק אותו, לא את שני הדרוארים
          // (useEscapeClose מאזין על document; stopPropagation לא עוצר listener שני)
          escapeActive={!ledgerItem}
        />
      )}

      {ledgerItem && (
        <LedgerDrawer
          item={items.find((x) => x.id === ledgerItem.id) || ledgerItem}
          canEdit={canEdit}
          onClose={() => setLedgerItem(null)}
        />
      )}

      {form !== null && (
        <RecordForm
          api={app.api} table={TABLE}
          title={form.id ? `עריכת ${form['קטגוריה'] || 'פריט'}` : 'פריט מלאי חדש'}
          record={form.id ? form : null}
          fields={buildItemFields(items, form.id ? form : null)}
          validate={validateItemCategory(items, form.id ? form : null)}
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
      <div className={kpiValueClass(formatNumber(value))} style={{ color }}>{formatNumber(value)}</div>
      <div className="kpi-sub">כרגע</div>
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
            <b style={{ fontSize: 22 }}>{formatNumber(cur)} <span style={{ fontSize: 13, fontWeight: 400 }}>{itemUnit(item)}</span></b>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mode === 'add' ? 'מלאי לאחר ההוספה' : 'מלאי לאחר ההורדה'}</div>
            <b style={{ fontSize: 22, color: mode === 'add' ? 'var(--ok)' : (belowAfter || notEnough ? 'var(--error)' : 'var(--text-main)') }}>
              {amt > 0 ? `${formatNumber(next)} ${itemUnit(item)}` : '—'}
            </b>
          </div>
        </div>
        <div className="form-group">
          <label>כמות {mode === 'add' ? 'להוספה' : 'להורדה'} ({itemUnit(item)})</label>
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
function ItemDrawer({ item, canEdit, onClose, onAdd, onEdit, onOpenLedger, escapeActive = true }) {
  useEscapeClose(onClose, escapeActive);
  const st = itemStatus(item);
  // שורות-תנועה (↓/↩/⚠) נכתבות אוטומטית ע"י ניתוח-המלאי (logistics-deduction.js/
  // inventory-deduction.js) — מוצגות בנפרד ב"היסטוריית ירידות" (סעיף P2), לא
  // מעורבבות עם הערות חופשיות כאן.
  const { movements, freeNotes } = parseInventoryLedger(item['הערות']);
  const rows = [
    ['קטגוריה', item['קטגוריה']],
    ['מלאי נוכחי', item['מלאי נוכחי'] != null ? `${formatNumber(item['מלאי נוכחי'])} ${itemUnit(item)}` : null],
    ['מלאי מינימום', item['מלאי מינימום'] != null ? `${formatNumber(item['מלאי מינימום'])} ${itemUnit(item)}` : null],
    ['יחידת מידה', item['יחידת מידה'] || null],
    ['תאריך עדכון', item['תאריך עדכון'] ? formatDate(item['תאריך עדכון']) : null],
    ['ספקים', displayName(item['ספקים'], '') || null],
    ['הערות', freeNotes || null],
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

          {/* תוספת 2026-10-08 ("מחיקת הערות"): הכפתור חייב להיות נגיש גם כשיש
              רק הערות-חופשיות בלי תנועה אחת (לא היה כך קודם — התנאי היה
              movements.length > 0 בלבד, כך שלפריט עם הערה ידנית אחת ובלי
              יומן-תנועות לא הייתה שום דרך לפתוח את מסך-הניהול ולמחוק אותה). */}
          {(movements.length > 0 || freeNotes) && (
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>📦 תנועות והערות</div>
              <button type="button" className="btn btn-ghost" onClick={onOpenLedger}>
                📜 {movements.length > 0 ? `היסטוריית ירידות (${movements.length})` : 'הערות'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// היסטוריית ירידות מפורטת (סעיף P2, 2026-10-07) — שורה לכל תנועה:
// תאריך · מסמך (קישור) · כמות שירדה · ממה נגזר · הערה (אי-התאמה/ביטול).
// קישורי-הוצאות (שאין להם מזהה-רשומה בשורה עצמה, רק "הוצאה #מספר")
// נפתרים מול רשימת הוצאות אמיתית — נטענת פעם אחת כשהדרואר נפתח.
//
// תוספת 2026-10-08 ("אפשרות למחוק הערות מרשימת ההערות"): כפתור 🗑
// לכל שורת-תנועה (מסתיר בשרת — ר' הערת-הכותרת המפורטת ב-POST
// /api/inventory/:id/ledger-line/hide ו-inventory-deduction.js —
// *לא* מחיקה אמיתית, כדי לא לאפשר הורדה-כפולה בניתוח חוזר ולא
// להתנגש עם מחיקה-מדורגת קיימת של המסמך-המקור) וכפתור 🗑 לכל שורת
// הערה-חופשית (PATCH /api/inventory/:id/notes — מחיקה אמיתית, בלי
// תגית לאבד). עדכון אופטימי מקומי בלבד — בלי טעינה מלאה; הרשימה
// המלאה (items ב-InventoryPage) תתעדכן בעצמה בסבב ה-refresh הבא.
// ============================================================
function LedgerDrawer({ item, canEdit, onClose }) {
  const navigate = useNavigate();
  useEscapeClose(onClose);
  const { movements: rawMovements, freeNotes: rawFreeNotes, hiddenCount } = useMemo(() => parseInventoryLedger(item['הערות']), [item]);
  const [movements, setMovements] = useState(rawMovements);
  const [freeLines, setFreeLines] = useState(() => splitFreeLines(rawFreeNotes));
  const [busyKey, setBusyKey] = useState(null); // מזהה-פעולה בודד שרץ כרגע (חוסם לחיצה כפולה)
  useEffect(() => {
    setMovements(rawMovements);
    const needsExpenseResolve = rawMovements.some((m) => m.sourceTable === 'הוצאות' && !m.link && m.sourceNumber);
    if (!needsExpenseResolve) return;
    authFetch(`/api/${encodeURIComponent('הוצאות')}?raw=1&fields=${encodeURIComponent('מספר הוצאה')}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const byNumber = {};
        (Array.isArray(rows) ? rows : []).forEach((r) => { if (r['מספר הוצאה'] != null) byNumber[String(r['מספר הוצאה'])] = r.id; });
        setMovements(resolveExpenseLinks(rawMovements, byNumber));
      })
      .catch(() => {});
  }, [rawMovements]);
  useEffect(() => { setFreeLines(splitFreeLines(rawFreeNotes)); }, [rawFreeNotes]);

  // "מחיקת" שורת-תנועה = הסתרה בלבד בשרת (הנתון, כולל כל תגית-
  // אידמפוטנטיות, נשאר שמור; "מלאי נוכחי" לא נוגע בכלל) — ר' הערה
  // בכותרת. אופטימי: מסירים מה-state המקומי רק אחרי תשובת-הצלחה.
  const hideMovement = async (m) => {
    if (busyKey) return;
    const ok = await confirmDialog({
      title: 'הסתרת שורה מהתצוגה',
      message: 'השורה תוסתר מרשימת התנועות — הנתון עצמו נשאר שמור במערכת (כולל סימון-המעקב הפנימי שמונע הורדה כפולה), והמלאי הנוכחי לא ישתנה.\n\nלהסתיר?',
      confirmLabel: 'הסתר',
    });
    if (!ok) return;
    setBusyKey(m.raw);
    try {
      const r = await authFetch(`/api/inventory/${item.id}/ledger-line/hide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: m.raw }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'שגיאה');
      setMovements((prev) => prev.filter((mv) => mv.raw !== m.raw));
      toast('השורה הוסתרה');
    } catch (e) {
      toast(`הסתרת השורה נכשלה: ${e.message || e}`, 'error');
    }
    setBusyKey(null);
  };

  // מחיקת הערה-חופשית — אמיתית (אין תגית לאבד): השרת מקבל רק את
  // הטקסט החופשי הרצוי ומדביק בעצמו את כל שורות-התנועה/הבקרה
  // העכשוויות (קריאה-מחדש-טרייה בתוך נעילה — ר' updateInventoryFreeNotes).
  const deleteFreeLine = async (idx) => {
    if (busyKey) return;
    const ok = await confirmDialog({
      title: 'מחיקת הערה',
      message: 'ההערה תימחק לצמיתות ולא ניתן לשחזר אותה.\n\nלמחוק?',
      confirmLabel: 'מחק',
      danger: true,
    });
    if (!ok) return;
    const next = freeLines.filter((_, i) => i !== idx);
    setBusyKey(`free:${idx}`);
    try {
      const r = await authFetch(`/api/inventory/${item.id}/notes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freeText: next.join('\n') }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'שגיאה');
      setFreeLines(next);
      toast('ההערה נמחקה');
    } catch (e) {
      toast(`מחיקת ההערה נכשלה: ${e.message || e}`, 'error');
    }
    setBusyKey(null);
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      {/* min(...) כדי לא לבטל את `max-width: 92vw` של `.drawer` — maxWidth
          אינליין גובר על ה-CSS, ובמסך של ~650px הדרואר היה משתלט כמעט על כולו */}
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(720px, 92vw)' }}>
        <div className="drawer-header">
          <span>📜 היסטוריית ירידות · {item['קטגוריה'] || 'פריט מלאי'}</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="סגירה" title="סגירה">✕</button>
        </div>
        <div className="drawer-body">
          <div className="card">
            {movements.length === 0 ? (
              <div className="empty-state">אין תנועות מתועדות עדיין</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>תאריך</th><th>מסמך</th><th>כמות</th><th>ממה נגזר</th><th>הערה</th>{canEdit && <th></th>}</tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => (
                      // ⚠️ 7.10.2026 (לילה 3), אומת: שורה בפורמט ישן/חריג
                      // (שמתחילה ב-↓/↩/⚠ אבל לא נפרסת) חזרה כ-kind:'unknown'
                      // עם quantity=undefined ו-sourceLabel=undefined, ונוצרה
                      // שורת-טבלה חסרת-משמעות: "−", "לא זמין", "—" בכל עמודה —
                      // כלומר הטקסט האמיתי של השורה **נעלם מהמשתמשת לגמרי**.
                      // שורה כזו מוצגת עכשיו כפי שהיא, מסומנת "לא מזוהה".
                      m.kind === 'unknown' ? (
                        <tr key={i}>
                          <td>{m.date ? formatDate(m.date) : <span className="muted">—</span>}</td>
                          <td colSpan={3} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.raw}</td>
                          <td><span className="badge badge-warn" style={{ fontSize: 12 }}>שורה בפורמט לא מזוהה</span></td>
                          {canEdit && (
                            <td>
                              <button type="button" className="btn btn-sm btn-ghost" aria-label="הסתרת שורה" title="הסתרת שורה מהתצוגה"
                                style={{ color: 'var(--error)' }} disabled={busyKey === m.raw} onClick={() => hideMovement(m)}>🗑</button>
                            </td>
                          )}
                        </tr>
                      ) : (
                      <tr key={i}>
                        {/* תאריך: שורות-הוצאה אינן נושאות תאריך-שורה (ר' LEADING_DATE_RE
                            ב-inventoryLedger.js) אבל כן את תאריך-המסמך — עדיף אותו על "—" */}
                        <td>{(m.date || m.docDate) ? formatDate(m.date || m.docDate) : <span className="muted">—</span>}</td>
                        <td>
                          {m.link ? (
                            <span className="obj-chip" {...activatable(() => navigate(m.link), `פתיחת ${m.sourceLabel || 'המסמך'}`)}>
                              {m.sourceLabel}
                            </span>
                          ) : (m.sourceLabel || <span className="muted">לא זמין</span>)}
                        </td>
                        {/* dir="ltr" כדי שסימן ה-+/− יישאר צמוד למספר ולא "ייזרק" לקצה
                            השני של התא בהקשר RTL — הסימן הוא ההבדל בין החזרה לירידה */}
                        {/* סעיף Z: היחידה שנרשמה בשורה עצמה (m.unit) מוצגת לצד
                            הכמות. שורה בלי יחידה (היסטורית, או פריט שאין לו
                            יחידה מוגדרת) מוצגת כמו קודם — בלי טקסט נוסף. */}
                        <td style={{ color: m.kind === 'reversal' ? 'var(--ok)' : undefined, fontWeight: 600 }}>
                          <span dir="ltr">{m.kind === 'reversal' ? '+' : '−'}{formatNumber(m.quantity)}</span>
                          {m.unit && <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> {m.unit}</span>}
                        </td>
                        <td>{m.derivedFrom || <span className="muted">—</span>}</td>
                        {/* ביטול-הורדה הוא תוצאה תקינה (מלאי הוחזר), לא אזהרה — badge-warn
                            כתום נשמר רק לאי-התאמה/דורש-אישור אמיתיים */}
                        <td>
                          {m.kind === 'reversal' ? <span className="muted">{m.warning || 'בוטל במחיקת מסמך'}</span>
                            : m.warning ? <span className="badge badge-warn">{m.warning}</span>
                              : <span className="muted">—</span>}
                        </td>
                        {canEdit && (
                          <td>
                            <button type="button" className="btn btn-sm btn-ghost" aria-label="הסתרת שורה" title="הסתרת שורה מהתצוגה"
                              style={{ color: 'var(--error)' }} disabled={busyKey === m.raw} onClick={() => hideMovement(m)}>🗑</button>
                          </td>
                        )}
                      </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hiddenCount > 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {hiddenCount === 1 ? 'שורה אחת הוסתרה' : `${hiddenCount} שורות הוסתרו`} מהתצוגה (הנתון נשאר שמור)
              </div>
            )}
          </div>
          {freeLines.length > 0 && (
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>הערות ידניות</div>
              {freeLines.map((line, i) => (
                <div key={i} className="obj-row" style={{ alignItems: 'flex-start' }}>
                  <span className="obj-row-value" style={{ whiteSpace: 'pre-wrap', flex: 1 }}>{line}</span>
                  {canEdit && (
                    <button type="button" className="btn btn-sm btn-ghost" aria-label="מחיקת הערה" title="מחיקת הערה"
                      style={{ color: 'var(--error)' }} disabled={busyKey === `free:${i}`} onClick={() => deleteFreeLine(i)}>🗑</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
