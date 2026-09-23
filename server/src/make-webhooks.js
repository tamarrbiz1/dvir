// ============================================================
// טריגר webhook ל-Make אחרי יצירת רשומת מסמך מוצלחת ב-Airtable.
// Make עצמו מזהה ומתפוס את הקובץ/הרשומה האחרונה — הבקשה שלנו רק
// מהדקת את התהליך (fire-and-forget: לא await-ים בתגובה למשתמש,
// כשל/timeout כאן לעולם לא מפיל את ההעלאה או מוחזר כשגיאה ללקוח).
// כתובות ה-webhook עצמן חיות ב-.env (לא בקוד) — ר' .env.example.
// ============================================================

const WEBHOOK_BY_TABLE = {
  'חשבוניות': { env: 'MAKE_WEBHOOK_INCOME_INVOICE', docType: 'חשבונית הכנסה' },
  'הוצאות': { env: 'MAKE_WEBHOOK_EXPENSE_INVOICE', docType: 'חשבונית הוצאה' },
  'תעודות משלוח': { env: 'MAKE_WEBHOOK_DELIVERY_NOTE', docType: 'תעודת משלוח' },
  'צ׳קים': { env: 'MAKE_WEBHOOK_CHECK', docType: "צ'ק" },
  'דוחות ריסוסים': { env: 'MAKE_WEBHOOK_SPRAY_REPORT', docType: 'דוח ריסוסים' },
};

const WEBHOOK_TIMEOUT_MS = 8000;

/**
 * שולח טריגר ל-Make עבור רשומת מסמך שנוצרה בהצלחה. לא מוחזר כלום —
 * הקריאה fire-and-forget בכוונה, כדי שלא תעכב או תפיל את התגובה
 * ללקוח (ההעלאה עצמה כבר הצליחה לפני שזה נקרא).
 */
export function notifyMakeWebhook(table, recordId) {
  const meta = WEBHOOK_BY_TABLE[table];
  if (!meta) return; // טבלה בלי webhook מוגדר עבורה — לא רלוונטי

  const url = process.env[meta.env];
  if (!url) {
    console.warn(`[make-webhook] דילוג: אין ${meta.env} מוגדר ב-.env (טבלה: ${table}, רשומה: ${recordId})`);
    return;
  }

  const payload = { recordId, table, docType: meta.docType, timestamp: new Date().toISOString() };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  })
    .then((r) => {
      if (r.ok) {
        console.log(`[make-webhook] נשלח בהצלחה — ${meta.docType} (${table}/${recordId}) -> ${r.status}`);
      } else {
        console.warn(`[make-webhook] Make החזיר סטטוס לא תקין — ${meta.docType} (${table}/${recordId}) -> ${r.status}`);
      }
    })
    .catch((e) => {
      console.warn(`[make-webhook] שליחה נכשלה — ${meta.docType} (${table}/${recordId}): ${e?.message || e}`);
    });
}
