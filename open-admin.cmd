@echo off
rem Double-click: the admin panel on this computer, already signed in, with an invented shop.
rem Nothing reaches a real service (fake Thawani / Omniful / pixels; a local database in .data).
rem Close this window to stop it.
cd /d "%~dp0"

rem Node may be installed but missing from PATH (a window opened before the install): look in
rem the usual places first.
where node >nul 2>&1
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

where node >nul 2>&1
if not errorlevel 1 goto :haveNode

echo Node.js is not installed on this computer. The admin panel needs it to run locally.
echo.
where winget >nul 2>&1
if errorlevel 1 goto :manual
set /p GO="Install Node.js (LTS) now? Windows may ask for permission. [Y/n] "
if /i "%GO%"=="n" goto :manual
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto :manual
echo.
echo Node.js installed.
goto :haveNode

:manual
echo.
echo Install it by hand: open https://nodejs.org, download the "LTS" Windows installer,
echo run it with the default options, then double-click open-admin.cmd again.
pause
exit /b 1

:haveNode
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo Node.js %NODEMAJOR% is too old: version 22 or newer is needed. Get the LTS from https://nodejs.org
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
