/**
 * progressions.js — Catálogo de progresiones y reproducción a compás.
 */

import { ensureAudioUnlocked } from './audio-core.js';
import { setProgressionAccompanimentDegree } from './accompaniment.js';
import { toggleProgressionPlayback } from './clock-looper.js';
import { getState, setState } from './state.js';
import { startHumanizedVoiceGroup } from './synth-presets.js';
import { getDiatonicDegrees, ROMAN_DEGREES } from './theory.js';

export const POPULAR_PROGRESSIONS = Object.freeze([
  ['universal_pop', 'Pop Universal', 'Universal Pop', [0, 4, 5, 3], 'Pop', 'Pop'],
  ['modern_emotive', 'Emotiva Moderna', 'Modern Emotive', [5, 3, 0, 4], 'Pop alternativo', 'Alternative Pop'],
  ['andalusian', 'Cadencia Andaluza', 'Andalusian Cadence', [0, 6, 5, 4], 'Flamenco', 'Flamenco'],
  ['fifties_ballad', 'Balada 50s', '50s Ballad', [0, 5, 3, 4], 'Doo-wop', 'Doo-wop'],
  ['pachelbel', 'Canon Pachelbel', 'Pachelbel’s Canon', [0, 4, 5, 2, 3, 0, 3, 4], 'Clásica', 'Classical'],
  ['classic_rock', 'Rock Clásico', 'Classic Rock', [0, 3, 4, 3], 'Rock', 'Rock'],
  ['indie_folk', 'Indie Folk', 'Indie Folk', [3, 0, 4, 5], 'Folk', 'Folk'],
  ['soft_jazz_pop', 'Jazz-Pop Suave', 'Soft Jazz-Pop', [1, 4, 0, 5], 'Jazz-Pop', 'Jazz-Pop'],
  ['reggaeton', 'Urbano / Reggaeton', 'Urban / Reggaeton', [0, 5, 2, 6], 'Urbano', 'Urban'],
  ['descending_neo_soul', 'Neo-Soul Descendente', 'Descending Neo-Soul', [3, 2, 1, 0], 'Neo-Soul', 'Neo-Soul'],
  ['nostalgic_ballad', 'Balada Nostálgica', 'Nostalgic Ballad', [0, 2, 3, 4], 'Balada', 'Ballad'],
  ['dance_house', 'Dance / House', 'Dance / House', [5, 4, 3, 4], 'Electrónica', 'Electronic'],
  ['minor_blues', 'Blues Menor', 'Minor Blues', [0, 0, 3, 0, 4, 3], 'Blues', 'Blues'],
  ['cinematic_epic', 'Épica Cinemática', 'Cinematic Epic', [5, 6, 0, 0], 'Cinemática', 'Cinematic'],
  ['soft_bossa', 'Bossa Suave', 'Soft Bossa', [0, 1, 4, 0], 'Bossa nova', 'Bossa Nova'],
  ['ascending_pop', 'Pop Ascendente', 'Ascending Pop', [0, 3, 5, 4], 'Pop', 'Pop']
].map(([id, nameEs, nameEn, degrees, genreEs, genreEn]) => Object.freeze({
  id, nameEs, nameEn, roman: degrees.map(degree => ROMAN_DEGREES[degree]).join(' - '),
  degrees: Object.freeze(degrees), genreEs, genreEn
})));

const activeVoices = new Set();
let visualCallback = null;
let visualTimer = null;

export function setProgressionVisualCallback(fn) {
  visualCallback = typeof fn === 'function' ? fn : null;
}

export function onProgressionClockStep(absStepIndex, stepTime) {
  const st = getState();
  if (!st.progressionPlaying || absStepIndex % 16 !== 0) return;

  const prog = POPULAR_PROGRESSIONS[st.progressionIndex];
  if (!prog) return;
  const barIndex = Math.floor(absStepIndex / 16);
  const degreeIndex = prog.degrees[barIndex % prog.degrees.length];
  const now = ensureAudioUnlocked().currentTime;

  for (const voice of activeVoices) {
    if (voice.endsAt <= now) activeVoices.delete(voice);
  }

  setProgressionAccompanimentDegree(degreeIndex, stepTime);
  const degree = getDiatonicDegrees(st.rootSemitone, st.scaleMode, 0, st.customScale, st.notation)[degreeIndex];
  const barDur = (60 / st.bpm) * 4;
  const isManual = st.accompaniment === 0;
  // Con patrón activo, la tríada inicial deja espacio para el resto del arreglo.
  const voice = startHumanizedVoiceGroup(degree.triadMidi, {
    when: stepTime,
    duration: isManual ? barDur * 0.96 : barDur / 4,
    velocity: isManual ? 0.78 : 0.55,
    humanize: st.humanize
  });
  activeVoices.add(voice);

  if (visualCallback) {
    clearTimeout(visualTimer);
    if (stepTime <= now) {
      visualTimer = null;
      visualCallback(degreeIndex);
    } else {
      visualTimer = setTimeout(() => {
        visualTimer = null;
        visualCallback?.(degreeIndex);
      }, (stepTime - now) * 1000);
    }
  }
}

export function stopProgressionPlaybackEngine() {
  setProgressionAccompanimentDegree(null);
  for (const voice of activeVoices) voice.stop(null, true);
  activeVoices.clear();
  clearTimeout(visualTimer);
  visualTimer = null;
  visualCallback?.(null);
}

export function selectProgression(deltaOrIndex, isAbsolute = false) {
  const st = getState();
  if (!Number.isInteger(deltaOrIndex)) return st.progressionIndex;

  const count = POPULAR_PROGRESSIONS.length + 1;
  const position = st.progressionIndex + 1 + deltaOrIndex;
  const index = isAbsolute
    ? Math.max(-1, Math.min(count - 2, deltaOrIndex))
    : ((position % count + count) % count) - 1;
  if (index === -1 && st.progressionPlaying) toggleProgressionPlayback();
  setState({ progressionIndex: index });
  return index;
}
