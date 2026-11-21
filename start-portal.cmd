@echo off
setlocal
cd /d "%~dp0"

set "NODE_HOME=%LOCALAPPDATA%\Programs\nodejs-portal"
if exist "%NODE_HOME%\node.exe" (
  set "PATH=%NODE_HOME%;%PATH%"
  call "%NODE_HOME%\npm.cmd" start
  exit /b %ERRORLEVEL%
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or later is required. Install it, then run this file again.
  pause
  exit /b 1
)

npm start
