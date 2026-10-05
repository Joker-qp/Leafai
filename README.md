# 🫒 Gemlik Zeytini Yaprak Hastalıkları Teşhis ve Zirai Reçete Motoru

[![Streamlit App](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://share.streamlit.io)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Segmentation-00FFFF)](https://ultralytics.com)
[![EfficientNet-B0](https://img.shields.io/badge/EfficientNet--B0-Classification-FF6F00)](https://pytorch.org)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-Optimized-005CED?logo=onnx&logoColor=white)](https://onnxruntime.ai/)
[![Accuracy](https://img.shields.io/badge/Val_Accuracy-%2598.99-brightgreen)]()

Gemlik tipi zeytin ağaçlarında (*Olea europaea*) verim ve rekolte kaybına yol açan iki kritik patojenik zararı (**Halkalı Leke** ve **Zeytin Pas Akarı**) tespit eden, piksel hassasiyetinde segmentasyon ve derin sınıflandırma yeteneğine sahip iki aşamalı (hibrit) yapay zekâ tanı motorudur.

---

## 📌 Temel Özellikler

* **İki Kademeli Hibrit Mimari:** 
  1. **Kademe (Segmentasyon):** YOLOv8s-seg ile yaprak sınırları ve hastalık lezyonları piksel bazında taranır.
  2. **Kademe (Morfolojik Sınıflandırma):** Gürültülü arka plan (masa, kâğıt, zemin) tamamen izole edilir; siyah arka plana oturtulan yaprak dokusu EfficientNet-B0 ile analiz edilir.
* **Sınıf Dengesizliği (Class Imbalance) Çözümü:** Veri kümesinde azınlıkta olan Pas Akarı sınıfı, **Weighted Cross-Entropy Loss** katsayıları ve morfolojik veri zenginleştirme (Data Augmentation) ile dengelenmiş; test setinde **%100 Duyarlılık (Recall)** elde edilmiştir.
* **Hastalık Şiddeti Hesabı:** $\frac{\text{Leke Alanı}}{\text{Yaprak Alanı}} \times 100$ bağıntısıyla enfekte doku yüzdesi sayısal olarak raporlanır.
* **Zirai Mücadele Reçetesi:** Teşhis edilen patojene özel fenolojik döneme uygun mücadele takvimi (Bordo Bulamacı, Bakır preparatları veya Kükürt/Akarisit önerisi) sunulur.
* **ONNX Runtime ile CPU Optimizasyonu:** Modeller hantal bağımlılıklardan arındırılarak düşük kaynaklı sunucularda ve mobil cihazlarda mikrosaniyelik çıkarım (inference) hızına ulaştırılmıştır.

---

## 🏗️ Sistem ve İş Akış Şeması

```mermaid
flowchart TD
    A[Ham Yaprak Fotoğrafı / Kamera Girdisi] --> B[Model 1: YOLOv8s-seg ONNX]
    B --> C{Lezyon Tespit Edildi mi?}
    C -- Evet --> D[Teşhis: Halkalı Leke - Spilocaea oleagina]
    D --> D1[Leke Alanı Oranı ile Hastalık Şiddeti % Hesabı]
    C -- Hayır --> E[Arka Planı İzole Et ve Kırp - RGB 0,0,0]
    E --> F[Model 2: EfficientNet-B0 ONNX]
    F --> G{Morfolojik Doku Analizi}
    G --> H[Teşhis: Sağlıklı Yaprak]
    G --> I[Teşhis: Zeytin Pas Akarı - Aceria oleae]
    D --> J[Zirai Mücadele ve İlaçlama Reçetesi]
    H --> J
    I --> J

📊 Model Başarım Metrikleri
1. Model: YOLOv8s-seg (Segmentasyon)
Hedef Sınıf	Örnek Sayısı	Mask Precision	Mask Recall	Mask mAP50	Mask mAP50-95
leaf (Yaprak)	112	0.962	1.000	0.994	0.969
lession (Leke)	60	0.910	0.767	0.816	0.516
Tüm Sınıflar (Ort.)	172	0.936	0.879	0.905	0.742
2. Model: EfficientNet-B0 (Sınıflandırma - Weighted Loss)
Sınıf Adı	Precision	Recall (Duyarlılık)	F1-Score	Doğrulama Desteği (Support)
Healthy (Sağlıklı)	0.988	0.992	0.990	259
acerculus_olearius (Pas Akarı)	0.980	1.000	0.990	100
olive_peacock_spot (Halkalı Leke)	0.994	0.985	0.989	332
Genel Doğruluk (Accuracy)	-	-	%98.99	691
📁 Proje Dosya Yapısı
code Text

├── models/
│   ├── yolov8_zeytin_seg.onnx       # Piksel hassasiyetinde segmentasyon modeli (45.2 MB)
│   ├── efficientnet_classifier.onnx # Morfolojik sınıflandırma modeli (15.9 MB)
│   └── model_metadata.json          # Sınıf indeksleri ve normalizasyon künyesi
├── app.py                           # Streamlit arayüz ve uçtan uca çıkarım kodu
├── requirements.txt                 # Minimum ve hafif bağımlılık listesi
└── README.md                        # Proje dokümantasyonu

💻 Yerel Kurulum ve Çalıştırma

    Depoyu klonlayın:
    code Bash

    git clone https://github.com/Joker-qp/Leafai.git
    cd Leafai

    Gerekli kütüphaneleri yükleyin:
    code Bash

    pip install -r requirements.txt

    Web arayüzünü başlatın:
    code Bash

    streamlit run app.py

🔮 Gelecek Planları (Roadmap)

    YOLOv8-seg lezyon ve yaprak segmentasyon motoru.

    Arka plan yalıtımlı EfficientNet-B0 sınıflandırıcısı.

    ONNX formatında hafifletilmiş çıkarım motoru.

    Streamlit web ve mobil kamera arayüzü.

    LLM Destekli Zirai Chatbot: Çiftçinin anlık sorularını yanıtlayan RAG destekli akıllı asistan entegrasyonu.

    Saha testleri ve kenar cihaz (Raspberry Pi / Jetson) entegrasyonu.

code Code

Bu adımları tamamladığında depon hem kurumsal bir yapay zekâ araştırma projesi ciddiyetine kavuşacak hem de bir sonraki aşama olan "Chatbot / Genişletilmiş Proje" için zemin tertemiz hazır olacaktır!
