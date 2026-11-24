import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CUSTOM_SCALE_PRESETS,
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
import { detectSystemLang, INTERVAL_LABELS, resolveLang, t } from '../js/i18n.js';
import { POPULAR_PROGRESSIONS, selectProgression, setProgressionVisualCallback } from '../js/progressions.js';
import { getState, setState } from '../js/state.js';
import { getDrumDestination, getMasterOutputNode } from '../js/audio-core.js';
import { getMicFilterConfig } from '../js/demo-recorder.js';
import {
  exportLooperSnapshot,
  getDebugTelemetry,
  importLooperSnapshot,
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

  assert.deepEqual(a.map(degree => degree.chordLabel), ['Lam', 'Si°', 'Do', 'Rem', 'Mi', 'Fa', 'Sol']);
  assert.deepEqual(b.map(degree => degree.chordLabel), ['Sim', 'Do#°', 'Re', 'Mim', 'Fa#', 'Sol', 'La']);
  assert.deepEqual(a.map(degree => degree.roman), ROMAN_DEGREES);
  assert.deepEqual(b.map(degree => degree.intervalSemitones), [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(b.map(degree => degree.triadMidi), a.map(degree => degree.triadMidi.map(note => note + 2)));

  const state = { rootSemitone: 9, scaleMode: 'custom', octaveOffset: 0, customScale: andalusian.degrees, notation: 'letter' };
  assert.deepEqual(getDegreeTriggerNotes(4, { ...state, playMode: 'chord' }), [76, 80, 83]);
  assert.deepEqual(getDegreeTriggerNotes(4, { ...state, playMode: 'melody' }), [76]);
});

test('los ocho presets tienen siete intervalos válidos y solo admiten tríadas M, m y dim', () => {
  const expected = {
    major: ['0M', '2m', '4m', '5M', '7M', '9m', '11dim'],
    minor: ['0m', '2dim', '3M', '5m', '7m', '8M', '10M'],
    andalusian: ['0m', '2dim', '3M', '5m', '7M', '8M', '10M'],
    harmonic_minor: ['0m', '2dim', '3M', '5m', '7M', '8M', '11dim'],
    dorian: ['0m', '2m', '3M', '5M', '7m', '9dim', '10M'],
    mixolydian: ['0M', '2m', '4dim', '5M', '7m', '9m', '10M'],
    epic_ballad: ['0M', '2m', '4m', '5m', '7M', '8M', '10M'],
    lydian: ['0M', '2M', '4m', '6dim', '7M', '9m', '11m']
  };
  assert.equal(CUSTOM_SCALE_PRESETS.length, 8);
  assert.deepEqual(VALID_CUSTOM_QUALITIES, ['M', 'm', 'dim']);
  for (const { id, degrees } of CUSTOM_SCALE_PRESETS) {
    assert.deepEqual(degrees.map(({ semitones, quality }) => `${semitones}${quality}`), expected[id]);
  }

  const cleaned = sanitizeCustomScale([
    { semitones: 11, quality: 'M7' },
    { semitones: -1, quality: 'dim' },
    { semitones: 1.5, quality: 'sus4' },
    { semitones: 12, quality: 'aug' },
    null,
    { semitones: 0, quality: 'm' },
    { semitones: '3', quality: '7' },
    { semitones: 0, quality: 'M' }
  ]);
  assert.deepEqual(cleaned, [
    { semitones: 11, quality: 'M' },
    { semitones: 2, quality: 'dim' },
    { semitones: 4, quality: 'm' },
    { semitones: 5, quality: 'M' },
    { semitones: 7, quality: 'M' },
    { semitones: 0, quality: 'm' },
    { semitones: 11, quality: 'dim' }
  ]);
  assert.deepEqual(sanitizeCustomScale(null), CUSTOM_SCALE_PRESETS[0].degrees);
  assert.notEqual(sanitizeCustomScale(null)[0], CUSTOM_SCALE_PRESETS[0].degrees[0]);
});

test('la notación solfeo y por letras cambia las etiquetas y conserva el MIDI', () => {
  assert.equal(getNoteNameUpper(1), 'DO#');
  assert.equal(getNoteNameTitle(1), 'Do#');
  assert.equal(getNoteNameUpper(13, 'letter'), 'C#');
  assert.equal(getNoteNameTitle(-1, 'letter'), 'B');
  assert.equal(formatChordLabel(11, 'dim', 'letter'), 'B°');
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

test('las familias de textos, los seis pasos y los doce intervalos están disponibles en español e inglés', () => {
  const translations = [
    ['header.help', 'Ayuda', 'Help'],
    ['bank.title', 'BANCO 50 → 9', 'BANK 50 → 9'],
    ['bank.config', 'CONFIG', 'SETTINGS'],
    ['custom.presets.andalusian.name', 'Cadencia Andaluza', 'Andalusian Cadence'],
    ['config.notation', 'Notación musical', 'Note notation'],
    ['config.micFilter.0', '0 · Sin filtro (crudo)', '0 · No filter (raw)'],
    ['config.micFilter.1', '1 · Poco filtro', '1 · Light filter'],
    ['config.micFilter.2', '2 · Mucho filtro', '2 · Strong filter'],
    ['config.micFilter.3', '3 · Filtro máximo', '3 · Max filter'],
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
  for (let step = 1; step <= 6; step++) {
    for (const part of ['title', 'body']) {
      const key = `tutorial.${step}.${part}`;
      assert.notEqual(t(key, 'es'), key);
      assert.notEqual(t(key, 'en'), t(key, 'es'));
    }
  }
  assert.equal(t('tutorial.progress', 'es', { step: 2, total: 6 }), 'Paso 2 de 6');
  assert.equal(t('tutorial.progress', 'en', { step: 2, total: 6 }), 'Step 2 of 6');
  assert.equal(t('unknown.key', 'en'), 'unknown.key');
  assert.deepEqual(INTERVAL_LABELS.es, [
    'Unísono (1ª)', '2ª menor', '2ª mayor', '3ª menor', '3ª mayor', '4ª justa',
    '4ª aum / 5ª dism', '5ª justa', '6ª menor', '6ª mayor', '7ª menor', '7ª mayor'
  ]);
  assert.deepEqual(INTERVAL_LABELS.en, [
    'Unison (1st)', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th',
    'Tritone', 'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th'
  ]);
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

test('el filtro del micrófono calibra por separado la captura, el pasaaltos y la puerta de ruido', () => {
  const expected = [
    { echoCancellation: false, noiseSuppression: false, autoGainControl: false, highpassHz: 40, gateThreshold: 0 },
    { echoCancellation: true, noiseSuppression: false, autoGainControl: false, highpassHz: 80, gateThreshold: 0 },
    { echoCancellation: true, noiseSuppression: true, autoGainControl: false, highpassHz: 110, gateThreshold: 0.008 },
    { echoCancellation: true, noiseSuppression: true, autoGainControl: true, highpassHz: 140, gateThreshold: 0.018 }
  ];
  for (const [level, config] of expected.entries()) assert.deepEqual(getMicFilterConfig(level), config);
  getMicFilterConfig(0).echoCancellation = true;
  assert.deepEqual(getMicFilterConfig(0), expected[0]);
  assert.deepEqual(getMicFilterConfig(4), expected[0]);
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

  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
  start(time) { this.startTime = time; }
  stop(time) { this.stopTimes.push(time); }
}

test('el audio programa las progresiones a compás y silencia los clics pendientes al parar', async context => {
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
      createBiquadFilter() { return this.addNode('filter', ['frequency', 'Q']); }
      createWaveShaper() { return this.addNode('waveshaper'); }
      createConvolver() { return this.addNode('convolver'); }
      createDynamicsCompressor() {
        return this.addNode('compressor', ['threshold', 'knee', 'ratio', 'attack', 'release']);
      }
      createOscillator() { return this.addNode('oscillator', ['frequency']); }
      createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    }
  });
  let schedulerTick;
  context.mock.method(globalThis, 'setInterval', callback => {
    schedulerTick = callback;
    return 1;
  });
  context.mock.method(globalThis, 'clearInterval', () => { schedulerTick = null; });

  const visual = [];
  setProgressionVisualCallback(degree => visual.push(degree));
  const oscillators = () => audio.nodes.filter(node => node.kind === 'oscillator');
  const atTime = (nodes, when) => nodes.filter(node => Math.abs(node.startTime - when) < 1e-9);

  try {
    setState({
      rootSemitone: 0, scaleMode: 'M', octaveOffset: 0, bpm: 120,
      accompaniment: 0, playMode: 'melody', humanize: 0, selectedSounds: [3], activeSoundSlot: 0,
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
    const [click, root, harmonic] = atTime(oscillators(), 10.01);
    assert.equal(click.frequency.value, 1320);
    assert.equal(root.frequency.value, midiToFreq(60));
    assert.ok(harmonic);
    const [filter] = root.connections;
    const [envGain] = filter.connections;
    const [releaseGain] = envGain.connections;
    assert.equal(envGain.kind, 'gain');
    assert.equal(releaseGain.kind, 'gain');
    assert.ok(Math.abs(releaseGain.gain.targets[0].time - (10.01 + 2 * 0.94)) < 1e-9);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(visual, [0]);
    assert.equal(selectProgression(-1), -1);
    assert.equal(getState().progressionPlaying, false);
    assert.deepEqual(visual, [0, null]);
    assert.equal(getDebugTelemetry().running, false);
    assert.equal(schedulerTick, null);
    assert.deepEqual(click.connections[0].connections, []);
    assert.equal(click.stopTimes.at(-1), audio.currentTime);
    assert.equal(root.stopTimes.at(-1), audio.currentTime + 0.005);

    const beforeAccompany = oscillators().length;
    setState({ accompaniment: 1, selectedAccompaniments: [0], playMode: 'chord', keyStrike: true, metronomeEnabled: false });
    toggleProgressionPlayback();
    const firstBeat = oscillators().slice(beforeAccompany);
    assert.equal(firstBeat.length, 2);
    assert.equal(atTime(firstBeat, 10.01).length, 2);
    assert.equal(firstBeat[0].frequency.value, midiToFreq(60));

    audio.currentTime = 11.94;
    schedulerTick();
    const nextBeat = atTime(oscillators().slice(beforeAccompany), 12.01);
    assert.equal(nextBeat.length, 2);
    assert.equal(nextBeat[0].frequency.value, midiToFreq(67));

    toggleDrumPlayback();
    toggleProgressionPlayback();
    assert.equal(getDebugTelemetry().running, true);
    assert.equal(nextBeat[0].stopTimes.at(-1), audio.currentTime + 0.005);
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
  } finally {
    setProgressionVisualCallback(null);
    stopAllTransportForPlayback();
  }
});
