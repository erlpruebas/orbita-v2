/**
 * drum-engine.js — Síntesis de batería 100% seca y con pegada (REGLAS_NO_ROMPER.md #4)
 * + Catálogo de 50 patrones 4/4 (16 semicorcheas por compás), encabezados por los 6 originales v01/v04.
 */

import { ensureAudioUnlocked, getDrumDestination, safeParam } from './audio-core.js';
import { getState } from './state.js';

let noiseBuffer = null;

function getNoiseBuffer(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const len = ctx.sampleRate * 1.0;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * Voces individuales de batería (100% secas, conectadas a getDrumDestination)
 */
export function triggerDrumVoice(voiceType, when = null, velocity = 1.0, customDest = null) {
  const ctx = ensureAudioUnlocked();
  const dest = customDest || getDrumDestination();
  const t = when !== null ? Math.max(ctx.currentTime, when) : ctx.currentTime;
  const vel = Math.max(0.15, Math.min(1.3, velocity));

  if (voiceType === 'K') {
    // BOMBO (Kick): Punch analógico con barrido de pitch + click sutil
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(148, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.065);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.24);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.88 * vel, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.28);

  } else if (voiceType === 'S') {
    // CAJA (Snare): Cuerpo tonal + bordona de ruido filtrado
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(195, t);
    bodyOsc.frequency.exponentialRampToValueAtTime(108, t + 0.075);

    bodyGain.gain.setValueAtTime(0.45 * vel, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    bodyOsc.connect(bodyGain);
    bodyGain.connect(dest);
    bodyOsc.start(t);
    bodyOsc.stop(t + 0.12);

    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1100, t);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.52 * vel, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(dest);
    noise.start(t);
    noise.stop(t + 0.18);

  } else if (voiceType === 'R') {
    // ARO / CLAVE (Rimshot): Madera resonante corta
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(310, t + 0.032);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1550, t);
    filter.Q.setValueAtTime(3.8, t);

    gain.gain.setValueAtTime(0.55 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.048);

  } else if (voiceType === 'C') {
    // PALMA (Clap): Ráfaga de ruido filtrado paso-banda
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1350, t);
    filter.Q.setValueAtTime(1.8, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.46 * vel, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.12 * vel, t + 0.011);
    gain.gain.linearRampToValueAtTime(0.48 * vel, t + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(t);
    noise.stop(t + 0.17);

  } else if (voiceType === 'H') {
    // CHARLES CERRADO (Closed Hi-Hat)
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7200, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(t);
    noise.stop(t + 0.052);

  } else if (voiceType === 'O') {
    // CHARLES ABIERTO (Open Hi-Hat)
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6400, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.30 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(t);
    noise.stop(t + 0.24);

  } else if (voiceType === 'P') {
    // PERCUSIÓN (Conga / Tom cálido)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(135, t + 0.095);

    gain.gain.setValueAtTime(0.42 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

/**
 * Helper compacto para definir patrones de 16 pasos (compás 4/4):
 * Cada cadena de 16 caracteres usa '.' para silencio y 'X' (fuerte) / 'x' (suave) para golpe.
 */
function pat(id, name, category, tracks) {
  return { id, name, category, tracks };
}

export const DRUM_PATTERNS = [
  // === LOS 6 PATRONES ORIGINALES DE v01 / v04 ===
  pat(0, 'Lo-Fi', 'Original v01 · Chill Dust', {
    K: 'X..x..X...x.....',
    S: '....X.......X..x',
    H: 'x.x.x.x.x.x.x.x.',
    R: '.......x........'
  }),
  pat(1, 'Pop', 'Original v01 · 4/4 Clásico', {
    K: 'X.......X.x.....',
    S: '....X.......X...',
    H: 'x.x.x.x.x.x.x.x.',
    O: '..............x.'
  }),
  pat(2, 'Bossa Nova', 'Original v01 · Clave Brasil', {
    K: 'X..xX..xX..xX..x',
    R: 'X..x..x...x.x...',
    H: 'x.x.x.x.x.x.x.x.',
    P: '...x...x...x...x'
  }),
  pat(3, 'House', 'Original v01 · 4-on-the-Floor', {
    K: 'X...X...X...X...',
    C: '....X.......X...',
    H: 'x..xx..xx..xx..x',
    O: '..X...X...X...X.'
  }),
  pat(4, 'Pulso', 'Original v01 · Minimal Electrik', {
    K: 'X...x...X...x...',
    R: '....X.......X...',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(5, 'Funk', 'Original v01 · Groove Sincopado', {
    K: 'X..x..X...x.X...',
    S: '....X..x.x..X..x',
    H: 'Xxx.Xxx.Xxx.Xxx.',
    O: '..............X.'
  }),

  // === 7..50: CATÁLOGO AMPLIADO DE 50 BATERÍAS 4/4 ===
  pat(6, 'Boom Bap 90s', 'Hip-Hop · MPC Groove', {
    K: 'X..x...x..X.....',
    S: '....X.......X...',
    H: 'X.x.X.x.X.x.X.xx'
  }),
  pat(7, 'Reggae One Drop', 'Jamaica · Pulso en el 3', {
    K: '........X.......',
    R: '........X.....x.',
    H: 'x.X.x.X.x.X.x.X.',
    P: '...x.......x....'
  }),
  pat(8, 'Reggaeton Dembow', 'Urbano · Tresillo Latino', {
    K: 'X...X...X...X...',
    S: '...X..X....X..X.',
    H: 'x.x.x.x.x.x.x.x.',
    R: 'X.....x.X.....x.'
  }),
  pat(9, 'Afrobeat Lagos', 'África · Polirritmia', {
    K: 'X..x..X...x...X.',
    R: 'x.x..x.x..x.x...',
    H: 'x.xxx.xxx.xxx.xx',
    P: '....X..x....X..x'
  }),
  pat(10, 'Synthwave 80s', 'Retro · Linndrum Drive', {
    K: 'X...x...X.x.....',
    S: '....X.......X...',
    C: '....x.......x...',
    H: 'x.x.x.x.x.x.x.x.',
    P: '..............xx'
  }),
  pat(11, 'Disco 70s', 'Studio 54 · Hi-Hat Abierto', {
    K: 'X...X...X...X...',
    S: '....X.......X...',
    C: '....X.......X...',
    H: 'X.x.X.x.X.x.X.x.',
    O: '..X...X...X...X.'
  }),
  pat(12, 'Neo-Soul Swing', 'Dilla · Pocket Groove', {
    K: 'X..x....X..x....',
    S: '....X..x....X...',
    R: '.......x.......x',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(13, 'Trap Hi-Hats', '808 · Redobles Rápidos', {
    K: 'X.....X...x...X.',
    C: '........X.......',
    H: 'XxxxX.x.XxxxXxxx',
    O: '....x.......x...'
  }),
  pat(14, 'Drum & Bass', 'Breakbeat · Amen Ligero', {
    K: 'X.........X.....',
    S: '....X..x....X..x',
    H: 'X.x.X.x.X.x.X.x.'
  }),
  pat(15, 'Techno Minimal', 'Berlín · Hipnótico', {
    K: 'X...X...X...X...',
    R: '..x...x...x..xx.',
    H: '..X...X...X...X.',
    P: '...x...x...x...x'
  }),
  pat(16, 'UK Garage 2-Step', 'Londres · Shuffle Skippy', {
    K: 'X.....x...X.....',
    S: '....X.......X...',
    H: 'x.X.x.x.x.X.x.xx',
    R: '.......x.......x'
  }),
  pat(17, 'Samba Ligera', 'Brasil · Surdo y Tamborim', {
    K: 'X..XX..XX..XX..X',
    R: 'x.x..x.x.x..x.x.',
    H: 'xxxxxxxxxxxxxxxx',
    P: '..X...X...X...X.'
  }),
  pat(18, 'Bolero Clásico', 'Latino · Cálido Nocturno', {
    K: 'X.....x.X.....x.',
    R: 'X..x..x.X..x..x.',
    H: 'x.x.x.x.x.x.x.x.',
    P: '....X..x....X..x'
  }),
  pat(19, 'Motown Soul', 'Detroit · Caja en los 4 Tiempos', {
    K: 'X..x....X..x....',
    S: 'X...X...X...X...',
    H: 'x.x.x.x.x.x.x.x.',
    C: '....X.......X...'
  }),
  pat(20, 'Indie Rock', 'Garaje · Directo', {
    K: 'X.x.....X.x...x.',
    S: '....X..x....X...',
    H: 'X.x.X.x.X.x.X.x.',
    O: '..............X.'
  }),
  pat(21, 'Motorik Kraut', 'Neu! · Autopista 4/4', {
    K: 'X.x.X.x.X.x.X.x.',
    S: '....X.......X...',
    H: 'xxxxxxxxxxxxxxxx',
    O: '..............X.'
  }),
  pat(22, 'Electro 808', 'Kraftwerk · Robótico', {
    K: 'X..x..X.....X...',
    S: '....X.......X...',
    C: '....X..x....X...',
    H: 'x.x.x.x.x.x.x.x.',
    P: '...x......xx....'
  }),
  pat(23, 'Breakbeat Funky', 'Block Party · B-Boy', {
    K: 'X.x...X...x.....',
    S: '....X..x.x..X..x',
    H: 'X.x.X.x.X.x.X.x.',
    P: '.......x......x.'
  }),
  pat(24, 'Hip-Hop Jazz', 'A Tribe · Suave', {
    K: 'X..x......X.x...',
    R: '....X.......X...',
    H: 'x.X.x.X.x.X.x.X.',
    P: '.......x........'
  }),
  pat(25, 'R&B Slow Jam', 'Balada Soul · Sedoso', {
    K: 'X..x......x.X...',
    C: '....X.......X...',
    R: '....X..x....X...',
    H: 'x.x.x.x.x.x.x.xx'
  }),
  pat(26, 'Cumbia Digital', 'Andes · Güiro y Conga', {
    K: 'X...X...X...X...',
    H: 'x..xx..xx..xx..x',
    P: '..X...x...X...x.',
    R: '....X.......X...'
  }),
  pat(27, 'Salsa Clave 2-3', 'Caribe · Son Montuno', {
    K: '...x..X....x..X.',
    R: '..X.X...X..x.x..',
    H: 'x.x.x.x.x.x.x.x.',
    P: 'X..x..X.X..x..X.'
  }),
  pat(28, 'Tango Electrónico', 'Buenos Aires · Marcato', {
    K: 'X...X...X...X..x',
    S: '....X.......X.x.',
    R: 'X..x..X.X..x..X.',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(29, 'Rumba Pop', 'Mediterráneo · Palmas', {
    K: 'X..x..X...x.X...',
    C: '..x.X..x..x.X.x.',
    H: 'x.x.x.x.x.x.x.x.',
    P: '...x..X....x..X.'
  }),
  pat(30, 'Shuffle Blues', 'Chicago · Atresillado', {
    K: 'X..x..X...x.....',
    S: '....X..x....X..x',
    H: 'X..xX..xX..xX..x'
  }),
  pat(31, 'Country Train', 'Nashville · Locomotora', {
    K: 'X...X...X...X...',
    S: '..x.X.x...x.X.xx',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(32, 'Gospel Groove', 'Iglesia · Palmas a Contratiempo', {
    K: 'X.x...X.X.x.....',
    S: '....X.......X...',
    C: '..X...X...X...X.',
    H: 'X.x.X.x.X.x.X.x.'
  }),
  pat(33, 'Ambient Pulse', 'Espacial · Minimalista', {
    K: 'X.......x.......',
    R: '............x...',
    H: 'x...x...x...x...',
    P: '......x.......x.'
  }),
  pat(34, 'IDM Microbeat', 'Warp · Glitch Elegante', {
    K: 'X..x....x.X.....',
    R: '....X.xx....X..x',
    H: 'xx.xx.x.xxx.x.xx',
    P: '..x.......x.....'
  }),
  pat(35, 'Dubstep Half-Time', 'Subgrave · Caja en el 3', {
    K: 'X.....x.........',
    S: '........X.......',
    H: 'x.x.x.x.x.x.x.x.',
    O: '......X.......X.'
  }),
  pat(36, 'Miami Bass', 'Electro · Boom 808', {
    K: 'X..x..X...x.X...',
    C: '....X.......X...',
    H: 'xxxxxxxxxxxxxxxx',
    O: '..x...x...x...x.'
  }),
  pat(37, 'Italo Disco', 'Milán 1983 · Arpeggio Beat', {
    K: 'X...X...X...X...',
    S: '....X.......X...',
    C: '....X.......X...',
    H: 'x.X.x.X.x.X.x.X.',
    P: '...........x..xx'
  }),
  pat(38, 'French Touch', 'París · Filtro Funk', {
    K: 'X...X...X...X..x',
    C: '....X.......X...',
    H: 'x.X.x.X.x.X.x.X.',
    O: '..X.......X.....'
  }),
  pat(39, 'Deep House', 'Nocturno · Percusivo', {
    K: 'X...X...X...X...',
    R: '....X.......X...',
    H: '..X...X...X..xX.',
    P: '...x..x....x..x.'
  }),
  pat(40, 'Tribal Perc', 'Selva · Tambores', {
    K: 'X..x..X.X..x..X.',
    P: '.x.X.x...x.X.x.X',
    R: 'X..x..x.X..x..x.',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(41, 'Cha-Cha-Chá', 'Habana · Ritmo Salón', {
    K: 'X...x...X...x...',
    R: '..X...X...X.X.X.',
    H: 'x.x.x.x.x.x.x.x.',
    P: '....X..x....X.X.'
  }),
  pat(42, 'Mambo Beat', 'Pérez Prado · Big Band', {
    K: 'X..x..X...x.X...',
    R: 'X..x..x...x.x...',
    H: 'X.x.X.x.X.x.X.x.',
    P: '..X.X..x..X.X..x'
  }),
  pat(43, 'Dancehall Kingston', 'Riddim · Rebote', {
    K: 'X..x..X.X..x..X.',
    R: '...X..X....X..X.',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(44, 'Ska Upbeat', '2-Tone · Contratiempo', {
    K: 'X.......X.......',
    S: '....X.......X..x',
    H: '..X...X...X...X.',
    R: '..x...x...x...x.'
  }),
  pat(45, 'Punk Fast', 'D-Beat · Energía Alta', {
    K: 'X.X...X.X.X...X.',
    S: '..X...X...X...X.',
    H: 'X.X.X.X.X.X.X.X.',
    O: '..............X.'
  }),
  pat(46, 'Ballad Rimshot', 'Íntimo · Balada Acústica', {
    K: 'X.........x.....',
    R: '....X.......X...',
    H: 'x.x.x.x.x.x.x.x.'
  }),
  pat(47, 'Chillhop Dust', 'Estudio · Vinilo Suave', {
    K: 'X..x......X.....',
    R: '....X..x........',
    S: '............X...',
    H: 'x.x.x.x.x.x.x.xx'
  }),
  pat(48, 'Vaporwave Slow', 'Mallsoft · Eco 80s', {
    K: 'X.....X...X.....',
    S: '....X.......X...',
    C: '............X...',
    H: 'x.x.x.x.x.x.x.x.',
    P: '......x.......xx'
  }),
  pat(49, 'Estadio Rock', 'We Will · Himno Arena', {
    K: 'X.X.....X.X.....',
    C: '....X.......X...',
    S: '....X.......X...',
    H: 'x.x.x.x.x.x.x.x.'
  })
];

export function getDrumPatternById(patternId) {
  const idx = Math.max(0, Math.min(DRUM_PATTERNS.length - 1, Number(patternId) || 0));
  return DRUM_PATTERNS[idx];
}

export function getActiveDrumPattern() {
  const st = getState();
  const slot = Math.max(0, Math.min(st.selectedDrums.length - 1, st.activeDrumSlot || 0));
  const patId = st.selectedDrums[slot] ?? 0;
  return getDrumPatternById(patId);
}

/**
 * Dispara todas las voces activas de un patrón de batería en el paso `stepIndex` (0..15)
 */
export function triggerDrumPatternStep(pattern, stepIndex, when = null, customDest = null) {
  if (!pattern || !pattern.tracks) return;
  const step = ((stepIndex % 16) + 16) % 16;

  for (const [voice, grid] of Object.entries(pattern.tracks)) {
    const ch = grid[step];
    if (ch === 'X') {
      triggerDrumVoice(voice, when, 1.0, customDest);
    } else if (ch === 'x') {
      triggerDrumVoice(voice, when, 0.58, customDest);
    }
  }
}

/**
 * Preescucha del patrón de batería en el modal Configuración (50→9) al BPM actual:
 * Suena UNA SOLA VEZ (1 compás de 16 pasos) y se calla automáticamente.
 */
let previewDrumTimer = null;
let previewDrumPatternId = null;
let previewDrumStep = 0;
let previewDrumCallback = null;

export function stopDrumPreview() {
  if (previewDrumTimer) {
    clearInterval(previewDrumTimer);
    previewDrumTimer = null;
  }
  const prevId = previewDrumPatternId;
  previewDrumPatternId = null;
  previewDrumStep = 0;
  if (previewDrumCallback) {
    const cb = previewDrumCallback;
    previewDrumCallback = null;
    cb(prevId, false);
  }
}

export function playDrumPreviewOnce(patternId, onStatusChange) {
  stopDrumPreview();
  ensureAudioUnlocked();
  const pattern = getDrumPatternById(patternId);
  const bpm = getState().bpm || 92;
  const stepMs = ((60 / bpm) / 4) * 1000;

  previewDrumPatternId = patternId;
  previewDrumCallback = onStatusChange;
  previewDrumStep = 0;

  if (onStatusChange) onStatusChange(patternId, true);

  // Disparo inmediato del paso 0 y continuación durante 1 solo compás (16 semicorcheas) y se calla
  triggerDrumPatternStep(pattern, 0);
  previewDrumStep = 1;

  previewDrumTimer = setInterval(() => {
    if (previewDrumStep >= 16) {
      stopDrumPreview();
      return;
    }
    triggerDrumPatternStep(pattern, previewDrumStep);
    previewDrumStep++;
  }, stepMs);

  return true;
}
