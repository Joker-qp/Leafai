import streamlit as st
import cv2
import numpy as np
from PIL import Image
import os
from ultralytics import YOLO

# Kendi yazdığımız çekirdek modülleri içe aktarıyoruz
from core.quality_gate import denetle_goruntu_kalitesi
from core.dsi_engine import dsi_hesapla
from core.decision_fusion import zirai_karar_ver

# ==========================================
# 1. SAYFA YAPILANDIRMASI VE TASARIM
# ==========================================
st.set_page_config(
    page_title="Zeytin | Karar Destek Sistemi",
    page_icon="🫒",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Özel CSS ile arayüzü güzelleştirelim
st.markdown("""
<style>
    .main-header { font-size: 2.2rem; font-weight: bold; color: #2E5A27; }
    .sub-header { font-size: 1.1rem; color: #555; margin-bottom: 20px; }
    .metric-box { background-color: #f0f4f1; border-radius: 8px; padding: 15px; border-left: 5px solid #2E5A27; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 2. MODELLERİ ÖNBELLEĞE ALMA (PERFORMANS İÇİN)
# ==========================================
@st.cache_resource
def modelleri_yukle():
    """Modelleri bir kere RAM'e yükler, her tıklamada tekrar yükleyip bekletmez."""
    seg_path = os.path.join("modeller", "best_seg.pt")
    cls_path = os.path.join("modeller", "best_cls.pt")
    
    if not os.path.exists(seg_path) or not os.path.exists(cls_path):
        st.error("❌ 'modeller/' klasöründe best_seg.pt veya best_cls.pt bulunamadı!")
        st.stop()
        
    model_seg = YOLO(seg_path)
    model_cls = YOLO(cls_path)
    return model_seg, model_cls

with st.spinner("🧠 Yapay Zeka Modelleri Yükleniyor..."):
    model_seg, model_cls = modelleri_yukle()

# ==========================================
# 3. SOL PANEL (MİKROKLİMA VE TELEMETRİ SİMÜLATÖRÜ)
# ==========================================
st.sidebar.image("https://img.icons8.com/color/96/olive.png", width=70)
st.sidebar.title("🌿 Sentinel Node (Telemetri)")
st.sidebar.caption("Bahçedeki ESP32 Düğümünden veya Meteoroloji API'sinden Gelen Veriler:")

sicaklik = st.sidebar.slider("🌡️ Ortalama Sıcaklık (°C) / Şuanlık Temsili", min_value=5.0, max_value=40.0, value=21.5, step=0.5)
nem_saat = st.sidebar.slider("💧 Bağıl Nem > %85 Kalan Süre (Saat) / Şuanlık Temsili", min_value=0, max_value=72, value=30, step=1)
gdd_puani = st.sidebar.slider("☀️ Fenolojik Isı Puanı (GDD)", min_value=100, max_value=800, value=420, step=10)

# GDD Evre Bilgisi
if gdd_puani < 350:
    evre = "🌱 Somak / Uyanma Evresi"
elif 350 <= gdd_puani <= 500:
    evre = "🌸 ÇİÇEKLENME DÖNEMİ (Bakır Hassas!)"
else:
    evre = "🫒 Meyve Tutumu / İrileşme"

st.sidebar.info(f"**Ağaç Evresi:** {evre}")
st.sidebar.markdown("---")

# ==========================================
# 4. ANA EKRAN (GÖRÜNTÜ YÜKLEME VE ANALİZ)
# ==========================================
st.markdown('<div class="main-header">🫒 Zeytin Bilge-Sis</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Halkalı Leke ve Pas Akarı için Çok Modlu, Fenolojik Emniyet Kilitli Karar Destek Sistemi</div>', unsafe_allow_html=True)

uploaded_file = st.file_uploader(
    "📸 İncelemek istediğiniz zeytin yaprağının fotoğrafını yükleyin (Beyaz Zemin Önerilir):", 
    type=["jpg", "jpeg", "png", "heic", "HEIC", "JPG", "JPEG", "PNG", "webp"]
)
if uploaded_file is not None:
    # 1. Fotoğrafı renk kaybı olmadan geçici olarak diske yazıyoruz (Colab ile %100 aynı ortam!)
    import tempfile
    
    # Dosya uzantısını koruyarak geçici dosya aç
    suffix = os.path.splitext(uploaded_file.name)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_file.write(uploaded_file.read())
        temp_image_path = temp_file.name
        
    # Dosya byte'larını kalite kontrolü için tekrar oku
    with open(temp_image_path, "rb") as f:
        file_bytes = f.read()

    # 1. AŞAMA: GİRDİ KALİTE DENETİMİ (Quality Gate)
    uygunluk, parlaklik, netlik, uyarilar = denetle_goruntu_kalitesi(file_bytes)
    
    kalite_onay = True
    if not uygunluk:
        with st.expander("⚠️ Görüntü Kalitesi Uyarısı (İnceleyin)", expanded=True):
            for u in uyarilar:
                st.warning(u)
            kalite_onay = st.checkbox("Fotoğraf kalitesi düşük olsa da yine de analiz et", value=False)
            
    if kalite_onay:
        with st.spinner("🔍 Segmentasyon ve Doku Analizi Yapılıyor..."):
            # 2. AŞAMA: MODEL 1 (SEGMENTASYON & DSI)
            # Doğrudan dosya yolunu veriyoruz (Renkler %100 orijinal kalıyor)
            seg_res = model_seg.predict(source=temp_image_path, conf=0.35, imgsz=640, verbose=False)[0]
            leaf_p, lesion_p, dsi = dsi_hesapla(seg_res)
            
            # 3. AŞAMA: MODEL 2 (SINIFLANDIRMA)
            cls_res = model_cls.predict(source=temp_image_path, imgsz=224, verbose=False)[0]
            tahmin_sinif = cls_res.names[cls_res.probs.top1].lower() # Küçük harfe çevirip eşleştirme hatasını önlüyoruz
            guven_skoru = cls_res.probs.top1conf.item() * 100
            
            # 4. AŞAMA: KARAR FÜZYONU
            if dsi > 2.0 or "peacock" in tahmin_sinif:
                teshis = "Halkalı Leke (Spilocaea oleaginea)"
            elif "aculus" in tahmin_sinif:
                teshis = "Zeytin Pas Akarı (Aculus olearius)"
            else:
                teshis = "Sağlıklı Yaprak"
                
            karar = zirai_karar_ver(teshis, dsi, guven_skoru, sicaklik, nem_saat, gdd_puani)
            
        # ==========================================
        # 5. SONUÇLARIN EKRANA BASILMASI
        # ==========================================
        st.markdown("### 📊 Analiz ve Teşhis Sonuçları")
        
        # Metrik Kartları
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("🔬 Teşhis", karar["hastalik"].split()[0])
        col2.metric("🎯 Güven Oranı", f"%{guven_skoru:.1f}")
        col3.metric("📐 Hastalık Şiddeti (DSI)", karar["dsi"])
        col4.metric("🛡️ Emniyet Durumu", karar["durum"])
        
        # Görsel Karşılaştırma (Side-by-Side)
        st.markdown("---")
        col_sol, col_sag = st.columns(2)
        
        from PIL import Image
        with col_sol:
            st.image(Image.open(temp_image_path), caption="Orijinal Girdi Görseli", use_container_width=True)
            
        with col_sag:
            seg_plot = seg_res.plot()
            st.image(seg_plot, caption="Yapay Zeka Segmentasyon Maskesi", use_container_width=True)
            
        # Zirai Reçete ve Karar Kutusu
        st.markdown("---")
        st.markdown("### 📋 Zirai Reçete ve Eylem Planı")
        
        if karar["renk"] == "warning":
            st.warning(f"### {karar['baslik']}\n\n{karar['recete']}")
        elif karar["renk"] == "error":
            st.error(f"### {karar['baslik']}\n\n{karar['recete']}")
        else:
            st.success(f"### {karar['baslik']}\n\n{karar['recete']}")
            
        # Teknik İspat Detayları
        with st.expander("🛠️ Bilimsel ve Bilişimsel Ayrıntılar (TÜBİTAK Savunma Verileri)"):
            st.write(f"• **Toplam Yaprak Alanı:** {leaf_p:,} piksel")
            st.write(f"• **Toplam Lezyon Alanı:** {lesion_p:,} piksel")
            st.write(f"• **Görüntü Netlik Skoru (Laplacian):** {netlik:.2f}")
            st.write(f"• **Görüntü Parlaklık Skoru:** {parlaklik:.2f}")
            st.write(f"• **Model Çıkarım Hızı:** Segmentasyon (~9ms), Sınıflandırma (~0.9ms)")
            
    # İşlem bitince geçici dosyayı temizle
    if os.path.exists(temp_image_path):
        os.remove(temp_image_path)