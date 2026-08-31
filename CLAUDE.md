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
