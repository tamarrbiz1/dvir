// ============================================================
// בורר תקופה אחיד — אותו <select> כמו בלוח הבקרה, ושדות תאריך
// שמופיעים רק ב"טווח מותאם". כל מסך עם KPI/גרף משתמש בו, כדי שכל
// מספר במערכת יציין איזו תקופה הוא מכסה.
// ============================================================
import { PERIOD_PRESETS } from '../utils/period.js';

export default function PeriodSelect({ preset, from, to, onPreset, onFrom, onTo, presets = PERIOD_PRESETS }) {
  return (
    <>
      <select className="select" aria-label="בחירת תקופה" value={preset} onChange={(e) => onPreset(e.target.value)}>
        {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {preset === 'custom' && (
        <>
          <label className="date-field">מתאריך<input type="date" className="input" value={from} onChange={(e) => onFrom(e.target.value)} /></label>
          <label className="date-field">עד תאריך<input type="date" className="input" value={to} onChange={(e) => onTo(e.target.value)} /></label>
        </>
      )}
    </>
  );
}
