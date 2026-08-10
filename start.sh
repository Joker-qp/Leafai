#!/bin/bash
echo "🌿 Leafai Web Uygulaması Başlatılıyor..."

# Sanal ortam kontrolü
if [ ! -d ".venv" ]; then
    echo "📦 Sanal ortam (.venv) bulunamadı, otomatik oluşturuluyor..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

echo "🚀 Sunucu Başlatılıyor! Adres: http://127.0.0.1:8000"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload