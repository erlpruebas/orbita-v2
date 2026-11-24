/**
 * tonality-mic.js — Servicio 2: Detector de Tonalidad por Micrófono (Clave de Sol)
 * - Detección de pitch en tiempo real (autocorrelación normalizada / YIN)
 * - Buffer deslizante de 20 segundos
 * - Mapa de calor de 4 niveles (1=Rojo, 2=Naranja, 3=Amarillo, 4=Verde)
 * - Estimación de escala con notas en Amarillo y Verde (formato relativo Do M / La m)
 * - Teclado cromático de 1 octava con referencia sonora al pulsar
 */

import { ensureAudioUnlocked, getSynthDestination, safeParam } from './audio-core.js';
import { getState } from './state.js';
import { getNoteNameTitle, midiToFreq, freqToMidiFloat, getRelativePair } from './theory.js';

const BUFFER_WINDOW_MS = 20000; // Ventana deslizante de 20 segundos (SPEC.md §6)
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

// Perfiles Krumhansl-Kessler combinados con máscara diatónica
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

let micStream = null;
let micSourceNode = null;
let analyserNode = null;
let timeDomainBuf = null;
let analysisTimer = null;
let isListening = false;

// Buffer deslizante: cada muestra { timestamp, pitchClass, weight, centsOff }
let pitchSamples = [];
let firstSampleTimestamp = 0;
let uiUpdateCallback = null;

// Voz activa de referencia cromática
let activeRefOsc = null;
let activeRefGain = null;

export function isMicListening() {
  return isListening;
}

export function clearTonalityBuffer() {
  pitchSamples = [];
  firstSampleTimestamp = isListening ? performance.now() : 0;
  emitAnalysisSnapshot(null);
}

/**
 * Reproduce una nota limpia de referencia vocal al tocar el teclado cromático (DO4..SI4)
 */
export function startChromaticReferenceNote(pitchClass) {
  stopChromaticReferenceNote();
  const ctx = ensureAudioUnlocked();
  const dest = getSynthDestination();
  const midi = 60 + ((pitchClass % 12) + 12) % 12;
  const freq = safeParam(midiToFreq(midi), 60, 4000);
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = 'triangle';
  osc2.type = 'sine';
  osc1.frequency.setValueAtTime(freq, now);
  osc2.frequency.setValueAtTime(freq * 2, now);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.18, now);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2800, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.32, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.25);

  osc1.connect(filter);
  osc2.connect(g2);
  g2.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  osc1.start(now);
  osc2.start(now);

  activeRefOsc = [osc1, osc2];
  activeRefGain = gain;

  // Además, si el usuario toca la tecla de referencia, podemos inyectar un ligero pulso o mantenerla independiente
}

export function stopChromaticReferenceNote() {
  if (!activeRefOsc || !activeRefGain) return;
  try {
    const ctx = ensureAudioUnlocked();
    const now = ctx.currentTime;
    activeRefGain.gain.cancelScheduledValues(now);
    activeRefGain.gain.setValueAtTime(safeParam(activeRefGain.gain.value, 0.0002, 1), now);
    activeRefGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    activeRefOsc.forEach(o => {
      try { o.stop(now + 0.11); } catch (_) {}
    });
  } catch (_) {}
  activeRefOsc = null;
  activeRefGain = null;
}

/**
 * Detector de frecuencia fundamental por autocorrelación normalizada (rango vocal 75 Hz – 1100 Hz)
 */
function detectPitchYIN(buffer, sampleRate) {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / size);
  if (rms < 0.014) {
    return null; // Puerta de ruido para ignorar silencio de fondo
  }

  const minFreq = 75;
  const maxFreq = 1100;
  const minTau = Math.floor(sampleRate / maxFreq);
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(size / 2));

  const yinBuf = new Float32Array(maxTau + 1);
  yinBuf[0] = 1;
  let runningSum = 0;

  for (let tau = 1; tau <= maxTau; tau++) {
    let diff = 0;
    for (let i = 0; i < maxTau; i++) {
      const delta = buffer[i] - buffer[i + tau];
      diff += delta * delta;
    }
    runningSum += diff;
    yinBuf[tau] = runningSum > 0 ? (diff * tau) / runningSum : 1;
  }

  const threshold = 0.16;
  let bestTau = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yinBuf[tau] < threshold) {
      while (tau + 1 <= maxTau && yinBuf[tau + 1] < yinBuf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) {
    // Buscar mínimo global si está suficientemente definido
    let minVal = 1.0;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (yinBuf[tau] < minVal) {
        minVal = yinBuf[tau];
        bestTau = tau;
      }
    }
    if (minVal > 0.34) return null;
  }

  // Interpolación parabólica para precisión sub-sample
  let refinedTau = bestTau;
  if (bestTau > 1 && bestTau < maxTau) {
    const s0 = yinBuf[bestTau - 1];
    const s1 = yinBuf[bestTau];
    const s2 = yinBuf[bestTau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-6) {
      refinedTau = bestTau + (s2 - s0) / denom;
    }
  }

  const freq = sampleRate / refinedTau;
  const clarity = Math.max(0, Math.min(1, 1 - yinBuf[bestTau]));
  return { freq, clarity, rms };
}

/**
 * Calcula los pesos por clase de altura (0..11), el baremo de 4 niveles (Rojo/Naranja/Amarillo/Verde)
 * y la tonalidad más probable con las notas en Amarillo y Verde.
 */
export function computeTonalityAnalysis(nowMs = performance.now()) {
  // Podar muestras más antiguas que 20 segundos
  const cutoffMs = nowMs - BUFFER_WINDOW_MS;
  pitchSamples = pitchSamples.filter(s => s.timestamp >= cutoffMs);

  const energies = new Float32Array(12);
  for (const s of pitchSamples) {
    energies[s.pitchClass] += s.weight;
  }

  let maxEnergy = 0;
  let totalEnergy = 0;
  for (let pc = 0; pc < 12; pc++) {
    if (energies[pc] > maxEnergy) maxEnergy = energies[pc];
    totalEnergy += energies[pc];
  }

  // Baremo de 4 niveles (SPEC.md §6):
  // 0 = sin señal
  // 1 = Rojo (presencia mínima / fuera de escala: >2% .. <15%)
  // 2 = Naranja (presencia baja: 15% .. <32%)
  // 3 = Amarillo (nota frecuente / candidata a la escala: 32% .. <64%)
  // 4 = Verde (nota dominante / muy presente: >=64%)
  const heatLevels = new Array(12).fill(0);
  const normPercentages = new Array(12).fill(0);

  if (maxEnergy > 0.05) {
    for (let pc = 0; pc < 12; pc++) {
      const ratio = energies[pc] / maxEnergy;
      normPercentages[pc] = Math.round(ratio * 100);
      if (ratio < 0.025) heatLevels[pc] = 0;
      else if (ratio < 0.16) heatLevels[pc] = 1; // Rojo
      else if (ratio < 0.34) heatLevels[pc] = 2; // Naranja
      else if (ratio < 0.65) heatLevels[pc] = 3; // Amarillo
      else heatLevels[pc] = 4;                   // Verde
    }
  }

  // Estimar tonalidad usando prioritariamente las notas en Amarillo (3) y Verde (4)
  let bestRoot = null;
  let bestMode = 'M';
  let bestScore = -Infinity;
  let relativeInfo = null;

  if (maxEnergy > 0.15 && pitchSamples.length >= 4) {
    const filteredWeights = new Float32Array(12);
    for (let pc = 0; pc < 12; pc++) {
      if (heatLevels[pc] >= 3) {
        filteredWeights[pc] = (energies[pc] / maxEnergy) * (heatLevels[pc] === 4 ? 1.35 : 1.0);
      } else if (heatLevels[pc] === 2) {
        filteredWeights[pc] = (energies[pc] / maxEnergy) * 0.25;
      }
    }

    for (let root = 0; root < 12; root++) {
      let majScore = 0;
      let minScore = 0;

      for (let i = 0; i < 12; i++) {
        const pc = (root + i) % 12;
        const w = filteredWeights[pc];
        const inMajor = MAJOR_INTERVALS.includes(i);
        const inMinor = MINOR_INTERVALS.includes(i);

        majScore += w * (inMajor ? KK_MAJOR[i] * 1.4 : -3.2);
        minScore += w * (inMinor ? KK_MINOR[i] * 1.4 : -3.2);
      }

      // Bonus por tríada tónica (I - III - V)
      majScore += filteredWeights[root] * 2.1 + filteredWeights[(root + 4) % 12] * 1.1 + filteredWeights[(root + 7) % 12] * 1.3;
      minScore += filteredWeights[root] * 2.1 + filteredWeights[(root + 3) % 12] * 1.1 + filteredWeights[(root + 7) % 12] * 1.3;

      if (majScore > bestScore) {
        bestScore = majScore;
        bestRoot = root;
        bestMode = 'M';
      }
      if (minScore > bestScore) {
        bestScore = minScore;
        bestRoot = root;
        bestMode = 'm';
      }
    }

    if (bestRoot !== null) {
      relativeInfo = getRelativePair(bestRoot, bestMode, getState().notation);
    }
  }

  const elapsedWindowSec = firstSampleTimestamp > 0
    ? Math.min(20, (nowMs - firstSampleTimestamp) / 1000)
    : (pitchSamples.length > 0 ? Math.min(20, (nowMs - pitchSamples[0].timestamp) / 1000) : 0);

  return {
    heatLevels,
    normPercentages,
    elapsedWindowSec,
    sampleCount: pitchSamples.length,
    detected: relativeInfo ? {
      preferredRoot: bestRoot,
      preferredMode: bestMode,
      majorRoot: relativeInfo.majorRoot,
      minorRoot: relativeInfo.minorRoot,
      majorLabel: relativeInfo.majorLabel,
      minorLabel: relativeInfo.minorLabel,
      combinedLabel: relativeInfo.combinedLabel
    } : null
  };
}

function emitAnalysisSnapshot(livePitchInfo = null) {
  if (!uiUpdateCallback) return;
  const summary = computeTonalityAnalysis(performance.now());
  uiUpdateCallback({
    isListening,
    livePitch: livePitchInfo,
    ...summary
  });
}

/**
 * Arranca o detiene la escucha del micrófono
 */
export async function toggleMicrophoneCapture(onUpdate) {
  if (onUpdate) uiUpdateCallback = onUpdate;

  if (isListening) {
    stopMicrophoneCapture();
    return { ok: true, listening: false };
  }

  try {
    const ctx = ensureAudioUnlocked();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        ok: false,
        error: 'El navegador requiere HTTPS (o localhost) para acceder al micrófono.'
      };
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    micSourceNode = ctx.createMediaStreamSource(micStream);
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    timeDomainBuf = new Float32Array(analyserNode.fftSize);
    micSourceNode.connect(analyserNode);

    isListening = true;
    if (pitchSamples.length === 0) {
      firstSampleTimestamp = performance.now();
    }

    analysisTimer = setInterval(() => {
      if (!isListening || !analyserNode) return;
      analyserNode.getFloatTimeDomainData(timeDomainBuf);
      const res = detectPitchYIN(timeDomainBuf, ctx.sampleRate);
      const nowMs = performance.now();

      if (res && res.clarity >= 0.55) {
        const midiFloat = freqToMidiFloat(res.freq);
        const midiRound = Math.round(midiFloat);
        const centsOff = Math.round((midiFloat - midiRound) * 100);

        // Solo acumular notas estables afinadas dentro de ±42 cents
        if (Math.abs(centsOff) <= 42) {
          const pc = ((midiRound % 12) + 12) % 12;
          const stabilityFactor = 1 - (Math.abs(centsOff) / 50);
          const weight = res.clarity * stabilityFactor;

          if (pitchSamples.length === 0) firstSampleTimestamp = nowMs;
          pitchSamples.push({
            timestamp: nowMs,
            pitchClass: pc,
            weight,
            centsOff
          });

          emitAnalysisSnapshot({
            pitchClass: pc,
            noteName: getNoteNameTitle(pc, getState().notation),
            freq: Math.round(res.freq),
            centsOff
          });
          return;
        }
      }
      emitAnalysisSnapshot(null);
    }, 55);

    emitAnalysisSnapshot(null);
    return { ok: true, listening: true };
  } catch (err) {
    stopMicrophoneCapture();
    return {
      ok: false,
      error: err?.message || 'No se pudo acceder al micrófono.'
    };
  }
}

export function stopMicrophoneCapture() {
  if (analysisTimer) {
    clearInterval(analysisTimer);
    analysisTimer = null;
  }
  if (micSourceNode) {
    try { micSourceNode.disconnect(); } catch (_) {}
    micSourceNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  isListening = false;
  emitAnalysisSnapshot(null);
}

/**
 * Inyecta una melodía vocal simulada en el buffer de 20s (y la hace sonar suavemente)
 * para probar el mapa de calor de 4 niveles incluso sin micrófono conectado.
 */
export function simulateSingingScaleDemo(rootPc = 0, mode = 'M', onUpdate = null) {
  if (onUpdate) uiUpdateCallback = onUpdate;
  ensureAudioUnlocked();

  const nowMs = performance.now();
  if (pitchSamples.length === 0) firstSampleTimestamp = nowMs - 8000;

  const intervals = mode === 'M' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  // Pesos realistas de una melodía cantada: tónica, 5ª y 3ª dominantes (Verde), resto de la escala (Amarillo/Naranja) y una nota de paso (Rojo)
  const scaleWeights = [18, 7, 13, 6, 15, 9, 4];

  intervals.forEach((semi, idx) => {
    const pc = (rootPc + semi) % 12;
    const count = scaleWeights[idx];
    for (let k = 0; k < count; k++) {
      pitchSamples.push({
        timestamp: nowMs - Math.random() * 6000,
        pitchClass: pc,
        weight: 0.85,
        centsOff: 0
      });
    }
  });

  // Una pequeña nota cromática de paso con poca presencia (nivel Rojo)
  const passingPc = (rootPc + 1) % 12;
  pitchSamples.push({
    timestamp: nowMs - 1000,
    pitchClass: passingPc,
    weight: 0.7,
    centsOff: 5
  });

  startChromaticReferenceNote(rootPc);
  setTimeout(() => stopChromaticReferenceNote(), 320);

  emitAnalysisSnapshot({
    pitchClass: rootPc,
    noteName: getNoteNameTitle(rootPc, getState().notation),
    freq: Math.round(midiToFreq(60 + rootPc)),
    centsOff: 0
  });
}

export function registerTonalityUIUpdater(cb) {
  uiUpdateCallback = cb;
}
