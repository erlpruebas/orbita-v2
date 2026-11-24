/**
 * audio-core.js — Singleton AudioContext, desbloqueo síncrono móvil,
 * cadena Master, Reverb (0 LEDs = 100% seca por defecto) y FX de Eje Y.
 */

import { getState } from './state.js';

let audioCtx = null;
let masterCompressor = null;
let synthInputBus = null;
let exprFilterNode = null;
let exprDriveNode = null;
let exprDriveWet = null;
let exprDriveDry = null;
let exprVolumeNode = null;
let reverbConvolver = null;
let reverbSendGain = null;
let synthDryGain = null;
let drumBus = null;
let metroBus = null;

// Curvas de saturación cálida precalculadas para el modo Distorsión del Eje Y
let softClipCurve = null;

const REVERB_WET_LEVELS = [0.0, 0.22, 0.46, 0.78];

/**
 * Protección obligatoria (REGLAS_NO_ROMPER.md #4) para rampas exponenciales
 */
export function safeParam(val, min = 0.0001, max = 22000) {
  const num = Number(val);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function makeWarmDriveCurve(amount = 22) {
  const nSamples = 2048;
  const curve = new Float32Array(nSamples);
  const k = amount;
  for (let i = 0; i < nSamples; i++) {
    const x = (i * 2) / nSamples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function buildImpulseResponse(ctx, duration = 2.1, decay = 2.8) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const impulse = ctx.createBuffer(2, length, rate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const norm = i / length;
    // Pre-delay suave de 12 ms y cola exponencial sedosa
    const env = i < rate * 0.012 ? (i / (rate * 0.012)) : Math.pow(1 - norm, decay);
    left[i] = (Math.random() * 2 - 1) * env * 0.6;
    right[i] = (Math.random() * 2 - 1) * env * 0.6;
  }
  return impulse;
}

/**
 * Inicializa o devuelve el AudioContext y construye el grafo maestro.
 * DEBE invocarse síncronamente dentro de pointerdown / touchstart / keydown.
 */
export function ensureAudioUnlocked() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) {
    audioCtx = new AudioCtx({ latencyHint: 'interactive' });

    // Compresor/limitador maestro para evitar clipping polifónico
    masterCompressor = audioCtx.createDynamicsCompressor();
    masterCompressor.threshold.setValueAtTime(-10, audioCtx.currentTime);
    masterCompressor.knee.setValueAtTime(12, audioCtx.currentTime);
    masterCompressor.ratio.setValueAtTime(4, audioCtx.currentTime);
    masterCompressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
    masterCompressor.release.setValueAtTime(0.18, audioCtx.currentTime);
    masterCompressor.connect(audioCtx.destination);

    // Bus de entrada del sintetizador
    synthInputBus = audioCtx.createGain();
    synthInputBus.gain.setValueAtTime(0.85, audioCtx.currentTime);

    // Etapa 1 Eje Y: Filtro paso bajo resonante estilo Moog
    exprFilterNode = audioCtx.createBiquadFilter();
    exprFilterNode.type = 'lowpass';
    exprFilterNode.frequency.setValueAtTime(14000, audioCtx.currentTime);
    exprFilterNode.Q.setValueAtTime(1.1, audioCtx.currentTime);

    // Etapa 2 Eje Y: Saturación / Drive cálido con mezcla dry/wet
    if (!softClipCurve) softClipCurve = makeWarmDriveCurve(14);
    exprDriveNode = audioCtx.createWaveShaper();
    exprDriveNode.curve = softClipCurve;
    exprDriveNode.oversample = '2x';

    exprDriveDry = audioCtx.createGain();
    exprDriveDry.gain.setValueAtTime(1.0, audioCtx.currentTime);

    exprDriveWet = audioCtx.createGain();
    exprDriveWet.gain.setValueAtTime(0.0, audioCtx.currentTime);

    // Etapa 3 Eje Y: Volumen / Swell dinámico
    exprVolumeNode = audioCtx.createGain();
    exprVolumeNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    // Cableado serie/paralelo de la sección de expresión
    synthInputBus.connect(exprFilterNode);
    exprFilterNode.connect(exprDriveDry);
    exprFilterNode.connect(exprDriveNode);
    exprDriveNode.connect(exprDriveWet);
    exprDriveDry.connect(exprVolumeNode);
    exprDriveWet.connect(exprVolumeNode);

    // Salida seca del sintetizador
    synthDryGain = audioCtx.createGain();
    synthDryGain.gain.setValueAtTime(0.92, audioCtx.currentTime);

    // Envío de Reverb (0 LEDs = 0.0 ganancia por defecto)
    reverbConvolver = audioCtx.createConvolver();
    reverbConvolver.buffer = buildImpulseResponse(audioCtx, 2.2, 2.7);
    reverbSendGain = audioCtx.createGain();
    const initialRev = getState().reverbLevel || 0;
    reverbSendGain.gain.setValueAtTime(REVERB_WET_LEVELS[initialRev] || 0.0, audioCtx.currentTime);

    exprVolumeNode.connect(synthDryGain);
    synthDryGain.connect(masterCompressor);

    exprVolumeNode.connect(reverbSendGain);
    reverbSendGain.connect(reverbConvolver);
    reverbConvolver.connect(masterCompressor);

    // Bus de Batería: 100% SECO, separado del envío de reverb del sintetizador (REGLAS_NO_ROMPER.md #4)
    drumBus = audioCtx.createGain();
    drumBus.gain.setValueAtTime(0.9, audioCtx.currentTime);
    drumBus.connect(masterCompressor);

    // Bus de Metrónomo
    metroBus = audioCtx.createGain();
    metroBus.gain.setValueAtTime(0.65, audioCtx.currentTime);
    metroBus.connect(masterCompressor);
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  return audioCtx;
}

export function getAudioContext() {
  return audioCtx || ensureAudioUnlocked();
}

export function getSynthDestination() {
  ensureAudioUnlocked();
  return synthInputBus;
}

export function getDrumDestination() {
  ensureAudioUnlocked();
  return drumBus;
}

export function getMetroDestination() {
  ensureAudioUnlocked();
  return metroBus;
}

export function getMasterOutputNode() {
  ensureAudioUnlocked();
  return masterCompressor;
}

/**
 * Actualiza el nivel de envío de Reverb (0 = apagada 100% seca, 1..3 LEDs)
 */
export function setReverbLevel(level) {
  if (typeof window === 'undefined') return;
  ensureAudioUnlocked();
  const idx = Math.max(0, Math.min(3, Number(level) || 0));
  const wet = REVERB_WET_LEVELS[idx];
  const now = audioCtx.currentTime;
  reverbSendGain.gain.cancelScheduledValues(now);
  reverbSendGain.gain.setTargetAtTime(wet, now, 0.025);
}

/**
 * Modula en tiempo real el parámetro elegido para el Eje Y (0.0 abajo .. 1.0 arriba)
 * Cuando se suelta la tecla, resetExpression() devuelve la cadena a su estado neutro.
 */
export function applyYAxisExpression(yNorm, mode = getState().yAxisMode) {
  if (!audioCtx) return;
  const y = Math.max(0, Math.min(1, Number(yNorm) ?? 0.75));
  const now = audioCtx.currentTime;

  if (mode === 'filter') {
    // Filtro paso bajo musical: de 320 Hz (abajo) a 14000 Hz (arriba), Q suave sin silbidos al soltar
    const cutoff = safeParam(320 * Math.pow(44, y), 280, 15000);
    const resonance = 1.0 + Math.sin(y * Math.PI) * 1.35;
    exprFilterNode.frequency.setTargetAtTime(cutoff, now, 0.018);
    exprFilterNode.Q.setTargetAtTime(resonance, now, 0.018);
    exprVolumeNode.gain.setTargetAtTime(1.0, now, 0.02);
    exprDriveWet.gain.setTargetAtTime(0.0, now, 0.02);
    exprDriveDry.gain.setTargetAtTime(1.0, now, 0.02);
  } else if (mode === 'volume') {
    // Swell dinámico expresivo: de 0.22 a 1.25
    const gain = 0.22 + y * 1.03;
    exprVolumeNode.gain.setTargetAtTime(gain, now, 0.018);
    exprFilterNode.frequency.setTargetAtTime(14000, now, 0.02);
    exprFilterNode.Q.setTargetAtTime(1.0, now, 0.02);
    exprDriveWet.gain.setTargetAtTime(0.0, now, 0.02);
    exprDriveDry.gain.setTargetAtTime(1.0, now, 0.02);
  } else if (mode === 'drive') {
    // Saturación cálida progresiva
    const wet = Math.min(0.88, y * 0.90);
    const dry = 1.0 - wet * 0.55;
    exprDriveWet.gain.setTargetAtTime(wet, now, 0.018);
    exprDriveDry.gain.setTargetAtTime(dry, now, 0.018);
    exprFilterNode.frequency.setTargetAtTime(safeParam(2200 + y * 10000), now, 0.02);
    exprFilterNode.Q.setTargetAtTime(1.1 + y * 0.8, now, 0.02);
    exprVolumeNode.gain.setTargetAtTime(1.0, now, 0.02);
  }
}

export function resetYAxisExpression() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  exprFilterNode.frequency.setTargetAtTime(14000, now, 0.04);
  exprFilterNode.Q.setTargetAtTime(1.0, now, 0.04);
  exprVolumeNode.gain.setTargetAtTime(1.0, now, 0.04);
  exprDriveWet.gain.setTargetAtTime(0.0, now, 0.04);
  exprDriveDry.gain.setTargetAtTime(1.0, now, 0.04);
}

/**
 * Síntesis del clic de metrónomo (madera/cristal de alta definición)
 */
export function triggerMetronomeClick(when = null, isDownbeat = false) {
  const ctx = ensureAudioUnlocked();
  const t = when !== null ? Math.max(ctx.currentTime, when) : ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  const baseFreq = isDownbeat ? 1320 : 880;
  osc.frequency.setValueAtTime(baseFreq, t);
  osc.frequency.exponentialRampToValueAtTime(safeParam(baseFreq * 0.55), t + 0.035);

  const peak = isDownbeat ? 0.45 : 0.26;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);

  osc.connect(gain);
  gain.connect(getMetroDestination());

  osc.start(t);
  const endsAt = t + 0.048;
  osc.stop(endsAt);
  return {
    endsAt,
    stop() {
      gain.disconnect();
      osc.stop(ctx.currentTime);
    }
  };
}
