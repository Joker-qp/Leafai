@echo off
echo 🧠 Leafai Derin Ogrenme Egitimi Baslatiliyor...

if exist ".venv" (
    call .venv\Scripts\activate.bat
)

python train_model.py --epochs 10 --warmup 3 --batch-size 32
pause