@echo off
setlocal

cd /d "%~dp0"
set "STUDIO_PORT=3101"
set "APP_URL=http://127.0.0.1:%STUDIO_PORT%"
set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NPM_CMD%" (
  set "NPM_CMD="
  for /f "delims=" %%N in ('where.exe npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%N"
)
if not exist "%NODE_EXE%" (
  set "NODE_EXE="
  for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
)

rem Disable QuickEdit so an accidental click cannot put the console into
rem "Select" mode and pause startup.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Add-Type -Namespace Win32 -Name ConsoleMode -MemberDefinition '[DllImport(\"kernel32.dll\", SetLastError=true)] public static extern System.IntPtr GetStdHandle(int nStdHandle); [DllImport(\"kernel32.dll\", SetLastError=true)] public static extern bool GetConsoleMode(System.IntPtr hConsoleHandle, out int lpMode); [DllImport(\"kernel32.dll\", SetLastError=true)] public static extern bool SetConsoleMode(System.IntPtr hConsoleHandle, int dwMode);'; $h=[Win32.ConsoleMode]::GetStdHandle(-10); $mode=0; if([Win32.ConsoleMode]::GetConsoleMode($h, [ref]$mode)){ $mode=($mode -bor 0x80) -band (-bnot 0x40); [Win32.ConsoleMode]::SetConsoleMode($h, $mode) | Out-Null } } catch {}" >nul 2>nul

echo.
echo Auto Compare Studio App
echo =======================
echo.

echo [1/4] Kiem tra Node va Electron...
if not defined NPM_CMD (
  echo Khong tim thay npm.cmd. Hay cai Node.js roi chay lai.
  goto fail
)
if not defined NODE_EXE (
  echo Khong tim thay node.exe. Hay cai Node.js roi chay lai.
  goto fail
)
if not exist "node_modules\" (
  call "%NPM_CMD%" install
  if errorlevel 1 goto fail
) else if not exist "node_modules\electron\" (
  call "%NPM_CMD%" install
  if errorlevel 1 goto fail
) else (
  echo node_modules da co.
)

echo [2/4] Mo Auto Compare app...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $logs=Join-Path $env:LOCALAPPDATA 'AutoCompareStudio\logs'; New-Item -ItemType Directory -Force -Path $logs | Out-Null; $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $out=Join-Path $logs ('app-' + $stamp + '.out.log'); $err=Join-Path $logs ('app-' + $stamp + '.err.log'); Start-Process -FilePath '%NODE_EXE%' -ArgumentList @('app/electron/start-app.cjs') -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err"

echo [3/4] Doi app core san sang...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%APP_URL%/api/status'; for($i=0; $i -lt 120; $i++){ try { Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 goto fail

echo [4/4] Xong.
echo.
echo Auto Compare Studio dang chay bang app rieng.
exit /b 0

:fail
echo.
echo Khong khoi dong duoc app. Xem loi phia tren hoac log trong %%LOCALAPPDATA%%\AutoCompareStudio\logs.
pause
exit /b 1
