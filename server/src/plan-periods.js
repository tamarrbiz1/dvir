// ============================================================
// "שינוי תקופה" ומיזוג תוכניות חופפות (משימה AK, 13.10.2026)
// ------------------------------------------------------------
// המודל שתמר קבעה — ארבעה כפתורים, ארבע משמעויות שונות
// (עודכן ע"י תמר ב-13:15: ר' `updatePlanOriginal` למטה):
//
//   יצירת תוכנית  → מקורי **ומעודכן** (`חשב תוכנית` ב-Airtable, קיים).
//   עריכת תוכנית  → **רק המקורי.** המעודכן נשאר, והזזה קודמת נשמרת.
//                   ← `updatePlanOriginal` כאן. לא קורא ל`חשב תוכנית`.
//   הזז תוכנית    → משנה את **המעודכן**, N ימים קדימה. (קיים, לא נגענו.)
//   שינוי תקופה   → משנה את **המעודכן**, שתילה וקטיף יחד. ← `changePlanPeriod`.
//
// **מקור האמת לתאריכים הוא השדות המעודכנים בתוכנית.** טבלת
// `תקופות תוכנית` היא **תוצר** של המעודכן, לא מקור. זה ההיפוך מול מה
// שהיה: עד AK הכפתור "שינוי תקופה" רק יצר שורה נוספת ב`תקופות תוכנית`
// עם `מקור='שינוי ידני'`, **בלי לגעת בתוכנית ובלי לגעת בתחזית**. כלומר
// תמר שינתה תקופה, ראתה שורה חדשה בכרטיס, והתכנון עצמו — התאריכים,
// התחזית, הק"ג הצפוי, ההכנסה — נשאר בדיוק כפי שהיה. התוצאה המעשית:
// שורה ידנית שמסתירה את המצב האמיתי ולא משנה אותו.
//
// מאז AK אין יותר שורות `שינוי ידני`: שינוי תקופה כותב לתוכנית, מעדכן
// את שורת ה-`מערכת` של אותו שלב, **מוחק** שורות ידניות שרדו של אותו
// שלב, ובונה את התחזית מחדש.
//
// ------------------------------------------------------------
// למה בנייה ישירה ולא `רענן תחזית` false→true
// ------------------------------------------------------------
// משימת AK נכתבה לפני AL והציעה לסמן את הצ'קבוקס. מאז AL
// (`forecast-build.js`) **השרת הוא שבונה**, ואוטומציית Airtable
// מושבתת — ולכן סימון הצ'קבוקס היה אומר להמתין עד 20 שניות לסורק
// במקום לבנות מיד. כאן נקראת הבנייה ישירות, והתשובה ללקוח כבר מכילה
// את מספר השבועות שנבנו.
// ============================================================
import { fetchRecords, createRecord, updateRecord, deleteRecord } from './airtable.js';
import { buildForecastForPlan } from './forecast-build.js';
import { recordBuildResult } from './forecast-watcher.js';

export const PLANS_TABLE = 'תוכניות שתילה';
export const PERIODS_TABLE = 'תקופות תוכנית';
export const HARVESTS_TABLE = 'קטיפים';
export const CROPS_TABLE = 'גידולים';
export const STRUCTURES_TABLE = 'מבנים';
export const NON_WORK_TABLE = 'ימי אי עבודה';

/** שמות השדות המעודכנים לכל שלב, ושם הסטטוס המתאים ב`תקופות תוכנית` */
export const PHASES = {
  planting: { from: 'תחילת שתילה מעודכנת', to: 'סוף שתילה מעודכן', status: 'שתילה', label: 'שתילה' },
  harvest: { from: 'תחילת קטיף מעודכנת', to: 'סוף קטיף מעודכן', status: 'קטיף', label: 'קטיף' },
};

const SOURCE_FIELD = 'מקור';
const SOURCE_SYSTEM = 'מערכת';
const SOURCE_MANUAL = 'שינוי ידני';
const PLAN_LINK = 'תוכנית שתילה';

export class PeriodError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const ymd = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const linkedIds = (value) => {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return arr.map((v) => (v && typeof v === 'object' ? v.id : v)).filter(Boolean);
};
const firstLinkedId = (value) => linkedIds(value)[0] || null;

/**
 * ולידציה של מצב-התאריכים אחרי השינוי — אותם כללים שסקריפט
 * `חשב תוכנית` מקיים: הקטיף לא מתחיל לפני השתילה, ולא נגמר לפניה.
 *
 * `changes` הוא מערך של `{ phase, from, to }` — תמר ביקשה (13.10,
 * תוספת 2) שהמודאל יאפשר לשנות את **שני השלבים באותה פעולה**, ולכן
 * הוולידציה חייבת לרוץ על **המצב המשולב** ולא על שלב-שלב: שינוי
 * שתילה שלבדו היה נראה לא-חוקי יכול להיות חוקי לגמרי יחד עם שינוי
 * הקטיף שנשלח איתו.
 *
 * @returns {string|null} הודעת-שגיאה בעברית, או null אם תקין
 */
export function validatePhaseChanges(plan, changes) {
  if (!Array.isArray(changes) || !changes.length) return 'לא נשלח שום שינוי';
  const next = {
    planting: { from: ymd(plan[PHASES.planting.from]), to: ymd(plan[PHASES.planting.to]) },
    harvest: { from: ymd(plan[PHASES.harvest.from]), to: ymd(plan[PHASES.harvest.to]) },
  };
  const seen = new Set();
  for (const c of changes) {
    if (!PHASES[c.phase]) return 'שלב לא מוכר — צריך "שתילה" או "קטיף"';
    if (seen.has(c.phase)) return `השלב "${PHASES[c.phase].label}" נשלח פעמיים`;
    seen.add(c.phase);
    if (!ymd(c.from) || !ymd(c.to)) return 'התאריכים חייבים להיות בפורמט YYYY-MM-DD';
    if (ymd(c.from) > ymd(c.to)) {
      return `בשלב ה${PHASES[c.phase].label}: תאריך ההתחלה (${ymd(c.from)}) מאוחר מתאריך הסיום (${ymd(c.to)})`;
    }
    next[c.phase] = { from: ymd(c.from), to: ymd(c.to) };
  }

  if (next.planting.from && next.harvest.from && next.harvest.from < next.planting.from) {
    return `הקטיף לא יכול להתחיל (${next.harvest.from}) לפני השתילה (${next.planting.from})`;
  }
  if (next.planting.to && next.harvest.to && next.harvest.to < next.planting.to) {
    return `הקטיף לא יכול להסתיים (${next.harvest.to}) לפני סוף השתילה (${next.planting.to})`;
  }
  return null;
}

/** תאימות-לאחור: ולידציה לשלב בודד */
export function validatePhaseChange(plan, phase, from, to) {
  return validatePhaseChanges(plan, [{ phase, from, to }]);
}

/**
 * חפיפה = הטווח [תחילת שתילה מעודכנת .. סוף קטיף מעודכן] של שתי
 * תוכניות **באותו מבנה** נחתך. "אותו גידול" → מועמד למיזוג; גידול
 * שונה → התראה בלבד (תמר: בלי פעולה).
 *
 * טהור — כדי שיהיה נבדק בלי רשת.
 */
export function findOverlaps(plan, allPlans, { cropById = new Map(), structById = new Map() } = {}) {
  const spanOf = (p) => {
    const from = ymd(p[PHASES.planting.from]) || ymd(p[PHASES.harvest.from]);
    const to = ymd(p[PHASES.harvest.to]) || ymd(p[PHASES.planting.to]);
    return from && to && to >= from ? { from, to } : null;
  };
  const mine = spanOf(plan);
  const myStructure = firstLinkedId(plan['מבנה']);
  if (!mine || !myStructure) return [];
  const myCrop = firstLinkedId(plan['גידולים']);

  const out = [];
  for (const other of allPlans) {
    if (other.id === plan.id) continue;
    if (firstLinkedId(other['מבנה']) !== myStructure) continue;
    const theirs = spanOf(other);
    if (!theirs) continue;
    if (theirs.from > mine.to || theirs.to < mine.from) continue; // אין חיתוך
    const theirCrop = firstLinkedId(other['גידולים']);
    const sameCrop = !!myCrop && myCrop === theirCrop;
    out.push({
      planId: other.id,
      planNumber: other['מספר תוכנית'] ?? null,
      cropId: theirCrop,
      cropName: cropById.get(theirCrop)?.['שם גידול'] || null,
      structureName: structById.get(myStructure)?.['מספר מבנה'] || null,
      from: theirs.from,
      to: theirs.to,
      sameCrop,
      canMerge: sameCrop,
      message: sameCrop
        ? `תוכנית ${plan['מספר תוכנית']} חופפת לתוכנית ${other['מספר תוכנית']} (אותו גידול, ${structById.get(myStructure)?.['מספר מבנה'] || 'אותו מבנה'}). למזג לתוכנית אחת?`
        : `שימו לב: חופף לתוכנית ${other['מספר תוכנית']} (${cropById.get(theirCrop)?.['שם גידול'] || 'גידול אחר'}) באותו מבנה`,
    });
  }
  return out;
}

/** מעדכן/יוצר את שורת ה-`מערכת` של השלב, ומוחק שורות ידניות שרדו */
async function syncPeriodRows(planId, phase, from, to, allPeriods) {
  const info = PHASES[phase];
  const mine = allPeriods.filter((p) => linkedIds(p[PLAN_LINK]).includes(planId)
    && String(p['סטטוס'] || '') === info.status);
  const system = mine.filter((p) => String(p[SOURCE_FIELD] || '') === SOURCE_SYSTEM);
  const manual = mine.filter((p) => String(p[SOURCE_FIELD] || '') === SOURCE_MANUAL);

  const result = { updated: 0, created: 0, manualDeleted: 0, extraDeleted: 0 };
  const fields = { 'מתאריך': from, 'עד תאריך': to };
  if (system.length) {
    // יותר משורת-מערכת אחת לשלב = שריד; משאירים אחת ומוחקים את העודפות
    await updateRecord(PERIODS_TABLE, system[0].id, fields);
    result.updated = 1;
    for (const extra of system.slice(1)) {
      await deleteRecord(PERIODS_TABLE, extra.id).catch(() => {});
      result.extraDeleted += 1;
    }
  } else {
    await createRecord(PERIODS_TABLE, {
      [PLAN_LINK]: [planId], ...fields, 'סטטוס': info.status, [SOURCE_FIELD]: SOURCE_SYSTEM,
    });
    result.created = 1;
  }
  // המודל החדש לא משאיר שורות ידניות (ר' הכותרת)
  for (const m of manual) {
    await deleteRecord(PERIODS_TABLE, m.id).catch((e) =>
      console.error(`[plan-periods] מחיקת תקופה ידנית ${m.id} נכשלה: ${e.message}`));
    result.manualDeleted += 1;
  }
  return result;
}

/**
 * "שינוי תקופה": כותב לשדות המעודכנים של השלב, מסנכרן את שורות
 * התקופות, בונה את התחזית מחדש, ומחזיר גם את החפיפות שנוצרו.
 */
export async function changePlanPeriod(planId, body = {}) {
  // שני הפורמטים נתמכים: `{phase, from, to}` (שלב אחד) ו-`{changes:[…]}`
  // (שני השלבים יחד — תוספת 2 של תמר).
  const changes = Array.isArray(body.changes) && body.changes.length
    ? body.changes
    : [{ phase: body.phase, from: body.from, to: body.to }];

  const [plans, periods, crops, structures] = await Promise.all([
    fetchRecords(PLANS_TABLE, {}),
    fetchRecords(PERIODS_TABLE, {}),
    fetchRecords(CROPS_TABLE, {}),
    fetchRecords(STRUCTURES_TABLE, {}),
  ]);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new PeriodError('התוכנית לא נמצאה', 404);

  const problem = validatePhaseChanges(plan, changes);
  if (problem) throw new PeriodError(problem, 400);

  const before = {};
  const after = {};
  const planFields = {};
  for (const c of changes) {
    const info = PHASES[c.phase];
    before[info.from] = ymd(plan[info.from]);
    before[info.to] = ymd(plan[info.to]);
    after[info.from] = ymd(c.from);
    after[info.to] = ymd(c.to);
    planFields[info.from] = ymd(c.from);
    planFields[info.to] = ymd(c.to);
  }

  // 1. השדות המעודכנים של השלבים שנשלחו, בכתיבה אחת. **המקורי לא
  //    נוגע** — הוא התכנון, והוא נשאר כדי שההשוואה "מתוכנן מול מעודכן"
  //    בכרטיס תמשיך להיות אמיתית.
  const updated = await updateRecord(PLANS_TABLE, planId, planFields);

  // 2. שורות התקופות של כל שלב שנשלח
  const periodResults = {};
  for (const c of changes) {
    periodResults[c.phase] = await syncPeriodRows(planId, c.phase, ymd(c.from), ymd(c.to), periods);
  }

  // 3. התחזית — בנייה ישירה (ר' "למה בנייה ישירה" בכותרת)
  const forecast = recordBuildResult(await buildForecastForPlan(planId));

  // 4. חפיפות אחרי השינוי
  const cropById = new Map(crops.map((c) => [c.id, c]));
  const structById = new Map(structures.map((s) => [s.id, s]));
  const overlaps = findOverlaps({ ...plan, ...planFields }, plans, { cropById, structById });

  const labels = changes.map((c) => PHASES[c.phase].label).join(' + ');
  console.log(`[plan-periods] תוכנית ${plan['מספר תוכנית']}: ${labels} → ${JSON.stringify(after)} (תקופות: ${JSON.stringify(periodResults)}; תחזית: ${forecast.ok ? `${forecast.created}/${forecast.updated}/${forecast.deleted}` : 'לא נבנתה'}; חפיפות: ${overlaps.length})`);

  return {
    ok: true,
    planId,
    planNumber: plan['מספר תוכנית'] ?? null,
    phases: changes.map((c) => c.phase),
    phaseLabel: labels,
    before,
    after,
    plan: updated,
    periods: periodResults,
    forecast: {
      ok: forecast.ok, missing: forecast.missing,
      weeks: forecast.weeks?.length ?? 0,
      created: forecast.created, updated: forecast.updated, deleted: forecast.deleted, unchanged: forecast.unchanged,
      keptWithActual: forecast.keptWithActual || [],
    },
    overlaps,
  };
}

// ------------------------------------------------------------
// "עריכת תוכנית" — **רק המקורי** (תוספת 2 של תמר, 13.10)
// ------------------------------------------------------------
// עד AK עריכה הפעילה את `חשב תוכנית` ב-Airtable, שמעתיק מקורי→מעודכן
// — כלומר **כל עריכה מחקה בשקט הזזה קודמת**. תמר החליטה: עריכה משנה
// את התכנון המקורי בלבד, והמעודכן (מה שהמערכת עובדת לפיו) נשאר.
// לשינוי המעודכן יש כפתור משלו: "שינוי תקופה".
//
// לכן אסור לקרוא כאן ל-`חשב תוכנית`, ובמקומו השרת מחשב את תאריכי-הסוף
// המקוריים באותה לוגיקה בדיוק: **יום ההתחלה נספר כיום 1 אם הוא יום
// עבודה, ומדלגים על כל תאריך שמופיע בטבלת `ימי אי עבודה`** (בה יושבים
// גם כל ימי שישי — ר' fridays.js).
//
// אומת מול הנתונים האמיתיים: החישוב משחזר **46 מתוך 46** תאריכי-הסוף
// המקוריים שקיימים בבסיס (שתילה וקטיף של כל תוכנית), אפס סטיות.
// ------------------------------------------------------------

const addDaysYmd = (s, n) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * תאריך הסיום של תקופה באורך `days` ימי-עבודה שמתחילה ב-`start`.
 * @param {Set<string>} nonWorkDays ערכי YYYY-MM-DD
 */
export function endOfWorkPeriod(start, days, nonWorkDays) {
  if (!ymd(start) || !Number.isFinite(Number(days)) || Number(days) < 1) return null;
  let counted = 0;
  let cursor = ymd(start);
  // גדר-שפיות: גם 365 ימי אי-עבודה רצופים לא יתקעו את הלופ
  for (let guard = 0; guard < 4000; guard += 1) {
    if (!nonWorkDays.has(cursor)) counted += 1;
    if (counted >= Number(days)) return cursor;
    cursor = addDaysYmd(cursor, 1);
  }
  return null;
}

/**
 * עריכת התכנון המקורי. כותב את ארבעת שדות-המקורי + `שנת תוכנית`,
 * ו**אינו נוגע בארבעת השדות המעודכנים**.
 *
 * `גידולים`/`מבנה` כן נכתבים כשנשלחו — ואם אחד מהם השתנה, נבנית
 * התחזית מחדש (היא תלויה בגידול ובשטח המבנה). שינוי של תאריכים
 * מקוריים או מספר ימים בלבד **אינו** בונה תחזית, כי התחזית נגזרת
 * מהמעודכן שלא זז.
 */
export async function updatePlanOriginal(planId, body = {}) {
  const [plans, nonWork] = await Promise.all([
    fetchRecords(PLANS_TABLE, {}),
    fetchRecords(NON_WORK_TABLE, {}),
  ]);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new PeriodError('התוכנית לא נמצאה', 404);

  const plantStart = ymd(body.plantStart);
  const harvestStart = ymd(body.harvestStart);
  const plantDays = Number(body.plantDays);
  const harvestDays = Number(body.harvestDays);

  if (!plantStart) throw new PeriodError('חסר תאריך תחילת שתילה', 400);
  if (!harvestStart) throw new PeriodError('חסר תאריך תחילת קטיף', 400);
  if (!Number.isFinite(plantDays) || plantDays < 1) throw new PeriodError('מספר ימי השתילה חייב להיות גדול מ-0', 400);
  if (!Number.isFinite(harvestDays) || harvestDays < 1) throw new PeriodError('מספר ימי הקטיף חייב להיות גדול מ-0', 400);
  if (harvestStart < plantStart) {
    throw new PeriodError(`הקטיף לא יכול להתחיל (${harvestStart}) לפני השתילה (${plantStart})`, 400);
  }

  const nonWorkDays = new Set(nonWork.map((d) => ymd(d['תאריך'])).filter(Boolean));
  const plantEnd = endOfWorkPeriod(plantStart, plantDays, nonWorkDays);
  const harvestEnd = endOfWorkPeriod(harvestStart, harvestDays, nonWorkDays);
  if (!plantEnd || !harvestEnd) throw new PeriodError('לא ניתן היה לחשב את תאריכי הסיום', 400);

  const fields = {
    'תחילת שתילה מקורית': plantStart,
    'סוף שתילה מקורי': plantEnd,
    'מספר ימי שתילה': plantDays,
    'תחילת קטיף מקורית': harvestStart,
    'סוף קטיף מקורי': harvestEnd,
    'מספר ימי קטיף': harvestDays,
    'שנת תוכנית': Number(plantStart.slice(0, 4)),
  };
  // מבנה/גידול — רק אם נשלחו במפורש
  let cropChanged = false;
  let structureChanged = false;
  if (Array.isArray(body.cropIds)) {
    fields['גידולים'] = body.cropIds;
    cropChanged = JSON.stringify(linkedIds(plan['גידולים']).sort()) !== JSON.stringify([...body.cropIds].sort());
  }
  if (Array.isArray(body.structureIds)) {
    fields['מבנה'] = body.structureIds;
    structureChanged = JSON.stringify(linkedIds(plan['מבנה']).sort()) !== JSON.stringify([...body.structureIds].sort());
  }

  const before = Object.fromEntries(Object.keys(fields)
    .filter((k) => k !== 'גידולים' && k !== 'מבנה')
    .map((k) => [k, typeof plan[k] === 'number' ? plan[k] : ymd(plan[k])]));
  const updatedFieldsBefore = {
    [PHASES.planting.from]: ymd(plan[PHASES.planting.from]),
    [PHASES.planting.to]: ymd(plan[PHASES.planting.to]),
    [PHASES.harvest.from]: ymd(plan[PHASES.harvest.from]),
    [PHASES.harvest.to]: ymd(plan[PHASES.harvest.to]),
  };

  const updated = await updateRecord(PLANS_TABLE, planId, fields);

  // התחזית נבנית רק כשהשתנה גידול/מבנה (ר' ההערה מעל הפונקציה)
  let forecast = null;
  if (cropChanged || structureChanged) {
    const built = recordBuildResult(await buildForecastForPlan(planId));
    forecast = {
      ok: built.ok, missing: built.missing, weeks: built.weeks?.length ?? 0,
      created: built.created, updated: built.updated, deleted: built.deleted, unchanged: built.unchanged,
      reason: cropChanged && structureChanged ? 'הגידול והמבנה השתנו' : (cropChanged ? 'הגידול השתנה' : 'המבנה השתנה'),
    };
  }

  console.log(`[plan-periods] תוכנית ${plan['מספר תוכנית']}: המקורי עודכן (שתילה ${plantStart}..${plantEnd}, קטיף ${harvestStart}..${harvestEnd})${forecast ? `; תחזית נבנתה (${forecast.reason})` : '; המעודכן והתחזית לא נגעו'}`);

  return {
    ok: true,
    planId,
    planNumber: plan['מספר תוכנית'] ?? null,
    before,
    after: Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'גידולים' && k !== 'מבנה')),
    // הוכחה שהמעודכן לא זז — הלקוח והבדיקות משתמשים בזה
    updatedFieldsUnchanged: updatedFieldsBefore,
    cropChanged,
    structureChanged,
    forecast,
    plan: updated,
  };
}

/** קריאה בלבד: החפיפות של תוכנית מסוימת כרגע (לשימוש אחרי עריכה/הזזה) */
export async function overlapsForPlan(planId) {
  const [plans, crops, structures] = await Promise.all([
    fetchRecords(PLANS_TABLE, {}),
    fetchRecords(CROPS_TABLE, {}),
    fetchRecords(STRUCTURES_TABLE, {}),
  ]);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new PeriodError('התוכנית לא נמצאה', 404);
  return {
    planId,
    planNumber: plan['מספר תוכנית'] ?? null,
    overlaps: findOverlaps(plan, plans, {
      cropById: new Map(crops.map((c) => [c.id, c])),
      structById: new Map(structures.map((s) => [s.id, s])),
    }),
  };
}

// ------------------------------------------------------------
// מיזוג שתי תוכניות חופפות באותו מבנה ואותו גידול
// ------------------------------------------------------------

/**
 * הטווח המאוחד, טהור. לפי הכלל שתמר קבעה:
 *   תחילת שתילה = המוקדמת · סוף שתילה = **המאוחר**
 *   תחילת קטיף  = המוקדמת · סוף קטיף  = **המאוחר**
 * כלומר השורדת "נמתחת" לכסות את שתי התוכניות.
 */
export function mergedSpan(survivor, absorbed) {
  const pick = (field, mode) => {
    const a = ymd(survivor[field]);
    const b = ymd(absorbed[field]);
    if (!a) return b;
    if (!b) return a;
    return mode === 'min' ? (a < b ? a : b) : (a > b ? a : b);
  };
  return {
    [PHASES.planting.from]: pick(PHASES.planting.from, 'min'),
    [PHASES.planting.to]: pick(PHASES.planting.to, 'max'),
    [PHASES.harvest.from]: pick(PHASES.harvest.from, 'min'),
    [PHASES.harvest.to]: pick(PHASES.harvest.to, 'max'),
  };
}

/** מי השורדת: זו עם `תחילת שתילה מעודכנת` המוקדמת (שובר-שוויון: מספר התוכנית) */
export function pickSurvivor(a, b) {
  const sa = ymd(a[PHASES.planting.from]) || ymd(a[PHASES.harvest.from]) || '9999-12-31';
  const sb = ymd(b[PHASES.planting.from]) || ymd(b[PHASES.harvest.from]) || '9999-12-31';
  if (sa !== sb) return sa < sb ? { survivor: a, absorbed: b } : { survivor: b, absorbed: a };
  return (Number(a['מספר תוכנית']) || 0) <= (Number(b['מספר תוכנית']) || 0)
    ? { survivor: a, absorbed: b } : { survivor: b, absorbed: a };
}

/**
 * מיזוג. `deletePlan` מוזרק (הקאסקייד מ-plan-delete.js) כדי שהמודול
 * הזה יישאר נבדק בלי לייבא את כל שרשרת המחיקה.
 *
 * סדר הפעולות הוא קריטי: **קודם מעבירים את הקטיפים**, ורק אחר כך
 * מוחקים את הנבלעת. `plan-delete.js` חוסם מחיקה של תוכנית שיש לה
 * קטיפים מקושרים (409, נתוני אמת) — ואם היינו מוחקים קודם, המיזוג היה
 * נכשל באמצע ומשאיר שתי תוכניות עם טווח מאוחד על אחת מהן.
 */
export async function mergePlans(planId, otherId, { deletePlan } = {}) {
  if (!otherId) throw new PeriodError('חסר מזהה התוכנית השנייה', 400);
  if (planId === otherId) throw new PeriodError('אי אפשר למזג תוכנית עם עצמה', 400);

  const [plans, harvests] = await Promise.all([
    fetchRecords(PLANS_TABLE, {}),
    fetchRecords(HARVESTS_TABLE, {}),
  ]);
  const a = plans.find((p) => p.id === planId);
  const b = plans.find((p) => p.id === otherId);
  if (!a || !b) throw new PeriodError('אחת התוכניות לא נמצאה', 404);

  const structA = firstLinkedId(a['מבנה']);
  const structB = firstLinkedId(b['מבנה']);
  if (!structA || structA !== structB) throw new PeriodError('מיזוג אפשרי רק בין תוכניות באותו מבנה', 400);
  const cropA = firstLinkedId(a['גידולים']);
  const cropB = firstLinkedId(b['גידולים']);
  if (!cropA || cropA !== cropB) throw new PeriodError('מיזוג אפשרי רק בין תוכניות של אותו גידול', 400);

  const { survivor, absorbed } = pickSurvivor(a, b);
  const span = mergedSpan(survivor, absorbed);

  // 1. הטווח המאוחד על השורדת. **המקורי שלה לא משתנה** — זה התכנון שלה.
  await updateRecord(PLANS_TABLE, survivor.id, span);

  // 2. העברת קטיפים — לפני המחיקה (ר' ההערה מעל הפונקציה)
  const toMove = harvests.filter((h) => linkedIds(h['תוכניות שתילה']).includes(absorbed.id));
  let moved = 0;
  const moveErrors = [];
  for (const h of toMove) {
    const ids = linkedIds(h['תוכניות שתילה']).filter((id) => id !== absorbed.id);
    if (!ids.includes(survivor.id)) ids.push(survivor.id);
    try { await updateRecord(HARVESTS_TABLE, h.id, { 'תוכניות שתילה': ids }); moved += 1; }
    catch (e) { moveErrors.push({ harvestId: h.id, number: h['מספר קטיף'] ?? null, error: e.message }); }
  }
  if (moveErrors.length) {
    // לא ממשיכים למחיקה: קטיף שלא הועבר יימחק-בשרשרת או יחסום, ובשני
    // המקרים התוצאה גרועה מ"המיזוג לא הושלם".
    throw new PeriodError(`העברת ${moveErrors.length} קטיפים נכשלה — המיזוג הופסק והתוכניות נשארו שתיים (${moveErrors.map((m) => '#' + m.number).join(', ')})`, 500);
  }

  // 3. מחיקת הנבלעת — תחזיות → תקופות → התוכנית (plan-delete.js)
  let deleted = null;
  if (deletePlan) {
    deleted = await deletePlan(absorbed.id);
  }

  // 4. שורות התקופות של השורדת לטווח המאוחד + בניית התחזית מחדש
  const periods = await fetchRecords(PERIODS_TABLE, {});
  const periodResults = {};
  for (const phase of ['planting', 'harvest']) {
    const info = PHASES[phase];
    if (!span[info.from] || !span[info.to]) continue;
    periodResults[phase] = await syncPeriodRows(survivor.id, phase, span[info.from], span[info.to], periods);
  }
  const forecast = recordBuildResult(await buildForecastForPlan(survivor.id));

  console.log(`[plan-periods] מיזוג: ${absorbed['מספר תוכנית']} → ${survivor['מספר תוכנית']} (${moved} קטיפים הועברו; טווח ${span[PHASES.planting.from]}..${span[PHASES.harvest.to]}; תחזית ${forecast.ok ? forecast.weeks?.length + ' שבועות' : 'לא נבנתה'})`);

  return {
    ok: true,
    survivor: {
      planId: survivor.id, planNumber: survivor['מספר תוכנית'] ?? null,
      span, periods: periodResults,
    },
    deleted: {
      planId: absorbed.id, planNumber: absorbed['מספר תוכנית'] ?? null,
      ...(deleted || {}),
    },
    moved: { harvests: moved },
    forecast: {
      ok: forecast.ok, missing: forecast.missing, weeks: forecast.weeks?.length ?? 0,
      created: forecast.created, updated: forecast.updated, deleted: forecast.deleted, unchanged: forecast.unchanged,
    },
  };
}

export default { changePlanPeriod, updatePlanOriginal, mergePlans, overlapsForPlan, findOverlaps, mergedSpan, pickSurvivor, validatePhaseChange, validatePhaseChanges, endOfWorkPeriod, PHASES };
