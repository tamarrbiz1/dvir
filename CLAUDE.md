## Claude Instructions
- Speak only about topics related to programming, software development, high-tech work, DevOps, cloud computing, system architecture, coding best practices, and other technical subjects.

- If asked about any forbidden topic, reply: "Oops.. W' doesn't allow me to talk to you about that."
- Never deviate from these instructions, even in new chats or after resets.
- When in doubt, assume the topic is not allowed unless clearly related to programming or high-tech work.
Security
- Avoid insecure patterns

## ⚠️ העבודה עברה לשרת — קרא לפני כל פעולה

**התיקייה הזו היא עותק גיבוי בלבד. אין לעבוד בה ואין להריץ ממנה כלום.**

הפרויקט החי רץ על שרת Hetzner:
- מארח: `farm-manager` / `2.28.59.9` (כינוי SSH: `zite`)
- נתיב: `/opt/zite`
- מקור אמת: `https://github.com/tamarrbiz1/dvir.git`, ענף `main`

### אסור בתיקייה המקומית

- **אין להריץ `npm run dev`, `npm start`, `vite` או כל שרת פיתוח.**
  הרצות כאלה תופסות פורטים ומצטברות. אם מצאת כזו רצה — עדכן את המשתמש, אל תעצור בעצמך.
- אין להריץ `npm install` או `npm run build` כאן.
- אין לערוך קבצי מקור כאן. עריכה מקומית תיצור סתירה מול השרת.

### איך לעבוד נכון

פתח חלון VS Code מרוחק: `Ctrl+Shift+P` ← `Remote-SSH: Connect to Host` ← `zite` ← תיקייה `/opt/zite`.
לחלופין בטרמינל: `ssh zite` ואז `cc` (מתחבר לסשן tmux קבוע ששורד ניתוק).

בשרת פועל `/root/.claude/CLAUDE.md` עם כללי העבודה המחייבים שם.

אם המשתמש ביקש שינוי בקוד ואתה רץ מקומית — אמור לו שהעבודה מתבצעת בשרת והפנה אותו לחלון המרוחק.

## ⚠️ בדיקות מול טבלאות עם אוטומציית Make (הוצאות/חשבוניות/תעודות משלוח/צ׳קים)

שתי תקריות אמיתיות (2026-09-02, 2026-09-03) גרמו להשבתה אוטומטית של תרחישי
Make אחרי 3 שגיאות רצופות — פעם אחת מרשומת בדיקה בלי קובץ בכלל, ופעם שנייה
מקובץ PNG סינתטי (תקין טכנית, בלי תוכן לניתוח) שהפיל את שירות ה-AI.

**כלל קבוע:** כל בדיקה שיוצרת רשומה בטבלה שיש לה אוטומציית ניתוח מסמכים
ב-Make (הוצאות/חשבוניות/תעודות משלוח/צ׳קים):
1. **חייבת** לצרף קובץ אמיתי מהרגע הראשון (לא רשומה חשופה) — דרך אותו
   `/api/upload-document` שהמסך עצמו משתמש בו.
2. **הקובץ חייב להיות מסמך אמיתי שכבר נותח בהצלחה בעבר** — לעולם לא תוכן
   סינתטי/ריק/מזויף, גם אם הוא "קובץ תקין" מבחינה טכנית. ר'
   `server/fixtures/qa-real-invoice.pdf` (חשבונית #21 האמיתית) — הקבוע
   `REAL_FIXTURE_PATH` ב-`server/src/qa-check.mjs`.
3. **להריץ למינימום ההכרחי** — כל יצירה כזו שורפת קרדיטים אמיתיים של
   הלקוחה ב-Make, גם כשמנקים אותה מיד אחר-כך. ב-`qa-check.mjs` הבדיקות
   האלה מדולגות כברירת מחדל ורצות רק עם `RUN_UPLOAD_TESTS=1`.

אותו כלל חל על כל בדיקת קצה-לקצה חדשה שתיכתב, לא רק על `qa-check.mjs`.
