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

// ============================================================
// הורדת מלאי נגזרת מתעודות משלוח/חשבוניות (תוספת 2026-10-06, סעיף D) —
// שונה מ-[מלאי-AI] של הוצאות: אין state על המסמך המקור (אין שדה
// "הערות" בטבלאות האלה), אז המצב מגיע משרת-בלבד (in-memory), דרך
// GET /api/logistics/<table>/status — ר' server.js. תוצאה אחת לכל
// מסמך, shape = { weekCode, cartonsCrossCheck, results, attempt, at }.
// ============================================================
export function logisticsAiSummary(status) {
  if (!status) return null;
  const results = Array.isArray(status.results) ? status.results : [];
  if (!results.length) return { kind: 'none', text: 'אין נתון לגזור ממנו עדיין' };
  const pending = results.filter((r) => r.pending);
  if (pending.length === results.length) return { kind: 'pending', text: 'ממתין לנתוני ניתוח (Make)' };
  const needsApproval = results.filter((r) => r.needsApproval);
  if (needsApproval.length) return { kind: 'warn', text: `${needsApproval.length} דורש אישור` };
  const missingItem = results.find((r) => r.skipped === 'אין פריט מלאי בקטגוריה הזו');
  if (missingItem) return { kind: 'warn', text: `אין פריט מלאי בקטגוריית "${missingItem.category}"` };
  const deducted = results.filter((r) => r.deducted);
  if (deducted.length) return { kind: 'ok', text: `הורדה מ-${deducted.length} קטגוריות` };
  return { kind: 'none', text: 'אין פעולה' };
}
