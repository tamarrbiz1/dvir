// ============================================================
// מיון "טבעי" של מבנים — בכל מקום שמוצגת רשימת מבנים (סעיף 2026-09-06)
// לפי המספר הראשון בשם ("מבנה 2" לפני "מבנה 10", לא לפי סדר א"ב של
// המחרוזת). שמות בלי מספר (כמו "חממה ישנה") נופלים לסוף, וכפילויות
// עם אותו מספר (כמו "מבנה 9 - צד ימין"/"צד שמאל") מסתדרות ביניהן
// לפי א"ב.
// ============================================================
export function structureSortKey(name) {
  const m = String(name || '').match(/\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

export function structureName(s) {
  return (s && (s['מספר מבנה'] || s['סוג מבנה'])) || s?.name || '';
}

export function sortStructures(list, nameOf = structureName) {
  return [...(list || [])].sort((a, b) => {
    const an = nameOf(a);
    const bn = nameOf(b);
    return structureSortKey(an) - structureSortKey(bn) || String(an).localeCompare(String(bn), 'he', { numeric: true });
  });
}
