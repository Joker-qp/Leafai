@echo off
echo 🌿 Leafai Web Uygulamasi Baslatiliyor...

if not exist ".venv" (
    echo 📦 Sanal ortam (.venv) bulunamadi, otomatik olusturuluyor...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    python.exe -m pip install --upgrade pip
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo 🚀 Sunucu Baslatiliyor! Tarayici aciliyor...
start http://127.0.0.1:8000
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
