import { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch.js';

// ============================================================
// הערה חופשית באפליקציית המנהל — תמיד בעברית.
// הערת עובד שנכתבה בתאילנדית מתורגמת אוטומטית (/api/translate, כיוון th→he),
// והמקור נשמר בשורה קטנה מתחת. הערה שכבר בעברית מוצגת כמות שהיא.
// תרגומים נשמרים בזיכרון לפי הטקסט — הרענון האוטומטי של הרשימה לא
// שולח שוב ושוב את אותה הערה לשירות התרגום.
// ============================================================
const THAI_RE = /[฀-๿]/;
const cache = new Map(); // text -> translated

export function needsHebrew(text) {
  return THAI_RE.test(String(text || ''));
}

export default function HebrewNote({ text }) {
  const src = String(text || '').trim();
  const [translated, setTranslated] = useState(() => cache.get(src) || '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src || !needsHebrew(src) || cache.has(src)) { setTranslated(cache.get(src) || ''); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch('/api/translate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: src, target: 'he' }),
        });
        const d = await r.json();
        if (!r.ok || !d?.translated) throw new Error();
        cache.set(src, d.translated);
        if (!cancelled) setTranslated(d.translated);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  if (!src) return null;
  if (!needsHebrew(src)) return <span>📝 {src}</span>;
  if (translated) {
    return (
      <span>
        📝 {translated}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginInlineStart: 8 }} title="המקור כפי שנכתב">({src})</span>
      </span>
    );
  }
  return (
    <span>
      📝 {src}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginInlineStart: 8 }}>{failed ? 'התרגום לא זמין כרגע' : 'מתרגם...'}</span>
    </span>
  );
}
