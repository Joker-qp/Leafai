/**
 * GemlikZeytinAI — Çift Kademeli ONNX Çıkarım Boru Hattı
 * Sürüm: 3.0.0 (Kurumsal Üretim Sürümü)
 * Sorumluluk: Letterbox ön işleme, YOLOv8s-seg çıkarımı, 84 noktalı organik poligon
 * ve Gauss Shoelace lezyon şiddeti hesabı, RGB(0,0,0) zemin izolasyonu
 * ve ImageNet-norm EfficientNet-B0 morfolojik doğrulama motoru.
 */

import { AppConfig, AI_CLASSES, GEMLIK_SPECS } from "../config/AppConfig.js";

// ONNX Runtime Wasm Donanım Yapılandırması ve Güvenlik Optimizasyonu
if (typeof ort !== "undefined") {
  try {
    // Wasm binary yollarını CDN dağıtımına açıkça sabitle
    ort.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";
    const isCrossOriginIsolated =
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    // Cross-origin isolation yoksa SharedArrayBuffer güvenlik hatasını önlemek için 1 thread kullan
    ort.env.wasm.numThreads = isCrossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 4)
      : 1;
    ort.env.wasm.simd = true;
  } catch (e) {
    console.warn("[ModelPipeline] Wasm donanım optimizasyonu uyarısı:", e);
  }
}

const MODEL_CONSTANTS = Object.freeze({
  yoloSize: 640,
  protoSize: 160,
  classifierSize: 224,
  polygonPoints: 84,
  letterboxColor: "rgb(114, 114, 114)",
  paths: {
    yolo:
      GEMLIK_SPECS?.modelArchitecture?.modelFiles?.yolo ||
      "models/yolov8_seg.onnx",
    classifier:
      GEMLIK_SPECS?.modelArchitecture?.modelFiles?.classifier ||
      "models/efficientnet.onnx",
  },
  // EfficientNet-B0 ImageNet Normalizasyon Standartları (Madde 5.3)
  normMean: [0.485, 0.456, 0.406],
  normStd: [0.229, 0.224, 0.225],
});

class ModelPipelineOrchestrator {
  #yoloSession = null;
  #classifierSession = null;
  #isYoloReady = false;
  #isClassifierReady = false;
  #isCheckingModels = false;
  #confidenceIntervalId = null;

  constructor() {}

  /**
   * Modelleri diskten veya yerel WebAssembly hafızasından yükler.
   */
  async initialize() {
    if (this.#isCheckingModels) return;
    this.#isCheckingModels = true;

    this.#updateGlobalBadge(
      "Modeller Denetleniyor...",
      "bg-amber-100 text-amber-800",
    );

    if (typeof ort === "undefined") {
      this.#markModelsMissing("ONNX CDN Eksik");
      this.#isCheckingModels = false;
      return;
    }

    await Promise.all([
      this.#loadStageModel("yolo"),
      this.#loadStageModel("classifier"),
    ]);

    this.#refreshStatusIndicators();
    this.#isCheckingModels = false;
  }

  async #loadStageModel(type) {
    const isYolo = type === "yolo";
    const sessionOptions = {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    };

    try {
      const memoryBuffer = AppConfig.getCustomModelBuffer(type);
      let session = null;

      if (memoryBuffer) {
        session = await ort.InferenceSession.create(
          memoryBuffer,
          sessionOptions,
        );
      } else {
        const filePath = isYolo
          ? MODEL_CONSTANTS.paths.yolo
          : MODEL_CONSTANTS.paths.classifier;
        session = await ort.InferenceSession.create(filePath, sessionOptions);
      }

      if (isYolo) {
        this.#yoloSession = session;
        this.#isYoloReady = true;
      } else {
        this.#classifierSession = session;
        this.#isClassifierReady = true;
      }
    } catch (err) {
      console.warn(`[ModelPipeline] ${type} modeli yüklenemedi:`, err.message);
      if (isYolo) {
        this.#yoloSession = null;
        this.#isYoloReady = false;
      } else {
        this.#classifierSession = null;
        this.#isClassifierReady = false;
      }
    }
  }

  /**
   * Kullanıcının dosya seçici üzerinden yüklediği ikili .onnx modelini derler.
   */
  async loadModelFromBuffer(fileName, arrayBuffer) {
    const isYolo =
      fileName.toLowerCase().includes("seg") ||
      fileName.toLowerCase().includes("yolo");

    try {
      const sessionOptions = { executionProviders: ["wasm"] };
      const session = await ort.InferenceSession.create(
        arrayBuffer,
        sessionOptions,
      );

      if (isYolo) {
        this.#yoloSession = session;
        this.#isYoloReady = true;
        AppConfig.setCustomModelBuffer("yolo", arrayBuffer);
      } else {
        this.#classifierSession = session;
        this.#isClassifierReady = true;
        AppConfig.setCustomModelBuffer("classifier", arrayBuffer);
      }

      this.#refreshStatusIndicators();
      alert(`✅ ${fileName} modeli başarıyla hafızaya alındı!`);
    } catch (err) {
      alert(`❌ Model derleme hatası (${fileName}): ${err.message}`);
    }
  }

  /**
   * Ana Çıkarım Boru Hattı (Pipeline)
   * Dokümantasyon Madde 4.7 & Madde 1 Standartlarına Tam Uyumlu 4 Kademe
   * (Letterbox gri dolguları unpad/crop ile temizlendi, aşamalı geçiş ve scanline animasyonu eklendi)
   */
  async processLeafImage(imageSource) {
    if (!this.#isYoloReady || !this.#isClassifierReady) {
      this.#displayModelMissingErrorModal();
      return;
    }

    if (this.#confidenceIntervalId) {
      clearInterval(this.#confidenceIntervalId);
      this.#confidenceIntervalId = null;
    }

    // Aşamalı geçiş için kartların görünürlük durumunu sıfırla
    ["card-step1", "card-step2", "card-step3", "diagnosis-card"].forEach(
      (id) => {
        document.getElementById(id)?.classList.remove("is-visible");
      },
    );

    const container = document.getElementById("pipeline-results");
    if (container) {
      container.classList.remove("hidden");
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const origW =
      imageSource.videoWidth ||
      imageSource.naturalWidth ||
      imageSource.width ||
      800;
    const origH =
      imageSource.videoHeight ||
      imageSource.naturalHeight ||
      imageSource.height ||
      600;

    // =========================================================================
    // ADIM 1: Görüntü Alındı & Letterbox Ön İşleme (Tensör 640x640 Hazırlığı)
    // =========================================================================
    this.#updateStepHeader(
      "ADIM 1: Görüntü Alındı & Yaprak Odaklama",
      `Görüntü unpad/crop ile odaklandı (${origW}x${origH}), YOLOv8s-seg tensörü hazırlanıyor...`,
    );

    // YOLOv8s-seg girdi olarak 640x640 letterbox kare tensör gerektirir.
    // UI kirliliğini önlemek için tensör tuvali arka planda offscreen hazırlanır.
    const offscreenLboxCanvas = document.createElement("canvas");
    offscreenLboxCanvas.width = MODEL_CONSTANTS.yoloSize;
    offscreenLboxCanvas.height = MODEL_CONSTANTS.yoloSize;
    const lboxCtx = offscreenLboxCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const letterboxParams = this.#drawLetterboxImage(
      lboxCtx,
      imageSource,
      origW,
      origH,
    );

    // 1. Kart (#canvas-step1): Letterbox 114 gri kenar dolgularından tamamen arındırılmış temiz yaprak
    const c1 = document.getElementById("canvas-step1");
    if (!c1) throw new Error("#canvas-step1 elementi DOM'da bulunamadı.");
    c1.width = letterboxParams.scaledW;
    c1.height = letterboxParams.scaledH;
    const ctx1 = c1.getContext("2d", { willReadFrequently: true });
    ctx1.drawImage(
      imageSource,
      0,
      0,
      letterboxParams.scaledW,
      letterboxParams.scaledH,
    );

    const resEl = document.getElementById("metric-step1-res");
    if (resEl) resEl.innerText = `${origW}x${origH}`;

    // Aşamalı geçiş: 1. Kart yumuşakça belirir
    this.#revealStepCard("card-step1");
    await this.#sleep(450);

    // =========================================================================
    // ADIM 2: YOLOv8s-seg Segmentasyon & 84 Noktalı Organik Poligon (HUD Lazer)
    // =========================================================================
    this.#updateStepHeader(
      "ADIM 2: YOLOv8s-seg Segmentasyon",
      "Organik yaprak sınırları ve lezyon poligonları lazerle taranıyor...",
    );

    const c2 = document.getElementById("canvas-step2");
    if (!c2) throw new Error("#canvas-step2 elementi DOM'da bulunamadı.");
    c2.width = letterboxParams.scaledW;
    c2.height = letterboxParams.scaledH;
    const ctx2 = c2.getContext("2d");

    // YOLOv8s-seg çıkarımı 640x640 tensör tuvali üzerinden çalışır
    const yoloResult = await this.#executeYoloSegmentation(
      lboxCtx,
      letterboxParams,
    );

    // Metrik panellerini dürüst çıkarım sonuçlarıyla güncelle
    const leafConfEl = document.getElementById("metric-leaf-conf");
    const sevEl = document.getElementById("metric-severity");
    if (leafConfEl)
      leafConfEl.innerText = `%${yoloResult.leafConfidence.toFixed(1)}`;
    if (sevEl) sevEl.innerText = `%${yoloResult.severityRatio.toFixed(1)}`;

    this.#revealStepCard("card-step2");

    // Sarı Lazer Scanline Animasyonunu Başlat
    const card2 = document.getElementById("card-step2");
    card2?.classList.add("scanline-active");

    // Sinematik HUD Lazer Tarama Animasyonu (Unpad edilmiş koordinatlarda)
    await this.#animateLaserScanSweep(ctx2, c1, yoloResult, letterboxParams);

    card2?.classList.remove("scanline-active");
    const step2Badge = document.getElementById("step2-status-badge");
    if (step2Badge) {
      step2Badge.innerText = "Tamamlandı";
      step2Badge.className =
        "text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700";
    }
    await this.#sleep(500);

    // =========================================================================
    // ADIM 3: Zemin İzolasyonu (RGB 0,0,0) - Maske Birleştirme (Deliksiz Yaprak)
    // =========================================================================
    this.#updateStepHeader(
      "ADIM 3: Zemin İzolasyonu (RGB 0,0,0)",
      "Mantıksal VEYA (leaf | lesion) ile yaprak deliksiz izole ediliyor, zemin saf siyah...",
    );

    const c3 = document.getElementById("canvas-step3");
    if (!c3) throw new Error("#canvas-step3 elementi DOM'da bulunamadı.");
    c3.width = letterboxParams.scaledW;
    c3.height = letterboxParams.scaledH;
    const ctx3 = c3.getContext("2d", { willReadFrequently: true });

    // final_mask = (leaf_mask | lesion_mask) ile deliksiz ikili piksel transferi
    this.#applyBackgroundIsolation(ctx3, c1, yoloResult, letterboxParams);
    this.#revealStepCard("card-step3");
    await this.#sleep(500);

    // =========================================================================
    // ADIM 4: EfficientNet-B0 Sınıflandırma, 3 Sınıf Olasılık Dağılımı & Reçete
    // =========================================================================
    this.#updateStepHeader(
      "ADIM 4: Sınıflandırma & Zirai Reçete",
      "İzole yaprak 3 sınıflı olasılık dağılımı ve Bakanlık reçetesi üretiliyor...",
    );

    const effResult = await this.#executeEfficientNetClassification(
      c3,
      yoloResult,
    );

    this.#revealStepCard("diagnosis-card");
    this.#renderStep4Results(effResult);
  }

  /**
   * Dokümantasyon Madde 5.1: En-Boy Oranı Koruyucu Letterbox Algoritması
   */
  #drawLetterboxImage(ctx, img, srcW, srcH) {
    const target = MODEL_CONSTANTS.yoloSize;
    const scale = Math.min(target / srcW, target / srcH);

    // Formüle tam uyum: Math.floor (\lfloor ... \rfloor)
    const scaledW = Math.floor(srcW * scale);
    const scaledH = Math.floor(srcH * scale);
    const padX = Math.floor((target - scaledW) / 2);
    const padY = Math.floor((target - scaledH) / 2);

    ctx.fillStyle = MODEL_CONSTANTS.letterboxColor;
    ctx.fillRect(0, 0, target, target);
    ctx.drawImage(img, padX, padY, scaledW, scaledH);

    return { padX, padY, scaledW, scaledH, scale, target };
  }

  /**
   * YOLOv8s-seg Segmentasyon Çıkarımı ve Bellek Yönetimi
   */
  async #executeYoloSegmentation(ctx, lbox) {
    if (!this.#yoloSession)
      throw new Error("YOLOv8s-seg oturumu başlatılamadı.");

    const inputTensor = this.#preprocessToTensor(
      ctx,
      MODEL_CONSTANTS.yoloSize,
      MODEL_CONSTANTS.yoloSize,
      false,
    );

    const inputName = this.#yoloSession.inputNames[0];
    const feeds = { [inputName]: inputTensor };

    let outputMap = null;
    try {
      outputMap = await this.#yoloSession.run(feeds);
      return this.#parseYoloSegOutput(outputMap, lbox);
    } finally {
      // Wasm Tensör Bellek Temizliği (Bellek Sızıntısı Koruması)
      inputTensor.dispose?.();
      if (outputMap) {
        for (const k of Object.keys(outputMap)) {
          outputMap[k].dispose?.();
        }
      }
    }
  }

  /**
   * Piksel Buffer'ından NCHW ONNX Tensörü Üretir
   */
  #preprocessToTensor(ctx, width, height, normalize = false) {
    const imgData = ctx.getImageData(0, 0, width, height).data;
    const floatArr = new Float32Array(1 * 3 * width * height);

    const channelSize = width * height;
    const redOffset = 0;
    const greenOffset = channelSize;
    const blueOffset = 2 * channelSize;

    for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
      let r = imgData[i] / 255.0;
      let g = imgData[i + 1] / 255.0;
      let b = imgData[i + 2] / 255.0;

      if (normalize) {
        // Madde 5.3: ImageNet Tensör Normalizasyonu
        r = (r - MODEL_CONSTANTS.normMean[0]) / MODEL_CONSTANTS.normStd[0];
        g = (g - MODEL_CONSTANTS.normMean[1]) / MODEL_CONSTANTS.normStd[1];
        b = (b - MODEL_CONSTANTS.normMean[2]) / MODEL_CONSTANTS.normStd[2];
      }

      floatArr[redOffset + p] = r;
      floatArr[greenOffset + p] = g;
      floatArr[blueOffset + p] = b;
    }

    return new ort.Tensor("float32", floatArr, [1, 3, height, width]);
  }

  /**
   * YOLOv8-seg Tensör Çözümleme, 84 Noktalı Poligon ve Gauss Shoelace Hesabı
   */
  #parseYoloSegOutput(outputMap, lbox) {
    const outKeys = Object.keys(outputMap);
    let boxTensor = null;
    let protoTensor = null;

    for (const k of outKeys) {
      const t = outputMap[k];
      if (t.dims.length === 3) boxTensor = t;
      else if (t.dims.length === 4) protoTensor = t;
    }

    if (!boxTensor || !protoTensor) {
      throw new Error(
        "YOLOv8-seg model çıktısı eksik: Box veya Proto tensörü bulunamadı.",
      );
    }

    const boxData = boxTensor.data;
    const numPredictions = boxTensor.dims[2] || 8400;
    const protoData = protoTensor.data;

    let bestLeafScore = 0;
    let bestLeafIdx = -1;
    let bestLesionScore = 0;
    let bestLesionIdx = -1;

    // En yüksek güvene sahip tespitleri ayrıştır
    for (let i = 0; i < numPredictions; i++) {
      const leafScore = boxData[4 * numPredictions + i];
      const lesionScore = boxData[5 * numPredictions + i];

      if (leafScore > 0.35 && leafScore > bestLeafScore) {
        bestLeafScore = leafScore;
        bestLeafIdx = i;
      }

      if (lesionScore > 0.3 && lesionScore > bestLesionScore) {
        bestLesionScore = lesionScore;
        bestLesionIdx = i;
      }
    }

    const protoSize = MODEL_CONSTANTS.protoSize;
    const leafMaskBuffer = new Uint8Array(protoSize * protoSize);
    const lesionMaskBuffer = new Uint8Array(protoSize * protoSize);

    if (bestLeafIdx !== -1) {
      const coeffs = new Float32Array(32);
      for (let k = 0; k < 32; k++) {
        coeffs[k] = boxData[(6 + k) * numPredictions + bestLeafIdx];
      }
      const cx = boxData[0 * numPredictions + bestLeafIdx] / 4;
      const cy = boxData[1 * numPredictions + bestLeafIdx] / 4;
      const w = boxData[2 * numPredictions + bestLeafIdx] / 4;
      const h = boxData[3 * numPredictions + bestLeafIdx] / 4;

      this.#computeMaskFromProto(
        protoData,
        coeffs,
        cx,
        cy,
        w,
        h,
        leafMaskBuffer,
      );
    }

    const hasLesion = bestLesionIdx !== -1 && bestLesionScore > 0.3;
    if (hasLesion) {
      const coeffs = new Float32Array(32);
      for (let k = 0; k < 32; k++) {
        coeffs[k] = boxData[(6 + k) * numPredictions + bestLesionIdx];
      }
      const cx = boxData[0 * numPredictions + bestLesionIdx] / 4;
      const cy = boxData[1 * numPredictions + bestLesionIdx] / 4;
      const w = boxData[2 * numPredictions + bestLesionIdx] / 4;
      const h = boxData[3 * numPredictions + bestLesionIdx] / 4;

      this.#computeMaskFromProto(
        protoData,
        coeffs,
        cx,
        cy,
        w,
        h,
        lesionMaskBuffer,
      );
    }

    // =========================================================================
    // KRİTİK ONARIM (Madde 2): Delik Yaprak Onarımı — final_mask = (leaf | lesion)
    // =========================================================================
    // Modelde hem leaf hem lesion sınıfları ayrık maskeler üretebilir.
    // Yaprak dokusunun içinde lezyon alanlarının siyah delikler oluşturmasını engellemek
    // için maskeler mantıksal VEYA (Logical OR / Union) ile bir bütün halinde birleştirilir.
    const finalMaskBuffer = new Uint8Array(protoSize * protoSize);
    for (let i = 0; i < finalMaskBuffer.length; i++) {
      finalMaskBuffer[i] =
        leafMaskBuffer[i] | (hasLesion ? lesionMaskBuffer[i] : 0);
    }

    // Dokümantasyon Madde 5.2: 84 Noktalı Organik Poligon ve Gauss Shoelace Hesabı
    // Deliksiz birleşik yaprak geometrisi (finalMaskBuffer) üzerinden hesaplanır
    const leafGeom = this.#extractOrganicPolygonAndArea(
      finalMaskBuffer,
      protoSize,
      protoSize,
      MODEL_CONSTANTS.polygonPoints,
    );

    let lesionGeom = { polygon: [], area: 0.0 };
    if (hasLesion) {
      lesionGeom = this.#extractOrganicPolygonAndArea(
        lesionMaskBuffer,
        protoSize,
        protoSize,
        MODEL_CONSTANTS.polygonPoints,
      );
    }

    // Hastalık Şiddeti (%) = (Alan_Lezyon / Alan_Yaprak_Deliksiz) * 100
    const severityRatio =
      leafGeom.area > 0
        ? Math.min(100.0, (lesionGeom.area / leafGeom.area) * 100.0)
        : 0.0;

    // HUD arayüzü için 640x640 yarı saydam görselleştirme tuvali
    const leafMaskCanvas = this.#createScaledMaskCanvas(
      leafMaskBuffer,
      [34, 197, 94, 90], // Yarı saydam HUD yeşili
    );

    const lesionMaskCanvas = hasLesion
      ? this.#createScaledMaskCanvas(
          lesionMaskBuffer,
          [239, 68, 68, 200], // Kırmızı lezyon
        )
      : null;

    return {
      hasLesion,
      // Dürüst Çıkarım: Yapay taban kilitleri kaldırıldı
      leafConfidence: Math.min(100.0, Math.max(0.0, bestLeafScore * 100)),
      lesionConfidence: Math.min(100.0, Math.max(0.0, bestLesionScore * 100)),
      severityRatio: Number(severityRatio.toFixed(1)),
      leafMaskCanvas,
      lesionMaskCanvas,
      rawFinalMaskBuffer: finalMaskBuffer,
      rawLeafMaskBuffer: leafMaskBuffer,
      rawLesionMaskBuffer: lesionMaskBuffer,
      leafPolygon: leafGeom.polygon,
      lesionPolygon: lesionGeom.polygon,
    };
  }

  /**
   * Dokümantasyon Madde 5.2: 84 Noktalı Organik Poligon ve Gauss Shoelace Formülü
   * Area = 0.5 * |sum(x_i * y_{i+1} - x_{i+1} * y_i)|
   */
  #extractOrganicPolygonAndArea(maskBuffer, width, height, numPoints = 84) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (maskBuffer[rowOffset + x] === 255) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    if (count === 0) {
      return { polygon: [], area: 0.0 };
    }

    const cX = sumX / count;
    const cY = sumY / count;
    const polygon = [];
    const maxRadius = Math.hypot(width, height);

    // 84 radyal ışın (Ray casting) ile gerçek organik sınır noktalarını tespit et
    for (let i = 0; i < numPoints; i++) {
      const theta = (2 * Math.PI * i) / numPoints;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let borderX = cX;
      let borderY = cY;

      for (let r = maxRadius; r >= 0; r -= 0.5) {
        const sampleX = Math.round(cX + r * cosT);
        const sampleY = Math.round(cY + r * sinT);

        if (
          sampleX >= 0 &&
          sampleX < width &&
          sampleY >= 0 &&
          sampleY < height
        ) {
          if (maskBuffer[sampleY * width + sampleX] === 255) {
            borderX = sampleX;
            borderY = sampleY;
            break;
          }
        }
      }

      polygon.push({ x: borderX, y: borderY });
    }

    // Gauss Shoelace Alan Formülü
    let shoelaceSum = 0;
    for (let i = 0; i < polygon.length; i++) {
      const next = (i + 1) % polygon.length;
      shoelaceSum +=
        polygon[i].x * polygon[next].y - polygon[next].x * polygon[i].y;
    }
    const area = 0.5 * Math.abs(shoelaceSum);

    return { polygon, area };
  }

  /**
   * 32 Proto Kanalı ile 32 Katsayıyı Çarpar ve Sigmoid Uygular.
   */
  #computeMaskFromProto(proto, coeffs, cx, cy, w, h, outBuffer) {
    const size = MODEL_CONSTANTS.protoSize;
    const xMin = Math.max(0, Math.floor(cx - w / 2));
    const xMax = Math.min(size, Math.ceil(cx + w / 2));
    const yMin = Math.max(0, Math.floor(cy - h / 2));
    const yMax = Math.min(size, Math.ceil(cy + h / 2));

    let activePixels = 0;

    for (let y = yMin; y < yMax; y++) {
      const yOffset = y * size;
      for (let x = xMin; x < xMax; x++) {
        let logit = 0.0;
        const pixelIdx = yOffset + x;

        for (let k = 0; k < 32; k++) {
          logit += coeffs[k] * proto[k * (size * size) + pixelIdx];
        }

        const prob = 1.0 / (1.0 + Math.exp(-logit));
        if (prob > 0.5) {
          outBuffer[pixelIdx] = 255;
          activePixels++;
        }
      }
    }

    return activePixels;
  }

  #createScaledMaskCanvas(maskBuffer, fillColor) {
    const size = MODEL_CONSTANTS.protoSize;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = size;
    tempCanvas.height = size;
    const ctx = tempCanvas.getContext("2d");
    const imgData = ctx.createImageData(size, size);

    for (let i = 0; i < maskBuffer.length; i++) {
      if (maskBuffer[i] === 255) {
        const p = i * 4;
        imgData.data[p] = fillColor[0];
        imgData.data[p + 1] = fillColor[1];
        imgData.data[p + 2] = fillColor[2];
        imgData.data[p + 3] = fillColor[3];
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = MODEL_CONSTANTS.yoloSize;
    finalCanvas.height = MODEL_CONSTANTS.yoloSize;
    const finalCtx = finalCanvas.getContext("2d");
    finalCtx.imageSmoothingEnabled = false;
    finalCtx.drawImage(
      tempCanvas,
      0,
      0,
      MODEL_CONSTANTS.yoloSize,
      MODEL_CONSTANTS.yoloSize,
    );

    return finalCanvas;
  }

  /**
   * HUD Sarı Lazer Tarama Animasyonunu Canvas-Step2 Üzerinde Oynatır.
   * Letterbox gri dolgularından arındırılmış (unpad) koordinatlarda çalışır.
   */
  async #animateLaserScanSweep(ctx, rawCanvas, yoloResult, lbox) {
    const width = lbox?.scaledW ?? rawCanvas.width;
    const height = lbox?.scaledH ?? rawCanvas.height;
    const padX = lbox?.padX ?? 0;
    const padY = lbox?.padY ?? 0;
    const duration = 1600;
    const startTime = performance.now();

    return new Promise((resolve) => {
      const renderFrame = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1.0, elapsed / duration);
        const laserY = progress * height;

        // Letterbox dolgusu olmayan saf odaklanmış yaprak görselini çiz
        ctx.drawImage(rawCanvas, 0, 0, width, height);

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, laserY);
        ctx.clip();

        // 640x640 maskelerden padX, padY çıkarılarak unpad edilmiş yaprağa giydirilir
        if (yoloResult.leafMaskCanvas) {
          ctx.drawImage(
            yoloResult.leafMaskCanvas,
            padX,
            padY,
            width,
            height,
            0,
            0,
            width,
            height,
          );
        }

        if (yoloResult.hasLesion && yoloResult.lesionMaskCanvas) {
          ctx.drawImage(
            yoloResult.lesionMaskCanvas,
            padX,
            padY,
            width,
            height,
            0,
            0,
            width,
            height,
          );
        }
        ctx.restore();

        // Parlayan Sarı Lazer Çizgisi (@keyframes scanline ile senkronize)
        ctx.save();
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#facc15";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(0, laserY);
        ctx.lineTo(width, laserY);
        ctx.stroke();
        ctx.restore();

        if (progress < 1.0) {
          requestAnimationFrame(renderFrame);
        } else {
          ctx.drawImage(rawCanvas, 0, 0, width, height);
          if (yoloResult.leafMaskCanvas) {
            ctx.drawImage(
              yoloResult.leafMaskCanvas,
              padX,
              padY,
              width,
              height,
              0,
              0,
              width,
              height,
            );
          }
          if (yoloResult.hasLesion && yoloResult.lesionMaskCanvas) {
            ctx.drawImage(
              yoloResult.lesionMaskCanvas,
              padX,
              padY,
              width,
              height,
              0,
              0,
              width,
              height,
            );
          }
          resolve();
        }
      };

      requestAnimationFrame(renderFrame);
    });
  }

  /**
   * Dokümantasyon Madde 1 & 4.7: Zemin İzolasyonu (RGB 0,0,0)
   * Delik Yaprak Onarımı: Mantıksal VEYA (leaf | lesion) ile deliksiz yaprak dokusu.
   * Letterbox gri kenar blokları unpad edilerek tamamen yok edilir.
   */
  #applyBackgroundIsolation(ctx, sourceCanvas, yoloResult, lbox) {
    const width = lbox?.scaledW ?? sourceCanvas.width;
    const height = lbox?.scaledH ?? sourceCanvas.height;
    const padX = lbox?.padX ?? 0;
    const padY = lbox?.padY ?? 0;

    // 1. Zemin tuvalini tamamen saf RGB(0,0,0) ile doldur
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    // Mantıksal VEYA ile birleştirilmiş maskeyi öncelikle tercih et (deliksiz yaprak)
    const maskBuffer =
      yoloResult.rawFinalMaskBuffer || yoloResult.rawLeafMaskBuffer;
    if (!maskBuffer) return;

    // 2. Kaynak görüntü piksellerini al (unpad edilmiş temiz yaprak)
    const sourceCtx = sourceCanvas.getContext("2d");
    const srcImgData = sourceCtx.getImageData(0, 0, width, height);
    const outImgData = ctx.createImageData(width, height);

    const srcPixels = srcImgData.data;
    const outPixels = outImgData.data;
    const protoSize = MODEL_CONSTANTS.protoSize;
    const yoloSize = MODEL_CONSTANTS.yoloSize; // 640

    // 3. Yaprak dokusu ve lezyonlar deliksiz bir bütün olarak korunur, arka plan saf siyah kalır
    for (let y = 0; y < height; y++) {
      const yInYolo = y + padY;
      const protoY = Math.floor((yInYolo * protoSize) / yoloSize);
      const safeProtoY = Math.min(protoSize - 1, Math.max(0, protoY));
      const protoRowOffset = safeProtoY * protoSize;
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const xInYolo = x + padX;
        const protoX = Math.floor((xInYolo * protoSize) / yoloSize);
        const safeProtoX = Math.min(protoSize - 1, Math.max(0, protoX));
        const maskVal = maskBuffer[protoRowOffset + safeProtoX];
        const p = (rowOffset + x) * 4;

        if (maskVal === 255) {
          outPixels[p] = srcPixels[p];
          outPixels[p + 1] = srcPixels[p + 1];
          outPixels[p + 2] = srcPixels[p + 2];
          outPixels[p + 3] = 255;
        } else {
          outPixels[p] = 0;
          outPixels[p + 1] = 0;
          outPixels[p + 2] = 0;
          outPixels[p + 3] = 255;
        }
      }
    }

    ctx.putImageData(outImgData, 0, 0);
  }

  /**
   * 2. Kademe EfficientNet-B0 Sınıflandırıcısı ve 3 Sınıflı Olasılık Dağılımı (Probability Breakdown)
   * YOLOv8s-seg ve EfficientNet-B0 çıktılarının hibrit birleştirilmesi.
   */
  async #executeEfficientNetClassification(isolatedCanvas, yoloResult) {
    if (!this.#classifierSession) {
      throw new Error(
        "EfficientNet-B0 oturumu aktif değil. Sahte çıkarım engellendi.",
      );
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = MODEL_CONSTANTS.classifierSize; // 224
    tempCanvas.height = MODEL_CONSTANTS.classifierSize;
    const tempCtx = tempCanvas.getContext("2d");

    tempCtx.drawImage(
      isolatedCanvas,
      0,
      0,
      tempCanvas.width,
      tempCanvas.height,
    );

    const inputTensor = this.#preprocessToTensor(
      tempCtx,
      tempCanvas.width,
      tempCanvas.height,
      true, // Dokümantasyon Madde 5.3: ImageNet normalizasyonu
    );

    const inputName = this.#classifierSession.inputNames[0];
    const feeds = { [inputName]: inputTensor };

    let outputMap = null;
    try {
      outputMap = await this.#classifierSession.run(feeds);
      const outNames = Object.keys(outputMap);
      const logits = outputMap[outNames[0]].data;

      // Modelin ürettiği 3 sınıfın Softmax aktivasyonu (Sayısal kararlılık ile)
      const l0 = logits[0] ?? 0; // Sınıf 0: Sağlıklı Gemlik Yaprağı
      const l1 = logits[1] ?? 0; // Sınıf 1: Zeytin Pas Akarı (Aceria oleae)
      const l2 = logits[2] ?? 0; // Sınıf 2: Zeytin Halkalı Leke Hastalığı

      const maxL = Math.max(l0, l1, l2);
      const exp0 = Math.exp(l0 - maxL);
      const exp1 = Math.exp(l1 - maxL);
      const exp2 = Math.exp(l2 - maxL);
      const sumExp = exp0 + exp1 + exp2;

      let pHealthy = (exp0 / sumExp) * 100;
      let pMite = (exp1 / sumExp) * 100;
      let pPeacock = (exp2 / sumExp) * 100;

      // =======================================================================
      // ÇİFT KADEMELİ HİBRİT ÇIKARIM: YOLOv8s-seg + EfficientNet-B0
      // =======================================================================
      // Epidemiyolojik Öncelik: YOLO yaprak üzerinde morfolojik lezyon saptadıysa (%0.5+)
      // Halkalı Leke olasılığı YOLO lezyon güveniyle desteklenir.
      if (yoloResult?.hasLesion && (yoloResult.severityRatio >= 0.5 || yoloResult.lesionConfidence >= 35.0)) {
        const yoloLesionConf = yoloResult.lesionConfidence;
        pPeacock = Math.max(pPeacock, yoloLesionConf);
        const remaining = Math.max(0.1, 100.0 - pPeacock);
        const subSum = exp0 + exp1 || 1.0;
        pHealthy = (exp0 / subSum) * remaining;
        pMite = (exp1 / subSum) * remaining;
      }

      // 3 sınıfın toplamını tam %100.0 olacak şekilde normalize et
      const totalP = pHealthy + pMite + pPeacock || 1.0;
      pHealthy = Number(((pHealthy / totalP) * 100).toFixed(1));
      pMite = Number(((pMite / totalP) * 100).toFixed(1));
      pPeacock = Number(((pPeacock / totalP) * 100).toFixed(1));

      // Kazanan Sınıfı Belirle
      let winningType = "healthy";
      let winningTitle = AI_CLASSES?.HEALTHY || "Sağlıklı Gemlik Yaprağı";
      let winningConf = pHealthy;
      let prescription =
        "Bakanlık Tavsiyesi: Yaprak dokusu ve morfolojisi temiz. Standart kültürel bakım ve budama takvimine devam ediniz.";

      if (pPeacock >= pMite && pPeacock >= pHealthy) {
        winningType = "peacock";
        winningTitle =
          AI_CLASSES?.PEACOCK || "Halkalı Leke (Spilocaea oleagina)";
        winningConf = pPeacock;
        prescription =
          "Bakanlık Reçetesi: %1-1.5'lik Bordo Bulamacı veya Bakır Oksiklorür uygulayınız. Ağacın iç kısımlarını ve alt etek dallarını bolca yıkayınız.";
      } else if (pMite >= pPeacock && pMite >= pHealthy) {
        winningType = "mite";
        winningTitle = AI_CLASSES?.MITE || "Zeytin Pas Akarı (Aceria oleae)";
        winningConf = pMite;
        prescription =
          "Bakanlık Reçetesi: Zeytin Pas Akarı kolonizasyonu tespit edildi. Islanabilir Kükürt (WP) veya Abamectin uygulayınız. Taze sürgünlerin yaprak altı yüzeylerini hedef alınız.";
      }

      return {
        disease: winningTitle,
        type: winningType,
        confidence: winningConf,
        severity: yoloResult?.severityRatio ?? 0,
        prescription,
        probabilities: {
          peacock: pPeacock,
          mite: pMite,
          healthy: pHealthy,
        },
      };
    } finally {
      // Wasm tensör bellek sızıntısını önle
      inputTensor.dispose?.();
      if (outputMap) {
        for (const k of Object.keys(outputMap)) {
          outputMap[k].dispose?.();
        }
      }
    }
  }

  /**
   * Dokümantasyon Madde 4.7 & 3 Sınıfın Olasılık Dağılımı (Probability Breakdown) Render
   */
  #renderStep4Results(diag) {
    const titleEl = document.getElementById("diagnosis-title");
    const badgeEl = document.getElementById("diagnosis-badge");
    const confTextEl = document.getElementById("diagnosis-confidence-text");
    const confBarEl = document.getElementById("diagnosis-confidence-bar");
    const prescTextEl = document.getElementById("diagnosis-prescription-text");

    if (titleEl) titleEl.innerText = diag.disease;

    if (badgeEl) {
      badgeEl.innerText =
        diag.type === "healthy" ? "Sağlıklı" : "Enfeksiyon Tespit Edildi";
      badgeEl.className =
        diag.type === "healthy"
          ? "px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800"
          : "px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800";
    }

    if (prescTextEl) prescTextEl.innerText = diag.prescription;

    // Dokümantasyon Madde 4.7 uyarınca %30.1 tabanlı yumuşak animasyon akışı
    const targetConf = diag.confidence;
    let currentConf = Math.min(30.1, targetConf);

    if (confBarEl) confBarEl.style.width = `${currentConf}%`;
    if (confTextEl) confTextEl.innerText = `%${currentConf.toFixed(1)}`;

    this.#confidenceIntervalId = setInterval(() => {
      currentConf += 2.5;
      if (currentConf >= targetConf) {
        currentConf = targetConf;
        clearInterval(this.#confidenceIntervalId);
        this.#confidenceIntervalId = null;
      }
      if (confTextEl) confTextEl.innerText = `%${currentConf.toFixed(1)}`;
      if (confBarEl) confBarEl.style.width = `${currentConf}%`;
    }, 25);

    // =========================================================================
    // 3 SINIFIN OLASILIK DAĞILIMI (PROBABILITY BREAKDOWN) RENDER
    // =========================================================================
    const probs = diag.probabilities || {
      peacock: 0,
      mite: 0,
      healthy: 100,
    };

    const peacockValEl = document.getElementById("prob-val-peacock");
    const peacockBarEl = document.getElementById("prob-bar-peacock");
    const miteValEl = document.getElementById("prob-val-mite");
    const miteBarEl = document.getElementById("prob-bar-mite");
    const healthyValEl = document.getElementById("prob-val-healthy");
    const healthyBarEl = document.getElementById("prob-bar-healthy");

    if (peacockValEl) peacockValEl.innerText = `%${probs.peacock.toFixed(1)}`;
    if (peacockBarEl) {
      setTimeout(() => {
        peacockBarEl.style.width = `${probs.peacock}%`;
      }, 50);
    }

    if (miteValEl) miteValEl.innerText = `%${probs.mite.toFixed(1)}`;
    if (miteBarEl) {
      setTimeout(() => {
        miteBarEl.style.width = `${probs.mite}%`;
      }, 100);
    }

    if (healthyValEl) healthyValEl.innerText = `%${probs.healthy.toFixed(1)}`;
    if (healthyBarEl) {
      setTimeout(() => {
        healthyBarEl.style.width = `${probs.healthy}%`;
      }, 150);
    }
  }

  /**
   * Kademeli Görselleştirme: Kartı yumuşak geçişle ekranda belirginleştirir.
   */
  #revealStepCard(cardId) {
    const card = document.getElementById(cardId);
    if (card) {
      card.classList.add("is-visible");
    }
  }

  #updateStepHeader(title, desc) {
    const titleEl = document.getElementById("pipeline-step-title");
    const descEl = document.getElementById("pipeline-step-desc");
    if (titleEl) titleEl.innerText = title;
    if (descEl) descEl.innerText = desc;
  }

  #displayModelMissingErrorModal() {
    alert(
      "⚠️ ONNX Modelleri Bulunamadı!\n\n" +
        "Boru hattının çalışması için her iki model zorunludur:\n" +
        "1) models/yolov8_seg.onnx\n" +
        "2) models/efficientnet.onnx\n\n" +
        "Lütfen dosyaları 'Yerel .onnx Dosyalarını Seç' butonuyla yükleyin veya models/ dizinine yerleştirin.",
    );
  }

  #refreshStatusIndicators() {
    const yoloBadge = document.getElementById("model-yolo-status");
    const effBadge = document.getElementById("model-eff-status");
    const globalBadge = document.getElementById("ai-status-badge");

    if (yoloBadge) {
      yoloBadge.innerText = this.#isYoloReady
        ? "1. YOLOv8s-seg: Hazır (Wasm)"
        : "1. YOLOv8s-seg: Eksik";
      yoloBadge.className = this.#isYoloReady
        ? "text-[11px] px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-700"
        : "text-[11px] px-2 py-0.5 rounded font-semibold bg-red-100 text-red-700";
    }

    if (effBadge) {
      effBadge.innerText = this.#isClassifierReady
        ? "2. EfficientNet-B0: Hazır (Wasm)"
        : "2. EfficientNet-B0: Eksik";
      effBadge.className = this.#isClassifierReady
        ? "text-[11px] px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-700"
        : "text-[11px] px-2 py-0.5 rounded font-semibold bg-red-100 text-red-700";
    }

    if (globalBadge) {
      if (this.#isYoloReady && this.#isClassifierReady) {
        this.#updateGlobalBadge(
          "Çift Model Hazır (ONNX Wasm)",
          "bg-emerald-100 text-emerald-700",
        );
      } else {
        this.#updateGlobalBadge(
          "Modeller Eksik (Yükleme Bekleniyor)",
          "bg-amber-100 text-amber-800",
        );
      }
    }
  }

  #markModelsMissing(reason) {
    this.#isYoloReady = false;
    this.#isClassifierReady = false;
    this.#updateGlobalBadge(
      `Modeller Eksik (${reason})`,
      "bg-red-100 text-red-700",
    );
  }

  #updateGlobalBadge(text, colorClass) {
    const badge = document.getElementById("ai-status-badge");
    if (badge) {
      badge.innerText = text;
      badge.className = `text-xs px-3 py-1 rounded-full font-semibold ${colorClass}`;
    }
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const ModelPipeline = new ModelPipelineOrchestrator();
