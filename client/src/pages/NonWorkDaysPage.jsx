import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../App.jsx';
import { formatDate, safeValue } from '../utils/format.js';

// ============================================================
// ימי אי עבודה (סעיף 41)
//
// ימי אי העבודה מנוהלים ב-Airtable ומשמשים אותו לחישובי לוחות
// העבודה וההזזות. Zite מציג ומוסיף בלבד — אינו מחשב מחדש.
//
// "סוג החג" הוא שדה singleSelect עם אפשרויות קבועות ב-Airtable.
// כתיבת ערך שאינו ברשימה נדחית על ידי Airtable, ולכן האפשרויות
// נטענות מהמטא ולא נכתבות בקוד.
// ============================================================

const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

/** תאריך מקומי ל-YYYY-MM-DD, בלי הסטת אזור זמן */
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function NonWorkDaysPage() {
  const app = useApp();
  const [items, setItems] = useState([]);
  const [holidayTypes, setHolidayTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addType, setAddType] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const rows = await app.api.get('ימי אי עבודה', '?maxRecords=500');
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setLoadError(e.message || 'לא ניתן היה לטעון את ימי אי העבודה.');
    }
    setLoading(false);
  }, [app.api]);

  useEffect(() => { load(); }, [load]);

  // אפשרויות "סוג החג" נטענות מ-Airtable — לא מקודדות בקוד
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/select-options/${encodeURIComponent('ימי אי עבודה')}/${encodeURIComponent('סוג החג')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('meta'))))
      .then((data) => {
        if (cancelled) return;
        const choices = Array.isArray(data.choices) ? data.choices : [];
        setHolidayTypes(choices);
        setAddType((current) => current || choices[0] || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const yearsAvailable = useMemo(() => {
    const set = new Set(items.map((i) => String(i['תאריך'] || '').slice(0, 4)).filter(Boolean));
    set.add(String(new Date().getFullYear()));
    return [...set].filter(Boolean).sort();
  }, [items]);

  const visible = useMemo(
    () => items
      .filter((i) => String(i['תאריך'] || '').slice(0, 4) === String(year))
      .sort((a, b) => String(b['תאריך']).localeCompare(String(a['תאריך']))),
    [items, year]
  );

  const existingDates = useMemo(
    () => new Set(items.map((i) => String(i['תאריך'] || '').slice(0, 10))),
    [items]
  );

  const addDay = async () => {
    if (!addDate || !addType || saving) return;
    setSaving(true);
    setFormError('');
    try {
      await app.api.create('ימי אי עבודה', { 'תאריך': addDate, 'סוג החג': addType });
      setAddDate('');
      setShowAdd(false);
      await load();
    } catch (e) {
      setFormError(`לא ניתן היה להשלים את הפעולה. הנתונים לא עודכנו. (${e.message || e})`);
    }
    setSaving(false);
  };

  /**
   * ייבוא שבתות השנה. כל כישלון נספר ומדווח — אין לדווח הצלחה
   * על פעולה שלא בוצעה.
   */
  const importSaturdays = async () => {
    if (importing) return;
    const type = holidayTypes.find((t) => t.includes('יהוד')) || holidayTypes[0];
    if (!type) {
      setNotice('לא ניתן לייבא — רשימת סוגי החג אינה זמינה.');
      return;
    }

    setImporting(true);
    setNotice('');

    const saturdays = [];
    const cursor = new Date(Number(year), 0, 1);
    while (cursor.getFullYear() === Number(year)) {
      if (cursor.getDay() === 6) saturdays.push(toISO(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const missing = saturdays.filter((iso) => !existingDates.has(iso));
    let created = 0;
    let failed = 0;
    for (const iso of missing) {
      try {
        await app.api.create('ימי אי עבודה', { 'תאריך': iso, 'סוג החג': type });
        created++;
      } catch {
        failed++;
      }
    }

    setImporting(false);
    if (!missing.length) setNotice(`כל השבתות של ${year} כבר קיימות במערכת.`);
    else if (failed) setNotice(`נוספו ${created} שבתות. ${failed} נכשלו ולא נשמרו.`);
    else setNotice(`נוספו ${created} שבתות לשנת ${year}.`);
    await load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>ימי אי עבודה — {year}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="select" value={year} onChange={(e) => { setYear(e.target.value); setNotice(''); }}>
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn-primary" disabled={!holidayTypes.length}
            onClick={() => { setFormError(''); setShowAdd(true); }}>
            + הוסף יום
          </button>
          <button className="btn btn-ghost" disabled={importing || !holidayTypes.length} onClick={importSaturdays}>
            {importing ? 'מייבא...' : `ייבא שבתות ${year}`}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        ימים אלו משמשים את Airtable לחישוב לוחות העבודה והזזת התוכניות. Zite אינו מחשב אותם מחדש.
      </div>

      {loadError && <div className="badge badge-error" style={{ marginBottom: 14 }}>⚠️ {loadError}</div>}
      {notice && (
        <div className="badge" style={{ marginBottom: 14, background: 'var(--docs-soft)' }}>
          {notice}
        </div>
      )}

      {loading ? <div className="skeleton skeleton-card" /> : (
        <div className="card">
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            {visible.length} ימי אי עבודה בשנת {year}
          </div>
          {visible.length === 0 ? (
            <div className="empty-state">אין ימי אי עבודה לשנה זו.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>תאריך</th><th>יום</th><th>חודש</th><th>סוג החג</th></tr></thead>
                <tbody>
                  {visible.map((it) => {
                    const raw = String(it['תאריך'] || '');
                    const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
                    const date = y && m && d ? new Date(y, m - 1, d) : null;
                    return (
                      <tr key={it.id}>
                        <td>{formatDate(it['תאריך'])}</td>
                        <td>{date ? date.toLocaleDateString('he-IL', { weekday: 'long' }) : 'לא זמין'}</td>
                        <td>{m ? MONTHS[m - 1] : 'לא זמין'}</td>
                        <td>
                          <span className="badge" style={{ background: 'var(--q3)' }}>
                            {safeValue(it['סוג החג'])}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={() => !saving && setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>הוסף יום אי עבודה</h3>
            {formError && <div className="badge badge-error" style={{ marginBottom: 12 }}>⚠️ {formError}</div>}
            <form onSubmit={(e) => { e.preventDefault(); addDay(); }}>
              <div className="form-group">
                <label>תאריך <span className="required">*</span></label>
                <input type="date" className="input" style={{ width: '100%' }} required
                  value={addDate} onChange={(e) => setAddDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>סוג החג <span className="required">*</span></label>
                <select className="select" style={{ width: '100%' }} required
                  value={addType} onChange={(e) => setAddType(e.target.value)}>
                  {holidayTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setShowAdd(false)}>ביטול</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !addDate || !addType}>
                  {saving ? 'שומר...' : 'שמור'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
