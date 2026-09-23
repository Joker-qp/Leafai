def zirai_karar_ver(teshis, dsi, cls_guven, sicaklik, nem_saat, gdd):
    """
    Çok Modlu Karar Füzyonu (Multimodal Decision Fusion).
    Çiçeklenme evresinde bakır fitotoksisitesini engeller.
    """
    # Fenolojik Kontrol: GDD 350-500 arası çiçeklenme kabul edilir
    ciceklenme_var = (350 <= gdd <= 500)
    
    karar = {}
    
    if "halkali" in teshis.lower() or dsi > 2.0:
        karar["hastalik"] = "Halkalı Leke (Spilocaea oleaginea)"
        karar["tip"] = "Mantar (Fungal Patojen)"
        karar["dsi"] = f"%{dsi:.2f}"
        
        if ciceklenme_var:
            karar["durum"] = "KİLİTLİ"
            karar["renk"] = "warning"  # Sarı/Turuncu uyarı
            karar["baslik"] = "⛔ FENOLOJİK EMNİYET KİLİDİ DEVREDE!"
            karar["recete"] = (
                f"Yaprakta %{dsi:.1f} şiddetinde lezyon tespit edildi. ANCAK ağaç çiçeklenme "
                f"evresindedir (GDD: {gdd}). Bu evrede atılacak bakır çiçek organlarını yakar ve "
                f"ürün tutumunu engeller! Bakır KESİNLİKLE KULLANILMAMALIDIR. Çiçek dönemine "
                f"uygun sistemik fungisitler veya biyolojik preparatlar tercih edilmelidir."
            )
        else:
            karar["durum"] = "MÜDAHALE GEREKLİ"
            karar["renk"] = "error"  # Kırmızı acil
            karar["baslik"] = "🔴 BAKIR / FUNGİSİT İLAÇLAMASI ÖNERİLİR"
            karar["recete"] = (
                f"Hastalık şiddeti kritik eşiğin üzerindedir (%{dsi:.1f}). Fenolojik kilit güvenli. "
                f"Havanın açık ve rüzgarsız olduğu saatte %1.5 Bordo Bulamacı veya Bakır Oksiklorür uygulayınız."
            )
            
    elif "aculus" in teshis.lower():
        karar["hastalik"] = "Zeytin Pas Akarı (Aculus olearius)"
        karar["tip"] = "Zararlı / Akar (Acarid)"
        karar["dsi"] = "Doku Hasarı / Kloroz"
        karar["durum"] = "AKARİSİT GEREKLİ"
        karar["renk"] = "error"
        karar["baslik"] = "🟠 KÜKÜRT VEYA AKARİSİT UYGULAMASI"
        karar["recete"] = (
            "Pas akarı mikroskobik bir zararlıdır; BİR MANTAR DEĞİLDİR, BAKIR ETKİ ETMEZ! "
            "Sıcak ve kuru hava popülasyonu hızlandırır. Islanabilir Kükürt (WP) veya "
            "ruhsatlı bir Akarisit kullanarak ağacın iç kısımlarına kadar homojen ilaçlama yapınız."
        )
        
    else:
        karar["hastalik"] = "Sağlıklı Zeytin Yaprağı"
        karar["tip"] = "Temiz Doku"
        karar["dsi"] = "%0.00"
        karar["durum"] = "TEMİZ"
        karar["renk"] = "success"  # Yeşil güvenli
        karar["baslik"] = "🟢 YAPRAK SAĞLIKLI"
        karar["recete"] = "Herhangi bir hastalık veya zararlı belirtisi saptanmadı. Rutin bakıma devam ediniz."
        
    return karar