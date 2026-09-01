// ============================================================
// בקשות עובדים — קבועים משותפים למסך המנהל ולאפליקציית העובד
// ============================================================

export const REQUEST_TABLE = 'בקשות עובדים';

export const REQUEST_FIELDS = {
  worker: 'עובד',
  type: 'סוג בקשה',
  date: 'תאריך',
  from: 'משעה',
  to: 'עד שעה',
  endOfDay: 'עד סוף היום',
  created: 'נוצר בתאריך',
  status: 'סטטוס',
  managerNote: 'הערת מנהל',
  answeredAt: 'תאריך תשובה',
  hidden: 'הוסתר על ידי העובד',
  allowsWork: 'מאפשר הזנת עבודה לתאריך',
  workerNotes: 'הערות עובד',
};

export const REQUEST_STATUS = {
  pending: 'ממתין לאישור',
  approved: 'אושר',
  rejected: 'לא אושר',
};

// האפשרויות האמיתיות של השדה "סוג בקשה" ב-Airtable
export const REQUEST_TYPES = {
  vacation: 'חופש',
  sick: 'מחלה',
  partial: 'חופש לחלק מהיום',
};

/** צבע + טקסט לפי האיפיון: ממתין כתום · אושר ירוק · לא אושר אדום */
export function statusStyle(status) {
  if (status === REQUEST_STATUS.approved) return { color: 'var(--ok)', soft: 'var(--ok-soft)', icon: '✓' };
  if (status === REQUEST_STATUS.rejected) return { color: 'var(--error)', soft: 'var(--error-soft)', icon: '✕' };
  return { color: 'var(--warning)', soft: 'var(--warning-soft)', icon: '●' };
}

/** "08:00 – 12:00" / "08:00 – עד סוף היום" / "" */
export function requestTimeLabel(r, endOfDayText = 'עד סוף היום') {
  const from = r[REQUEST_FIELDS.from];
  const to = r[REQUEST_FIELDS.to];
  const eod = !!r[REQUEST_FIELDS.endOfDay];
  if (!from && !to && !eod) return '';
  return `${from || '—'} – ${eod ? endOfDayText : (to || '—')}`;
}

/** הנחיות כשהטבלה טרם נוצרה ב-Airtable (ה-PAT ללא הרשאת סכמה) */
export function MissingRequestsTable() {
  const fields = [
    ['מספר בקשה', 'Autonumber'],
    ['עובד', 'Link to → עובדים'],
    ['סוג בקשה', 'Single select: חופש · מחלה · חופש לחלק מהיום'],
    ['תאריך', 'Date'],
    ['משעה', 'Single line text'],
    ['עד שעה', 'Single line text'],
    ['עד סוף היום', 'Checkbox'],
    ['נוצר בתאריך', 'Created time'],
    ['סטטוס', 'Single select: ממתין לאישור · אושר · לא אושר'],
    ['הערת מנהל', 'Long text'],
    ['תאריך תשובה', 'Date (with time)'],
    ['הוסתר על ידי העובד', 'Checkbox'],
    ['מאפשר הזנת עבודה לתאריך', 'Checkbox'],
    ['הערות עובד', 'Long text'],
  ];
  return (
    <div className="card" style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)' }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>⚠️ הטבלה "בקשות עובדים" עדיין לא קיימת ב-Airtable</div>
      <div style={{ fontSize: 14, marginBottom: 10 }}>
        המודול מוכן, אך ה-PAT הנוכחי אינו כולל הרשאת <code>schema.bases:write</code> ולכן לא ניתן ליצור את הטבלה אוטומטית.
        אפשר להוסיף את ההרשאה ל-PAT ולהריץ <code>node src/_create-requests-table.mjs</code> מתיקיית <code>server</code>, או ליצור ידנית טבלה בשם <b>בקשות עובדים</b> עם השדות:
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>שם שדה</th><th>סוג</th></tr></thead>
          <tbody>{fields.map(([n, t]) => <tr key={n}><td><b>{n}</b></td><td style={{ direction: 'ltr', textAlign: 'right' }}>{t}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
