// ============================================================
// רכיבי UI גלובליים ללא React — חלון אישור והודעות Toast
// ------------------------------------------------------------
// מומשו ב-DOM ישיר כדי שכל מסך (וגם קוד עזר כמו removeRecord)
// יוכל לקרוא להם בלי להחזיק state מקומי. העיצוב ב-global.css.
// ============================================================

/**
 * חלון אישור לפי סעיף "ניהול מחיקה" באיפיון:
 * כפתור פעולה אדום, אין ביצוע בלחיצה ראשונה, Escape/רקע = ביטול.
 * @returns {Promise<boolean>} true רק לאחר אישור מפורש
 */
export function confirmDialog({
  title = 'אישור פעולה',
  message = '',
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('dir', 'rtl');

    const modal = document.createElement('div');
    modal.className = 'modal confirm-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');

    const h = document.createElement('h3');
    h.textContent = title;

    const p = document.createElement('div');
    p.className = 'confirm-message';
    message.split('\n').forEach((line) => {
      const row = document.createElement('div');
      row.textContent = line;
      p.appendChild(row);
    });

    const actions = document.createElement('div');
    actions.className = 'form-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = cancelLabel;

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    okBtn.textContent = confirmLabel;

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
    };

    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);

    actions.append(cancelBtn, okBtn);
    modal.append(h, p, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    cancelBtn.focus();
  });
}

let toastStack = null;

/**
 * הודעה קצרה שנעלמת מעצמה — להצלחות ("הפריט נמחק בהצלחה")
 * ולכישלונות ("לא ניתן היה להשלים את הפעולה").
 * @param {'ok'|'error'|'warn'} type
 */
export function toast(message, type = 'ok') {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('dir', 'rtl');
    document.body.appendChild(toastStack);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.textContent = `${type === 'ok' ? '✓ ' : type === 'error' ? '✕ ' : '⚠ '}${message}`;
  toastStack.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); }, 3400);
  setTimeout(() => { el.remove(); }, 3900);
}
