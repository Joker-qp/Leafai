import os
import json
import time
import sys
import argparse
import kagglehub
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split, ConcatDataset
from torchvision import datasets, transforms, models
from tqdm import tqdm


def get_dataset_paths():
    """Kaggle içindeki color, grayscale ve segmented klasörlerinin yollarını bulur."""
    print("📦 Veri seti kontrol ediliyor / indiriliyor...")
    path = kagglehub.dataset_download("abdallahalidev/plantvillage-dataset")
    
    color_dir, gray_dir, seg_dir = None, None, None
    for root, dirs, files in os.walk(path):
        if "color" in dirs:
            color_dir = os.path.join(root, "color")
        if "grayscale" in dirs:
            gray_dir = os.path.join(root, "grayscale")
        if "segmented" in dirs:
            seg_dir = os.path.join(root, "segmented")

    available_paths = [p for p in [color_dir, gray_dir, seg_dir] if p is not None]
    print(f"✅ Bulunan Veri Klasörleri: {len(available_paths)} Adet (Color, Grayscale, Segmented)")
    return available_paths


def create_combined_dataloaders(data_dirs, batch_size=32, val_split=0.2):
    """3 farklı klasörü birleştirip dev bir veri kümesi (~160k resim) oluşturur."""
    train_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomRotation(degrees=20),
        transforms.ColorJitter(brightness=0.3, contrast=0.3),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    val_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    train_datasets = []
    val_datasets = []
    class_names = None

    for d in data_dirs:
        full_ds = datasets.ImageFolder(d, transform=train_transform)
        if class_names is None:
            class_names = full_ds.classes

        val_size = int(len(full_ds) * val_split)
        train_size = len(full_ds) - val_size
        t_ds, v_ds = random_split(full_ds, [train_size, val_size])
        
        # Validation transform güncellemesi
        v_ds.dataset.transform = val_transform

        train_datasets.append(t_ds)
        val_datasets.append(v_ds)

    # 🌟 3 Veri Setini Tek Bir Dev Set Olarak Birleştiriyoruz (ConcatDataset)
    combined_train = ConcatDataset(train_datasets)
    combined_val = ConcatDataset(val_datasets)

    print(f"📊 Toplam Eğitim Resmi: {len(combined_train)} | Toplam Doğrulama Resmi: {len(combined_val)}")

    train_loader = DataLoader(
        combined_train, batch_size=batch_size, shuffle=True, 
        num_workers=4, pin_memory=True, persistent_workers=True
    )
    val_loader = DataLoader(
        combined_val, batch_size=batch_size, shuffle=False, 
        num_workers=4, pin_memory=True, persistent_workers=True
    )

    return train_loader, val_loader, class_names


def build_model(num_classes: int) -> nn.Module:
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    # Başlangıçta gövde dondurulur
    for param in model.features.parameters():
        param.requires_grad = False
    model.classifier[1] = nn.Linear(model.last_channel, num_classes)
    return model


def unfreeze_model_for_finetuning(model):
    """MobileNetV2'nin son derin katmanlarının kilidini açar (Fine-Tuning)."""
    print("\n🔓 Fine-Tuning Başlatılıyor: Derin katmanların kilitleri açıldı!")
    # Derin katmanların (son 5 blok) kilidini açıyoruz
    for param in model.features[10:].parameters():
        param.requires_grad = True


def train_epoch(model, dataloader, criterion, optimizer, device, epoch_str):
    model.train()
    train_loss, train_correct, train_total = 0.0, 0, 0

    loop = tqdm(dataloader, desc=f"{epoch_str} [Eğitim]", file=sys.stdout, dynamic_ncols=True)
    for images, labels in loop:
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        train_loss += loss.item() * images.size(0)
        _, preds = torch.max(outputs, 1)
        train_correct += (preds == labels).sum().item()
        train_total += labels.size(0)

        running_acc = train_correct / train_total
        loop.set_postfix(loss=f"{loss.item():.4f}", acc=f"%{running_acc*100:.1f}")

    return train_loss / train_total, train_correct / train_total


def validate_epoch(model, dataloader, criterion, device, epoch_str):
    model.eval()
    val_loss, val_correct, val_total = 0.0, 0, 0

    loop = tqdm(dataloader, desc=f"{epoch_str} [Doğrulama]", file=sys.stdout, dynamic_ncols=True)
    with torch.no_grad():
        for images, labels in loop:
            images, labels = images.to(device), labels.to(device)
            outputs = model(images)
            loss = criterion(outputs, labels)

            val_loss += loss.item() * images.size(0)
            _, preds = torch.max(outputs, 1)
            val_correct += (preds == labels).sum().item()
            val_total += labels.size(0)

            loop.set_postfix(val_loss=f"{loss.item():.4f}")

    return val_loss / val_total, val_correct / val_total


def train_model_pipeline(model, train_loader, val_loader, device, total_epochs=10, warmup_epochs=3):
    model.to(device)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    os.makedirs("models", exist_ok=True)

    print(f"\n🚀 İki Aşamalı Eğitimi Başlatıyoruz! (Cihaz: {device})\n" + "="*65)

    # 📌 1. AŞAMA: ISINMA (WARMUP) - Sadece Classifier Eğitilir
    optimizer = torch.optim.Adam(model.classifier.parameters(), lr=1e-3)
    
    for epoch in range(total_epochs):
        epoch_num = epoch + 1
        
        # Warmup bittiğinde FINE-TUNING aşamasına geç
        if epoch_num == warmup_epochs + 1:
            unfreeze_model_for_finetuning(model)
            # İnce ayar için tüm eğitilebilir parametreleri küçük lr (1e-4) ile optimizere veriyoruz
            trainable_params = [p for p in model.parameters() if p.requires_grad]
            optimizer = torch.optim.Adam(trainable_params, lr=1e-4)

        phase_str = "Warmup" if epoch_num <= warmup_epochs else "FineTune"
        epoch_str = f"Epoch {epoch_num:02d}/{total_epochs:02d} ({phase_str})"

        start_time = time.time()
        train_loss, train_acc = train_epoch(model, train_loader, criterion, optimizer, device, epoch_str)
        val_loss, val_acc = validate_epoch(model, val_loader, criterion, device, epoch_str)
        elapsed = time.time() - start_time

        print(
            f"{epoch_str} | Eğitim Acc: %{train_acc*100:.2f} | "
            f"Doğrulama Acc: %{val_acc*100:.2f} Loss: {val_loss:.4f} | Süre: {elapsed:.1f}sn"
        )

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            save_path = os.path.join("models", "leaf_disease_model.pth")
            torch.save(model.state_dict(), save_path)
            print(f"   ⭐ Yeni En İyi Model Kaydedildi! (Doğruluk: %{best_val_acc*100:.2f})")

    print("="*65 + "\n✅ İki Aşamalı Fine-Tuning Eğitimi Tamamlandı!")


def main():
    parser = argparse.ArgumentParser(description="Çoklu Veri Setli & Fine-Tuning Derin Öğrenme Eğitimi")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--warmup", type=int, default=3, help="Kaç tur warmup yapılacağı")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    data_dirs = get_dataset_paths()

    train_loader, val_loader, class_names = create_combined_dataloaders(data_dirs, batch_size=args.batch_size)

    os.makedirs("models", exist_ok=True)
    classes_path = os.path.join("models", "class_names.json")
    with open(classes_path, "w", encoding="utf-8") as f:
        json.dump(class_names, f, ensure_ascii=False, indent=2)

    model = build_model(num_classes=len(class_names))
    train_model_pipeline(model, train_loader, val_loader, device, total_epochs=args.epochs, warmup_epochs=args.warmup)


if __name__ == "__main__":
    main()