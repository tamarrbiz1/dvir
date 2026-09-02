import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatDate } from '../utils/format.js';
import { holidayInfo, jewishHolidaysOfYear, thaiHolidaysOfYear, kindOf, KIND_STYLE, toISO } from '../utils/holidays.js';
import { confirmDialog, toast } from '../utils/ui.js';
import PageHeader from '../components/PageHeader.jsx';

// ============================================================
// ימי אי עבודה (סעיף 41) — רשימה + לוח שנתי
//
// ימי אי העבודה מנוהלים ב-Airtable ומשמשים אותו לחישובי לוחות
// העבודה וההזזות. Zite מציג, מוסיף, מעדכן ומוחק — אינו מחשב מחדש.
//
// "סוג החג" הוא singleSelect ב-Airtable (יהודי / תילאנדי); האפשרויות
// נטענות מהמטא כדי שלא ייכתב ערך שאינו ברשימה.
// ============================================================

const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const parseISO = (s) => {
  const [y, m, d] = String(s || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

export default function NonWorkDaysPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [holidayTypes, setHolidayTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState(null); // {id?, date, type}
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const yearValid = /^\d{4}$/.test(year);
  // שנה בטוחה לחישובים (לוח שנה וכו') — נופלת לשנה הנוכחית כל עוד המשתמש עדיין מקליד שנה לא-שלמה
  const yearNum = yearValid ? Number(year) : new Date().getFullYear();
  const [view, setView] = useState('list');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null); // {label, type, items:[{iso,he,checked}]}
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const rows = await app.api.get('ימי אי עבודה', '?maxRecords=1000');
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setLoadError(e.message || 'לא ניתן היה לטעון את ימי אי העבודה.');
    }
    setLoading(false);
  }, [app.api]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/select-options/${encodeURIComponent('ימי אי עבודה')}/${encodeURIComponent('סוג החג')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('meta'))))
      .then((data) => { if (!cancelled) setHolidayTypes(Array.isArray(data.choices) ? data.choices : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const jewishType = holidayTypes.find((t) => kindOf(t) === 'jewish') || '';
  const thaiType = holidayTypes.find((t) => kindOf(t) === 'thai') || '';

  const visible = useMemo(
    () => items
      .filter((i) => String(i['תאריך'] || '').slice(0, 4) === String(year))
      .sort((a, b) => String(a['תאריך']).localeCompare(String(b['תאריך']))),
    [items, year]
  );

  const byDate = useMemo(() => {
    const m = new Map();
    for (const i of items) m.set(String(i['תאריך'] || '').slice(0, 10), i);
    return m;
  }, [items]);

  // ---------- כתיבה ----------
  const saveForm = async () => {
    if (!form?.date || !form?.type || saving) return;
    setSaving(true); setFormError('');
    try {
      if (form.id) await app.api.update('ימי אי עבודה', form.id, { 'תאריך': form.date, 'סוג החג': form.type });
      else await app.api.create('ימי אי עבודה', { 'תאריך': form.date, 'סוג החג': form.type });
      setForm(null);
      await load();
    } catch (e) {
      setFormError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
    }
    setSaving(false);
  };

  const remove = async (it) => {
    if (saving) return;
    const info = holidayInfo(parseISO(it['תאריך']) || new Date(), it);
    const yes = await confirmDialog({
      title: `מחיקת ${formatDate(it['תאריך'])} (${info?.name.he || 'יום אי עבודה'})`,
      message: 'הפריט ימחק ולא יינתן לשחזור.\nהאם אתה בטוח שברצונך לבצע פעולה זו?',
      confirmLabel: 'מחק', danger: true,
    });
    if (!yes) return;
    setSaving(true); setNotice('');
    try { await app.api.remove('ימי אי עבודה', it.id); await load(); }
    catch (e) { setNotice(`המחיקה נכשלה: ${e.message || e}`); }
    setSaving(false);
  };

  /** ייבוא: קודם תצוגה מקדימה עם בחירת ימים — הייבוא מוסיף רק לרשימה כאן */
  const openImportPreview = (list, type, label) => {
    if (importing) return;
    if (!type) { setNotice(`לא ניתן לייבא — סוג החג "${label}" אינו קיים ברשימת האפשרויות.`); return; }
    const missing = list.filter((h) => !byDate.has(h.iso));
    if (!missing.length) { setNotice(`כל ${label} של ${year} כבר קיימים ברשימה.`); return; }
    setNotice('');
    setPreview({
      label,
      type,
      // ערבי חג אינם מסומנים כברירת מחדל — הבחירה בידי הלקוח
      items: missing.map((h) => ({ ...h, checked: !String(h.he || '').startsWith('ערב') })),
    });
  };

  const runImport = async () => {
    if (!preview || importing) return;
    const chosen = preview.items.filter((i) => i.checked);
    if (!chosen.length) { setPreview(null); return; }
    setImporting(true);
    try {
      // יצירה קבוצתית — בקשה אחת במקום בקשה לכל יום
      await app.api.create('ימי אי עבודה', chosen.map((h) => ({ 'תאריך': h.iso, 'סוג החג': preview.type })));
      setNotice(`נוספו ${chosen.length} ימים — ${preview.label} ${year}. התוכנית תתעדכן רק כשתבחרו בכך במסך תוכנית השתילה.`);
    } catch (e) {
      setNotice(`הייבוא נכשל: ${e.message || e}`);
    }
    setImporting(false);
    setPreview(null);
    await load();
  };

  // ימי שישי — יום המנוחה במשק (עובדים במוצאי שבת, לכן שבתות אינן מיובאות)
  const fridaysOfYear = () => {
    const out = [];
    const d = new Date(yearNum, 0, 1);
    while (d.getFullYear() === yearNum) { if (d.getDay() === 5) out.push({ iso: toISO(d), he: 'יום שישי' }); d.setDate(d.getDate() + 1); }
    return out;
  };

  const openAdd = (date = '') => { setFormError(''); setForm({ id: null, date, type: jewishType || holidayTypes[0] || '' }); };
  const openEdit = (it) => { setFormError(''); setForm({ id: it.id, date: String(it['תאריך'] || '').slice(0, 10), type: it['סוג החג'] || '' }); };

  const counts = useMemo(() => {
    const c = { jewish: 0, thai: 0, other: 0 };
    visible.forEach((i) => { c[kindOf(i['סוג החג'])] = (c[kindOf(i['סוג החג'])] || 0) + 1; });
    return c;
  }, [visible]);

  return (
    <div>
      <PageHeader icon="🗓️" title={`ימי אי עבודה — ${year}`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input" style={{ width: 90, textAlign: 'center' }}
            aria-label="שנה" title="שנה" type="text" inputMode="numeric" pattern="\d{4}" maxLength={4}
            value={year}
            onChange={(e) => { setYear(e.target.value.replace(/\D/g, '').slice(0, 4)); setNotice(''); }}
          />
          <button className="btn btn-primary" disabled={!holidayTypes.length} onClick={() => openAdd()}>+ הוסף יום</button>
          <button className="btn btn-ghost" disabled={importing || !jewishType || !yearValid} onClick={() => openImportPreview(jewishHolidaysOfYear(yearNum), jewishType, 'חגי ישראל')}>
            {importing ? 'מייבא...' : `✡️ ייבא חגי ישראל ${year}`}
          </button>
          <button className="btn btn-ghost" disabled={importing || !thaiType || !yearValid} onClick={() => openImportPreview(thaiHolidaysOfYear(yearNum), thaiType, 'חגי תאילנד')}>
            🇹🇭 ייבא חגי תאילנד
          </button>
          <button className="btn btn-ghost" disabled={importing || !jewishType || !yearValid} onClick={() => openImportPreview(fridaysOfYear(), jewishType, 'ימי שישי')}>
            🕯️ ייבא ימי שישי
          </button>
          {!yearValid && <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>יש להקליד שנה בת 4 ספרות</span>}
        </div>
      </PageHeader>

      {preview && (
        <div className="modal-overlay" onClick={() => !importing && setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>ייבוא {preview.label} — {year}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, textAlign: 'center' }}>
              בחרו אילו ימים להוסיף לרשימה. ({preview.items.filter((i) => i.checked).length} מתוך {preview.items.length} מסומנים)
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 10 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreview({ ...preview, items: preview.items.map((i) => ({ ...i, checked: true })) })}>בחר הכל</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPreview({ ...preview, items: preview.items.map((i) => ({ ...i, checked: false })) })}>נקה הכל</button>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 12px' }}>
              {preview.items.map((it, idx) => (
                <label key={it.iso} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={it.checked}
                    onChange={(e) => setPreview({ ...preview, items: preview.items.map((x, j) => (j === idx ? { ...x, checked: e.target.checked } : x)) })} />
                  <b style={{ minWidth: 86 }}>{formatDate(it.iso)}</b>
                  <span>{it.he || preview.label}</span>
                </label>
              ))}
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" disabled={importing} onClick={() => setPreview(null)}>ביטול</button>
              <button type="button" className="btn btn-primary" disabled={importing || !preview.items.some((i) => i.checked)} onClick={runImport}>
                {importing ? 'מייבא...' : `ייבא ${preview.items.filter((i) => i.checked).length} ימים`}
              </button>
            </div>
          </div>
        </div>
      )}


      {loadError && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {loadError}</div>}
      {notice && <div className="badge" style={{ marginBottom: 14, background: 'var(--docs-soft)' }}>{notice}</div>}

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {[['jewish', counts.jewish], ['thai', counts.thai]].map(([k, v]) => (
          <div key={k} className="kpi-card">
            <div className="kpi-top"><div className="kpi-icon" style={{ background: KIND_STYLE[k].bg }}>{k === 'jewish' ? '✡️' : '🇹🇭'}</div><span className="kpi-label">{KIND_STYLE[k].label} — {year}</span></div>
            <div className="kpi-value" style={{ color: KIND_STYLE[k].border }}>{v}</div>
          </div>
        ))}
        <div className="kpi-card">
          <div className="kpi-top"><div className="kpi-icon" style={{ background: 'var(--bg-secondary)' }}>🗓️</div><span className="kpi-label">סה"כ ימי אי עבודה</span></div>
          <div className="kpi-value">{visible.length}</div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>📄 רשימה</button>
        <button className={`tab ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>📅 לוח שנתי</button>
      </div>

      {loading ? <div className="skeleton skeleton-card" /> : view === 'list' ? (
        <div className="card">
          {visible.length === 0 ? (
            <div className="empty-state">אין ימי אי עבודה לשנה זו.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>תאריך</th><th>יום</th><th>חג</th><th>סוג החג</th><th>פעולות</th></tr></thead>
                <tbody>
                  {visible.map((it) => {
                    const date = parseISO(it['תאריך']);
                    const info = date ? holidayInfo(date, it) : null;
                    return (
                      <tr key={it.id} style={{ cursor: 'default' }}>
                        <td><b>{formatDate(it['תאריך'])}</b></td>
                        <td>{date ? date.toLocaleDateString('he-IL', { weekday: 'long' }) : 'לא זמין'}</td>
                        <td>{info?.name.he || 'לא זמין'}</td>
                        <td>{info ? <span className="badge" style={{ background: info.style.bg, color: info.style.border }}>{it['סוג החג'] || 'לא זמין'}</span> : 'לא זמין'}</td>
                        <td>
                          <button className="btn btn-sm btn-ghost" aria-label="עריכה" title="עריכה" disabled={saving} onClick={() => openEdit(it)}>✎</button>
                          <button className="btn btn-sm btn-ghost" aria-label="מחיקה" title="מחיקה" style={{ color: 'var(--error)' }} disabled={saving} onClick={() => remove(it)}>🗑</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <YearCalendar year={yearNum} byDate={byDate} onDay={(iso, rec) => (rec ? openEdit(rec) : openAdd(iso))} />
      )}

      {form && (
        <div className="modal-overlay" onClick={() => !saving && setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? 'עריכת יום אי עבודה' : 'הוסף יום אי עבודה'}</h3>
            {formError && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {formError}</div>}
            <form onSubmit={(e) => { e.preventDefault(); saveForm(); }}>
              <div className="form-group">
                <label>תאריך <span className="required" /></label>
                <input type="date" className="input" style={{ width: '100%' }} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                {form.date && (() => { const d = parseISO(form.date); const i = d && holidayInfo(d, { 'סוג החג': form.type }); return i ? <div style={{ fontSize: 12, color: i.style.border, marginTop: 4 }}>{i.name.he}</div> : null; })()}
              </div>
              <div className="form-group">
                <label>סוג החג <span className="required" /></label>
                <select className="select" style={{ width: '100%' }} required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="">בחר...</option>
                  {holidayTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-actions">
                {form.id && <button type="button" className="btn btn-danger" disabled={saving} onClick={() => { const it = items.find((x) => x.id === form.id); setForm(null); if (it) remove(it); }}>מחק</button>}
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setForm(null)}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.date || !form.type}>{saving ? 'שומר...' : 'שמור'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** לוח שנתי — 12 חודשים, תא מלא צבוע לפי סוג החג, עם שם החג ב-tooltip */
function YearCalendar({ year, byDate, onDay }) {
  const today = toISO(new Date());
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        {['shabbat', 'jewish', 'thai'].map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, background: KIND_STYLE[k].bg, border: `2px solid ${KIND_STYLE[k].border}`, borderRadius: 3 }} />{KIND_STYLE[k].label}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
        {MONTHS.map((name, m) => {
          const count = new Date(year, m + 1, 0).getDate();
          const lead = new Date(year, m, 1).getDay();
          return (
            <div key={m} className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 11 }}>
                {DAYS.map((d) => <div key={d} style={{ textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>{d}</div>)}
                {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: count }, (_, i) => new Date(year, m, i + 1)).map((d) => {
                  const iso = toISO(d);
                  const rec = byDate.get(iso);
                  const info = holidayInfo(d, rec);
                  return (
                    <div key={iso} onClick={() => onDay(iso, rec)} title={info ? info.name.he : undefined}
                      style={{
                        aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, cursor: 'pointer',
                        background: info ? info.style.bg : 'transparent',
                        border: `${rec ? 2 : 1}px solid ${info ? info.style.border : 'transparent'}`,
                        outline: iso === today ? '2px solid var(--accent-top)' : 'none',
                        fontWeight: info ? 700 : 400, color: info ? info.style.border : 'var(--text-main)',
                      }}>
                      {d.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
