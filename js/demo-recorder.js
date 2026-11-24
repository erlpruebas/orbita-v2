/**
 * demo-recorder.js — Estudio Multipista de Maquetas (2 Pistas Sincronizadas: Música + Voz)
 * - Captura simultánea sample-accurate vía AudioWorklet de 3 canales:
 *   Canal 0/1 = Música estéreo de ÓRBITA | Canal 2 = Micrófono con filtro configurable
 * - Detiene automáticamente la batería y el looper al parar la grabación para escuchar en silencio
 * - Mezclador en tiempo real y renderizado offline (.WAV 16-bit estéreo):
 *   · Volumen Música (0–150%) y Volumen Voz (0–180%)
 *   · Eco en Voz (0 a 3 niveles) y Chorus estéreo en Voz (0 a 3 niveles)
 *   · Recorte de Inicio y Final (Trim Start / End) con forma de onda de 2 pistas
 */

import { ensureAudioUnlocked, getMasterOutputNode, safeParam } from './audio-core.js';
import { stopAllTransportForPlayback } from './clock-looper.js';
import { t } from './i18n.js';
import { getState } from './state.js';
import { prepareFrontCamera } from './short-video.js';
import { getActivePreset } from './synth-presets.js';
import { getNoteNameUpper } from './theory.js';

const MIC_FILTER_CONFIGS = [
  { echoCancellation: false, noiseSuppression: false, autoGainControl: false, highpassHz: 40, gateThreshold: 0 },
  { echoCancellation: true, noiseSuppression: false, autoGainControl: false, highpassHz: 80, gateThreshold: 0 },
  { echoCancellation: true, noiseSuppression: true, autoGainControl: false, highpassHz: 110, gateThreshold: 0.008 },
  { echoCancellation: true, noiseSuppression: true, autoGainControl: true, highpassHz: 140, gateThreshold: 0.018 }
];

export function getMicFilterConfig(level) {
  const config = Number.isInteger(level) ? MIC_FILTER_CONFIGS[level] : null;
  return { ...(config ?? MIC_FILTER_CONFIGS[0]) };
}

let isRecording = false;
let startTimestamp = 0;
let timerInterval = null;
let statusCallback = null;
let cameraCapture = null;
let cameraRequested = false;
let videoMetadata = null;
let micGateThreshold = 0;

// Nodos de grabación multipista
let musicSplitter = null;
let musicTapGain = null;
let micStream = null;
let micSource = null;
let micHighpass = null;
let micGain = null;
let mergerNode = null;
let workletNode = null;
let workletLoaded = false;
let silentSink = null;

// Fallback MediaRecorder si el navegador no soporta AudioWorklet (ej. HTTP sin localhost)
let fallbackDest = null;
let fallbackRecorder = null;
let fallbackChunks = [];

// Buffers crudos de la sesión capturada
let rawMusicL = [];
let rawMusicR = [];
let rawVoice = [];

let hasMicActive = false;
let micWarningReason = '';
let detectedRoundTripMs = 110; // Estimación inicial de latencia ida y vuelta (salida + entrada + AEC)

// Sesión actual grabada en memoria (AudioBuffers de 2 pistas)
let currentSession = null;

// Estado de preescucha en vivo del Estudio de Maqueta
let previewState = null;

const VOICE_SYNC_STORAGE_KEY = 'orbita_voice_sync_offset_ms_v1';

export function getSavedVoiceSyncMs(fallbackMs = null) {
  try {
    const raw = localStorage.getItem(VOICE_SYNC_STORAGE_KEY);
    if (raw !== null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= -450 && n <= 200) return Math.round(n);
    }
  } catch (_) {}
  return fallbackMs !== null ? Math.round(fallbackMs) : -Math.round(detectedRoundTripMs);
}

export function saveVoiceSyncMs(ms) {
  try {
    localStorage.setItem(VOICE_SYNC_STORAGE_KEY, String(Math.round(ms)));
  } catch (_) {}
}

const MULTITRACK_WORKLET_CODE = `
class OrbitaMultitrackProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length >= 1) {
      const mL = input[0];
      const mR = input.length > 1 ? input[1] : input[0];
      const vM = input.length > 2 ? input[2] : null;
      if (mL && mL.length > 0) {
        this.port.postMessage({
          mL: new Float32Array(mL),
          mR: new Float32Array(mR),
          vM: vM ? new Float32Array(vM) : null
        });
      }
    }
    return true;
  }
}
registerProcessor('orbita-multitrack-recorder', OrbitaMultitrackProcessor);
`;

const ECHO_PRESETS = [
  { wet: 0.0,  delay: 0.20, feedback: 0.0,  filterHz: 3800 }, // 0: Apagado
  { wet: 0.24, delay: 0.19, feedback: 0.22, filterHz: 3600 }, // 1: Eco corto sutil (Slapback)
  { wet: 0.40, delay: 0.31, feedback: 0.36, filterHz: 3000 }, // 2: Eco medio musical
  { wet: 0.56, delay: 0.43, feedback: 0.50, filterHz: 2500 }  // 3: Eco amplio atmosférico
];

const CHORUS_PRESETS = [
  { wet: 0.0,  rate: 0.6,  depth: 0.0,    baseDelay: 0.015 }, // 0: Apagado
  { wet: 0.30, rate: 0.65, depth: 0.0022, baseDelay: 0.014 }, // 1: Chorus suave
  { wet: 0.50, rate: 0.95, depth: 0.0042, baseDelay: 0.018 }, // 2: Chorus estéreo medio
  { wet: 0.72, rate: 1.35, depth: 0.0065, baseDelay: 0.022 }  // 3: Chorus doble voz ancho
];

export function isDemoRecording() {
  return isRecording;
}

export function getCurrentDemoSession() {
  return currentSession;
}

export function formatElapsedTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatPreciseTime(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const m = Math.floor(safe / 60);
  const rem = safe - m * 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}.${tenths}`;
}

function makeFilename(ext = 'wav') {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `orbita-maqueta-${stamp}.${ext}`;
}

function concatFloat32Chunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function applyVoiceGate(samples, sampleRate, threshold) {
  const attack = 1 - Math.exp(-1 / (0.003 * sampleRate));
  const envelopeDecay = 1 - Math.exp(-1 / (0.012 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.055 * sampleRate));
  const floorGain = 0.12;
  let power = 0;
  let gain = floorGain;
  for (let i = 0; i < samples.length; i++) {
    const squared = samples[i] ** 2;
    power += (squared - power) * (squared > power ? attack : envelopeDecay);
    const open = Math.min(1, Math.max(0, Math.sqrt(power) / threshold - 0.5));
    const target = floorGain + (1 - floorGain) * open * open * (3 - 2 * open);
    gain += (target - gain) * (target > gain ? attack : release);
    samples[i] *= gain;
  }
}

function setCameraLivePreview(stream) {
  const pip = document.getElementById('camera-live-pip');
  const video = document.getElementById('camera-live-video');
  video.srcObject = stream;
  pip.hidden = !stream;
}

function computeWaveformPeaks(channelData, bins = 220) {
  const peaks = new Float32Array(bins);
  if (!channelData || channelData.length === 0) return peaks;
  const step = Math.max(1, Math.floor(channelData.length / bins));
  for (let b = 0; b < bins; b++) {
    const start = b * step;
    const end = Math.min(channelData.length, start + step);
    let maxVal = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(channelData[i]);
      if (a > maxVal) maxVal = a;
    }
    peaks[b] = maxVal;
  }
  return peaks;
}

function encodeAudioBufferToWavBlob(audioBuffer) {
  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const chL = audioBuffer.getChannelData(0);
  const chR = numChannels > 1 ? audioBuffer.getChannelData(1) : chL;

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sL = Math.max(-1, Math.min(1, chL[i]));
    view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
    offset += 2;
    if (numChannels > 1) {
      const sR = Math.max(-1, Math.min(1, chR[i]));
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Codifica un AudioBuffer estéreo a MP3 real (192 kbps, MPEG-1 Layer III) usando lamejs local.
 */
function encodeAudioBufferToMp3Blob(audioBuffer, kbps = 192) {
  const lame = window.lamejs;
  if (!lame || typeof lame.Mp3Encoder !== 'function') {
    return null;
  }

  const numChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const encoder = new lame.Mp3Encoder(numChannels, sampleRate, kbps);

  const chL = audioBuffer.getChannelData(0);
  const chR = numChannels > 1 ? audioBuffer.getChannelData(1) : chL;

  const blockSize = 1152;
  const leftInt16 = new Int16Array(blockSize);
  const rightInt16 = new Int16Array(blockSize);
  const mp3Parts = [];

  for (let i = 0; i < length; i += blockSize) {
    const count = Math.min(blockSize, length - i);
    const lSlice = count === blockSize ? leftInt16 : new Int16Array(count);
    const rSlice = count === blockSize ? rightInt16 : new Int16Array(count);

    for (let j = 0; j < count; j++) {
      const sL = Math.max(-1, Math.min(1, chL[i + j]));
      const sR = Math.max(-1, Math.min(1, chR[i + j]));
      lSlice[j] = sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7FFF);
      rSlice[j] = sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7FFF);
    }

    const encoded = numChannels > 1
      ? encoder.encodeBuffer(lSlice, rSlice)
      : encoder.encodeBuffer(lSlice);

    if (encoded && encoded.length > 0) {
      mp3Parts.push(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
    }
  }

  const tail = encoder.flush();
  if (tail && tail.length > 0) {
    mp3Parts.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.byteLength));
  }

  return new Blob(mp3Parts, { type: 'audio/mpeg' });
}

/**
 * Construye el grafo de mezcla de 2 pistas (Música + Voz con Chorus 0-3 y Eco 0-3).
 * Se usa de forma IDÉNTICA tanto para la preescucha en tiempo real como para el render offline .WAV.
 */
function buildTwoTrackMixGraph(ctx, destNode, settings) {
  const now = ctx.currentTime;

  const masterLimiter = ctx.createDynamicsCompressor();
  masterLimiter.threshold.setValueAtTime(-4, now);
  masterLimiter.knee.setValueAtTime(10, now);
  masterLimiter.ratio.setValueAtTime(5, now);
  masterLimiter.attack.setValueAtTime(0.004, now);
  masterLimiter.release.setValueAtTime(0.16, now);
  masterLimiter.connect(destNode);

  // PISTA 1: Música
  const musicGain = ctx.createGain();
  musicGain.gain.setValueAtTime(safeParam(settings.musicVol ?? 0.90, 0, 2.0), now);
  musicGain.connect(masterLimiter);

  // PISTA 2: Voz + Cadena de FX (Chorus estéreo + Eco cálido)
  const voiceInputGain = ctx.createGain();
  voiceInputGain.gain.setValueAtTime(safeParam(settings.voiceVol ?? 1.15, 0, 2.5), now);

  // --- CHORUS ESTÉREO (0..3) ---
  const chCfg = CHORUS_PRESETS[Math.max(0, Math.min(3, settings.voiceChorus || 0))];
  const chorusDry = ctx.createGain();
  chorusDry.gain.setValueAtTime(1.0, now);

  const chorusWet = ctx.createGain();
  chorusWet.gain.setValueAtTime(chCfg.wet, now);

  const chorusDelayL = ctx.createDelay(0.1);
  const chorusDelayR = ctx.createDelay(0.1);
  chorusDelayL.delayTime.setValueAtTime(chCfg.baseDelay, now);
  chorusDelayR.delayTime.setValueAtTime(chCfg.baseDelay + 0.004, now);

  const lfoL = ctx.createOscillator();
  const lfoR = ctx.createOscillator();
  lfoL.type = 'sine';
  lfoR.type = 'sine';
  lfoL.frequency.setValueAtTime(chCfg.rate, now);
  lfoR.frequency.setValueAtTime(chCfg.rate * 1.13, now);

  const lfoDepthL = ctx.createGain();
  const lfoDepthR = ctx.createGain();
  lfoDepthL.gain.setValueAtTime(chCfg.depth, now);
  lfoDepthR.gain.setValueAtTime(-chCfg.depth, now); // Contrafase estéreo

  lfoL.connect(lfoDepthL);
  lfoDepthL.connect(chorusDelayL.delayTime);
  lfoR.connect(lfoDepthR);
  lfoDepthR.connect(chorusDelayR.delayTime);

  const chorusMerger = ctx.createChannelMerger(2);
  voiceInputGain.connect(chorusDelayL);
  voiceInputGain.connect(chorusDelayR);
  chorusDelayL.connect(chorusMerger, 0, 0);
  chorusDelayR.connect(chorusMerger, 0, 1);
  chorusMerger.connect(chorusWet);

  const postChorusSum = ctx.createGain();
  postChorusSum.gain.setValueAtTime(1.0, now);
  voiceInputGain.connect(chorusDry);
  chorusDry.connect(postChorusSum);
  chorusWet.connect(postChorusSum);

  // --- ECO / DELAY CÁLIDO (0..3) ---
  const ecCfg = ECHO_PRESETS[Math.max(0, Math.min(3, settings.voiceEcho || 0))];
  const echoDelay = ctx.createDelay(1.2);
  echoDelay.delayTime.setValueAtTime(ecCfg.delay, now);

  const echoFeedback = ctx.createGain();
  echoFeedback.gain.setValueAtTime(ecCfg.feedback, now);

  const echoFilter = ctx.createBiquadFilter();
  echoFilter.type = 'lowpass';
  echoFilter.frequency.setValueAtTime(ecCfg.filterHz, now);

  const echoWet = ctx.createGain();
  echoWet.gain.setValueAtTime(ecCfg.wet, now);

  postChorusSum.connect(masterLimiter); // Ruta directa (seca + chorus)
  postChorusSum.connect(echoDelay);
  echoDelay.connect(echoFilter);
  echoFilter.connect(echoFeedback);
  echoFeedback.connect(echoDelay);
  echoFilter.connect(echoWet);
  echoWet.connect(masterLimiter);

  lfoL.start(now);
  lfoR.start(now);

  return {
    musicGain,
    voiceInputGain,
    updateParams(newSettings) {
      const t = ctx.currentTime;
      musicGain.gain.setTargetAtTime(safeParam(newSettings.musicVol ?? 0.90, 0, 2.0), t, 0.02);
      voiceInputGain.gain.setTargetAtTime(safeParam(newSettings.voiceVol ?? 1.15, 0, 2.5), t, 0.02);

      const c = CHORUS_PRESETS[Math.max(0, Math.min(3, newSettings.voiceChorus || 0))];
      chorusWet.gain.setTargetAtTime(c.wet, t, 0.03);
      chorusDelayL.delayTime.setTargetAtTime(c.baseDelay, t, 0.03);
      chorusDelayR.delayTime.setTargetAtTime(c.baseDelay + 0.004, t, 0.03);
      lfoL.frequency.setTargetAtTime(c.rate, t, 0.03);
      lfoR.frequency.setTargetAtTime(c.rate * 1.13, t, 0.03);
      lfoDepthL.gain.setTargetAtTime(c.depth, t, 0.03);
      lfoDepthR.gain.setTargetAtTime(-c.depth, t, 0.03);

      const e = ECHO_PRESETS[Math.max(0, Math.min(3, newSettings.voiceEcho || 0))];
      echoWet.gain.setTargetAtTime(e.wet, t, 0.03);
      echoDelay.delayTime.setTargetAtTime(e.delay, t, 0.04);
      echoFeedback.gain.setTargetAtTime(e.feedback, t, 0.03);
      echoFilter.frequency.setTargetAtTime(e.filterHz, t, 0.03);
    },
    stopLfos(atTime) {
      try { lfoL.stop(atTime); } catch (_) {}
      try { lfoR.stop(atTime); } catch (_) {}
    }
  };
}

/**
 * Arranca la grabación de maqueta multipista (Pista 1: Música Estéreo, Pista 2: Voz Micrófono)
 */
export async function startDemoRecording(onStatusUpdate) {
  if (isRecording) return { ok: true };
  stopDemoPreviewPlayback();
  statusCallback = onStatusUpdate || null;

  const ctx = ensureAudioUnlocked();
  const masterNode = getMasterOutputNode();
  const { micFilterLevel, cameraEnabled, rootSemitone, notation, scaleMode, lang, bpm } = getState();
  const { highpassHz, gateThreshold, ...audioConstraints } = getMicFilterConfig(micFilterLevel);
  micGateThreshold = gateThreshold;
  cameraRequested = cameraEnabled;
  const modeLabel = scaleMode === 'custom' ? t('custom.title', lang) : scaleMode;
  videoMetadata = {
    keyLabel: `${getNoteNameUpper(rootSemitone, notation)} ${modeLabel}`,
    soundName: getActivePreset().name,
    bpm
  };

  rawMusicL = [];
  rawMusicR = [];
  rawVoice = [];
  fallbackChunks = [];
  hasMicActive = false;
  micWarningReason = '';

  // 1. Tap estéreo de la música interna de ÓRBITA
  musicTapGain = ctx.createGain();
  musicTapGain.gain.setValueAtTime(1.0, ctx.currentTime);
  musicSplitter = ctx.createChannelSplitter(2);
  masterNode.connect(musicTapGain);
  musicTapGain.connect(musicSplitter);

  // 2. Nivel 0 conserva la captura musical cruda. Los niveles superiores son optativos.
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      micSource = ctx.createMediaStreamSource(micStream);
      micHighpass = ctx.createBiquadFilter();
      micHighpass.type = 'highpass';
      micHighpass.frequency.setValueAtTime(highpassHz, ctx.currentTime);

      micGain = ctx.createGain();
      micGain.gain.setValueAtTime(1.15, ctx.currentTime);

      micSource.connect(micHighpass);
      micHighpass.connect(micGain);
      hasMicActive = true;

      // Medir latencia hardware real de salida (AudioContext) + entrada (MediaStreamTrack) sin retardo extra de AEC
      const outLatSec = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      const trackSettings = micStream.getAudioTracks()[0]?.getSettings?.() || {};
      const inLatSec = typeof trackSettings.latency === 'number' ? trackSettings.latency : 0;
      const rawRoundTripMs = Math.round((outLatSec + inLatSec) * 1000);
      detectedRoundTripMs = Math.max(35, Math.min(300, rawRoundTripMs < 35 ? 60 : rawRoundTripMs));
    } catch (err) {
      hasMicActive = false;
      micWarningReason = err?.name === 'NotAllowedError'
        ? 'Permiso de micrófono denegado (solo pista de música).'
        : 'Micrófono no disponible (solo pista de música).';
    }
  } else {
    hasMicActive = false;
    micWarningReason = 'Sin HTTPS para micrófono (solo pista de música).';
  }

  cameraCapture = cameraRequested ? await prepareFrontCamera() : null;

  // 3. Conectar los 3 canales sincronizados al AudioWorklet multipista
  if (ctx.audioWorklet) {
    try {
      if (!workletLoaded) {
        const blob = new Blob([MULTITRACK_WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        workletLoaded = true;
      }

      mergerNode = ctx.createChannelMerger(3);
      musicSplitter.connect(mergerNode, 0, 0);
      musicSplitter.connect(mergerNode, 1, 1);
      if (hasMicActive && micGain) {
        micGain.connect(mergerNode, 0, 2);
      }

      workletNode = new AudioWorkletNode(ctx, 'orbita-multitrack-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 3,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete'
      });

      workletNode.port.onmessage = (e) => {
        if (!isRecording) return;
        rawMusicL.push(e.data.mL);
        rawMusicR.push(e.data.mR);
        if (hasMicActive && e.data.vM) {
          rawVoice.push(e.data.vM);
        }
      };

      silentSink = ctx.createGain();
      silentSink.gain.setValueAtTime(0.0, ctx.currentTime);
      mergerNode.connect(workletNode);
      workletNode.connect(silentSink);
      silentSink.connect(ctx.destination);
    } catch (_) {
      workletNode = null;
    }
  }

  // Fallback si no hubo AudioWorklet (HTTP plano en red local sin HTTPS)
  if (!workletNode && typeof ctx.createMediaStreamDestination === 'function' && typeof MediaRecorder !== 'undefined') {
    try {
      fallbackDest = ctx.createMediaStreamDestination();
      musicTapGain.connect(fallbackDest);
      if (hasMicActive && micGain) micGain.connect(fallbackDest);
      fallbackRecorder = new MediaRecorder(fallbackDest.stream);
      fallbackRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) fallbackChunks.push(ev.data);
      };
      fallbackRecorder.start(250);
    } catch (_) {
      fallbackRecorder = null;
    }
  }

  if (cameraCapture && !cameraCapture.start()) cameraCapture = null;
  if (cameraCapture) setCameraLivePreview(cameraCapture.stream);
  isRecording = true;
  startTimestamp = performance.now();

  if (statusCallback) {
    statusCallback({ recording: true, elapsedSec: 0, hasMic: hasMicActive, micWarning: micWarningReason });
  }

  timerInterval = setInterval(() => {
    if (!isRecording) return;
    const elapsedSec = (performance.now() - startTimestamp) / 1000;
    if (statusCallback) {
      statusCallback({ recording: true, elapsedSec, hasMic: hasMicActive, micWarning: micWarningReason });
    }
  }, 250);

  return { ok: true, hasMic: hasMicActive, micWarning: micWarningReason };
}

/**
 * Detiene la grabación, PARA LA BATERÍA Y EL LOOPER para escuchar en silencio,
 * libera el micrófono y construye la sesión multipista de 2 pistas listas para mezclar y recortar.
 */
export async function stopDemoRecording() {
  if (!isRecording) return null;
  isRecording = false;
  const cameraResult = cameraCapture?.stop();
  cameraCapture = null;
  setCameraLivePreview(null);

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Detener automáticamente batería y looper al terminar de grabar la maqueta
  stopAllTransportForPlayback();

  const ctx = ensureAudioUnlocked();
  const sampleRate = ctx.sampleRate;

  let fallbackBlob = null;
  if (fallbackRecorder && fallbackRecorder.state !== 'inactive') {
    fallbackBlob = await new Promise((resolve) => {
      fallbackRecorder.onstop = () => {
        resolve(fallbackChunks.length > 0 ? new Blob(fallbackChunks) : null);
      };
      try { fallbackRecorder.stop(); } catch (_) { resolve(null); }
    });
  }

  // Desconectar nodos y cerrar micrófono
  const safeDisc = (n) => { try { if (n) n.disconnect(); } catch (_) {} };
  safeDisc(musicTapGain);
  safeDisc(musicSplitter);
  safeDisc(micSource);
  safeDisc(micHighpass);
  safeDisc(micGain);
  safeDisc(mergerNode);
  safeDisc(workletNode);
  safeDisc(silentSink);

  if (micStream) {
    micStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
    micStream = null;
  }

  musicTapGain = null;
  musicSplitter = null;
  micSource = null;
  micHighpass = null;
  micGain = null;
  mergerNode = null;
  workletNode = null;
  silentSink = null;
  fallbackDest = null;
  fallbackRecorder = null;

  if (statusCallback) {
    statusCallback({ recording: false, elapsedSec: 0, hasMic: hasMicActive, micWarning: micWarningReason });
  }

  let musicBuffer = null;
  let voiceBuffer = null;

  if (rawMusicL.length > 0) {
    const mL = concatFloat32Chunks(rawMusicL);
    const mR = concatFloat32Chunks(rawMusicR);
    musicBuffer = ctx.createBuffer(2, mL.length, sampleRate);
    musicBuffer.copyToChannel(mL, 0);
    musicBuffer.copyToChannel(mR, 1);

    if (hasMicActive && rawVoice.length > 0) {
      const vM = concatFloat32Chunks(rawVoice);
      const vLen = Math.min(vM.length, mL.length);
      voiceBuffer = ctx.createBuffer(1, vLen, sampleRate);
      voiceBuffer.copyToChannel(vM.subarray(0, vLen), 0);
    }
  } else if (fallbackBlob) {
    try {
      const ab = await fallbackBlob.arrayBuffer();
      musicBuffer = await ctx.decodeAudioData(ab);
    } catch (_) {}
  }

  rawMusicL = [];
  rawMusicR = [];
  rawVoice = [];
  fallbackChunks = [];

  const cameraBlob = await cameraResult;
  if (!musicBuffer) return null;

  const durationSec = musicBuffer.duration;
  const musicPeaks = computeWaveformPeaks(musicBuffer.getChannelData(0), 220);

  // Estimar el desfase óptimo automáticamente:
  // 1) Correlación cruzada de envolventes (detecta filtración acústica o pulsos rítmicos entre 40 ms y 320 ms)
  // 2) Combinado con la latencia hardware medida (`detectedRoundTripMs`)
  const autoMeasuredOffsetMs = estimateVoiceSyncOffsetMs(musicBuffer, voiceBuffer, detectedRoundTripMs);
  const voiceSamples = voiceBuffer?.getChannelData(0);
  if (voiceSamples && micGateThreshold > 0) applyVoiceGate(voiceSamples, sampleRate, micGateThreshold);
  const voicePeaks = voiceSamples ? computeWaveformPeaks(voiceSamples, 220) : null;

  currentSession = {
    sampleRate,
    durationSec,
    musicBuffer,
    voiceBuffer,
    musicPeaks,
    voicePeaks,
    hasVoiceTrack: Boolean(voiceBuffer),
    micWarning: micWarningReason,
    cameraBlob,
    cameraUnavailable: cameraRequested && !cameraBlob,
    videoMetadata,
    detectedRoundTripMs,
    autoMeasuredOffsetMs
  };

  return currentSession;
}

/**
 * Estima la latencia acústica/hardware entre la pista de Música y la de Voz (en ms negativos,
 * es decir, cuánto adelantar la Voz para alinearla exactamente con la Música).
 */
export function estimateVoiceSyncOffsetMs(musicBuffer, voiceBuffer, fallbackRoundTripMs = 110) {
  if (!musicBuffer || !voiceBuffer || musicBuffer.duration < 0.8) {
    return -Math.round(fallbackRoundTripMs);
  }

  // Envolvente de energía a 250 Hz (1 bin = 4 ms) sobre los primeros 8 segundos
  const sr = musicBuffer.sampleRate;
  const binSamples = Math.max(1, Math.floor(sr * 0.004));
  const maxSamples = Math.min(musicBuffer.length, voiceBuffer.length, Math.floor(sr * 8));
  const numBins = Math.floor(maxSamples / binSamples);
  if (numBins < 120) return -Math.round(fallbackRoundTripMs);

  const mData = musicBuffer.getChannelData(0);
  const vData = voiceBuffer.getChannelData(0);
  const mEnv = new Float32Array(numBins);
  const vEnv = new Float32Array(numBins);

  let mMean = 0;
  let vMean = 0;
  for (let b = 0; b < numBins; b++) {
    let mSum = 0;
    let vSum = 0;
    const base = b * binSamples;
    for (let i = 0; i < binSamples; i++) {
      mSum += Math.abs(mData[base + i]);
      vSum += Math.abs(vData[base + i]);
    }
    mEnv[b] = mSum / binSamples;
    vEnv[b] = vSum / binSamples;
    mMean += mEnv[b];
    vMean += vEnv[b];
  }
  mMean /= numBins;
  vMean /= numBins;

  // Diferencia de ataque (onset flux) para que los golpes de batería y sílabas cantadas destaquen con claridad
  const mFlux = new Float32Array(numBins);
  const vFlux = new Float32Array(numBins);
  for (let b = 1; b < numBins; b++) {
    mFlux[b] = Math.max(0, mEnv[b] - mEnv[b - 1]);
    vFlux[b] = Math.max(0, vEnv[b] - vEnv[b - 1]);
  }

  // Buscar lag óptimo entre +40 ms (10 bins) y +340 ms (85 bins) donde la Voz llega después de la Música
  const minLag = 10;
  const maxLag = Math.min(85, Math.floor(numBins / 3));
  let bestLag = Math.round(fallbackRoundTripMs / 4);
  let bestCorr = -Infinity;
  let avgCorr = 0;
  let countLags = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let mNorm = 0;
    let vNorm = 0;
    for (let b = 1; b < numBins - lag; b++) {
      const a = mFlux[b];
      const c = vFlux[b + lag];
      dot += a * c;
      mNorm += a * a;
      vNorm += c * c;
    }
    const denom = Math.sqrt(mNorm * vNorm) + 1e-9;
    const corr = dot / denom;
    avgCorr += corr;
    countLags++;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  avgCorr /= Math.max(1, countLags);
  // Si el pico de correlación destaca claramente sobre el promedio (confianza > 1.35x), usar ese lag exacto
  if (bestCorr > 0.14 && bestCorr > avgCorr * 1.35) {
    return -(bestLag * 4);
  }
  return -Math.round(fallbackRoundTripMs);
}

/**
 * Helper común para arrancar una pista de Voz sincronizada con compensación `voiceOffsetMs`
 * (negativo = adelantar la Voz para compensar la latencia de grabación).
 */
function scheduleSyncedVoiceSource(ctx, voiceBuffer, destNode, startAtAudioTime, trimStart, playDur, voiceOffsetMs) {
  const shiftSec = (Number(voiceOffsetMs) || 0) / 1000;
  // Si shiftSec = -0.120s (voz llegó 120ms tarde), empezamos a leer voiceBuffer 120ms más adelante (trimStart + 0.120)
  const rawVoiceReadPos = trimStart - shiftSec;

  const vSrc = ctx.createBufferSource();
  vSrc.buffer = voiceBuffer;
  vSrc.connect(destNode);

  if (rawVoiceReadPos >= 0) {
    if (rawVoiceReadPos < voiceBuffer.duration - 0.01) {
      const availDur = Math.min(playDur, voiceBuffer.duration - rawVoiceReadPos);
      if (availDur > 0.01) {
        vSrc.start(startAtAudioTime, rawVoiceReadPos, availDur);
      }
    }
  } else {
    // shiftSec positivo: retrasar ligeramente el inicio de la voz
    const delayStart = -rawVoiceReadPos;
    const availDur = Math.min(playDur - delayStart, voiceBuffer.duration);
    if (availDur > 0.01) {
      vSrc.start(startAtAudioTime + delayStart, 0, availDur);
    }
  }
  return vSrc;
}

/**
 * Reproduce en tiempo real la mezcla de las 2 pistas recortadas (trimStart -> trimEnd)
 * con Volumen Música, Volumen Voz, Eco (0-3) y Chorus (0-3) modificables EN VIVO.
 */
export function isDemoPreviewPlaying() {
  return Boolean(previewState && previewState.playing);
}

export function stopDemoPreviewPlayback() {
  if (!previewState) return;
  const st = previewState;
  previewState = null;

  if (st.rafId) cancelAnimationFrame(st.rafId);
  const ctx = ensureAudioUnlocked();
  const now = ctx.currentTime;

  try { if (st.musicSrc) st.musicSrc.stop(now); } catch (_) {}
  try { if (st.voiceSrc) st.voiceSrc.stop(now); } catch (_) {}
  try { if (st.graph) st.graph.stopLfos(now); } catch (_) {}

  if (st.onEnded) st.onEnded();
}

export function updateLivePreviewMix(settings) {
  if (previewState && previewState.playing && previewState.graph) {
    previewState.graph.updateParams(settings);
  }
}

export function startDemoPreviewPlayback(settings, onProgress, onEnded) {
  stopDemoPreviewPlayback();
  if (!currentSession || !currentSession.musicBuffer) return false;

  const ctx = ensureAudioUnlocked();
  const now = ctx.currentTime + 0.02;

  const trimStart = Math.max(0, Math.min(currentSession.durationSec - 0.1, settings.trimStartSec || 0));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(currentSession.durationSec, settings.trimEndSec || currentSession.durationSec));
  const playDur = trimEnd - trimStart;

  const graph = buildTwoTrackMixGraph(ctx, ctx.destination, settings);

  const musicSrc = ctx.createBufferSource();
  musicSrc.buffer = currentSession.musicBuffer;
  musicSrc.connect(graph.musicGain);
  musicSrc.start(now, trimStart, playDur);

  let voiceSrc = null;
  if (currentSession.voiceBuffer) {
    voiceSrc = scheduleSyncedVoiceSource(
      ctx,
      currentSession.voiceBuffer,
      graph.voiceInputGain,
      now,
      trimStart,
      playDur,
      settings.voiceOffsetMs || 0
    );
  }

  // Si hay eco activo en voz, dejar sonar la cola del eco ~0.6s al terminar el recorte
  const tailSec = (settings.voiceEcho || 0) > 0 ? 0.65 : 0.08;
  const stopAt = now + playDur + tailSec;

  const localState = {
    playing: true,
    graph,
    musicSrc,
    voiceSrc,
    rafId: null,
    onEnded
  };
  previewState = localState;

  const tick = () => {
    if (previewState !== localState || !localState.playing) return;
    const elapsed = ctx.currentTime - now;
    if (elapsed >= playDur + tailSec) {
      stopDemoPreviewPlayback();
      return;
    }
    if (onProgress) {
      const clampedPos = trimStart + Math.min(playDur, Math.max(0, elapsed));
      onProgress(clampedPos);
    }
    localState.rafId = requestAnimationFrame(tick);
  };
  localState.rafId = requestAnimationFrame(tick);

  graph.stopLfos(stopAt + 0.05);
  return true;
}

/**
 * Renderiza offline la mezcla recortada para la exportación de audio y de vídeo.
 */
export async function renderFinalMixBuffer(settings) {
  if (!currentSession || !currentSession.musicBuffer) return null;

  const sr = currentSession.sampleRate;
  const trimStart = Math.max(0, Math.min(currentSession.durationSec - 0.1, settings.trimStartSec || 0));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(currentSession.durationSec, settings.trimEndSec || currentSession.durationSec));
  const trimmedDur = trimEnd - trimStart;
  const tailSec = (settings.voiceEcho || 0) > 0 ? 0.85 : 0.05;
  const totalFrames = Math.ceil((trimmedDur + tailSec) * sr);

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offCtx = new OfflineCtx(2, totalFrames, sr);

  // Envolvente anti-clic de 12 ms en los bordes del recorte
  const fadeGain = offCtx.createGain();
  fadeGain.gain.setValueAtTime(0.0001, 0);
  fadeGain.gain.linearRampToValueAtTime(1.0, Math.min(0.012, trimmedDur * 0.1));
  fadeGain.gain.setValueAtTime(1.0, Math.max(0.012, trimmedDur - 0.015));
  fadeGain.gain.linearRampToValueAtTime(0.0001, trimmedDur + tailSec);
  fadeGain.connect(offCtx.destination);

  const graph = buildTwoTrackMixGraph(offCtx, fadeGain, settings);

  const mSrc = offCtx.createBufferSource();
  mSrc.buffer = currentSession.musicBuffer;
  mSrc.connect(graph.musicGain);
  mSrc.start(0, trimStart, trimmedDur);

  if (currentSession.voiceBuffer) {
    scheduleSyncedVoiceSource(
      offCtx,
      currentSession.voiceBuffer,
      graph.voiceInputGain,
      0,
      trimStart,
      trimmedDur,
      settings.voiceOffsetMs || 0
    );
  }

  const audio = await offCtx.startRendering();
  return { audio, trimStart, trimmedDur };
}

export async function renderFinalMixWav(settings) {
  const mix = await renderFinalMixBuffer(settings);
  if (!mix) return null;
  const { audio: renderedBuffer, trimmedDur } = mix;
  const mp3Blob = encodeAudioBufferToMp3Blob(renderedBuffer, 192);

  if (mp3Blob) {
    return {
      blob: mp3Blob,
      mimeType: 'audio/mpeg',
      ext: 'mp3',
      filename: makeFilename('mp3'),
      sizeKB: Math.max(1, Math.round(mp3Blob.size / 1024)),
      durationSec: trimmedDur
    };
  }

  // Respaldo automático a WAV solo si el codificador MP3 no estuviera disponible
  const wavBlob = encodeAudioBufferToWavBlob(renderedBuffer);
  return {
    blob: wavBlob,
    mimeType: 'audio/wav',
    ext: 'wav',
    filename: makeFilename('wav'),
    sizeKB: Math.max(1, Math.round(wavBlob.size / 1024)),
    durationSec: trimmedDur
  };
}
