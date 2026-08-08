@echo off
setlocal

cd /d "%~dp0"
title Auto Compare Studio - Setup

echo.
echo Auto Compare Studio - cai moi truong
echo ====================================
echo.

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
