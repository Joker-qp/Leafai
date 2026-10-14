/**
 * GemlikZeytinAI — Uygulama Orkestratörü (Application Mediator)
 * Sürüm: 3.0.0 (Kurumsal Üretim Sürümü)
 * Sorumluluk: UI, CBS, Meteoroloji, IoT Telemetrisi ve ONNX Boru Hattı Senkronizasyonu
 */

import { AppConfig, WEATHER_PROVIDERS } from "./config/AppConfig.js";
import { WeatherService } from "./services/WeatherService.js";
import { HistoricalArchiveService } from "./services/HistoricalArchiveService.js";
import { Esp32Service } from "./services/Esp32Service.js";
import { RiskService } from "./services/RiskService.js";
import { ModelPipeline } from "./ai/ModelPipeline.js";
import { MapManager } from "./ui/MapManager.js";

class GemlikZeytinAIApplication {
  #currentWeather = null;
  #currentTelemetry = null;
  #activeTabId = "tab-home";
  #activeVideoUrl = null;

  // Güvenlik: İstemci tarafında düz metin (plaintext) parola saklanmaz.
  // "admin123" parolasının SHA-256 özeti:
  static #ADMIN_AUTH_HASH =
    "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";

  constructor() {}

  /**
   * Sistemin tüm alt bileşenlerini yaşam döngüsüne uygun sırayla ayağa kaldırır.
   */
  async initialize() {
    console.log("🌿 [GemlikZeytinAI] Sistem Başlatılıyor (v3.0.0)...");

    this.#hydrateSettingsUI();

    const initialLoc = AppConfig.getUserLocation();
    this.#updateLocationDisplay(
      initialLoc.lat,
      initialLoc.lon,
      initialLoc.name,
    );

    // Harita merkezini ve pinini başlangıç koordinatıyla eşitle
    MapManager.updateLocation(
      initialLoc.lat,
      initialLoc.lon,
      initialLoc.name,
      false,
    );

    // Etkinlik dinleyicilerini bağla
    this.#bindNavigationEvents();
    this.#bindModalEvents();
    this.#bindSettingsFormEvents();
    this.#bindAdminDashboardEvents();
    this.#bindDiagnosisMediaEvents();
    this.#bindVideoPlayerEvents();
    this.#bindOnnxModelUploadEvents();

    // Harita konum seçici aboneliği
    MapManager.onLocationPicked(async (lat, lon, locationName) => {
      console.log(
        `📍 [GemlikZeytinAI] Yeni bahçe sahası seçildi: ${locationName} (${lat}, ${lon})`,
      );
      this.#updateLocationDisplay(lat, lon, locationName);
      AppConfig.setUserLocation(lat, lon, locationName);

      // Konum değiştiğinde hava durumu ve arşivleri eşzamanlı yenile
      await this.refreshWeatherData(true);
      await Promise.allSettled([
        this.refreshIncubationTimeline(lat, lon),
        this.refreshAnnualClimateArchive(lat, lon),
      ]);
    });

    // 1. Önce Meteorolojik veriyi çek (Yarış durumunu önlemek için)
    await this.refreshWeatherData();

    // 2. İnkübasyon penceresini ve ERA5 yıllık iklim arşivini paralel yükle
    await Promise.allSettled([
      this.refreshIncubationTimeline(initialLoc.lat, initialLoc.lon),
      this.refreshAnnualClimateArchive(initialLoc.lat, initialLoc.lon),
    ]);

    // 3. IoT dinleyicisini hava durumu DTO'su hazır olduktan sonra başlat
    Esp32Service.subscribe((telemetryState) => {
      this.#handleTelemetryUpdate(telemetryState);
    });
    Esp32Service.startListener();

    // 4. ONNX Çıkarım Boru Hattını asenkron olarak güvenle derle
    try {
      await ModelPipeline.initialize();
      console.log(
        "🧠 [GemlikZeytinAI] Çift Kademeli ONNX modelleri Wasm hafızasına yüklendi.",
      );
    } catch (pipelineErr) {
      console.error(
        "[GemlikZeytinAI] ModelPipeline başlatma hatası:",
        pipelineErr,
      );
    }

    console.log("✅ [GemlikZeytinAI] Tüm sistem katmanları senkronize edildi.");
  }

  /**
   * SPA sekme geçiş yöneticisi
   */
  switchTab(targetTabId) {
    if (this.#activeTabId === targetTabId) return;

    document.querySelectorAll(".tab-content").forEach((el) => {
      el.classList.add("hidden");
    });

    const targetSection = document.getElementById(targetTabId);
    if (targetSection) {
      targetSection.classList.remove("hidden");
    }

    const navButtons = [
      { id: "nav-home", tab: "tab-home" },
      { id: "nav-diagnose", tab: "tab-diagnose" },
      { id: "nav-map", tab: "tab-map" },
    ];

    navButtons.forEach(({ id, tab }) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      if (tab === targetTabId) {
        btn.className =
          "nav-btn px-4 py-2 rounded-lg text-sm font-semibold text-olive-600 bg-olive-50 transition";
      } else {
        btn.className =
          "nav-btn px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition";
      }
    });

    this.#activeTabId = targetTabId;

    if (targetTabId === "tab-map") {
      MapManager.initMapIfNeeded();
      MapManager.invalidateSize();
    }
  }

  /**
   * Aktif meteoroloji sağlayıcısından tahmin verilerini çeker ve DTO ile UI'ı besler.
   */
  async refreshWeatherData(forceRefresh = false) {
    const loc = AppConfig.getUserLocation();
    const providerLabel = document.getElementById(
      "active-weather-provider-label",
    );

    try {
      this.#currentWeather = await WeatherService.getForecast(
        loc.lat,
        loc.lon,
        forceRefresh,
      );

      if (this.#currentWeather.fallbackTriggered) {
        if (providerLabel) {
          providerLabel.innerHTML = `<span class="text-amber-600 font-bold" title="${this.#currentWeather.failureReason}">⚠️ ${this.#currentWeather.originalRequestedProvider.toUpperCase()} (Yedek: Open-Meteo)</span>`;
        }
      } else {
        if (providerLabel) {
          providerLabel.innerHTML = `<span class="text-emerald-600 font-bold">✓ ${this.#currentWeather.provider.toUpperCase()}</span>`;
        }
      }

      this.#updateWeatherUI(this.#currentWeather);
      this.#recalculateAndRenderDualRisk();
    } catch (error) {
      console.error(
        "[GemlikZeytinAI] Meteorolojik veri alınamadı:",
        error.message,
      );
      if (providerLabel) {
        providerLabel.innerText = "Hata Oluştu";
      }
    }
  }

  /**
   * 60 Günlük (-30/+16) inkübasyon zaman çizelgesi verilerini çeker.
   */
  async refreshIncubationTimeline(lat, lon) {
    try {
      const timelineData = await HistoricalArchiveService.getIncubationTimeline(
        lat,
        lon,
      );
      if (timelineData) {
        this.#renderIncubationTimelineUI(timelineData);
      }
    } catch (err) {
      console.warn(
        "[GemlikZeytinAI] İnkübasyon zaman çizelgesi alınamadı:",
        err.message,
      );
    }
  }

  /**
   * ERA5 365 Günlük İklim Arşivini ve Gemlik Zeytini kış soğuklama saatlerini (<7.2°C) hesaplar.
   */
  async refreshAnnualClimateArchive(lat, lon) {
    try {
      const archiveData =
        await HistoricalArchiveService.getAnnualClimateArchive(lat, lon);
      if (archiveData) {
        this.#renderAnnualArchiveUI(archiveData);
      }
    } catch (err) {
      console.warn(
        "[GemlikZeytinAI] Yıllık iklim arşivi ve soğuklama verisi alınamadı:",
        err.message,
      );
    }
  }

  #handleTelemetryUpdate(telemetryState) {
    this.#currentTelemetry = telemetryState;

    const dot = document.getElementById("esp-status-dot");
    const text = document.getElementById("esp-status-text");
    const telemetryDot = document.getElementById("esp-telemetry-dot");
    const tempEl = document.getElementById("esp-temp-val");
    const humEl = document.getElementById("esp-hum-val");

    if (telemetryState.isOnline) {
      if (dot)
        dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 pulse-online";
      if (text) text.innerText = "ESP32 Canlı";
      if (telemetryDot)
        telemetryDot.className =
          "w-2.5 h-2.5 rounded-full bg-emerald-500 pulse-online";

      if (tempEl)
        tempEl.innerText = `${telemetryState.temperature.toFixed(1)} °C`;
      if (humEl) humEl.innerText = `${telemetryState.humidity.toFixed(0)} %`;
    } else {
      if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-slate-400";
      if (text) text.innerText = "ESP32 Bağlantısı Yok";
      if (telemetryDot)
        telemetryDot.className = "w-2.5 h-2.5 rounded-full bg-slate-500";

      if (tempEl) tempEl.innerText = "--.- °C";
      if (humEl) humEl.innerText = "--.- %";
    }

    this.#recalculateAndRenderDualRisk();
  }

  /**
   * İkili Biyolojik Risk Motorunu (Halkalı Leke & Pas Akarı) tetikler ve UI/CBS'e yansıtır.
   */
  #recalculateAndRenderDualRisk() {
    // Koruma: Meteorolojik veri henüz çözümlenmediyse çalışma zamanı hatasını önle
    if (!this.#currentWeather) return;

    const dualReport = RiskService.evaluateDualRisk(
      this.#currentWeather,
      this.#currentTelemetry,
    );

    const pBadge = document.getElementById("peacock-risk-badge");
    const pTitle = document.getElementById("peacock-risk-title");
    const pDesc = document.getElementById("peacock-risk-desc");

    if (pBadge) {
      pBadge.innerText = `%${dualReport.peacock.score} Risk`;
      pBadge.className = `px-2 py-0.5 rounded-full text-xs font-bold ${dualReport.peacock.badgeClass}`;
    }
    if (pTitle) pTitle.innerText = dualReport.peacock.title;
    if (pDesc) {
      pDesc.innerText = `${dualReport.peacock.description} ${dualReport.peacock.action}`;
    }

    const mBadge = document.getElementById("mite-risk-badge");
    const mTitle = document.getElementById("mite-risk-title");
    const mDesc = document.getElementById("mite-risk-desc");

    if (mBadge) {
      mBadge.innerText = `%${dualReport.mite.score} Tehdit`;
      mBadge.className = `px-2 py-0.5 rounded-full text-xs font-bold ${dualReport.mite.badgeClass}`;
    }
    if (mTitle) mTitle.innerText = dualReport.mite.title;
    if (mDesc) {
      mDesc.innerText = `${dualReport.mite.description} ${dualReport.mite.action}`;
    }

    MapManager.updateRiskDisplay(dualReport.overall, this.#currentTelemetry);
  }

  #updateWeatherUI(weather) {
    if (!weather) return;

    const tempEl = document.getElementById("weather-temp-val");
    const humEl = document.getElementById("weather-hum-val");

    if (tempEl)
      tempEl.innerText = `${weather.current.temperature.toFixed(1)} °C`;
    if (humEl) humEl.innerText = `${weather.current.humidity.toFixed(0)} %`;
  }

  #updateLocationDisplay(lat, lon, name) {
    const nameLabel = document.getElementById("map-location-name-label");
    const coordDisplay = document.getElementById("map-coord-display");

    if (nameLabel) nameLabel.innerText = name;
    if (coordDisplay) {
      coordDisplay.innerText = `${Number(lat).toFixed(4)}°N, ${Number(lon).toFixed(4)}°E`;
    }
  }

  #renderIncubationTimelineUI(timelineData) {
    const strip = document.getElementById("timeline-scroll-strip");
    const pastRainBadge = document.getElementById("timeline-past-rain-val");
    const pastRiskDaysBadge = document.getElementById(
      "timeline-past-risk-days-val",
    );
    const futureRainBadge = document.getElementById("timeline-future-rain-val");

    if (pastRainBadge)
      pastRainBadge.innerText = `${timelineData.summaryStats.pastRainSum} mm`;
    if (pastRiskDaysBadge)
      pastRiskDaysBadge.innerText = `${timelineData.summaryStats.pastRiskDaysCount} Gün`;
    if (futureRainBadge)
      futureRainBadge.innerText = `${timelineData.summaryStats.futureRainSum} mm`;

    if (!strip) return;
    strip.innerHTML = "";

    timelineData.dailyPoints.forEach((point) => {
      let tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">Geçmiş</span>`;
      let borderClass = "border-slate-200 bg-white";

      if (point.isToday) {
        tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-olive-500 text-white animate-pulse">Bugün</span>`;
        borderClass =
          "border-olive-500 bg-olive-50/50 shadow-md ring-2 ring-olive-500/20";
      } else if (!point.isPast) {
        tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">Tahmin</span>`;
        borderClass = "border-blue-100 bg-slate-50/70";
      }

      let riskPill = `<span class="text-[10px] font-bold text-emerald-600">%${point.riskScore} Düşük</span>`;
      if (point.riskLevel === "critical") {
        riskPill = `<span class="text-[10px] font-bold text-red-600 animate-pulse">%${point.riskScore} Kritik</span>`;
      } else if (point.riskLevel === "high") {
        riskPill = `<span class="text-[10px] font-bold text-orange-600">%${point.riskScore} Yüksek</span>`;
      } else if (point.riskLevel === "moderate") {
        riskPill = `<span class="text-[10px] font-bold text-amber-600">%${point.riskScore} Orta</span>`;
      }

      const card = document.createElement("div");
      card.className = `flex-shrink-0 w-32 p-3 rounded-2xl border ${borderClass} flex flex-col justify-between text-center space-y-2 snap-center transition hover:scale-105`;
      card.innerHTML = `
        <div class="flex items-center justify-between pb-1 border-b border-slate-100">
          <span class="text-[11px] font-black text-slate-800">${point.date.slice(5)}</span>
          ${tagBadge}
        </div>
        <div class="space-y-0.5">
          <span class="text-xs font-bold text-slate-900 block">${point.tMax}° / ${point.tMin}°</span>
          <span class="text-[11px] text-blue-600 font-semibold block">
            <i class="fa-solid fa-cloud-rain mr-0.5"></i> ${point.rain} mm
          </span>
          <span class="text-[10px] text-slate-400 block">%${point.humidity} Nem</span>
        </div>
        <div class="pt-1 border-t border-slate-100">
          ${riskPill}
        </div>
      `;
      strip.appendChild(card);
    });

    setTimeout(() => {
      const todayCard = strip.querySelector(".ring-olive-500\\/20");
      if (todayCard) {
        todayCard.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      }
    }, 400);
  }

  /**
   * ERA5 Arşiv UI bileşenlerini (Soğuklama saati ve kümülatif yağış) günceller.
   */
  #renderAnnualArchiveUI(archiveData) {
    const chillingHoursEl = document.getElementById("era5-chilling-hours-val");
    const annualRainfallEl = document.getElementById(
      "era5-annual-rainfall-val",
    );
    const highRiskDaysEl = document.getElementById("era5-high-risk-days-val");

    if (chillingHoursEl) {
      chillingHoursEl.innerText = `${archiveData.chillingHoursEstimate} Saat`;
    }
    if (annualRainfallEl) {
      annualRainfallEl.innerText = `${archiveData.totalRainfallMm.toFixed(1)} mm`;
    }
    if (highRiskDaysEl) {
      highRiskDaysEl.innerText = `${archiveData.highRiskDaysCount} Gün`;
    }
  }

  #bindOnnxModelUploadEvents() {
    const onnxFileInput = document.getElementById("onnx-file-input");
    const triggerBtn = document.getElementById("btn-trigger-onnx-upload");

    triggerBtn?.addEventListener("click", () => onnxFileInput?.click());

    onnxFileInput?.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          const fileName = file.name.toLowerCase();

          // Dokümantasyon 4.1: Modeli tipine göre AppConfig Store katmanına al
          const modelType =
            fileName.includes("seg") || fileName.includes("yolo")
              ? "yolo"
              : "classifier";

          AppConfig.setCustomModelBuffer(modelType, buffer);
          await ModelPipeline.loadModelFromBuffer(file.name, buffer);

          console.log(
            `🧠 [GemlikZeytinAI] Özel model yüklendi [${modelType.toUpperCase()}]: ${file.name}`,
          );
        } catch (err) {
          console.error(
            `[GemlikZeytinAI] Model yükleme hatası (${file.name}):`,
            err,
          );
        }
      }
    });
  }

  #bindVideoPlayerEvents() {
    const videoInput = document.getElementById("local-video-input");
    const videoPlayer = document.getElementById("cinematic-demo-video");

    videoInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file && videoPlayer) {
        // Bellek sızıntısını önlemek için önceki Blob referansını serbest bırak
        if (this.#activeVideoUrl) {
          URL.revokeObjectURL(this.#activeVideoUrl);
        }

        this.#activeVideoUrl = URL.createObjectURL(file);
        videoPlayer.src = this.#activeVideoUrl;
        videoPlayer.play().catch((err) => {
          console.warn(
            "[GemlikZeytinAI] Video otomatik oynatılamadı:",
            err.message,
          );
        });

        console.log(
          `🎬 [GemlikZeytinAI] Yeni sinematik HUD videosu atandı: "${file.name}"`,
        );
      }
    });
  }

  #hydrateSettingsUI() {
    const weatherConfig = AppConfig.getWeatherConfig();
    const hardwareConfig = AppConfig.getHardwareConfig();

    const providerSelect = document.getElementById(
      "cfg-weather-provider-select",
    );
    const keyWrapper = document.getElementById("cfg-weather-key-wrapper");
    const keyInput = document.getElementById("cfg-weather-api-key");

    if (providerSelect) {
      providerSelect.value = weatherConfig.provider;
      if (weatherConfig.provider === WEATHER_PROVIDERS.OPEN_METEO) {
        keyWrapper?.classList.add("hidden");
      } else {
        keyWrapper?.classList.remove("hidden");
      }
    }

    if (keyInput) keyInput.value = weatherConfig.apiKey || "";

    const fbUrlInput = document.getElementById("cfg-firebase-url");
    const fbNodeInput = document.getElementById("cfg-firebase-node");

    if (fbUrlInput) fbUrlInput.value = hardwareConfig.firebaseUrl || "";
    if (fbNodeInput)
      fbNodeInput.value = hardwareConfig.nodePath || "esp32_station";
  }

  async #handleSettingsSave() {
    const provider = document.getElementById(
      "cfg-weather-provider-select",
    )?.value;
    const apiKey = document.getElementById("cfg-weather-api-key")?.value || "";
    const firebaseUrl =
      document.getElementById("cfg-firebase-url")?.value || "";
    const nodePath =
      document.getElementById("cfg-firebase-node")?.value || "esp32_station";

    AppConfig.setWeatherConfig(provider, apiKey);
    WeatherService.clearCache();

    // Zamanlayıcı ve bellek sızıntısını önlemek için önce mevcut IoT dinleyicisini sonlandır
    Esp32Service.stopListener();
    AppConfig.setHardwareConfig(firebaseUrl, nodePath);
    Esp32Service.startListener();

    this.#toggleModal("modal-settings", false);
    await this.refreshWeatherData(true);

    alert("Sistem ve API ayarları başarıyla güncellendi!");
  }

  #hydrateAdminThresholds() {
    const thresholds = AppConfig.getThresholds();
    const peacockHum = document.getElementById("adm-peacock-hum");
    const peacockTemp = document.getElementById("adm-peacock-temp");
    const miteTemp = document.getElementById("adm-mite-temp");
    const miteHum = document.getElementById("adm-mite-hum");

    if (peacockHum) peacockHum.value = thresholds.peacockHumidity;
    if (peacockTemp)
      peacockTemp.value = `${thresholds.peacockTempMin}-${thresholds.peacockTempMax}`;
    if (miteTemp) miteTemp.value = thresholds.miteTempMin;
    if (miteHum) miteHum.value = thresholds.miteHumidityMax;
  }

  /**
   * Web Crypto API (SHA-256) Güvenli Kimlik Doğrulama
   */
  async #handleAdminAuthSubmit() {
    const passInput = document.getElementById("admin-password-input");
    const errorEl = document.getElementById("admin-auth-error");
    if (!passInput) return;

    try {
      const inputHash = await this.#hashStringSHA256(passInput.value);

      if (inputHash === GemlikZeytinAIApplication.#ADMIN_AUTH_HASH) {
        errorEl?.classList.add("hidden");
        passInput.value = "";
        this.#toggleModal("modal-admin-auth", false);
        this.#hydrateAdminThresholds();
        this.#toggleModal("modal-admin-dashboard", true);
      } else {
        errorEl?.classList.remove("hidden");
      }
    } catch (cryptoErr) {
      console.error("[GemlikZeytinAI] Kimlik doğrulama hatası:", cryptoErr);
    }
  }

  async #hashStringSHA256(text) {
    const buffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  #handleAdminThresholdsSave() {
    const hum = parseFloat(document.getElementById("adm-peacock-hum")?.value);
    const tempRange = (
      document.getElementById("adm-peacock-temp")?.value || "10-20"
    ).split("-");
    const miteTemp = parseFloat(
      document.getElementById("adm-mite-temp")?.value,
    );
    const miteHum = parseFloat(document.getElementById("adm-mite-hum")?.value);

    AppConfig.setThresholds({
      peacockHumidity: Number.isNaN(hum) ? 85 : hum,
      peacockTempMin: parseFloat(tempRange[0]) || 10,
      peacockTempMax: parseFloat(tempRange[1]) || 20,
      miteTempMin: Number.isNaN(miteTemp) ? 22 : miteTemp,
      miteHumidityMax: Number.isNaN(miteHum) ? 70 : miteHum,
    });

    const statusEl = document.getElementById("admin-save-status");
    if (statusEl) {
      statusEl.classList.remove("hidden");
      setTimeout(() => {
        statusEl.classList.add("hidden");
        this.#toggleModal("modal-admin-dashboard", false);
        this.#recalculateAndRenderDualRisk();
      }, 700);
    }
  }

  async requestPermission(type) {
    if (type === "notifications") {
      if (!("Notification" in window)) {
        alert("Tarayıcınız masaüstü bildirimlerini desteklemiyor.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        alert(
          "Bildirim izni onaylandı! Kritik enfeksiyon günlerinde uyarı alacaksınız.",
        );
      }
    } else if (type === "location") {
      this.updateUserLocation();
    } else if (type === "camera") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        alert("Kamera erişimi doğrulandı.");
        stream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        alert(`Kamera izni alınamadı: ${err.message}`);
      }
    }
  }

  updateUserLocation() {
    if (!navigator.geolocation) {
      alert("Tarayıcınız konum servisini desteklemiyor.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const locationName = "GPS Bahçe Konumunuz";

        AppConfig.setUserLocation(lat, lon, locationName);
        this.#updateLocationDisplay(lat, lon, locationName);

        MapManager.updateLocation(lat, lon, locationName, true);
        await this.refreshWeatherData(true);
        await Promise.allSettled([
          this.refreshIncubationTimeline(lat, lon),
          this.refreshAnnualClimateArchive(lat, lon),
        ]);
        alert("Bahçe koordinatlarınız başarıyla güncellendi!");
      },
      (err) => {
        console.warn("[GemlikZeytinAI] Konum alınamadı:", err.message);
        alert("Konum alınamadı, kayıtlı bahçe sahası baz alınıyor.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  #bindNavigationEvents() {
    document
      .getElementById("brand-logo-btn")
      ?.addEventListener("click", () => this.switchTab("tab-home"));
    document
      .getElementById("nav-home")
      ?.addEventListener("click", () => this.switchTab("tab-home"));
    document
      .getElementById("nav-diagnose")
      ?.addEventListener("click", () => this.switchTab("tab-diagnose"));
    document
      .getElementById("nav-map")
      ?.addEventListener("click", () => this.switchTab("tab-map"));

    document
      .getElementById("hero-btn-diagnose")
      ?.addEventListener("click", () => this.switchTab("tab-diagnose"));
    document
      .getElementById("hero-btn-map")
      ?.addEventListener("click", () => this.switchTab("tab-map"));
    document
      .getElementById("btn-update-location")
      ?.addEventListener("click", () => this.updateUserLocation());
  }

  #bindModalEvents() {
    document
      .getElementById("btn-open-settings")
      ?.addEventListener("click", () => {
        this.#hydrateSettingsUI();
        this.#toggleModal("modal-settings", true);
      });
    document
      .getElementById("btn-close-settings")
      ?.addEventListener("click", () =>
        this.#toggleModal("modal-settings", false),
      );
    document
      .getElementById("btn-cancel-settings")
      ?.addEventListener("click", () =>
        this.#toggleModal("modal-settings", false),
      );

    document
      .getElementById("btn-open-admin-auth")
      ?.addEventListener("click", () =>
        this.#toggleModal("modal-admin-auth", true),
      );
    document
      .getElementById("btn-cancel-admin-auth")
      ?.addEventListener("click", () =>
        this.#toggleModal("modal-admin-auth", false),
      );
    document
      .getElementById("btn-close-admin-dashboard")
      ?.addEventListener("click", () =>
        this.#toggleModal("modal-admin-dashboard", false),
      );
    document
      .getElementById("btn-cancel-admin-dashboard")
      ?.addEventListener("click", () =>
        this.#toggleModal("modal-admin-dashboard", false),
      );
  }

  #bindSettingsFormEvents() {
    const weatherProviderSelect = document.getElementById(
      "cfg-weather-provider-select",
    );
    const weatherKeyWrapper = document.getElementById(
      "cfg-weather-key-wrapper",
    );

    weatherProviderSelect?.addEventListener("change", (e) => {
      if (e.target.value === WEATHER_PROVIDERS.OPEN_METEO) {
        weatherKeyWrapper?.classList.add("hidden");
      } else {
        weatherKeyWrapper?.classList.remove("hidden");
      }
    });

    document
      .getElementById("btn-save-settings")
      ?.addEventListener("click", () => this.#handleSettingsSave());
    document
      .getElementById("btn-perm-camera")
      ?.addEventListener("click", () => this.requestPermission("camera"));
    document
      .getElementById("btn-perm-location")
      ?.addEventListener("click", () => this.requestPermission("location"));
    document
      .getElementById("btn-perm-notif")
      ?.addEventListener("click", () =>
        this.requestPermission("notifications"),
      );
  }

  #bindAdminDashboardEvents() {
    document
      .getElementById("btn-submit-admin-auth")
      ?.addEventListener("click", () => this.#handleAdminAuthSubmit());
    document
      .getElementById("admin-password-input")
      ?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.#handleAdminAuthSubmit();
      });
    document
      .getElementById("btn-save-admin-thresholds")
      ?.addEventListener("click", () => this.#handleAdminThresholdsSave());
  }

  #bindDiagnosisMediaEvents() {
    const fileInput = document.getElementById("leaf-file-input");
    const uploadBtn = document.getElementById("btn-trigger-upload");
    const cameraBtn = document.getElementById("btn-trigger-camera");

    uploadBtn?.addEventListener("click", () => fileInput?.click());

    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = async () => {
        // Bellek sızıntısını engelle
        URL.revokeObjectURL(objectUrl);
        try {
          await ModelPipeline.processLeafImage(img);
        } catch (inferErr) {
          console.error("[GemlikZeytinAI] Teşhis boru hattı hatası:", inferErr);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        console.error("[GemlikZeytinAI] Görsel dosyası okunamadı.");
      };

      img.src = objectUrl;
    });

    cameraBtn?.addEventListener("click", async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = document.createElement("video");
        video.srcObject = stream;
        await video.play();

        video.onloadedmetadata = () => {
          setTimeout(async () => {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0);

            // Akışı durdur ve kamerayı serbest bırak
            stream.getTracks().forEach((track) => track.stop());

            try {
              await ModelPipeline.processLeafImage(canvas);
            } catch (inferErr) {
              console.error(
                "[GemlikZeytinAI] Kamera teşhis boru hattı hatası:",
                inferErr,
              );
            }
          }, 400);
        };
      } catch (err) {
        alert(`Kamera başlatılamadı: ${err.message}`);
      }
    });
  }

  #toggleModal(modalId, isVisible) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (isVisible) {
      modal.classList.remove("hidden");
    } else {
      modal.classList.add("hidden");
    }
  }
}

// Singleton Örneği Başlat
const app = new GemlikZeytinAIApplication();

document.addEventListener("DOMContentLoaded", () => {
  app.initialize();
});

window.GemlikZeytinAI = app;
