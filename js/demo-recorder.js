/**
 * demo-recorder.js — Estudio Multipista de Maquetas (2 Pistas Sincronizadas: Música + Voz)
 * - Captura simultánea sample-accurate vía AudioWorklet de 3 canales:
 *   Canal 0/1 = Música estéreo de ÓRBITA | Canal 2 = Micrófono crudo
 * - Detiene automáticamente la batería y el looper al parar la grabación para escuchar en silencio
 * - Mezclador en tiempo real y renderizado offline (.WAV 16-bit estéreo):
 *   · Volumen Música (0–150%) y Volumen Voz (0–180%)
 *   · Eco en Voz (0 a 3 niveles) y Chorus estéreo en Voz (0 a 3 niveles)
 *   · Recorte de Inicio y Final (Trim Start / End) con forma de onda de 2 pistas
 */

import { ensureAudioUnlocked, getAudioContext, getMasterOutputNode, safeParam, triggerMetronomeClick } from './audio-core.js';
import { getArmedTransportSnapshot, getTransportSnapshot, startArmedTransportAt, stopAllTransportForPlayback } from './clock-looper.js';
import { t } from './i18n.js';
import { getState, setState } from './state.js';
import { prepareFrontCamera } from './short-video.js';
import { getActivePreset, setNoteEventObserver } from './synth-presets.js';
import { formatChordLabel, getDiatonicDegrees, getNoteNameTitle, getNoteNameUpper } from './theory.js';

const VOICE_FILTER_PRESETS = [
  { highpassHz: 40, deMudDb: 0, presenceDb: 0, lowpassHz: 20000, gateThreshold: 0, gateFloor: 1.0, musicDuckAmt: 0 },
  { highpassHz: 95, deMudDb: -2.0, presenceDb: 1.2, lowpassHz: 15000, gateThreshold: 0.008, gateFloor: 0.45, musicDuckAmt: 0.25 },
  { highpassHz: 130, deMudDb: -3.5, presenceDb: 2.5, lowpassHz: 12000, gateThreshold: 0.015, gateFloor: 0.20, musicDuckAmt: 0.55 },
  { highpassHz: 165, deMudDb: -5.0, presenceDb: 3.5, lowpassHz: 9500, gateThreshold: 0.024, gateFloor: 0.06, musicDuckAmt: 0.85 }
];

export function getVoiceFilterPreset(level) {
  const preset = Number.isInteger(level) ? VOICE_FILTER_PRESETS[level] : null;
  return { ...(preset ?? VOICE_FILTER_PRESETS[0]) };
}

let isRecording = false;
let isCaptureBusy = false;
let isCountingIn = false;
const countInTimers = new Set();
const countInClicks = [];
let timerInterval = null;
let statusCallback = null;
let cameraCapture = null;
let cameraRequested = false;
let videoMetadata = null;
let recordedNoteEvents = [];
let keyboardDegrees = [];
let recordingStartAudioTime = null;
let firstCapturedFrame = null;

// Nodos de grabación multipista
let musicSplitter = null;
let musicTapGain = null;
let micStream = null;
let micSource = null;
let micHighpass = null;
let mergerNode = null;
let workletNode = null;
let workletLoaded = false;
let silentSink = null;
let scriptProcessor = null;
let scriptCaptureGate = null;

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
let filteredVoice = null;

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
          frame: currentFrame,
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

export function isDemoCountIn() {
  return isCountingIn;
}

export function isDemoRecordingOrCountIn() {
  return isRecording || isCountingIn;
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
  const tenths = Math.floor(safe * 10 + 1e-9);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor(tenths / 10) % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
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

export function buildFilteredVoiceSamples(rawVoiceSamples, musicSamples, sampleRate, level, voiceOffsetMs = 0) {
  const { gateThreshold, gateFloor, musicDuckAmt } = getVoiceFilterPreset(level);
  if (!gateThreshold) return rawVoiceSamples.slice();

  const samples = new Float32Array(rawVoiceSamples.length);
  const attack = 1 - Math.exp(-1 / (0.006 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.090 * sampleRate));
  const detector = 1 - Math.exp(-1 / (0.008 * sampleRate));
  const shift = Math.round(voiceOffsetMs * sampleRate / 1000);
  let voicePower = 0;
  let musicPower = 0;
  let gain = gateFloor;
  for (let i = 0; i < rawVoiceSamples.length; i++) {
    const voice = rawVoiceSamples[i];
    const music = musicSamples?.[i + shift] ?? 0;
    voicePower += (voice * voice - voicePower) * detector;
    musicPower += (music * music - musicPower) * detector;
    const musicRms = Math.sqrt(musicPower);
    // Elevar el umbral con la música alineada, limitándolo para conservar las frases suaves.
    const leakage = Math.min(2 * gateThreshold, 0.22 * musicRms) * musicDuckAmt;
    const ratio = (Math.sqrt(voicePower) - leakage) / gateThreshold;
    const open = Math.max(0, Math.min(1, ratio - 0.65));
    const vocalActivity = open * open * (3 - 2 * open);
    const musicActivity = musicRms / (musicRms + 0.045);
    const quietGain = gateFloor * (1 - musicDuckAmt * musicActivity);
    const target = quietGain + (1 - quietGain) * vocalActivity;
    gain += (target - gain) * (target > gain ? attack : release);
    samples[i] = voice * gain;
  }
  return samples;
}

function getKeyboardDegrees(state) {
  const { rootSemitone, scaleMode, octaveOffset, customScale, notation } = state;
  return getDiatonicDegrees(rootSemitone, scaleMode, octaveOffset, customScale, notation);
}

const pitchClass = midi => ((midi % 12) + 12) % 12;

function recordNoteEvent({ notes, when, duration, velocity }) {
  if (!isDemoRecordingOrCountIn() || when < recordingStartAudioTime) return;
  const state = getState();
  const degrees = getKeyboardDegrees(state);
  const pitchClasses = [...new Set(notes.map(pitchClass))];
  const matchingChord = pitchClasses.length >= 3 && degrees.find(degree =>
    degree.triadMidi.every(note => pitchClasses.includes(pitchClass(note)))
    && pitchClasses.every(pc => degree.triadMidi.some(note => pitchClass(note) === pc)
      || pc === pitchClass(degree.seventhMidi))
  );
  const rootPc = matchingChord ? matchingChord.pitchClass : pitchClass(Math.min(...notes));
  const degree = matchingChord || degrees.find(entry => entry.pitchClass === rootPc);
  const intervals = pitchClasses.map(pc => pitchClass(pc - rootPc));
  const isChord = intervals.includes(3) || intervals.includes(4);
  const quality = intervals.includes(3) && !intervals.includes(4) ? 'm' : 'M';
  const seventh = isChord && intervals.includes(10) ? '7' : isChord && intervals.includes(11) ? 'maj7' : '';
  const label = isChord
    ? formatChordLabel(rootPc, quality, state.notation) + seventh
    : getNoteNameTitle(rootPc, state.notation);
  const event = {
    when, notes, pitchClasses, rootPc, label, degreeIndex: degree?.degreeIndex ?? null,
    durationSec: duration, velocity, cancelled: false
  };
  recordedNoteEvents.push(event);
  return () => { event.cancelled = true; };
}

function captureSamples(frame, musicL, musicR, voice) {
  firstCapturedFrame ??= frame;
  rawMusicL.push(musicL);
  rawMusicR.push(musicR);
  if (hasMicActive && voice) rawVoice.push(voice);
}

function setCameraLivePreview(stream) {
  if (typeof document === 'undefined') return;
  const pip = document.getElementById('camera-live-pip');
  const video = document.getElementById('camera-live-video');
  if (video) video.srcObject = stream;
  if (pip) pip.hidden = !stream;
}

function computeWaveformPeaks(channelData, bins = 220) {
  const peaks = new Float32Array(bins);
  if (!channelData || channelData.length === 0) return peaks;
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * channelData.length / bins);
    const end = Math.floor((b + 1) * channelData.length / bins);
    let maxVal = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(channelData[i]);
      if (a > maxVal) maxVal = a;
    }
    peaks[b] = maxVal;
  }
  return peaks;
}

function getStudioVoice(settings) {
  if (!currentSession?.voiceBuffer) return null;
  if (!getVoiceFilterPreset(settings.voiceFilter).gateThreshold) {
    return { buffer: currentSession.voiceBuffer, peaks: currentSession.voicePeaks };
  }
  const { voiceFilter: level, voiceOffsetMs = 0 } = settings;
  if (filteredVoice?.level === level && filteredVoice.voiceOffsetMs === voiceOffsetMs) return filteredVoice;

  const { voiceBuffer, musicBuffer } = currentSession;
  const musicL = musicBuffer.getChannelData(0);
  let music = musicL;
  if (musicBuffer.numberOfChannels > 1) {
    const musicR = musicBuffer.getChannelData(1);
    // Tomar el canal dominante por muestra para detectar también señales estéreo en contrafase.
    music = musicL.map((left, i) => Math.max(Math.abs(left), Math.abs(musicR[i])));
  }
  const samples = buildFilteredVoiceSamples(voiceBuffer.getChannelData(0), music, voiceBuffer.sampleRate, level, voiceOffsetMs);
  const buffer = getAudioContext().createBuffer(1, samples.length, voiceBuffer.sampleRate);
  buffer.copyToChannel(samples, 0);
  filteredVoice = { level, voiceOffsetMs, buffer, peaks: computeWaveformPeaks(samples) };
  return filteredVoice;
}

export function getStudioVoicePeaks(settings) {
  return getStudioVoice(settings)?.peaks ?? null;
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

  // PISTA 2: EQ, chorus estéreo y eco. El nivel 0 deja pasar la captura sin otra EQ.
  const voiceInputGain = ctx.createGain();
  voiceInputGain.gain.setValueAtTime(safeParam(settings.voiceVol ?? 1.15, 0, 2.5), now);
  const filter = getVoiceFilterPreset(settings.voiceFilter);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(filter.highpassHz, now);
  const deMud = ctx.createBiquadFilter();
  deMud.type = 'peaking';
  deMud.frequency.setValueAtTime(260, now);
  deMud.gain.setValueAtTime(filter.deMudDb, now);
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.setValueAtTime(3200, now);
  presence.gain.setValueAtTime(filter.presenceDb, now);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(filter.lowpassHz, now);
  const voiceEq = ctx.createGain();
  const voiceBypass = ctx.createGain();
  const postEq = ctx.createGain();
  voiceEq.gain.setValueAtTime(filter.gateThreshold ? 1 : 0, now);
  voiceBypass.gain.setValueAtTime(filter.gateThreshold ? 0 : 1, now);
  voiceInputGain.connect(highpass).connect(deMud).connect(presence).connect(lowpass).connect(voiceEq).connect(postEq);
  voiceInputGain.connect(voiceBypass).connect(postEq);

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
  postEq.connect(chorusDelayL);
  postEq.connect(chorusDelayR);
  chorusDelayL.connect(chorusMerger, 0, 0);
  chorusDelayR.connect(chorusMerger, 0, 1);
  chorusMerger.connect(chorusWet);

  const postChorusSum = ctx.createGain();
  postChorusSum.gain.setValueAtTime(1.0, now);
  postEq.connect(chorusDry);
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

      const f = getVoiceFilterPreset(newSettings.voiceFilter);
      highpass.frequency.setTargetAtTime(f.highpassHz, t, 0.02);
      deMud.gain.setTargetAtTime(f.deMudDb, t, 0.02);
      presence.gain.setTargetAtTime(f.presenceDb, t, 0.02);
      lowpass.frequency.setTargetAtTime(f.lowpassHz, t, 0.02);
      voiceEq.gain.setTargetAtTime(f.gateThreshold ? 1 : 0, t, 0.02);
      voiceBypass.gain.setTargetAtTime(f.gateThreshold ? 0 : 1, t, 0.02);

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
    },
    disconnect() {
      // Romper también el ciclo de feedback al reemplazar una preescucha.
      echoFeedback.disconnect();
      masterLimiter.disconnect();
    }
  };
}

/**
 * Prepara la captura multipista y programa la precuenta de la maqueta.
 */
export async function startDemoRecording(onStatusUpdate) {
  if (isCaptureBusy || isDemoRecordingOrCountIn()) return { ok: true };
  isCaptureBusy = true;
  try {
    stopDemoPreviewPlayback();
    statusCallback = onStatusUpdate || null;
    const ctx = ensureAudioUnlocked();
    await prepareDemoCapture(ctx);
    scheduleDemoCountIn(ctx);
    return { ok: true, hasMic: hasMicActive, micWarning: micWarningReason };
  } catch (error) {
    if (isCountingIn) cancelDemoCountIn();
    else releasePreparedCapture();
    throw error;
  } finally {
    isCaptureBusy = false;
  }
}

async function prepareDemoCapture(ctx) {
  const masterNode = getMasterOutputNode();
  cameraRequested = getState().cameraEnabled;

  rawMusicL = [];
  rawMusicR = [];
  rawVoice = [];
  fallbackChunks = [];
  hasMicActive = false;
  micWarningReason = '';
  recordingStartAudioTime = null;
  firstCapturedFrame = null;
  recordedNoteEvents = [];

  // 1. Tap estéreo de la música interna de ÓRBITA
  musicTapGain = ctx.createGain();
  musicTapGain.gain.setValueAtTime(1.0, ctx.currentTime);
  musicSplitter = ctx.createChannelSplitter(2);
  masterNode.connect(musicTapGain);
  musicTapGain.connect(musicSplitter);

  // 2. Captura de voz cruda, con pasaaltos subsónico fijo.
  if (globalThis.navigator?.mediaDevices?.getUserMedia) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      micSource = ctx.createMediaStreamSource(micStream);
      micHighpass = ctx.createBiquadFilter();
      micHighpass.type = 'highpass';
      micHighpass.frequency.setValueAtTime(40, ctx.currentTime);
      micSource.connect(micHighpass);
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

  // 3. Conectar los 3 canales sincronizados al AudioWorklet multipista.
  mergerNode = ctx.createChannelMerger(3);
  musicSplitter.connect(mergerNode, 0, 0);
  musicSplitter.connect(mergerNode, 1, 1);
  if (hasMicActive) micHighpass.connect(mergerNode, 0, 2);
  silentSink = ctx.createGain();
  silentSink.gain.setValueAtTime(0, ctx.currentTime);
  silentSink.connect(ctx.destination);

  if (ctx.audioWorklet) {
    try {
      if (!workletLoaded) {
        const blob = new Blob([MULTITRACK_WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        workletLoaded = true;
      }

      workletNode = new AudioWorkletNode(ctx, 'orbita-multitrack-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 3,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete'
      });

      workletNode.port.onmessage = ({ data }) => {
        if (recordingStartAudioTime === null || !isDemoRecordingOrCountIn()) return;
        // Conservar solo las muestras desde el tiempo 1, incluso si cae dentro de un bloque.
        const startFrame = Math.ceil(recordingStartAudioTime * ctx.sampleRate);
        const skip = Math.max(0, startFrame - data.frame);
        if (skip >= data.mL.length) return;
        captureSamples(data.frame + skip, data.mL.subarray(skip), data.mR.subarray(skip), data.vM?.subarray(skip));
      };

      mergerNode.connect(workletNode);
      workletNode.connect(silentSink);
    } catch (_) {
      workletNode = null;
    }
  }

  // En navegadores sin AudioWorklet, conservar las pistas separadas también en el respaldo.
  if (!workletNode && typeof ctx.createScriptProcessor === 'function') {
    try {
      scriptProcessor = ctx.createScriptProcessor(1024, 3, 1);
      scriptProcessor.onaudioprocess = ({ inputBuffer }) => {
        if (!isRecording) return;
        captureSamples(null, inputBuffer.getChannelData(0).slice(), inputBuffer.getChannelData(1).slice(),
          hasMicActive ? inputBuffer.getChannelData(2).slice() : null);
      };
      scriptCaptureGate = ctx.createGain();
      scriptCaptureGate.gain.setValueAtTime(0, ctx.currentTime);
      mergerNode.connect(scriptCaptureGate).connect(scriptProcessor);
      scriptProcessor.connect(silentSink);
    } catch (_) {
      scriptProcessor = null;
    }
  }

  if (!workletNode && !scriptProcessor && typeof ctx.createMediaStreamDestination === 'function' && typeof MediaRecorder !== 'undefined') {
    try {
      fallbackDest = ctx.createMediaStreamDestination();
      musicTapGain.connect(fallbackDest);
      musicTapGain.gain.setValueAtTime(0, ctx.currentTime);
      fallbackRecorder = new MediaRecorder(fallbackDest.stream);
      fallbackRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) fallbackChunks.push(ev.data);
      };
    } catch (_) {
      fallbackRecorder = null;
    }
  }
}

function scheduleCountInCue(ctx, audioTime, callback) {
  const delayMs = Math.max(0, Math.ceil((audioTime - ctx.currentTime) * 1000));
  const id = setTimeout(() => {
    countInTimers.delete(id);
    if (!isCountingIn) return;
    if (ctx.currentTime < audioTime) scheduleCountInCue(ctx, audioTime, callback);
    else callback();
  }, delayMs);
  countInTimers.add(id);
}

function scheduleDemoCountIn(ctx) {
  const armed = getArmedTransportSnapshot();
  stopAllTransportForPlayback();
  const st = getState();
  const { rootSemitone, notation, scaleMode, lang, bpm } = st;
  const modeLabel = scaleMode === 'custom' ? t('custom.title', lang) : scaleMode;
  videoMetadata = {
    keyLabel: `${getNoteNameUpper(rootSemitone, notation)} ${modeLabel}`,
    soundName: getActivePreset().name,
    bpm,
    notation
  };
  keyboardDegrees = getKeyboardDegrees(st);

  const beatDur = 60 / (bpm || 92);
  const t0 = ctx.currentTime + 0.04;
  const recordStartAt = t0 + 4 * beatDur;
  recordingStartAudioTime = recordStartAt;
  isCountingIn = true;
  scriptCaptureGate?.gain.setValueAtTime(1, recordStartAt);
  if (fallbackRecorder) musicTapGain.gain.setValueAtTime(1, recordStartAt);

  for (let i = 0; i < 4; i++) {
    const clickTime = t0 + i * beatDur;
    countInClicks.push(triggerMetronomeClick(clickTime, i === 0));
    scheduleCountInCue(ctx, clickTime, () => {
      setState({ currentBeat: i });
      statusCallback?.({
        recording: false, countingIn: true, countInBeat: i, countInRemaining: 4 - i,
        elapsedSec: 0, hasMic: hasMicActive, micWarning: micWarningReason
      });
    });
  }

  // Programar el transporte con margen para que Web Audio ejecute el primer paso en recordStartAt.
  scheduleCountInCue(ctx, recordStartAt - 0.06, () => {
    setNoteEventObserver(recordNoteEvent);
    startArmedTransportAt(recordStartAt, armed);
  });
  scheduleCountInCue(ctx, recordStartAt, () => {
    countInClicks.length = 0;
    if (cameraCapture?.start() === false) cameraCapture = null;
    if (cameraCapture) setCameraLivePreview(cameraCapture.stream);
    try { fallbackRecorder?.start(250); } catch (_) {}

    isCountingIn = false;
    isRecording = true;
    setState({ currentBeat: getTransportSnapshot().running ? 0 : -1 });
    const notify = elapsedSec => statusCallback?.({
      recording: true, countingIn: false, elapsedSec, hasMic: hasMicActive, micWarning: micWarningReason
    });
    timerInterval = setInterval(() => notify(ctx.currentTime - recordStartAt), 250);
    notify(0);
  });
}

export function cancelDemoCountIn() {
  if (!isCountingIn) return;
  isCountingIn = false;
  for (const timer of countInTimers) clearTimeout(timer);
  countInTimers.clear();
  for (const click of countInClicks) click.stop();
  countInClicks.length = 0;
  setNoteEventObserver(null);
  recordedNoteEvents = [];
  stopAllTransportForPlayback();
  releasePreparedCapture();
  const notify = statusCallback;
  statusCallback = null;
  notify?.({ recording: false, countingIn: false, elapsedSec: 0 });
}

function releaseStream(stream) {
  stream?.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
}

function releasePreparedCapture() {
  // La cámara preparada aún no tiene un MediaRecorder en marcha que produzca un blob.
  releaseStream(cameraCapture?.stream);
  cameraCapture = null;
  setCameraLivePreview(null);
  disconnectDemoCapture();
}

function disconnectDemoCapture() {
  if (musicTapGain) {
    try { getMasterOutputNode().disconnect(musicTapGain); } catch (_) {}
  }
  if (workletNode) workletNode.port.onmessage = null;
  if (scriptProcessor) scriptProcessor.onaudioprocess = null;
  for (const node of [musicTapGain, musicSplitter, micSource, micHighpass, mergerNode,
    workletNode, scriptProcessor, scriptCaptureGate, silentSink, fallbackDest]) {
    try { node?.disconnect(); } catch (_) {}
  }
  releaseStream(micStream);
  releaseStream(fallbackDest?.stream);

  micStream = null;
  musicTapGain = null;
  musicSplitter = null;
  micSource = null;
  micHighpass = null;
  mergerNode = null;
  workletNode = null;
  scriptProcessor = null;
  scriptCaptureGate = null;
  silentSink = null;
  fallbackDest = null;
  fallbackRecorder = null;
}

/**
 * Detiene la grabación, PARA LA BATERÍA Y EL LOOPER para escuchar en silencio,
 * libera el micrófono y construye la sesión multipista de 2 pistas listas para mezclar y recortar.
 */
export async function stopDemoRecording() {
  if (!isRecording) return null;
  isRecording = false;
  isCaptureBusy = true;
  try {
    return await finishDemoRecording();
  } finally {
    isCaptureBusy = false;
  }
}

async function finishDemoRecording() {
  setNoteEventObserver(null);
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

  disconnectDemoCapture();
  const notify = statusCallback;
  statusCallback = null;
  notify?.({ recording: false, countingIn: false, elapsedSec: 0, hasMic: hasMicActive, micWarning: micWarningReason });

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
  const voicePeaks = voiceSamples ? computeWaveformPeaks(voiceSamples, 220) : null;
  const audioStart = firstCapturedFrame === null ? recordingStartAudioTime : firstCapturedFrame / sampleRate;
  const noteEvents = recordedNoteEvents
    .filter(event => !event.cancelled)
    .map(({ when, cancelled, ...event }) => ({ ...event, timeSec: when - audioStart }))
    .filter(event => event.timeSec < durationSec && event.timeSec + event.durationSec > 0)
    .sort((a, b) => a.timeSec - b.timeSec);
  recordedNoteEvents = [];

  filteredVoice = null;
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
    noteEvents,
    keyboardDegrees,
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
  const rawReadPos = trimStart - shiftSec;
  const offset = Math.max(0, rawReadPos);
  const delay = Math.max(0, -rawReadPos);
  const duration = Math.min(playDur - delay, voiceBuffer.duration - offset);
  if (duration <= 0) return null;
  const vSrc = ctx.createBufferSource();
  vSrc.buffer = voiceBuffer;
  vSrc.connect(destNode);
  vSrc.start(startAtAudioTime + delay, offset, duration);
  return vSrc;
}

function getTrimBounds({ durationSec, sampleRate }, settings) {
  const minDuration = 1 / sampleRate;
  const start = Math.max(0, Math.min(durationSec - minDuration, settings.trimStartSec || 0));
  const end = Math.max(start + minDuration, Math.min(durationSec, settings.trimEndSec ?? durationSec));
  return { start, end };
}

/**
 * Reproduce en tiempo real la mezcla de las 2 pistas recortadas (trimStart -> trimEnd)
 * con Volumen Música, Volumen Voz, Eco (0-3) y Chorus (0-3) modificables EN VIVO.
 */
export function isDemoPreviewPlaying() {
  return previewState !== null;
}

export function getCurrentPreviewPositionSec() {
  if (!previewState) return null;
  const { ctx, startAt, startSec, playDur, tailSec } = previewState;
  const elapsed = ctx.currentTime - startAt;
  return elapsed >= playDur + tailSec ? null : startSec + Math.min(playDur, Math.max(0, elapsed));
}

export function stopDemoPreviewPlayback() {
  finishDemoPreview();
}

function finishDemoPreview(replacementAt = null) {
  if (!previewState) return;
  const st = previewState;
  previewState = null;

  cancelAnimationFrame(st.rafId);
  const fadeStart = replacementAt ?? st.ctx.currentTime;
  const stopAt = fadeStart + 0.008;
  const gain = st.output.gain;
  gain.cancelScheduledValues(fadeStart);
  gain.setValueAtTime(gain.value, fadeStart);
  gain.linearRampToValueAtTime(0, stopAt);
  st.musicSrc.stop(stopAt);
  st.voiceSrc?.stop(stopAt);
  st.graph.stopLfos(stopAt);
  setTimeout(() => {
    st.graph.disconnect();
    st.output.disconnect();
  }, Math.ceil((stopAt - st.ctx.currentTime) * 1000) + 20);
  if (replacementAt === null) st.onEnded?.();
}

export function updateLivePreviewMix(settings) {
  previewState?.graph.updateParams(settings);
}

export function startDemoPreviewPlayback(settings, onProgress, onEnded, seekStartSec = null) {
  if (!currentSession || !currentSession.musicBuffer) return false;

  const ctx = ensureAudioUnlocked();
  const voice = getStudioVoice(settings);
  const { start: trimStart, end: trimEnd } = getTrimBounds(currentSession, settings);
  const maxSeek = Math.max(trimStart, trimEnd - 0.05);
  const startSec = Math.max(trimStart, Math.min(maxSeek, Number.isFinite(seekStartSec) ? seekStartSec : trimStart));
  const playDur = trimEnd - startSec;

  const output = ctx.createGain();
  output.connect(ctx.destination);
  const graph = buildTwoTrackMixGraph(ctx, output, settings);
  const startAt = ctx.currentTime + 0.008;
  finishDemoPreview(startAt);
  output.gain.setValueAtTime(0, ctx.currentTime);
  output.gain.setValueAtTime(0, startAt);
  output.gain.linearRampToValueAtTime(1, startAt + 0.008);

  const musicSrc = ctx.createBufferSource();
  musicSrc.buffer = currentSession.musicBuffer;
  musicSrc.connect(graph.musicGain);
  musicSrc.start(startAt, startSec, playDur);

  let voiceSrc = null;
  if (voice) {
    voiceSrc = scheduleSyncedVoiceSource(
      ctx,
      voice.buffer,
      graph.voiceInputGain,
      startAt,
      startSec,
      playDur,
      settings.voiceOffsetMs || 0
    );
  }

  // Si hay eco activo en voz, dejar sonar la cola del eco ~0.6s al terminar el recorte
  const tailSec = (settings.voiceEcho || 0) > 0 ? 0.65 : 0.08;
  const stopAt = startAt + playDur + tailSec;

  const localState = {
    ctx, graph, output, musicSrc, voiceSrc, startAt, startSec, playDur, tailSec, rafId: null, onEnded
  };
  previewState = localState;

  const tick = () => {
    if (previewState !== localState) return;
    const position = getCurrentPreviewPositionSec();
    if (position === null) {
      stopDemoPreviewPlayback();
      return;
    }
    onProgress?.(position);
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
  const { start: trimStart, end: trimEnd } = getTrimBounds(currentSession, settings);
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

  const voice = getStudioVoice(settings);
  if (voice) {
    scheduleSyncedVoiceSource(
      offCtx,
      voice.buffer,
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
