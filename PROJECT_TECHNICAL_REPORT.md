# GEMLİK ZEYTİNAİ (OLEA EUROPAEA CV. GEMLİK)
## ÇİFT KADEMELİ ONNX YAPAY ZEKA TEŞHİS, EPİDEMİYOLOJİK İKİLİ RİSK VE CBS ERKEN UYARI MOTORU
### KAPSAMLI SİSTEM MİMARİSİ, TEKNİK REFERANS VE REFACTORING RAPORU

**Sürüm:** 3.0.0 (Production Enterprise Edition)  
**Tarih:** 14 Ekim 2026  
**Hedef Mahsul:** Gemlik Zeytini (*Olea europaea cv. Gemlik / Trilye*)  
**Mimari Yaklaşım:** Clean Architecture, Reactive Mediator Pattern, Rule Engine & Edge AI Inference  

---

## 1. SİSTEM MİMARİSİ VE ÇALIŞMA PRENSİBİ

### 1.1 Projenin Amacı ve Kapsamı
Gemlik zeytinliklerinde rekolte ve ağaç sağlığını en çok tehdit eden iki ana patojen/zararlı bulunmaktadır:
1. **Zeytin Halkalı Leke Hastalığı (*Spilocaea oleagina* / *Fusicladium oleagineum*):** Fungus kaynaklı olup yüksek nem (%85+) ve 10-20°C optimum sıcaklıkta yapraklarda dairesel lezyonlar oluşturarak erken yaprak dökümüne ve verim kaybına yol açar.
2. **Zeytin Pas Akarı (*Aceria oleae* / *Aculus olearius*):** Sıcak ve kuru dönemlerde (22°C+, nem <%70) taze sürgün ve yaprak altlarında kolonize olarak gümüşi renk bozulması ve doku deformasyonuna sebep olan mikroskobik akardır.

**GemlikZeytinAI**, bu iki tehdidi hem yaprak düzeyinde çift kademeli bilgisayarlı görü (ONNX Runtime WebAssembly) ile teşhis eden hem de sahadaki mikroklima koşullarını (Meteoroloji API'leri ve ESP32 IoT telemetrisi) işleyerek 2.5 km yarıçaplı CBS erken uyarı çemberi ve 60 günlük inkübasyon simülasyonu sunan entegre bir tarımsal karar destek sistemidir.

### 1.2 Veri Akış Şeması (End-to-End Pipeline)

```
[Kullanıcı Girişi: Kamera / Galeri]
               │
               ▼
   [Letterbox Dönüşümü: 640x640 (RGB 114 Dolgu)]
               │
               ▼
   [KADEME 1: YOLOv8s-seg Çıkarımı (Wasm Multi-Thread)]
        ├── 84 Noktalı Organik Poligon (Ray Casting)
        ├── Gauss Shoelace Teoremi ile Lezyon Şiddeti (%)
        └── 32 Prototip Maskesi ile İkili Pikseller (Binary Mask)
               │
               ▼
   [KADEME 2: Zemin İzolasyonu (RGB 0,0,0 Arka Plan Arındırma)]
               │
               ▼
   [KADEME 3: EfficientNet-B0 Sınıflandırma (224x224, ImageNet Norm)]
        ├── Sağlıklı Yaprak (Healthy)
        └── Pas Akarı Morfolojik Deformasyonu (Rust Mite)
               │
               ▼
[Zirai Karar & T.C. Tarım ve Orman Bakanlığı Ruhsatlı Reçete Motoru]

──────────────────────────────────────────────────────────────────

[Meteoroloji Sağlayıcıları (Open-Meteo / OWM / WeatherAPI)] ──┐
                                                             │
[ERA5 Reanalysis 365 Günlük Arşiv & Kış Soğuklama (<7.2°C)] ──┼──> [RiskService (Rule Engine)]
                                                             │           │
[ESP32 IoT Saha İstasyonu (Firebase REST HTTPS Telemetri)]  ──┘           ▼
                                                                [DualRiskAssessmentDTO]
                                                                         │
                                                                         ├──> [Esri Topo CBS Haritası]
                                                                         ├──> [HUD Risk Göstergeleri]
                                                                         └──> [60 Günlük İnkübasyon Şeridi]
```

### 1.3 Teknoloji Yığını (Tech Stack)

| Katman | Teknoloji / Kütüphane | Sürüm | Kullanım Amacı |
|---|---|---|---|
| **Kullanıcı Arayüzü** | HTML5 Semantic, TailwindCSS | v3 (CDN) | Duyarlı (Responsive), erişilebilir ve modern kurumsal UI |
| **İkonografi** | FontAwesome Free | v6.4.0 | Arayüz eylemleri, sensör ve patojen simgeleri |
| **CBS & Haritalama** | Leaflet.js & Esri World Topo Map | v1.9.4 | 2.5 km epidemiyolojik risk halkası, sürükle-bırak koordinat seçimi |
| **Derin Öğrenme Çıkarımı** | ONNX Runtime Web (Wasm + SIMD + Threads) | v1.18.0 | İstemci tarafında sıfır gecikmeli, sunucusuz yerel model çıkarımı |
| **Meteoroloji Servisleri** | Open-Meteo API, OpenWeatherMap, WeatherAPI | REST v1/v2.5 | 48 saatlik yağış/nem tahmini ve fallback mimarisi |
| **İklim Arşivi** | Open-Meteo ERA5 Reanalysis Archive | v1 Archive | Son 365 gün kış soğuklama saati (<7.2°C) ve fenoloji analizi |
| **IoT Telemetrisi** | Firebase Realtime Database REST API | HTTPS REST | ESP32 saha istasyonu sıcaklık, bağıl nem ve yaprak ıslaklığı |
| **Şifreleme & Güvenlik** | Web Crypto API (SHA-256), Base64 Obfuscation | Standart Web API | Yönetici girişi, istemci tarafı API anahtarı karartma |

---

## 2. DOSYA VE FONKSİYON DETAY DÖKÜMÜ (MODÜLER REFERANS)

### 2.1 `index.html`
**Sorumluluk:** Uygulamanın tek sayfa (SPA) arayüz iskeletini, semantik erişilebilirlik (ARIA) ağacını, Tailwind tasarım yapılandırmasını, modal pencerelerini ve harici CDN bağımlılıklarını barındırır.
- **Header:** Marka logosu, sekme butonları (`tab-home`, `tab-diagnose`, `tab-map`), canlı ESP32 bağlantı göstergesi, ayarlar ve yönetici butonları.
- **Tab 1 (`#tab-home`):** Çift kademeli model mimarisi tanıtımı, 12 saniyelik HUD analiz videosu, 4 adımlı boru hattı kartları, Roboflow/PyTorch doğrulanmış başarı metrikleri.
- **Tab 2 (`#tab-diagnose`):** Model durumu rozeti, ONNX model yükleme alanı, yaprak sürükle-bırak yükleme bölgesi, 3'lü karşılaştırmalı kare canvas ızgarası (`canvas-step1`, `canvas-step2`, `canvas-step3`), dinamik güven çubuğu ve Bakanlık reçete kutusu.
- **Tab 3 (`#tab-map`):** Esri CBS harita tuvali (`risk-map`), konum etiketi, ikili tehdit kartları, meteoroloji istasyon kartı, ESP32 telemetri kartı, 60 günlük inkübasyon zaman şeridi (`timeline-scroll-strip`), ERA5 365 günlük iklim kartı ve 12 aylık dağılım gridi (`annual-monthly-grid`).
- **Modallar:** Sistem/API Ayarları Modalı (`modal-settings`), Yönetici Kimlik Doğrulama Modalı (`modal-admin-auth`), Epidemiyolojik Eşik Paneli (`modal-admin-dashboard`).

---

### 2.2 `css/styles.css`
**Sorumluluk:** GPU donanım hızlandırmalı CSS değişkenleri, Leaflet CBS haritasının z-index izolasyonu (stacking context fix), cam efektleri (glassmorphism), sıfır-boyama (zero-repaint) telemetri animasyonları ve ince kaydırma çubukları sağlar.

#### CSS Kural ve Animasyon Referansı:
1. `:root`
   - **İşlevi:** `--color-olive-*` renk skalası, `--hud-laser-color`, `--surface-glass-*` ve geçiş eğrilerini barındırır.
   - **Standart Uygunluğu:** Tasarım sistemi belirteçleri (Design Tokens) Tailwind ile birebir örtüşür.
2. `.glass-panel` & `.modal-backdrop`
   - **İşlevi:** Modern yarı saydam cam görünümü (`backdrop-filter: blur(14px)`).
3. `#risk-map` & `.leaflet-container`
   - **İşlevi:** `isolation: isolate; z-index: 10;` tanımları ile Leaflet haritasını bağımsız bir katman bağlamına hapseder. Haritanın header (z-40) veya modal (z-50) üzerine taşmasını engeller.
4. `.hud-laser-line` & `@keyframes hud-laser-sweep`
   - **İşlevi:** `transform: translateY` kullanarak layout reflow tetiklemeden 640x640 canvas üzerinde tarama yapan sarı HUD lazeri oynatır.
5. `.pulse-online` & `@keyframes gpu-pulse`
   - **İşlevi:** ESP32 telemetrisinde CPU boyama döngüsü (repaint) oluşturmadan `transform: scale` ve `opacity` ile nabız atan yeşil/kırmızı ışık halkası.
6. `#annual-chilling-progress-bar`, `#diagnosis-confidence-bar`
   - **İşlevi:** `will-change: width; transition: width 400ms` ile donanım destekli animasyon akışı.

---

### 2.3 `js/config/AppConfig.js`
**Sorumluluk:** Gemlik zeytini biyolojik spesifikasyonları, sabitler, doğrulanmış model metrikleri, API yapılandırmaları ve LocalStorage durum yöneticisini (Singleton Store) yönetir.

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `deepFreeze<T>(obj: T) -> Readonly<T>` | Nesneyi ve tüm alt dallarını özyinelemeli `Object.freeze` ile mühürler. | Immutability (Değişmezlik), Cache Poisoning Koruması. | `GEMLIK_SPECS`, `AI_CLASSES`, `WEATHER_PROVIDERS`, `MAP_CONFIG`, `DEFAULT_THRESHOLDS` |
| `SimpleCrypto.encrypt(text: string) -> string` | Dış kütüphane yüklemeden API anahtarlarını base64/URL encoding ile yerel depolama için karartır. | Savunmacı Güvenlik, Minimum Bağımlılık Prensibi. | `saveToStorage`, `getWeatherConfig` |
| `SimpleCrypto.decrypt(cipher: string) -> string` | Karartılmış şifreli anahtarı bellek içi kullanım için çözer. | Simetrik Veri Çözümleme. | `loadFromStorage` |
| `AppConfigManager.constructor() -> void` | Başlangıç durumunu tanımlar ve `loadFromStorage` tetikler. | Singleton Pattern. | LocalStorage |
| `getGemlikSpecs() -> Object` | Gemlik çeşidi hedef hastalıklarını, doğrulanmış model başarım yüzdelerini ve zirai reçeteleri döner. | Single Source of Truth (SSOT). | `ModelPipeline.js`, `RiskService.js` |
| `getActiveCultivar() -> Readonly<Object>` | Harita ve risk motorunun tüketeceği Gemlik kimliğini döner. | Immutability, Veri Bütünlüğü. | `MapManager.js`, `RiskService.js` |
| `getWeatherConfig() -> Readonly<Object>` | Aktif hava sağlayıcısını ve şifrelenmiş API anahtarını döner. | Kapsülleme (Encapsulation). | `app.js` UI Hydration |
| `getRawWeatherApiKey() -> string` | Hava durumu sağlayıcıları için bellekteki ham (çözülmüş) API anahtarını döner. | Güvenli Veri Akışı, Entegrasyon Uyumu. | `WeatherService.js` |
| `setWeatherConfig(provider: string, apiKey?: string, persist?: boolean) -> void` | Hava durumu sağlayıcısını doğrular, kaydeder ve opsiyonel kalıcı kılar. | Validasyon, Defensive Programming. | `app.js` |
| `getThresholds() -> Readonly<Object>` | Biyolojik risk eşiklerini (sıcaklık, nem, yağış) dondurulmuş olarak döner. | Immutability. | `RiskService.js`, `HistoricalArchiveService.js`, `app.js` |
| `setThresholds(newThresholds: Object, persist?: boolean) -> void` | Halkalı leke ve pas akarı tetikleme sınırlarını fiziksel kontrolle (`tempMin < tempMax`, `%0-%100` nem) günceller. | Girdi Doğrulama, Domain Rule Enforcement. | `app.js` (Admin Dashboard) |
| `setCustomModelBuffer(type: string, arrayBuffer: ArrayBuffer) -> void` | Kullanıcının yüklediği ONNX model binary verisini `slice(0)` ile tampona alır. | Detached Buffer Önleme, Defensive Copy. | `app.js`, `ModelPipeline.js` |
| `getCustomModelBuffer(type: string) -> ArrayBuffer \| null` | Tampondaki model ikili verisinin kopyasını döner. | Bellek İzolasyonu. | `ModelPipeline.js` |
| `getHardwareConfig() -> Readonly<Object>` | Firebase URL, IoT düğüm yolu ve çevrimiçi durumunu döner. | Immutability. | `Esp32Service.js`, `app.js` |
| `setHardwareConfig(firebaseUrl: string, nodePath?: string, persist?: boolean) -> void` | URL formatını normalize eder (trailing slash temizliği) ve kaydeder. | URL Sanitization. | `app.js` |
| `updateTelemetry(telemetryData: Object \| null, isOnline: boolean) -> void` | En son alınan geçerli telemetri verisini dondurarak durum havuzunda saklar. | State Synchronization. | `Esp32Service.js` |
| `getUserLocation() -> Readonly<Object>` | Seçili bahçe sahasının koordinat ve adını döner. | Immutability. | `app.js`, `MapManager.js`, `WeatherService.js` |
| `setUserLocation(lat: number, lon: number, name?: string, persist?: boolean) -> void` | [-90, 90] ve [-180, 180] coğrafi sınır kontrolüyle konumu günceller. | CBS Veri Doğrulama. | `app.js`, `MapManager.js` |
| `saveToStorage() -> void` | Durumu serileştirip `gemlik_ai_config_v3` anahtarıyla LocalStorage'a yazar. | Kalıcılık Yönetimi, Hata Yakalama. | `localStorage` |
| `loadFromStorage() -> void` | LocalStorage'daki veriyi okur, şifreli anahtarları çözer ve belleğe yükler. | Idempotent Yükleme. | `localStorage` |

---

### 2.4 `js/services/WeatherService.js`
**Sorumluluk:** Open-Meteo, OpenWeatherMap ve WeatherAPI servislerine yönelik Strategy Pattern mimarisi kurar. API anahtarlarının geçerliliğini denetler, 48 saatlik yağış/nem integrasyonunu hesaplar, 10 dakikalık RAM önbelleklemesi (caching) uygular ve hata anında otonom olarak ücretsiz Open-Meteo servisine geri çekilir (Fallback Mechanism).

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `deepFreeze<T>(obj: T) -> Readonly<T>` | Veri transfer nesnesini derinlemesine dondurur. | DTO İmmutability Sözleşmesi. | `createMeteorologicalDTO` |
| `createMeteorologicalDTO(params: Object) -> Readonly<Object>` | `MeteorologicalDataDTO` sözleşmesine tam uyumlu dondurulmuş veri üretir. | Factory Pattern, Tip Güvenliği. | Strateji Sınıfları, `WeatherServiceOrchestrator` |
| `OpenMeteoStrategy.fetchForecast(lat: number, lon: number) -> Promise<Readonly<Object>>` | Open-Meteo 3 günlük saatlik tahminini çeker, geçerli saatten itibaren 48 saati dilimler ve `precipitation` integrasyonu alır. | REST Client, Sıfır API Key Gereksinimi. | `WeatherServiceOrchestrator` |
| `OpenWeatherStrategy.fetchForecast(lat: number, lon: number, apiKey: string) -> Promise<Readonly<Object>>` | OWM 5 günlük / 3 saatlik tahmin endpointini çeker, 3 saatlik kütleleri 1 saatlik adımlara paylaştırır. | HTTP 401 Özel Hata Yakalama, Normalizasyon. | `WeatherServiceOrchestrator` |
| `WeatherApiStrategy.fetchForecast(lat: number, lon: number, apiKey: string) -> Promise<Readonly<Object>>` | WeatherAPI 3 günlük saatlik JSON tahminini çeker ve 48 saatlik pencereyi hesaplar. | REST Client, Yetkilendirme Kontrolü. | `WeatherServiceOrchestrator` |
| `WeatherServiceOrchestrator.getForecast(lat: number, lon: number, forceRefresh?: boolean) -> Promise<Readonly<Object>>` | Önbelleği kontrol eder; ana sağlayıcıyı çağırır; ana sağlayıcı çökerse şeffaf biçimde Open-Meteo'ya fallback yapar. | Circuit Breaker & Fallback Pattern, Cache TTL. | `app.js`, `AppConfig.js`, `RiskService.js` |
| `WeatherServiceOrchestrator.clearCache() -> void` | 10 dakikalık bellek içi önbelleği temizler. | Önbellek Yönetimi. | `app.js` (Ayar Değişikliğinde) |

---

### 2.5 `js/services/HistoricalArchiveService.js`
**Sorumluluk:** Gemlik zeytini için 60 günlük biyolojik inkübasyon penceresini (-30 gün geçmiş gözlem / +16 gün gelecek tahmin) modeller ve Open-Meteo ERA5 Reanalysis üzerinden son 365 günün kış soğuklama saati birikimini (<7.2°C) ve aylık yağış/sıcaklık anomalilerini hesaplar.

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `validateAndNormalizeCoordinates(lat: number, lon: number) -> { lat, lon, cacheKey }` | Koordinatların sayısal geçerliliğini ve [-90,90], [-180,180] sınırlarını denetler. | Savunmacı Girdi Doğrulama. | Servis Metotları |
| `calculateDailyChillingHours(tMin: number) -> number` | `0 < Tmin <= 7.2°C` ise o gün için 7 saat kış soğuklama saati yazar. | Fenolojik Formül (Gemlik Çeşidi). | `getAnnualClimateArchive` |
| `evaluateDailyPeacockRisk({ tMean, hum, rain, thresholds }) -> { riskScore, riskLevel, isRiskDay }` | Sıcaklık 10-20°C, nem %85+ ve yağış 2.0 mm+ birleşiminde spor çimlenme puanı (12 - 100) üretir. | Biyolojik Karar Kuralı (SSOT). | İnkübasyon ve Yıllık Arşiv Motoru |
| `createIncubationTimelineDTO({ dailyPoints, summaryStats }) -> Readonly<Object>` | Dondurulmuş 60 günlük inkübasyon veri sözleşmesini kurar. | Immutability, DTO Standardı. | `getIncubationTimeline` |
| `createAnnualArchiveDTO(params: Object) -> Readonly<Object>` | Dondurulmuş ERA5 1 yıllık iklim özeti nesnesi üretir. | Immutability, DTO Standardı. | `getAnnualClimateArchive` |
| `BoundedCache.get(key: string) -> Object \| null` | TTL süresi dolmamış kaydı döner ve anahtarı son konuma kaydırır. | LRU (Least Recently Used) Önbellek. | Servis Önbelleği |
| `BoundedCache.set(key: string, data: Object) -> void` | Boyut 100'ü aştığında en eski girdiyi silerek yeni veriyi kaydeder. | OOM (Out-of-Memory) Bellek Sızıntısı Koruması. | Servis Önbelleği |
| `HistoricalArchiveServiceEngine.getIncubationTimeline(rawLat: number, rawLon: number) -> Promise<Object>` | Open-Meteo'dan -30 gün geçmiş ve +16 gün tahmin verisini çeker, spor çimlenme risklerini hesaplar. | Asenkron Ağ Güvenliği (`AbortSignal.timeout(10s)`). | `app.js` |
| `HistoricalArchiveServiceEngine.getAnnualClimateArchive(rawLat: number, rawLon: number) -> Promise<Object>` | 5 günlük ERA5 gecikmesini hesaba katarak geriye dönük 365 günü çeker, soğuklama birikimi ve 12 aylık istatistikleri döner. | ERA5 Reanalysis Analizi, Hata İzolasyonu. | `app.js` |
| `HistoricalArchiveServiceEngine.clearCache() -> void` | Zaman çizelgesi ve yıllık arşiv önbelleklerini sıfırlar. | Bellek Yönetimi. | `app.js` |

---

### 2.6 `js/services/RiskService.js`
**Sorumluluk:** Meteorolojik veriler ile ESP32 canlı sensör verilerini birleştirerek Halkalı Leke ve Pas Akarı tehditlerini eşzamanlı değerlendiren kural motoru (Rule Engine). Çift tehdit puanı, baskın patojen seçimi ve tarayıcı anti-spam bildirim mekanizması sunar.

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `createDualRiskDTO({ peacock, mite, overall, metrics }) -> Readonly<Object>` | İkili risk değerlendirmesini derinlemesine dondurulmuş tek bir sözleşmede birleştirir. | Immutability, DTO Factory Pattern. | `evaluateDualRisk` |
| `evaluateDualRisk(weatherData: Object, espData: Object) -> Readonly<Object>` | Sensörün canlı olup olmadığını denetler (varsa ESP32, yoksa hava istasyonu), paralel iki risk fonksiyonunu çağırır ve baskın tehdidi belirler. | Fail-Safe Default, Sensor Fusion. | `app.js`, `MapManager.js` |
| `#evaluatePeacockRisk(temp, hum, rain48h, isLeafWet, thresholds, specs) -> Object` | `T ∈ [10, 20]`, `RH ≥ %85` veya yaprak ıslak ve `P48 ≥ 2.0 mm` koşullarında acil Bordo Bulamacı reçetesi üretir. | Clean Code, Zirai Karar Kuralı. | `evaluateDualRisk` |
| `#evaluateMiteRisk(temp, hum, rain48h, thresholds, specs) -> Object` | `T ≥ 22°C`, `RH ≤ %70` ve `P48 ≤ 5.0 mm` (yağış baskılaması yokken) pas akarı popülasyon artışını ve kükürt/abamectin reçetesini hesaplar. | Clean Code, Zirai Karar Kuralı. | `evaluateDualRisk` |
| `#getEmptyDualState(message: string) -> Readonly<Object>` | Veri eksikliği durumunda uygulamanın çökmesini önleyen güvenli boş durum üretir. | Defensive Null-Object Pattern. | `evaluateDualRisk` |
| `#dispatchNotification(title: string, body: string) -> void` | Risk skoru %80 ve üzerine çıktığında 30 dakikalık soğuma süresi (cooldown) ile masaüstü bildirimi gönderir. | Anti-Spam Rate Limiting, Browser Permissions. | `evaluateDualRisk` |

---

### 2.7 `js/services/Esp32Service.js`
**Sorumluluk:** Sahadaki ESP32 mikrokontrolcüsünün Firebase Realtime Database üzerindeki telemetrisini (sıcaklık, nem, yaprak ıslaklığı, zaman damgası) HTTPS REST yoklamasıyla dinler. Bayat veriyi reddeder, donanım kalp atışı toleransı uygular ve abonelerine bildirim dağıtır (Observer Pattern).

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `subscribe(callback: (state: Readonly<object>) => void) -> () => void` | Telemetri dinleyicisi ekler, anlık durumu derhal iletir ve abonelikten çıkma fonksiyonu döner. | Observer Pattern, Bellek Sızıntısı Önleme. | `app.js` |
| `getState() -> Readonly<Object>` | Telemetrinin dondurulmuş kopyasını döner. | Kapsülleme. | Tüm Aboneler |
| `startListener() -> void` | Önceki dinleyicileri temizler, endpoint doğrulaması yapar ve ilk yoklama döngüsünü başlatır. | Idempotent Yaşam Döngüsü. | `app.js` |
| `stopListener() -> void` | Zamanlayıcıları ve bekleyen AbortController ağ isteklerini temiz şekilde iptal eder. | Resource Disposal, Clean Cancellation. | `app.js` |
| `#scheduleNextCycle(endpointUrl: string) -> void` | İsteklerin üst üste binmesini (drift/overlap) önlemek için recursive timeout ile sonraki periyodu (7 sn) kurar. | Anti-Drift Polling Pattern. | `#executePollCycle` |
| `async #fetchTelemetry(endpointUrl: string) -> Promise<void>` | 5 saniyelik kesin HTTP zaman aşımı ile telemetri çeker, soket sızıntılarını engeller. | Asenkron Ağ Güvenliği (`AbortController`). | `#executePollCycle` |
| `#validateAndCommitTelemetry(data: Object) -> void` | Sıcaklık (-25..65°C), nem (0..100%), zaman damgası ve 90 saniyelik bayatlık sınırını kontrol eder. Geçerliyse durumu günceller. | Sensor Sanity Check, Anti-Staleness Heartbeat. | `#fetchTelemetry`, `AppConfig.js` |
| `#handleFetchFailure(error: Error) -> void` | Ağ kopmasında 3 döngüye kadar son geçerli durumu korur, ardından güvenli çevrimdışına alır. | Fault Tolerance, Heartbeat Grace Period. | `#fetchTelemetry` |
| `#setOfflineState(reason: string) -> void` | Sensör değerlerini null yaparak donanımı çevrimdışına çeker ve AppConfig'i bilgilendirir. | Fail-Safe State. | `startListener`, `#handleFetchFailure` |
| `#resolveValidatedEndpoint() -> string` | Firebase URL'sinin HTTPS olduğunu ve nodePath'in güvenli olduğunu denetler. | OWASP URL & Path Traversal Koruması. | `startListener` |
| `#broadcast() -> void` | Dondurulmuş durumu tüm kayıtlı abonelere dağıtır. | Observer Dağıtımı. | Aboneler |

---

### 2.8 `js/ui/MapManager.js`
**Sorumluluk:** Esri Topografya CBS kiremit katmanıyla Leaflet haritasını yönetir. Bahçe konumu için özel yaprak pini oluşturur, sürükleme/tıklamada Nominatim tersine coğrafi kodlama yapar ve 2.5 km'lik epidemiyolojik risk çemberini çizer.

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `sanitizeHtml(value: unknown) -> string` | Harita popup içeriğine yazılacak metinlerde HTML karakterlerini filtreler. | OWASP A03 XSS Mitigation. | `#renderPopup` |
| `onLocationPicked(callback: Function) -> void` | Harita pini sürüklendiğinde veya haritaya tıklandığında tetiklenecek gözlemciyi bağlar. | Observer Pattern. | `app.js` |
| `initMapIfNeeded() -> void` | DOM üzerinde `#risk-map` varsa haritayı idempotent olarak başlatır; çift başlatma hatasını (`_leaflet_id`) temizler. | Idempotent Initialization, Leaflet Error Fix. | `app.js` (Sekme Değişiminde) |
| `#setupGardenMarkerIcon() -> void` | Gemlik zeytini yaprak simgeli özel CSS DivIcon'unu tanımlar. | Özel UI Bileşeni. | `initMapIfNeeded` |
| `#createMarkerInstance(lat: number, lon: number, name: string) -> void` | Sürüklenebilir Leaflet marker nesnesini üretir ve `dragend` dinleyicisini bağlar. | Single Instance. | `initMapIfNeeded` |
| `#bindInteractiveMapClicks() -> void` | Haritaya tıklama olayını dinler ve konumu tıklandığı yere taşır. | Etkileşimli CBS. | `initMapIfNeeded` |
| `invalidateSize() -> void` | Sekme geçişinde harita boyutlarını tarayıcıya yeniden hesaplatarak gri kiremit kırpışmasını önler. | Asenkron Reflow Fix. | `app.js` |
| `updateLocation(lat: number, lon: number, name?: string, shouldFly?: boolean) -> void` | Pini ve risk çemberini yeni koordinata taşır, opsiyonel `flyTo` kamera animasyonu oynatır. | Bellek Dostu Güncelleme (No Re-create). | `app.js` |
| `updateRiskDisplay(overallRisk: Object, telemetryState?: Object) -> void` | Risk skoru renginde (kırmızı, turuncu, sarı, yeşil) 2.5 km yarıçaplı `L.circle` çizer ve popup'ı günceller. | Epidemiological Buffer Zone, CBS Görselleştirme. | `app.js` |
| `#renderPopup(locationName: string) -> void` | Bahçe adı, zeytin çeşidi, baskın risk skoru ve ESP32 telemetrisini içeren zengin kartı pin üzerine bağlar. | XSS Korumalı Template String. | `updateLocation`, `updateRiskDisplay` |
| `async #resolveLocationName(lat: number, lon: number) -> Promise<string>` | Nominatim API ile tersine coğrafi kodlama yapar; önceki istekleri AbortController ile iptal eder. | Race-Condition Prevention (`AbortController`). | Tıklama ve Sürükleme Olayları |
| `#getRiskColorScheme(level: string) -> { stroke: string, fill: string }` | Kritik, yüksek, orta ve düşük risk seviyeleri için kenarlık ve dolgu renk kodlarını döner. | Tasarım Sistemi Renk Standardı. | `updateRiskDisplay` |

---

### 2.9 `js/ai/ModelPipeline.js`
**Sorumluluk:** Çift kademeli ONNX yapay zeka modelinin yaşam döngüsünü, tensör ön işlemesini, WebAssembly multi-thread çıkarımını, 84 noktalı poligon ve Gauss Shoelace hastalık şiddeti hesabını, mantıksal VEYA (`leaf_mask | lesion_mask`) ile deliksiz zemin izolasyonunu, unpad/crop odaklamasını, 3 sınıflı Softmax olasılık dağılımını ve EfficientNet-B0 morfolojik doğrulamasını yürütür.

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `initialize() -> Promise<void>` | `yolov8_seg.onnx` ve `efficientnet.onnx` modellerini diskten veya yerel ArrayBuffer tamponundan asenkron derler. | Non-Blocking Model Derleme, SIMD Optimizasyonu. | `app.js` |
| `#loadStageModel(type: string) -> Promise<void>` | Belirtilen kademe modelini `ort.InferenceSession.create` ile Wasm hafızasına yükler. | Hata İzolasyonu, Oturum Yönetimi. | `initialize` |
| `loadModelFromBuffer(fileName: string, arrayBuffer: ArrayBuffer) -> Promise<void>` | Kullanıcının yerel dosya seçiciyle yüklediği .onnx dosyasını doğrular ve belleğe alır. | İstemci Tarafı Dinamik Model Yükleme. | `app.js` |
| `processLeafImage(imageSource: HTMLImageElement \| HTMLCanvasElement) -> Promise<void>` | 4 kademeli teşhis boru hattını aşamalı görselleştirme ile sırayla işletir: Odaklama -> YOLOv8s-seg & Lazer Scanline -> Deliksiz Zemin İzolasyonu -> 3 Sınıflı EfficientNet-B0. | Pipeline Pattern, Koordinasyon, Staggered Reveal. | `app.js` (Fotoğraf Yükleme/Kamera) |
| `#drawLetterboxImage(ctx, img, srcW, srcH) -> Object` | Orijinal en-boy oranını koruyarak görüntüyü RGB(114,114,114) zemin üzerinde 640x640 tensör karesine yerleştirir. | Bilgisayarlı Görü Tensör Standardı. | `processLeafImage` (Offscreen Canvas) |
| `#executeYoloSegmentation(ctx, lbox) -> Promise<Object>` | YOLOv8s-seg oturumunu çalıştırır ve tensör belleklerini `dispose()` ederek sızıntıları önler. | WebAssembly Bellek Yönetimi (`dispose`). | `processLeafImage` |
| `#preprocessToTensor(ctx, width, height, normalize?: boolean) -> ort.Tensor` | Canvas piksellerini NCHW (1x3xHxW) Float32 dizisine dönüştürür; gerekirse ImageNet normalizasyonu uygular. | Tensör Vektörizasyonu, ImageNet Standartları. | Çıkarım Metotları |
| `#parseYoloSegOutput(outputMap, lbox) -> Object` | Box ve Proto tensörlerini ayrıştırır, `final_mask = (leaf | lesion)` mantıksal VEYA ile birleştirir, 84 noktalı organik poligon ve lezyon şiddetini hesaplar. | Logical OR Mask Union, Gauss Shoelace Teoremi. | `#executeYoloSegmentation` |
| `#extractOrganicPolygonAndArea(maskBuffer, width, height, numPoints?: number) -> { polygon, area }` | Maske ağırlık merkezinden 84 radyal ışın (ray-casting) fırlatarak organik poligon sınırlarını bulur ve Gauss Shoelace formülüyle piksel alanını hesaplar. | Hesaplamalı Geometri, Gauss Shoelace Teoremi. | `#parseYoloSegOutput` |
| `#computeMaskFromProto(proto, coeffs, cx, cy, w, h, outBuffer) -> number` | 32 prototip maskesi ile 32 katsayıyı matris çarpımına sokar ve Sigmoid aktivasyonu uygular. | Derin Öğrenme Maske Rekonstrüksiyonu. | `#parseYoloSegOutput` |
| `#createScaledMaskCanvas(maskBuffer, fillColor) -> HTMLCanvasElement` | 160x160 prototip maskesini HUD üzerinde gösterilmek üzere 640x640 yarı saydam renkli tuvale dönüştürür. | Görsel HUD Katmanı. | `#parseYoloSegOutput` |
| `#animateLaserScanSweep(ctx, rawCanvas, yoloResult, lbox) -> Promise<void>` | `canvas-step2` üzerinde letterbox dolgularından arındırılmış (unpad) alanda yukarıdan aşağıya kayan parlayan sarı lazer tarama animasyonunu oynatır. | `requestAnimationFrame` GPU Senkronizasyonu. | `processLeafImage` |
| `#applyBackgroundIsolation(ctx, sourceCanvas, yoloResult, lbox) -> void` | `final_mask` kullanarak yaprağı lekeleriyle birlikte deliksiz olarak saf `RGB(0,0,0)` zemin üzerinde izole eder; letterbox gri bloklarını temizler. | Deliksiz Maskeleme, Arka Plan İzolasyonu. | `processLeafImage` |
| `#executeEfficientNetClassification(isolatedCanvas, yoloResult) -> Promise<Object>` | İzole yaprağı 224x224 ImageNet tensörle tarar; Softmax ve hibrit lezyon füzyonu ile 3 sınıfın (Halkalı Leke, Pas Akarı, Sağlıklı) olasılık dağılımını hesaplar. | 3 Sınıf Softmax, Hibrit Sensor Fusion. | `processLeafImage` |
| `#renderStep4Results(diag: Object) -> void` | Teşhis başlığını, Bakanlık onaylı reçeteyi, baskın güven çubuğunu ve 3 sınıfın tamamının yüzde/ilerleme barlarını animasyonla render eder. | Dinamik Arayüz Güncellemesi, Progress Bars. | `processLeafImage` |
| `#revealStepCard(cardId: string) -> void` | Boru hattındaki ilgili analiz kartını yumuşak aşamalı geçişle (`fade-in-up`) ekranda belirginleştirir. | UI Staggered Transition. | `processLeafImage` |

---

### 2.10 `js/app.js`
**Sorumluluk:** Uygulamanın ana orkestratörü (Application Mediator / Facilitator). Tüm servisleri, kullanıcı etkileşimlerini, SPA sekme geçişlerini, harita konum seçicisini, web crypto kimlik doğrulamasını, video oynatıcıyı ve dosya sürükle-bırak olaylarını tek elden koordine eder.

#### Fonksiyon ve Metot Tablosu:

| Fonksiyon / Metot İmzası | İşlevi | Standart Uygunluğu | Bağlantılı Modüller |
|---|---|---|---|
| `initialize() -> Promise<void>` | Ayarları yükler, başlangıç konumunu haritaya ve ekrana yansıtır, meteoroloji ve iklim arşivini çeker, IoT telemetrisini ve ONNX motorunu başlatır. | Asenkron Sistem Başlatma Yaşam Döngüsü. | Tüm Servisler |
| `switchTab(targetTabId: string) -> void` | Ana Sayfa, Teşhis Laboratuvarı ve CBS Haritası sekmeleri arasında geçiş yapar; harita boyutunu tazeler. | SPA Router / UI State Manager. | DOM Sekmeleri, `MapManager.js` |
| `refreshWeatherData(forceRefresh?: boolean) -> Promise<void>` | Seçili sağlayıcıdan hava durumunu çeker, UI rozetini günceller ve ikili risk motorunu yeniden hesaplar. | Asenkron Veri Senkronizasyonu. | `WeatherService.js`, `RiskService.js` |
| `refreshIncubationTimeline(lat: number, lon: number) -> Promise<void>` | 60 günlük inkübasyon verilerini çeker ve zaman şeridini çizer. | Arka Plan Veri Yükleme. | `HistoricalArchiveService.js` |
| `refreshAnnualClimateArchive(lat: number, lon: number) -> Promise<void>` | ERA5 365 günlük arşivini çeker, soğuklama saati ve 12 aylık iklim panelini render eder. | Arka Plan Veri Yükleme. | `HistoricalArchiveService.js` |
| `#handleTelemetryUpdate(telemetryState: Object) -> void` | ESP32'den canlı paket geldiğinde UI göstergelerini (yeşil/gri nokta, sıcaklık, nem) günceller ve riski yeniden hesaplar. | Observer Callback, Reaktif Güncelleme. | `Esp32Service.js`, `RiskService.js` |
| `#recalculateAndRenderDualRisk() -> void` | Meteoroloji ve sensör verilerini `RiskService`'e gönderir; Halkalı Leke ve Pas Akarı kartları ile CBS haritasını günceller. | Sensor Fusion Tetikleyicisi. | `RiskService.js`, `MapManager.js` |
| `#renderIncubationTimelineUI(timelineData: Object) -> void` | 60 günlük (-30/+16) inkübasyon günlerini kartlar halinde yatay kaydırılabilir şeride basar; bugünün kartına odaklanır. | Dinamik DOM Manipülasyonu. | DOM (`#timeline-scroll-strip`) |
| `#renderAnnualArchiveUI(archiveData: Object) -> void` | Kış soğuklama saati, ilerleme çubuğu, karşılama durumu rozeti, yıllık yağış ve 12 aylık istatistik kartlarını render eder. | Kapsamlı Veri Sunumu. | DOM (`#annual-monthly-grid` vb.) |
| `#bindOnnxModelUploadEvents() -> void` | Kullanıcının diskinden `.onnx` dosyası seçmesini dinler ve hafızaya derler. | Model Dosya Yöneticisi. | `ModelPipeline.js`, `AppConfig.js` |
| `#bindVideoPlayerEvents() -> void` | Video seçici butonu (`btn-trigger-local-video`) ile gizli dosya girdisini bağlar, Blob URL oluşturarak videoyu oynatır. | Medya Yönetimi, Bellek Sızıntısı Önleme. | HTML5 Video Player |
| `#hydrateSettingsUI() -> void` | Saklanan hava sağlayıcısı, API anahtarı ve Firebase ayarlarını ayarlar modalına doldurur. | Form Hydration. | `AppConfig.js` |
| `#handleSettingsSave() -> Promise<void>` | Ayarları kaydeder, IoT dinleyicisini yeniden başlatır ve hava durumunu zorla tazeler. | Form Submission, Veri Güncelleme. | `AppConfig.js`, `WeatherService.js`, `Esp32Service.js` |
| `#hydrateAdminThresholds() -> void` | Biyolojik eşik modalındaki tüm sıcaklık, nem ve yağış inputlarını güncel değerlerle doldurur. | Form Hydration. | `AppConfig.js` |
| `#handleAdminAuthSubmit() -> Promise<void>` | Girilen parolayı SHA-256 ile özetleyerek sabit hash ile karşılaştırır; başarılıysa eşik panelini açar. | Web Crypto API (SHA-256), İstemci Güvenliği. | Web Crypto API, Admin Modal |
| `#hashStringSHA256(text: string) -> Promise<string>` | Düz metni SHA-256 hex dizesine dönüştürür. | Kriptografik Fonksiyon. | `crypto.subtle` |
| `#handleAdminThresholdsSave() -> void` | Eşik panelindeki 7 girdi alanını doğrular, AppConfig'e kaydeder ve riski yeniden hesaplar. | Eşik Güncelleme. | `AppConfig.js`, `RiskService.js` |
| `requestPermission(type: string) -> Promise<void>` | Masaüstü bildirim, kamera veya GPS izinlerini güvenle talep eder. | Tarayıcı İzinleri (Permissions API). | `Notification`, `navigator.mediaDevices` |
| `updateUserLocation() -> void` | `navigator.geolocation` ile kullanıcının anlık GPS koordinatlarını alır ve tüm harita ve hava panellerini günceller. | GPS Entegrasyonu. | `MapManager.js`, `AppConfig.js` |
| `#bindDiagnosisMediaEvents() -> void` | Fotoğraf seçme butonu, kamera butonu, sürükle-bırak (`leaf-drop-zone`) ve klavye etkileşimlerini bağlar. | Çoklu Girdi Olay Yönetimi (Drag & Drop, Camera). | `ModelPipeline.js` |

---

## 3. YAPILAN ONARIMLARIN GÜNCESİ (AUDIT LOG)

Refactoring sürecinde kod tabanında tespit edilen ve bizzat dosyalara yazılarak çözülen kritik kopukluklar:

### 1. `js/app.js` — ERA5 Yıllık İklim Paneli DOM ID Uyumsuzluğu ve Eksik Render
- **Kritik Hata:** `app.js` içinde `#renderAnnualArchiveUI` metodu `era5-chilling-hours-val`, `era5-annual-rainfall-val` ve `era5-high-risk-days-val` ID'lerini arıyordu. Ancak `index.html`'deki gerçek ID'ler sırasıyla `annual-chilling-hours-val`, `annual-total-rain-val` ve `annual-risk-days-val` şeklindeydi. Bu nedenle DOM elemanları bulunamıyor (`null`), soğuklama saati ve yağış UI'a yansımıyordu. Ayrıca `annual-chilling-progress-bar`, `annual-chilling-status-badge` ve `annual-monthly-grid` hiç güncellenmiyor, 12 aylık iklim tablosu "Veriler yükleniyor..." şeklinde takılı kalıyordu.
- **Çözüm:** DOM ID'leri `index.html` ile birebir eşitlendi. Soğuklama ilerleme çubuğu (400-600 saat hedefli), fenolojik durum rozeti ve 12 aylık iklim dağılım gridini dinamik HTML kartları olarak üreten render bloğu eklendi.

### 2. `js/app.js` — Yönetici Eşik Paneli Input Uyuşmazlığı
- **Kritik Hata:** `app.js` içindeki `#hydrateAdminThresholds` ve `#handleAdminThresholdsSave` metotları `adm-peacock-temp` adında tek bir input arıyor ve `split("-")` yapıyordu. Ancak `index.html`'de iki ayrı input (`adm-peacock-temp-min` ve `adm-peacock-temp-max`) mevcuttu. Bu nedenle sıcaklık eşikleri okunamıyor veya forma geri yazılamıyordu. Ayrıca `index.html`'de bulunan `adm-peacock-rain` (48s yağış eşiği) ve `adm-mite-rain` (yağış baskılama eşiği) inputları `app.js` tarafından tamamen göz ardı ediliyordu.
- **Çözüm:** Tüm 7 biyolojik eşik inputu (`adm-peacock-hum`, `adm-peacock-temp-min`, `adm-peacock-temp-max`, `adm-peacock-rain`, `adm-mite-temp`, `adm-mite-hum`, `adm-mite-rain`) eksiksiz olarak `hydrateAdminThresholds` ve `handleAdminThresholdsSave` içine entegre edildi.

### 3. `js/app.js` — Sinematik HUD Video Seçici Butonunun Kopukluğu
- **Kritik Hata:** `index.html`'de `btn-trigger-local-video` butonu bulunmasına ve video inputu `class="hidden"` olmasına rağmen, `app.js`'de bu butona hiçbir `click` olay dinleyicisi atanmamıştı. Kullanıcı butona bastığında hiçbir eylem gerçekleşmiyordu.
- **Çözüm:** `#bindVideoPlayerEvents` fonksiyonuna `triggerBtn?.addEventListener("click", () => videoInput?.click());` dinleyicisi eklendi.

### 4. `js/app.js` — Sürükle-Bırak (Drag & Drop) ve Drop-Zone Etkileşim Eksikliği
- **Kritik Hata:** `#leaf-drop-zone` alanı `index.html` üzerinde sürükle-bırak için tasarlanmış olmasına karşın, `app.js` yalnızca buton tıklamalarını dinliyordu. Kullanıcı yaprak fotoğrafını sürükleyip bıraktığında veya drop-zone'a doğrudan tıkladığında görsel işleme boru hattı tetiklenmiyordu.
- **Çözüm:** `leaf-drop-zone` için `click`, `keydown` (Enter/Space erişilebilirliği) ve `dragenter`, `dragover`, `dragleave`, `drop` olayları yazıldı; yüklenen dosyalar doğrudan `ModelPipeline.processLeafImage` akışına yönlendirildi.

### 5. `js/services/WeatherService.js` — API Anahtarı Şifreleme/Çözümleme Çakışması
- **Kritik Hata:** `AppConfig.getWeatherConfig()` metodu API anahtarını depolama güvenliği için `SimpleCrypto.encrypt` ile karartarak dönmektedir. `WeatherService.js` bu şifreli dizeyi doğrudan OpenWeather veya WeatherAPI URL'lerine `appid` / `key` olarak eklemekteydi. Bu durum dış API sağlayıcıların HTTP 401 Unauthorized dönmesine ve sürekli gereksiz yere yedek Open-Meteo servisine düşülmesine yol açıyordu.
- **Çözüm:** `WeatherService.getForecast` metodu `AppConfig.getRawWeatherApiKey()` çağırarak çözülmüş ham anahtarı kullanacak şekilde güncellendi.

### 6. `js/services/HistoricalArchiveService.js` — Eşik Özellik Adı Uyuşmazlığı
- **Kritik Hata:** `HistoricalArchiveService.js` içindeki `evaluateDailyPeacockRisk` fonksiyonu `thresholds?.peacockRainMin` alanını arıyordu. Ancak `AppConfig.DEFAULT_THRESHOLDS` ve domain spesifikasyonunda bu alan `peacockRainTrigger` olarak adlandırılmıştı. Bu durum yağış eşiğinin her zaman varsayılan 2.0 mm değerine düşmesine neden oluyordu.
- **Çözüm:** Eşik çözümü `thresholds?.peacockRainTrigger ?? thresholds?.peacockRainMin ?? 2.0` şeklinde güncellenerek geriye dönük tam uyumluluk sağlandı.

### 7. `js/ui/MapManager.js` — Leaflet Çift Başlatma (Already Initialized) Güvenliği
- **Kritik Hata:** Sayfa içi yeniden yüklemelerde veya DOM güncellemelerinde container üzerinde `_leaflet_id` kalması durumunda Leaflet `Map container is already initialized` istisnası fırlatmaktaydı.
- **Çözüm:** `initMapIfNeeded` metoduna `if (container._leaflet_id && !this.#map) { delete container._leaflet_id; }` kontrolü eklenerek çökme önlendi.

### 8. `css/styles.css` & `index.html` — Modal Backdrop ve Tailwind `.hidden` Çakışması (UI Kilitlenmesi)
- **Kritik Hata:** `index.html` içindeki 3 adet modal penceresi (`modal-settings`, `modal-admin-auth`, `modal-admin-dashboard`) üzerinde hem `flex` hem de `hidden` sınıfları bulunmaktaydı (`fixed inset-0 z-50 flex ... hidden`). CSS spesifiklik kuralları ve Tailwind CDN'in enjeksiyon sırasına bağlı olarak `.flex` (`display: flex`) kuralı `.hidden` (`display: none`) kuralını ezmekteydi. Bu durum, 3 modalın da başlangıçta tüm ekranı kaplayan (`fixed inset-0 z-50`) görünmez/yarı saydam perdelere dönüşmesine ve kullanıcıların ekrandaki hiçbir butona veya menüye tıklayamamasına (UI kilitlenmesi) neden oluyordu.
- **Çözüm:** `css/styles.css` dosyasına en üst öncelikle `.hidden, [hidden] { display: none !important; }`, `.modal-backdrop.hidden { display: none !important; pointer-events: none !important; }` ve `.modal-backdrop:not(.hidden) { display: flex !important; }` kuralları eklendi. `index.html` üzerindeki modallardan `flex` sınıfı kaldırılarak kapalıyken mutlak gizlilik garanti altına alındı.

### 9. `js/ai/ModelPipeline.js` — Wasm Dağıtım Yolları ve Çoklu İş Parçacığı Güvenliği
- **Kritik Hata:** Standart HTTP ortamında (`python3 -m http.server`) `Cross-Origin-Opener-Policy` ve `Cross-Origin-Embedder-Policy` başlıkları yer almadığı için `SharedArrayBuffer` kısıtlıdır. `ort.env.wasm.numThreads = 4` ayarlandığında ONNX Runtime Web'in arka planda SharedArrayBuffer gerektiren worker çalıştırmayı denemesi tarayıcıda `SecurityError` istisnasına yol açmaktaydı. Ayrıca ES6 modüllerinde `document.currentScript` `null` döndüğünden `ort.env.wasm.wasmPaths` açıkça tanımlanmadığında Wasm binary dosyaları çözümlenemiyordu.
- **Çözüm:** `ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";` açıkça sabitlendi ve `crossOriginIsolated` denetimi eklenerek başlıklar yokken 1 thread ile güvenli ve kararlı Wasm çıkarımı sağlandı.

### 10. `css/styles.css` & `index.html` — Üst Bar (Nav) Tailwind Responsive Kuralının Korunması
- **Kritik Hata:** Genel `.hidden { display: none !important; }` kuralı, Tailwind'in `hidden md:flex` ve `hidden sm:flex` gibi mobil-öncelikli duyarlı (responsive) sınıflarını ezmekteydi. Bu durum masaüstü ekran genişliğinde üst gezinme menüsünün (`nav`) ve ESP32 canlı durum çubuğunun gizlenmesine neden olmuştu.
- **Çözüm:** Kapsam daraltılarak `!important` kuralı yalnızca modallara (`.modal-backdrop.hidden`, `#modal-*.hidden`) ve SPA sekmelerine (`.tab-content.hidden`) sınırlandırıldı; Tailwind'in responsive `md:flex` ve `sm:flex` kuralları eksiksiz korundu. Ayrıca `favicon.ico 404` hatasını önlemek için SVG data URI eklendi.

### 11. `js/app.js`, `js/services/Esp32Service.js` & `js/ui/MapManager.js` — JavaScript Sözdizimi (SyntaxError) ve UI Etkileşim/Kilitlenme Onarımı
- **Kritik Hata:** `js/app.js` dosyasında `#renderAnnualArchiveUI` metodunun sonunda blok kapanış parantezi (`}`) eksikti. Bu durum `GemlikZeytinAIApplication` sınıf gövdesinin kapanmamasına ve ES6 modülü derlenirken `SyntaxError: Unexpected token '#bindOnnxModelUploadEvents'` hatasıyla script'in parse aşamasında çökmesine yol açıyordu. Sonuç olarak `app.initialize()` hiç çalışmıyor, hiçbir DOM butonuna veya menüsüne `click` olay dinleyicileri (event listener) bağlanamıyor ve tarayıcıda arayüz tamamen donmuş/tıklanamaz kalıyordu.
- **Çözüm:** 
  1. `js/app.js` içindeki `#renderAnnualArchiveUI` metodunun kapanış bloğu (`}`) tamamlandı ve sözdizimi doğrulaması yapıldı.
  2. Yaşam döngüsü başlatması `document.readyState === "loading"` kontrolü ile güçlendirilerek asenkron modül yükleme yarış koşulları (race condition) ortadan kaldırıldı.
  3. `js/services/Esp32Service.js` içerisindeki düğüm yolu temizleme regex ifadesinde unescaped slash (`^[\/.]+|[\/.]+$/g`) düzeltilerek ECMAScript regex uyumluluğu sağlandı.
  4. `js/ui/MapManager.js` içinde `updateLocation` ve `updateRiskDisplay` metotlarının harita henüz DOM'da başlatılmadan önce gelen konum ve risk DTO verilerini güvenle önbelleğe alması sağlandı; harita sekmesi açıldığında 2.5 km'lik risk çemberinin kayıpsız çizilmesi sağlandı.
  5. Modal pencereleri için dış alana (backdrop) tıklayarak ve `Escape` tuşuna basarak kapatma desteği eklenerek ekran kilitlenmesi riskleri tamamen bertaraf edildi.

### 12. `js/ai/ModelPipeline.js`, `index.html` & `css/styles.css` — Delik Yaprak Maske Birleştirme, Letterbox Temizliği, 3 Sınıf Olasılık Dağılımı ve Scanline Animasyonu
- **Kritik Hatalar ve Mimari Boşluklar:**
  1. *Maske Birleştirme Hatası (Delik Yaprak):* `3. İzole Yaprak` ekranında yaprağın içi lezyon bölgelerinde siyah deliklerle oyulmuş görünmekteydi. Model hem `leaf` hem `lesion` sınıflarını tespit ettiğinde önceki kod sadece `leaf` maskesini alıyor, leke alanlarını dışarıda bırakıyordu.
  2. *Letterbox (Gri Dolgular) ve Kırık Metin Kirliliği:* 1. ve 2. kartlarda tensör gereksinimi kaynaklı sağ ve sol `RGB(114, 114, 114)` gri blokları görsel kirlilik yaratıyor, kartların altında asimetrik kırık metinler kalıyordu.
  3. *Eksik Sınıflandırma Çıktısı:* Teşhis alanında yalnızca kazanan tek sınıf (%77.7 vb.) gösteriliyor, modelin ürettiği 3 sınıfın tamamının (Halkalı Leke, Zeytin Pas Akarı, Sağlıklı Yaprak) olasılık dağılımı listelenmiyordu.
  4. *Tarama ve Animasyon Eksikliği:* Analiz sırasında segmentasyon üzerinde yukarıdan aşağıya kayan sarı lazer çizgisi (`scanline`) ve aşamalı görselleştirme bulunmuyor, tüm kartlar ekrana aniden düşüyordu.
- **Uygulanan Çözümler:**
  1. `ModelPipeline.js` içinde `finalMaskBuffer` mantıksal VEYA (Logical OR / Union) ile birleştirildi: `final_mask = (leaf_mask | lesion_mask)`. `#applyBackgroundIsolation` metodunda zemin saf siyah `RGB(0,0,0)` yapılırken pikseller bu birleşik maskeyle aktarıldı; böylece yaprak lekeleriyle bir bütün olarak deliksiz izole edildi.
  2. 640x640 letterbox tuvali arka planda offscreen tensör olarak soyutlandı; ekrandaki `#canvas-step1`, `#canvas-step2` ve `#canvas-step3` unpad/crop koordinatlarında (`scaledW` x `scaledH`) çizilerek gri bloklar tamamen yok edildi; kart alt şeritleri simetrik ve temiz hale getirildi.
  3. EfficientNet-B0 çıktısındaki 3 sınıf Softmax ile hesaplandı; YOLOv8s-seg lezyon şiddetiyle hibritleştirilerek 3 sınıfın tamamı (Halkalı Leke, Pas Akarı, Sağlıklı) ayrı ayrı yüzde oranları ve ilerleme barlarıyla (`#probabilities-breakdown-list`) UI'a basıldı.
  4. `css/styles.css` dosyasına `@keyframes scanline` ve `.scanline-laser` efektleri eklendi; analiz süresince 2. kart üzerinde parlayan sarı tarama çizgisi oynatıldı ve `.pipeline-step-card` ile her aşama yumuşak bir geçişle (`fade-in-up`) sırayla belirecek şekilde senkronize edildi.

---

## 4. ÇALIŞTIRMA VE TEST REHBERİ

### 4.1 Gereksinimler
- Modern bir web tarayıcısı (Google Chrome 110+, Mozilla Firefox 110+, Safari 16.4+, Microsoft Edge).
- Web tarayıcısında **WebAssembly (Wasm)** ve **ES6 Module** desteği.
- ES6 Modüllerinin (`type="module"`) CORS kısıtlamalarına takılmaması için yerel bir statik HTTP sunucusu.

### 4.2 Projeyi Ayağa Kaldırma

Proje kök dizininde terminal açarak aşağıdaki komutlardan herhangi biriyle yerel sunucuyu başlatabilirsiniz:

#### Seçenek 1: Python 3 ile (Önerilen)
```bash
python3 -m http.server 8080
```

#### Seçenek 2: Node.js / npx ile
```bash
npx serve . -p 8080
# veya
npx http-server -p 8080 -c-1
```

#### Tarayıcıda Açma:
Tarayıcınızı açın ve adrese gidin:
```
http://localhost:8080
```

---

### 4.3 Adım Adım Doğrulama ve Test Senaryoları

#### Test 1: Başlangıç Senkronizasyonu ve CBS Haritası
1. Sayfa açıldığında sağ üstteki ESP32 durumu başlangıçta `ESP32 Bağlantısı Yok` (gri nokta) olarak görünmelidir.
2. Harita sekmesine (`İkili Risk Haritası`) geçin; harita Gemlik Havzası merkezli açılmalı ve üzerinde 2.5 km'lik yeşil/sarı risk çemberi bulunmalıdır.
3. Haritaya tıklayın veya pini sürükleyin; koordinat etiketi ve popup bahçe konumu anlık güncellenmelidir.
4. "Konumumu Al" butonuna tıklayarak GPS koordinatlarının haritaya yansıdığını test edin.

#### Test 2: Meteoroloji ve İnkübasyon Şeridi
1. Sağ üstteki Çark simgesine (Ayarlar) tıklayın; varsayılan sağlayıcının `Open-Meteo` olduğunu doğrulayın.
2. Harita sekmesindeki `60 Günlük Biyolojik İnkübasyon Penceresi` şeridini inceleyin; geçmiş 30 günün yağışları ve gelecek 16 günün risk seviyeleri kartlar halinde listelenmelidir.
3. Sayfanın en altındaki `Son 365 Gün İklim Geçmişi ve Kış Soğuklama İhtiyacı` panelinde kış soğuklama saati (<7.2°C), ilerleme çubuğu ve 12 aylık dağılım gridinin dolu geldiğini kontrol edin.

#### Test 3: Yönetici Eşik Paneli ve Web Crypto Girişi
1. Üst menüdeki Kilit simgesine tıklayın.
2. Parola alanına `admin123` yazıp Enter'a basın (SHA-256 doğrulaması çalışacaktır).
3. Açılan eşik panelinde Halkalı Leke ve Pas Akarı için tüm 7 adet alanın dolu geldiğini görün.
4. Değerleri değiştirip "Kaydet ve Yeniden Hesapla" butonuna basın; yeşil onay mesajı belirecek ve risk motoru yeni eşiklerle hesaplama yapacaktır.

#### Test 4: Çift Kademeli ONNX Yapay Zeka Teşhisi
1. `Teşhis Laboratuvarı` sekmesine geçin.
2. Modellerin otomatik taranarak `1. YOLOv8s-seg: Hazır (Wasm)` ve `2. EfficientNet-B0: Hazır (Wasm)` yeşil rozetlerini aldığını doğrulayın.
3. Bir yaprak fotoğrafı yükleyin veya sürükleyip drop-zone üzerine bırakın.
4. Boru hattı adımlarını aşamalı animasyonla izleyin:
   - **Adım 1 (Giriş & Odaklama):** Görüntü unpad/crop ile odaklanır, gri kenar dolguları olmadan temiz bir şekilde ilk kartta belirir (`fade-in-up`).
   - **Adım 2 (YOLOv8s-seg & Scanline):** İkinci kart yumuşakça açılır, üzerinde kayan sarı lazer tarama çizgisi (`@keyframes scanline`) oynatılır; 84 noktalı yeşil yaprak poligonu ve kırmızı lezyon alanı çizilir.
   - **Adım 3 (İzole Yaprak):** Mantıksal VEYA (`final_mask = leaf | lesion`) ile yaprağın içindeki delikler kapatılır; yaprak üzerindeki lekelerle beraber bir bütün olarak deliksiz izole edilirken arka plan saf siyah `RGB(0,0,0)` kalır.
   - **Adım 4 (Sınıflandırma & Olasılık Dağılımı):** Teşhis kartı açılır; modelin ürettiği 3 sınıfın tamamı (Zeytin Halkalı Leke, Zeytin Pas Akarı, Sağlıklı Gemlik Yaprağı) ayrı ayrı yüzde oranları ve renkli ilerleme barlarıyla (progress bars) listelenir; Bakanlık onaylı zirai reçete görüntülenir.

---

### 4.4 Güvenlik ve Kod Standartları Notu
- Tüm veri transferleri derinlemesine dondurulmuş (`Object.freeze`) DTO nesneleri ile yürütülür; katmanlar arası veri mutasyonu engellenmiştir.
- Leaflet harita popup'larında ve dinamik şablon dizelerinde OWASP A03 XSS filtrelemesi (`sanitizeHtml`) uygulanmaktadır.
- İstemci tarafında hiçbir açık metin (plaintext) parola saklanmaz; Web Crypto API SHA-256 özetleri kullanılır.
- ONNX tensörleri çıkarım sonrasında `dispose()` edilerek WebAssembly bellek sızıntıları tamamen önlenmiştir.
