/**
 * synth-presets.js — Catálogo de 50 sonidos sintetizados Web Audio (encabezados por los 6 originales v01/v04:
 * Bruma, Rhodes, Juno, Marimba, Órgano, Pluck), motor de humanización (0-3 LEDs) y preescucha de 1 sola vuelta.
 */

import { ensureAudioUnlocked, getSynthDestination, safeParam } from './audio-core.js';
import { getState } from './state.js';
import { midiToFreq, getDiatonicDegrees } from './theory.js';

export const SYNTH_PRESETS = [
  // === LOS 6 SONIDOS ORIGINALES DE v01 / v04 (INTOCABLES) ===
  {
    id: 0,
    name: 'Bruma',
    category: 'Original v01 · Pad + Campana FM',
    engine: 'brumaFlagship',
    attack: 0.025, decay: 0.9, sustain: 0.62, release: 0.45,
    cutoff: 2600, q: 1.3, fmRatio: 2.0, fmIndex: 1.35, detune: 8, gain: 0.24
  },
  {
    id: 1,
    name: 'Rhodes',
    category: 'Original v01 · Piano Eléctrico Tine',
    engine: 'electricPiano',
    attack: 0.006, decay: 1.15, sustain: 0.28, release: 0.32,
    cutoff: 3800, q: 1.1, fmRatio: 7.0, fmIndex: 1.15, detune: 4, gain: 0.27
  },
  {
    id: 2,
    name: 'Juno',
    category: 'Original v01 · Polysynth Analógico 80s',
    engine: 'analogPoly',
    osc1: 'sawtooth', osc2: 'square', subGain: 0.25,
    attack: 0.015, decay: 0.45, sustain: 0.65, release: 0.30,
    cutoff: 2400, envMod: 2200, q: 1.8, detune: 11, gain: 0.21
  },
  {
    id: 3,
    name: 'Marimba',
    category: 'Original v01 · Madera Percusiva',
    engine: 'malletWood',
    attack: 0.004, decay: 0.34, sustain: 0.02, release: 0.20,
    cutoff: 4200, q: 1.2, harmonicRatio: 4.0, harmonicAmt: 0.48, gain: 0.32
  },
  {
    id: 4,
    name: 'Órgano',
    category: 'Original v01 · Drawbars Cálido',
    engine: 'drawbarOrgan',
    drawbars: [0.5, 1.0, 0.72, 0.35, 0.22, 0.12],
    attack: 0.010, decay: 0.15, sustain: 0.88, release: 0.14,
    cutoff: 4800, q: 0.8, clickAmt: 0.18, gain: 0.22
  },
  {
    id: 5,
    name: 'Pluck',
    category: 'Original v01 · Cuerda Pulsada Limpia',
    engine: 'pluckString',
    osc1: 'sawtooth', osc2: 'triangle',
    attack: 0.004, decay: 0.38, sustain: 0.08, release: 0.22,
    cutoff: 950, envMod: 4600, q: 2.1, detune: 6, gain: 0.25
  },

  // === 7..50: CATÁLOGO AMPLIADO BOUTIQUE (44 TIMBRES) ===
  {
    id: 6, name: 'Wurlitzer 200A', category: 'Teclado Vintage · Lengüeta',
    engine: 'electricPiano', attack: 0.005, decay: 0.9, sustain: 0.32, release: 0.26,
    cutoff: 3100, q: 1.6, fmRatio: 3.0, fmIndex: 1.6, detune: 3, gain: 0.25
  },
  {
    id: 7, name: 'Clavinet Funk D6', category: 'Teclado Vintage · Funk',
    engine: 'pluckString', osc1: 'sawtooth', osc2: 'square',
    attack: 0.003, decay: 0.26, sustain: 0.15, release: 0.14,
    cutoff: 1400, envMod: 5400, q: 3.2, detune: 4, gain: 0.22
  },
  {
    id: 8, name: 'Prophet Brass', category: 'Analógico · Metales Synth',
    engine: 'analogPoly', osc1: 'sawtooth', osc2: 'sawtooth', subGain: 0.12,
    attack: 0.045, decay: 0.5, sustain: 0.72, release: 0.30,
    cutoff: 1200, envMod: 3800, q: 2.2, detune: 14, gain: 0.21
  },
  {
    id: 9, name: 'CS-80 Vangelis', category: 'Analógico · Blade Runner',
    engine: 'analogPoly', osc1: 'sawtooth', osc2: 'triangle', subGain: 0.2,
    attack: 0.06, decay: 0.8, sustain: 0.78, release: 0.5,
    cutoff: 1800, envMod: 3200, q: 1.5, detune: 16, gain: 0.22
  },
  {
    id: 10, name: 'Kalimba Cristal', category: 'Percusión Melódica · África',
    engine: 'malletWood', attack: 0.003, decay: 0.48, sustain: 0.03, release: 0.25,
    cutoff: 5600, q: 1.4, harmonicRatio: 6.2, harmonicAmt: 0.55, gain: 0.3
  },
  {
    id: 11, name: 'Vibráfono Jazz', category: 'Percusión Melódica · Metal',
    engine: 'malletWood', attack: 0.005, decay: 1.25, sustain: 0.12, release: 0.45,
    cutoff: 6200, q: 1.0, harmonicRatio: 3.0, harmonicAmt: 0.38, gain: 0.28
  },
  {
    id: 12, name: 'Mellotron Flauta', category: 'Cinta Vintage · Strawberry',
    engine: 'reedWind', osc1: 'triangle', breathAmt: 0.12, vibratoHz: 5.2, vibratoDepth: 4,
    attack: 0.055, decay: 0.4, sustain: 0.82, release: 0.25,
    cutoff: 2400, q: 1.1, gain: 0.27
  },
  {
    id: 13, name: 'Mellotron Cuerdas', category: 'Cinta Vintage · Orquesta Lo-Fi',
    engine: 'stringEnsemble', attack: 0.08, decay: 0.6, sustain: 0.85, release: 0.42,
    cutoff: 2300, q: 1.2, detune: 18, gain: 0.21
  },
  {
    id: 14, name: 'Cello Solista', category: 'Cuerda Frotada · Expresivo',
    engine: 'stringEnsemble', attack: 0.065, decay: 0.5, sustain: 0.82, release: 0.36,
    cutoff: 1650, q: 1.9, detune: 7, gain: 0.24
  },
  {
    id: 15, name: 'Arpa Celta', category: 'Cuerda Pulsada · Acústica',
    engine: 'pluckString', osc1: 'triangle', osc2: 'sine',
    attack: 0.004, decay: 0.85, sustain: 0.06, release: 0.42,
    cutoff: 1600, envMod: 4200, q: 1.2, detune: 5, gain: 0.28
  },
  {
    id: 16, name: 'Guitarra Nylon', category: 'Cuerda Pulsada · Española',
    engine: 'pluckString', osc1: 'triangle', osc2: 'sawtooth',
    attack: 0.004, decay: 0.55, sustain: 0.08, release: 0.28,
    cutoff: 1100, envMod: 3300, q: 1.7, detune: 3, gain: 0.26
  },
  {
    id: 17, name: 'Guitarra Jazz Clean', category: 'Cuerda Pulsada · Hollowbody',
    engine: 'electricPiano', attack: 0.005, decay: 0.65, sustain: 0.18, release: 0.24,
    cutoff: 2100, q: 1.3, fmRatio: 2.0, fmIndex: 0.65, detune: 2, gain: 0.27
  },
  {
    id: 18, name: 'Bajo Moog Sub', category: 'Bajo Analógico · Gordo',
    engine: 'analogPoly', osc1: 'sawtooth', osc2: 'square', subGain: 0.65,
    attack: 0.005, decay: 0.32, sustain: 0.35, release: 0.16,
    cutoff: 650, envMod: 2100, q: 2.8, detune: 6, gain: 0.26
  },
  {
    id: 19, name: 'Bajo Fretless', category: 'Bajo · Jaco Smooth',
    engine: 'pluckString', osc1: 'sawtooth', osc2: 'triangle',
    attack: 0.014, decay: 0.5, sustain: 0.3, release: 0.20,
    cutoff: 750, envMod: 1800, q: 3.1, detune: 4, gain: 0.26
  },
  {
    id: 20, name: 'DX7 E-Piano 1', category: 'FM Clásico · 80s Hit',
    engine: 'electricPiano', attack: 0.004, decay: 1.3, sustain: 0.22, release: 0.36,
    cutoff: 7500, q: 0.9, fmRatio: 14.0, fmIndex: 1.45, detune: 7, gain: 0.24
  },
  {
    id: 21, name: 'Campana Tubular', category: 'FM Metálico · Catedral',
    engine: 'malletWood', attack: 0.004, decay: 1.5, sustain: 0.08, release: 0.6,
    cutoff: 7800, q: 1.1, harmonicRatio: 2.76, harmonicAmt: 0.75, gain: 0.24
  },
  {
    id: 22, name: 'Celesta Mágica', category: 'Percusión Melódica · Hada',
    engine: 'electricPiano', attack: 0.004, decay: 0.7, sustain: 0.06, release: 0.32,
    cutoff: 6800, q: 1.0, fmRatio: 5.0, fmIndex: 1.2, detune: 5, gain: 0.26
  },
  {
    id: 23, name: 'Acordeón París', category: 'Lengüeta Libre · Musette',
    engine: 'stringEnsemble', attack: 0.03, decay: 0.3, sustain: 0.88, release: 0.18,
    cutoff: 3200, q: 1.7, detune: 22, gain: 0.21
  },
  {
    id: 24, name: 'Armónica Blues', category: 'Lengüeta · Expresiva',
    engine: 'reedWind', osc1: 'sawtooth', breathAmt: 0.06, vibratoHz: 5.8, vibratoDepth: 7,
    attack: 0.035, decay: 0.3, sustain: 0.85, release: 0.20,
    cutoff: 2700, q: 2.4, gain: 0.22
  },
  {
    id: 25, name: 'Clarinete Madera', category: 'Viento Madera · Armónicos Impares',
    engine: 'reedWind', osc1: 'square', breathAmt: 0.08, vibratoHz: 4.5, vibratoDepth: 3,
    attack: 0.04, decay: 0.35, sustain: 0.82, release: 0.20,
    cutoff: 1950, q: 1.5, gain: 0.22
  },
  {
    id: 26, name: 'Oboe Pastoral', category: 'Viento Madera · Doble Caña',
    engine: 'reedWind', osc1: 'sawtooth', breathAmt: 0.05, vibratoHz: 5.0, vibratoDepth: 4,
    attack: 0.035, decay: 0.35, sustain: 0.84, release: 0.20,
    cutoff: 3400, q: 2.8, gain: 0.21
  },
  {
    id: 27, name: 'Trompeta Mute', category: 'Viento Metal · Miles',
    engine: 'analogPoly', osc1: 'sawtooth', osc2: 'sawtooth', subGain: 0.0,
    attack: 0.025, decay: 0.35, sustain: 0.7, release: 0.18,
    cutoff: 900, envMod: 4200, q: 3.6, detune: 5, gain: 0.21
  },
  {
    id: 28, name: 'Trombón Suave', category: 'Viento Metal · Cálido',
    engine: 'analogPoly', osc1: 'sawtooth', osc2: 'triangle', subGain: 0.15,
    attack: 0.04, decay: 0.4, sustain: 0.76, release: 0.22,
    cutoff: 800, envMod: 2400, q: 2.0, detune: 7, gain: 0.23
  },
  {
    id: 29, name: 'Coro Sintético', category: 'Vocal Pad · Formante',
    engine: 'stringEnsemble', attack: 0.09, decay: 0.7, sustain: 0.86, release: 0.45,
    cutoff: 1550, q: 3.2, detune: 15, gain: 0.22
  },
  {
    id: 30, name: 'Solina String Ensemble', category: 'Vintage 70s · Disco Strings',
    engine: 'stringEnsemble', attack: 0.07, decay: 0.5, sustain: 0.88, release: 0.42,
    cutoff: 3600, q: 1.1, detune: 20, gain: 0.20
  },
  {
    id: 31, name: 'Oberheim OB-Xa', category: 'Analógico · Jump Polysynth',
    engine: 'analogPoly', osc1: 'sawtooth', osc2: 'square', subGain: 0.18,
    attack: 0.012, decay: 0.42, sustain: 0.68, release: 0.28,
    cutoff: 1700, envMod: 3900, q: 2.4, detune: 15, gain: 0.21
  },
  {
    id: 32, name: 'ARP Odyssey Lead', category: 'Analógico · Duofónico',
    engine: 'analogPoly', osc1: 'square', osc2: 'sawtooth', subGain: 0.3,
    attack: 0.006, decay: 0.35, sustain: 0.6, release: 0.20,
    cutoff: 1500, envMod: 4500, q: 3.0, detune: 9, gain: 0.20
  },
  {
    id: 33, name: 'Minimoog Quinta', category: 'Analógico · Intervalo +7st',
    engine: 'malletWood', attack: 0.008, decay: 0.55, sustain: 0.5, release: 0.24,
    cutoff: 2800, q: 2.1, harmonicRatio: 1.498, harmonicAmt: 0.65, gain: 0.24
  },
  {
    id: 34, name: 'Supersaw Trance', category: 'Analógico · Himno Masivo',
    engine: 'stringEnsemble', attack: 0.015, decay: 0.5, sustain: 0.78, release: 0.34,
    cutoff: 5200, q: 1.4, detune: 26, gain: 0.20
  },
  {
    id: 35, name: 'Chiptune NES 8-Bit', category: 'Arcade · Pulso Cuadrado',
    engine: 'pluckString', osc1: 'square', osc2: 'square',
    attack: 0.003, decay: 0.25, sustain: 0.25, release: 0.10,
    cutoff: 6500, envMod: 2000, q: 0.9, detune: 2, gain: 0.20
  },
  {
    id: 36, name: 'C64 SID Pulse', category: 'Arcade · Commodore 64',
    engine: 'analogPoly', osc1: 'square', osc2: 'triangle', subGain: 0.35,
    attack: 0.004, decay: 0.3, sustain: 0.35, release: 0.14,
    cutoff: 2200, envMod: 3800, q: 3.4, detune: 5, gain: 0.20
  },
  {
    id: 37, name: 'Koto Japonés', category: 'Étnico · Cuerda Oriental',
    engine: 'pluckString', osc1: 'sawtooth', osc2: 'triangle',
    attack: 0.003, decay: 0.36, sustain: 0.03, release: 0.20,
    cutoff: 2100, envMod: 5800, q: 2.6, detune: 4, gain: 0.25
  },
  {
    id: 38, name: 'Sitar Resonante', category: 'Étnico · Cuerda Simpática',
    engine: 'electricPiano', attack: 0.005, decay: 0.85, sustain: 0.14, release: 0.34,
    cutoff: 4900, q: 2.9, fmRatio: 2.5, fmIndex: 2.4, detune: 9, gain: 0.22
  },
  {
    id: 39, name: 'Steel Drum Caribe', category: 'Percusión Melódica · Trinidad',
    engine: 'malletWood', attack: 0.004, decay: 0.42, sustain: 0.04, release: 0.22,
    cutoff: 5400, q: 2.2, harmonicRatio: 2.0, harmonicAmt: 0.72, gain: 0.27
  },
  {
    id: 40, name: 'Marimba de Vidrio', category: 'FM Cristal · Percusivo',
    engine: 'malletWood', attack: 0.003, decay: 0.45, sustain: 0.03, release: 0.25,
    cutoff: 7200, q: 1.3, harmonicRatio: 5.0, harmonicAmt: 0.52, gain: 0.28
  },
  {
    id: 41, name: 'Caja de Música', category: 'Mecánico · Púas de Metal',
    engine: 'electricPiano', attack: 0.003, decay: 0.85, sustain: 0.02, release: 0.38,
    cutoff: 8500, q: 1.0, fmRatio: 8.0, fmIndex: 1.1, detune: 3, gain: 0.25
  },
  {
    id: 42, name: 'Farfisa Compact', category: 'Órgano Combo · 60s Garage',
    engine: 'drawbarOrgan', drawbars: [0.2, 1.0, 0.9, 0.65, 0.55, 0.4],
    attack: 0.006, decay: 0.1, sustain: 0.9, release: 0.10,
    cutoff: 5800, q: 1.4, clickAmt: 0.25, gain: 0.20
  },
  {
    id: 43, name: 'Órgano de Catedral', category: 'Órgano de Tubos · Litúrgico',
    engine: 'drawbarOrgan', drawbars: [0.85, 1.0, 0.8, 0.5, 0.4, 0.35],
    attack: 0.045, decay: 0.3, sustain: 0.92, release: 0.34,
    cutoff: 4200, q: 0.9, clickAmt: 0.05, gain: 0.21
  },
  {
    id: 44, name: 'Pad Boreal', category: 'Atmosférico · Aurora',
    engine: 'brumaFlagship', attack: 0.075, decay: 1.2, sustain: 0.75, release: 0.55,
    cutoff: 2100, q: 1.5, fmRatio: 3.0, fmIndex: 0.85, detune: 14, gain: 0.23
  },
  {
    id: 45, name: 'Pad Polvo Estelar', category: 'Atmosférico · Quinta Cristalina',
    engine: 'brumaFlagship', attack: 0.06, decay: 1.1, sustain: 0.72, release: 0.50,
    cutoff: 3200, q: 1.2, fmRatio: 1.5, fmIndex: 1.1, detune: 16, gain: 0.23
  },
  {
    id: 46, name: 'Synth Bass 303', category: 'Ácido · Resonante TB',
    engine: 'pluckString', osc1: 'sawtooth', osc2: 'square',
    attack: 0.004, decay: 0.28, sustain: 0.12, release: 0.14,
    cutoff: 420, envMod: 4800, q: 6.5, detune: 2, gain: 0.22
  },
  {
    id: 47, name: 'Slap Bass FM', category: 'Bajo Funk · Percusivo',
    engine: 'electricPiano', attack: 0.004, decay: 0.38, sustain: 0.16, release: 0.16,
    cutoff: 3600, q: 2.1, fmRatio: 3.0, fmIndex: 2.2, detune: 3, gain: 0.25
  },
  {
    id: 48, name: 'Theremin Órbita', category: 'Ondas Martenot · Sci-Fi',
    engine: 'reedWind', osc1: 'sine', breathAmt: 0.02, vibratoHz: 6.0, vibratoDepth: 8,
    attack: 0.05, decay: 0.4, sustain: 0.9, release: 0.30,
    cutoff: 3800, q: 1.2, gain: 0.28
  },
  {
    id: 49, name: 'Cristal Cósmico', category: 'FM Boutique · Armónicos Puros',
    engine: 'brumaFlagship', attack: 0.015, decay: 1.1, sustain: 0.55, release: 0.48,
    cutoff: 5200, q: 1.1, fmRatio: 4.0, fmIndex: 1.5, detune: 10, gain: 0.23
  }
];

export function getPresetById(presetId) {
  const idx = Math.max(0, Math.min(SYNTH_PRESETS.length - 1, Number(presetId) || 0));
  return SYNTH_PRESETS[idx];
}

export function getActivePreset() {
  const st = getState();
  const slot = Math.max(0, Math.min(st.selectedSounds.length - 1, st.activeSoundSlot || 0));
  const presetId = st.selectedSounds[slot] ?? 0;
  return getPresetById(presetId);
}

/**
 * Sintetiza una única nota MIDI con el preset indicado y devuelve un controlador { stop(when) }.
 * Utiliza dos etapas de ganancia en serie (envGain × releaseGain) para que al soltar la tecla
 * NUNCA se interrumpa ni cancele la curva de ataque/decay y SIEMPRE caiga con un decay suave y natural,
 * sin clics, sin saltos de volumen y sin cortar en seco.
 */
export function spawnSingleNoteVoice(midiNote, preset, startTime, velocity = 1.0, destination = null, fixedDuration = null) {
  const ctx = ensureAudioUnlocked();
  const dest = destination || getSynthDestination();
  const now = ctx.currentTime;
  const t = Math.max(now, startTime || now);
  const freq = safeParam(midiToFreq(midiNote), 20, 18000);
  const peakGain = safeParam((preset.gain || 0.24) * velocity, 0.001, 0.95);

  // Etapa 1: Envolvente ADS (nunca se cancela al soltar la tecla)
  const envGain = ctx.createGain();
  envGain.gain.value = 0.0001;
  envGain.gain.setValueAtTime(0.0001, now);

  // Etapa 2:Multiplicador de Release suave (1.0 mientras está pulsada -> decay suave a 0 al soltar)
  const releaseGain = ctx.createGain();
  releaseGain.gain.value = 1.0;
  releaseGain.gain.setValueAtTime(1.0, now);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.setValueAtTime(safeParam(preset.q || 1.2, 0.5, 12), t);

  const baseCutoff = safeParam(preset.cutoff || 2800, 120, 16000);
  const envMod = preset.envMod || 0;
  if (envMod > 0) {
    filter.frequency.setValueAtTime(safeParam(baseCutoff + envMod, 150, 16000), t);
    filter.frequency.exponentialRampToValueAtTime(baseCutoff, t + Math.max(0.04, preset.decay || 0.35));
  } else {
    filter.frequency.setValueAtTime(baseCutoff, t);
  }

  // Envolvente ADSR con cola de release suave garantizada (mínimo 320 ms para no cortar nunca en seco)
  const attack = Math.max(0.004, preset.attack || 0.012);
  const decay = Math.max(0.04, preset.decay || 0.4);
  const sustainLevel = safeParam(peakGain * Math.max(0.14, preset.sustain ?? 0.5), 0.0005, 0.95);
  const relDur = Math.max(0.32, (preset.release || 0.30) * 1.25);
  const relTimeConstant = relDur / 3.4;

  // Programar ataque -> decay -> sustain en envGain
  envGain.gain.setValueAtTime(0.0001, t);
  envGain.gain.linearRampToValueAtTime(peakGain, t + attack);
  envGain.gain.exponentialRampToValueAtTime(sustainLevel, t + attack + decay);

  filter.connect(envGain);
  envGain.connect(releaseGain);
  releaseGain.connect(dest);

  const nodesToStop = [];
  let scheduledAutoStopTime = null;

  if (typeof fixedDuration === 'number' && fixedDuration > 0) {
    // Nota de duración conocida (Looper, Acompañamiento, Preescucha):
    // En t + dur, releaseGain cae suavemente de 1.0 a 0 con constante de tiempo musical
    const dur = Math.max(0.04, fixedDuration);
    const releaseStart = t + dur;
    releaseGain.gain.setValueAtTime(1.0, releaseStart);
    releaseGain.gain.setTargetAtTime(0.00001, releaseStart, relTimeConstant);
    scheduledAutoStopTime = releaseStart + relDur + 0.15;
  }

  if (preset.engine === 'brumaFlagship') {
    const padOsc1 = ctx.createOscillator();
    const padOsc2 = ctx.createOscillator();
    padOsc1.type = 'sawtooth';
    padOsc2.type = 'triangle';
    padOsc1.frequency.setValueAtTime(freq, t);
    padOsc2.frequency.setValueAtTime(freq, t);
    padOsc1.detune.setValueAtTime(-(preset.detune || 8), t);
    padOsc2.detune.setValueAtTime(+(preset.detune || 8), t);

    const padMix = ctx.createGain();
    padMix.gain.setValueAtTime(0.65, t);
    padOsc1.connect(padMix);
    padOsc2.connect(padMix);
    padMix.connect(filter);

    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const bellGain = ctx.createGain();

    carrier.type = 'sine';
    mod.type = 'sine';
    carrier.frequency.setValueAtTime(freq * 2, t);
    mod.frequency.setValueAtTime(safeParam(freq * 2 * (preset.fmRatio || 2.0)), t);

    const modDepth = freq * (preset.fmIndex || 1.3);
    modGain.gain.setValueAtTime(safeParam(modDepth, 1, 8000), t);
    modGain.gain.exponentialRampToValueAtTime(0.1, t + 0.65);

    bellGain.gain.setValueAtTime(0.45, t);
    bellGain.gain.exponentialRampToValueAtTime(0.04, t + 0.75);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(bellGain);
    bellGain.connect(filter);

    padOsc1.start(t);
    padOsc2.start(t);
    carrier.start(t);
    mod.start(t);
    nodesToStop.push(padOsc1, padOsc2, carrier, mod);

  } else if (preset.engine === 'electricPiano') {
    const carrier = ctx.createOscillator();
    const body = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();

    carrier.type = 'sine';
    body.type = 'triangle';
    mod.type = 'sine';

    carrier.frequency.setValueAtTime(freq, t);
    body.frequency.setValueAtTime(freq, t);
    body.detune.setValueAtTime(preset.detune || 4, t);
    mod.frequency.setValueAtTime(safeParam(freq * (preset.fmRatio || 7.0)), t);

    const indexHz = safeParam(freq * (preset.fmIndex || 1.15), 1, 9000);
    modGain.gain.setValueAtTime(indexHz, t);
    modGain.gain.exponentialRampToValueAtTime(safeParam(indexHz * 0.08, 0.5, 4000), t + 0.28);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.45, t);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(filter);
    body.connect(bodyGain);
    bodyGain.connect(filter);

    carrier.start(t);
    body.start(t);
    mod.start(t);
    nodesToStop.push(carrier, body, mod);

  } else if (preset.engine === 'malletWood') {
    const fund = ctx.createOscillator();
    const harm = ctx.createOscillator();
    const harmGain = ctx.createGain();

    fund.type = 'sine';
    harm.type = 'triangle';
    fund.frequency.setValueAtTime(freq, t);
    harm.frequency.setValueAtTime(safeParam(freq * (preset.harmonicRatio || 4.0)), t);

    harmGain.gain.setValueAtTime(safeParam(preset.harmonicAmt || 0.45, 0.01, 1.0), t);
    harmGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    fund.connect(filter);
    harm.connect(harmGain);
    harmGain.connect(filter);

    fund.start(t);
    harm.start(t);
    nodesToStop.push(fund, harm);

  } else if (preset.engine === 'drawbarOrgan') {
    const ratios = [0.5, 1, 2, 3, 4, 6];
    const bars = preset.drawbars || [0.5, 1.0, 0.7, 0.35, 0.2, 0.1];
    ratios.forEach((r, idx) => {
      const amt = bars[idx] || 0;
      if (amt <= 0.01) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(safeParam(freq * r), t);
      g.gain.setValueAtTime(amt * 0.32, t);
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      nodesToStop.push(osc);
    });

  } else if (preset.engine === 'stringEnsemble') {
    const detunes = [-(preset.detune || 16), 0, +(preset.detune || 16)];
    detunes.forEach((dt) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime(dt, t);
      g.gain.setValueAtTime(0.38, t);
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      nodesToStop.push(osc);
    });

  } else if (preset.engine === 'reedWind') {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = preset.osc1 || 'triangle';
    osc.frequency.setValueAtTime(freq, t);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(preset.vibratoHz || 5.0, t);
    lfoGain.gain.setValueAtTime(preset.vibratoDepth || 4.0, t);

    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    osc.connect(filter);

    osc.start(t);
    lfo.start(t);
    nodesToStop.push(osc, lfo);

  } else {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = preset.osc1 || 'sawtooth';
    osc2.type = preset.osc2 || 'triangle';
    osc1.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq, t);
    osc1.detune.setValueAtTime(-(preset.detune || 7), t);
    osc2.detune.setValueAtTime(+(preset.detune || 7), t);

    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    g1.gain.setValueAtTime(0.55, t);
    g2.gain.setValueAtTime(0.55, t);

    osc1.connect(g1);
    osc2.connect(g2);
    g1.connect(filter);
    g2.connect(filter);

    osc1.start(t);
    osc2.start(t);
    nodesToStop.push(osc1, osc2);

    if (preset.subGain && preset.subGain > 0.01) {
      const sub = ctx.createOscillator();
      const sg = ctx.createGain();
      sub.type = 'square';
      sub.frequency.setValueAtTime(safeParam(freq * 0.5), t);
      sg.gain.setValueAtTime(preset.subGain * 0.45, t);
      sub.connect(sg);
      sg.connect(filter);
      sub.start(t);
      nodesToStop.push(sub);
    }
  }

  if (scheduledAutoStopTime !== null) {
    nodesToStop.forEach(n => {
      try { n.stop(scheduledAutoStopTime); } catch (_) {}
    });
  }

  let stopped = false;

  return {
    endsAt: scheduledAutoStopTime,
    stop(stopTime = null, forceImmediate = false) {
      if (stopped) return;
      if (!forceImmediate && scheduledAutoStopTime !== null) return;
      stopped = true;
      const curNow = ctx.currentTime;

      if (forceImmediate) {
        // Detener de inmediato (ej. al cambiar de preescucha en Configuración o al parar el Looper):
        // Si la nota aún no había empezado (t > curNow), cancelarla en silencio total antes de que suene.
        try {
          if (t > curNow) {
            envGain.gain.cancelScheduledValues(curNow);
            envGain.gain.setValueAtTime(0.00001, curNow);
            releaseGain.gain.cancelScheduledValues(curNow);
            releaseGain.gain.setValueAtTime(0.00001, curNow);
            nodesToStop.forEach(n => {
              try { n.stop(curNow + 0.005); } catch (_) {}
            });
            return;
          }
          // Si ya estaba sonando, hacer un fade-out ultrarrápido sin clic (~20 ms)
          releaseGain.gain.cancelScheduledValues(curNow);
          releaseGain.gain.setValueAtTime(safeParam(releaseGain.gain.value, 0.0001, 1.0), curNow);
          releaseGain.gain.setTargetAtTime(0.00001, curNow, 0.008);
        } catch (_) {}
        nodesToStop.forEach(n => {
          try { n.stop(curNow + 0.045); } catch (_) {}
        });
        return;
      }

      // Soltar tecla en vivo: decay suave y natural sin cortar en seco
      const relStart = stopTime !== null ? Math.max(curNow, stopTime) : Math.max(curNow, t + 0.018);

      try {
        releaseGain.gain.setValueAtTime(1.0, relStart);
        releaseGain.gain.setTargetAtTime(0.00001, relStart, relTimeConstant);
      } catch (_) {}

      const killAt = relStart + relDur + 0.16;
      nodesToStop.forEach(n => {
        try { n.stop(killAt); } catch (_) {}
      });
    }
  };
}

let noteEventObserver = null;

export function setNoteEventObserver(fn) {
  noteEventObserver = typeof fn === 'function' ? fn : null;
}

/**
 * Dispara un conjunto de notas MIDI aplicando el Humanizador (0 a 3 LEDs cian)
 * Devuelve un handle { stop(when) } para liberar todas las voces al soltar la tecla.
 */
export function startHumanizedVoiceGroup(midiNotes, options = {}) {
  const ctx = ensureAudioUnlocked();
  const st = getState();
  const preset = options.preset || getActivePreset();
  const humanize = options.humanize ?? st.humanize ?? 0;
  const baseTime = options.when !== undefined && options.when !== null
    ? Math.max(ctx.currentTime, options.when)
    : ctx.currentTime;
  const baseVel = options.velocity ?? 1.0;
  const destination = options.destination || null;

  let notes = [...midiNotes];
  if (notes.length > 1 && humanize >= 2 && options.strumDirection === 'down') {
    notes.reverse();
  } else if (notes.length > 1 && humanize === 2 && Math.random() < 0.25 && !options.strumDirection) {
    const copy = [...notes];
    const tmp = copy[1];
    copy[1] = copy[copy.length - 1];
    copy[copy.length - 1] = tmp;
    notes = copy;
  }

  // Si hay override explícito de spreadSec (ej. desde patrones rítmicos de acompañamiento), usarlo
  const spreadSec = options.customSpreadSec !== undefined
    ? options.customSpreadSec
    : ([0, 0.018, 0.036, 0.062][humanize] || 0);
  const jitterSec = options.customSpreadSec !== undefined
    ? 0.002
    : ([0, 0.003, 0.007, 0.012][humanize] || 0);

  const polyScale = notes.length > 1 ? (1 / Math.pow(notes.length, 0.38)) : 1.0;
  const fixedDur = (typeof options.duration === 'number' && options.duration > 0) ? options.duration : null;

  const voices = notes.map((midi, idx) => {
    const jitter = idx === 0 ? 0 : (Math.random() * 2 - 1) * jitterSec;
    const noteStart = Math.max(ctx.currentTime, baseTime + idx * spreadSec + jitter);
    const velJitter = humanize === 0 ? 1.0 : (0.92 + Math.random() * 0.16);
    const noteVel = Math.max(0.25, Math.min(1.2, baseVel * polyScale * velJitter));
    return spawnSingleNoteVoice(midi, preset, noteStart, noteVel, destination, fixedDur);
  });

  let cancelNoteEvent;
  if (notes.length && noteEventObserver) {
    try {
      cancelNoteEvent = noteEventObserver({ notes: [...notes], when: baseTime, duration: fixedDur || 0.45, velocity: baseVel });
    } catch (_) {
      // Mantener la reproducción aunque falle un consumidor de eventos.
    }
  }

  return {
    endsAt: fixedDur === null ? null : Math.max(...voices.map(voice => voice.endsAt)),
    stop(when = null, forceImmediate = false) {
      voices.forEach(v => v.stop(when, forceImmediate));
      if (forceImmediate && ctx.currentTime < baseTime && typeof cancelNoteEvent === 'function') {
        try { cancelNoteEvent(); } catch (_) {}
        cancelNoteEvent = null;
      }
    }
  };
}

/**
 * Reproduce un toque de referencia inmediato de la tónica actual (al cambiar Octava o Sonido — SPEC.md §4)
 */
let refVoiceHandle = null;
export function playTonicReferencePreview() {
  const st = getState();
  const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);
  const tonicDeg = degrees[0];
  const notes = st.playMode === 'melody' ? [tonicDeg.rootMidi] : tonicDeg.triadMidi;

  if (refVoiceHandle) {
    refVoiceHandle.stop(null, true);
    refVoiceHandle = null;
  }

  refVoiceHandle = startHumanizedVoiceGroup(notes, {
    duration: 0.34,
    velocity: 0.9
  });
}

/**
 * Preescucha del modal Configuración (50→9):
 * Suena UNA SOLA VEZ (la frase melódica seguida de los acordes) y se calla automáticamente.
 */
let activePreviewTimer = null;
let activePreviewVoices = [];
let activePreviewPresetId = null;
let activePreviewCallback = null;

export function stopPresetPreview() {
  if (activePreviewTimer) {
    clearTimeout(activePreviewTimer);
    activePreviewTimer = null;
  }
  activePreviewVoices.forEach(v => {
    try { v.stop(null, true); } catch (_) {}
  });
  activePreviewVoices = [];
  const prevId = activePreviewPresetId;
  activePreviewPresetId = null;
  if (activePreviewCallback) {
    const cb = activePreviewCallback;
    activePreviewCallback = null;
    cb(prevId, false);
  }
}

export function playPresetPreviewOnce(presetId, onStatusChange) {
  stopPresetPreview();
  const ctx = ensureAudioUnlocked();
  const preset = getPresetById(presetId);
  const st = getState();
  const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);

  activePreviewPresetId = presetId;
  activePreviewCallback = onStatusChange;
  if (onStatusChange) onStatusChange(presetId, true);

  // Frase: 4 notas melódicas (I - III - V - VI) + 4 acordes diatónicos (I - IV - V - I) — 1 sola vuelta
  const stepSec = 0.25;
  const sequence = [
    // Parte 1: Frase melódica (1 nota)
    { notes: [degrees[0].rootMidi + 12], offset: 0.0, dur: 0.21, humanize: 0 },
    { notes: [degrees[2].rootMidi + 12], offset: stepSec * 1, dur: 0.21, humanize: 0 },
    { notes: [degrees[4].rootMidi + 12], offset: stepSec * 2, dur: 0.21, humanize: 0 },
    { notes: [degrees[5].rootMidi + 12], offset: stepSec * 3, dur: 0.32, humanize: 0 },
    // Parte 2: Acordes completos (3 notas)
    { notes: degrees[0].triadMidi, offset: stepSec * 4.5, dur: 0.40, humanize: 1 },
    { notes: degrees[3].triadMidi, offset: stepSec * 6.3, dur: 0.40, humanize: 1 },
    { notes: degrees[4].triadMidi, offset: stepSec * 8.1, dur: 0.40, humanize: 1 },
    { notes: degrees[0].triadMidi, offset: stepSec * 9.9, dur: 0.58, humanize: 1 }
  ];

  const totalDuration = stepSec * 12.6;
  const startAt = ctx.currentTime + 0.025;

  for (const item of sequence) {
    const v = startHumanizedVoiceGroup(item.notes, {
      preset,
      when: startAt + item.offset,
      duration: item.dur,
      humanize: item.humanize,
      velocity: 0.92
    });
    activePreviewVoices.push(v);
  }

  activePreviewTimer = setTimeout(() => {
    stopPresetPreview();
  }, Math.ceil(totalDuration * 1000) + 100);

  return true;
}
