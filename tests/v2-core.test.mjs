import assert from 'node:assert/strict';
import { test } from 'node:test';
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
import { getDrumDestination, getMasterOutputNode } from '../js/audio-core.js';
import {
  buildFilteredVoiceSamples, getVoiceFilterPreset, getCurrentPreviewPositionSec, getStudioVoicePeaks,
  cancelDemoCountIn, isDemoCountIn, isDemoRecording, isDemoRecordingOrCountIn,
  renderFinalMixBuffer, startDemoPreviewPlayback, stopDemoPreviewPlayback, startDemoRecording, stopDemoRecording
} from '../js/demo-recorder.js';
import { VIDEO_STYLES } from '../js/short-video.js';
import { startHumanizedVoiceGroup } from '../js/synth-presets.js';
import { initKeyboardUI } from '../js/ui-keyboard.js';
import {
  exportLooperSnapshot,
  getDebugTelemetry,
  importLooperSnapshot,
  pressLooperPlayStop,
  pressLooperRec,
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

test('el filtro de voz tiene cuatro presets independientes de la captura', () => {
  const expected = [
    { highpassHz: 40, deMudDb: 0, presenceDb: 0, lowpassHz: 20000, gateThreshold: 0, gateFloor: 1, musicDuckAmt: 0 },
    { highpassHz: 95, deMudDb: -2, presenceDb: 1.2, lowpassHz: 15000, gateThreshold: 0.008, gateFloor: 0.45, musicDuckAmt: 0.25 },
    { highpassHz: 130, deMudDb: -3.5, presenceDb: 2.5, lowpassHz: 12000, gateThreshold: 0.015, gateFloor: 0.2, musicDuckAmt: 0.55 },
    { highpassHz: 165, deMudDb: -5, presenceDb: 3.5, lowpassHz: 9500, gateThreshold: 0.024, gateFloor: 0.06, musicDuckAmt: 0.85 }
  ];
  for (const [level, preset] of expected.entries()) assert.deepEqual(getVoiceFilterPreset(level), preset);
  getVoiceFilterPreset(0).highpassHz = 80;
  assert.deepEqual(getVoiceFilterPreset(0), expected[0]);
  assert.deepEqual(getVoiceFilterPreset(4), expected[0]);
});

test('la puerta conserva los bits del nivel 0 y atenúa el sangrado alineado entre frases', () => {
  const bits = new Uint32Array([0x3e800000, 0x80000000, 0x7fc12345, 0x00000001]);
  const raw = new Float32Array(bits.buffer);
  const bypass = buildFilteredVoiceSamples(raw, new Float32Array(raw.length), 48000, 0);
  assert.notEqual(raw.buffer, bypass.buffer);
  assert.deepEqual(new Uint32Array(bypass.buffer), bits);

  const rate = 8000;
  const delay = rate * 0.25;
  const music = Float32Array.from({ length: rate * 2 }, (_, i) =>
    i < rate * 0.35 ? 0.35 * Math.sin(i * 2 * Math.PI * 210 / rate) : 0);
  const voice = Float32Array.from(music, (_, i) => (music[i - delay] ?? 0) * 0.16
    + 0.004 * Math.sin(i * 2 * Math.PI * 310 / rate)
    + (i >= rate * 0.9 && i < rate * 1.3 ? 0.26 * Math.sin(i * 2 * Math.PI * 220 / rate) : 0));
  const original = voice.slice();
  const filtered = buildFilteredVoiceSamples(voice, music, rate, 3, -250);
  const unaligned = buildFilteredVoiceSamples(voice, music, rate, 3);
  const peak = (samples, start, end) => Math.max(...samples.subarray(rate * start, rate * end).map(Math.abs));
  assert.deepEqual(voice, original);
  assert.ok(peak(filtered, 0.45, 0.57) < peak(original, 0.45, 0.57) * 0.2);
  assert.ok(peak(filtered, 0.45, 0.57) < peak(unaligned, 0.45, 0.57) * 0.4);
  assert.ok(peak(filtered, 0.97, 1.28) > peak(original, 0.97, 1.28) * 0.98);
  assert.ok(peak(filtered, 1.8, 2) < peak(original, 1.8, 2) * 0.1);
});

test('el vídeo corto ofrece cuatro estilos en orden de intensidad', () => {
  assert.deepEqual(VIDEO_STYLES, ['pure', 'keys', 'orbit', 'cosmos']);
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
  assert.equal(defaults.cameraEnabled, false);
  assert.equal(defaults.progressionIndex, -1);
  assert.equal(defaults.progressionPlaying, false);
  assert.equal(defaults.tutorialDone, false);

  const preferences = {
    scaleMode: 'custom', customScale: andalusian.degrees, customPresetId: 'andalusian',
    lang: 'en', notation: 'letter', micFilterLevel: 3, cameraEnabled: true,
    progressionIndex: 15, tutorialDone: true
  };
  initial.setState({ ...preferences, progressionPlaying: true, reverbLevel: 3 });
  const stored = JSON.parse(storage.getItem('orbita_v2_config_v1'));
  assert.equal(Object.hasOwn(stored, 'progressionPlaying'), false);
  assert.equal(Object.hasOwn(stored, 'reverbLevel'), false);
  const restored = (await import('../js/state.js?config-restored')).getState();
  for (const [key, value] of Object.entries(preferences)) assert.deepEqual(restored[key], value);
  assert.equal(restored.progressionPlaying, false);
  assert.equal(restored.reverbLevel, 0);
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
    importLooperSnapshot(null);
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
  setTargetAtTime(value, time) { this.targets.push({ value, time }); }
}

class TestAudioNode {
  connections = [];
  stopTimes = [];

  constructor(kind, paramNames = []) {
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
      replaceGlobal(studio, 'AudioWorkletNode', class extends TestAudioNode {
        port = {};
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
      advanceAudioTo(startAt + 0.005);
      assert.equal(isDemoRecording(), true);
      assert.equal(getDebugTelemetry().running, false);
      assert.equal(getState().currentBeat, -1);
      assert.equal(oscillators().length - before, 4);
      const captured = new Float32Array(2000).fill(0.005);
      const startFrame = Math.ceil(startAt * audio.sampleRate);
      const precount = new Float32Array(128).fill(1);
      worklet.port.onmessage({ data: { frame: startFrame - 128, mL: precount, mR: precount, vM: precount } });
      const overlapping = new Float32Array(4 + captured.length).fill(1);
      overlapping.set(captured, 4);
      worklet.port.onmessage({ data: { frame: startFrame - 4, mL: overlapping, mR: overlapping, vM: overlapping } });
      startHumanizedVoiceGroup([69, 72, 76], {
        when: startAt + 0.125, duration: 0.5, velocity: 0.8, humanize: 3, strumDirection: 'down'
      });
      startHumanizedVoiceGroup([71], { when: startAt + 3, duration: 0.5 });
      startHumanizedVoiceGroup([71], { when: startAt + 1, duration: 0.5 }).stop(null, true);
      advanceAudioTo(startAt + 2);
      const session = await stopDemoRecording();
      assert.ok(micStopped);
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
      assert.ok(audio.nodes.some(node => node.type === 'highpass' && node.frequency.value === 165));
      audio.currentTime = music.startTime + 0.25;
      assert.equal(getCurrentPreviewPositionSec(), 0.85);

      assert.ok(startDemoPreviewPlayback({ ...settings, voiceFilter: 0 }, null, null, 2));
      const [lastMusic, lastVoice] = audio.nodes.filter(node => node.kind === 'bufferSource').slice(-2);
      assert.equal(lastMusic.offset, settings.trimEndSec - 0.05);
      assert.equal(lastVoice.buffer, session.voiceBuffer);
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
      await renderFinalMixBuffer(settings);
      const [exportMusic, exportVoice] = offline.nodes.filter(node => node.kind === 'bufferSource');
      assert.equal(exportMusic.offset, 0.4);
      assert.equal(exportVoice.offset, 0.525);
      assert.equal(exportVoice.buffer, voice.buffer);
      assert.deepEqual(session.voiceBuffer.getChannelData(0), captured);
    });
  } finally {
    cancelDemoCountIn();
    if (isDemoRecording()) await stopDemoRecording();
    setProgressionVisualCallback(null);
    stopAllTransportForPlayback();
  }
});
