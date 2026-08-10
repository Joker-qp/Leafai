import os
import json
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms, models
from predict import load_model_and_classes, MODEL_PATH, CLASSES_PATH, TRANSFORM

DATA_POOL_DIR = "data_pool"
ARCHIVE_DIR = os.path.join("data", "archive_pool")


def retrain_from_data_pool(epochs=3, lr=1e-4, batch_size=8):
    """
    data_pool/ klasöründe biriken kullanıcı fotoğraflarıyla
    mevcut modeli ince ayara (fine-tuning) tabi tutar ve modeli günceller.
    """
    if not os.path.exists(DATA_POOL_DIR):
        print("❌ data_pool/ klasörü bulunamadı. Yeniden eğitim iptal edildi.")
        return

    # Sınıf klasörlerinde yeterli resim var mı kontrol edelim
    total_images = 0
    for root, dirs, files in os.walk(DATA_POOL_DIR):
        total_images += len([f for f in files if f.lower().endswith(('.jpg', '.jpeg', '.png'))])

    if total_images < 30:
        print(f"⚠️ data_pool/ içinde yeterli yeni veri yok ({total_images} resim var, en az 4 gerekli).")
        return

    print(f"\n🔄 Yeniden Eğitim Başlatılıyor... Veri Havuzunda {total_images} yeni resim var.")

    # 1. Mevcut Modeli ve Sınıfları Yüklüyoruz
    model, class_names = load_model_and_classes()
    if model is None:
        print("❌ Gerçek model bulunamadı, test modundayken yeniden eğitim yapılamaz.")
        return

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    # 2. data_pool Klasöründen Veri Setini Yükleme
    pool_dataset = datasets.ImageFolder(DATA_POOL_DIR, transform=TRANSFORM)
    pool_loader = DataLoader(pool_dataset, batch_size=min(batch_size, len(pool_dataset)), shuffle=True)

    # 3. Sadece Son Katmanın ve Derin Katmanların Kilidini Açıyoruz (Fine-Tuning)
    for param in model.features[10:].parameters():
        param.requires_grad = True

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=lr)

    # 4. Eğitimi Çalıştırıyoruz
    model.train()
    for epoch in range(epochs):
        running_loss, correct, total = 0.0, 0, 0
        for images, labels in pool_loader:
            images, labels = images.to(device), labels.to(device)

            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * images.size(0)
            _, preds = torch.max(outputs, 1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

        acc = correct / total if total > 0 else 0
        loss_avg = running_loss / total if total > 0 else 0
        print(f"   Epoch {epoch+1}/{epochs} | Loss: {loss_avg:.4f} | Acc: %{acc*100:.2f}")

    # 5. Güncellenmiş Modeli Kaydetme
    torch.save(model.state_dict(), MODEL_PATH)
    print(f"\n✅ Model yeni verilerle başarıyla güncellendi ve '{MODEL_PATH}' kaydedildi!")

    # 6. İşlenen Fotoğrafları Arşive Taşıma (Tekrar tekrar eğitilmesin diye)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    for root, dirs, files in os.walk(DATA_POOL_DIR):
        for f in files:
            src = os.path.join(root, f)
            rel_path = os.path.relpath(src, DATA_POOL_DIR)
            dest = os.path.join(ARCHIVE_DIR, rel_path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            os.rename(src, dest)
            
    print("📦 İşlenen veriler 'data/archive_pool/' dizinine arşivlendi.\n")


if __name__ == "__main__":
    retrain_from_data_pool()