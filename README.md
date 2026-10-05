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
