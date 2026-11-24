/**
 * theory.js — Escalas, nombres de notas, tríadas y frecuencias
 */

export const NOTE_NAMES_UPPER = [
  'DO', 'DO#', 'RE', 'RE#', 'MI', 'FA',
  'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'
];

export const NOTE_NAMES_TITLE = [
  'Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa',
  'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'
];

const NOTE_NAMES_LETTER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export const INTERVAL_ROMANS = Object.freeze(['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII']);

// Atajos de PC inamovibles (REGLAS_NO_ROMPER.md #5): Z (I), S (II), X (III), D (IV), C (V), F (VI), V (VII)
export const DEGREE_SHORTCUTS = ['Z', 'S', 'X', 'D', 'C', 'F', 'V'];

export const VALID_CUSTOM_QUALITIES = Object.freeze(['M', 'm']);

export const CUSTOM_SCALE_PRESETS = Object.freeze([
  ['major', 'Mayor natural', 'Natural Major',
    'Los siete grados de la escala mayor con acordes mayores y menores.', 'The seven degrees of the major scale with major and minor chords.',
    [[0, 'M'], [2, 'm'], [4, 'm'], [5, 'M'], [7, 'M'], [9, 'm'], [11, 'm']]],
  ['minor', 'Menor natural', 'Natural Minor',
    'La escala diatónica menor con quinto grado menor.', 'The minor diatonic scale with a minor fifth-degree chord.',
    [[0, 'm'], [2, 'm'], [3, 'M'], [5, 'm'], [7, 'm'], [8, 'M'], [10, 'M']]],
  ['andalusian', 'Cadencia Andaluza', 'Andalusian Cadence',
    'Escala menor con V mayor para la cadencia I–VII–VI–V.', 'Minor scale with a major V for the I–VII–VI–V cadence.',
    [[0, 'm'], [2, 'm'], [3, 'M'], [5, 'm'], [7, 'M'], [8, 'M'], [10, 'M']]],
  ['harmonic_minor', 'Menor Armónica', 'Harmonic Minor',
    'Menor con séptimo grado elevado y V mayor.', 'Minor with a raised seventh degree and a major V.',
    [[0, 'm'], [2, 'm'], [3, 'M'], [5, 'm'], [7, 'M'], [8, 'M'], [11, 'm']]],
  ['dorian', 'Dórica (Pop/Funk)', 'Dorian (Pop/Funk)',
    'Modo menor con sexta mayor y IV mayor.', 'A minor mode with a major sixth and a major IV.',
    [[0, 'm'], [2, 'm'], [3, 'M'], [5, 'M'], [7, 'm'], [9, 'm'], [10, 'M']]],
  ['mixolydian', 'Mixolidia (Rock/Folk)', 'Mixolydian (Rock/Folk)',
    'Modo mayor con séptima menor y acorde VII mayor.', 'A major mode with a minor seventh and a major VII chord.',
    [[0, 'M'], [2, 'm'], [4, 'm'], [5, 'M'], [7, 'm'], [9, 'm'], [10, 'M']]],
  ['epic_ballad', 'Balada Épica (IVm)', 'Epic Ballad (IVm)',
    'Acordes mayores y menores prestados para baladas, con IV menor.', 'Borrowed major and minor chords for ballads, including a minor IV.',
    [[0, 'M'], [2, 'm'], [4, 'm'], [5, 'm'], [7, 'M'], [8, 'M'], [10, 'M']]],
  ['lydian', 'Lidia (Cinemática)', 'Lydian (Cinematic)',
    'Modo mayor con cuarta aumentada y II mayor.', 'A major mode with an augmented fourth and a major II.',
    [[0, 'M'], [2, 'M'], [4, 'm'], [6, 'm'], [7, 'M'], [9, 'm'], [11, 'm']]]
].map(([id, nameEs, nameEn, descEs, descEn, degrees]) => Object.freeze({
  id, nameEs, nameEn, descEs, descEn,
  degrees: Object.freeze(degrees.map(([semitones, quality]) => Object.freeze({ semitones, quality })))
})));

const [majorPreset, minorPreset] = CUSTOM_SCALE_PRESETS;

export function sanitizeCustomScale(raw) {
  return majorPreset.degrees.map((fallback, index) => {
    const degree = Array.isArray(raw) ? raw[index] : null;
    const { semitones, quality: rawQuality } = degree ?? {};
    const quality = rawQuality === 'dim' ? 'm' : rawQuality;
    return {
      semitones: Number.isInteger(semitones) && semitones >= 0 && semitones <= 11
        ? semitones
        : fallback.semitones,
      quality: VALID_CUSTOM_QUALITIES.includes(quality) ? quality : fallback.quality
    };
  });
}

const CHORD_INTERVALS = {
  M: [0, 4, 7],
  m: [0, 3, 7]
};

const SEVENTH_INTERVALS = {
  M: 11,   // Maj7
  m: 10    // m7
};

/**
 * Convierte nota MIDI a frecuencia en Hz (LA4 = 69 = 440 Hz)
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convierte frecuencia en Hz a número MIDI flotante
 */
export function freqToMidiFloat(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

function normalizePitchClass(pc) {
  return ((pc % 12) + 12) % 12;
}

export function getNoteNameUpper(pc, notation = 'solfege') {
  return (notation === 'letter' ? NOTE_NAMES_LETTER : NOTE_NAMES_UPPER)[normalizePitchClass(pc)];
}

export function getNoteNameTitle(pc, notation = 'solfege') {
  return (notation === 'letter' ? NOTE_NAMES_LETTER : NOTE_NAMES_TITLE)[normalizePitchClass(pc)];
}

export function formatChordLabel(pitchClass, quality, notation = 'solfege') {
  const base = getNoteNameTitle(pitchClass, notation);
  if (quality === 'm') return `${base}m`;
  return base;
}

/**
 * Devuelve la información completa de los 7 grados diatónicos para el estado actual
 */
export function getDiatonicDegrees(rootSemitone = 0, scaleMode = 'M', octaveOffset = 0, customScale = null, notation = 'solfege') {
  const baseRootMidi = 60 + normalizePitchClass(rootSemitone) + (octaveOffset * 12);
  const scale = scaleMode === 'm' ? minorPreset.degrees : majorPreset.degrees;
  const degrees = scaleMode === 'custom' ? sanitizeCustomScale(customScale) : scale;

  return degrees.map(({ semitones, quality }, idx) => {
    const noteMidi = baseRootMidi + semitones;
    const pitchClass = normalizePitchClass(noteMidi);
    const triadOffsets = CHORD_INTERVALS[quality];
    const triadMidi = triadOffsets.map(offset => noteMidi + offset);

    // En grado V de escala Mayor la 7ª diatónica es menor (dominante 7: +10 semitonos)
    const seventhOffset = (scaleMode === 'M' && idx === 4) ? 10 : SEVENTH_INTERVALS[quality];
    const seventhMidi = noteMidi + seventhOffset;

    const midiOctave = Math.floor(noteMidi / 12) - 1;
    const noteTitle = getNoteNameTitle(pitchClass, notation);

    return {
      degreeIndex: idx,
      roman: ROMAN_DEGREES[idx],
      intervalRoman: INTERVAL_ROMANS[semitones],
      shortcut: DEGREE_SHORTCUTS[idx],
      intervalSemitones: semitones,
      pitchClass,
      quality,
      noteUpper: getNoteNameUpper(pitchClass, notation),
      noteTitle,
      chordLabel: formatChordLabel(pitchClass, quality, notation),
      melodyLabel: `${noteTitle}${midiOctave}`,
      rootMidi: noteMidi,
      triadMidi,
      seventhMidi
    };
  });
}

/**
 * Devuelve las notas MIDI a disparar según el modo activo ('chord' vs 'melody')
 */
export function getDegreeTriggerNotes(degreeIndex, state) {
  const degrees = getDiatonicDegrees(state.rootSemitone, state.scaleMode, state.octaveOffset, state.customScale, state.notation);
  const deg = degrees[degreeIndex] || degrees[0];
  if (state.playMode === 'melody') {
    return [deg.rootMidi];
  }
  return deg.triadMidi;
}

/**
 * Calcula la pareja relativa Mayor / menor (ej. Do M / La m)
 */
export function getRelativePair(pitchClass, mode = 'M', notation = 'solfege') {
  const pc = normalizePitchClass(pitchClass);
  const majorRoot = mode === 'M' ? pc : (pc + 3) % 12;
  const minorRoot = mode === 'M' ? (pc + 9) % 12 : pc;
  const majorLabel = `${getNoteNameTitle(majorRoot, notation)} M`;
  const minorLabel = `${getNoteNameTitle(minorRoot, notation)} m`;
  return { majorRoot, minorRoot, majorLabel, minorLabel, combinedLabel: `${majorLabel} / ${minorLabel}` };
}
