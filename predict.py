import os
import json
import torch
import torch.nn as nn
from torchvision import transforms, models
from PIL import Image

# Dosya Yoları ve Sabitler
MODEL_PATH = os.path.join("models", "leaf_disease_model.pth")
CLASSES_PATH = os.path.join("models", "class_names.json")
IMG_SIZE = 224

def load_model_and_classes():
    """Disk üzerindeki kayıtlı modeli ve sınıf isimlerini hafızaya yükler."""

    model_exists = os.path.exists(MODEL_PATH)
    classes_exists = os.path.exists(CLASSES_PATH)

    # 🛑 1. Dosyalardan biri bile eksikse çökme yerine kontrol mekanizması çalışır
    if not model_exists or not classes_exists:
        print("\n" + "="*50)
        print("⚠️  UYARI: Yapay zeka model dosyaları bulunamadı!")
        print(f"   - Model Yolu ({MODEL_PATH}): {'✅ VAR' if model_exists else '❌ EKSİK'}")
        print(f"   - Sınıf Yolu ({CLASSES_PATH}): {'✅ VAR' if classes_exists else '❌ EKSİK'}")
        print("="*50)

        # Kullanıcıya Terminalden soruyoruz
        choice = input("\n🧪 Uygulama 'TEST / MOCK' modunda başlatılsın mı? (E/h): ").strip().lower()

        if choice in ["", "e", "evet", "y", "yes"]:
            print("\n✅ Uygulama TEST MODUNDA başlatılıyor...")
            print("   (Gerçek model yüklenmedi, sanal test sonuçları üretilecek)\n")
            # Model yerine None, sınıflar yerine test sınıfları döndürüyoruz
            return None, ["Test___Healthy_Sample", "Test___Disease_Sample"]
        else:
            print("\n❌ Kullanıcı tercihi ile uygulama durduruldu.")
            raise FileNotFoundError("Model dosyaları bulunamadığı için başlatılamadı.")
    # 🟢 2. Dosyalar tamsa normal yükleme yapılır

    # Sınıf isimlerni (örn: "Apple_healty") JSON dosyasını okuyoruz
    with open(CLASSES_PATH, "r", encoding="utf-8") as f:
        class_name = json.load(f)

    # Eğittiğimiz boş MobileNetV2 mimarisini oluşturuyoruz
    model = models.mobilenet_v2(weights=None)

    # Son katmanı (sınıflandırıyıcıyı) kendi sınıf sayımızla (38 sınıf) uyarlıyoruz
    model.classifier[1] = nn.Linear(model.last_channel, len(class_name))

    # Eğitilmiş ağırlıkları (weights) dosyadan modelin içerisine yüklüyoruz
    model.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))

    # Model "Tahmin" (Inference moduna alıyoruz)
    model.eval()

    return model, class_name

# Resim Dönüştürme (Preprocessing) Kuralları
TRANSFORM = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)), # Resmi 224x224 pixsele getirir
    transforms.ToTensor(), # Resmi 0-1 arası sayılardan oluşan bir Matrise (Tensor) çevirir
    transforms.Normalize( # Renkleri yapay zekanın eğitildiği standartlara getirir
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    ),
])
def predict_image(model, class_names, image, top_k: int = 3, plant_filter: str = "All"):
    """
    plant_filter: 'All' (Tümü) veya belirli bir bitki adı ('Tomato', 'Apple', 'Potato' vb.)
    """
    # 🧪 1. TEST MODU KONTROLÜ
    if model is None:
        return [
            {
                "raw_label": "Test___Mock_Disease_Found",
                "plant_name": "🧪 TEST MODU",
                "disease_name": "Örnek Hastalık (Sanal)",
                "confidence": 98.45,
                "warning": None
            }
        ]

    # 🟢 2. RENK FORMATINI SAF RGB'YE GARANTİ ÇEVİRME (HATA ÇÖZÜMÜ)
    if isinstance(image, Image.Image):
        image.load()
        image = image.convert("RGB")
    else:
        image = Image.fromarray(image).convert("RGB")

    tensor_img = TRANSFORM(image).unsqueeze(0)

    with torch.no_grad():
        outputs = model(tensor_img)
        probabilities = torch.softmax(outputs, dim=1)[0]

        # 💡 YENİ BİTKİ FİLTRELEME MANTIĞI:
        # Eğer kullanıcı özel bir bitki seçtiyse (örn: 'Tomato'), diğer bitkilerin olasılığını 0 yapıyoruz
        filter_str = str(plant_filter.default) if hasattr(plant_filter, 'default') else str(plant_filter)
        if filter_str and filter_str != "All":
            mask = torch.tensor([1.0 if c.startswith(plant_filter) else 0.0 for c in class_names], device=outputs.device)
            probabilities = probabilities * mask
            if probabilities.sum() > 0:
                probabilities = probabilities / probabilities.sum() # Yüzdeleri filtreye göre yeniden hesapla

        top_probs, top_indices = torch.topk(probabilities, k=min(top_k, len(class_names)))

    results = []
    for prob, idx in zip(top_probs.tolist(), top_indices.tolist()):
        raw_name = class_names[idx]
        
        # 💡 HİYERARŞİK AYRIŞTIRMA: 'Tomato___Early_blight' -> Plant: Tomato, Disease: Early blight
        if "___" in raw_name:
            plant_part, disease_part = raw_name.split("___", 1)
        else:
            plant_part, disease_part = "Genel", raw_name

        plant_display = plant_part.replace("_", " ")
        disease_display = disease_part.replace("_", " ")
        confidence = round(prob * 100, 2)

        # 💡 AKILLI GÜVEN EŞİĞİ UYARISI
        warning = None
        if confidence < 65.0:
            warning = "⚠️ Güven skoru düşük. Yaprağı daha yakın çekebilir veya filtreyi kontrol edebilirsiniz."

        results.append({
            "raw_label": raw_name,
            "plant_name": plant_display,
            "disease_name": disease_display,
            "confidence": confidence,
            "warning": warning
        })

    return results
