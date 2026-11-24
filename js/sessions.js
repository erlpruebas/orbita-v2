/**
 * sessions.js — Guardado y restauración de canciones en el dispositivo.
 */

import { setReverbLevel } from './audio-core.js';
import { exportLooperSnapshot, importLooperSnapshot, stopAllTransportForPlayback } from './clock-looper.js';
import { t } from './i18n.js';
import { getState, setState } from './state.js';
import { CUSTOM_SCALE_PRESETS, sanitizeCustomScale } from './theory.js';

const STORAGE_KEY = 'orbita_v2_sessions_v1';
const DEFAULT_BANK = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (_) {
    return null;
  }
}

export function listSessions(storage) {
  const adapter = resolveStorage(storage);
  try {
    const sessions = JSON.parse(adapter?.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(sessions)) return [];
    return sessions
      .filter(session => typeof session?.id === 'string' && typeof session.name === 'string' &&
        typeof session.updatedAt === 'string')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (_) {
    return [];
  }
}

function intInRange(value, min, max, fallback = min) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function cleanBank(bank) {
  const validIds = Array.isArray(bank) ? bank.filter(id => Number.isInteger(id) && id >= 0 && id <= 49) : [];
  return validIds.length > 0 ? validIds.slice(0, 9) : [...DEFAULT_BANK];
}

function cleanName(name, lang) {
  return (typeof name === 'string' && name.trim()) || t('sessions.untitled', lang);
}

export function buildSessionPayload(name, state, looperSnapshot) {
  const selectedSounds = cleanBank(state.selectedSounds);
  const selectedDrums = cleanBank(state.selectedDrums);
  const selectedAccompaniments = cleanBank(state.selectedAccompaniments);
  const preset = CUSTOM_SCALE_PRESETS.find(({ id }) => id === state.customPresetId) ?? CUSTOM_SCALE_PRESETS[0];

  return {
    name: cleanName(name, state.lang),
    rootSemitone: intInRange(state.rootSemitone, 0, 11),
    scaleMode: ['M', 'm', 'custom'].includes(state.scaleMode) ? state.scaleMode : 'M',
    customScale: sanitizeCustomScale(state.customScale ?? preset.degrees),
    customPresetId: preset.id,
    playMode: state.playMode === 'melody' ? 'melody' : 'chord',
    humanize: intInRange(state.humanize, 0, 3),
    reverbLevel: intInRange(state.reverbLevel, 0, 3),
    accompaniment: intInRange(state.accompaniment, 0, selectedAccompaniments.length),
    selectedAccompaniments,
    octaveOffset: intInRange(state.octaveOffset, -2, 2, 0),
    activeSoundSlot: intInRange(state.activeSoundSlot, 0, selectedSounds.length - 1),
    selectedSounds,
    bpm: intInRange(state.bpm, 40, 220, 92),
    activeDrumSlot: intInRange(state.activeDrumSlot, 0, selectedDrums.length - 1),
    selectedDrums,
    yAxisMode: ['filter', 'volume', 'drive'].includes(state.yAxisMode) ? state.yAxisMode : 'filter',
    keyStrike: typeof state.keyStrike === 'boolean' ? state.keyStrike : true,
    progressionIndex: intInRange(state.progressionIndex, -1, 15),
    looperSnapshot: looperSnapshot == null ? null : structuredClone(looperSnapshot)
  };
}

export function saveCurrentSession(name, storage) {
  const adapter = resolveStorage(storage);
  if (!adapter) return null;

  const now = new Date().toISOString();
  const record = {
    ...buildSessionPayload(name, getState(), exportLooperSnapshot()),
    id: globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    updatedAt: now
  };
  adapter.setItem(STORAGE_KEY, JSON.stringify([record, ...listSessions(adapter)]));
  return record;
}

export function loadSession(id, storage) {
  const record = listSessions(storage).find(session => session.id === id);
  if (!record) return null;

  const { name, looperSnapshot, ...settings } = buildSessionPayload(record.name, record, record.looperSnapshot);
  stopAllTransportForPlayback();
  setState(settings);
  setReverbLevel(settings.reverbLevel);
  importLooperSnapshot(looperSnapshot);
  return { ...record, ...settings, name, looperSnapshot };
}

export function renameSession(id, newName, storage) {
  const adapter = resolveStorage(storage);
  const sessions = listSessions(adapter);
  const record = sessions.find(session => session.id === id);
  if (!record) return null;

  const updated = { ...record, name: cleanName(newName, getState().lang), updatedAt: new Date().toISOString() };
  adapter.setItem(STORAGE_KEY, JSON.stringify([updated, ...sessions.filter(session => session.id !== id)]));
  return updated;
}

export function deleteSession(id, storage) {
  const adapter = resolveStorage(storage);
  const sessions = listSessions(adapter);
  const remaining = sessions.filter(session => session.id !== id);
  if (remaining.length === sessions.length) return false;

  adapter.setItem(STORAGE_KEY, JSON.stringify(remaining));
  return true;
}
