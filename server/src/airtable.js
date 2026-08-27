// ============================================================
// שכבת החיבור ל-Airtable — מרכז הכל
// קורא את המשתנים ישירות מקובץ .env בשורש הפרויקט
// באמצעות fs (ללא תלות בספריית dotenv), ומניח אותם ב-process.env.
// חשוב: קובץ .env לעולם אינו נקרא ישירות כטקסט בין השורות,
// והטוקן לעולם אינו נשלח ללקוח או מודפס.
// ============================================================

import path from 'path';
import fs from 'fs';
import Airtable from 'airtable';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// מחפש את קובץ .env במעלה העץ (עד שנמצא); מחזיר את הנתיב או null
function findEnvFile(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// פונקציה פנימית: טוען קובץ .env פשוט (k=v) אל process.env
function loadEnv(startDir) {
  const envPath = findEnvFile(startDir);
  if (!envPath) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // הסרת גרשיים מסביב אם יש
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(__dirname);

const PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

let baseInstance = null;

export function getBase() {
  if (!PAT) throw new Error('AIRTABLE_PAT חסר.');
  if (!BASE_ID) throw new Error('AIRTABLE_BASE_ID חסר.');

  if (!baseInstance) {
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: PAT,
    });
    baseInstance = Airtable.base(BASE_ID);
  }
  return baseInstance;
}

// ============================================================
// מטא-נתונים: רשימת טבלאות ושדות — דרך ה-API הרשמי
// (מחזיר רק שמות ומבנה; אינו חושף את הסוד)
// ============================================================
export async function getMeta() {
  if (!PAT || !BASE_ID) {
    throw new Error('סודות חסרים — בדוק את קובץ .env');
  }
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable metadata error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.tables;
}

// ============================================================
// קריאת רשומות / כתיבה
// ============================================================
export async function fetchRecords(tableName, options = {}) {
  const base = getBase();
  const records = [];
  await base(tableName).select(options).eachPage((page, fetchNextPage) => {
    records.push(...page.map((r) => ({ id: r.id, ...r.fields })));
    fetchNextPage();
  });
  return records;
}

export async function createRecord(tableName, fields) {
  const base = getBase();
  const created = await base(tableName).create(fields);
  return { id: created.id, ...created.fields };
}

export async function updateRecord(tableName, recordId, fields) {
  const base = getBase();
  const updated = await base(tableName).update(recordId, fields);
  return { id: updated.id, ...updated.fields };
}

export async function deleteRecord(tableName, recordId) {
  const base = getBase();
  await base(tableName).destroy(recordId);
  return true;
}

export default {
  getBase,
  getMeta,
  fetchRecords,
  createRecord,
  updateRecord,
};
