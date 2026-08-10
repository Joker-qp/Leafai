# 🌿 Leafai - Leafai -- Sağlıklı Toprak Sağlıklı Yaşam

  

![Python](https://img.shields.io/badge/Python-3.11-blue)

![PyTorch](https://img.shields.io/badge/PyTorch-2.0+-EE4C2C)

![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688)

![Accuracy](https://img.shields.io/badge/Validation%20Accuracy-99.28%25-brightgreen)

  

Leafai, PlantVillage veri seti üzerinde **MobileNetV2** mimarisi ve iki aşamalı **Fine-Tuning (İnce Ayar)** teknikleri kullanılarak eğitilmiş, yüksek başarı oranına sahip web tabanlı bir tarımsal yapay zeka teşhis sistemidir.

  

Proje, yalnızca statik tahmin yapmakla kalmaz; kullanıcı geri bildirimleriyle sürekli gelişen **Active Learning (Aktif Öğrenme / Human-in-the-Loop)** altyapısına sahiptir.

  

---

  

## 🎯 Proje Özellikleri

  

- **%99.28 Doğrulama Başarısı (Validation Accuracy):** 162.916 görsel içeren (Color, Grayscale, Segmented) devasa veri kümesi üzerinde eğitilmiştir.

- **Toplu ve Çoklu Analiz (Batch Prediction):** Birden fazla yaprak fotoğrafını aynı anda yükleyip saniyeler içinde toplu teşhis raporu alma.

- **Canlı HTML5 Kamera Desteği:** Masaüstü ve mobil cihazların kameralarıyla anlık fotoğraf çekip analiz etme.

- **Hiyerarşik Teşhis & Bitki Filtreleme:** Bitki Türü (Domates, Elma, Patates vb.) ve Hastalık Teşhisini ayrıştırarak gösterme; isteğe bağlı bitki filtresi uygulama.

- **Akıllı Güven Eşiği (Thresholding):** %65 altındaki düşük güvenli tahminlerde kullanıcıyı uyarma.

- **Kullanıcı Geri Bildirimi & Aktif Öğrenme (Human-in-the-Loop):** Yanlış tahminleri kullanıcıların düzeltmesine imkan tanıma ve düzeltilen verileri `data_pool/` klasöründe toplama.

- **Tek Tıkla Otomatik Yeniden Eğitim (`retrain.py`):** Veri havuzunda biriken gerçek dünya fotoğraflarıyla modeli anında güncelleyebilme.

  

---


## 📐 Sistem Mimarisi

```c

[Kullanıcı Arayüzü (Web / Kamera)]

│

▼ (HTTP POST / Multipart)

[FastAPI REST Servisi]

           │

┌──────────┴──────────┐

▼                     ▼

[Inference Engine] [Data Pool / Active Learning]

(PyTorch MobileNetV2) (Hatalı/Onaylı Veri Kaydı)

│                      │
 
▼                     ▼

[%99.28 Tahmin] [retrain.py (Auto Fine-Tune)]
```


📊 Model Eğitim Başarısı (Training Metrics)

```python
Model, NVIDIA RTX 3060 GPU üzerinde 2 aşamalı olarak eğitilmiştir:

Isınma Aşaması (Warmup - 3 Epoch): Gövde kilitli, sadece sınıflandırıcı eğitildi (lr=1e-3).

Fine-Tuning Aşaması (7 Epoch): MobileNetV2 derin katmanlarının kilidi açıldı (lr=1e-4).
```

```python
Epoch 01/10 (Warmup) | Val Acc: %92.55 | Loss: 0.2274

Epoch 04/10 (FineTune) | Val Acc: %97.75 | Loss: 0.0637

Epoch 07/10 (FineTune) | Val Acc: %99.18 | Loss: 0.0238

Epoch 10/10 (FineTune) | Val Acc: %99.28 | Loss: 0.0213 ⭐ (EN İYİ MODEL)
```


🚀 Kurulum ve Çalıştırma

1. Bağımlılıkları Yükleyin
```python
python -m venv .venv

source .venv/bin/activate # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```


2. Modeli Eğitin (Opsiyonel - Hazır model yoksa)

```python
python train_model.py --epochs 10 --warmup 3 --batch-size 32
```

1. Web Sunucusunu Başlatın

```python
uvicorn main:app --reload

Tarayıcınızda http://127.0.0.1:8000 adresine giderek uygulamayı kullanabilirsiniz.
```

🔄 Aktif Öğrenme ve Yeniden Eğitim

Kullanıcıların web sitesinde ✏️ Düzelt butonuyla düzelttiği fotoğraflar data_pool/ dizininde toplanır. Bu verilerle modeli tek tıkla güncellemek için:

```python
python retrain.py
```

🛠️ Kullanılan Teknolojiler

| Backend / API    | FastAPI, Uvicorn, Pydantic                        |
| ---------------- | ------------------------------------------------- |
| Deep Learning    | PyTorch, Torchvision, MobileNetV2                 |
| Image Processing | Pillow                                            |
| Frontend         | HTML5, CSS3, JavaScript (Fetch API, MediaDevices) |
| Data Source      | Kaggle PlantVillage Dataset (162k Images)<br>     |
