/**
 * demo-recorder.js — Estudio Multipista de Maquetas (Música + Voz + Base opcional)
 * - Captura simultánea sample-accurate vía AudioWorklet de 3 canales:
 *   Canal 0/1 = Música estéreo de ÓRBITA | Canal 2 = Micrófono crudo
 * - Detiene automáticamente la batería y el looper al parar la grabación para escuchar en silencio
 * - Mezclador en tiempo real y renderizado offline (.WAV 16-bit estéreo):
 *   · Volumen Música (0–150%) y Volumen Voz (0–180%)
 *   · Eco en Voz (0 a 3 niveles) y Chorus estéreo en Voz (0 a 3 niveles)
 *   · Recorte de Inicio y Final (Trim Start / End) con forma de onda
 */

import { ensureAudioUnlocked, getAudioContext, getMasterOutputNode, safeParam, triggerMetronomeClick } from './audio-core.js';
import { getArmedTransportSnapshot, getTransportSnapshot, startArmedTransportAt, stopAllTransportForPlayback } from './clock-looper.js';
import { t } from './i18n.js';
import { getState, setState } from './state.js';
import { prepareFrontCamera } from './short-video.js';
import { getActivePreset, setNoteEventObserver } from './synth-presets.js';
import { formatChordLabel, getDiatonicDegrees, getNoteNameTitle, getNoteNameUpper } from './theory.js';
import { buildFilteredVoiceSamples, COUNT_IN_MAX_LAG_MS, getVoiceFilterPreset, measureAcousticLagFromCountIn } from './voice-filter.js';

export { buildFilteredVoiceSamples, getVoiceFilterPreset } from './voice-filter.js';

const MASTER_COMP_PRESETS = [
  null,
  { threshold: -4, knee: 18, ratio: 3, attack: 0.008, release: 0.18, softClip: false },
  { threshold: -2, knee: 10, ratio: 8, attack: 0.004, release: 0.14, softClip: false },
  { threshold: -1, knee: 4, ratio: 16, attack: 0.002, release: 0.10, softClip: true }
];

export function getMasterCompPreset(level) {
  const preset = Number.isInteger(level) ? MASTER_COMP_PRESETS[level] : null;
  return preset ? { ...preset } : null;
}

function getMasterCompLevel(settings) {
  const { masterComp } = settings;
  return Number.isInteger(masterComp) && masterComp >= 0 && masterComp <= 3 ? masterComp : 1;
}

export function linearPeakToDb(peak) {
  return peak <= 0 ? -Infinity : 20 * Math.log10(peak);
}

export function dbToMeterRatio(db) {
  return Math.max(0, Math.min(1, (db + 36) / 42));
}

const SOFT_CLIP_HEADROOM = 8;
const softClipCurve = (() => {
  const knee = 10 ** (-3 / 20);
  const room = 1 - knee;
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const sample = (2 * i / (curve.length - 1) - 1) * SOFT_CLIP_HEADROOM;
    const level = Math.abs(sample);
    curve[i] = level <= knee ? sample : Math.sign(sample) * (knee + room * Math.tanh((level - knee) / room));
  }
  return curve;
})();

let isRecording = false;
let isCaptureBusy = false;
let isCountingIn = false;
const countInTimers = new Set();
const countInClicks = [];
let countInCapture = null;
let countInCalibration = null;
let timerInterval = null;
let statusCallback = null;
let cameraCapture = null;
let cameraRequested = false;
let videoMetadata = null;
let recordedNoteEvents = [];
let keyboardDegrees = [];
let recordingStartAudioTime = null;
let firstCapturedFrame = null;
let recordedBackingBuffer = null;
let recordedBackingVol = 0.90;

// Nodos de grabación multipista
let musicSplitter = null;
let musicTapGain = null;
let micStream = null;
let micSource = null;
let micHighpass = null;
let mergerNode = null;
let workletNode = null;
let workletLoaded = false;
let workletFlush = null;
let silentSink = null;
let scriptProcessor = null;
let scriptCaptureGate = null;
let scriptTiming = null;

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

// Sesión actual grabada en memoria, con una referencia a la base si se reprodujo.
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
const BLOCK_SIZE = 4096;
class OrbitaMultitrackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startFrame = Infinity;
    this.endFrame = Infinity;
    this.processedThrough = currentFrame;
    this.allocateBlock();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.startFrame = data.frame;
        if (data.countIn) {
          this.countInStart = data.countIn.startFrame;
          this.countInVoice = new Float32Array(data.countIn.endFrame - this.countInStart);
        }
      }
      if (data.type === 'flush') {
        this.endFrame = data.frame ?? this.processedThrough;
        if (this.processedThrough >= this.endFrame) this.finish();
      }
    };
  }

  allocateBlock() {
    this.buffer = new ArrayBuffer(3 * BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT);
    this.mL = new Float32Array(this.buffer, 0, BLOCK_SIZE);
    this.mR = new Float32Array(this.buffer, this.mL.byteLength, BLOCK_SIZE);
    this.vM = new Float32Array(this.buffer, 2 * this.mL.byteLength, BLOCK_SIZE);
    this.length = 0;
  }

  sendBlock() {
    if (this.length === 0) return;
    this.port.postMessage({
      frame: this.frame, length: this.length, mL: this.mL, mR: this.mR, vM: this.vM
    }, [this.buffer]);
    this.length = 0;
  }

  finish() {
    this.finished = true;
    this.sendBlock();
    this.port.postMessage({ type: 'flushed' });
  }

  process(inputs) {
    if (this.finished) return false;
    const mL = inputs[0]?.[0];
    if (!mL) return true;
    const mR = inputs[0][1] ?? mL;
    const vM = inputs[0][2];
    if (this.countInVoice) {
      const end = this.countInStart + this.countInVoice.length;
      const from = Math.max(currentFrame, this.countInStart);
      const to = Math.min(currentFrame + mL.length, end);
      if (vM && from < to) this.countInVoice.set(vM.subarray(from - currentFrame, to - currentFrame), from - this.countInStart);
      if (currentFrame + mL.length >= end) {
        this.port.postMessage({ type: 'count-in-voice', frame: this.countInStart, samples: this.countInVoice }, [this.countInVoice.buffer]);
        this.countInVoice = null;
      }
    }
    const limit = Math.min(mL.length, this.endFrame - currentFrame);
    let read = Math.max(0, this.startFrame - currentFrame);
    while (read < limit) {
      if (this.length === 0) this.frame = currentFrame + read;
      const count = Math.min(limit - read, BLOCK_SIZE - this.length);
      if (count === mL.length) {
        this.mL.set(mL, this.length);
        this.mR.set(mR, this.length);
        if (vM) this.vM.set(vM, this.length);
      } else {
        const end = read + count;
        this.mL.set(mL.subarray(read, end), this.length);
        this.mR.set(mR.subarray(read, end), this.length);
        if (vM) this.vM.set(vM.subarray(read, end), this.length);
      }
      read += count;
      this.length += count;
      if (this.length === BLOCK_SIZE) {
        this.sendBlock();
        this.allocateBlock();
      }
    }
    this.processedThrough = currentFrame + mL.length;
    if (this.processedThrough >= this.endFrame) this.finish();
    return !this.finished;
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
  const { bpm } = getState();
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `orbita-maqueta-T${bpm}-${stamp}.${ext}`;
}

function copyCapturedChannel(buffer, channel, chunks) {
  const dest = buffer.getChannelData(channel);
  let offset = 0;
  for (const chunk of chunks) {
    const count = Math.min(chunk.length, dest.length - offset);
    dest.set(count < chunk.length ? chunk.subarray(0, count) : chunk, offset);
    offset += count;
    if (offset === dest.length) break;
  }
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

function finishCountInCalibration(sampleRate) {
  if (!countInCapture) return;
  const { startFrame, endFrame, clickOffsetsSamples, countInVoiceChunks } = countInCapture;
  const [first] = countInVoiceChunks;
  const complete = countInVoiceChunks.length === 1 && first.frame === startFrame && first.samples.length === endFrame - startFrame;
  if (first) {
    const voice = complete ? first.samples : new Float32Array(endFrame - startFrame);
    if (!complete) {
      for (const chunk of countInVoiceChunks) voice.set(chunk.samples, chunk.frame - startFrame);
    }
    countInCalibration = measureAcousticLagFromCountIn(voice, clickOffsetsSamples, sampleRate);
  }
  countInCapture = null;
}

function setCameraLivePreview(stream) {
  if (typeof document === 'undefined') return;
  const pip = document.getElementById('camera-live-pip');
  const video = document.getElementById('camera-live-video');
  if (video) video.srcObject = stream;
  if (pip) pip.hidden = !stream;
}

function computeWaveformPeaks(channelData, bins = 220, length = channelData?.length ?? 0, offset = 0, right = channelData) {
  const peaks = new Float32Array(bins);
  if (!channelData || channelData.length === 0) return peaks;
  for (let b = 0; b < bins; b++) {
    const start = offset + Math.floor(b * length / bins);
    const end = Math.min(channelData.length, offset + Math.floor((b + 1) * length / bins));
    let maxVal = 0;
    for (let i = start; i < end; i++) {
      const a = Math.max(Math.abs(channelData[i]), Math.abs(right[i]));
      if (a > maxVal) maxVal = a;
    }
    peaks[b] = maxVal;
  }
  return peaks;
}

function getMusicReference(musicBuffer, backingBuffer, backingCaptureVol, backingStartSec) {
  const left = musicBuffer.getChannelData(0);
  const right = musicBuffer.numberOfChannels > 1 ? musicBuffer.getChannelData(1) : left;
  const readMusic = i => ((left[i] ?? 0) + (right[i] ?? 0)) * 0.5;
  if (!backingBuffer || backingCaptureVol === 0) return readMusic;

  const backingLeft = backingBuffer.getChannelData(0);
  const backingRight = backingBuffer.numberOfChannels > 1 ? backingBuffer.getChannelData(1) : backingLeft;
  const ratio = backingBuffer.sampleRate / musicBuffer.sampleRate;
  const offset = backingStartSec * backingBuffer.sampleRate;
  const readBacking = i => ((backingLeft[i] ?? 0) + (backingRight[i] ?? 0)) * 0.5;
  if (ratio === 1 && offset === 0) {
    return i => readMusic(i) + backingCaptureVol * readBacking(i);
  }
  return i => {
    const position = i * ratio + offset;
    const frame = Math.floor(position);
    const fraction = position - frame;
    const sample = readBacking(frame);
    return readMusic(i) + backingCaptureVol * (sample + fraction * (readBacking(frame + 1) - sample));
  };
}

function getStudioVoice(settings) {
  if (!currentSession?.voiceBuffer) return null;
  if (!getVoiceFilterPreset(settings.voiceFilter).noiseStrength) {
    return { buffer: currentSession.voiceBuffer, peaks: currentSession.voicePeaks };
  }
  const { voiceFilter: level, voiceOffsetMs = 0 } = settings;
  if (filteredVoice?.level === level && filteredVoice.voiceOffsetMs === voiceOffsetMs) return filteredVoice;

  const { voiceBuffer, musicBuffer, backingBuffer, backingCaptureVol, backingStartSec } = currentSession;
  const readMusic = getMusicReference(musicBuffer, backingBuffer, backingCaptureVol, backingStartSec);
  const buffer = getAudioContext().createBuffer(1, voiceBuffer.length, voiceBuffer.sampleRate);
  const samples = buildFilteredVoiceSamples(voiceBuffer.getChannelData(0), readMusic, voiceBuffer.sampleRate, level, voiceOffsetMs);
  buffer.getChannelData(0).set(samples);
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
 * Construye el grafo de música, voz con efectos y base opcional.
 * Se usa de forma IDÉNTICA tanto para la preescucha en tiempo real como para el render offline .WAV.
 */
function buildTwoTrackMixGraph(ctx, destNode, settings, hasBackingTrack = false) {
  const now = ctx.currentTime;
  const masterBusGain = ctx.createGain();
  masterBusGain.gain.setValueAtTime(safeParam(settings.masterVol ?? 1.0, 0, 2.0), now);

  let meterAnalyser = null;
  let rightAnalyser = null;
  let meterSplitter = null;
  if (typeof ctx.createAnalyser === 'function' && typeof ctx.startRendering !== 'function') {
    meterAnalyser = ctx.createAnalyser();
    meterAnalyser.fftSize = 1024;
    // Leer L y R por separado evita que la mezcla a mono oculte picos por contrafase.
    meterAnalyser.channelCount = 1;
    meterAnalyser.channelCountMode = 'explicit';
    meterAnalyser.channelInterpretation = 'discrete';
    masterBusGain.connect(meterAnalyser);
    meterSplitter = ctx.createChannelSplitter(2);
    rightAnalyser = ctx.createAnalyser();
    rightAnalyser.fftSize = meterAnalyser.fftSize;
    masterBusGain.connect(meterSplitter).connect(rightAnalyser, 1);
  }

  let masterComp = getMasterCompLevel(settings);
  const offline = typeof ctx.startRendering === 'function';
  // Mantener los compresores activos en preescucha permite conmutar con un fundido.
  const masterPaths = (offline ? [masterComp] : [0, 1, 2, 3]).map(level => {
    const preset = getMasterCompPreset(level);
    let output = masterBusGain;
    if (preset) {
      const { softClip, ...params } = preset;
      const compressor = ctx.createDynamicsCompressor();
      for (const [param, value] of Object.entries(params)) compressor[param].setValueAtTime(value, now);
      output = output.connect(compressor);
      if (softClip) {
        const clipInput = ctx.createGain();
        const shaper = ctx.createWaveShaper();
        clipInput.gain.setValueAtTime(1 / SOFT_CLIP_HEADROOM, now);
        shaper.curve = softClipCurve;
        shaper.oversample = '2x';
        output = output.connect(clipInput).connect(shaper);
      }
    }
    const path = ctx.createGain();
    path.gain.setValueAtTime(Number(level === masterComp), now);
    output.connect(path).connect(destNode);
    return path;
  });

  // PISTA 1: Música
  const musicGain = ctx.createGain();
  musicGain.gain.setValueAtTime(safeParam(settings.musicVol ?? 0.90, 0, 2.0), now);
  musicGain.connect(masterBusGain);

  const backingGain = hasBackingTrack ? ctx.createGain() : null;
  if (backingGain) {
    backingGain.gain.setValueAtTime(safeParam(settings.backingVol ?? 0.90, 0, 1.5), now);
    backingGain.connect(masterBusGain);
  }

  // PISTA 2: EQ, chorus estéreo y eco. El nivel 0 deja pasar la captura sin otra EQ.
  const voiceInputGain = ctx.createGain();
  voiceInputGain.gain.setValueAtTime(safeParam(settings.voiceVol ?? 1.15, 0, 2.5), now);
  const filter = getVoiceFilterPreset(settings.voiceFilter);
  const [highpass, highpass2] = [-5.33, 2.32].map(q => {
    const stage = ctx.createBiquadFilter();
    stage.type = 'highpass';
    stage.frequency.setValueAtTime(filter.highpassHz, now);
    stage.Q.setValueAtTime(q, now);
    return stage;
  });
  const deMud = ctx.createBiquadFilter();
  deMud.type = 'peaking';
  deMud.frequency.setValueAtTime(250, now);
  deMud.gain.setValueAtTime(filter.deMudDb, now);
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.setValueAtTime(3300, now);
  presence.gain.setValueAtTime(filter.presenceDb, now);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(filter.lowpassHz, now);
  const voiceEq = ctx.createGain();
  const voiceBypass = ctx.createGain();
  const postEq = ctx.createGain();
  voiceEq.gain.setValueAtTime(filter.noiseStrength ? 1 : 0, now);
  voiceBypass.gain.setValueAtTime(filter.noiseStrength ? 0 : 1, now);
  voiceInputGain.connect(highpass).connect(highpass2).connect(deMud).connect(presence).connect(lowpass).connect(voiceEq).connect(postEq);
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

  postChorusSum.connect(masterBusGain); // Ruta directa (seca + chorus)
  postChorusSum.connect(echoDelay);
  echoDelay.connect(echoFilter);
  echoFilter.connect(echoFeedback);
  echoFeedback.connect(echoDelay);
  echoFilter.connect(echoWet);
  echoWet.connect(masterBusGain);

  lfoL.start(now);
  lfoR.start(now);

  return {
    musicGain,
    backingGain,
    voiceInputGain,
    meterAnalyser,
    rightAnalyser,
    updateParams(newSettings) {
      const t = ctx.currentTime;
      masterBusGain.gain.setTargetAtTime(safeParam(newSettings.masterVol ?? 1.0, 0, 2.0), t, 0.015);
      const level = getMasterCompLevel(newSettings);
      if (!offline && level !== masterComp) {
        masterComp = level;
        masterPaths.forEach((path, i) => path.gain.setTargetAtTime(Number(i === level), t, 0.015));
      }
      musicGain.gain.setTargetAtTime(safeParam(newSettings.musicVol ?? 0.90, 0, 2.0), t, 0.02);
      backingGain?.gain.setTargetAtTime(safeParam(newSettings.backingVol ?? 0.90, 0, 1.5), t, 0.02);
      voiceInputGain.gain.setTargetAtTime(safeParam(newSettings.voiceVol ?? 1.15, 0, 2.5), t, 0.02);

      const f = getVoiceFilterPreset(newSettings.voiceFilter);
      highpass.frequency.setTargetAtTime(f.highpassHz, t, 0.02);
      highpass2.frequency.setTargetAtTime(f.highpassHz, t, 0.02);
      deMud.gain.setTargetAtTime(f.deMudDb, t, 0.02);
      presence.gain.setTargetAtTime(f.presenceDb, t, 0.02);
      lowpass.frequency.setTargetAtTime(f.lowpassHz, t, 0.02);
      voiceEq.gain.setTargetAtTime(f.noiseStrength ? 1 : 0, t, 0.02);
      voiceBypass.gain.setTargetAtTime(f.noiseStrength ? 0 : 1, t, 0.02);

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
      masterBusGain.disconnect();
      meterSplitter?.disconnect();
      for (const path of masterPaths) path.disconnect();
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
  countInCapture = null;
  countInCalibration = null;
  fallbackChunks = [];
  hasMicActive = false;
  micWarningReason = '';
  recordingStartAudioTime = null;
  firstCapturedFrame = null;
  recordedBackingBuffer = null;
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
        if (data.type === 'flushed') {
          workletFlush?.done();
          return;
        }
        if (data.type === 'count-in-voice') {
          countInCapture?.countInVoiceChunks.push({ frame: data.frame, samples: data.samples });
          finishCountInCalibration(ctx.sampleRate);
          return;
        }
        if (recordingStartAudioTime === null || (!isDemoRecordingOrCountIn() && !workletFlush)) return;
        // Conservar solo las muestras desde el tiempo 1, incluso si cae dentro de un bloque.
        const startFrame = Math.ceil(recordingStartAudioTime * ctx.sampleRate);
        const skip = Math.max(0, startFrame - data.frame);
        const end = Math.min(data.length ?? data.mL.length, (workletFlush?.endFrame ?? Infinity) - data.frame);
        if (skip >= end) return;
        const slice = channel => skip === 0 && end === channel.length ? channel : channel.subarray(skip, end);
        captureSamples(data.frame + skip, slice(data.mL), slice(data.mR), data.vM ? slice(data.vM) : null);
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
      if (typeof ctx.createConstantSource === 'function') {
        // Un cuarto canal marca ambos intervalos en el reloj de audio, incluso dentro de un bloque.
        scriptProcessor = ctx.createScriptProcessor(1024, 4, 1);
        scriptTiming = ctx.createConstantSource();
        scriptTiming.offset.setValueAtTime(0, ctx.currentTime);
        musicSplitter.disconnect(mergerNode);
        micHighpass?.disconnect(mergerNode);
        mergerNode = ctx.createChannelMerger(4);
        musicSplitter.connect(mergerNode, 0, 0);
        musicSplitter.connect(mergerNode, 1, 1);
        micHighpass?.connect(mergerNode, 0, 2);
        scriptTiming.connect(mergerNode, 0, 3);
        scriptTiming.start();
        mergerNode.connect(scriptProcessor);

        let recordedFrames = 0;
        scriptProcessor.onaudioprocess = ({ inputBuffer }) => {
          const timing = inputBuffer.getChannelData(3);
          const start = timing.indexOf(3);
          if (countInCapture) {
            const voiceStart = timing.findIndex(sample => sample >= 1 && sample < 2);
            if (voiceStart >= 0) {
              const { startFrame, endFrame, countInVoiceChunks } = countInCapture;
              const frame = startFrame + Math.round((timing[voiceStart] - 1) * (endFrame - startFrame));
              let voiceEnd = voiceStart + 1;
              while (voiceEnd < timing.length && timing[voiceEnd] >= 1 && timing[voiceEnd] < 2) voiceEnd++;
              const end = Math.min(voiceEnd, voiceStart + endFrame - frame);
              if (end > voiceStart) countInVoiceChunks.push({
                frame, samples: inputBuffer.getChannelData(2).slice(voiceStart, end)
              });
              if (end < timing.length || frame + end - voiceStart === endFrame) finishCountInCalibration(ctx.sampleRate);
            } else if (start >= 0 || countInCapture.countInVoiceChunks.length) {
              finishCountInCalibration(ctx.sampleRate);
            }
          }
          if (start < 0 || !isDemoRecordingOrCountIn()) return;
          const frame = Math.ceil(recordingStartAudioTime * ctx.sampleRate) + recordedFrames;
          const slice = channel => inputBuffer.getChannelData(channel).slice(start);
          captureSamples(frame, slice(0), slice(1), hasMicActive ? slice(2) : null);
          recordedFrames += timing.length - start;
        };
      } else {
        scriptProcessor = ctx.createScriptProcessor(1024, 3, 1);
        scriptProcessor.onaudioprocess = ({ inputBuffer }) => {
          if (!isRecording) return;
          captureSamples(null, inputBuffer.getChannelData(0).slice(), inputBuffer.getChannelData(1).slice(),
            hasMicActive ? inputBuffer.getChannelData(2).slice() : null);
        };
        scriptCaptureGate = ctx.createGain();
        scriptCaptureGate.gain.setValueAtTime(0, ctx.currentTime);
        mergerNode.connect(scriptCaptureGate).connect(scriptProcessor);
      }
      scriptProcessor.connect(silentSink);
    } catch (_) {
      try { scriptTiming?.stop(); } catch (_) {}
      for (const node of [scriptProcessor, scriptTiming, scriptCaptureGate]) {
        try { node?.disconnect(); } catch (_) {}
      }
      scriptProcessor = null;
      scriptTiming = null;
      scriptCaptureGate = null;
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
  const startFrame = Math.ceil(t0 * ctx.sampleRate);
  const recordStartFrame = Math.ceil(recordStartAt * ctx.sampleRate);
  const clickOffsetsSamples = [];
  recordingStartAudioTime = recordStartAt;
  isCountingIn = true;

  for (let i = 0; i < 4; i++) {
    const clickTime = t0 + i * beatDur;
    const click = triggerMetronomeClick(clickTime, i === 0);
    countInClicks.push(click);
    clickOffsetsSamples.push(Math.ceil(click.startsAt * ctx.sampleRate) - startFrame);
    scheduleCountInCue(ctx, clickTime, () => {
      setState({ currentBeat: i });
      statusCallback?.({
        recording: false, countingIn: true, countInBeat: i, countInRemaining: 4 - i,
        elapsedSec: 0, hasMic: hasMicActive, micWarning: micWarningReason
      });
    });
  }

  const endFrame = Math.min(recordStartFrame,
    startFrame + clickOffsetsSamples[3] + Math.ceil((COUNT_IN_MAX_LAG_MS + 1) * ctx.sampleRate / 1000));
  if (hasMicActive && (workletNode || scriptTiming) && endFrame > startFrame) {
    countInCapture = { startFrame, endFrame, clickOffsetsSamples, countInVoiceChunks: [] };
  }
  workletNode?.port.postMessage?.({
    type: 'start', frame: recordStartFrame, countIn: countInCapture ? { startFrame, endFrame } : null
  });
  if (scriptTiming) {
    if (countInCapture) {
      // La rampa codifica la posición de cada muestra aunque el procesador pierda un bloque.
      scriptTiming.offset.setValueAtTime(1, startFrame / ctx.sampleRate);
      scriptTiming.offset.linearRampToValueAtTime(2, endFrame / ctx.sampleRate);
      if (endFrame < recordStartFrame) scriptTiming.offset.setValueAtTime(0, endFrame / ctx.sampleRate);
    }
    scriptTiming.offset.setValueAtTime(3, recordStartFrame / ctx.sampleRate);
  }
  scriptCaptureGate?.gain.setValueAtTime(1, recordStartAt);
  if (fallbackRecorder) musicTapGain.gain.setValueAtTime(1, recordStartAt);

  // Programar el transporte con margen para que Web Audio ejecute el primer paso en recordStartAt.
  scheduleCountInCue(ctx, recordStartAt - 0.06, () => {
    setNoteEventObserver(recordNoteEvent);
    recordedBackingBuffer = startArmedTransportAt(recordStartAt, armed);
    recordedBackingVol = getState().backingTrackVol;
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
  recordedBackingBuffer = null;
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
  try { scriptTiming?.stop(); } catch (_) {}
  for (const node of [musicTapGain, musicSplitter, micSource, micHighpass, mergerNode,
    workletNode, scriptProcessor, scriptCaptureGate, scriptTiming, silentSink, fallbackDest]) {
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
  scriptTiming = null;
  silentSink = null;
  fallbackDest = null;
  fallbackRecorder = null;
  countInCapture = null;
}

function flushMultitrackWorklet(endFrame) {
  const port = workletNode?.port;
  if (typeof port?.postMessage !== 'function') return;
  return new Promise(resolve => {
    // Un contexto interrumpido puede dejar de responder al puerto.
    const timeout = setTimeout(resolve, 250);
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };
    workletFlush = { endFrame, done };
    try {
      port.postMessage({ type: 'flush', frame: endFrame });
    } catch (_) {
      done();
    }
  }).finally(() => {
    workletFlush = null;
  });
}

/**
 * Detiene la grabación, PARA LA BATERÍA Y EL LOOPER para escuchar en silencio,
 * libera el micrófono y construye la sesión multipista.
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
  const ctx = ensureAudioUnlocked();
  const sampleRate = ctx.sampleRate;
  const flush = flushMultitrackWorklet(Math.round(ctx.currentTime * sampleRate));
  const backingBuffer = recordedBackingBuffer;
  const backingCaptureVol = recordedBackingVol;
  recordedBackingBuffer = null;
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

  let fallbackBlob = null;
  if (fallbackRecorder && fallbackRecorder.state !== 'inactive') {
    fallbackBlob = await new Promise((resolve) => {
      fallbackRecorder.onstop = () => {
        resolve(fallbackChunks.length > 0 ? new Blob(fallbackChunks) : null);
      };
      try { fallbackRecorder.stop(); } catch (_) { resolve(null); }
    });
  }

  if (flush) await flush;
  disconnectDemoCapture();
  const notify = statusCallback;
  statusCallback = null;
  notify?.({ recording: false, countingIn: false, elapsedSec: 0, hasMic: hasMicActive, micWarning: micWarningReason });

  let musicBuffer = null;
  let voiceBuffer = null;

  if (rawMusicL.length > 0) {
    const frames = rawMusicL.reduce((count, chunk) => count + chunk.length, 0);
    musicBuffer = ctx.createBuffer(2, frames, sampleRate);
    copyCapturedChannel(musicBuffer, 0, rawMusicL);
    copyCapturedChannel(musicBuffer, 1, rawMusicR);

    if (hasMicActive && rawVoice.length > 0) {
      const vLen = Math.min(rawVoice.reduce((count, chunk) => count + chunk.length, 0), frames);
      voiceBuffer = ctx.createBuffer(1, vLen, sampleRate);
      copyCapturedChannel(voiceBuffer, 0, rawVoice);
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
  const audioStart = firstCapturedFrame === null ? recordingStartAudioTime : firstCapturedFrame / sampleRate;
  const backingStartSec = Math.max(0, audioStart - recordingStartAudioTime);
  let backingPeaks = null;
  if (backingBuffer) {
    const left = backingBuffer.getChannelData(0);
    const right = backingBuffer.numberOfChannels > 1 ? backingBuffer.getChannelData(1) : left;
    const length = Math.round(durationSec * backingBuffer.sampleRate);
    const offset = Math.round(backingStartSec * backingBuffer.sampleRate);
    backingPeaks = computeWaveformPeaks(left, musicPeaks.length, length, offset, right);
  }

  const autoMeasuredOffsetMs = countInCalibration?.detected
    ? countInCalibration.offsetMs
    : estimateVoiceSyncOffsetMs(musicBuffer, voiceBuffer, detectedRoundTripMs,
      getMusicReference(musicBuffer, backingBuffer, backingCaptureVol, backingStartSec));
  const voiceSamples = voiceBuffer?.getChannelData(0);
  const voicePeaks = voiceSamples ? computeWaveformPeaks(voiceSamples, 220) : null;
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
    backingBuffer,
    backingStartSec,
    backingCaptureVol,
    musicPeaks,
    voicePeaks,
    backingPeaks,
    hasVoiceTrack: Boolean(voiceBuffer),
    hasBackingTrack: Boolean(backingBuffer),
    micWarning: micWarningReason,
    cameraBlob,
    cameraUnavailable: cameraRequested && !cameraBlob,
    videoMetadata,
    noteEvents,
    keyboardDegrees,
    detectedRoundTripMs,
    countInCalibration,
    autoMeasuredOffsetMs
  };

  return currentSession;
}

/**
 * Estima la latencia acústica/hardware entre la pista de Música y la de Voz (en ms negativos,
 * es decir, cuánto adelantar la Voz para alinearla exactamente con la Música).
 */
export function estimateVoiceSyncOffsetMs(musicBuffer, voiceBuffer, fallbackRoundTripMs = 110, readMusic = null) {
  if (!musicBuffer || !voiceBuffer || musicBuffer.duration < 0.8) {
    return -Math.round(fallbackRoundTripMs);
  }

  // Envolvente de energía a 250 Hz (1 bin = 4 ms) sobre los primeros 8 segundos
  const sr = musicBuffer.sampleRate;
  const binSamples = Math.max(1, Math.floor(sr * 0.004));
  const maxSamples = Math.min(musicBuffer.length, voiceBuffer.length, Math.floor(sr * 8));
  const numBins = Math.floor(maxSamples / binSamples);
  if (numBins < 120) return -Math.round(fallbackRoundTripMs);

  const mData = readMusic ? null : musicBuffer.getChannelData(0);
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
      mSum += Math.abs(readMusic ? readMusic(base + i) : mData[base + i]);
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

function scheduleBackingSource(ctx, session, destNode, startAt, offset, playDur) {
  const { backingBuffer, backingStartSec } = session;
  if (!backingBuffer) return null;
  const readAt = offset + backingStartSec;
  const duration = Math.min(playDur, backingBuffer.duration - readAt);
  if (duration <= 0) return null;
  const source = ctx.createBufferSource();
  source.buffer = backingBuffer;
  source.connect(destNode);
  source.start(startAt, readAt, duration);
  return source;
}

function getTrimBounds({ durationSec, sampleRate }, settings) {
  const minDuration = 1 / sampleRate;
  const start = Math.max(0, Math.min(durationSec - minDuration, settings.trimStartSec || 0));
  const end = Math.max(start + minDuration, Math.min(durationSec, settings.trimEndSec ?? durationSec));
  return { start, end };
}

/**
 * Reproduce en tiempo real la mezcla recortada (trimStart -> trimEnd)
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
  st.backingSrc?.stop(stopAt);
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

export function readLiveMasterMeter() {
  const meter = previewState?.meter;
  if (!meter) return { peakDb: -Infinity, rmsDb: -Infinity, clipped: false };

  const { analysers, samples } = meter;
  let maxAbs = 0;
  let sumSquares = 0;
  for (const analyser of analysers) {
    analyser.getFloatTimeDomainData(samples);
    for (const sample of samples) {
      maxAbs = Math.max(maxAbs, Math.abs(sample));
      sumSquares += sample * sample;
    }
  }
  const peakDb = linearPeakToDb(maxAbs);
  const rmsDb = linearPeakToDb(Math.sqrt(sumSquares / (samples.length * analysers.length)));
  return { peakDb, rmsDb, clipped: peakDb > 0 };
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
  const graph = buildTwoTrackMixGraph(ctx, output, settings, currentSession.hasBackingTrack);
  const startAt = ctx.currentTime + 0.008;
  finishDemoPreview(startAt);
  output.gain.setValueAtTime(0, ctx.currentTime);
  output.gain.setValueAtTime(0, startAt);
  output.gain.linearRampToValueAtTime(1, startAt + 0.008);

  const musicSrc = ctx.createBufferSource();
  musicSrc.buffer = currentSession.musicBuffer;
  musicSrc.connect(graph.musicGain);
  musicSrc.start(startAt, startSec, playDur);
  const backingSrc = scheduleBackingSource(ctx, currentSession, graph.backingGain, startAt, startSec, playDur);

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
    ctx, graph, output, musicSrc, voiceSrc, backingSrc, startAt, startSec, playDur, tailSec, rafId: null, onEnded,
    meter: graph.meterAnalyser ? {
      analysers: [graph.meterAnalyser, graph.rightAnalyser],
      samples: new Float32Array(graph.meterAnalyser.fftSize)
    } : null
  };
  previewState = localState;

  const tick = () => {
    if (previewState !== localState) return;
    const position = getCurrentPreviewPositionSec();
    if (position === null) {
      stopDemoPreviewPlayback();
      return;
    }
    onProgress?.(position, readLiveMasterMeter());
    if (previewState === localState) localState.rafId = requestAnimationFrame(tick);
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

  const graph = buildTwoTrackMixGraph(offCtx, fadeGain, settings, currentSession.hasBackingTrack);

  const mSrc = offCtx.createBufferSource();
  mSrc.buffer = currentSession.musicBuffer;
  mSrc.connect(graph.musicGain);
  mSrc.start(0, trimStart, trimmedDur);
  scheduleBackingSource(offCtx, currentSession, graph.backingGain, 0, trimStart, trimmedDur);

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
