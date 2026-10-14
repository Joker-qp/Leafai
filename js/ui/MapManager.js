/**
 * GemlikZeytinAI - Esri CBS Harita ve Etkileşimli Konum Yöneticisi
 * Sürüm: 3.0.0 (Kurumsal Üretim Sürümü)
 * Standartlar: Clean Architecture, OWASP Top 10 (A03 XSS Mitigation), Leaflet v1.9+
 */

import { AppConfig, MAP_CONFIG } from "../config/AppConfig.js";

/**
 * XSS zafiyetlerini önlemek için HTML özel karakterlerini filtreler (OWASP Sanitizer).
 * @param {unknown} value - Temizlenecek metin
 * @returns {string} Güvenli HTML metni
 */
function sanitizeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class MapManagerOrchestrator {
  #map = null;
  #marker = null;
  #riskCircle = null;
  #isInitialized = false;
  #tileLayer = null;
  #onLocationChangeCallback = null;
  #customIcon = null;

  // Asenkron yarış koşullarını (Race Condition) önlemek için AbortController
  #geocodeAbortController = null;

  // Harita etkileşimlerinde durum kaybını (State Loss) önleyen dahili önbellek
  #cachedLocation = { lat: 40.4286, lon: 29.1556, name: "Gemlik (Merkez)" };
  #cachedRiskReport = null;
  #cachedTelemetryState = null;

  constructor() {
    this.#initializeDefaultLocation();
  }

  /**
   * AppConfig üzerinden başlangıç konumunu güvenli biçimde çözer.
   */
  #initializeDefaultLocation() {
    try {
      if (typeof AppConfig.getUserLocation === "function") {
        const userLoc = AppConfig.getUserLocation();
        if (
          userLoc &&
          Number.isFinite(userLoc.lat) &&
          Number.isFinite(userLoc.lon)
        ) {
          this.#cachedLocation = {
            lat: Number(userLoc.lat),
            lon: Number(userLoc.lon),
            name: userLoc.name || "Gemlik Zeytin Bahçesi",
          };
        }
      }
    } catch (e) {
      console.warn(
        "[MapManager] AppConfig konumu okunamadı, varsayılan Gemlik koordinatları devrede:",
        e,
      );
    }
  }

  /**
   * Konum değişikliklerini dinleyen gözlemciyi kaydeder.
   * @param {(lat: number, lon: number, name: string) => void} callback
   */
  onLocationPicked(callback) {
    if (typeof callback === "function") {
      this.#onLocationChangeCallback = callback;
    }
  }

  /**
   * Esri Topoğrafya kiremitleriyle Leaflet haritasını idempotent olarak başlatır.
   */
  initMapIfNeeded() {
    if (typeof L === "undefined") {
      console.warn(
        "[MapManager] Leaflet.js kütüphanesi henüz DOM'a yüklenmedi.",
      );
      return;
    }

    const container = document.getElementById("risk-map");
    if (!container) {
      console.warn("[MapManager] '#risk-map' DOM konteyneri bulunamadı.");
      return;
    }

    if (this.#isInitialized && this.#map) {
      this.invalidateSize();
      return;
    }

    try {
      const defaultZoom = MAP_CONFIG?.defaultZoom ?? 13;
      const esriConfig = MAP_CONFIG?.esriTopo ?? {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        maxZoom: 19,
        attribution:
          "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, USGS, METI",
      };

      this.#map = L.map("risk-map", {
        center: [this.#cachedLocation.lat, this.#cachedLocation.lon],
        zoom: defaultZoom,
        zoomControl: true,
        attributionControl: true,
      });

      this.#tileLayer = L.tileLayer(esriConfig.url, {
        maxZoom: esriConfig.maxZoom,
        attribution: esriConfig.attribution,
      }).addTo(this.#map);

      this.#setupGardenMarkerIcon();
      this.#createMarkerInstance(
        this.#cachedLocation.lat,
        this.#cachedLocation.lon,
        this.#cachedLocation.name,
      );
      this.#bindInteractiveMapClicks();

      this.#isInitialized = true;
      this.invalidateSize();

      console.info(
        "[MapManager] Esri CBS Haritası ve etkileşimli pin başarıyla başlatıldı.",
      );
    } catch (error) {
      console.error(
        "[MapManager] Harita başlatma esnasında kritik hata:",
        error,
      );
    }
  }

  /**
   * Özel Gemlik Zeytini harita pinini yapılandırır.
   */
  #setupGardenMarkerIcon() {
    this.#customIcon = L.divIcon({
      className: "custom-garden-pin",
      html: `
        <div style="
          width: 36px;
          height: 36px;
          background-color: #5c6f34;
          color: #ffffff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
          border: 2px solid #ffffff;
          cursor: grab;
        " title="Bahçeyi taşımak için sürükleyin veya haritada bir yere tıklayın">
          <i class="fa-solid fa-leaf" style="transform: rotate(45deg); font-size: 15px;"></i>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -34],
    });
  }

  /**
   * İşaretçi nesnesini (Marker) yalnızca bir defa üretir ve olay dinleyicilerini bağlar.
   */
  #createMarkerInstance(lat, lon, name) {
    if (this.#marker) return;

    this.#marker = L.marker([lat, lon], {
      icon: this.#customIcon,
      draggable: true,
    }).addTo(this.#map);

    this.#marker.on("dragend", async (e) => {
      const position = e.target.getLatLng();
      const newLat = Number(position.lat.toFixed(4));
      const newLon = Number(position.lng.toFixed(4));

      // Konum adını yarış koşulundan arındırılmış olarak çözümle
      const locationName = await this.#resolveLocationName(newLat, newLon);

      this.updateLocation(newLat, newLon, locationName, false);

      if (this.#onLocationChangeCallback) {
        this.#onLocationChangeCallback(newLat, newLon, locationName);
      }
    });

    this.#renderPopup(name);
  }

  /**
   * Harita tıklamalarını bağlar.
   */
  #bindInteractiveMapClicks() {
    if (!this.#map) return;

    this.#map.on("click", async (e) => {
      const lat = Number(e.latlng.lat.toFixed(4));
      const lon = Number(e.latlng.lng.toFixed(4));

      const locationName = await this.#resolveLocationName(lat, lon);

      this.updateLocation(lat, lon, locationName, true);

      if (this.#onLocationChangeCallback) {
        this.#onLocationChangeCallback(lat, lon, locationName);
      }
    });
  }

  /**
   * Sekme geçişlerindeki Leaflet gri kiremit kırpışmasını önler.
   */
  invalidateSize() {
    if (!this.#map) return;
    setTimeout(() => {
      try {
        this.#map.invalidateSize();
      } catch (err) {
        console.warn("[MapManager] InvalidateSize çağrısı başarısız:", err);
      }
    }, 200);
  }

  /**
   * İşaretçiyi taşır, popup içeriğini korur ve opsiyonel kamera animasyonu yürütür.
   * Bellek sızıntısını önlemek için marker yeniden oluşturulmaz, taşınır.
   *
   * @param {number} lat - Enlem
   * @param {number} lon - Boylam
   * @param {string} [name="Zeytin Bahçesi"] - Konum Adı
   * @param {boolean} [shouldFly=false] - Harita kamerası uçurulsun mu?
   */
  updateLocation(lat, lon, name = "Zeytin Bahçesi", shouldFly = false) {
    if (!this.#map) return;

    const targetLat = Number(lat);
    const targetLon = Number(lon);

    this.#cachedLocation = { lat: targetLat, lon: targetLon, name };

    if (!this.#marker) {
      this.#createMarkerInstance(targetLat, targetLon, name);
    } else {
      this.#marker.setLatLng([targetLat, targetLon]);
    }

    // Risk çemberi aktifse pin ile birlikte senkronize olarak yeni merkeze taşınır
    if (this.#riskCircle) {
      this.#riskCircle.setLatLng([targetLat, targetLon]);
    }

    if (shouldFly) {
      this.#map.flyTo([targetLat, targetLon], this.#map.getZoom(), {
        animate: true,
        duration: 0.8,
      });
    }

    // Önbellekteki risk ve telemetri verilerini kaybetmeden popup'ı tazele
    this.#renderPopup(name);
  }

  /**
   * 2.5 km'lik biyolojik risk çemberini ve popup içerisindeki tanı panelini günceller.
   * Dokümantasyon Şartnamesi Bölüm 4.6 ile tam uyumludur.
   *
   * @param {Object} overallRisk - DualRiskAssessmentDTO veya DTO.overall nesnesi
   * @param {Object} [telemetryState] - Esp32 Telemetri durumu
   */
  updateRiskDisplay(overallRisk, telemetryState) {
    if (!this.#map) return;

    // DTO Sözleşme Normalizasyonu (DualRiskAssessmentDTO veya DTO.overall güvenle karşılanır)
    const normalizedRisk = overallRisk?.overall
      ? overallRisk.overall
      : overallRisk || {};
    this.#cachedRiskReport = normalizedRisk;

    if (telemetryState !== undefined) {
      this.#cachedTelemetryState = telemetryState;
    }

    // Risk çemberi daima marker'ın güncel fiziksel koordinatlarını merkez alır
    const centerLatLng = this.#marker
      ? this.#marker.getLatLng()
      : [this.#cachedLocation.lat, this.#cachedLocation.lon];

    const riskLevel = normalizedRisk.level || "low";
    const colorScheme = this.#getRiskColorScheme(riskLevel);

    if (this.#riskCircle) {
      this.#riskCircle.setLatLng(centerLatLng);
      this.#riskCircle.setStyle({
        color: colorScheme.stroke,
        fillColor: colorScheme.fill,
      });
    } else {
      this.#riskCircle = L.circle(centerLatLng, {
        color: colorScheme.stroke,
        fillColor: colorScheme.fill,
        fillOpacity: 0.22,
        weight: 2,
        radius: 2500, // 2.5 km epidemiyolojik spor yayılım menzili
      }).addTo(this.#map);
    }

    this.#renderPopup(this.#cachedLocation.name);
  }

  /**
   * XSS'e karşı güvenli kılınmış ve durum korumalı popup render motoru.
   * @param {string} locationName - Bahçe lokasyon adı
   */
  #renderPopup(locationName) {
    if (!this.#marker) return;

    let cultivarName = "Gemlik (Trilye)";
    try {
      const cultivar = AppConfig.getActiveCultivar?.();
      if (typeof cultivar === "string") cultivarName = cultivar;
      else if (cultivar?.name) cultivarName = cultivar.name;
    } catch {
      // Fallback varsayılanı korur
    }

    const risk = this.#cachedRiskReport;
    const telemetry = this.#cachedTelemetryState;

    const safeLocationName = sanitizeHtml(
      locationName || this.#cachedLocation.name,
    );
    const safeCultivarName = sanitizeHtml(cultivarName);
    const safeRiskTitle = sanitizeHtml(risk?.title || "Risk Analiz Ediliyor");
    const safeRiskScore = Number.isFinite(risk?.score)
      ? `%${Math.round(risk.score)}`
      : "%--";
    const safeBadgeClass = sanitizeHtml(
      risk?.badgeClass || "bg-slate-100 text-slate-700",
    );

    // Telemetri verilerini null-safe biçimde biçimlendir (toFixed TypeError önleme)
    const isEspOnline = Boolean(telemetry?.isOnline);
    const espTemp =
      isEspOnline && Number.isFinite(telemetry?.temperature)
        ? `${telemetry.temperature.toFixed(1)} °C`
        : "Bağlantı Yok";
    const espHum =
      isEspOnline && Number.isFinite(telemetry?.humidity)
        ? `${telemetry.humidity.toFixed(0)} %`
        : "Bağlantı Yok";

    const popupHtml = `
      <div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; min-width: 220px;" class="space-y-2 p-1">
        <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
          <b style="color: #1e2610; font-size: 13px;">${safeLocationName}</b>
          <span style="display: block; color: #64748b; font-size: 10px;">${safeCultivarName} Bahçesi</span>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="color: #475569;">Baskın Risk:</span>
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${safeBadgeClass}">
            ${safeRiskScore}
          </span>
        </div>

        <div style="background-color: #f8fafc; border-radius: 8px; padding: 6px; font-size: 11px;" class="space-y-1">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">ESP32 Sıcaklık:</span>
            <b>${sanitizeHtml(espTemp)}</b>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">ESP32 Bağıl Nem:</span>
            <b>${sanitizeHtml(espHum)}</b>
          </div>
        </div>

        <p style="font-size: 10px; color: #64748b; margin: 0; line-height: 1.3;">
          ${safeRiskTitle}
        </p>

        <div style="border-top: 1px dashed #cbd5e1; padding-top: 5px; font-size: 10px; color: #0284c7; display: flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-hand-pointer"></i> Haritaya tıklayarak veya pini sürükleyerek konumu değiştirebilirsiniz.
        </div>
      </div>
    `;

    this.#marker.bindPopup(popupHtml);
  }

  /**
   * Tersine coğrafi kodlamayı asenkron yarış koşullarını iptal ederek çözer.
   * @param {number} lat - Enlem
   * @param {number} lon - Boylam
   * @returns {Promise<string>}
   */
  async #resolveLocationName(lat, lon) {
    if (this.#geocodeAbortController) {
      this.#geocodeAbortController.abort();
    }
    this.#geocodeAbortController = new AbortController();

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
      const response = await fetch(url, {
        signal: this.#geocodeAbortController.signal,
        headers: {
          "Accept-Language": "tr",
          "User-Agent":
            "GemlikZeytinAI-Production/3.0.0 (Tarımsal Karar Destek)",
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      const addr = data?.address || {};
      const city = addr.province || addr.state || addr.city || "";
      const district =
        addr.town || addr.county || addr.suburb || addr.city_district || "";

      if (district && city) return `${district}, ${city}`;
      if (city) return city;
      return `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`;
    } catch (error) {
      if (error.name === "AbortError") {
        // Yeni bir tıklama geldiği için bu istek bilinçli iptal edildi
        return this.#cachedLocation.name;
      }
      return `Bahçe Konumu (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;
    } finally {
      this.#geocodeAbortController = null;
    }
  }

  /**
   * Risk seviyesine göre harita çemberi renk paletini belirler.
   */
  #getRiskColorScheme(level) {
    switch (level) {
      case "critical":
        return { stroke: "#dc2626", fill: "#ef4444" };
      case "high":
        return { stroke: "#ea580c", fill: "#f97316" };
      case "moderate":
        return { stroke: "#d97706", fill: "#f59e0b" };
      case "low":
      default:
        return { stroke: "#059669", fill: "#10b981" };
    }
  }
}

export const MapManager = new MapManagerOrchestrator();
