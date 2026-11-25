import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  CUSTOM_SCALE_PRESETS,
  INTERVAL_ROMANS,
  ROMAN_DEGREES,
  VALID_CUSTOM_QUALITIES,
  formatChordLabel,
  getDegreeTriggerNotes,
  getDiatonicDegrees,
  getNoteNameTitle,
  getNoteNameUpper,
  getRelativePair,
  midiToFreq,
  sanitizeCustomScale
} from '../js/theory.js';
import { detectSystemLang, INTERVAL_LABELS, resolveLang, SHORT_INTERVAL_LABELS, t } from '../js/i18n.js';
import { POPULAR_PROGRESSIONS, selectProgression, setProgressionVisualCallback } from '../js/progressions.js';
import { getState, setState } from '../js/state.js';
import { getBackingTrackDestination, getDrumDestination, getMasterOutputNode, setBackingTrackVolume } from '../js/audio-core.js';
import {
  dbToMeterRatio, linearPeakToDb, readLiveMasterMeter, getMasterCompPreset,
  buildFilteredVoiceSamples, getVoiceFilterPreset, getCurrentPreviewPositionSec, getStudioVoicePeaks,
  cancelDemoCountIn, isDemoCountIn, isDemoRecording, isDemoRecordingOrCountIn,
  renderFinalMixBuffer, renderFinalMixWav, startDemoPreviewPlayback, stopDemoPreviewPlayback,
  startDemoRecording, stopDemoRecording, updateLivePreviewMix
} from '../js/demo-recorder.js';
import { measureAcousticLagFromCountIn } from '../js/voice-filter.js';
import { encodeShortVideo, VIDEO_STYLES } from '../js/short-video.js';
import { startHumanizedVoiceGroup } from '../js/synth-presets.js';
import { initKeyboardUI } from '../js/ui-keyboard.js';
import {
  exportLooperSnapshot,
  extractTempoFromFilename,
  getDebugTelemetry,
  getLoadedBackingTrackBuffer,
  hasLoadedBackingTrack,
  importLooperSnapshot,
  loadLooperAudioBuffer,
  loadLooperAudioFile,
  onBpmChanged,
  pressLooperClear,
  pressLooperPlayStop,
  pressLooperRec,
  startArmedTransportAt,
  stopAllTransportForPlayback,
  toggleDrumPlayback,
  toggleProgressionPlayback
} from '../js/clock-looper.js';
import {
  buildSessionPayload,
  deleteSession,
  listSessions,
  loadSession,
  renameSession,
  saveCurrentSession
} from '../js/sessions.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function replaceGlobal(context, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

const andalusian = CUSTOM_SCALE_PRESETS.find(({ id }) => id === 'andalusian');

test('la escala Custom transpone la Cadencia Andaluza de La m a Si m', () => {
  const a = getDiatonicDegrees(9, 'custom', 0, andalusian.degrees);
  const b = getDiatonicDegrees(11, 'custom', 0, andalusian.degrees);

  assert.deepEqual(a.map(degree => degree.chordLabel), ['Lam', 'Sim', 'Do', 'Rem', 'Mi', 'Fa', 'Sol']);
  assert.deepEqual(b.map(degree => degree.chordLabel), ['Sim', 'Do#m', 'Re', 'Mim', 'Fa#', 'Sol', 'La']);
  assert.deepEqual(a.map(degree => degree.roman), ROMAN_DEGREES);
  assert.deepEqual(a.map(degree => degree.intervalRoman), ['I', 'II', 'bIII', 'IV', 'V', 'bVI', 'bVII']);
  assert.deepEqual(b.map(degree => degree.intervalRoman), a.map(degree => degree.intervalRoman));
  assert.deepEqual(b.map(degree => degree.intervalSemitones), [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(b.map(degree => degree.triadMidi), a.map(degree => degree.triadMidi.map(note => note + 2)));

  const state = { rootSemitone: 9, scaleMode: 'custom', octaveOffset: 0, customScale: andalusian.degrees, notation: 'letter' };
  assert.deepEqual(getDegreeTriggerNotes(4, { ...state, playMode: 'chord' }), [76, 80, 83]);
  assert.deepEqual(getDegreeTriggerNotes(4, { ...state, playMode: 'melody' }), [76]);
});

test('los ocho presets y las escalas guardadas solo producen tríadas M o m', () => {
  const expected = {
    major: ['0M', '2m', '4m', '5M', '7M', '9m', '11m'],
    minor: ['0m', '2m', '3M', '5m', '7m', '8M', '10M'],
    andalusian: ['0m', '2m', '3M', '5m', '7M', '8M', '10M'],
    harmonic_minor: ['0m', '2m', '3M', '5m', '7M', '8M', '11m'],
    dorian: ['0m', '2m', '3M', '5M', '7m', '9m', '10M'],
    mixolydian: ['0M', '2m', '4m', '5M', '7m', '9m', '10M'],
    epic_ballad: ['0M', '2m', '4m', '5m', '7M', '8M', '10M'],
    lydian: ['0M', '2M', '4m', '6m', '7M', '9m', '11m']
  };
  assert.equal(CUSTOM_SCALE_PRESETS.length, 8);
  assert.deepEqual(VALID_CUSTOM_QUALITIES, ['M', 'm']);
  for (const { id, degrees } of CUSTOM_SCALE_PRESETS) {
    assert.deepEqual(degrees.map(({ semitones, quality }) => `${semitones}${quality}`), expected[id]);
  }

  const cleaned = sanitizeCustomScale([
    { semitones: 11, quality: 'M7' },
    { semitones: -1, quality: 'M' },
    { semitones: 1.5, quality: 'sus4' },
    { semitones: 12, quality: 'aug' },
    { semitones: 8, quality: 'dim' },
    { semitones: 0, quality: 'm' },
    { semitones: '3', quality: '7' },
    { semitones: 0, quality: 'M' }
  ]);
  assert.deepEqual(cleaned, [
    { semitones: 11, quality: 'M' },
    { semitones: 2, quality: 'M' },
    { semitones: 4, quality: 'm' },
    { semitones: 5, quality: 'M' },
    { semitones: 8, quality: 'm' },
    { semitones: 0, quality: 'm' },
    { semitones: 11, quality: 'm' }
  ]);
  assert.deepEqual(sanitizeCustomScale(null), CUSTOM_SCALE_PRESETS[0].degrees);
  assert.notEqual(sanitizeCustomScale(null)[0], CUSTOM_SCALE_PRESETS[0].degrees[0]);
  assert.deepEqual(getDiatonicDegrees(0, 'M')[6].triadMidi, [71, 74, 78]);
  assert.deepEqual(getDiatonicDegrees(0, 'm')[1].triadMidi, [62, 65, 69]);
});

test('la notación solfeo y por letras cambia las etiquetas y conserva el MIDI', () => {
  assert.equal(getNoteNameUpper(1), 'DO#');
  assert.equal(getNoteNameTitle(1), 'Do#');
  assert.equal(getNoteNameUpper(13, 'letter'), 'C#');
  assert.equal(getNoteNameTitle(-1, 'letter'), 'B');
  assert.equal(formatChordLabel(11, 'm', 'letter'), 'Bm');
  assert.equal(getRelativePair(9, 'm').combinedLabel, 'Do M / La m');
  assert.equal(getRelativePair(9, 'm', 'letter').combinedLabel, 'C M / A m');

  const solfege = getDiatonicDegrees(0, 'M', 1);
  const letter = getDiatonicDegrees(0, 'M', 1, null, 'letter');
  assert.equal(solfege[0].melodyLabel, 'Do5');
  assert.equal(letter[0].melodyLabel, 'C5');
  assert.deepEqual(letter.map(degree => degree.triadMidi), solfege.map(degree => degree.triadMidi));
});

test('el idioma automático detecta es* y usa español si no existe navigator', context => {
  replaceGlobal(context, 'navigator', undefined);
  assert.equal(detectSystemLang(), 'es');
  assert.equal(resolveLang('auto'), 'es');
  assert.equal(resolveLang('en'), 'en');
  globalThis.navigator = { language: 'es-MX' };
  assert.equal(detectSystemLang(), 'es');
  globalThis.navigator = { language: 'fr-FR' };
  assert.equal(resolveLang('auto'), 'en');
  assert.equal(resolveLang('es'), 'es');
});

test('las familias de textos, los siete pasos y los doce intervalos están disponibles en español e inglés', () => {
  const translations = [
    ['header.help', 'Ayuda', 'Help'],
    ['bank.title', 'BANCO 50 → 9', 'BANK 50 → 9'],
    ['bank.config', 'CONFIG', 'SETTINGS'],
    ['custom.presets.andalusian.name', 'Cadencia Andaluza', 'Andalusian Cadence'],
    ['config.notation', 'Notación musical', 'Note notation'],
    ['studio.filter', 'Filtro voz', 'Voice filter'],
    ['studio.seekHint', 'Toca la onda para saltar a cualquier punto.', 'Tap the waveform to jump to any point.'],
    ['config.camera.on', 'Cámara frontal activada', 'Front camera on'],
    ['progressions.reggaeton.name', 'Urbano / Reggaeton', 'Urban / Reggaeton'],
    ['sessions.save', 'Guardar canción', 'Save song'],
    ['tonality.title', 'DETECTOR DE TONALIDAD (20s)', 'KEY DETECTOR (20s)'],
    ['studio.video.share', 'Compartir vídeo', 'Share video'],
    ['help.tutorial', 'Tutorial interactivo', 'Interactive Tutorial']
  ];
  for (const [key, es, en] of translations) {
    assert.equal(t(key, 'es'), es);
    assert.equal(t(key, 'en'), en);
  }
  for (let step = 1; step <= 7; step++) {
    for (const part of ['title', 'body']) {
      const key = `tutorial.${step}.${part}`;
      assert.notEqual(t(key, 'es'), key);
      assert.notEqual(t(key, 'en'), t(key, 'es'));
    }
  }
  assert.equal(t('tutorial.progress', 'es', { step: 2, total: 7 }), 'Paso 2 de 7');
  assert.equal(t('tutorial.progress', 'en', { step: 2, total: 7 }), 'Step 2 of 7');
  assert.equal(t('unknown.key', 'en'), 'unknown.key');
  assert.deepEqual(INTERVAL_LABELS.es, [
    'Unísono (1ª)', '2ª menor', '2ª mayor', '3ª menor', '3ª mayor', '4ª justa',
    'Tritono', '5ª justa', '6ª menor', '6ª mayor', '7ª menor', '7ª mayor'
  ]);
  assert.deepEqual(INTERVAL_LABELS.en, [
    'Unison (1st)', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th',
    'Tritone', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th'
  ]);
  assert.deepEqual(INTERVAL_ROMANS, ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII']);
  assert.equal(SHORT_INTERVAL_LABELS.es.length, INTERVAL_ROMANS.length);
  assert.equal(SHORT_INTERVAL_LABELS.en.length, INTERVAL_ROMANS.length);
  assert.equal(SHORT_INTERVAL_LABELS.es[7], '5ªJ');
  assert.equal(SHORT_INTERVAL_LABELS.en[7], 'P5');
});

test('hay 16 progresiones únicas con grados del 0 al 6 y selección circular', context => {
  const previous = getState().progressionIndex;
  context.after(() => setState({ progressionIndex: previous }));
  assert.equal(POPULAR_PROGRESSIONS.length, 16);
  assert.equal(new Set(POPULAR_PROGRESSIONS.map(prog => prog.id)).size, 16);
  assert.equal(new Set(POPULAR_PROGRESSIONS.map(prog => prog.roman)).size, 16);
  for (const prog of POPULAR_PROGRESSIONS) {
    assert.ok(prog.nameEs && prog.nameEn && prog.genreEs && prog.genreEn);
    assert.ok(prog.degrees.every(degree => Number.isInteger(degree) && degree >= 0 && degree <= 6));
    assert.equal(prog.roman, prog.degrees.map(degree => ROMAN_DEGREES[degree]).join(' - '));
  }
  assert.deepEqual(POPULAR_PROGRESSIONS[2].degrees, [0, 6, 5, 4]);
  assert.deepEqual(POPULAR_PROGRESSIONS[8].degrees, [0, 5, 2, 6]);
  assert.equal(selectProgression(-1, true), -1);
  assert.equal(getState().progressionIndex, -1);
  assert.equal(selectProgression(1), 0);
  assert.equal(selectProgression(-1), -1);
  assert.equal(selectProgression(-1), 15);
  assert.equal(selectProgression(1), -1);
  assert.equal(selectProgression(1), 0);
  assert.equal(selectProgression(15), 15);
  setState({ progressionIndex: 16 });
  assert.equal(getState().progressionIndex, 15);
});

test('la claqueta detecta 118 ms sobre ruido suave y descarta el silencio y un ataque aislado', () => {
  const rate = 48000;
  const offsets = [0, 31703, 63405, 95108];
  const lagSamples = Math.round(0.118 * rate);
  const length = offsets.at(-1) + Math.round(0.35 * rate);
  let seed = 314159;
  const room = Float32Array.from({ length }, (_, i) => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return 0.00035 * (2 * seed / 0x100000000 - 1) + 0.002 * Math.sin(2 * Math.PI * 50 * i / rate);
  });
  const addClick = (offset, gain) => {
    room[offset + lagSamples] += gain;
    room[offset + lagSamples + 3] -= gain * 0.5;
  };
  const silent = measureAcousticLagFromCountIn(new Float32Array(length), offsets, rate);
  assert.deepEqual(silent, { detected: false, lagMs: null, offsetMs: null, bleedDetected: false, confidence: 0 });
  assert.equal(measureAcousticLagFromCountIn(room, offsets, rate).detected, false);
  addClick(offsets[0], 0.34);
  assert.equal(measureAcousticLagFromCountIn(room, offsets, rate).detected, false);
  for (const offset of offsets.slice(1)) addClick(offset, 0.18);
  const calibration = measureAcousticLagFromCountIn(room, offsets, rate);
  assert.equal(calibration.detected, true);
  assert.equal(calibration.bleedDetected, true);
  assert.ok(calibration.confidence >= 3.2);
  assert.ok(Math.abs(calibration.lagMs - 118) <= 2);
  assert.ok(calibration.offsetMs >= -120 && calibration.offsetMs <= -116);
  assert.equal(calibration.offsetMs, -calibration.lagMs);

  const shapedClicks = new Float32Array(length);
  for (const [beat, offset] of offsets.entries()) {
    let phase = 0;
    for (let i = 0; i < 0.048 * rate; i++) {
      const time = i / rate;
      const peak = beat === 0 ? 0.45 : 0.26;
      const gain = time < 0.002
        ? peak * time / 0.002
        : peak * (0.0001 / peak) ** ((time - 0.002) / 0.04);
      shapedClicks[offset + lagSamples + i] = gain * (1 - 4 * Math.abs(phase % 1 - 0.5));
      phase += (beat === 0 ? 1320 : 880) * 0.55 ** (Math.min(time, 0.035) / 0.035) / rate;
    }
  }
  const shaped = measureAcousticLagFromCountIn(shapedClicks, offsets, rate);
  assert.equal(shaped.detected, true);
  assert.ok(Math.abs(shaped.lagMs - 118) <= 1);
});

test('el filtro de voz tiene cuatro presets independientes de la captura', () => {
  const expected = [
    { bleedStrength: 0, noiseStrength: 0, minGain: 1, roomDecay: 0, highpassHz: 40, deMudDb: 0, presenceDb: 0, lowpassHz: 20000 },
    { bleedStrength: 0.75, noiseStrength: 0.55, minGain: 0.28, roomDecay: 0.45, highpassHz: 95, deMudDb: -2, presenceDb: 1.5, lowpassHz: 15000 },
    { bleedStrength: 1.35, noiseStrength: 0.90, minGain: 0.11, roomDecay: 0.55, highpassHz: 135, deMudDb: -3.5, presenceDb: 2.8, lowpassHz: 12000 },
    { bleedStrength: 2.15, noiseStrength: 1.25, minGain: 0.035, roomDecay: 0.65, highpassHz: 175, deMudDb: -5, presenceDb: 4, lowpassHz: 9500 }
  ];
  for (const [level, preset] of expected.entries()) assert.deepEqual(getVoiceFilterPreset(level), preset);
  getVoiceFilterPreset(0).highpassHz = 80;
  assert.deepEqual(getVoiceFilterPreset(0), expected[0]);
  assert.deepEqual(getVoiceFilterPreset(4), expected[0]);
});

test('la STFT conserva los bits del nivel 0 y separa el sangrado de la voz simultánea', () => {
  const bits = new Uint32Array([0x3e800000, 0x80000000, 0x7fc12345, 0x00000001]);
  const bypass = buildFilteredVoiceSamples(new Float32Array(bits.buffer), null, 48000, 0);
  assert.notEqual(bypass.buffer, bits.buffer);
  assert.deepEqual(new Uint32Array(bypass.buffer), bits);

  for (const rate of [48000, 16000]) {
    const tone = (i, hz) => Math.sin(2 * Math.PI * hz * i / rate);
    const delaySamples = Math.round(0.118 * rate);
    const music = Float32Array.from({ length: rate * 4 }, (_, i) => 0.4 * Math.SQRT2 * tone(i, 440));
    const raw = music.map((_, i) => 0.3 * (music[i - delaySamples] ?? 0)
      + (i >= rate ? 0.15 * Math.SQRT2 * tone(i, 1100) : 0));
    const before = raw.slice();
    const filtered = buildFilteredVoiceSamples(raw, music, rate, 3, -118);
    assert.equal(filtered.length, raw.length);
    assert.deepEqual(raw, before);
    assert.deepEqual(new Uint32Array(buildFilteredVoiceSamples(raw, music, rate, 0).buffer), new Uint32Array(raw.buffer));

    // Proyección en cuadratura para medir cada banda sin confundir energía con fase.
    const bandRms = (samples, hz, startSec, endSec) => {
      let sine = 0;
      let cosine = 0;
      for (let i = rate * startSec; i < rate * endSec; i++) {
        sine += samples[i] * tone(i, hz);
        cosine += samples[i] * Math.cos(2 * Math.PI * hz * i / rate);
      }
      return Math.SQRT2 * Math.hypot(sine, cosine) / (rate * (endSec - startSec));
    };
    const gain = (hz, start, end) => bandRms(filtered, hz, start, end) / bandRms(raw, hz, start, end);
    assert.ok(Math.abs(bandRms(raw, 440, 1.5, 3.5) - 0.12) < 1e-6);
    assert.ok(Math.abs(bandRms(raw, 1100, 1.5, 3.5) - 0.15) < 1e-6);
    assert.ok(20 * Math.log10(gain(440, 1.5, 3.5)) <= -12, `sangrado durante la voz a ${rate} Hz`);
    assert.ok(gain(1100, 1.5, 3.5) ** 2 >= 0.70, `energía vocal a ${rate} Hz`);
    assert.ok(20 * Math.log10(gain(440, 0.35, 0.7)) <= -14, `sangrado sin voz a ${rate} Hz`);
  }
});

test('el AudioWorklet separa el micro de la precuenta y vacía la toma hasta el fotograma de Stop', async () => {
  const recorder = await readFile(new URL('../js/demo-recorder.js', import.meta.url), 'utf8');
  const code = recorder.match(/const MULTITRACK_WORKLET_CODE = `([\s\S]*?)`;/)[1];
  const messages = [];
  let processor;
  const scope = {
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = {
        postMessage(message, transfer = []) {
          messages.push(structuredClone(message, { transfer }));
          if (transfer.length) assert.equal(transfer[0].byteLength, 0);
        }
      };
    },
    registerProcessor(name, Type) {
      assert.equal(name, 'orbita-multitrack-recorder');
      processor = new Type();
    }
  };
  runInNewContext(code, scope);
  const quantum = Array.from({ length: 3 }, (_, channel) => new Float32Array(128).fill(channel + 1));
  processor.port.onmessage({ data: { type: 'start', frame: 132, countIn: { startFrame: 5, endFrame: 132 } } });
  for (let i = 0; i < 33; i++) {
    scope.currentFrame = i * 128;
    assert.equal(processor.process([quantum]), true);
  }
  const [calibration] = messages;
  assert.equal(messages.length, 1);
  assert.deepEqual(Object.keys(calibration), ['type', 'frame', 'samples']);
  assert.equal(calibration.type, 'count-in-voice');
  assert.equal(calibration.frame, 5);
  assert.equal(calibration.samples.length, 127);
  assert.ok(calibration.samples.every(sample => sample === 3));
  scope.currentFrame += 128;
  processor.process([quantum]);
  assert.equal(messages.length, 2);
  const full = messages[1];
  assert.equal(full.frame, 132);
  assert.equal(full.length, 4096);
  assert.equal(full.mL.buffer.byteLength, 3 * 4096 * Float32Array.BYTES_PER_ELEMENT);
  for (const [i, channel] of [full.mL, full.mR, full.vM].entries()) {
    assert.equal(channel.buffer, full.mL.buffer);
    assert.ok(channel.every(sample => sample === i + 1));
  }
  const endFrame = scope.currentFrame + 140;
  processor.port.onmessage({ data: { type: 'flush', frame: endFrame } });
  assert.equal(messages.length, 2);
  scope.currentFrame += 128;
  assert.equal(processor.process([quantum]), false);
  const [, , partial, ack] = messages;
  assert.equal(partial.frame, full.frame + full.length);
  assert.equal(partial.length, endFrame - partial.frame);
  assert.ok(partial.vM.subarray(0, partial.length).every(sample => sample === 3));
  assert.equal(ack.type, 'flushed');
});

test('el vídeo corto ofrece cuatro estilos en orden de intensidad', () => {
  assert.deepEqual(VIDEO_STYLES, ['pure', 'keys', 'orbit', 'cosmos']);
});

test('el tempo del nombre de archivo exige una etiqueta T y un BPM entre 40 y 220', () => {
  for (const [filename, bpm] of [
    ['orbita-maqueta-T120-20261124.mp3', 120], ['tema_t92.wav', 92], ['T140.mp3', 140],
    ['demo T88.mp3', 88], ['T40.wav', 40], ['tema-T220.ogg', 220]
  ]) assert.equal(extractTempoFromFilename(filename), bpm, filename);
  for (const filename of ['BEAT120.mp3', 'tema-T999.mp3', 'tema-T20.mp3', 'sin-tempo.mp3', 'T1200.mp3']) {
    assert.equal(extractTempoFromFilename(filename), null, filename);
  }
});

test('el estado inicial arranca seco y guarda preferencias, excluyendo la reproducción activa', async context => {
  const storage = memoryStorage();
  replaceGlobal(context, 'localStorage', storage);
  const initial = await import('../js/state.js?config-initial');
  const defaults = initial.getState();
  assert.equal(defaults.scaleMode, 'M');
  assert.deepEqual(defaults.customScale, CUSTOM_SCALE_PRESETS[0].degrees);
  assert.equal(defaults.customPresetId, 'major');
  assert.equal(defaults.lang, 'auto');
  assert.equal(defaults.notation, 'solfege');
  assert.equal(defaults.reverbLevel, 0);
  assert.equal(defaults.micFilterLevel, 0);
  assert.equal(defaults.backingTrackVol, 0.90);
  assert.equal(defaults.cameraEnabled, false);
  assert.equal(defaults.progressionIndex, -1);
  assert.equal(defaults.progressionPlaying, false);
  assert.equal(defaults.tutorialDone, false);
  const emptyTrack = { loadedTrackName: '', loadedTrackDuration: 0, backingTrackPlaying: false };
  for (const [key, value] of Object.entries(emptyTrack)) assert.equal(defaults[key], value);

  const preferences = {
    scaleMode: 'custom', customScale: andalusian.degrees, customPresetId: 'andalusian',
    lang: 'en', notation: 'letter', micFilterLevel: 3, cameraEnabled: true,
    progressionIndex: 15, tutorialDone: true, backingTrackVol: 1.25
  };
  initial.setState({ ...preferences, progressionPlaying: true, reverbLevel: 3,
    loadedTrackName: 'maqueta.mp3', loadedTrackDuration: 34, backingTrackPlaying: true });
  const stored = JSON.parse(storage.getItem('orbita_v2_config_v1'));
  assert.equal(Object.hasOwn(stored, 'progressionPlaying'), false);
  assert.equal(Object.hasOwn(stored, 'reverbLevel'), false);
  const restored = (await import('../js/state.js?config-restored')).getState();
  for (const [key, value] of Object.entries(preferences)) assert.deepEqual(restored[key], value);
  assert.equal(restored.progressionPlaying, false);
  assert.equal(restored.reverbLevel, 0);
  for (const [key, value] of Object.entries(emptyTrack)) {
    assert.equal(Object.hasOwn(stored, key), false);
    assert.equal(restored[key], value);
  }
  initial.setState({ progressionIndex: -1 });
  assert.equal((await import('../js/state.js?config-no-progression')).getState().progressionIndex, -1);
});

function loopAt120() {
  return {
    version: 1, bpm: 120, loopBars: 2, loopDurationSec: 4,
    events: [{ id: 'note', degreeIndex: 4, offsetSec: 0.5, durationSec: 0.25,
      notes: [69, 73, 76], presetId: 5, humanize: 2, velocity: 0.8 }]
  };
}

function resetMusicAfter(context) {
  const original = { ...getState() };
  context.after(() => {
    stopAllTransportForPlayback();
    pressLooperClear();
    setState(original);
  });
}

test('el looper restaura eventos válidos al BPM actual, sin arrancar y sin compartir referencias', context => {
  resetMusicAfter(context);
  setState({ bpm: 60 });
  const snapshot = loopAt120();
  snapshot.events.push({ notes: [], offsetSec: NaN, durationSec: 1 });
  importLooperSnapshot(snapshot);

  const exported = exportLooperSnapshot();
  assert.deepEqual(exported, {
    ...loopAt120(), bpm: 60, loopDurationSec: 8,
    events: [{ ...snapshot.events[0], offsetSec: 1, durationSec: 0.5 }]
  });
  assert.equal(getState().looperState, 'idle');
  assert.equal(getState().loopBars, 2);
  assert.equal(getDebugTelemetry().running, false);
  exported.events[0].notes[0] = 0;
  snapshot.events[0].notes[0] = 1;
  assert.equal(exportLooperSnapshot().events[0].notes[0], 69);

  importLooperSnapshot({ ...snapshot, events: [] });
  assert.equal(exportLooperSnapshot(), null);
  assert.equal(getState().loopBars, 0);
});

test('las sesiones se guardan, ordenan, renombran, cargan y borran con un storage en memoria', context => {
  resetMusicAfter(context);
  const storage = memoryStorage();
  const isolatedStorage = memoryStorage();
  const musicalState = {
    rootSemitone: 9, scaleMode: 'custom', customScale: andalusian.degrees, customPresetId: 'andalusian',
    playMode: 'melody', humanize: 2, reverbLevel: 3, accompaniment: 2, selectedAccompaniments: [4, 7],
    octaveOffset: -1, activeSoundSlot: 1, selectedSounds: [5, 9], bpm: 120,
    activeDrumSlot: 1, selectedDrums: [3, 8], yAxisMode: 'drive', keyStrike: false, progressionIndex: 2
  };
  setState(musicalState);
  importLooperSnapshot(loopAt120());

  const snapshot = exportLooperSnapshot();
  const payload = buildSessionPayload('  Prueba  ', getState(), snapshot);
  assert.deepEqual(payload, { name: 'Prueba', ...musicalState, looperSnapshot: loopAt120() });
  snapshot.events[0].notes.push(80);
  assert.deepEqual(payload.looperSnapshot, loopAt120());
  assert.notEqual(payload.selectedSounds, getState().selectedSounds);

  const saved = saveCurrentSession('  Prueba  ', storage);
  assert.deepEqual(saved.looperSnapshot, loopAt120());
  assert.ok(storage.getItem('orbita_v2_sessions_v1'));
  assert.deepEqual(listSessions(isolatedStorage), []);
  storage.setItem('orbita_v2_sessions_v1', JSON.stringify([{ ...saved, updatedAt: '2000-01-01T00:00:00.000Z' }]));

  importLooperSnapshot(null);
  setState({ progressionIndex: -1 });
  const second = saveCurrentSession('Segunda', storage);
  assert.equal(second.progressionIndex, -1);
  assert.equal(second.looperSnapshot, null);
  assert.deepEqual(listSessions(storage).map(record => record.id), [second.id, saved.id]);

  const renamed = renameSession(saved.id, '  Cadencia  ', storage);
  assert.equal(renamed.name, 'Cadencia');
  assert.equal(renamed.createdAt, saved.createdAt);
  assert.deepEqual(renamed.looperSnapshot, loopAt120());
  assert.deepEqual(listSessions(storage).map(record => record.name), ['Cadencia', 'Segunda']);

  setState({ rootSemitone: 0, scaleMode: 'M', bpm: 80, reverbLevel: 0, progressionPlaying: true });
  assert.deepEqual(loadSession(saved.id, storage), renamed);
  for (const [key, value] of Object.entries(musicalState)) assert.deepEqual(getState()[key], value);
  assert.deepEqual(exportLooperSnapshot(), loopAt120());
  assert.equal(getState().progressionPlaying, false);
  assert.equal(getState().looperState, 'idle');
  assert.equal(getDebugTelemetry().running, false);
  assert.equal(loadSession(second.id, storage).progressionIndex, -1);
  assert.equal(getState().progressionIndex, -1);
  assert.equal(buildSessionPayload('Sesión anterior', {}, null).progressionIndex, -1);

  assert.equal(deleteSession(saved.id, storage), true);
  assert.equal(deleteSession(saved.id, storage), false);
  assert.equal(loadSession(saved.id, storage), null);
  assert.equal(renameSession(saved.id, 'Ya borrada', storage), null);
  assert.deepEqual(listSessions(storage), [second]);
});

class TestAudioParam {
  value = 0;
  targets = [];

  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
  setTargetAtTime(value, time, timeConstant) { this.targets.push({ value, time, timeConstant }); }
}

class TestAudioNode extends EventTarget {
  connections = [];
  stopTimes = [];

  constructor(kind, paramNames = []) {
    super();
    this.kind = kind;
    for (const name of paramNames) this[name] = new TestAudioParam();
  }

  connect(node) { this.connections.push(node); return node; }
  disconnect(node) { this.connections = node ? this.connections.filter(connection => connection !== node) : []; }
  start(time, offset, duration) { Object.assign(this, { startTime: time, offset, duration }); }
  stop(time) { this.stopTimes.push(time); }
}

class TestAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    Object.assign(this, { numberOfChannels, length, sampleRate, duration: length / sampleRate });
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
  copyToChannel(samples, channel) { this.channels[channel].set(samples); }
}

test('COMP ofrece bypass lineal, dos compresiones y un limitador con soft-clip', () => {
  const expected = [
    null,
    { threshold: -4, knee: 18, ratio: 3, attack: 0.008, release: 0.18, softClip: false },
    { threshold: -2, knee: 10, ratio: 8, attack: 0.004, release: 0.14, softClip: false },
    { threshold: -1, knee: 4, ratio: 16, attack: 0.002, release: 0.10, softClip: true }
  ];
  for (const [level, preset] of expected.entries()) assert.deepEqual(getMasterCompPreset(level), preset);
  getMasterCompPreset(3).ratio = 1;
  assert.deepEqual(getMasterCompPreset(3), expected[3]);
});

test('la escala Master reserva seis segmentos por encima de la raya de 0 dB', () => {
  assert.equal(linearPeakToDb(1), 0);
  assert.equal(dbToMeterRatio(linearPeakToDb(1)), 36 / 42);
  assert.equal(linearPeakToDb(2).toFixed(2), '6.02');
  assert.equal(dbToMeterRatio(linearPeakToDb(2)), 1);
  assert.equal(linearPeakToDb(0.5).toFixed(2), '-6.02');
  assert.equal(linearPeakToDb(0), -Infinity);
  assert.equal(dbToMeterRatio(linearPeakToDb(0)), 0);
  assert.equal(dbToMeterRatio(-36), 0);
  assert.ok(dbToMeterRatio(0.1) > dbToMeterRatio(0));
});

function mockAudioTimeouts(context, audio) {
  const timers = new Map();
  let nextId = 0;
  context.mock.method(globalThis, 'setTimeout', (callback, delay = 0) => {
    const id = ++nextId;
    timers.set(id, { callback, time: audio.currentTime + delay / 1000 });
    return id;
  });
  context.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  return function advanceAudioTo(time) {
    while (timers.size > 0) {
      const [id, timer] = [...timers].sort(([, a], [, b]) => a.time - b.time)[0];
      if (timer.time > time) break;
      timers.delete(id);
      audio.currentTime = timer.time;
      timer.callback();
    }
    audio.currentTime = time;
  };
}

test('la progresión mantiene sus tríadas en octava 0 al cambiar a Melodía en +2, con o sin acompañamiento', async context => {
  resetMusicAfter(context);
  let audio;
  replaceGlobal(context, 'window', {
    AudioContext: class {
      currentTime = 10;
      sampleRate = 1000;
      state = 'running';
      destination = new TestAudioNode('output');
      nodes = [];

      constructor() { audio = this; }
      addNode(kind, params) {
        const node = new TestAudioNode(kind, params);
        this.nodes.push(node);
        return node;
      }

      createGain() { return this.addNode('gain', ['gain']); }
      createBiquadFilter() { return this.addNode('filter', ['frequency', 'Q', 'gain']); }
      createWaveShaper() { return this.addNode('waveshaper'); }
      createConvolver() { return this.addNode('convolver'); }
      createDynamicsCompressor() {
        return this.addNode('compressor', ['threshold', 'knee', 'ratio', 'attack', 'release']);
      }
      createOscillator() { return this.addNode('oscillator', ['frequency']); }
      createBuffer(channels, length, rate = this.sampleRate) { return new TestAudioBuffer(channels, length, rate); }
      createBufferSource() { return this.addNode('bufferSource'); }
      createChannelMerger() { return this.addNode('merger'); }
      createChannelSplitter() { return this.addNode('splitter'); }
      createDelay() { return this.addNode('delay', ['delayTime']); }
      createMediaStreamSource() { return this.addNode('mic'); }
      createAnalyser() {
        return Object.assign(this.addNode('analyser'), { frequencyBinCount: 2048, getFloatTimeDomainData() {} });
      }
      createMediaStreamDestination() {
        const track = { stop() {} };
        return Object.assign(this.addNode('stream'), {
          stream: { getTracks: () => [track], getAudioTracks: () => [track] }
        });
      }
    }
  });
  let schedulerTick;
  let recordingTick;
  context.mock.method(globalThis, 'setInterval', (callback, delay) => {
    if (delay === 20) schedulerTick = callback;
    else if (delay === 250) recordingTick = callback;
    return delay;
  });
  context.mock.method(globalThis, 'clearInterval', id => {
    if (id === 20) schedulerTick = null;
    else if (id === 250) recordingTick = null;
  });

  const visual = [];
  setProgressionVisualCallback(degree => visual.push(degree));
  const oscillators = () => audio.nodes.filter(node => node.kind === 'oscillator');
  const atTime = (nodes, when) => nodes.filter(node => Math.abs(node.startTime - when) < 1e-9);
  const pitches = nodes => nodes.filter(node => node.connections[0]?.kind === 'filter').map(node => node.frequency.value);

  try {
    setState({
      rootSemitone: 0, scaleMode: 'M', octaveOffset: 0, bpm: 120,
      accompaniment: 0, playMode: 'chord', humanize: 0, selectedSounds: [3], activeSoundSlot: 0,
      reverbLevel: 0, progressionIndex: -1, metronomeEnabled: true
    });
    assert.equal(getDebugTelemetry().running, false);
    assert.equal(audio, undefined);

    toggleProgressionPlayback();
    assert.equal(getState().progressionIndex, 0);
    assert.equal(getState().progressionPlaying, true);
    assert.equal(getDebugTelemetry().running, true);
    assert.deepEqual(getDrumDestination().connections, [getMasterOutputNode()]);
    const reverbSend = audio.nodes.find(node => node.connections.some(target => target.kind === 'convolver'));
    assert.equal(reverbSend.gain.value, 0);
    const downbeat = atTime(oscillators(), 10.01);
    const [click, root] = downbeat;
    assert.equal(click.frequency.value, 1320);
    assert.deepEqual(pitches(downbeat), [60, 64, 67].map(midiToFreq));
    const [filter] = root.connections;
    const [envGain] = filter.connections;
    const [releaseGain] = envGain.connections;
    assert.equal(envGain.kind, 'gain');
    assert.equal(releaseGain.kind, 'gain');
    assert.ok(Math.abs(releaseGain.gain.targets[0].time - (10.01 + 2 * 0.96)) < 1e-9);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(visual, [0]);

    setState({ playMode: 'melody', octaveOffset: 2 });
    assert.equal(getState().progressionPlaying, true);
    assert.deepEqual(getDegreeTriggerNotes(4, getState()), [91]);
    audio.currentTime = 11.94;
    schedulerTick();
    const secondDownbeat = atTime(oscillators(), 12.01);
    assert.deepEqual(pitches(secondDownbeat), [67, 71, 74].map(midiToFreq));
    const [, secondRoot] = secondDownbeat;
    assert.equal(selectProgression(-1), -1);
    assert.equal(getState().progressionPlaying, false);
    assert.deepEqual(visual, [0, null]);
    assert.equal(getDebugTelemetry().running, false);
    assert.equal(schedulerTick, null);
    assert.deepEqual(secondDownbeat[0].connections[0].connections, []);
    assert.equal(secondDownbeat[0].stopTimes.at(-1), audio.currentTime);
    assert.equal(secondRoot.stopTimes.at(-1), audio.currentTime + 0.005);

    const keyEvents = new Map();
    window.addEventListener = (type, handler) => keyEvents.set(type, handler);
    const element = { addEventListener() {}, setAttribute() {}, classList: { toggle() {} } };
    replaceGlobal(context, 'document', {
      querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => id === 'loop-progress-fill' ? null : element
    });
    initKeyboardUI();
    const pressKey = type => keyEvents.get(type)({ code: 'KeyZ', preventDefault() {} });
    const beforeAccompany = oscillators().length;
    const accompanimentStart = audio.currentTime + 0.01;
    setState({ accompaniment: 1, selectedAccompaniments: [0], keyStrike: true, metronomeEnabled: false });
    toggleProgressionPlayback();
    const firstBeat = oscillators().slice(beforeAccompany);
    assert.deepEqual(pitches(atTime(firstBeat, accompanimentStart)), [60, 64, 67, 60].map(midiToFreq));

    const beforeMelody = oscillators().length;
    pressKey('keydown');
    assert.deepEqual(pitches(oscillators().slice(beforeMelody)), [midiToFreq(84)]);

    audio.currentTime = accompanimentStart + 0.45;
    schedulerTick();
    assert.deepEqual(pitches(atTime(oscillators(), accompanimentStart + 0.5)), [midiToFreq(64)]);
    pressKey('keyup');

    setState({ playMode: 'chord' });
    pressKey('keydown');
    audio.currentTime = accompanimentStart + 0.95;
    schedulerTick();
    assert.deepEqual(pitches(atTime(oscillators(), accompanimentStart + 1)), [91, 67].map(midiToFreq));
    pressKey('keyup');
    setState({ playMode: 'melody' });

    audio.currentTime = accompanimentStart + 1.95;
    schedulerTick();
    const nextBeat = atTime(oscillators().slice(beforeAccompany), accompanimentStart + 2);
    assert.deepEqual(pitches(nextBeat), [67, 71, 74, 67].map(midiToFreq));

    toggleDrumPlayback();
    toggleProgressionPlayback();
    assert.equal(getDebugTelemetry().running, true);
    assert.equal(nextBeat[0].stopTimes.at(-1), audio.currentTime + 0.005);
    assert.equal(nextBeat.at(-1).stopTimes.at(-1), audio.currentTime + 0.005);
    toggleDrumPlayback();
    assert.equal(getDebugTelemetry().running, false);

    const beforeCountIn = oscillators().length;
    pressLooperRec();
    const countIn = oscillators().slice(beforeCountIn);
    assert.equal(countIn.length, 4);
    assert.equal(getDebugTelemetry().countInActive, true);
    stopAllTransportForPlayback();
    assert.equal(getDebugTelemetry().countInActive, false);
    assert.equal(getDebugTelemetry().running, false);
    assert.ok(countIn.every(node => node.stopTimes.at(-1) === audio.currentTime));

    const storage = memoryStorage();
    setState({ reverbLevel: 2 });
    const session = saveCurrentSession('Con reverb', storage);
    setState({ reverbLevel: 0 });
    toggleProgressionPlayback();
    assert.equal(getDebugTelemetry().running, true);
    loadSession(session.id, storage);
    assert.equal(getDebugTelemetry().running, false);
    assert.equal(getState().looperState, 'idle');
    assert.equal(reverbSend.gain.targets.at(-1).value, 0.46);

    await context.test('el lookahead mantiene pasos crecientes al cambiar de 92 a 130 y a 75 BPM', () => {
      const { bpm, metronomeEnabled, selectedDrums, activeDrumSlot } = getState();
      const firstNode = audio.nodes.length;
      const firstOscillator = oscillators().length;
      const stepTimes = () => audio.nodes.slice(firstNode)
        .filter(node => node.kind === 'bufferSource' && node.connections[0]?.frequency?.value === 7200)
        .map(node => node.startTime);
      const stepDuration = bpm => 15 / bpm;
      const origin = audio.currentTime + 0.01;
      let expectedTime = origin;
      const expected = [origin];
      function scheduleSteps(bpm, count) {
        for (let i = 0; i < count; i++) {
          expectedTime += stepDuration(bpm);
          audio.currentTime = expectedTime - 0.06;
          schedulerTick();
          expected.push(expectedTime);
        }
        assert.equal(stepTimes().length, expected.length);
      }
      function changeTempo(bpm) {
        const last = stepTimes().at(-1);
        assert.ok(last > audio.currentTime, 'el último golpe sigue en el lookahead');
        onBpmChanged(bpm);
        schedulerTick();
        assert.equal(stepTimes().length, expected.length, 'no se repite el golpe que ya está programado');
      }

      setState({ bpm: 92, metronomeEnabled: false, selectedDrums: [17], activeDrumSlot: 0 });
      importLooperSnapshot({
        version: 1, bpm: 92, loopBars: 1, loopDurationSec: 240 / 92,
        events: [{ offsetSec: 0, durationSec: 0.1, notes: [60], presetId: 3 }]
      });
      // Un charles cerrado por paso y una nota del looper al inicio de cada vuelta.
      startArmedTransportAt(origin, { drumPlaying: true, looperPlaying: true });
      try {
        scheduleSteps(92, 5);
        changeTempo(130);
        scheduleSteps(130, 6);
        changeTempo(75);
        scheduleSteps(75, 8);
        changeTempo(103);
        scheduleSteps(103, 13);
        const times = stepTimes();
        for (let i = 1; i < times.length; i++) {
          const gap = times[i] - times[i - 1];
          assert.ok(times[i] > times[i - 1], `paso ${i}: el reloj se repitió o retrocedió`);
          assert.ok(Math.abs(gap - (expected[i] - expected[i - 1])) < 1e-9, `paso ${i}: separación de ${gap}s`);
        }
        assert.ok(Math.abs(times[0] - origin) < 1e-9);
        const downbeats = oscillators().slice(firstOscillator)
          .filter(node => node.connections[0]?.kind === 'filter' && node.frequency.value === midiToFreq(60));
        assert.equal(downbeats.length, 3);
        downbeats.forEach((node, i) => assert.ok(Math.abs(node.startTime - times[i * 16]) < 1e-9));
      } finally {
        stopAllTransportForPlayback();
        pressLooperClear();
        setState({ bpm, metronomeEnabled, selectedDrums, activeDrumSlot });
      }
    });

    await context.test('la maqueta hace cuatro clics y relanza batería, looper y progresión en el mismo tiempo 1', async studio => {
      const advanceAudioTo = mockAudioTimeouts(studio, audio);
      setState({ accompaniment: 0, humanize: 0, selectedDrums: [0], activeDrumSlot: 0,
        progressionIndex: 0, metronomeEnabled: false, cameraEnabled: false });
      const loop = loopAt120();
      loop.events = [{ ...loop.events[0], offsetSec: 0, notes: [79], presetId: 3, humanize: 0 }];
      importLooperSnapshot(loop);
      audio.currentTime = 20;
      pressLooperPlayStop();
      assert.deepEqual(pitches(atTime(oscillators(), 20.01)), [midiToFreq(79)]);
      toggleDrumPlayback();
      toggleProgressionPlayback();
      advanceAudioTo(21.96);
      schedulerTick();
      advanceAudioTo(22.02);
      assert.deepEqual(pitches(atTime(oscillators(), 22.01)), [67, 71, 74].map(midiToFreq));
      assert.ok(atTime(oscillators(), 22.01).some(node => node.frequency.value === 148));
      const drumOutput = atTime(oscillators(), 22.01).find(node => node.frequency.value === 148)
        .connections[0].connections[0];
      assert.deepEqual(drumOutput.connections, [getDrumDestination()]);

      const status = [];
      const before = oscillators().length;
      const t0 = audio.currentTime + 0.04;
      const downbeatTime = t0 + 2;
      await startDemoRecording(update => status.push(update));
      await startDemoRecording(() => assert.fail('La llamada duplicada cambió la devolución de estado'));
      assert.equal(isDemoCountIn(), true);
      assert.equal(isDemoRecording(), false);
      assert.equal(isDemoRecordingOrCountIn(), true);
      assert.equal(getDebugTelemetry().running, false);
      assert.equal(getState().drumPlaying, false);
      assert.equal(getState().progressionPlaying, false);
      assert.equal(getState().looperState, 'idle');
      assert.deepEqual(drumOutput.connections, []);
      const clicks = oscillators().slice(before);
      assert.deepEqual(clicks.map(node => node.startTime), [0, 1, 2, 3].map(beat => t0 + beat * 0.5));
      assert.deepEqual(clicks.map(node => node.frequency.value), [1320, 880, 880, 880]);

      for (let beat = 0; beat < 4; beat++) {
        advanceAudioTo(t0 + beat * 0.5 + 0.005);
        assert.equal(getState().currentBeat, beat);
        const cue = status.at(-1);
        assert.equal(cue.countInBeat, beat);
        assert.equal(cue.countInRemaining, 4 - beat);
        assert.equal(cue.countingIn, true);
        assert.equal(cue.recording, false);
      }
      advanceAudioTo(downbeatTime - 0.01);
      assert.equal(isDemoRecording(), false);
      advanceAudioTo(downbeatTime + 0.005);
      assert.equal(isDemoCountIn(), false);
      assert.equal(isDemoRecording(), true);
      assert.equal(getState().currentBeat, 0);
      assert.equal(getState().drumPlaying, true);
      assert.equal(getState().progressionPlaying, true);
      assert.equal(getState().looperState, 'playing');
      assert.equal(getDebugTelemetry().running, true);
      const firstBeat = atTime(oscillators().slice(before + clicks.length), downbeatTime);
      assert.ok(firstBeat.some(node => node.frequency.value === 148));
      assert.deepEqual(pitches(firstBeat), [60, 64, 67, 79].map(midiToFreq));
      assert.equal(status.at(-1).recording, true);
      assert.equal(status.at(-1).elapsedSec, 0);
      advanceAudioTo(downbeatTime + 1.01);
      recordingTick();
      assert.ok(status.at(-1).elapsedSec >= 1);
      await stopDemoRecording();
    });

    await context.test('cancelar la precuenta corta los clics pendientes y libera el micrófono y la cámara', async studio => {
      const advanceAudioTo = mockAudioTimeouts(studio, audio);
      let micStops = 0;
      let cameraStops = 0;
      let cameraStarts = 0;
      let allowCamera;
      let cameraRequested;
      const cameraPermission = new Promise(resolve => { allowCamera = resolve; });
      const waitingForCamera = new Promise(resolve => { cameraRequested = resolve; });
      const micTrack = { stop: () => { micStops++; } };
      const cameraStream = { getTracks: () => [{ stop: () => { cameraStops++; } }] };
      replaceGlobal(studio, 'navigator', { mediaDevices: {
        async getUserMedia(options) {
          if (options.audio) return { getAudioTracks: () => [micTrack], getTracks: () => [micTrack] };
          cameraRequested(options.video);
          return cameraPermission;
        }
      } });
      replaceGlobal(studio, 'MediaRecorder', class extends EventTarget {
        start() { cameraStarts++; }
      });

      setState({ cameraEnabled: true });
      toggleDrumPlayback();
      const masterConnections = [...getMasterOutputNode().connections];
      const before = oscillators().length;
      const status = [];
      const starting = startDemoRecording(update => status.push(update));
      assert.equal((await waitingForCamera).facingMode, 'user');
      assert.equal(isDemoRecordingOrCountIn(), false);
      assert.equal(getState().drumPlaying, true);
      assert.equal(oscillators().length, before);
      allowCamera(cameraStream);
      await starting;
      const clicks = oscillators().slice(before);
      assert.equal(clicks.length, 4);
      advanceAudioTo(clicks[1].startTime + 0.005);
      assert.equal(status.at(-1).countInRemaining, 3);

      cancelDemoCountIn();
      assert.equal(isDemoRecordingOrCountIn(), false);
      assert.equal(getDebugTelemetry().running, false);
      assert.equal(getState().currentBeat, -1);
      assert.equal(micStops, 1);
      assert.equal(cameraStops, 1);
      assert.equal(cameraStarts, 0);
      assert.deepEqual(getMasterOutputNode().connections, masterConnections);
      assert.ok(clicks.slice(2).every(node => node.stopTimes.at(-1) === audio.currentTime &&
        node.connections[0].connections.length === 0));
      const statusCount = status.length;
      advanceAudioTo(audio.currentTime + 3);
      assert.equal(status.length, statusCount);
      assert.deepEqual(status.at(-1), { recording: false, countingIn: false, elapsedSec: 0 });
      assert.equal(getDebugTelemetry().running, false);

      setState({ cameraEnabled: false });
      toggleDrumPlayback();
      const downbeatTime = audio.currentTime + 0.04 + 2;
      await startDemoRecording();
      advanceAudioTo(downbeatTime - 0.01);
      const kick = atTime(oscillators(), downbeatTime).find(node => node.frequency.value === 148);
      assert.ok(kick);
      const pendingDrums = kick.connections[0].connections[0];
      cancelDemoCountIn();
      assert.deepEqual(pendingDrums.connections, []);
      assert.equal(micStops, 2);
      advanceAudioTo(downbeatTime + 0.005);
      assert.equal(isDemoRecordingOrCountIn(), false);
      assert.equal(getDebugTelemetry().running, false);
    });

    await context.test('la grabación conserva la voz cruda y las dos pistas saltan con el desfase exacto', async studio => {
      const advanceAudioTo = mockAudioTimeouts(studio, audio);
      setState({ rootSemitone: 9, scaleMode: 'm', notation: 'solfege', micFilterLevel: 3,
        cameraEnabled: false, metronomeEnabled: true });
      let micOptions;
      let micStopped = false;
      const micTrack = { getSettings: () => ({}), stop: () => { micStopped = true; } };
      replaceGlobal(studio, 'navigator', { mediaDevices: {
        async getUserMedia(options) {
          micOptions = options;
          return { getAudioTracks: () => [micTrack], getTracks: () => [micTrack] };
        }
      } });
      const pip = { hidden: true };
      const live = {};
      replaceGlobal(studio, 'document', { getElementById: id =>
        ({ 'camera-live-video': live, 'camera-live-pip': pip })[id] ?? null });
      replaceGlobal(studio, 'requestAnimationFrame', () => 1);
      replaceGlobal(studio, 'cancelAnimationFrame', () => {});
      audio.audioWorklet = { async addModule() {} };
      let worklet;
      let startCommand;
      replaceGlobal(studio, 'AudioWorkletNode', class extends TestAudioNode {
        port = {
          postMessage: command => {
            if (command.type === 'start') startCommand = command;
            if (command.type === 'flush') queueMicrotask(() => {
              assert.ok(this.port.onmessage, 'el puerto sigue conectado mientras entrega la cola');
              const tail = new Float32Array(24).fill(1);
              tail.fill(0.005, 0, 17);
              this.port.onmessage({ data: { frame: command.frame - 17, mL: tail, mR: tail, vM: tail } });
              this.port.onmessage({ data: { type: 'flushed' } });
            });
          }
        };
        constructor() { super('worklet'); worklet = this; }
      });

      audio.currentTime = 30;
      const before = oscillators().length;
      const startAt = 30.04 + 2;
      await startDemoRecording();
      assert.deepEqual(micOptions, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const micFilter = audio.nodes.filter(node => node.kind === 'mic').at(-1).connections[0];
      assert.equal(micFilter.type, 'highpass');
      assert.equal(micFilter.frequency.value, 40);
      const { startFrame: countStart, endFrame: countEnd } = startCommand.countIn;
      assert.ok(countEnd <= startCommand.frame);
      const countInVoice = new Float32Array(countEnd - countStart);
      for (const click of oscillators().slice(before)) {
        countInVoice[Math.ceil(click.startTime * audio.sampleRate) - countStart + 118] = 0.25;
      }
      worklet.port.onmessage({ data: { type: 'count-in-voice', frame: countStart, samples: countInVoice } });
      advanceAudioTo(startAt + 0.005);
      assert.equal(isDemoRecording(), true);
      assert.equal(getDebugTelemetry().running, false);
      assert.equal(getState().currentBeat, -1);
      assert.equal(oscillators().length - before, 4);
      const captured = new Float32Array(2000).fill(0.005);
      const startFrame = Math.ceil(startAt * audio.sampleRate);
      const precount = new Float32Array(128).fill(1);
      worklet.port.onmessage({ data: { frame: startFrame - 128, mL: precount, mR: precount, vM: precount } });
      const overlapping = new Float32Array(4 + captured.length - 17).fill(1);
      overlapping.set(captured.subarray(0, captured.length - 17), 4);
      worklet.port.onmessage({ data: { frame: startFrame - 4, mL: overlapping, mR: overlapping, vM: overlapping } });
      startHumanizedVoiceGroup([69, 72, 76], {
        when: startAt + 0.125, duration: 0.5, velocity: 0.8, humanize: 3, strumDirection: 'down'
      });
      startHumanizedVoiceGroup([71], { when: startAt + 3, duration: 0.5 });
      startHumanizedVoiceGroup([71], { when: startAt + 1, duration: 0.5 }).stop(null, true);
      advanceAudioTo(startAt + 2);
      const session = await stopDemoRecording();
      assert.ok(micStopped);
      assert.ok(session.countInCalibration.detected);
      assert.equal(session.autoMeasuredOffsetMs, session.countInCalibration.offsetMs);
      assert.ok(Math.abs(session.autoMeasuredOffsetMs + 118) <= 1);
      assert.equal(session.hasBackingTrack, false);
      assert.equal(session.backingBuffer, null);
      assert.equal(worklet.port.onmessage, null);
      assert.deepEqual(session.noteEvents, [{
        timeSec: 0.125, notes: [76, 72, 69], pitchClasses: [4, 0, 9],
        rootPc: 9, label: 'Lam', degreeIndex: 0, durationSec: 0.5, velocity: 0.8
      }]);
      assert.equal(session.keyboardDegrees.length, 7);
      assert.ok(getStudioVoicePeaks({ voiceFilter: 3, voiceOffsetMs: -125 })[100] < session.voicePeaks[100] * 0.1);
      assert.deepEqual(session.musicBuffer.getChannelData(0), captured);
      assert.deepEqual(session.voiceBuffer.getChannelData(0), captured);

      const settings = { voiceFilter: 3, voiceOffsetMs: -125, trimStartSec: 0.4, trimEndSec: 1.4 };
      let ended = 0;
      assert.ok(startDemoPreviewPlayback(settings, null, () => { ended++; }, 0.6));
      const [music, voice] = audio.nodes.filter(node => node.kind === 'bufferSource').slice(-2);
      assert.equal(music.offset, 0.6);
      assert.equal(voice.offset, 0.725);
      assert.equal(voice.startTime, music.startTime);
      assert.notEqual(voice.buffer, session.voiceBuffer);
      const highpasses = audio.nodes.filter(node => node.type === 'highpass' && node.frequency.value === 175);
      assert.equal(highpasses.length, 2);
      assert.equal(highpasses[0].connections[0], highpasses[1]);
      assert.equal(highpasses[1].connections[0].frequency.value, 250);
      assert.equal(highpasses[1].connections[0].connections[0].frequency.value, 3300);
      updateLivePreviewMix({ ...settings, voiceFilter: 2 });
      assert.ok(highpasses.every(node => node.frequency.targets.at(-1).value === 135));
      audio.currentTime = music.startTime + 0.25;
      assert.equal(getCurrentPreviewPositionSec(), 0.85);

      assert.ok(startDemoPreviewPlayback({ ...settings, voiceFilter: 0 }, null, null, 2));
      const [lastMusic, lastVoice] = audio.nodes.filter(node => node.kind === 'bufferSource').slice(-2);
      assert.equal(lastMusic.offset, settings.trimEndSec - 0.05);
      assert.equal(lastVoice.buffer, session.voiceBuffer);
      const [bypassEQ, bypassDirect] = lastVoice.connections[0].connections;
      assert.equal(bypassEQ.type, 'highpass');
      assert.equal(bypassDirect.gain.value, 1);
      assert.equal(ended, 0);
      stopDemoPreviewPlayback();
      assert.equal(getCurrentPreviewPositionSec(), null);

      const online = audio;
      let offline;
      window.OfflineAudioContext = class extends window.AudioContext {
        constructor(channels, frames, sampleRate) {
          super();
          offline = this;
          audio = online;
          this.currentTime = 0;
          this.rendered = this.createBuffer(channels, frames, sampleRate);
        }
        async startRendering() { return this.rendered; }
      };
      const mix = await renderFinalMixBuffer(settings);
      const [exportMusic, exportVoice] = offline.nodes.filter(node => node.kind === 'bufferSource');
      assert.equal(exportMusic.offset, 0.4);
      assert.equal(exportVoice.offset, 0.525);
      assert.equal(exportVoice.buffer, voice.buffer);
      assert.deepEqual(session.voiceBuffer.getChannelData(0), captured);

      setState({ bpm: 126 });
      assert.match((await renderFinalMixWav(settings)).filename, /^orbita-maqueta-T126-\d{8}-\d{4}\.wav$/);
      window.lamejs = { Mp3Encoder: class {
        encodeBuffer() { return Int8Array.of(1); }
        flush() { return new Int8Array(); }
      } };
      try {
        assert.match((await renderFinalMixWav(settings)).filename, /^orbita-maqueta-T126-\d{8}-\d{4}\.mp3$/);
      } finally {
        delete window.lamejs;
      }

      const drawing = {
        createLinearGradient: () => ({ addColorStop() {} }),
        beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, fillText() {},
        moveTo() {}, lineTo() {}, stroke() {}
      };
      globalThis.document.createElement = () => ({
        getContext: () => drawing,
        captureStream: () => ({ addTrack() {}, getTracks: () => [] })
      });
      replaceGlobal(studio, 'MediaRecorder', class extends EventTarget {
        mimeType = 'video/webm';
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['video']) }));
          this.dispatchEvent(new Event('stop'));
        }
      });
      studio.mock.method(audio, 'createBufferSource', () => {
        const source = audio.addNode('bufferSource');
        source.start = () => queueMicrotask(() => source.dispatchEvent(new Event('ended')));
        return source;
      });
      const signal = new AbortController().signal;
      const video = await encodeShortVideo(mix, null, () => {}, signal, session.videoMetadata);
      assert.equal(video.filename, `orbita-maqueta-T${session.videoMetadata.bpm}-9x16.webm`);
      const videoWithoutMetadata = await encodeShortVideo(mix, null, () => {}, signal);
      assert.equal(videoWithoutMetadata.filename, 'orbita-maqueta-T126-9x16.webm');
    });

    await context.test('la captura de respaldo separa la precuenta y la toma dentro de un bloque', async studio => {
      const advanceAudioTo = mockAudioTimeouts(studio, audio);
      const track = { getSettings: () => ({}), stop() {} };
      replaceGlobal(studio, 'navigator', { mediaDevices: {
        async getUserMedia() { return { getAudioTracks: () => [track], getTracks: () => [track] }; }
      } });
      const audioWorklet = audio.audioWorklet;
      audio.audioWorklet = null;
      let processor;
      audio.createScriptProcessor = (size, inputs) => {
        assert.equal(size, 1024);
        assert.equal(inputs, 4);
        processor = audio.addNode('scriptProcessor');
        return processor;
      };
      audio.createConstantSource = () => Object.assign(audio.addNode('constantSource', ['offset']), { start() {} });
      studio.after(() => {
        audio.audioWorklet = audioWorklet;
        delete audio.createScriptProcessor;
        delete audio.createConstantSource;
      });

      setState({ bpm: 220, metronomeEnabled: false, cameraEnabled: false });
      const before = oscillators().length;
      const rate = audio.sampleRate;
      const firstClick = audio.currentTime + 0.04;
      const recordTime = firstClick + 4 * (60 / 220);
      const start = Math.ceil(firstClick * rate);
      const recordFrame = Math.ceil(recordTime * rate);
      await startDemoRecording();

      const buffer = new TestAudioBuffer(4, 1024, rate);
      const [musicL, musicR, voice, timing] = buffer.channels;
      const firstFrame = start - 19;
      const mark = frame => 1 + (frame - start) / (recordFrame - start);
      // El marcador conserva la posición aunque falten las primeras muestras del bloque.
      for (let i = start - firstFrame + 3; i < timing.length; i++) timing[i] = mark(firstFrame + i);
      for (const click of oscillators().slice(before)) {
        const index = Math.ceil(click.startTime * rate) - firstFrame + 118;
        if (index < voice.length) voice[index] = 0.5;
      }
      const lastClickIndex = Math.ceil(oscillators().at(-1).startTime * rate) - firstFrame + 118;
      processor.onaudioprocess({ inputBuffer: buffer });

      const boundary = recordFrame - firstFrame - buffer.length;
      for (let i = 0; i < boundary; i++) timing[i] = mark(firstFrame + buffer.length + i);
      timing.fill(3, boundary);
      voice.fill(0);
      if (lastClickIndex >= buffer.length) voice[lastClickIndex - buffer.length] = 0.5;
      voice.fill(0.02, boundary);
      musicL.fill(0.075, boundary);
      musicR.fill(0.125, boundary);
      processor.onaudioprocess({ inputBuffer: buffer });
      advanceAudioTo(recordTime + 1);
      const session = await stopDemoRecording();
      assert.equal(session.musicBuffer.length, buffer.length - boundary);
      assert.ok(Math.abs(session.autoMeasuredOffsetMs + 118) <= 1);
      assert.ok(session.countInCalibration.bleedDetected);
      assert.ok(session.musicBuffer.getChannelData(0).every(sample => sample === Math.fround(0.075)));
      assert.ok(session.musicBuffer.getChannelData(1).every(sample => sample === 0.125));
      assert.ok(session.voiceBuffer.getChannelData(0).every(sample => sample === Math.fround(0.02)));
    });

    await context.test('la pista seca reproduce desde cero y se rearma en el tiempo 1 de la maqueta', async studio => {
      const advanceAudioTo = mockAudioTimeouts(studio, audio);
      const progress = { style: {}, classList: { toggle() {} } };
      replaceGlobal(studio, 'document', { getElementById: id => id === 'loop-progress-fill' ? progress : null });
      let frame;
      replaceGlobal(studio, 'requestAnimationFrame', callback => { frame = callback; return 1; });
      replaceGlobal(studio, 'cancelAnimationFrame', () => { frame = null; });
      const trackSources = buffer => audio.nodes.filter(node => node.kind === 'bufferSource' && node.buffer === buffer);
      const buffer = audio.createBuffer(2, audio.sampleRate * 8);
      buffer.getChannelData(1).fill(0.25);
      pressLooperClear();
      setState({ bpm: 92, metronomeEnabled: false, cameraEnabled: false });
      const filename = 'mi-tema-T128.mp3';
      assert.deepEqual(loadLooperAudioBuffer(buffer, filename), { ok: true, name: filename, duration: 8, detectedBpm: 128 });
      assert.equal(getState().bpm, 128);
      assert.equal(getState().loadedTrackName, filename);
      assert.equal(getState().loadedTrackDuration, 8);
      assert.equal(hasLoadedBackingTrack(), true);
      assert.equal(getLoadedBackingTrackBuffer(), buffer);

      const dryBus = getBackingTrackDestination();
      assert.equal(dryBus.gain.value, 0.90);
      assert.deepEqual(dryBus.connections, [audio.destination]);
      assert.notEqual(dryBus.connections[0], getMasterOutputNode());
      setBackingTrackVolume(2);
      assert.equal(dryBus.gain.targets.at(-1).value, 1.5);
      assert.equal(getState().backingTrackVol, 1.5);
      setBackingTrackVolume(0.65);
      assert.equal(dryBus.gain.targets.at(-1).value, 0.65);
      const beforePlay = oscillators().length;
      const playAt = audio.currentTime + 0.01;
      pressLooperPlayStop();
      const [firstPlay] = trackSources(buffer);
      assert.equal(firstPlay.startTime, playAt);
      assert.equal(firstPlay.offset, 0);
      assert.deepEqual(firstPlay.connections, [dryBus]);
      assert.equal(getState().backingTrackPlaying, true);
      assert.equal(getDebugTelemetry().running, false);
      advanceAudioTo(playAt + 2);
      frame();
      assert.equal(progress.style.width, '25.0%');
      assert.equal(oscillators().length, beforePlay);
      advanceAudioTo(playAt + 8);
      firstPlay.onended();
      assert.equal(getState().backingTrackPlaying, false);
      assert.equal(getDebugTelemetry().running, false);
      assert.equal(frame, null);
      assert.equal(progress.style.width, '0.0%');

      pressLooperPlayStop();
      const metronomeAt = trackSources(buffer).at(-1).startTime;
      setState({ metronomeEnabled: true });
      const [optionalClick] = atTime(oscillators(), metronomeAt);
      assert.equal(optionalClick.frequency.value, 1320);
      assert.equal(getDebugTelemetry().running, false);
      const backingBpm = getState().bpm;
      onBpmChanged(130);
      assert.notEqual(optionalClick.stopTimes.at(-1), audio.currentTime);
      const nextClickAt = metronomeAt + 60 / 130;
      advanceAudioTo(nextClickAt - 0.06);
      schedulerTick();
      const [nextClick] = atTime(oscillators(), nextClickAt);
      assert.equal(nextClick.frequency.value, 880);
      setState({ metronomeEnabled: false });
      assert.equal(nextClick.stopTimes.at(-1), audio.currentTime);
      onBpmChanged(backingBpm);
      assert.equal(schedulerTick, null);
      pressLooperPlayStop();
      advanceAudioTo(audio.currentTime + 1);

      const loop = loopAt120();
      loop.events = [{ ...loop.events[0], offsetSec: 0, notes: [79], presetId: 3, humanize: 0 }];
      importLooperSnapshot(loop);
      toggleDrumPlayback();
      const bothAt = audio.currentTime + 0.01;
      pressLooperPlayStop();
      assert.equal(trackSources(buffer).at(-1).startTime, bothAt);
      assert.deepEqual(pitches(atTime(oscillators(), bothAt)), [midiToFreq(79)]);
      pressLooperPlayStop();
      assert.equal(getState().looperState, 'idle');
      assert.equal(getState().backingTrackPlaying, false);
      toggleDrumPlayback();
      importLooperSnapshot(null);
      assert.equal(hasLoadedBackingTrack(), true);

      pressLooperPlayStop();
      const preCountSource = trackSources(buffer).at(-1);
      const beforeCount = oscillators().length;
      const t0 = audio.currentTime + 0.04;
      const downbeat = t0 + 4 * (60 / 128);
      let worklet;
      replaceGlobal(studio, 'AudioWorkletNode', class extends TestAudioNode {
        port = {};
        constructor(_ctx, _name, options) {
          super('worklet');
          assert.equal(options.channelCount, 3);
          worklet = this;
        }
      });
      await startDemoRecording();
      assert.ok(preCountSource.stopTimes.length > 0);
      assert.equal(getState().backingTrackPlaying, false);
      assert.equal(oscillators().length - beforeCount, 4);
      advanceAudioTo(t0 + 3 * (60 / 128) + 0.005);
      assert.equal(trackSources(buffer).at(-1), preCountSource);
      advanceAudioTo(downbeat - 0.01);
      const demoSource = trackSources(buffer).at(-1);
      assert.notEqual(demoSource, preCountSource);
      assert.equal(demoSource.startTime, downbeat);
      assert.equal(demoSource.offset, 0);
      assert.deepEqual(demoSource.connections, [dryBus]);
      advanceAudioTo(downbeat + 0.005);
      assert.equal(isDemoRecording(), true);
      assert.equal(getState().backingTrackPlaying, true);
      assert.equal(getDebugTelemetry().running, false);
      const frameStart = Math.ceil(downbeat * audio.sampleRate);
      const samples = new Float32Array(2000).fill(0.5);
      advanceAudioTo((frameStart + samples.length) / audio.sampleRate);
      worklet.port.onmessage({ data: { frame: frameStart, mL: samples, mR: samples, vM: samples } });
      const session = await stopDemoRecording();
      assert.equal(session.hasBackingTrack, true);
      assert.equal(session.backingBuffer, buffer);
      assert.equal(session.musicBuffer.numberOfChannels, 2);
      assert.deepEqual(session.musicBuffer.getChannelData(0), samples);
      assert.ok(session.backingPeaks.every(peak => peak === 0.25));
      assert.equal(session.backingCaptureVol, 0.65);
      const settings = { trimStartSec: 0.25, trimEndSec: 1.5, backingVol: 1.25, masterVol: 2 };
      let progressSample;
      assert.ok(startDemoPreviewPlayback(settings, (position, meterData) => {
        progressSample = { position, meterData };
      }, null, 0.5));
      const previewBacking = trackSources(buffer).at(-1);
      assert.equal(previewBacking.offset, 0.5 + session.backingStartSec);
      assert.equal(previewBacking.duration, 1);
      const [backingGain] = previewBacking.connections;
      assert.equal(backingGain.gain.value, 1.25);
      const [bus] = backingGain.connections;
      assert.equal(bus.gain.value, 2);
      const musicGain = audio.nodes.findLast(node => node.buffer === session.musicBuffer).connections[0];
      assert.deepEqual(musicGain.connections, [bus]);
      const [left, splitter, clean, gentle, firm, limiter] = bus.connections;
      const [right] = splitter.connections;
      const [gentleGain] = gentle.connections;
      const [firmGain] = firm.connections;
      const [clipInput] = limiter.connections;
      const [shaper] = clipInput.connections;
      const [clip] = shaper.connections;
      const masterPaths = [clean, gentleGain, firmGain, clip];
      assert.deepEqual(masterPaths.map(node => node.gain.value), [0, 1, 0, 0]);
      assert.ok(masterPaths.every(node => node.connections[0] === clean.connections[0]));
      for (const [index, compressor] of [gentle, firm, limiter].entries()) {
        assert.equal(compressor.kind, 'compressor');
        const { softClip: _softClip, ...params } = getMasterCompPreset(index + 1);
        assert.deepEqual(Object.fromEntries(Object.keys(params).map(key => [key, compressor[key].value])), params);
      }
      assert.equal(shaper.oversample, '2x');
      const clipAt = sample => shaper.curve[(1 + sample * clipInput.gain.value) * (shaper.curve.length - 1) / 2];
      assert.equal(clipAt(0.5), 0.5);
      const masterInput = 2;
      assert.ok(clipAt(1) < 1 && clipAt(masterInput) > clipAt(1));
      assert.ok(clipAt(masterInput) <= 1 && clipAt(masterInput) < masterInput);
      assert.equal(clipAt(-2), -clipAt(2));
      assert.equal(left.fftSize, 1024);
      assert.equal(right.fftSize, 1024);
      const sampleAt = channel => Math.fround((samples[0] * musicGain.gain.value +
        buffer.getChannelData(channel)[0] * backingGain.gain.value) * bus.gain.value);
      left.getFloatTimeDomainData = data => data.fill(sampleAt(0));
      right.getFloatTimeDomainData = data => data.fill(sampleAt(1));
      audio.currentTime = previewBacking.startTime + 0.25;
      frame();
      assert.equal(progressSample.position, 0.75);
      assert.ok(Math.abs(progressSample.meterData.peakDb - linearPeakToDb(sampleAt(1))) < 1e-8);
      assert.ok(Math.abs(progressSample.meterData.rmsDb -
        linearPeakToDb(Math.hypot(sampleAt(0), sampleAt(1)) / Math.SQRT2)) < 1e-8);
      assert.equal(progressSample.meterData.clipped, true);
      assert.deepEqual(readLiveMasterMeter(), progressSample.meterData);

      for (const [masterComp, masterVol] of [[0, 0], [1, 1], [2, 3], [3, 1.5], [0, 1.5]]) {
        updateLivePreviewMix({ ...settings, backingVol: 0, masterVol, masterComp });
        assert.deepEqual(bus.gain.targets.at(-1), {
          value: Math.min(2, masterVol), time: audio.currentTime, timeConstant: 0.015
        });
        assert.deepEqual(masterPaths.map(node => node.gain.targets.at(-1)),
          masterPaths.map((_, i) => ({ value: Number(masterComp === i), time: audio.currentTime, timeConstant: 0.015 })));
        assert.equal(trackSources(buffer).at(-1), previewBacking);
        assert.equal(previewBacking.stopTimes.length, 0);
      }
      assert.equal(backingGain.gain.targets.at(-1).value, 0);
      assert.ok(startDemoPreviewPlayback(settings, null, null, 0.75));
      assert.equal(previewBacking.stopTimes.length, 1);
      stopDemoPreviewPlayback();
      assert.deepEqual(readLiveMasterMeter(), { peakDb: -Infinity, rmsDb: -Infinity, clipped: false });

      const OfflineCtx = window.OfflineAudioContext;
      let offline;
      window.OfflineAudioContext = class extends OfflineCtx {
        constructor(...args) {
          super(...args);
          offline = this;
        }
      };
      try {
        await renderFinalMixBuffer({ ...settings, masterVol: 1.5, masterComp: 3 });
        const exportBacking = offline.nodes.find(node => node.buffer === buffer);
        assert.equal(exportBacking.offset, 0.25 + session.backingStartSec);
        assert.equal(exportBacking.duration, 1.25);
        assert.equal(exportBacking.connections[0].gain.value, 1.25);
        const [exportBus] = exportBacking.connections[0].connections;
        assert.equal(exportBus.gain.value, 1.5);
        assert.ok(!offline.nodes.some(node => node.kind === 'analyser'));
        assert.equal(exportBus.connections.length, 1);
        const [exportLimiter] = exportBus.connections;
        const [exportClipInput] = exportLimiter.connections;
        const [exportShaper] = exportClipInput.connections;
        const [exportClip] = exportShaper.connections;
        assert.equal(exportLimiter.ratio.value, limiter.ratio.value);
        assert.equal(exportClip.gain.value, 1);
        assert.equal(exportShaper.oversample, '2x');
        assert.deepEqual(exportShaper.curve, shaper.curve);

        await renderFinalMixBuffer({ ...settings, masterVol: 1.5, masterComp: 0 });
        const [exportLinearBus] = offline.nodes.find(node => node.buffer === buffer).connections[0].connections;
        const [exportLinear] = exportLinearBus.connections;
        assert.equal(exportLinear.kind, 'gain');
        assert.equal(exportLinear.gain.value, 1);
        assert.ok(!offline.nodes.some(node => ['compressor', 'waveshaper'].includes(node.kind)));
      } finally {
        window.OfflineAudioContext = OfflineCtx;
      }
      pressLooperPlayStop();
      const restarted = trackSources(buffer).at(-1);
      stopAllTransportForPlayback();
      assert.deepEqual(restarted.connections, []);
      assert.equal(getState().backingTrackPlaying, false);
      assert.equal(getState().loadedTrackName, filename);
      assert.equal(hasLoadedBackingTrack(), true);

      pressLooperPlayStop();
      const replaced = trackSources(buffer).at(-1);
      const bytes = new ArrayBuffer(8);
      audio.decodeAudioData = async data => {
        assert.equal(data, bytes);
        return buffer;
      };
      const file = { name: 'sin-tempo.wav', arrayBuffer: async () => bytes };
      assert.deepEqual(await loadLooperAudioFile(file), { ok: true, name: file.name, duration: 8, detectedBpm: null });
      assert.deepEqual(replaced.connections, []);
      assert.equal(getState().bpm, 128);
      await assert.rejects(loadLooperAudioFile({ ...file, arrayBuffer: async () => { throw new Error('Audio ilegible'); } }));
      assert.equal(getState().loadedTrackName, file.name);

      importLooperSnapshot(loop);
      pressLooperPlayStop();
      const lastPlay = trackSources(buffer).at(-1);
      const pendingLoad = loadLooperAudioFile(file);
      pressLooperClear();
      assert.deepEqual(await pendingLoad, { ok: false });
      assert.deepEqual(lastPlay.connections, []);
      assert.equal(getState().backingTrackPlaying, false);
      assert.equal(getState().loadedTrackName, '');
      assert.equal(getState().loadedTrackDuration, 0);
      assert.equal(getState().loopBars, 0);
      assert.equal(hasLoadedBackingTrack(), false);
      assert.equal(getLoadedBackingTrackBuffer(), null);
      assert.equal(session.backingBuffer, buffer);
      assert.equal(getDebugTelemetry().running, false);
      setBackingTrackVolume(0.90);
    });
  } finally {
    cancelDemoCountIn();
    if (isDemoRecording()) await stopDemoRecording();
    setProgressionVisualCallback(null);
    stopAllTransportForPlayback();
  }
});
