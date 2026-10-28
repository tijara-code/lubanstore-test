@echo off
rem Double-click: the admin panel on this computer, already signed in, with an invented shop.
rem Nothing reaches a real service (fake Thawani / Omniful / pixels; a local database in .data).
rem Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Get version 22 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing packages. This takes a minute or two.
  call npm install
  if errorlevel 1 (
    echo npm install failed - see the message above.
    pause
    exit /b 1
  )
)
call npm run admin:local
pause