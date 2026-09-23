import cv2
import numpy as np

def denetle_goruntu_kalitesi(image_bytes):
    """
    Fotoğrafın parlaklık ve netlik analizini yapar.
    Laplacian varyansı ile bulanıklığı; gri ton ortalaması ile ışık patlamasını ölçer.
    """
    # Byte verisini OpenCV formatına çevir
    file_bytes = np.asarray(bytearray(image_bytes), dtype=np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Ortalama parlaklık (0-255 arası)
    parlaklik = float(np.mean(gray))
    
    # Laplacian Varyansı (Netlik Skoru)
    netlik = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    
    durum = True
    mesajlar = []
    
    if parlaklik < 50:
        durum = False
        mesajlar.append("⚠️ Görsel çok karanlık (Işık yetersiz). Lütfen aydınlık ortamda çekiniz.")
    elif parlaklik > 235:
        durum = False
        mesajlar.append("⚠️ Görselde aşırı parlama/ışık patlaması var. Lütfen gölgede çekiniz.")
        
    if netlik < 35:
        durum = False
        mesajlar.append("⚠️ Görsel bulanık/flu. Kameranızı odaklayıp tekrar deneyiniz.")
        
    return durum, parlaklik, netlik, mesajlar