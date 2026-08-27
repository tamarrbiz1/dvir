@echo off
chcp 65001 >nul
title משק חקלאי — הרצה מקומית
cd /d "%~dp0"

echo ============================================
echo   מערכת משק חקלאי — מפעיל שרת + לקוח
echo ============================================
echo.

if not exist ".env" (
  echo [שגיאה] קובץ .env חסר. העתק את .env.example ל-.env ומלא את המפתחות.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo מתקין חבילות שרת...
  pushd server && call npm install && popd
)

if not exist "client\node_modules" (
  echo מתקין חבילות לקוח...
  pushd client && call npm install && popd
)

echo מפעיל שרת על פורט 4000...
start "Zite Server" cmd /k "cd /d "%~dp0server" && npm start"

echo ממתין לעליית השרת...
timeout /t 4 /nobreak >nul

echo מפעיל לקוח על פורט 5173...
start "Zite Client" cmd /k "cd /d "%~dp0client" && npm run dev"

timeout /t 4 /nobreak >nul
start "" http://localhost:5173

echo.
echo מוכן. שני חלונות נפתחו (שרת + לקוח). סגירתם עוצרת את המערכת.
