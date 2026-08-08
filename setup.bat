@echo off
setlocal

cd /d "%~dp0"
title Auto Compare Studio - Setup

echo.
echo Auto Compare Studio - cai moi truong
echo ====================================
echo.

rem Git is required by the in-app update checker.
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "PATH=%LocalAppData%\Programs\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 (
  echo Chua tim thay Git. Dang thu cai Git for Windows...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo Khong tim thay winget tren may nay.
    echo Hay cai Git tai: https://git-scm.com/install/windows
    start "" "https://git-scm.com/install/windows"
    pause
    exit /b 1
  )
  winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Cai Git that bai. Hay cai thu cong tai: https://git-scm.com/install/windows
    start "" "https://git-scm.com/install/windows"
    pause
    exit /b 1
  )
  if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
  if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "PATH=%LocalAppData%\Programs\Git\cmd;%PATH%"
)

where git >nul 2>&1
if errorlevel 1 (
  echo Khong tim thay Git sau khi cai. Hay dong cua so nay, mo lai roi chay setup.bat.
  pause
  exit /b 1
)
git --version

where node >nul 2>&1
if errorlevel 1 (
  echo Khong tim thay Node.js 18+.
  echo Hay cai Node.js tai: https://nodejs.org/en/download
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

node --version

if not exist ".env" if exist ".env.example" (
  copy /Y ".env.example" ".env" >nul
  echo Da tao file .env tu .env.example.
  echo Neu can tao giong noi moi, hay mo .env va dien API key cua ban.
)

if not exist "node_modules\" (
  echo.
  echo Dang cai thu vien Node.js, co the mat vai phut...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Cai thu vien that bai. Kiem tra Internet roi chay lai setup.bat.
    pause
    exit /b 1
  )
) else (
  echo Thu muc node_modules da ton tai, bo qua cai lai.
)

echo.
echo Da cai xong moi truong.
echo Hay bam start-studio.bat de mo ung dung.
pause
exit /b 0
