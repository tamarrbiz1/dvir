// ============================================================
// גלריית תמונות של טיפול (משימה AS-3, 14.10.2026)
// ------------------------------------------------------------
// תמר: "ואפשרות להעלות תמונה — כבר יש באיירטבל שדה מתאים."
//
// ההעלאה עוברת ב-POST /api/treatments/:id/photos (ר'
// server/src/treatment-photos.js) — **לא** דרך /api/upload-document,
// שיוצר רשומה חדשה בטבלה ומפעיל טריגרים של Make/ניתוח. כאן אין ניתוח,
// אין Make ואין נגיעה במלאי: זו תמונת-שטח, לא חשבונית ולא דוח ריסוסים.
//
// קישורי-attachment של Airtable פגים אחרי ~2 שעות, ולכן ה-URL אינו
// נשמר בשום state מתמשך — הוא מגיע מרשומת הטיפול בכל רענון, ואחרי כל
// שינוי קוראים ל-onChanged() שמביא רשומה טרייה (אותה תבנית בדיוק כמו
// WorkerPassportCard ב-WorkersPage.jsx).
//
// המרת HEIC/WebP ל-JPG והקטנת תמונות גדולות — utils/image.js, אותה
// פונקציה בדיוק שמסך העלאת המסמכים משתמש בה מאז AM-3.
// ============================================================
import { useState } from 'react';
import { authFetch } from '../utils/authFetch.js';
import { confirmDialog, toast } from '../utils/ui.js';
import { imageToJpeg, shrinkImage, isConvertibleImage, conversionErrorMessage } from '../utils/image.js';

/** מגבלת נקודת-הקצה של Airtable להעלאה בבקשה אחת — זהה לשרת */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,image/webp,.jpg,.jpeg,.png,.heic,.heif,.webp';

function attachmentsOf(raw) {
  const list = raw?.['תמונות'];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export default function TreatmentPhotos({ treatmentId, raw, canManage, onChanged }) {
  const photos = attachmentsOf(raw);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(null);
  const inputId = `treatment-photo-${treatmentId}`;
  const cameraId = `treatment-camera-${treatmentId}`;

  const upload = async (f) => {
    if (!f || busy) return;
    setBusy(true); setError('');
    try {
      let ready = f;
      // HEIC מאייפון / WebP מהורדה — מומר ל-JPG **לפני** השליחה (AM-3)
      if (isConvertibleImage(f)) {
        try { ready = await imageToJpeg(f); }
        catch { throw new Error(conversionErrorMessage(f)); }
      }
      const small = await shrinkImage(ready);
      if (small.size > MAX_BYTES) {
        throw new Error('הקובץ גדול מ-5MB גם לאחר כיווץ — יש להעלות תמונה קטנה יותר.');
      }
      const body = new FormData();
      body.append('file', small);
      const r = await authFetch(`/api/treatments/${treatmentId}/photos`, { method: 'POST', body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ההעלאה נכשלה');
      toast('✓ התמונה הועלתה');
      await onChanged?.();
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  const remove = async (att) => {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'מחיקת תמונה',
      message: 'התמונה תימחק מהטיפול ולא תהיה אפשרות לשחזר אותה.\nהאם להמשיך?',
      confirmLabel: 'מחק', danger: true,
    });
    if (!ok) return;
    setBusy(true); setError('');
    try {
      const r = await authFetch(`/api/treatments/${treatmentId}/photos/${att.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'המחיקה נכשלה');
      toast('✓ התמונה נמחקה');
      setZoom(null);
      await onChanged?.();
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        🖼️ תמונות
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          {photos.length ? `${photos.length}` : 'אין תמונות לטיפול הזה'}
        </span>
      </div>
      {error && <div className="badge badge-error" style={{ width: '100%', marginBottom: 8 }}>⚠️ {error}</div>}

      {photos.length > 0 && (
        /* flex-wrap: ב-390px הממוזערות נערמות ולא גולשות */
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: canManage ? 8 : 0 }}>
          {photos.map((att) => (
            <div key={att.id} style={{ position: 'relative' }}>
              <img src={att.thumbnails?.large?.url || att.thumbnails?.small?.url || att.url}
                alt={att.filename || 'תמונת טיפול'} title={att.filename || ''}
                onClick={() => setZoom(att)}
                style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', cursor: 'zoom-in', border: '1px solid var(--border)', background: '#fff' }} />
              {canManage && (
                <button type="button" aria-label="מחיקת תמונה" title="מחיקת תמונה" disabled={busy}
                  onClick={() => remove(att)}
                  style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border)', background: '#fff', color: 'var(--error)', cursor: 'pointer', lineHeight: 1, padding: 0, fontSize: 12 }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* input מוסתר + label-ככפתור: אותה תבנית כמו העלאת מסמך בשאר המסכים */}
          <input id={inputId} type="file" accept={ACCEPT} style={{ display: 'none' }}
            disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(f); }} />
          <label htmlFor={inputId} className="btn btn-sm btn-primary" style={busy ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
            {busy ? 'מעלה...' : '📷 העלאת תמונה'}
          </label>
          {/* capture="environment" — בטלפון נפתחת המצלמה האחורית ישר */}
          <input id={cameraId} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(f); }} />
          <label htmlFor={cameraId} className="btn btn-sm btn-ghost" style={busy ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
            📸 צילום
          </label>
          <span className="muted" style={{ fontSize: 12 }}>JPG או PNG, עד 5MB (תמונות גדולות ו-HEIC מומרות אוטומטית)</span>
        </div>
      )}

      {/* אותו lightbox בדיוק כמו צילום הדרכון ב-WorkersPage (z-index 80 — מעל ה-drawer) */}
      {zoom && (
        <div className="modal-overlay lightbox" onClick={() => setZoom(null)}>
          <img src={zoom.url} alt={zoom.filename || 'תמונת טיפול'} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="drawer-close lightbox-close" onClick={() => setZoom(null)} aria-label="סגירה">✕</button>
        </div>
      )}
    </div>
  );
}
