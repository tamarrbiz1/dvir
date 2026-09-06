// ============================================================
// זיהוי מכשיר לכניסה לפי מכשיר (device binding) — סעיף אבטחה
// ------------------------------------------------------------
// דפדפן לא חושף מזהה חומרה אמיתי — במקום זה: מזהה אקראי קבוע שנשמר
// ב-localStorage (לא sessionStorage — צריך לשרוד סגירת דפדפן/טאב).
// מכשיר "חדש" בעיני המערכת = דפדפן/מכשיר בלי המזהה הזה עדיין
// (למשל: התקנה מחדש, ניקוי אחסון, או מכשיר פיזי אחר).
// ============================================================
const KEY = 'zite_device_id';

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null; // localStorage חסום (פרטי/מדיניות דפדפן) — לא חוסמים כניסה בגלל זה
  }
}

// תיאור קריא לאדם מה-User-Agent, לרשימת האישור של המנהל הראשי
export function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows'
        : /Macintosh/.test(ua) ? 'Mac'
          : /Linux/.test(ua) ? 'Linux' : 'לא ידוע';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
      : /CriOS/.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox' : 'דפדפן';
  return `${browser} · ${os}`;
}
