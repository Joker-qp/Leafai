import io
import os
from typing import List
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import HTMLResponse
from PIL import Image
import uuid
import json
import datetime

# Geri bildirim klasörleri
PENDING_DIR = os.path.join("data", "pending")      # Onay bekleyen geçici resimler
DATA_POOL_DIR = "data_pool"                        # Onaylanmış/Düzeltilmiş Veri Havuzu
FEEDBACK_LOG = os.path.join("data", "feedback_log.jsonl")

os.makedirs(PENDING_DIR, exist_ok=True)
os.makedirs(DATA_POOL_DIR, exist_ok=True)
os.makedirs("data", exist_ok=True)
# Kendi ayptığımız modülden fonksiyonları çağırıyoruz
from predict import load_model_and_classes, predict_image

# 1. FastAPI Uygulamasını Başlatıyoruz
app = FastAPI(
    title="Leafai -- Sağlıklı Toprak Sağlıklı Yaşam",
    description="Toprak ve Bitkiler",
    version="2.0.0",
)

# 2. Sunucu başlarken modeli RAM'e bir kez yüklüyoruz (Uygulama hızlı çalışsın diye)
print("Model ve sunıflar yükleniyor...")
MODEL, CLASS_NAMES = load_model_and_classes()
print("✅ Model hazır!")


@app.get("/", response_class=HTMLResponse)
def read_index():
    """
    Ana sayfaya girildiğinde index.html dosyasını okur ve
    kullanıcıya şık bir web arayüzü olarak sunar.
    """
    if os.path.exists("index.html"):
        with open("index.html", "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>index.html dosyası bulunamadı!</h1>"


@app.post("/predict")
async def predict_leaf(
    files: List[UploadFile] = File(...),
    plant_filter: str = Form("All")):
    """
    Tekli veya ÇOKLU resim yüklemelerini kabul eder.
    Her resim için yapay zeka tahminlerini toplu halde döner.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Hiçbir dosya gönderilmedi.")

    batch_results = []

    for file in files:
        # Resim olmayan dosyaları atla
        if not file.content_type.startswith("image/"):
            continue

        try:
            contents = await file.read()
            image = Image.open(io.BytesIO(contents))
            image.load()
            image = image.convert("RGB")
            
            # 💡 Geçici Kimlik Oluşturma ve Resmi Onay Bekleme Klasörüne Kaydetme
            image_id = uuid.uuid4().hex
            pending_path = os.path.join(PENDING_DIR, f"{image_id}.jpg")
            image.save(pending_path, format="JPEG", quality=92)

            preds = predict_image(MODEL, CLASS_NAMES, image, top_k=3, plant_filter=str(plant_filter))

            batch_results.append({
                "image_id": image_id, # <--- BENZERSİZ KİMLİK EKLENDİ
                "filename": file.filename,
                "predictions": preds
            })

        except Exception as e:
            batch_results.append({
                "filename": file.filename,
                "error": f"Resim işlenirken hata: {str(e)}"
            })

    return {
        "success": True,
        "total_files": len(batch_results),
        "batch_results": batch_results
    }

@app.post("/feedback")
async def save_feedback(
    image_id: str = Form(...),
    is_correct: bool = Form(...),
    predicted_raw: str = Form(...),
    correct_raw: str = Form(...)
):
    """
    Kullanıcının doğruladığı veya düzelttiği resmi data_pool klasörüne kaydeder.
    """
    pending_path = os.path.join(PENDING_DIR, f"{image_id}.jpg")
    if not os.path.exists(pending_path):
        raise HTTPException(status_code=404, detail="Geçici resim bulunamadı veya süresi dolmuş.")

    # Doğru olan etiket belirlenir
    final_label = predicted_raw if is_correct else correct_raw

    # data_pool/<sınıf_adı>/ klasörüne taşıyoruz
    class_dir = os.path.join(DATA_POOL_DIR, final_label)
    os.makedirs(class_dir, exist_ok=True)
    
    dest_path = os.path.join(class_dir, f"{uuid.uuid4().hex}.jpg")
    os.rename(pending_path, dest_path)

    # Geçmiş kaydı yazıyoruz (log)
    log_entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "image_id": image_id,
        "is_correct": is_correct,
        "predicted_label": predicted_raw,
        "final_label": final_label
    }
    with open(FEEDBACK_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    return {"success": True, "message": "Geri bildiriminiz Veri Havuzuna kaydedildi! Teşekkürler."}