@echo off
title WA Outreach
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first time only...
  call npm install || goto :error
)
if not exist web\dist\index.html (
  echo Building the dashboard, first time only...
  call npm run build || goto :error
)
start "" http://localhost:4000
call npm start
goto :eof

:error
echo.
echo Something went wrong. Check the messages above.
pause
