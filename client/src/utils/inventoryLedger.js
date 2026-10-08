// ============================================================
// פרסר יומן-ירידות למלאי (סעיף P2, 2026-10-07) — מפרק את שדה "הערות"
// של פריט-מלאי לשורות-תנועה מובנות, לפי שני הפורמטים הקיימים:
//
// 1) logistics-deduction.js (תעודות משלוח/חשבוניות) — יש תגית
//    [מלאי-D:<table>:<id>:<category>] שמאפשרת קישור ישיר-לפי-מזהה:
//      "↓ <כמות> ממלאי: <קטגוריה> (<sourceLabel>, שבוע <week>[ · <derivedFrom>])[ — <mismatchNote>] [תגית]"
//      "↩ ביטול הורדה של <כמות> · <table> <id> נמחק · <תאריך> [תגית]"
//      "⚠ דורש אישור: <כמות> <קטגוריה> (<sourceLabel>, שבוע <week>) — <reason>[ תגית]" —
//        פורמט-ישן (לפני התיקון של 2026-10-06 אחה"צ), לרוב בלי תגית;
//        needsApproval כבר לא בשימוש בפועל אחרי N1 (משטחים כבר לא נחסמים),
//        אבל נתונים היסטוריים/עתידיים עדיין עשויים להכיל שורה כזו.
// 2) inventory-deduction.js (הוצאות, כולל הוצאה-ידנית) — בלי תגית בכלל
//    (ה-state לאידמפוטנטיות הוא JSON נפרד [מלאי-AI], לא בשורה עצמה):
//      "↓ <כמות> · הוצאה #<num> · <ספק> · <תאריך>[ · אושר ידנית]"
//      "↩ ביטול הורדה של <כמות> · הוצאה #<num> נמחקה · <תאריך>"
//
// אזהרה חשובה: אם משנים את הפורמט בשרת (logistics-deduction.js /
// inventory-deduction.js) — יש לעדכן גם את הפרסר כאן, וגם לוודא
// ש-reverseLogisticsDeduction/reverseInventoryDeduction (שמזהים שורות
// לפי regex דומה) עדיין עובדים.
// ============================================================

const TAG_RE = /\[מלאי-D:([^:]+):([^:]+):([^\]]+)\]\s*$/;
const EXPENSE_NUM_RE = /הוצאה\s*#(\S+)/;
const PAREN_RE = /\(([^)]*)\)/;

const ROUTE_BY_TABLE = {
  'הוצאות': { path: '/finance', buildQuery: (id) => `?tab=expenses&open=${encodeURIComponent(id)}` },
  'תעודות משלוח': { path: '/delivery-notes', buildQuery: (id) => `?open=${encodeURIComponent(id)}` },
  'חשבוניות': { path: '/invoices', buildQuery: (id) => `?open=${encodeURIComponent(id)}` },
};

/** כתובת-ניווט למסמך-המקור, אם ידוע מזהה-רשומה ישיר (לא רק מספר-תצוגה) */
export function documentLink(sourceTable, sourceId) {
  const route = ROUTE_BY_TABLE[sourceTable];
  if (!route || !sourceId) return null;
  return `${route.path}${route.buildQuery(sourceId)}`;
}

// תאריך ISO אופציונלי בתחילת שורה (תוספת-עתידית ל-deductOne/appendItemMovementNote —
// שורות קיימות היום לא כוללות זאת, יוצגו עם תאריך=null, ה-UI יציג "—")
const LEADING_DATE_RE = /^(\d{4}-\d{2}-\d{2})[T ]?[\d:.,Z]*\s+/;

function stripLeadingDate(line) {
  const m = LEADING_DATE_RE.exec(line);
  return m ? { date: m[1], rest: line.slice(m[0].length) } : { date: null, rest: line };
}

/**
 * מפצל שורת-הורדה-לוגיסטית לחלקיה עם **איזון סוגריים**, במקום regex
 * שנעצר ב-")" הראשון.
 * ⚠️ 7.10.2026 (לילה 3), אומת: שם-מסמך שמכיל סוגריים מקוננים — למשל
 * "(תעודה #4,5 (כפולה), שבוע ...)" — שבר את הפענוח (`[^)]*` נעצר
 * בסוגר הפנימי), והשורה כולה נפלה ל-kind:'unknown' ונעלמה מהיומן.
 * @returns {{qty:string, category:string, inParens:string, tail:string}|null}
 */
function splitLogisticsLine(body) {
  const head = /^↓\s*([\d.]+)\s*ממלאי:\s*([^(]*?)\s*\(/.exec(body);
  if (!head) return null;
  const open = head[0].length - 1; // מיקום ה-"(" עצמו
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '(') depth += 1;
    else if (body[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { qty: head[1], category: head[2], inParens: body.slice(open + 1, i), tail: body.slice(i + 1).trim() };
      }
    }
  }
  return null; // סוגריים לא מאוזנים — נופל ל-kind:'unknown' עם raw מוצג ב-UI
}

function parseDeductionLine(rawLine) {
  const { date, rest } = stripLeadingDate(rawLine);
  const tagMatch = TAG_RE.exec(rest);
  const body = tagMatch ? rest.slice(0, tagMatch.index).trim() : rest;

  // תבנית לוגיסטיקה: "↓ 328 ממלאי: קרטונים (תעודה #44, שבוע ...) ... "
  const logisticsMatch = splitLogisticsLine(body);
  if (logisticsMatch) {
    const { qty, category, inParens, tail } = logisticsMatch;
    // ⚠️ 7.10.2026 (לילה 3): פיצול לפי ',' הראשון חתך שם-מסמך שמכיל
    // פסיק ("תעודה #4,5" → "תעודה #4"). המפריד האמיתי בפורמט הוא
    // ", שבוע " — מפצלים לפיו, וכך פסיק בשם-המסמך נשמר במלואו.
    const weekSep = inParens.indexOf(', שבוע ');
    const sourceLabel = (weekSep >= 0 ? inParens.slice(0, weekSep) : inParens).trim();
    const weekInfo = weekSep >= 0 ? inParens.slice(weekSep + 2).trim() : ''; // "שבוע 20260926-20261001 · 328 קרטונים × 1"
    const derivedFrom = /·\s*(.+)$/.exec(weekInfo)?.[1]?.trim() || 'ישיר מהמסמך';
    const warning = tail.replace(/^—\s*/, '').replace(/⚠\s*בלי הצלבה/, 'בלי הצלבה (אין מסמך מקביל לשבוע)').trim() || null;
    return {
      kind: 'deduction',
      date,
      sourceTable: tagMatch ? tagMatch[1] : null,
      sourceId: tagMatch ? tagMatch[2] : null,
      category: category.trim(),
      sourceLabel,
      quantity: Number(qty),
      derivedFrom,
      warning: warning || null,
      link: tagMatch ? documentLink(tagMatch[1], tagMatch[2]) : null,
      raw: rawLine,
    };
  }

  // תבנית הוצאות: "↓ 20 · הוצאה #48 · גיניגר · 2026-09-16[ · אושר ידנית]"
  const expenseMatch = /^↓\s*([\d.]+)\s*·\s*הוצאה\s*#(\S+)\s*·\s*([^·]+?)\s*·\s*([^·]+?)(\s*·\s*אושר ידנית)?$/.exec(body);
  if (expenseMatch) {
    const [, qty, num, supplier, docDate, approved] = expenseMatch;
    return {
      kind: 'deduction',
      date,
      sourceTable: 'הוצאות',
      sourceId: null, // המספר-המוצג בלבד; מזהה-הרשומה נפתר ב-UI (resolveExpenseLinks) מול "מספר הוצאה"
      sourceNumber: num,
      category: null,
      sourceLabel: `הוצאה #${num}`,
      quantity: Number(qty),
      derivedFrom: approved ? 'אושר ידנית' : 'ישיר מהמסמך',
      warning: null,
      link: null, // יושלם ב-UI אחרי resolveExpenseLinks
      supplier: supplier.trim(),
      docDate: docDate.trim(),
      raw: rawLine,
    };
  }

  return { kind: 'unknown', date, raw: rawLine };
}

function parseReversalLine(rawLine) {
  const { date, rest } = stripLeadingDate(rawLine);
  const tagMatch = TAG_RE.exec(rest);
  const body = tagMatch ? rest.slice(0, tagMatch.index).trim() : rest;

  // "↩ ביטול הורדה של 450 · תעודות משלוח recXXX נמחק · 2026-10-06"
  const logisticsMatch = /^↩\s*ביטול הורדה של\s*([\d.]+)\s*·\s*(\S.*?)\s+(\S+)\s+נמחק\s*·\s*(.+)$/.exec(body);
  if (logisticsMatch && tagMatch) {
    const [, qty, table, , when] = logisticsMatch;
    return {
      kind: 'reversal', date: date || when.trim(), sourceTable: tagMatch[1], sourceId: tagMatch[2],
      category: tagMatch[3], quantity: Number(qty), sourceLabel: `${table} נמחק`,
      derivedFrom: null, warning: `↩ הוחזר במחיקת ${table}`, link: null, raw: rawLine,
    };
  }

  // "↩ ביטול הורדה של 60 · הוצאה #48 נמחקה · 2026-10-06"
  const expenseMatch = /^↩\s*ביטול הורדה של\s*([\d.]+)\s*·\s*הוצאה\s*#(\S+)\s*נמחקה\s*·\s*(.+)$/.exec(body);
  if (expenseMatch) {
    const [, qty, num, when] = expenseMatch;
    return {
      kind: 'reversal', date: date || when.trim(), sourceTable: 'הוצאות', sourceId: null, sourceNumber: num,
      category: null, quantity: Number(qty), sourceLabel: `הוצאה #${num} נמחקה`,
      derivedFrom: null, warning: '↩ הוחזר במחיקת הוצאה', link: null, raw: rawLine,
    };
  }

  return { kind: 'unknown', date, raw: rawLine };
}

function parseWarningOnlyLine(rawLine) {
  const { date, rest } = stripLeadingDate(rawLine);
  const tagMatch = TAG_RE.exec(rest);
  const body = tagMatch ? rest.slice(0, tagMatch.index).trim() : rest;
  // "⚠ דורש אישור: 0 משטחי עץ (חשבונית #61, שבוע ...) — <reason>" — פורמט-ישן,
  // לפני תיקון K+L/N1; עדיין עשוי להופיע בנתונים היסטוריים.
  const m = /^⚠\s*דורש אישור:\s*([\d.]+)\s*([^(]+?)\s*\(([^)]*)\)\s*—\s*(.+)$/.exec(body);
  if (m) {
    const [, qty, category, sourceLabel, reason] = m;
    return {
      kind: 'warning', date, sourceTable: tagMatch?.[1] || null, sourceId: tagMatch?.[2] || null,
      category: category.trim(), sourceLabel: sourceLabel.split(',')[0].trim(), quantity: Number(qty),
      derivedFrom: null, warning: reason.trim(), link: tagMatch ? documentLink(tagMatch[1], tagMatch[2]) : null,
      raw: rawLine,
    };
  }
  return { kind: 'unknown', date, raw: rawLine };
}

// שורת-בקרה [מלאי-מוסתר]{"lines":[...]} (תוספת 2026-10-08, "מחיקת הערות") —
// רשימת שורות-תנועה ש"נמחקו" ע"י המשתמשת מהתצוגה. לא מחיקה אמיתית: ר'
// hideInventoryLedgerLine/isLedgerLine ב-server/src/inventory-deduction.js —
// שורת-תנועה (↓/↩/⚠) עם תגית-אידמפוטנטיות (embedded, [מלאי-D:...]) או בלי
// (שורות-הוצאה — שהאידמפוטנטיות שלהן נשמרת בנפרד בשדה "הערות" של ההוצאה
// עצמה) לעולם לא נמחקת מהטקסט בפועל, כדי לא לאפשר הורדה-כפולה בניתוח חוזר
// של אותו מסמך ולא להתנגש עם מחיקה-מדורגת קיימת. השורה **נשארת** בשדה
// (עם כל תגית), רק מסוננת מכאן והלאה משני הפלטים (movements/freeNotes).
const HIDDEN_CONTROL_RE = /^\[מלאי-מוסתר\](\{.*\})\s*$/;

/**
 * מפרק שדה "הערות" שלם של פריט-מלאי לשורות-תנועה + הערות-חופשיות.
 * @returns { movements: Array<{kind,date,sourceTable,sourceId,category,sourceLabel,quantity,derivedFrom,warning,link,raw,...}>, freeNotes: string, hiddenCount: number }
 */
export function parseInventoryLedger(notes) {
  const allLines = String(notes || '').split('\n').map((l) => l.trim()).filter(Boolean);

  // שלב 1: שולפים את שורת-הבקרה (אם קיימת) ואת רשימת השורות-המוסתרות —
  // שורת-הבקרה עצמה לעולם לא מוצגת (לא כתנועה, לא כהערה חופשית).
  let hidden = [];
  const lines = [];
  for (const line of allLines) {
    const m = HIDDEN_CONTROL_RE.exec(line);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]);
        if (Array.isArray(parsed?.lines)) hidden = parsed.lines;
      } catch { /* JSON פגום בשורת-בקרה — מתייחסים כאילו אין שורות מוסתרות */ }
      continue;
    }
    lines.push(line);
  }
  const hiddenSet = new Set(hidden);

  const movements = [];
  const freeNotes = [];
  let hiddenCount = 0;
  for (const line of lines) {
    if (hiddenSet.has(line)) { hiddenCount += 1; continue; } // מוסתרת — אבל נשארת בשדה עצמו
    // ⚠️ 7.10.2026 (לילה 3), באג אמיתי שנתפס (ר' לוג-המשימה): מאז
    // שנוספה חתימת-תאריך-ISO מובילה לשורות-תנועה חדשות (todayStamp(),
    // ר' logistics-deduction.js/inventory-deduction.js), השורה כבר לא
    // *מתחילה* ב-"↓"/"↩"/"⚠" — היא מתחילה בספרת-השנה. הבדיקה הזו הייתה
    // ממשיכה להסתכל רק על התו הראשון של ה-raw line, לפני כל הסרת-תאריך,
    // כך ששורה חדשה כזו נפלה **בשלמותה** ל-freeNotes (לא נספרה כתנועה
    // בכלל, לא רק "תאריך לא ידוע") — אומת: parseInventoryLedger על שורת
    // "2026-10-07 ↓ 27 ממלאי: ..." החזירה movements:[] ריק לגמרי. בודקים
    // לכן את התו הראשון של *אחרי* הסרת-תאריך (stripLeadingDate), לא של
    // ה-raw line; מעבירים את ה-line המקורי (עם התאריך) הלאה לפונקציות-
    // הפרסור הספציפיות — הן כבר מסירות את התאריך בעצמן.
    const { rest } = stripLeadingDate(line);
    if (rest.startsWith('↓')) movements.push(parseDeductionLine(line));
    else if (rest.startsWith('↩')) movements.push(parseReversalLine(line));
    else if (rest.startsWith('⚠')) movements.push(parseWarningOnlyLine(line));
    else freeNotes.push(line);
  }
  return { movements: movements.reverse(), freeNotes: freeNotes.join('\n'), hiddenCount }; // חדש-ביותר קודם
}

/**
 * משלים קישורי-מסמך לשורות מסוג "הוצאות" (שאין בהן מזהה-רשומה ישיר,
 * רק "הוצאה #<num>") — מצליב מול רשימת הוצאות אמיתיות (fields['מספר הוצאה']).
 * קורא ל-API פעם אחת (לא לכל שורה) ומחזיר עותק חדש של movements עם link מולא.
 */
export function resolveExpenseLinks(movements, expensesByNumber) {
  return movements.map((m) => {
    if (m.sourceTable !== 'הוצאות' || m.link || !m.sourceNumber) return m;
    const id = expensesByNumber?.[String(m.sourceNumber)];
    return id ? { ...m, sourceId: id, link: documentLink('הוצאות', id) } : m;
  });
}

/** סיכום "ירד היום / השבוע" מתוך movements (quantity חיובי, לא reversal) */
export function summarizeRecentDrops(movements) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  let today = 0, week = 0;
  for (const m of movements) {
    if (m.kind !== 'deduction' || !m.date) continue;
    const t = new Date(m.date).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= startOfToday) today += m.quantity;
    if (t >= startOfWeek) week += m.quantity;
  }
  return { today, week };
}
