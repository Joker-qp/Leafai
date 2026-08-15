#!/bin/bash
echo "🧠 Leafai Derin Öğrenme Eğitimi Başlatılıyor..."

if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

python train_model.py --epochs 10 --warmup 3 --batch-size 32