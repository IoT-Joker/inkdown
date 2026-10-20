@echo off
chcp 65001 >nul
rem Double-click this file to launch Typra2.
rem It uses the bundled Node runtime and strips ELECTRON_RUN_AS_NODE,
rem which would otherwise make Electron run as plain Node and crash.

cd /d "%~dp0"

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Node.js not found. Install Node.js 20+ or run this directly:
    echo     node_modules\electron\dist\electron.exe .
    pause
    exit /b 1
  )
)

"%NODE_EXE%" "scripts\start.js"
if errorlevel 1 pause
