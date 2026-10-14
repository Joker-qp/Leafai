/**
 * GemlikZeytinAI — ESP32 & IoT Saha Telemetrisi Servisi
 * Sürüm: 3.0.0 (Kurumsal Üretim Sürümü - Düzeltilmiş)
 * Mimari: Altyapı Katmanı / Observer & Polling Heartbeat Pattern
 *
 * Sorumluluk:
 * - Firebase REST üzerinden gerçek zamanlı mikroklima telemetrisini dinler.
 * - Zaman damgası (timestamp) doğrulamasıyla donanım kalp atışını (heartbeat) denetler;
 *   bayat veriyi veya sahte simülasyonları kesinlikle kabul etmez.
 * - Ağ zaman aşımlarında soket sızıntılarını önlemek için AbortController ile istekleri temizler.
 * - Tüm katmanlar arası veri transferini dondurulmuş (immutable / Object.freeze) DTO ile yürütür.
 */

import { AppConfig } from "../config/AppConfig.js";

class Esp32ServiceOrchestrator {
  #pollTimer = null;
  #abortController = null;
  #subscribers = new Set();
  #isExplicitlyStopped = true;
  #consecutiveFailures = 0;
  #maxConsecutiveFailures = 3;

  #state = {
    isOnline: false,
    temperature: null,
    humidity: null,
    leafWetness: false,
    lastSeen: null,
    lastSeenIso: null,
    errorMessage: null,
  };

  #pollIntervalMs = 7000; // Dokümantasyon Bölüm 4.4: 7 saniyelik yoklama periyodu
  #heartbeatTimeoutMs = 90000; // 90 saniyelik veri bayatlık eşiği
  #requestTimeoutMs = 5000; // 5 saniyelik kesin HTTP zaman aşımı eşiği

  constructor() {}

  /**
   * Durum değişikliklerini dinleyen aboneleri kaydeder.
   * Kayıt anında mevcut dondurulmuş durumu aboneye derhal iletir.
   * @param {(state: Readonly<object>) => void} callback
   * @returns {() => void} Abonelik iptal fonksiyonu
   */
  subscribe(callback) {
    if (typeof callback === "function") {
      this.#subscribers.add(callback);
      callback(this.getState());
    }
    return () => this.#subscribers.delete(callback);
  }

  /**
   * Mevcut telemetri durumunun dondurulmuş (immutable) kopyasını döner.
   * Dokümantasyon Bölüm 3 gereği nesne mühürlüdür.
   */
  getState() {
    return Object.freeze({ ...this.#state });
  }

  /**
   * Firebase REST telemetri dinleyicisini başlatır.
   * URL doğrulaması yapar; yapılandırma geçersizse simülasyona düşmeden çevrimdışı kalır.
   */
  startListener() {
    this.stopListener();
    this.#isExplicitlyStopped = false;
    this.#consecutiveFailures = 0;

    let endpointUrl = "";
    try {
      endpointUrl = this.#resolveValidatedEndpoint();
    } catch (configError) {
      this.#setOfflineState(configError.message);
      return;
    }

    // İlk telemetri isteğini hemen fırlat
    this.#executePollCycle(endpointUrl);
  }

  /**
   * Dinleyiciyi, bekleyen zamanlayıcıları ve in-flight ağ isteklerini temiz bir şekilde durdurur.
   */
  stopListener() {
    this.#isExplicitlyStopped = true;

    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }

    if (this.#abortController) {
      this.#abortController.abort(new Error("LISTENER_STOPPED"));
      this.#abortController = null;
    }
  }

  /**
   * Recursive zamanlayıcı döngüsü ile asenkron isteklerin birikmesini (drift/overlap) önler.
   */
  #scheduleNextCycle(endpointUrl) {
    if (this.#isExplicitlyStopped) return;

    this.#pollTimer = setTimeout(() => {
      this.#executePollCycle(endpointUrl);
    }, this.#pollIntervalMs);
  }

  /**
   * Tek bir telemetri yoklama döngüsünü yönetir.
   */
  async #executePollCycle(endpointUrl) {
    if (this.#isExplicitlyStopped) return;

    try {
      await this.#fetchTelemetry(endpointUrl);
    } finally {
      // Döngü tamamlandıktan sonra bir sonraki yoklamayı planla
      this.#scheduleNextCycle(endpointUrl);
    }
  }

  /**
   * HTTP zaman aşımını ve AbortController yaşam döngüsünü kesin soket temizliğiyle yönetir.
   */
  async #fetchTelemetry(endpointUrl) {
    // Önceki askıda kalmış isteği temizle
    if (this.#abortController) {
      this.#abortController.abort(new Error("CYCLE_SUPERSEDED"));
    }

    this.#abortController = new AbortController();
    const signal = this.#abortController.signal;

    let timeoutId = null;

    try {
      // Zaman aşımı durumunda doğrudan AbortController tetiklenir (Soket sızıntısı önlenir)
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutErr = new Error("REQUEST_TIMEOUT");
          this.#abortController?.abort(timeoutErr);
          reject(timeoutErr);
        }, this.#requestTimeoutMs);
      });

      const fetchPromise = fetch(endpointUrl, {
        signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} (${response.statusText || "Sunucu Hatası"})`,
        );
      }

      const rawData = await response.json();

      if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
        throw new Error(
          "Geçerli telemetri paketi bulunamadı (Düğüm boş veya geçersiz format).",
        );
      }

      this.#consecutiveFailures = 0;
      this.#validateAndCommitTelemetry(rawData);
    } catch (error) {
      const isExplicitStop =
        this.#isExplicitlyStopped || error.message === "LISTENER_STOPPED";
      const isCycleSuperseded = error.message === "CYCLE_SUPERSEDED";

      if (isExplicitStop || isCycleSuperseded) {
        return;
      }

      this.#handleFetchFailure(error);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Gelen paketin telemetri doğruluğunu, fiziksel sınırlarını ve bayatlığını denetler.
   */
  #validateAndCommitTelemetry(data) {
    // 1. Sensör Sayısal Değer Denetimi
    const temp = Number(data.temperature ?? data.temp);
    const hum = Number(data.humidity ?? data.hum);
    const wetness = Boolean(data.leafWetness ?? data.wetness ?? false);

    if (!Number.isFinite(temp) || !Number.isFinite(hum)) {
      this.#setOfflineState(
        "Bozuk sensör verisi: Sıcaklık veya nem sayısal değil.",
      );
      return;
    }

    // 2. Gemlik İklim Bandı Fiziksel Toleransları
    if (temp < -25 || temp > 65 || hum < 0 || hum > 100) {
      this.#setOfflineState(
        "Sensör okumaları fiziksel sınırların dışında (-25°C..65°C / %0..%100).",
      );
      return;
    }

    // 3. Zaman Damgası (Timestamp) Zorunluluğu ve Bayatlık Denetimi
    // Dokümantasyon İlkesi: Sahte simülasyon yapılmaz; zaman damgası yoksa bayatlık doğrulanamaz.
    const rawTimestamp = data.timestamp ?? data.lastSeen ?? data.time;

    if (
      rawTimestamp === undefined ||
      rawTimestamp === null ||
      rawTimestamp === ""
    ) {
      this.#setOfflineState(
        "Telemetri paketi reddedildi: Zaman damgası (timestamp) eksik; veri tazeliği doğrulanamıyor.",
      );
      return;
    }

    let readingTimeMs = NaN;
    if (typeof rawTimestamp === "number") {
      readingTimeMs = rawTimestamp < 1e11 ? rawTimestamp * 1000 : rawTimestamp;
    } else if (typeof rawTimestamp === "string") {
      readingTimeMs = Date.parse(rawTimestamp);
    }

    if (!Number.isFinite(readingTimeMs)) {
      this.#setOfflineState(
        "Telemetri reddedildi: Geçersiz zaman damgası formatı.",
      );
      return;
    }

    const nowMs = Date.now();
    const ageMs = nowMs - readingTimeMs;

    // 90 saniyeden eski veriler bayat kabul edilir ve reddedilir
    if (ageMs > this.#heartbeatTimeoutMs) {
      this.#setOfflineState(
        `Veri bayat: Son sensör verisi ${Math.round(ageMs / 1000)} sn önce üretilmiş.`,
      );
      return;
    }

    // 2 dakikadan fazla gelecek zaman damgası (saat kayması/senkronizasyon hatası)
    if (ageMs < -120000) {
      this.#setOfflineState(
        "Donanım saat senkronizasyonu hatalı (Gelecek zaman damgası alındı).",
      );
      return;
    }

    // 4. Durum Güncelleme ve Dondurma (Immutability)
    const validDate = new Date(readingTimeMs);
    this.#state = {
      isOnline: true,
      temperature: Number(temp.toFixed(1)),
      humidity: Number(hum.toFixed(1)),
      leafWetness: wetness,
      lastSeen: validDate.toLocaleTimeString("tr-TR"),
      lastSeenIso: validDate.toISOString(),
      errorMessage: null,
    };

    this.#syncWithAppConfig(this.getState(), true);
    this.#broadcast();
  }

  /**
   * Ağ veya bağlantı kopmalarında kalp atışı toleransını yürütür.
   */
  #handleFetchFailure(error) {
    this.#consecutiveFailures++;
    const isTimeout = error.message === "REQUEST_TIMEOUT";
    const reason = isTimeout
      ? "İstasyon zaman aşımı (Cihaz yanıt vermiyor)"
      : `Bağlantı hatası: ${error.message}`;

    const hasRecentValidData =
      this.#state.temperature !== null &&
      this.#state.lastSeenIso &&
      Date.now() - new Date(this.#state.lastSeenIso).getTime() <
        this.#heartbeatTimeoutMs;

    // 3 ardışık başarısızlığa kadar son geçerli durumu koru
    if (
      hasRecentValidData &&
      this.#consecutiveFailures < this.#maxConsecutiveFailures
    ) {
      this.#state = {
        ...this.#state,
        isOnline: true,
        errorMessage: `${reason} (Yeniden deneniyor: ${this.#consecutiveFailures}/${this.#maxConsecutiveFailures})`,
      };
      this.#broadcast();
    } else {
      this.#setOfflineState(reason);
    }
  }

  /**
   * Donanımı güvenli çevrimdışı durumuna alır.
   */
  #setOfflineState(reason) {
    this.#state = {
      isOnline: false,
      temperature: null,
      humidity: null,
      leafWetness: false,
      lastSeen: null,
      lastSeenIso: null,
      errorMessage: String(reason || "İstasyon çevrimdışı"),
    };

    this.#syncWithAppConfig(null, false);
    this.#broadcast();
  }

  /**
   * AppConfig sözleşmesinde metot tanımlı olmasa dahi çalışma anı çökmesini (TypeError)
   * önleyen ve değişmezlik (Object.freeze) kuralına uyan senkronizasyon köprüsü.
   */
  #syncWithAppConfig(telemetryPayload, isActive) {
    try {
      if (typeof AppConfig?.updateTelemetry === "function") {
        AppConfig.updateTelemetry(telemetryPayload, isActive);
      }
    } catch (err) {
      console.warn(
        "[Esp32Service] AppConfig.updateTelemetry senkronizasyon uyarısı:",
        err,
      );
    }
  }

  /**
   * Firebase URL ve Düğüm Yolunu (NodePath) doğrular; protokol ve şema güvenliğini sağlar.
   */
  #resolveValidatedEndpoint() {
    let hardwareConfig = {};

    // AppConfig API sözleşmesi kontrolü
    if (typeof AppConfig?.getHardwareConfig === "function") {
      hardwareConfig = AppConfig.getHardwareConfig() || {};
    }

    const rawBaseUrl = (hardwareConfig.firebaseUrl || "").trim();
    if (!rawBaseUrl) {
      throw new Error("ESP32 / Firebase URL yapılandırılmadı.");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawBaseUrl);
    } catch {
      throw new Error("Geçersiz Firebase URL formatı (RFC 3986 uyumsuz).");
    }

    // Güvenlik İlkesi: Firebase REST iletişimi zorunlu olarak HTTPS olmalıdır
    if (parsedUrl.protocol !== "https:") {
      throw new Error(
        "Güvenlik ihlali: IoT telemetri bağlantısı yalnızca HTTPS protokolünü destekler.",
      );
    }

    // Path traversal ve geçersiz karakter temizliği
    const rawNodePath = String(
      hardwareConfig.nodePath || "esp32_station",
    ).trim();
    const sanitizedNodePath = rawNodePath
      .replace(/^[/.]+|[/.]+$/g, "")
      .replace(/[^\w-]/g, "");

    if (!sanitizedNodePath) {
      throw new Error("Geçersiz telemetri düğüm yolu (nodePath).");
    }

    const cleanOriginAndPath = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, "")}`;
    return `${cleanOriginAndPath}/${sanitizedNodePath}.json`;
  }

  /**
   * Tüm abonelere dondurulmuş telemetri durumunu dağıtır.
   */
  #broadcast() {
    const frozenState = this.getState();
    this.#subscribers.forEach((callback) => {
      try {
        callback(frozenState);
      } catch (err) {
        console.error("[Esp32Service] Abone bildirim hatası:", err);
      }
    });
  }
}

export const Esp32Service = new Esp32ServiceOrchestrator();
