// ============================================================
// ניתוח מלאי אוטומטי להוצאה — קריאת הסמן [מלאי-AI] מתוך שדה "הערות"
// (ר' server/src/inventory-deduction.js — אותו פורמט בדיוק, שורה
// אחת JSON עם קידומת קבועה, בלי לדרוס תוכן אחר בשדה).
// ============================================================
const MARKER_RE = /\[מלאי-AI\](\{[^\n]*\})/;

export function readInventoryAiState(notes) {
  const m = String(notes || '').match(MARKER_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** תיאור קצר למצב (לתג קומפקטי בטבלה) */
export function inventoryAiSummary(state) {
  if (!state) return null;
  if (state.status === 'failed') return { kind: 'error', text: 'ניתוח מלאי נכשל' };
  const results = Array.isArray(state.results) ? state.results : [];
  const deducted = results.filter((r) => r.deducted);
  const pending = results.filter((r) => r.needsApproval && !r.deducted);
  if (!results.length) return { kind: 'none', text: 'לא נמצאו פריטי מלאי במסמך' };
  if (pending.length) return { kind: 'warn', text: `${pending.length} ממתין לאישור` };
  return { kind: 'ok', text: `הורדה מ-${deducted.length} פריטים` };
}
