// ============================================================
// שרת Express + Airtable
// ============================================================
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getMeta, fetchRecords, createRecord, updateRecord, deleteRecord } from './airtable.js';
import { attachLinkedNames, invalidateIndex } from './resolve-links.js';

const app = express();
const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // יוגבל ב-Production

// CORS: ב-Dev פתוח, ב-Production מוגבל
app.use(cors(NODE_ENV === 'production' && ALLOWED_ORIGIN !== '*'
  ? { origin: ALLOWED_ORIGIN, credentials: true }
  : { origin: ALLOWED_ORIGIN }
));
app.use(express.json());

// רישום מעבר הבקשות לפתרון בעיות (ללא נתונים רגישים)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================
// ENDPOINTS
// ============================================================

// מטא-נתונים — רשימת טבלאות
app.get('/api/tables', async (_req, res) => {
  try {
    const tables = (await getMeta()).map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => f.name) }));
    res.json(tables);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// מטא-נתונים — שדות של טבלה ספציפית
app.get('/api/meta/:table', async (req, res) => {
  try {
    const meta = await getMeta();
    const table = meta.find((t) => t.name === req.params.table);
    if (!table) return res.status(404).json({ error: 'טבלה לא נמצאה' });
    res.json({ name: table.name, fields: table.fields.map((f) => f.name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// אפשרויות של שדה בחירה (singleSelect / multipleSelects).
// המסכים טוענים מכאן את הערכים המותרים, כדי לא לכתוב ל-Airtable
// ערך שאינו ברשימה — כתיבה כזו נדחית בשגיאת הרשאות.
app.get('/api/select-options/:table/:field', async (req, res) => {
  try {
    const meta = await getMeta();
    const table = meta.find((t) => t.name === req.params.table);
    if (!table) return res.status(404).json({ error: 'טבלה לא נמצאה' });
    const field = table.fields.find((f) => f.name === req.params.field);
    if (!field) return res.status(404).json({ error: 'שדה לא נמצא' });
    res.json({
      field: field.name,
      type: field.type,
      choices: (field.options?.choices || []).map((c) => c.name),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// העלאת מסמך ל-Airtable (שדה Attachment)
//
// חייב להיות מוגדר לפני '/api/:table', אחרת Express מתאים את
// הבקשה לנתיב הכללי ומנסה ליצור רשומה בטבלה "upload-document".
// ============================================================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.post('/api/upload-document', upload.single('file'), async (req, res) => {
  try {
    const { table, field, weekCode } = req.body;
    if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });
    if (!table || !field) return res.status(400).json({ error: 'פרמטרים חסרים' });

    const attachment = {
      filename: req.file.originalname,
      content: req.file.buffer.toString('base64'),
      type: req.file.mimetype,
    };

    const fields = { [field]: [attachment] };
    // נוסיף קוד שבוע רק לחשבוניות/תעודות משלוח אם נשלח
    if (weekCode && (table === 'חשבוניות' || table === 'תעודות משלוח')) {
      fields['קוד שבוע'] = weekCode;
    }

    const created = await createRecord(table, fields);
    invalidateReads(table);
    res.status(201).json({ ok: true, record: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// מטמון קריאה קצר
//
// מסך אחד טוען לרוב 4–6 טבלאות, וכמה מסכים חולקים את אותן טבלאות
// (מבנים, עובדים, גידולים). בלי מטמון, כל מעבר בין מסכים משלם שוב
// את זמן ההשהיה של Airtable. חלון קצר שומר על נתונים טריים
// ומתנקה מיידית בכל כתיבה.
// ============================================================
const READ_TTL_MS = 30 * 1000;
const readCache = new Map(); // key -> { at, payload }

function cacheKeyFor(table, query) {
  const relevant = ['filterByFormula', 'sortField', 'sortDirection', 'maxRecords', 'pageSize', 'raw'];
  return table + '|' + relevant.map((k) => `${k}=${query[k] ?? ''}`).join('&');
}

/** מנקה את המטמון לטבלה שהשתנתה (ואת כל התלויות בה, כי שמות מקושרים משתנים) */
function invalidateReads(table) {
  for (const key of readCache.keys()) {
    if (key.startsWith(table + '|')) readCache.delete(key);
  }
  // שם מקושר של הטבלה הזו מופיע גם ברשומות של טבלאות אחרות
  invalidateIndex(table);
  readCache.clear();
}

// רשומות מטבלה (עם filters / sort / limit)
app.get('/api/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const key = cacheKeyFor(table, req.query);
    const cached = readCache.get(key);
    if (cached && Date.now() - cached.at < READ_TTL_MS) {
      res.set('X-Cache', 'HIT');
      return res.json(cached.payload);
    }

    const opts = {};
    if (req.query.filterByFormula) opts.filterByFormula = req.query.filterByFormula;
    if (req.query.sortField) opts.sort = [{ field: req.query.sortField, direction: req.query.sortDirection || 'asc' }];
    if (req.query.maxRecords) opts.maxRecords = parseInt(req.query.maxRecords, 10);
    if (req.query.pageSize) opts.pageSize = parseInt(req.query.pageSize, 10);
    const records = await fetchRecords(table, opts);

    // העשרה: שדות מקושרים -> אובייקטים עם שם (אלא אם raw=1)
    const payload = req.query.raw === '1' ? records : await attachLinkedNames(table, records);
    readCache.set(key, { at: Date.now(), payload });
    res.set('X-Cache', 'MISS');
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// רשומה ספציפית
app.get('/api/:table/:id', async (req, res) => {
  try {
    const base = (await import('./airtable.js')).getBase();
    const rec = await base(req.params.table).find(req.params.id);
    res.json({ id: rec.id, ...rec.fields });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// יצירת רשומה
app.post('/api/:table', async (req, res) => {
  try {
    const created = await createRecord(req.params.table, req.body);
    invalidateReads(req.params.table); // כדי שהרשומה החדשה תיקרא מיד ותיפתר לשם
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// עדכון רשומה
app.patch('/api/:table/:id', async (req, res) => {
  try {
    const updated = await updateRecord(req.params.table, req.params.id, req.body);
    invalidateReads(req.params.table);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// מחיקה
app.delete('/api/:table/:id', async (req, res) => {
  try {
    await deleteRecord(req.params.table, req.params.id);
    invalidateReads(req.params.table);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ שרת Zite רץ על http://localhost:${PORT}`);
});
