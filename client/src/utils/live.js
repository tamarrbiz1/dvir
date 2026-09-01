// ============================================================
// רענון אוטומטי — מחזורי + בכל חזרה לחלון. משמש את מסכי הצוות
// והעובדים כדי ששינוי ממקום אחר יופיע בלי כפתור רענון ידני.
// ============================================================
import { useEffect } from 'react';

export function useAutoRefresh(fn, ms = 60 * 1000) {
  useEffect(() => {
    if (typeof fn !== 'function') return undefined;
    const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
    const onVis = () => { if (!document.hidden) fn(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [fn, ms]);
}
