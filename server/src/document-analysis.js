// ============================================================
// ניתוח מסמך הוצאה (PDF/תמונה) לחילוץ שורות מוצר — 2026-10-06 (לילה)
// ------------------------------------------------------------
// ממשק יציב: analyzeExpenseDocument(buffer, mimeType, inventoryItems)
// → { supplier, date, total, lines:[{description,quantity,unit,
//     unitPrice,lineTotal,confidence}] }
//
// שני ספקים:
// - Anthropic Messages API (fetch גולמי — אין SDK מותקן, ואסור
//   להתקין npm install הלילה) כשיש ANTHROPIC_API_KEY ב-.env. מודל
//   ראשי claude-fable-5-1, גיבוי claude-opus-5-5 אם הראשון נכשל.
//   קלט: PDF/תמונה base64 ישירות בהודעה (document/image content
//   block) + טקסט prompt שמבקש אך ורק JSON. בלי ספריית PDF-פענוח —
//   המודל עצמו קורא את הקובץ (יכולת מובנית ב-Messages API).
// - ספק "stub" דטרמיניסטי (ללא מפתח, או כש-STUB_DOCUMENT_ANALYSIS=1):
//   מזהה כמה מילות-מפתח קבועות בשם הקובץ/טקסט שסופק לבדיקה, כדי
//   שהמנגנון כולו (התאמה למלאי, הורדה, אידמפוטנטיות) ניתן לבדיקה
//   מקצה-לקצה בלי תלות ברשת/מפתח. לעולם לא משמש אוטומטית על מסמך
//   אמיתי אם יש מפתח אמיתי מוגדר.
// ============================================================

const PRIMARY_MODEL = 'claude-fable-5-1';
const FALLBACK_MODEL = 'claude-opus-5-5';
const ANTHROPIC_VERSION = '2023-06-01';

function hasRealApiKey() {
  return !!process.env.ANTHROPIC_API_KEY && process.env.STUB_DOCUMENT_ANALYSIS !== '1';
}

const PROMPT = `אתה מנתח מסמכי הוצאה (חשבוניות/קבלות) של משק חקלאי. קיבלת קובץ (PDF או תמונה, אולי סרוק/עקום, אולי צילום טלפון, אולי כמה עמודים). המשימה: לחלץ את *כל* שורות המוצרים/השירותים במסמך — בעברית או אנגלית, כולל טבלאות.

החזר אך ורק אובייקט JSON תקני (בלי טקסט נוסף, בלי markdown, בלי הסברים) במבנה המדויק הזה:
{
  "supplier": "שם הספק אם מופיע במסמך, אחרת null",
  "date": "YYYY-MM-DD אם מופיע, אחרת null",
  "total": מספר-סכום-כולל אם מופיע, אחרת null,
  "lines": [
    { "description": "התיאור המדויק כפי שמופיע במסמך", "quantity": מספר-כמות-או-null, "unit": "יחידת מידה כפי שמופיעה (יחידה/מ'/ק\"ג/ליטר/גליל/קרטון/וכו') או null", "unitPrice": מספר-או-null, "lineTotal": מספר-או-null, "confidence": מספר-בין-0-ל-1-כמה-אתה-בטוח-בזיהוי-השורה-הזו }
  ]
}

אם אין שום שורת מוצר ברורה במסמך — החזר lines: []. אל תמציא נתונים שלא מופיעים במסמך — שדה שלא ברור = null, לא ניחוש.`;

async function callAnthropic(model, buffer, mimeType) {
  const isPdf = mimeType === 'application/pdf';
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: PROMPT }] }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${model} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.content?.find((c) => c.type === 'text')?.text || '';
  return parseJsonLoose(text);
}

/** המודל אמור להחזיר JSON טהור, אבל ליתר ביטחון — שולף גם מתוך גדר ```json אם יש */
function parseJsonLoose(text) {
  const trimmed = String(text || '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) { try { return JSON.parse(match[1].trim()); } catch {} }
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch {} }
  throw new Error('תשובת המודל אינה JSON תקני');
}

function normalizeResult(raw) {
  const lines = Array.isArray(raw?.lines) ? raw.lines : [];
  return {
    supplier: raw?.supplier ?? null,
    date: raw?.date ?? null,
    total: raw?.total != null ? Number(raw.total) : null,
    lines: lines.map((l) => ({
      description: String(l?.description || '').trim(),
      quantity: l?.quantity != null ? Number(l.quantity) : null,
      unit: l?.unit ? String(l.unit).trim() : null,
      unitPrice: l?.unitPrice != null ? Number(l.unitPrice) : null,
      lineTotal: l?.lineTotal != null ? Number(l.lineTotal) : null,
      confidence: l?.confidence != null ? Math.max(0, Math.min(1, Number(l.confidence))) : 0,
    })).filter((l) => l.description),
  };
}

// ============================================================
// ספק stub — דטרמיניסטי, לבדיקות בלבד (ר' server/src/qa-check.mjs
// ופרטי הבדיקות בדוח). "מזהה" שורות לפי טקסט שמוטבע בתוך ה-buffer
// עצמו (לקובצי-בדיקה טקסטואליים/PDF עם טקסט חיפושי) — לא ניתוח
// אמיתי, רק כדי שהמנגנון שסביב (התאמה/הורדה/אידמפוטנטיות) ייבדק.
// ============================================================
// ⚠️ "ניילון"/"קרטון" מסתיימים באות עם צורה סופית (ן) — "ניילונים"/
// "קרטונים" (רבים) משתמשים בנו"ן רגילה (נ) באמצע המילה, לא בצורה
// הסופית. התאמת regex על המילה המלאה "קרטון" **לא** תתפוס "קרטונים"
// כתת-מחרוזת (נמצא ע"י בדיקה שנכשלה בפועל ב-qa-check.mjs) — משתמשים
// בגזע בלי האות האחרונה (קרטו/ניילו/נילו) כדי לתפוס גם יחיד וגם רבים.
const STUB_RULES = [
  { re: /ניילו|נילו|פוליאתילן|PE[\s-]?גליל/i, description: 'גליל ניילון חממה', quantity: 3, unit: 'גליל', confidence: 0.95 },
  { re: /קרטו/i, description: 'קרטוני אריזה', quantity: 50, unit: 'יחידה', confidence: 0.92 },
  { re: /משטח|פלטה/i, description: 'משטחי עץ', quantity: 10, unit: 'יחידה', confidence: 0.9 },
  { re: /כובע/i, description: 'כובעי הגנה', quantity: 20, unit: 'יחידה', confidence: 0.88 },
  { re: /UNCLEAR_UNIT/i, description: 'ניילון — יחידה לא ברורה', quantity: 3, unit: 'חבילה', confidence: 0.6 },
  { re: /NO_MATCH_ITEM/i, description: 'דלק לטרקטור', quantity: 200, unit: 'ליטר', confidence: 0.9 },
];

function stubAnalyze(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 20000));
  const lines = [];
  for (const rule of STUB_RULES) {
    if (rule.re.test(text)) {
      lines.push({ description: rule.description, quantity: rule.quantity, unit: rule.unit, unitPrice: 10, lineTotal: rule.quantity * 10, confidence: rule.confidence });
    }
  }
  return { supplier: text.includes('SUPPLIER:') ? text.match(/SUPPLIER:(\S+)/)?.[1] || null : null, date: null, total: null, lines };
}

/**
 * מנתח מסמך הוצאה ומחזיר שורות מוצר + מטא-נתונים. לא נכשל בשקט —
 * זורק שגיאה ברורה אם שני המודלים (ראשי+גיבוי) נכשלו, כדי שהקורא
 * יוכל לסמן סטטוס "נכשל" בלי לגעת במלאי.
 */
export async function analyzeExpenseDocument(buffer, mimeType, inventoryItems) {
  if (!hasRealApiKey()) {
    return normalizeResult(stubAnalyze(buffer));
  }
  try {
    return normalizeResult(await callAnthropic(PRIMARY_MODEL, buffer, mimeType));
  } catch (primaryErr) {
    try {
      return normalizeResult(await callAnthropic(FALLBACK_MODEL, buffer, mimeType));
    } catch (fallbackErr) {
      throw new Error(`ניתוח המסמך נכשל (ראשי: ${primaryErr.message}; גיבוי: ${fallbackErr.message})`);
    }
  }
}

export function isStubMode() {
  return !hasRealApiKey();
}
