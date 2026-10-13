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

// ============================================================
// הסתרת הסמן הפנימי מהצגה למשתמש (סעיף R, 2026-10-07) — שדה "הערות"
// של הוצאה יכול להכיל שורת-JSON גולמית [מלאי-AI]{...} (ר' MARKER_RE
// למעלה) ו/או תגית [מלאי-D:<table>:<id>:<קטגוריה>] (ר' logistics-
// deduction.js, בשימוש על הערות של פריט-מלאי — נתמך כאן גם-כן ליתר
// ביטחון). הפונקציה מסירה אותן **לתצוגה בלבד** — לעולם אין להשתמש בה
// לפני כתיבה חזרה ל-Airtable (ר' withPreservedInventoryTags למטה,
// ששומרת את התגיות בדיוק כפי שהיו כשעורכים את הטקסט החופשי).
// ============================================================
const AI_MARKER_LINE_RE = /^\[מלאי-AI\]\{.*\}$/;
const D_TAG_LINE_RE = /^\[מלאי-D:[^\]]+\]$/;

/** מסיר שורות-סמן פנימיות מתוך "הערות" — לתצוגה בלבד, לעולם לא לפני שמירה */
export function stripInventoryAiMarker(notes) {
  const text = String(notes || '');
  if (!text) return '';
  const kept = text.split('\n').filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (AI_MARKER_LINE_RE.test(t)) return false;
    if (D_TAG_LINE_RE.test(t)) return false;
    return true;
  });
  // הסרה בטוחה גם אם התגית מוטמעת בתוך שורה (לא אמור לקרות בפורמט
  // הנוכחי, אבל לא מזיק כרשת-ביטחון)
  return kept.join('\n').replace(MARKER_RE, '').trim();
}

/**
 * בונה מחדש את ערך "הערות" המלא לשמירה: משמר את שורות-הסמן בדיוק כפי
 * שהיו (לא נוגע בהן), ומחליף רק את החלק החופשי בטקסט שהמשתמש ערך.
 * משמש כשיש עריכה של הטקסט החופשי בלבד (למשל טופס עריכת הערות) —
 * לעולם אין לאבד את התגיות, גם אם המשתמש מחק את כל הטקסט החופשי.
 */
export function withPreservedInventoryTags(originalNotes, newFreeText) {
  const text = String(originalNotes || '');
  const tagLines = text.split('\n').filter((line) => {
    const t = line.trim();
    return AI_MARKER_LINE_RE.test(t) || D_TAG_LINE_RE.test(t);
  });
  const free = String(newFreeText || '').trim();
  if (!tagLines.length) return free;
  return free ? `${free}\n${tagLines.join('\n')}` : tagLines.join('\n');
}

// ============================================================
// משימה AD (12.10.2026) — "ממתין להשלמה"
// ------------------------------------------------------------
// שעת-הניסיון-הבא מוצגת כשעה מקומית בלבד (HH:MM) ולא כ"בעוד N דקות":
// הכרטיס אינו מתרענן מעצמו, ולכן "בעוד 10 דקות" היה הופך לשקר אחרי
// רגע, בעוד ש-"~14:35" נשאר נכון.
// ============================================================
export function retryTimeLabel(state) {
  const at = Number(state?.retry?.nextAt);
  if (!Number.isFinite(at) || at <= 0) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** הטקסט המלא של מצב-ההמתנה — אותו נוסח בכרטיס ובתג הקומפקטי */
export function waitingText(state) {
  const when = retryTimeLabel(state);
  const base = state?.retry?.code === 'TEMPORARY'
    ? 'הניתוח לא זמין כרגע — ינסה שוב אוטומטית'
    : 'ממתין לחידוש מכסת הניתוח — ינסה שוב אוטומטית';
  return when ? `${base} (~${when})` : base;
}

/** תיאור קצר למצב (לתג קומפקטי בטבלה) */
export function inventoryAiSummary(state) {
  if (!state) return null;
  // משימה AD: המתנה אינה כשל — לכן kind 'pending' ולא 'error'.
  if (state.status === 'waiting') return { kind: 'pending', text: waitingText(state) };
  // סעיף V2 (8.10.2026): כשל-ניתוח אינו "לא נמצאו פריטים" — מוצגת הודעה
  // ידידותית שמבהירה שזו תקלה זמנית ושכדאי לנסות שוב ("נתח מחדש").
  if (state.status === 'failed') return { kind: 'error', text: state.error || 'הניתוח לא זמין כרגע — נסו שוב מאוחר יותר' };
  const results = Array.isArray(state.results) ? state.results : [];
  const deducted = results.filter((r) => r.deducted);
  const pending = results.filter((r) => r.needsApproval && !r.deducted);
  if (!results.length) {
    // AM-2 (13.10.2026): "לא נמצאו פריטי מלאי במסמך" נקרא כמו "הניתוח
    // נכשל", ובפועל זה היה המצב ההפוך — ב-#174 ה-AI קרא 25 שורות
    // מושלם, ואף אחת מהן לא הייתה אחת מקטגוריות המלאי. עכשיו ההודעה
    // אומרת **מה כן נקרא**, כדי שתמר תדע שהמסמך נותח ושההחלטה
    // (להוסיף פריט-מלאי) היא שלה. ר' inventory-deduction.js.
    const u = state.unmatched;
    if (u?.count) {
      return {
        kind: 'none',
        text: `נקראו ${u.totalLines} שורות, אף אחת אינה פריט מלאי`,
        detail: `הניתוח קרא את המסמך במלואו. ${u.count} מתוך ${u.totalLines} השורות אינן שייכות לאף אחת מקטגוריות המלאי הקיימות (${(u.knownCategories || []).join(', ')}).`,
        unmatched: u.samples || [],
      };
    }
    return { kind: 'none', text: 'לא נמצאו פריטי מלאי במסמך' };
  }
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
  if (deducted.length) {
    // סעיף N1 (2026-10-07): משטחים יורדים תמיד מהחשבונית, גם בלי התאמה
    // לתעודת המשלוח — התאמה-חסרה מסומנת softWarning, לא needsApproval,
    // כי ההורדה מתבצעת בכל זאת. עדיין חשוב להראות לתמר שהייתה אי-התאמה.
    const mismatched = deducted.filter((r) => r.softWarning);
    if (mismatched.length) return { kind: 'warn', text: `הורדה מ-${deducted.length} קטגוריות — ${mismatched.map((r) => r.reason).filter(Boolean).join(' · ') || 'אין התאמה לתעודת המשלוח'}` };
    return { kind: 'ok', text: `הורדה מ-${deducted.length} קטגוריות` };
  }
  return { kind: 'none', text: 'אין פעולה' };
}
