// ============================================================
// עטיפה משותפת סביב fetch לכל קריאות ה-API (2026-09-08) — מצרפת את
// טוקן ההתחברות (Authorization: Bearer) לכל בקשה, ומטפלת ב-401
// (טוקן חסר/פג/לא תקף) בניתוק נקי וחזרה למסך כניסה, במקום שגיאה
// שקטה או מסך תקוע.
// לא לשימוש בקריאות ההתחברות עצמן (admin-login/worker-login) —
// שם 401 מסמן "קוד שגוי", לא "טוקן פג", וצריך להישאר הודעת שגיאה
// רגילה בטופס, לא ניתוק.
// ============================================================
export function getToken() {
  try {
    const raw = sessionStorage.getItem('zite_user');
    if (!raw) return null;
    return JSON.parse(raw)?.token || null;
  } catch { return null; }
}

export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { ...options, headers });
  if (r.status === 401) {
    try { sessionStorage.removeItem('zite_user'); } catch {}
    // רענון מלא — הדרך הפשוטה והבטוחה לאפס את כל מצב האפליקציה בצד
    // הלקוח ולהחזיר למסך כניסה, גם אם הבקשה שנכשלה לא עברה דרך useApp()
    if (typeof window !== 'undefined') window.location.reload();
  }
  return r;
}
