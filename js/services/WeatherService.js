import { AppConfig, WEATHER_PROVIDERS } from "../config/AppConfig.js";

/**
 * Nesneyi ve tüm alt dallarını özyinelemeli olarak dondurarak (deep freeze)
 * katmanlar arası veri transferi (DTO) değişmezliğini (immutability) garanti eder.
 * @template T
 * @param {T} obj
 * @returns {Readonly<T>}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === "object") {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

/**
 * MeteorologicalDataDTO sözleşmesine tam uyumlu dondurulmuş veri transfer nesnesi üretir.
 * @param {Object} params
 * @returns {Readonly<Object>}
 */
function createMeteorologicalDTO({
  provider,
  currentTemp,
  currentHumidity,
  currentPrecipitation = 0,
  totalRain48h = 0,
  hourlyRain = [],
  hourlyTemps = [],
  hourlyHumidity = [],
  tempMax = null,
  tempMin = null,
  cityName = "",
  fallbackTriggered = false,
  originalRequestedProvider = undefined,
  failureReason = undefined,
}) {
  const dto = {
    provider: String(provider),
    current: {
      temperature: Number(currentTemp),
      humidity: Number(currentHumidity),
      precipitation: Number(currentPrecipitation),
    },
    forecast48h: {
      totalRainMm: Number(Number(totalRain48h).toFixed(2)),
      hourlyRain: Array.isArray(hourlyRain) ? hourlyRain.map(Number) : [],
      hourlyTemps: Array.isArray(hourlyTemps) ? hourlyTemps.map(Number) : [],
      hourlyHumidity: Array.isArray(hourlyHumidity)
        ? hourlyHumidity.map(Number)
        : [],
    },
    daily: {
      tempMax: tempMax !== null && !isNaN(tempMax) ? Number(tempMax) : null,
      tempMin: tempMin !== null && !isNaN(tempMin) ? Number(tempMin) : null,
    },
    cityName: String(cityName),
    fetchedAt: new Date().toISOString(),
  };

  if (fallbackTriggered) {
    dto.fallbackTriggered = true;
    if (originalRequestedProvider) {
      dto.originalRequestedProvider = String(originalRequestedProvider);
    }
    if (failureReason) {
      dto.failureReason = String(failureReason);
    }
  }

  return deepFreeze(dto);
}

class OpenMeteoStrategy {
  async fetchForecast(lat, lon) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,precipitation,weather_code",
    );
    // Konvektif sağanak yağışları kaçırmamak için 'rain' yerine 'precipitation' sorgulanır
    url.searchParams.set(
      "hourly",
      "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation",
    );
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_sum",
    );
    // Önümüzdeki tam 48 saati kapsayabilmek için 3 günlük tahmin penceresi istenir
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("timezone", "auto");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Open-Meteo API Hatası: HTTP ${response.status} (${response.statusText})`,
      );
    }

    const data = await response.json();

    // 00:00'dan başlayan veriyi geçerli saat damgasına göre hizalama
    const hourlyTimes = data.hourly?.time || [];
    const currentTimeIso = data.current?.time;
    let startIndex = hourlyTimes.indexOf(currentTimeIso);

    if (startIndex === -1) {
      const now = new Date();
      startIndex = hourlyTimes.findIndex((t) => new Date(t) >= now);
      if (startIndex === -1) startIndex = 0;
    }

    const endIndex = startIndex + 48;
    const rainSeries48h = (data.hourly?.precipitation || [])
      .slice(startIndex, endIndex)
      .map((val) => Number(val) || 0);

    const totalRain48h = rainSeries48h.reduce((acc, curr) => acc + curr, 0);

    return createMeteorologicalDTO({
      provider: WEATHER_PROVIDERS.OPEN_METEO,
      currentTemp: data.current?.temperature_2m ?? 0,
      currentHumidity: data.current?.relative_humidity_2m ?? 0,
      currentPrecipitation: data.current?.precipitation ?? 0,
      totalRain48h: totalRain48h,
      hourlyRain: rainSeries48h,
      hourlyTemps: (data.hourly?.temperature_2m || [])
        .slice(startIndex, endIndex)
        .map((val) => Number(val) || 0),
      hourlyHumidity: (data.hourly?.relative_humidity_2m || [])
        .slice(startIndex, endIndex)
        .map((val) => Number(val) || 0),
      tempMax: data.daily?.temperature_2m_max?.[0] ?? null,
      tempMin: data.daily?.temperature_2m_min?.[0] ?? null,
      cityName: data.timezone || "Yerel İstasyon",
    });
  }
}

class OpenWeatherStrategy {
  async fetchForecast(lat, lon, apiKey) {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        "OpenWeatherMap API Anahtarı eksik! Lütfen Ayarlar panelinden anahtarınızı girin.",
      );
    }

    const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("appid", apiKey.trim());
    url.searchParams.set("units", "metric");
    url.searchParams.set("lang", "tr");

    const response = await fetch(url.toString());
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Geçersiz OpenWeatherMap API Anahtarı! Lütfen anahtarınızı kontrol edin (HTTP 401).",
        );
      }
      throw new Error(
        `OpenWeatherMap API Hatası: HTTP ${response.status} (${response.statusText})`,
      );
    }

    const data = await response.json();
    const list = data.list || [];

    // 16 adet 3 saatlik aralık = önümüzdeki 48 saat
    const steps48h = list.slice(0, 16);
    let totalRain48h = 0;
    const hourlyRainApproximation = [];
    const hourlyTemps = [];
    const hourlyHumidity = [];

    steps48h.forEach((item) => {
      const rain3h = Number(item.rain?.["3h"] || 0);
      totalRain48h += rain3h;

      // 3 saatlik kütleyi 1'er saatlik adımlara dağıt
      const hourlyShare = Number((rain3h / 3).toFixed(2));
      hourlyRainApproximation.push(hourlyShare, hourlyShare, hourlyShare);
      hourlyTemps.push(
        item.main?.temp ?? 0,
        item.main?.temp ?? 0,
        item.main?.temp ?? 0,
      );
      hourlyHumidity.push(
        item.main?.humidity ?? 0,
        item.main?.humidity ?? 0,
        item.main?.humidity ?? 0,
      );
    });

    // Günlük ekstremum sıcaklıklar (ilk 24 saat = 8 periyot taranarak belirlenir)
    const first24hSteps = list.slice(0, 8);
    let dailyTempMax = null;
    let dailyTempMin = null;

    if (first24hSteps.length > 0) {
      dailyTempMax = Math.max(
        ...first24hSteps.map((i) => Number(i.main?.temp_max ?? i.main?.temp)),
      );
      dailyTempMin = Math.min(
        ...first24hSteps.map((i) => Number(i.main?.temp_min ?? i.main?.temp)),
      );
    }

    const currentItem = list[0] || {};

    return createMeteorologicalDTO({
      provider: WEATHER_PROVIDERS.OPENWEATHER,
      currentTemp: currentItem.main?.temp ?? 0,
      currentHumidity: currentItem.main?.humidity ?? 0,
      currentPrecipitation: currentItem.rain?.["3h"]
        ? Number((currentItem.rain["3h"] / 3).toFixed(2))
        : 0,
      totalRain48h: totalRain48h,
      hourlyRain: hourlyRainApproximation.slice(0, 48),
      hourlyTemps: hourlyTemps.slice(0, 48),
      hourlyHumidity: hourlyHumidity.slice(0, 48),
      tempMax: dailyTempMax,
      tempMin: dailyTempMin,
      cityName: data.city?.name || "Bölge İstasyonu",
    });
  }
}

class WeatherApiStrategy {
  async fetchForecast(lat, lon, apiKey) {
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        "WeatherAPI.com Anahtarı eksik! Lütfen Ayarlar panelinden anahtarınızı girin.",
      );
    }

    const url = new URL("https://api.weatherapi.com/v1/forecast.json");
    url.searchParams.set("key", apiKey.trim());
    url.searchParams.set("q", `${lat},${lon}`);
    url.searchParams.set("days", "3");
    url.searchParams.set("aqi", "no");
    url.searchParams.set("alerts", "no");

    const response = await fetch(url.toString());
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Geçersiz veya Yetkisiz WeatherAPI Anahtarı! Kontrol ediniz (HTTP ${response.status}).`,
        );
      }
      throw new Error(
        `WeatherAPI Hatası: HTTP ${response.status} (${response.statusText})`,
      );
    }

    const data = await response.json();
    const forecastDays = data.forecast?.forecastday || [];

    let allHours = [];
    forecastDays.forEach((day) => {
      if (Array.isArray(day.hour)) {
        allHours = allHours.concat(day.hour);
      }
    });

    // İleriye dönük 48 saatlik pencereyi yerel zamana göre dilimleme
    const nowEpoch =
      data.location?.localtime_epoch || Math.floor(Date.now() / 1000);
    let startIndex = allHours.findIndex(
      (h) => Number(h.time_epoch) >= nowEpoch - 1800,
    );
    if (startIndex === -1 || startIndex + 48 > allHours.length) {
      startIndex = 0;
    }

    const hours48 = allHours.slice(startIndex, startIndex + 48);
    const hourlyRain = hours48.map((h) => Number(h.precip_mm || 0));
    const totalRain48h = hourlyRain.reduce((acc, curr) => acc + curr, 0);

    return createMeteorologicalDTO({
      provider: WEATHER_PROVIDERS.WEATHERAPI,
      currentTemp: data.current?.temp_c ?? 0,
      currentHumidity: data.current?.humidity ?? 0,
      currentPrecipitation: data.current?.precip_mm ?? 0,
      totalRain48h: totalRain48h,
      hourlyRain: hourlyRain,
      hourlyTemps: hours48.map((h) => Number(h.temp_c || 0)),
      hourlyHumidity: hours48.map((h) => Number(h.humidity || 0)),
      tempMax: forecastDays[0]?.day?.maxtemp_c ?? null,
      tempMin: forecastDays[0]?.day?.mintemp_c ?? null,
      cityName: data.location?.name || "Bölge İstasyonu",
    });
  }
}

class WeatherServiceOrchestrator {
  #strategies = {
    [WEATHER_PROVIDERS.OPEN_METEO]: new OpenMeteoStrategy(),
    [WEATHER_PROVIDERS.OPENWEATHER]: new OpenWeatherStrategy(),
    [WEATHER_PROVIDERS.WEATHERAPI]: new WeatherApiStrategy(),
  };

  #cache = {
    data: null,
    lastFetchedKey: "",
    timestamp: 0,
    ttlMs: 10 * 60 * 1000,
  };

  /**
   * Seçili sağlayıcıdan hava tahmin verisini çeker; hata anında otonom olarak Open-Meteo'ya düşer.
   * @param {number} lat - Enlem
   * @param {number} lon - Boylam
   * @param {boolean} [forceRefresh=false] - Önbelleği atlama bayrağı
   * @returns {Promise<Readonly<Object>>}
   */
  async getForecast(lat, lon, forceRefresh = false) {
    const weatherConfig = AppConfig.getWeatherConfig();
    const provider = weatherConfig.provider || WEATHER_PROVIDERS.OPEN_METEO;
    // Güvenlik & Entegrasyon: API çağrıları için AppConfig'ten ham (raw/decrypted) anahtar alınır
    const apiKey =
      (typeof AppConfig.getRawWeatherApiKey === "function"
        ? AppConfig.getRawWeatherApiKey()
        : weatherConfig.apiKey) || "";

    const cacheKey = `${provider}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
    const now = Date.now();

    if (
      !forceRefresh &&
      this.#cache.data &&
      this.#cache.lastFetchedKey === cacheKey &&
      now - this.#cache.timestamp < this.#cache.ttlMs
    ) {
      return this.#cache.data;
    }

    const strategy =
      this.#strategies[provider] ||
      this.#strategies[WEATHER_PROVIDERS.OPEN_METEO];

    try {
      const forecastData = await strategy.fetchForecast(lat, lon, apiKey);
      this.#cache.data = forecastData;
      this.#cache.lastFetchedKey = cacheKey;
      this.#cache.timestamp = now;
      return forecastData;
    } catch (primaryError) {
      console.warn(
        `[WeatherService] ${provider} çağrısı başarısız oldu:`,
        primaryError.message,
      );

      // Ana sağlayıcı Open-Meteo değilse otonom fallback devreye alınır
      if (provider !== WEATHER_PROVIDERS.OPEN_METEO) {
        try {
          const fallbackData = await this.#strategies[
            WEATHER_PROVIDERS.OPEN_METEO
          ].fetchForecast(lat, lon);

          // Sözleşme garantisi ve immutability için DTO factory üzerinden zenginleştirilir
          const enrichedFallback = createMeteorologicalDTO({
            provider: fallbackData.provider,
            currentTemp: fallbackData.current.temperature,
            currentHumidity: fallbackData.current.humidity,
            currentPrecipitation: fallbackData.current.precipitation,
            totalRain48h: fallbackData.forecast48h.totalRainMm,
            hourlyRain: fallbackData.forecast48h.hourlyRain,
            hourlyTemps: fallbackData.forecast48h.hourlyTemps,
            hourlyHumidity: fallbackData.forecast48h.hourlyHumidity,
            tempMax: fallbackData.daily.tempMax,
            tempMin: fallbackData.daily.tempMin,
            cityName: fallbackData.cityName,
            fallbackTriggered: true,
            originalRequestedProvider: provider,
            failureReason: primaryError.message,
          });

          this.#cache.data = enrichedFallback;
          this.#cache.lastFetchedKey = cacheKey;
          this.#cache.timestamp = now;
          return enrichedFallback;
        } catch (fallbackError) {
          console.error(
            `[WeatherService] Yedek sağlayıcı (Open-Meteo) çağrısı da başarısız oldu:`,
            fallbackError.message,
          );
          throw new Error(
            `Birincil sağlayıcı (${provider}) hatası: [${primaryError.message}] | ` +
              `Yedek sağlayıcı (Open-Meteo) hatası: [${fallbackError.message}]`,
          );
        }
      }

      throw primaryError;
    }
  }

  /**
   * 10 dakikalık RAM önbelleğini sıfırlar.
   */
  clearCache() {
    this.#cache.data = null;
    this.#cache.lastFetchedKey = "";
    this.#cache.timestamp = 0;
  }
}

export const WeatherService = new WeatherServiceOrchestrator();
