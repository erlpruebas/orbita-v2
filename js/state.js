/**
 * state.js — Estado único reactivo y persistencia localStorage para ÓRBITA
 */

import { CUSTOM_SCALE_PRESETS, sanitizeCustomScale } from './theory.js';

const STORAGE_KEY = 'orbita_v2_config_v1';

const DEFAULT_STATE = {
  // Tonalidad y escala
  rootSemitone: 0,       // 0 = DO, 1 = DO#, ..., 11 = SI
  scaleMode: 'M',        // 'M' | 'm' | 'custom'
  customScale: sanitizeCustomScale(CUSTOM_SCALE_PRESETS[0].degrees),
  customPresetId: 'major',

  // Preferencias
  lang: 'auto',
  notation: 'solfege',
  micFilterLevel: 0,
  cameraEnabled: false,
  tutorialDone: false,

  // Bloque izquierdo (4 controles)
  playMode: 'chord',     // 'chord' (Acordes - LED ámbar) | 'melody' (Melodía - LED esmeralda)
  humanize: 0,           // 0..3 LEDs cian
  reverbLevel: 0,        // 0..3 LEDs violeta (ESTRICTAMENTE 0 POR DEFECTO - REGLA 4)
  accompaniment: 0,      // 0 = Manual (apagado), 1..9 = hueco activo de selectedAccompaniments
  selectedAccompaniments: [0, 1, 2, 3, 4, 5, 6, 7, 8], // 9 huecos elegidos del banco de 50 acompañamientos

  // Header controls
  yAxisMode: 'filter',   // 'filter' (Filtro) | 'volume' (Volumen) | 'drive' (Distorsión)
  keyStrike: true,       // ⚡ ON = golpe directo + patrón; OFF = Pure Gate

  // Octava y Sonido
  octaveOffset: 0,       // -2, -1, 0, +1, +2
  activeSoundSlot: 0,    // 0..8 (mostrado como 1..9)
  selectedSounds: [0, 1, 2, 3, 4, 5, 6, 7, 8], // Primeros 6 = originales v01/v04 (Bruma, Rhodes, Juno, Marimba, Órgano, Pluck)

  // Tempo, Metrónomo y Batería
  bpm: 92,               // 40..220 BPM
  metronomeEnabled: false, // ESTRICTAMENTE false en reposo (REGLA 1)
  activeDrumSlot: 0,     // 0..8 (mostrado como 1..9)
  selectedDrums: [0, 1, 2, 3, 4, 5, 6, 7, 8],  // Primeras 6 = originales v01/v04 (Lo-Fi, Pop, Bossa, House, Pulso, Funk)
  drumPlaying: false,

  // Progresiones
  progressionIndex: -1,
  progressionPlaying: false,

  // Looper
  looperState: 'idle',   // 'idle' | 'countin' | 'recording' | 'playing'
  loopBars: 0,           // 0, 1, 2, 4, 8
  currentBeat: -1,       // -1 en reposo, 0..3 en marcha
  currentStep: 0         // 0..15
};

const v2ConfigValidators = {
  scaleMode: value => ['M', 'm', 'custom'].includes(value),
  customPresetId: value => CUSTOM_SCALE_PRESETS.some(preset => preset.id === value),
  lang: value => ['auto', 'es', 'en'].includes(value),
  notation: value => ['solfege', 'letter'].includes(value),
  micFilterLevel: value => [0, 1, 2, 3].includes(value),
  cameraEnabled: value => typeof value === 'boolean',
  progressionIndex: value => Number.isInteger(value) && value >= -1 && value <= 15,
  tutorialDone: value => typeof value === 'boolean'
};

function loadPersistedConfig() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const safe = {};

    if (Array.isArray(parsed.selectedSounds) && parsed.selectedSounds.length >= 1 && parsed.selectedSounds.length <= 9) {
      safe.selectedSounds = parsed.selectedSounds.map(n => Math.max(0, Math.min(49, Number(n) || 0)));
    }
    if (Array.isArray(parsed.selectedDrums) && parsed.selectedDrums.length >= 1 && parsed.selectedDrums.length <= 9) {
      safe.selectedDrums = parsed.selectedDrums.map(n => Math.max(0, Math.min(49, Number(n) || 0)));
    }
    if (Array.isArray(parsed.selectedAccompaniments) && parsed.selectedAccompaniments.length >= 1 && parsed.selectedAccompaniments.length <= 9) {
      safe.selectedAccompaniments = parsed.selectedAccompaniments.map(n => Math.max(0, Math.min(49, Number(n) || 0)));
    }
    if (typeof parsed.rootSemitone === 'number') {
      safe.rootSemitone = ((Math.round(parsed.rootSemitone) % 12) + 12) % 12;
    }
    if (typeof parsed.bpm === 'number' && parsed.bpm >= 40 && parsed.bpm <= 220) {
      safe.bpm = Math.round(parsed.bpm);
    }
    if (['filter', 'volume', 'drive'].includes(parsed.yAxisMode)) {
      safe.yAxisMode = parsed.yAxisMode;
    }
    if (typeof parsed.keyStrike === 'boolean') {
      safe.keyStrike = parsed.keyStrike;
    }
    for (const [key, isValid] of Object.entries(v2ConfigValidators)) {
      if (isValid(parsed[key])) safe[key] = parsed[key];
    }
    const preset = CUSTOM_SCALE_PRESETS.find(({ id }) => id === safe.customPresetId);
    safe.customScale = sanitizeCustomScale(parsed.customScale ?? preset?.degrees);
    return safe;
  } catch (_) {
    return {};
  }
}

const state = {
  ...DEFAULT_STATE,
  ...loadPersistedConfig()
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  let changed = false;
  const changedKeys = [];
  for (const [k, value] of Object.entries(patch)) {
    const isValid = Object.hasOwn(v2ConfigValidators, k) && v2ConfigValidators[k];
    if (isValid && !isValid(value)) continue;
    if (k === 'progressionPlaying' && typeof value !== 'boolean') continue;
    const v = k === 'customScale' ? sanitizeCustomScale(value) : value;
    if (state[k] !== v) {
      state[k] = v;
      changed = true;
      changedKeys.push(k);
    }
  }
  if (changed) {
    persistConfig();
    for (const fn of listeners) {
      fn(state, changedKeys);
    }
  }
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persistConfig() {
  try {
    if (typeof localStorage === 'undefined') return;
    const toSave = {
      selectedSounds: state.selectedSounds,
      selectedDrums: state.selectedDrums,
      selectedAccompaniments: state.selectedAccompaniments,
      rootSemitone: state.rootSemitone,
      scaleMode: state.scaleMode,
      customScale: state.customScale,
      customPresetId: state.customPresetId,
      lang: state.lang,
      notation: state.notation,
      micFilterLevel: state.micFilterLevel,
      cameraEnabled: state.cameraEnabled,
      progressionIndex: state.progressionIndex,
      tutorialDone: state.tutorialDone,
      bpm: state.bpm,
      yAxisMode: state.yAxisMode,
      keyStrike: state.keyStrike
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (_) {}
}
