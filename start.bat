@echo off
chcp 65001 >nul
title Leafai Web Uygulamasi

echo.
echo 🌿 Leafai Web Uygulamasi Baslatiliyor...
echo.

:: 1. Python kontrolu
python --version >nul 2>&1
if errorlevel 1 goto NOPYTHON

:: 2. Sanal ortam (.venv) kontrolu
if not exist ".venv" goto SETUPVENV

goto RUNAPP

:SETUPVENV
echo 📦 Sanal ortam (.venv) bulunamadi, otomatik olusturuluyor...
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
goto RUNAPP

:NOPYTHON
echo.
echo ❌ HATA: Python bilgisayarinizda bulunamadi veya PATH'e eklenmemis!
echo Lutfen python.org adresinden Python kurulurken "Add python.exe to PATH" kutucugunu isaretleyin.
echo.
pause
exit /b

:RUNAPP
call .venv\Scripts\activate.bat
echo 🚀 Sunucu Baslatiliyor: http://127.0.0.1:8000
start http://127.0.0.1:8000
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause