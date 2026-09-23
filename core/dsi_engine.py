import torch

def dsi_hesapla(seg_result):
    """
    Segmentasyon tensör maskelerinden toplam yaprak ve lezyon piksellerini sayar.
    Formül: DSI = (Toplam Lezyon Pikselleri / Toplam Yaprak Pikselleri) * 100
    """
    leaf_pixels = 0
    lesion_pixels = 0
    
    if seg_result.masks is not None:
        for mask, cls_id in zip(seg_result.masks.data, seg_result.boxes.cls):
            c_id = int(cls_id.item())
            # 0'dan büyük olan pikseller maskeye aittir
            pixel_sayisi = int(torch.sum(mask > 0).item())
            
            if c_id == 0:  # leaf (yaprak)
                leaf_pixels += pixel_sayisi
            elif c_id == 1:  # lesion (halkalı leke lezyonu)
                lesion_pixels += pixel_sayisi
                
    dsi_orani = (lesion_pixels / leaf_pixels * 100) if leaf_pixels > 0 else 0.0
    
    return leaf_pixels, lesion_pixels, dsi_orani