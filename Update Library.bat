@echo off
rem Double-click after adding or changing books in the content folder.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from nodejs.org and try again.
  pause
  exit /b 1
)
node scripts\publish.mjs
echo.
pause
