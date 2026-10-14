/**
 * GemlikZeytinAI — Merkezi Durum, Spesifikasyon ve Yapılandırma Yöneticisi
 * Sürüm: 3.0.0 (Kurumsal Üretim Sürümü)
 * Sorumluluk: Gemlik biyolojik eşikleri, CBS parametreleri, doğrulanmış model metrikleri
 * ve optimize edilmiş localStorage durum yönetimi (Singleton Store).
 */

/**
 * Nesneleri tüm derinlikleriyle dondurarak katmanlar arası veri mutasyonunu önler.
 * Dokümantasyon Bölüm 3 Immutability şartını garanti eder.
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const prop = obj[key];
    if (
      prop !== null &&
      (typeof prop === "object" || typeof prop === "function") &&
      !Object.isFrozen(prop)
    ) {
      deepFreeze(prop);
    }
  }
  return obj;
}

/**
 * Dokümantasyon Bölüm 4.1 gereği API anahtarı için hafif (lightweight) yerel karartma/şifreleme.
 * Ağır kripto kütüphaneleri yüklemeden bellek ve depolama güvenliği sağlar.
 */
const SimpleCrypto = {
  encrypt: (text) => {
    if (!text) return "";
    try {
      return btoa(
        encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, p1) =>
          String.fromCharCode(parseInt(p1, 16)),
        ),
      );
    } catch {
      return text;
    }
  },
  decrypt: (cipher) => {
    if (!cipher) return "";
    try {
      return decodeURIComponent(
        Array.prototype.map
          .call(
            atob(cipher),
            (c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2),
          )
          .join(""),
      );
    } catch {
      return cipher;
    }
  },
};

export const GEMLIK_SPECS = deepFreeze({
  cultivarName: "Gemlik (Trilye)",
  scientificName: "Olea europaea cv. Gemlik",
  targetDiseases: {
    peacockSpot: {
      scientificName: "Spilocaea oleagina",
      commonName: "Zeytin Halkalı Leke Hastalığı",
      modelTask: "YOLOv8s-seg Lezyon Segmentasyonu & Alan Şiddeti (%)",
      verifiedLeafMap50: 99.4,
      verifiedPrecision: 91.0,
      verifiedMap50: 81.6,
      treatments: {
        early: "%1.0 - %1.5 Bordo Bulamacı (Sonbahar/İlkbahar Yağış Öncesi)",
        moderate: "Bakır Oksiklorid (WP) veya Bakır Hidroksit Preparatları",
        severe:
          "Azoxystrobin + Difenoconazole veya Kresoxim-methyl Sistemik Fungusit",
      },
    },
    rustMite: {
      scientificName: "Aceria oleae / Aculus olearius",
      commonName: "Zeytin Pas Akarı",
      modelTask: "EfficientNet-B0 Morfolojik Yaprak Sınıflandırması",
      verifiedRecall: 100.0,
      verifiedAccuracy: 98.99,
      treatments: {
        standard: "Islanabilir Kükürt (WP) (800g/100L su)",
        severe:
          "T.C. Tarım ve Orman Bakanlığı Ruhsatlı Abamectin Etkili Maddeli Akarisit",
      },
    },
  },
  modelArchitecture: {
    stage1:
      "YOLOv8s-seg (640x640) - Yaprak ve Leke Segmentasyonu & Arka Plan Maskeleme",
    stage2:
      "EfficientNet-B0 (224x224) - Arka Plandan Arındırılmış Morfolojik Sınıflandırma",
    modelFiles: {
      yolo: "models/yolov8_seg.onnx",
      classifier: "models/efficientnet.onnx",
    },
  },
});

export const AI_CLASSES = deepFreeze({
  PEACOCK: "Halkalı Leke (Spilocaea oleagina)",
  MITE: "Zeytin Pas Akarı (Aceria oleae)",
  HEALTHY: "Sağlıklı (Healthy)",
});

export const WEATHER_PROVIDERS = deepFreeze({
  OPEN_METEO: "open-meteo",
  OPENWEATHER: "openweather",
  WEATHERAPI: "weatherapi",
});

export const MAP_CONFIG = deepFreeze({
  esriTopo: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, and the GIS Community",
  },
  defaultLocation: {
    lat: 40.4326,
    lon: 29.1578,
    name: "Gemlik Havzası, Bursa",
  },
  defaultZoom: 11,
});

/**
 * Dokümantasyon Bölüm 6: Epidemiyolojik Risk ve Karar Eşikleri
 */
export const DEFAULT_THRESHOLDS = deepFreeze({
  // Halkalı Leke (Spilocaea oleagina)
  peacockHumidity: 85, // Kritik Bağıl Nem (%)
  peacockTempMin: 10, // Optimum Alt Sıcaklık (°C)
  peacockTempMax: 20, // Optimum Üst Sıcaklık (°C)
  peacockRainTrigger: 2.0, // Kritik 48 Saatlik Yağış Eşiği (mm)

  // Zeytin Pas Akarı (Aceria oleae)
  miteTempMin: 22, // Kolonizasyon Alt Sıcaklığı (°C)
  miteHumidityMax: 70, // Maksimum Kuru Nem Eşiği (%)
  miteRainSuppression: 5.0, // Yağış Baskılama ve Süpürme Eşiği (mm)
});

class AppConfigManager {
  #storageKey = "gemlik_ai_config_v3";

  #state = {
    weather: {
      provider: WEATHER_PROVIDERS.OPEN_METEO,
      apiKey: "", // Bellekte çözülmüş (plain), depolamada şifreli tutulur
    },
    hardware: {
      firebaseUrl: "",
      nodePath: "esp32_station",
      isOnline: false,
      lastTelemetry: null,
    },
    thresholds: { ...DEFAULT_THRESHOLDS },
    userLocation: { ...MAP_CONFIG.defaultLocation },
    customModelBuffers: {
      yolo: null,
      classifier: null,
    },
  };

  constructor() {
    this.loadFromStorage();
  }

  /* ==========================================================================
     4.1 Dokümantasyon Metot İmzaları
     ========================================================================== */

  /**
   * Doğrulanmış model başarımlarını ve Bakanlık reçetelerini döner.
   */
  getGemlikSpecs() {
    return GEMLIK_SPECS;
  }

  /**
   * Harita ve risk motoruyla uyumlu Gemlik zeytini kimliğini döner.
   */
  getActiveCultivar() {
    return deepFreeze({
      id: "gemlik",
      name: GEMLIK_SPECS.cultivarName,
      scientificName: GEMLIK_SPECS.scientificName,
      cultivar: GEMLIK_SPECS.cultivarName,
      peacockRiskMultiplier: 1.0,
      miteRiskMultiplier: 1.0,
      ...GEMLIK_SPECS,
    });
  }

  /**
   * Aktif hava sağlayıcısını ve dokümana uygun şifrelenmiş anahtarı döner.
   */
  getWeatherConfig() {
    return deepFreeze({
      provider: this.#state.weather.provider,
      apiKey: SimpleCrypto.encrypt(this.#state.weather.apiKey),
    });
  }

  /**
   * Servislerin iç kullanımında ham anahtarı okumasını sağlayan yardımcı metot.
   */
  getRawWeatherApiKey() {
    return this.#state.weather.apiKey;
  }

  /**
   * Hava durumu sağlayıcısını ve anahtarını günceller.
   */
  setWeatherConfig(provider, apiKey = "", persist = true) {
    const validProvider = Object.values(WEATHER_PROVIDERS).includes(provider)
      ? provider
      : WEATHER_PROVIDERS.OPEN_METEO;

    this.#state.weather.provider = validProvider;
    this.#state.weather.apiKey = String(apiKey || "").trim();

    if (persist) this.saveToStorage();
  }

  /**
   * Biyolojik karar eşiklerini döner.
   */
  getThresholds() {
    return deepFreeze({ ...this.#state.thresholds });
  }

  /**
   * Biyolojik sınır kontrolleriyle eşik değerlerini günceller.
   */
  setThresholds(newThresholds = {}, persist = true) {
    if (!newThresholds || typeof newThresholds !== "object") return;

    const validated = { ...this.#state.thresholds };

    // 1. Halkalı Leke Bağıl Nem (%0 - 100)
    if ("peacockHumidity" in newThresholds) {
      const v = Number(newThresholds.peacockHumidity);
      if (Number.isFinite(v) && v >= 0 && v <= 100)
        validated.peacockHumidity = v;
    }

    // 2. Halkalı Leke Sıcaklık Aralığı (tempMin < tempMax)
    let tempMin = validated.peacockTempMin;
    let tempMax = validated.peacockTempMax;

    if ("peacockTempMin" in newThresholds) {
      const v = Number(newThresholds.peacockTempMin);
      if (Number.isFinite(v) && v >= -15 && v <= 45) tempMin = v;
    }
    if ("peacockTempMax" in newThresholds) {
      const v = Number(newThresholds.peacockTempMax);
      if (Number.isFinite(v) && v >= -15 && v <= 45) tempMax = v;
    }

    if (tempMin < tempMax) {
      validated.peacockTempMin = tempMin;
      validated.peacockTempMax = tempMax;
    }

    // 3. Yağış Tetikleyicisi (mm >= 0)
    if ("peacockRainTrigger" in newThresholds) {
      const v = Number(newThresholds.peacockRainTrigger);
      if (Number.isFinite(v) && v >= 0 && v <= 300)
        validated.peacockRainTrigger = v;
    }

    // 4. Pas Akarı Alt Sıcaklık (°C)
    if ("miteTempMin" in newThresholds) {
      const v = Number(newThresholds.miteTempMin);
      if (Number.isFinite(v) && v >= -10 && v <= 50) validated.miteTempMin = v;
    }

    // 5. Pas Akarı Nem Üst Sınırı (%0 - 100)
    if ("miteHumidityMax" in newThresholds) {
      const v = Number(newThresholds.miteHumidityMax);
      if (Number.isFinite(v) && v >= 0 && v <= 100)
        validated.miteHumidityMax = v;
    }

    // 6. Pas Akarı Yağış Baskılaması (mm >= 0)
    if ("miteRainSuppression" in newThresholds) {
      const v = Number(newThresholds.miteRainSuppression);
      if (Number.isFinite(v) && v >= 0 && v <= 300)
        validated.miteRainSuppression = v;
    }

    this.#state.thresholds = validated;
    if (persist) this.saveToStorage();
  }

  /**
   * Belleğe yüklenen ONNX ikili modelini savunmacı kopyalama (slice) ile alır.
   * Transferable nesne çakışmalarını ve 'detached buffer' hatalarını engeller.
   */
  setCustomModelBuffer(type, arrayBuffer) {
    if (
      (type === "yolo" || type === "classifier") &&
      arrayBuffer instanceof ArrayBuffer &&
      arrayBuffer.byteLength > 0
    ) {
      this.#state.customModelBuffers[type] = arrayBuffer.slice(0);
      console.log(
        `[AppConfig] Özel ${type.toUpperCase()} modeli tampona alındı (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`,
      );
    }
  }

  /**
   * Bellekteki ikili model verisini döner.
   */
  getCustomModelBuffer(type) {
    const buf = this.#state.customModelBuffers[type];
    return buf ? buf.slice(0) : null;
  }

  /* ==========================================================================
     Donanım, Konum ve Durum Senkronizasyonu
     ========================================================================== */

  getHardwareConfig() {
    return deepFreeze({
      ...this.#state.hardware,
      lastTelemetry: this.#state.hardware.lastTelemetry
        ? { ...this.#state.hardware.lastTelemetry }
        : null,
    });
  }

  setHardwareConfig(firebaseUrl, nodePath = "esp32_station", persist = true) {
    let cleanUrl = "";
    const rawUrl = String(firebaseUrl || "").trim();

    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        cleanUrl = parsed.origin + parsed.pathname.replace(/\/$/, "");
      } catch {
        cleanUrl = rawUrl.replace(/\/$/, "");
      }
    }

    this.#state.hardware.firebaseUrl = cleanUrl;
    this.#state.hardware.nodePath =
      String(nodePath || "esp32_station").trim() || "esp32_station";

    if (persist) this.saveToStorage();
  }

  updateTelemetry(telemetryData, isOnline) {
    this.#state.hardware.isOnline = Boolean(isOnline);
    this.#state.hardware.lastTelemetry = telemetryData
      ? deepFreeze({ ...telemetryData })
      : null;
  }

  getUserLocation() {
    return deepFreeze({ ...this.#state.userLocation });
  }

  setUserLocation(lat, lon, name = "Gemlik Bahçesi", persist = true) {
    const numLat = Number(lat);
    const numLon = Number(lon);

    if (
      Number.isFinite(numLat) &&
      numLat >= -90 &&
      numLat <= 90 &&
      Number.isFinite(numLon) &&
      numLon >= -180 &&
      numLon <= 180
    ) {
      this.#state.userLocation = {
        lat: Number(numLat.toFixed(5)),
        lon: Number(numLon.toFixed(5)),
        name: String(name || "Gemlik Bahçesi").trim(),
      };
      if (persist) this.saveToStorage();
    }
  }

  /* ==========================================================================
     Kalıcılık Katmanı (Storage I/O - Optimize Edilmiş)
     ========================================================================== */

  saveToStorage() {
    try {
      const serializableData = {
        weather: {
          provider: this.#state.weather.provider,
          apiKey: SimpleCrypto.encrypt(this.#state.weather.apiKey),
        },
        hardware: {
          firebaseUrl: this.#state.hardware.firebaseUrl,
          nodePath: this.#state.hardware.nodePath,
        },
        thresholds: this.#state.thresholds,
        userLocation: this.#state.userLocation,
      };
      localStorage.setItem(this.#storageKey, JSON.stringify(serializableData));
    } catch (error) {
      console.warn("[AppConfig] LocalStorage yazma hatası:", error);
    }
  }

  loadFromStorage() {
    try {
      const rawData = localStorage.getItem(this.#storageKey);
      if (!rawData) return;

      const parsed = JSON.parse(rawData);

      // 1. Hava Durumu (Şifre çözülerek sessiz yüklenir)
      if (parsed.weather) {
        const decryptedKey = SimpleCrypto.decrypt(parsed.weather.apiKey);
        this.setWeatherConfig(parsed.weather.provider, decryptedKey, false);
      }

      // 2. Donanım (persist=false ile diske tekrar yazma engellenir)
      if (parsed.hardware) {
        this.setHardwareConfig(
          parsed.hardware.firebaseUrl,
          parsed.hardware.nodePath,
          false,
        );
      }

      // 3. Eşikler (persist=false)
      if (parsed.thresholds && typeof parsed.thresholds === "object") {
        this.setThresholds(parsed.thresholds, false);
      }

      // 4. Konum (persist=false)
      if (parsed.userLocation?.lat && parsed.userLocation?.lon) {
        this.setUserLocation(
          parsed.userLocation.lat,
          parsed.userLocation.lon,
          parsed.userLocation.name,
          false,
        );
      }
    } catch (error) {
      console.warn(
        "[AppConfig] LocalStorage yükleme uyarısı, varsayılanlar devrede:",
        error,
      );
    }
  }
}

export const AppConfig = new AppConfigManager();
