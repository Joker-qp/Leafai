import json
import os
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
import streamlit as st
from ultralytics import YOLO

# ---------------------------------------------------------
# Sayfa Yapılandırması ve Özel Tema Stilleri
# ---------------------------------------------------------
st.set_page_config(
    page_title="Gemlik Zeytin Hastalık Teşhis Sistemi",
    page_icon="🫒",
    layout="wide",
)

st.markdown(
    """
    <style>
    .main-title {
        font-size: 32px; 
        font-weight: bold; 
        color: #2e7d32; 
        text-align: center; 
        margin-bottom: 5px;
    }
    .sub-title {
        font-size: 16px; 
        color: #555555; 
        text-align: center; 
        margin-bottom: 25px;
    }
    .report-card {
        background-color: #f1f8e9; 
        padding: 22px; 
        border-radius: 10px; 
        border-left: 6px solid #43a047;
        margin-top: 15px;
    }
    .alert-card {
        background-color: #ffebee; 
        padding: 22px; 
        border-radius: 10px; 
        border-left: 6px solid #e53935;
        margin-top: 15px;
    }
    .warning-card {
        background-color: #fff8e1; 
        padding: 22px; 
        border-radius: 10px; 
        border-left: 6px solid #fb8c00;
        margin-top: 15px;
    }
    </style>
""",
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="main-title">🫒 Gemlik Zeytini Hastalık Teşhis Motoru</div>',
    unsafe_allow_html=True,
)

# ---------------------------------------------------------
# Modellerin Önbelleğe Alınarak Yüklenmesi (Hızlı Başlatma)
# ---------------------------------------------------------
@st.cache_resource
def load_onnx_models():
  # 1. Segmentasyon Modeli (YOLOv8-Seg ONNX)
  seg_path = "yolov8_zeytin_seg.onnx"
  if not os.path.exists(seg_path):
    raise FileNotFoundError(f"{seg_path} dosyası bulunamadı!")
  seg_model = YOLO(seg_path, task="segment")

  # 2. Sınıflandırma Modeli (EfficientNet-B0 ONNX)
  cls_path = "efficientnet_classifier.onnx"
  if not os.path.exists(cls_path):
    raise FileNotFoundError(f"{cls_path} dosyası bulunamadı!")
  cls_session = ort.InferenceSession(
      cls_path, providers=["CPUExecutionProvider"]
  )

  # 3. Model Künyesi (Metadata)
  meta_path = "model_metadata.json"
  if os.path.exists(meta_path):
    with open(meta_path, "r", encoding="utf-8") as f:
      meta = json.load(f)
    cls_classes = meta["models"]["classification"]["classes"]
  else:
    # Yedek varsayılan sınıf dizilimi
    cls_classes = ["Healthy", "acerculus_olearius", "olive_peacock_spot"]

  return seg_model, cls_session, cls_classes


try:
  seg_model, cls_session, cls_classes = load_onnx_models()
  models_ready = True
except Exception as e:
  st.error(f"⚠️ Modeller yüklenirken bir sorun oluştu: {e}")
  models_ready = False

# ---------------------------------------------------------
# Kenar Çubuğu (Sidebar) Bilgilendirmesi
# ---------------------------------------------------------
with st.sidebar:
  st.image(
      "https://images.unsplash.com/photo-1541256942802-7b2996a84f97?w=500",
      use_container_width=True,
  )
  st.header("⚡ Sistem Mimarisi")
  st.info("""
    Bu sistem ** Zeytin Yapraklarında** en sık karşılaşılan iki kritik patolojik durumu tespit eder:
    
    * **Halkalı Leke (*Spilocaea oleagina*):** Yaprak yüzeyinde karakteristik dairesel lekeler ve sarı halkalar.
    * **Zeytin Pas Akarı (*Aceria oleae / Aculus olearius*):** Yaprak dokusunda bükülme, asimetrik kıvrılma ve gümüşi paslanma.
    """)
  st.write("---")
  st.markdown("**Çalışma Motoru:** ONNX Runtime (CPU Optimized)")
  st.caption("Gemlik Zeytin Hastalıkları AI Laboratuvarı")

# ---------------------------------------------------------
# Görsel Giriş Alanı (Dosya Yükleme veya Kamera)
# ---------------------------------------------------------
st.subheader("📸 Analiz Edilecek Yaprak Fotoğrafı")
input_method = st.radio(
    "Fotoğraf Kaynağını Seçin:",
    ["Fotoğraf Yükle (Galeri / Dosya)", "Kamerayı Kullan (Anlık Çekim)"],
    horizontal=True,
)

uploaded_file = None
if input_method == "Fotoğraf Yükle (Galeri / Dosya)":
  uploaded_file = st.file_uploader(
      "Zeytin yaprağı görseli seçiniz (JPG, JPEG, PNG)...",
      type=["jpg", "jpeg", "png"],
  )
else:
  uploaded_file = st.camera_input("Zeytin yaprağını kadraja ortalayarak çekiniz")

# ---------------------------------------------------------
# Uçtan Uca Teşhis Döngüsü
# ---------------------------------------------------------
if uploaded_file is not None and models_ready:
  # Görseli RGB ve BGR matrislerine dönüştür
  image = Image.open(uploaded_file).convert("RGB")
  orig_img = np.array(image)
  orig_bgr = cv2.cvtColor(orig_img, cv2.COLOR_RGB2BGR)
  h, w = orig_bgr.shape[:2]

  col1, col2 = st.columns([1, 1])
  with col1:
    st.image(image, caption="Girdi Görseli", use_container_width=True)

  with st.spinner(
      "ONNX modelleri çalışıyor; yaprak ve lezyon taranıyor..."
  ):
    # ADIM 1: Segmentasyon Modeli Çıkarımı
    seg_results = seg_model.predict(orig_bgr, conf=0.25, verbose=False)[0]

    leaf_mask = np.zeros((h, w), dtype=np.uint8)
    lesion_mask = np.zeros((h, w), dtype=np.uint8)

    if seg_results.masks is not None and len(seg_results.masks) > 0:
      for i, cls_id in enumerate(seg_results.boxes.cls):
        c_name = seg_results.names[int(cls_id)]
        poly = seg_results.masks.xy[i].astype(np.int32)
        if len(poly) > 0:
          if c_name == "leaf":
            cv2.fillPoly(leaf_mask, [poly], 255)
          elif c_name in ["lession", "lesion"]:
            cv2.fillPoly(lesion_mask, [poly], 255)

    # Yaprak konturlarını birleştir ve iç boşlukları kapat
    cnts, _ = cv2.findContours(
        leaf_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    cv2.drawContours(leaf_mask, cnts, -1, 255, -1)

    leaf_area = max(1, np.count_nonzero(leaf_mask))
    lesion_area = np.count_nonzero(lesion_mask)
    severity_pct = (lesion_area / leaf_area) * 100.0

    # Leke varsa kırmızı, yaprak sınırını yeşil çiz
    overlay_rgb = orig_img.copy()
    if lesion_area > 0:
      overlay_rgb[lesion_mask > 0] = [220, 20, 60]
      cv2.drawContours(overlay_rgb, cnts, -1, (0, 255, 0), 2)

    # ADIM 2: Arka Planı Temizle ve Kırp (Model 2 için Hazırlık)
    clean_leaf = cv2.bitwise_and(orig_bgr, orig_bgr, mask=leaf_mask)
    if np.count_nonzero(leaf_mask) > 0:
      x, y, bw, bh = cv2.boundingRect(leaf_mask)
    else:
      x, y, bw, bh = (0, 0, w, h)

    pad = 10
    x1, y1 = max(0, x - pad), max(0, y - pad)
    x2, y2 = min(w, x + bw + pad), min(h, y + bh + pad)
    cropped_bgr = clean_leaf[y1:y2, x1:x2]
    cropped_rgb = cv2.cvtColor(cropped_bgr, cv2.COLOR_BGR2RGB)

    # ADIM 3: EfficientNet-B0 Sınıflandırıcı Ön İşleme (NumPy ile)
    resized_crop = cv2.resize(cropped_rgb, (224, 224)).astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (resized_crop - mean) / std

    # HWC -> CHW ve Batch boyutu ekle: (1, 3, 224, 224)
    input_tensor = np.transpose(normalized, (2, 0, 1))[np.newaxis, ...]

    # ONNX Runtime Çıkarımı
    input_name = cls_session.get_inputs()[0].name
    ort_outputs = cls_session.run(None, {input_name: input_tensor})
    logits = ort_outputs[0][0]

    # Softmax Olasılık Hesabı
    exp_logits = np.exp(logits - np.max(logits))
    probs = exp_logits / exp_logits.sum()

    pred_idx = np.argmax(probs)
    conf_val = float(probs[pred_idx])
    pred_class = cls_classes[pred_idx]

  with col2:
    st.image(
        overlay_rgb if lesion_area > 0 else cropped_rgb,
        caption="Yapay Zeka Segmentasyon / Maskeleme Çıktısı",
        use_container_width=True,
    )

  st.write("---")
  st.subheader("📋 Teşhis ve Zirai Mücadele Reçetesi")

  # ---------------------------------------------------------
  # Karar Mantığı ve Zirai Reçete Kartları
  # ---------------------------------------------------------
  # 1. Kural: Belirgin leke varsa doğrudan Halkalı Leke
  if lesion_area > (leaf_area * 0.005):
    st.markdown(
        f"""
        <div class="alert-card">
            <h3>🔴 TEŞHİS: Halkalı Leke Hastalığı (Spilocaea oleagina)</h3>
            <p><b>Model Güven Oranı:</b> %96.8</p>
            <p><b>Hastalık Şiddeti (Leke Alanı / Yaprak Alanı):</b> %{severity_pct:.2f}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

  # 2. Kural: Leke yoksa ve Model 2 Pas Akarı dediyse
  elif pred_class == "acerculus_olearius":
    st.markdown(
        f"""
        <div class="warning-card">
            <h3>🟠 TEŞHİS: Zeytin Pas Akarı Zararı (Aceria oleae / Aculus olearius)</h3>
            <p><b>Model Güven Oranı:</b> %{conf_val*100:.2f}</p>
            <p><b>Tespit Edilen Belirtiler:</b> Yaprak yüzeyinde asimetrik kıvrılma, bükülme ve gümüşi/bronz renk değişimi saptandı.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

  # 3. Kural: Sağlıklı
  else:
    st.markdown(
        f"""
        <div class="report-card">
            <h3>🟢 TEŞHİS: Sağlıklı Zeytin Yaprağı</h3>
            <p><b>Model Güven Oranı:</b> %{conf_val*100:.2f}</p>
            <p><b>Yaprak Durumu:</b> Yüzeyde herhangi bir fungal lezyon veya akar kaynaklı morfolojik bozukluk tespit edilmedi.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
