/**
 * accompaniment.js — Catálogo de 50 Patrones de Acompañamiento Automático (Banco 50 → 9)
 * con Enganche Instantáneo (Late-Press Catch-Up — REGLAS_NO_ROMPER.md #3),
 * preescucha de 1 solo compás (Play-once) y soporte ⚡ Key-Strike / Pure Gate.
 */

import { ensureAudioUnlocked } from './audio-core.js';
import { getState } from './state.js';
import { getDiatonicDegrees } from './theory.js';
import { startHumanizedVoiceGroup, getActivePreset } from './synth-presets.js';

export const ACCOMPANIMENT_PATTERNS = [
  // === LOS 9 PATRONES BASE POR DEFECTO (HUECOS 1..9) ===
  { id: 0,  name: 'Arpegio Negras (1-3-5-3)',      category: 'Base · Arpegio 1/4 Clásico' },
  { id: 1,  name: 'Arpegio Corcheas (1-3-5-3)',    category: 'Base · Arpegio 1/8 Fluido' },
  { id: 2,  name: 'Walking Bass Swing',            category: 'Base · Bajo Caminante Consonante' },
  { id: 3,  name: 'Balada Piano (Bajo + Acorde)',  category: 'Base · Piano Acompañamiento' },
  { id: 4,  name: 'Pulso Pop Sincopado (3+3+2)',   category: 'Base · Tresillo Pop Moderno' },
  { id: 5,  name: 'Bossa Nova Comping',            category: 'Base · Brasil Clave Suave' },
  { id: 6,  name: 'Neo-Soul Groove 7ª',            category: 'Base · Acordes Cálidos con 7ª' },
  { id: 7,  name: 'Rasgueo Guitarra (D-DU-UDU)',   category: 'Base · Guitarra Acústica' },
  { id: 8,  name: 'Arreglo Completo Órbita',       category: 'Base · Bajo + Acordes + Octava' },

  // === 10..50: CATÁLOGO AMPLIADO DE ACOMPAÑAMIENTOS (41 PATRONES) ===
  { id: 9,  name: 'Arpegio Ascendente (1-3-5-8)',  category: 'Arpegio · Subida a la Octava' },
  { id: 10, name: 'Arpegio Descendente (8-5-3-1)', category: 'Arpegio · Cascada Inversa' },
  { id: 11, name: 'Arpegio Semicorcheas Synth',    category: 'Arpegio · 1/16 Electrónico' },
  { id: 12, name: 'Bajo Alberti Mozart (1-5-3-5)', category: 'Clásico · Mano Izquierda Piano' },
  { id: 13, name: 'Arpegio Abierto Décimas',       category: 'Arpegio · Cinematográfico' },
  { id: 14, name: 'Arpegio Cristal con 7ª',        category: 'Arpegio · Dreamy Maj7/m7' },
  { id: 15, name: 'Arpegio Pedal Tónica',          category: 'Arpegio · Tónica Constante' },
  { id: 16, name: 'Arpegio Quintas Synthwave',     category: 'Arpegio · Poder Analógico' },
  { id: 17, name: 'Bajo Octavado Disco 70s',       category: 'Bajo · Octavas Saltarinas' },
  { id: 18, name: 'Bajo Synthwave 8 Corcheas',     category: 'Bajo · Motor 80s Constante' },
  { id: 19, name: 'Bajo Funk Slap Sincopado',      category: 'Bajo · Groove 16th' },
  { id: 20, name: 'Bajo Reggae Dub Profundo',      category: 'Bajo · Jamaica Subgrave' },
  { id: 21, name: 'Bajo Motown Soul',              category: 'Bajo · Detroit Melódico' },
  { id: 22, name: 'Bajo Tango Marcato',            category: 'Bajo · 4 Tiempos Porteños' },
  { id: 23, name: 'Bajo Cumbia Sabrosa',           category: 'Bajo · Tríada Tropical' },
  { id: 24, name: 'Piano Pop Elton',               category: 'Piano · Bajo y Acorde Rítmico' },
  { id: 25, name: 'Piano Gospel Iglesia',          category: 'Piano · Soul Comping' },
  { id: 26, name: 'Piano House 90s',               category: 'Piano · Acordes Club' },
  { id: 27, name: 'Piano Salsa Montuno',           category: 'Piano · Tumbao Caribeño' },
  { id: 28, name: 'Piano Bolero Nocturno',         category: 'Piano · Balada Romántica' },
  { id: 29, name: 'Piano Cha-Cha-Chá',             category: 'Piano · Salón Habana' },
  { id: 30, name: 'Piano Jazz Swing Comp',         category: 'Piano · Blue Note' },
  { id: 31, name: 'Guitarra Folk Fingerpicking',   category: 'Guitarra · Travis Picking' },
  { id: 32, name: 'Guitarra Reggae Skank',         category: 'Guitarra · Golpe en 2 y 4' },
  { id: 33, name: 'Guitarra Ska Upbeat',           category: 'Guitarra · Contratiempo Rápido' },
  { id: 34, name: 'Guitarra Funk Chic',            category: 'Guitarra · Rasgueo Rítmico' },
  { id: 35, name: 'Guitarra Rumba Palmas',         category: 'Guitarra · Ventilador Mediterráneo' },
  { id: 36, name: 'Guitarra Country Boom-Chick',   category: 'Guitarra · Bajo Alterno + Acorde' },
  { id: 37, name: 'Acordes Lo-Fi Chillhop',        category: 'Urbano · Acordes Suaves con 7ª' },
  { id: 38, name: 'Acordes Reggaeton Dembow',      category: 'Urbano · Sincopa Latina' },
  { id: 39, name: 'Acordes Afrobeat Lagos',        category: 'Urbano · Polirritmia Cálida' },
  { id: 40, name: 'Acordes UK Garage 2-Step',      category: 'Electrónica · Shuffle Londinense' },
  { id: 41, name: 'Acordes R&B Slow Jam',          category: 'Urbano · Sedoso Nocturno' },
  { id: 42, name: 'Acordes Staccato Italo',        category: 'Electrónica · Pulsos Cortos' },
  { id: 43, name: 'Pad Pulsante Sidechain',        category: 'Electrónica · Bombeo en 4/4' },
  { id: 44, name: 'Trance Gate Semicorcheas',      category: 'Electrónica · Puerta Rítmica' },
  { id: 45, name: 'Marcha Indie Motorik',          category: 'Rock · Pulso Continuo' },
  { id: 46, name: 'Samba Bossa Ligera',            category: 'Latino · Acordes Rápidos' },
  { id: 47, name: 'Polirritmia 3 contra 4',        category: 'Experimental · Ciclo Cruzado' },
  { id: 48, name: 'Vals Binario Cinemático',       category: 'Orquestal · Tresillo Amplio' },
  { id: 49, name: 'Gran Orquesta Órbita',          category: 'Orquestal · Bajo + Acorde + Arpegio' }
];

export function getAccompanimentPatternById(patternId) {
  const idx = Math.max(0, Math.min(ACCOMPANIMENT_PATTERNS.length - 1, Number(patternId) || 0));
  return ACCOMPANIMENT_PATTERNS[idx];
}

/**
 * Devuelve el patrón activo según el selector 0..9 del panel y los 9 huecos configurados
 */
export function getActiveAccompanimentPattern() {
  const st = getState();
  if (!st.accompaniment || st.accompaniment <= 0) return null;
  const slotIdx = Math.max(0, Math.min(st.selectedAccompaniments.length - 1, st.accompaniment - 1));
  const patternId = st.selectedAccompaniments[slotIdx] ?? slotIdx;
  return getAccompanimentPatternById(patternId);
}

/**
 * Construye la rejilla de 16 pasos (compás 4/4) para cualquiera de los 50 patrones (`patternId` 0..49)
 */
export function buildPatternGrid(patternId, deg) {
  const [n1, n3, n5] = deg.triadMidi;
  const n7 = deg.seventhMidi;
  const bass1 = n1 - 12;
  const bass3 = n3 - 12;
  const bass5 = n5 - 12;
  const high1 = n1 + 12;
  const high3 = n3 + 12;

  const grid = new Array(16).fill(null);
  const pid = Number(patternId) || 0;

  switch (pid) {
    case 0: // 1: Arpegio Negras (1-3-5-3)
      grid[0]  = { notes: [n1], durSteps: 3.5, vel: 0.96, spreadSec: 0 };
      grid[4]  = { notes: [n3], durSteps: 3.5, vel: 0.86, spreadSec: 0 };
      grid[8]  = { notes: [n5], durSteps: 3.5, vel: 0.92, spreadSec: 0 };
      grid[12] = { notes: [n3], durSteps: 3.5, vel: 0.84, spreadSec: 0 };
      break;

    case 1: // 2: Arpegio Corcheas (1-3-5-3)
      for (let base of [0, 8]) {
        grid[base + 0] = { notes: [n1], durSteps: 1.75, vel: 0.95, spreadSec: 0 };
        grid[base + 2] = { notes: [n3], durSteps: 1.75, vel: 0.84, spreadSec: 0 };
        grid[base + 4] = { notes: [n5], durSteps: 1.75, vel: 0.90, spreadSec: 0 };
        grid[base + 6] = { notes: [n3], durSteps: 1.75, vel: 0.82, spreadSec: 0 };
      }
      break;

    case 2: // 3: Walking Bass Swing
      grid[0]  = { notes: [bass1], durSteps: 3.4, vel: 0.98, spreadSec: 0 };
      grid[4]  = { notes: [bass3], durSteps: 3.4, vel: 0.90, spreadSec: 0 };
      grid[8]  = { notes: [bass5], durSteps: 2.6, vel: 0.94, spreadSec: 0 };
      grid[11] = { notes: [n1],    durSteps: 0.85, vel: 0.78, spreadSec: 0 };
      grid[12] = { notes: [bass3], durSteps: 1.8, vel: 0.88, spreadSec: 0 };
      grid[14] = { notes: [bass5], durSteps: 1.8, vel: 0.84, spreadSec: 0 };
      break;

    case 3: // 4: Balada Piano (Bajo + Acorde)
      grid[0]  = { notes: [bass1, n1],  durSteps: 3.6, vel: 0.94, spreadSec: 0.008 };
      grid[4]  = { notes: [n1, n3, n5], durSteps: 3.5, vel: 0.85, spreadSec: 0.010 };
      grid[8]  = { notes: [bass1, n5],  durSteps: 3.6, vel: 0.90, spreadSec: 0.008 };
      grid[12] = { notes: [n1, n3, n5], durSteps: 2.5, vel: 0.86, spreadSec: 0.010 };
      grid[15] = { notes: [n3, n5],     durSteps: 0.9, vel: 0.72, spreadSec: 0.006 };
      break;

    case 4: // 5: Pulso Pop Sincopado (3+3+2)
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.5, vel: 0.96, spreadSec: 0 };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 2.5, vel: 0.86, spreadSec: 0 };
      grid[6]  = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.88, spreadSec: 0 };
      grid[8]  = { notes: [bass1, n1, n3, n5], durSteps: 2.5, vel: 0.94, spreadSec: 0 };
      grid[11] = { notes: [n1, n3, n5],        durSteps: 2.5, vel: 0.86, spreadSec: 0 };
      grid[14] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.84, spreadSec: 0 };
      break;

    case 5: // 6: Bossa Nova Comping
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.5, vel: 0.92, spreadSec: 0.008 };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 2.3, vel: 0.82, spreadSec: 0.006 };
      grid[6]  = { notes: [bass5, n1, n3, n5], durSteps: 1.7, vel: 0.85, spreadSec: 0.008 };
      grid[8]  = { notes: [bass1],             durSteps: 1.7, vel: 0.88, spreadSec: 0 };
      grid[10] = { notes: [n1, n3, n5],        durSteps: 2.3, vel: 0.82, spreadSec: 0.006 };
      grid[13] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.80, spreadSec: 0.006 };
      grid[15] = { notes: [bass5],             durSteps: 0.85, vel: 0.78, spreadSec: 0 };
      break;

    case 6: // 7: Neo-Soul Groove 7ª
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 3.4, vel: 0.94, spreadSec: 0.012 };
      grid[4]  = { notes: [n3, n5, n7],        durSteps: 2.2, vel: 0.80, spreadSec: 0.008 };
      grid[7]  = { notes: [bass1, n1, n3, n7], durSteps: 2.6, vel: 0.88, spreadSec: 0.012 };
      grid[10] = { notes: [bass5],             durSteps: 1.7, vel: 0.82, spreadSec: 0 };
      grid[12] = { notes: [n1, n3, n5, n7],    durSteps: 3.2, vel: 0.88, spreadSec: 0.012 };
      break;

    case 7: // 8: Rasgueo Guitarra (D-DU-UDU)
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 3.4, vel: 0.95, spreadSec: 0.013, strumDirection: 'up' };
      grid[4]  = { notes: [n1, n3, n5, high1], durSteps: 1.7, vel: 0.88, spreadSec: 0.012, strumDirection: 'up' };
      grid[6]  = { notes: [n1, n3, n5, high1], durSteps: 2.4, vel: 0.78, spreadSec: 0.011, strumDirection: 'down' };
      grid[10] = { notes: [n1, n3, n5, high1], durSteps: 1.7, vel: 0.80, spreadSec: 0.011, strumDirection: 'down' };
      grid[12] = { notes: [bass1, n1, n3, n5], durSteps: 1.7, vel: 0.90, spreadSec: 0.012, strumDirection: 'up' };
      grid[14] = { notes: [n1, n3, n5, high1], durSteps: 1.7, vel: 0.78, spreadSec: 0.011, strumDirection: 'down' };
      break;

    case 8: // 9: Arreglo Completo Órbita
      for (let s = 0; s < 16; s += 2) {
        const isBeat = (s % 4) === 0;
        grid[s] = {
          notes: isBeat ? [bass1, n1, n3, n5] : [n1, n3, n5],
          durSteps: 1.75,
          vel: isBeat ? 0.94 : 0.80,
          spreadSec: 0
        };
      }
      break;

    case 9: // 10: Arpegio Ascendente (1-3-5-8)
      [n1, n3, n5, high1, n1, n3, n5, high1].forEach((note, i) => {
        grid[i * 2] = { notes: [note], durSteps: 1.75, vel: i % 4 === 0 ? 0.95 : 0.84, spreadSec: 0 };
      });
      break;

    case 10: // 11: Arpegio Descendente (8-5-3-1)
      [high1, n5, n3, n1, high1, n5, n3, n1].forEach((note, i) => {
        grid[i * 2] = { notes: [note], durSteps: 1.75, vel: i % 4 === 0 ? 0.95 : 0.84, spreadSec: 0 };
      });
      break;

    case 11: // 12: Arpegio Semicorcheas Synth
      for (let s = 0; s < 16; s++) {
        const seq = [n1, n3, n5, high1];
        grid[s] = { notes: [seq[s % 4]], durSteps: 0.9, vel: s % 4 === 0 ? 0.95 : 0.78, spreadSec: 0 };
      }
      break;

    case 12: // 13: Bajo Alberti Mozart (1-5-3-5)
      for (let base of [0, 8]) {
        grid[base + 0] = { notes: [n1], durSteps: 1.75, vel: 0.94, spreadSec: 0 };
        grid[base + 2] = { notes: [n5], durSteps: 1.75, vel: 0.82, spreadSec: 0 };
        grid[base + 4] = { notes: [n3], durSteps: 1.75, vel: 0.88, spreadSec: 0 };
        grid[base + 6] = { notes: [n5], durSteps: 1.75, vel: 0.82, spreadSec: 0 };
      }
      break;

    case 13: // 14: Arpegio Abierto Décimas (1 - 5 - 10ª - 5)
      for (let base of [0, 8]) {
        grid[base + 0] = { notes: [bass1], durSteps: 1.8, vel: 0.96, spreadSec: 0 };
        grid[base + 2] = { notes: [n5 - 12], durSteps: 1.8, vel: 0.84, spreadSec: 0 };
        grid[base + 4] = { notes: [n3], durSteps: 1.8, vel: 0.92, spreadSec: 0 };
        grid[base + 6] = { notes: [n5 - 12], durSteps: 1.8, vel: 0.82, spreadSec: 0 };
      }
      break;

    case 14: // 15: Arpegio Cristal con 7ª
      [n1, n3, n5, n7, high1, n7, n5, n3].forEach((note, i) => {
        grid[i * 2] = { notes: [note], durSteps: 1.8, vel: i === 0 ? 0.95 : 0.84, spreadSec: 0 };
      });
      break;

    case 15: // 16: Arpegio Pedal Tónica
      [n1, n3, n1, n5, n1, high1, n1, n5].forEach((note, i) => {
        grid[i * 2] = { notes: [note], durSteps: 1.75, vel: i % 2 === 0 ? 0.82 : 0.94, spreadSec: 0 };
      });
      break;

    case 16: // 17: Arpegio Quintas Synthwave
      [bass1, bass5, n1, n5, bass1, bass5, n1, n5].forEach((note, i) => {
        grid[i * 2] = { notes: [note], durSteps: 1.75, vel: 0.90, spreadSec: 0 };
      });
      break;

    case 17: // 18: Bajo Octavado Disco 70s
      for (let s = 0; s < 16; s += 2) {
        const isDown = (s % 4) === 0;
        grid[s] = { notes: [isDown ? bass1 : n1], durSteps: 1.7, vel: isDown ? 0.96 : 0.86, spreadSec: 0 };
      }
      break;

    case 18: // 19: Bajo Synthwave 8 Corcheas
      for (let s = 0; s < 16; s += 2) {
        grid[s] = { notes: [bass1], durSteps: 1.65, vel: (s % 4 === 0) ? 0.96 : 0.82, spreadSec: 0 };
      }
      break;

    case 19: // 20: Bajo Funk Slap Sincopado
      grid[0]  = { notes: [bass1], durSteps: 1.8, vel: 0.98, spreadSec: 0 };
      grid[3]  = { notes: [n1],    durSteps: 0.9, vel: 0.88, spreadSec: 0 };
      grid[6]  = { notes: [bass5], durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[8]  = { notes: [bass1], durSteps: 2.5, vel: 0.95, spreadSec: 0 };
      grid[11] = { notes: [bass3], durSteps: 1.7, vel: 0.86, spreadSec: 0 };
      grid[14] = { notes: [n1],    durSteps: 1.7, vel: 0.90, spreadSec: 0 };
      break;

    case 20: // 21: Bajo Reggae Dub Profundo
      grid[0]  = { notes: [bass1], durSteps: 2.8, vel: 0.98, spreadSec: 0 };
      grid[6]  = { notes: [bass5], durSteps: 1.8, vel: 0.88, spreadSec: 0 };
      grid[8]  = { notes: [bass1], durSteps: 3.4, vel: 0.94, spreadSec: 0 };
      grid[14] = { notes: [bass3], durSteps: 1.7, vel: 0.84, spreadSec: 0 };
      break;

    case 21: // 22: Bajo Motown Soul
      grid[0]  = { notes: [bass1], durSteps: 2.8, vel: 0.96, spreadSec: 0 };
      grid[3]  = { notes: [bass3], durSteps: 0.9, vel: 0.82, spreadSec: 0 };
      grid[4]  = { notes: [bass5], durSteps: 3.5, vel: 0.90, spreadSec: 0 };
      grid[8]  = { notes: [n1],    durSteps: 2.8, vel: 0.92, spreadSec: 0 };
      grid[12] = { notes: [bass5], durSteps: 3.5, vel: 0.88, spreadSec: 0 };
      break;

    case 22: // 23: Bajo Tango Marcato
      grid[0]  = { notes: [bass1, n1], durSteps: 2.4, vel: 0.98, spreadSec: 0 };
      grid[4]  = { notes: [bass3, n3], durSteps: 2.4, vel: 0.88, spreadSec: 0 };
      grid[8]  = { notes: [bass5, n5], durSteps: 2.4, vel: 0.94, spreadSec: 0 };
      grid[12] = { notes: [bass1, n1], durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[15] = { notes: [bass5],     durSteps: 0.8, vel: 0.84, spreadSec: 0 };
      break;

    case 23: // 24: Bajo Cumbia Sabrosa
      grid[0]  = { notes: [bass1], durSteps: 3.4, vel: 0.98, spreadSec: 0 };
      grid[4]  = { notes: [bass3], durSteps: 1.8, vel: 0.88, spreadSec: 0 };
      grid[6]  = { notes: [bass5], durSteps: 1.8, vel: 0.92, spreadSec: 0 };
      grid[8]  = { notes: [bass1], durSteps: 3.4, vel: 0.96, spreadSec: 0 };
      grid[12] = { notes: [bass3], durSteps: 1.8, vel: 0.88, spreadSec: 0 };
      grid[14] = { notes: [bass5], durSteps: 1.8, vel: 0.92, spreadSec: 0 };
      break;

    case 24: // 25: Piano Pop Elton
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.95, spreadSec: 0 };
      grid[2]  = { notes: [bass1],             durSteps: 1.7, vel: 0.78, spreadSec: 0 };
      grid[4]  = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[6]  = { notes: [bass5],             durSteps: 1.7, vel: 0.80, spreadSec: 0 };
      grid[8]  = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.94, spreadSec: 0 };
      grid[10] = { notes: [bass1],             durSteps: 1.7, vel: 0.78, spreadSec: 0 };
      grid[12] = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[14] = { notes: [n3, n5],            durSteps: 1.7, vel: 0.82, spreadSec: 0 };
      break;

    case 25: // 26: Piano Gospel Iglesia
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.6, vel: 0.96, spreadSec: 0.008 };
      grid[3]  = { notes: [n3, n5, high1],     durSteps: 1.8, vel: 0.88, spreadSec: 0.006 };
      grid[6]  = { notes: [bass3, n1, n3, n5], durSteps: 1.8, vel: 0.90, spreadSec: 0.008 };
      grid[8]  = { notes: [bass5, n1, n3, n5], durSteps: 3.4, vel: 0.94, spreadSec: 0.008 };
      grid[12] = { notes: [n1, n3, n5, high1], durSteps: 3.4, vel: 0.92, spreadSec: 0.008 };
      break;

    case 26: // 27: Piano House 90s
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.96, spreadSec: 0 };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[6]  = { notes: [n1, n3, n5, high1], durSteps: 1.8, vel: 0.94, spreadSec: 0 };
      grid[10] = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.88, spreadSec: 0 };
      grid[12] = { notes: [bass5, n1, n3, n5], durSteps: 1.8, vel: 0.92, spreadSec: 0 };
      grid[14] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.86, spreadSec: 0 };
      break;

    case 27: // 28: Piano Salsa Montuno
      grid[0]  = { notes: [bass1, n1],  durSteps: 1.8, vel: 0.94, spreadSec: 0 };
      grid[2]  = { notes: [n3, n5],     durSteps: 1.8, vel: 0.86, spreadSec: 0 };
      grid[4]  = { notes: [high1],      durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[7]  = { notes: [bass5, n1],  durSteps: 1.8, vel: 0.92, spreadSec: 0 };
      grid[9]  = { notes: [n3, n5],     durSteps: 1.8, vel: 0.86, spreadSec: 0 };
      grid[11] = { notes: [high1],      durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[13] = { notes: [n3, n5],     durSteps: 1.8, vel: 0.86, spreadSec: 0 };
      grid[15] = { notes: [n1],         durSteps: 0.9, vel: 0.88, spreadSec: 0 };
      break;

    case 28: // 29: Piano Bolero Nocturno
      grid[0]  = { notes: [bass1],          durSteps: 3.6, vel: 0.95, spreadSec: 0 };
      grid[4]  = { notes: [n1, n3, n5],     durSteps: 1.8, vel: 0.84, spreadSec: 0.010 };
      grid[6]  = { notes: [n1, n3, n5],     durSteps: 1.8, vel: 0.80, spreadSec: 0.010 };
      grid[8]  = { notes: [bass5],          durSteps: 3.6, vel: 0.90, spreadSec: 0 };
      grid[12] = { notes: [n1, n3, n5, n7], durSteps: 3.4, vel: 0.86, spreadSec: 0.012 };
      break;

    case 29: // 30: Piano Cha-Cha-Chá
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 3.2, vel: 0.94, spreadSec: 0 };
      grid[4]  = { notes: [bass3, n1, n3, n5], durSteps: 3.2, vel: 0.88, spreadSec: 0 };
      grid[8]  = { notes: [bass5],             durSteps: 3.2, vel: 0.90, spreadSec: 0 };
      grid[12] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.90, spreadSec: 0 };
      grid[14] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.92, spreadSec: 0 };
      break;

    case 30: // 31: Piano Jazz Swing Comp
      grid[0]  = { notes: [bass1, n1, n3, n7], durSteps: 2.5, vel: 0.92, spreadSec: 0.008 };
      grid[4]  = { notes: [bass3],             durSteps: 3.2, vel: 0.86, spreadSec: 0 };
      grid[7]  = { notes: [n3, n5, n7],        durSteps: 2.2, vel: 0.85, spreadSec: 0.006 };
      grid[12] = { notes: [bass5, n1, n3, n7], durSteps: 2.5, vel: 0.90, spreadSec: 0.008 };
      grid[15] = { notes: [n3, n5],            durSteps: 0.9, vel: 0.78, spreadSec: 0 };
      break;

    case 31: // 32: Guitarra Folk Fingerpicking
      grid[0]  = { notes: [bass1], durSteps: 1.8, vel: 0.96, spreadSec: 0 };
      grid[2]  = { notes: [n3],    durSteps: 1.8, vel: 0.82, spreadSec: 0 };
      grid[4]  = { notes: [bass5], durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[6]  = { notes: [n5],    durSteps: 1.8, vel: 0.84, spreadSec: 0 };
      grid[8]  = { notes: [bass1], durSteps: 1.8, vel: 0.94, spreadSec: 0 };
      grid[10] = { notes: [high1], durSteps: 1.8, vel: 0.86, spreadSec: 0 };
      grid[12] = { notes: [bass5], durSteps: 1.8, vel: 0.88, spreadSec: 0 };
      grid[14] = { notes: [n3],    durSteps: 1.8, vel: 0.82, spreadSec: 0 };
      break;

    case 32: // 33: Guitarra Reggae Skank (Golpe en 2 y 4)
      grid[0]  = { notes: [bass1],      durSteps: 3.4, vel: 0.94, spreadSec: 0 };
      grid[4]  = { notes: [n1, n3, n5], durSteps: 1.2, vel: 0.96, spreadSec: 0.008, strumDirection: 'down' };
      grid[8]  = { notes: [bass5],      durSteps: 3.4, vel: 0.90, spreadSec: 0 };
      grid[12] = { notes: [n1, n3, n5], durSteps: 1.2, vel: 0.96, spreadSec: 0.008, strumDirection: 'down' };
      break;

    case 33: // 34: Guitarra Ska Upbeat (Contratiempos)
      for (let b = 0; b < 4; b++) {
        grid[b * 4]     = { notes: [b % 2 === 0 ? bass1 : bass5], durSteps: 1.6, vel: 0.90, spreadSec: 0 };
        grid[b * 4 + 2] = { notes: [n1, n3, n5], durSteps: 1.2, vel: 0.94, spreadSec: 0.007, strumDirection: 'down' };
      }
      break;

    case 34: // 35: Guitarra Funk Chic
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 1.5, vel: 0.96, spreadSec: 0.008, strumDirection: 'up' };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 1.1, vel: 0.84, spreadSec: 0.007, strumDirection: 'down' };
      grid[6]  = { notes: [n1, n3, n5],        durSteps: 1.4, vel: 0.88, spreadSec: 0.008, strumDirection: 'up' };
      grid[9]  = { notes: [n1, n3, n5],        durSteps: 1.1, vel: 0.82, spreadSec: 0.007, strumDirection: 'down' };
      grid[12] = { notes: [bass5, n1, n3, n5], durSteps: 1.6, vel: 0.92, spreadSec: 0.008, strumDirection: 'up' };
      grid[15] = { notes: [n1, n3, n5],        durSteps: 0.85, vel: 0.80, spreadSec: 0.007, strumDirection: 'down' };
      break;

    case 35: // 36: Guitarra Rumba Palmas
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.4, vel: 0.96, spreadSec: 0.012, strumDirection: 'up' };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.84, spreadSec: 0.010, strumDirection: 'down' };
      grid[6]  = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.92, spreadSec: 0.010, strumDirection: 'up' };
      grid[8]  = { notes: [bass5],             durSteps: 1.7, vel: 0.88, spreadSec: 0 };
      grid[10] = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.84, spreadSec: 0.010, strumDirection: 'down' };
      grid[12] = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.92, spreadSec: 0.011, strumDirection: 'up' };
      grid[14] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.82, spreadSec: 0.010, strumDirection: 'down' };
      break;

    case 36: // 37: Guitarra Country Boom-Chick
      grid[0]  = { notes: [bass1],      durSteps: 3.4, vel: 0.96, spreadSec: 0 };
      grid[4]  = { notes: [n1, n3, n5], durSteps: 2.2, vel: 0.88, spreadSec: 0.010, strumDirection: 'up' };
      grid[8]  = { notes: [bass5],      durSteps: 3.4, vel: 0.94, spreadSec: 0 };
      grid[12] = { notes: [n1, n3, n5], durSteps: 2.2, vel: 0.88, spreadSec: 0.010, strumDirection: 'up' };
      break;

    case 37: // 38: Acordes Lo-Fi Chillhop
      grid[0]  = { notes: [bass1, n1, n3, n5, n7], durSteps: 5.5, vel: 0.90, spreadSec: 0.015 };
      grid[7]  = { notes: [n1, n3, n7],            durSteps: 2.8, vel: 0.78, spreadSec: 0.012 };
      grid[12] = { notes: [bass5, n1, n3, n5],     durSteps: 3.5, vel: 0.84, spreadSec: 0.014 };
      break;

    case 38: // 39: Acordes Reggaeton Dembow
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.4, vel: 0.96, spreadSec: 0 };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 2.2, vel: 0.88, spreadSec: 0 };
      grid[6]  = { notes: [bass5],             durSteps: 1.7, vel: 0.90, spreadSec: 0 };
      grid[8]  = { notes: [bass1, n1, n3, n5], durSteps: 2.4, vel: 0.94, spreadSec: 0 };
      grid[11] = { notes: [n1, n3, n5],        durSteps: 2.2, vel: 0.88, spreadSec: 0 };
      grid[14] = { notes: [bass5],             durSteps: 1.7, vel: 0.88, spreadSec: 0 };
      break;

    case 39: // 40: Acordes Afrobeat Lagos
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.2, vel: 0.94, spreadSec: 0 };
      grid[3]  = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.84, spreadSec: 0 };
      grid[6]  = { notes: [bass5, n3, n5],     durSteps: 2.2, vel: 0.88, spreadSec: 0 };
      grid[10] = { notes: [n1, n3, n5],        durSteps: 1.8, vel: 0.86, spreadSec: 0 };
      grid[12] = { notes: [bass1],             durSteps: 1.8, vel: 0.92, spreadSec: 0 };
      grid[14] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.84, spreadSec: 0 };
      break;

    case 40: // 41: Acordes UK Garage 2-Step
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 2.2, vel: 0.95, spreadSec: 0 };
      grid[4]  = { notes: [n1, n3, n7],        durSteps: 1.6, vel: 0.86, spreadSec: 0 };
      grid[7]  = { notes: [n1, n3, n5],        durSteps: 1.6, vel: 0.88, spreadSec: 0 };
      grid[10] = { notes: [bass5, n1, n3, n5], durSteps: 2.2, vel: 0.90, spreadSec: 0 };
      grid[14] = { notes: [n3, n5, n7],        durSteps: 1.6, vel: 0.84, spreadSec: 0 };
      break;

    case 41: // 42: Acordes R&B Slow Jam
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 3.6, vel: 0.94, spreadSec: 0.012 };
      grid[4]  = { notes: [n3, n5, high1],     durSteps: 3.4, vel: 0.82, spreadSec: 0.010 };
      grid[8]  = { notes: [bass1, n1, n3, n7], durSteps: 3.6, vel: 0.90, spreadSec: 0.012 };
      grid[12] = { notes: [bass5, n1, n3, n5], durSteps: 3.4, vel: 0.86, spreadSec: 0.010 };
      break;

    case 42: // 43: Acordes Staccato Italo
      for (let s = 0; s < 16; s += 2) {
        grid[s] = { notes: [n1, n3, n5], durSteps: 1.1, vel: (s % 4 === 0) ? 0.94 : 0.82, spreadSec: 0 };
      }
      break;

    case 43: // 44: Pad Pulsante Sidechain
      for (let b = 0; b < 4; b++) {
        grid[b * 4]     = { notes: [bass1], durSteps: 1.6, vel: 0.96, spreadSec: 0 };
        grid[b * 4 + 2] = { notes: [n1, n3, n5, high1], durSteps: 2.2, vel: 0.92, spreadSec: 0 };
      }
      break;

    case 44: // 45: Trance Gate Semicorcheas
      [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 14].forEach((s) => {
        grid[s] = { notes: [n1, n3, n5], durSteps: 0.85, vel: (s % 4 === 0) ? 0.95 : 0.82, spreadSec: 0 };
      });
      break;

    case 45: // 46: Marcha Indie Motorik
      for (let s = 0; s < 16; s += 2) {
        grid[s] = { notes: [bass1, n1, n5], durSteps: 1.7, vel: (s % 4 === 0) ? 0.95 : 0.84, spreadSec: 0 };
      }
      break;

    case 46: // 47: Samba Bossa Ligera
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.94, spreadSec: 0 };
      grid[2]  = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.84, spreadSec: 0 };
      grid[4]  = { notes: [bass5],             durSteps: 1.8, vel: 0.90, spreadSec: 0 };
      grid[6]  = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.86, spreadSec: 0 };
      grid[8]  = { notes: [bass1],             durSteps: 1.8, vel: 0.92, spreadSec: 0 };
      grid[11] = { notes: [n1, n3, n5],        durSteps: 1.7, vel: 0.86, spreadSec: 0 };
      grid[13] = { notes: [bass5, n1, n3, n5], durSteps: 1.7, vel: 0.88, spreadSec: 0 };
      grid[15] = { notes: [n1, n3, n5],        durSteps: 0.85, vel: 0.80, spreadSec: 0 };
      break;

    case 47: // 48: Polirritmia 3 contra 4
      [0, 3, 6, 9, 12, 15].forEach((s, i) => {
        const chordNotes = [
          [bass1, n1, n5],
          [n3, n5],
          [n1, n3, high1],
          [bass5, n3],
          [n1, n3, n5],
          [n5, high1]
        ][i];
        grid[s] = { notes: chordNotes, durSteps: 2.3, vel: i === 0 ? 0.96 : 0.86, spreadSec: 0 };
      });
      break;

    case 48: // 49: Vals Binario Cinemático
      grid[0]  = { notes: [bass1, n1],     durSteps: 3.6, vel: 0.96, spreadSec: 0 };
      grid[3]  = { notes: [n1, n3, n5],    durSteps: 2.4, vel: 0.84, spreadSec: 0.008 };
      grid[6]  = { notes: [n3, n5, high1], durSteps: 2.0, vel: 0.86, spreadSec: 0.008 };
      grid[8]  = { notes: [bass5, n1],     durSteps: 3.6, vel: 0.92, spreadSec: 0 };
      grid[11] = { notes: [n1, n3, n5],    durSteps: 2.4, vel: 0.84, spreadSec: 0.008 };
      grid[14] = { notes: [n3, n5, high3], durSteps: 1.8, vel: 0.86, spreadSec: 0.008 };
      break;

    case 49: // 50: Gran Orquesta Órbita
    default:
      grid[0]  = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.98, spreadSec: 0.008 };
      grid[2]  = { notes: [n3, n5],            durSteps: 1.8, vel: 0.82, spreadSec: 0 };
      grid[4]  = { notes: [bass5, n5, high1],  durSteps: 1.8, vel: 0.92, spreadSec: 0.006 };
      grid[6]  = { notes: [n3, n5],            durSteps: 1.8, vel: 0.82, spreadSec: 0 };
      grid[8]  = { notes: [bass1, n1, n3, n5], durSteps: 1.8, vel: 0.95, spreadSec: 0.008 };
      grid[10] = { notes: [n5, high1],         durSteps: 1.8, vel: 0.84, spreadSec: 0 };
      grid[12] = { notes: [bass5, n1, n3, high1], durSteps: 1.8, vel: 0.92, spreadSec: 0.008 };
      grid[14] = { notes: [n3, n5, high3],     durSteps: 1.8, vel: 0.86, spreadSec: 0 };
      break;
  }

  return grid;
}

/**
 * Encuentra el evento del patrón que corresponde estar sonando en cualquier paso (0..15)
 */
export function resolveActiveStepEvent(grid, currentStep, stepProgress01 = 0) {
  const step = ((currentStep % 16) + 16) % 16;
  if (grid[step]) {
    return {
      originStep: step,
      event: grid[step],
      remainingSteps: Math.max(0.45, grid[step].durSteps - stepProgress01)
    };
  }
  for (let offset = 1; offset < 16; offset++) {
    const prev = (step - offset + 16) % 16;
    if (grid[prev]) {
      const elapsedSteps = offset + stepProgress01;
      const rem = Math.max(0.55, grid[prev].durSteps - elapsedSteps);
      return {
        originStep: prev,
        event: grid[prev],
        remainingSteps: rem
      };
    }
  }
  return null;
}

const heldDegrees = new Map();
let progressionDegree = null;
let progressionEntry = null;
const progressionVoices = new Set();
let standaloneTimer = null;
let standaloneStep = 0;
let standaloneLastStepTime = 0;

let looperRecordHook = null;
let looperReleaseHook = null;
let debugDeltaHook = null;

export function setAccompanimentHooks({ onRecordEvent, onReleaseDegree, onDebugCatchUp }) {
  looperRecordHook = onRecordEvent || null;
  looperReleaseHook = onReleaseDegree || null;
  debugDeltaHook = onDebugCatchUp || null;
}

export function isAnyAccompanimentKeyHeld() {
  return heldDegrees.size > 0;
}

export function getHeldDegreesList() {
  return Array.from(heldDegrees.keys());
}

function getStepDurationSec() {
  const bpm = getState().bpm || 92;
  return (60 / bpm) / 4; // 1 semicorchea
}

function getActivePatternId() {
  const pat = getActiveAccompanimentPattern();
  return pat ? pat.id : 0;
}

function fireAccompanimentEvent(degreeIndex, eventObj, when, durationSec, isProgression = false) {
  const st = getState();
  const preset = getActivePreset();

  const panelSpread = [0, 0.006, 0.011, 0.016][st.humanize || 0] || 0;
  const effectiveSpread = Math.max(eventObj.spreadSec || 0, panelSpread);
  const effectiveHumanize = effectiveSpread > 0 ? Math.max(1, st.humanize || 1) : 0;

  const handle = startHumanizedVoiceGroup(eventObj.notes, {
    preset,
    when,
    duration: durationSec,
    velocity: eventObj.vel || 0.9,
    humanize: effectiveHumanize,
    customSpreadSec: effectiveSpread,
    strumDirection: eventObj.strumDirection
  });

  if (looperRecordHook) {
    looperRecordHook({
      degreeIndex,
      isProgression,
      notes: eventObj.notes,
      presetId: preset.id,
      humanize: effectiveHumanize,
      velocity: eventObj.vel || 0.9,
      when,
      duration: durationSec
    });
  }
  return handle;
}

function scheduleMasterDegree(degree, entry, patId, stepIndex, stepAudioTime, stepDur, isProgression = false) {
  if (entry.lastFiredStep === stepIndex && (stepAudioTime - entry.lastFiredTime) < stepDur * 0.85) {
    return null;
  }
  const ev = buildPatternGrid(patId, degree)[stepIndex];
  if (!ev) return null;

  entry.lastFiredStep = stepIndex;
  entry.lastFiredTime = stepAudioTime;
  return fireAccompanimentEvent(degree.degreeIndex, ev, stepAudioTime, Math.max(0.06, ev.durSteps * stepDur), isProgression);
}

/**
 * El reloj maestro cambia este grado antes de programar el paso 0.
 * En una parada, stepTime es null y se cancelan también las voces ya programadas.
 */
export function setProgressionAccompanimentDegree(degreeIndex, stepTime = null) {
  if (progressionDegree !== null) {
    looperReleaseHook?.(progressionDegree, stepTime, true);
  }
  const now = stepTime !== null && progressionVoices.size > 0 ? ensureAudioUnlocked().currentTime : null;
  for (const voice of progressionVoices) {
    if (stepTime === null) voice.stop(null, true);
    if (stepTime === null || voice.endsAt <= now) progressionVoices.delete(voice);
  }
  progressionDegree = degreeIndex;
  progressionEntry = degreeIndex === null ? null : { lastFiredStep: -1, lastFiredTime: 0 };
}

/**
 * Llamado por el reloj maestro (clock-looper.js) en cada semicorchea (step 0..15)
 */
export function onMasterClockStep(stepIndex, stepAudioTime) {
  stopStandaloneClock();

  const st = getState();
  if (!st.accompaniment || st.accompaniment <= 0) return;
  const hasProgression = st.progressionPlaying && progressionDegree !== null;
  if (heldDegrees.size === 0 && !hasProgression) return;

  const stepDur = getStepDurationSec();
  const patId = getActivePatternId();
  const step = stepIndex % 16;

  if (heldDegrees.size > 0) {
    const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);
    for (const [degreeIndex, entry] of heldDegrees) {
      if (degrees[degreeIndex]) scheduleMasterDegree(degrees[degreeIndex], entry, patId, step, stepAudioTime, stepDur);
    }
  }
  if (hasProgression) {
    const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, 0, st.customScale, st.notation);
    const voice = scheduleMasterDegree(degrees[progressionDegree], progressionEntry, patId, step, stepAudioTime, stepDur, true);
    if (voice) progressionVoices.add(voice);
  }
}

function startStandaloneClockFromZero() {
  stopStandaloneClock();
  const ctx = ensureAudioUnlocked();
  const stepDur = getStepDurationSec();
  standaloneStep = 0;
  standaloneLastStepTime = ctx.currentTime;

  onStandaloneStep(0, ctx.currentTime);

  standaloneTimer = setInterval(() => {
    if (heldDegrees.size === 0 || getState().accompaniment === 0) {
      stopStandaloneClock();
      return;
    }
    standaloneStep = (standaloneStep + 1) % 16;
    standaloneLastStepTime = ctx.currentTime;
    onStandaloneStep(standaloneStep, ctx.currentTime);
  }, stepDur * 1000);
}

function stopStandaloneClock() {
  if (standaloneTimer) {
    clearInterval(standaloneTimer);
    standaloneTimer = null;
  }
}

function onStandaloneStep(stepIndex, stepAudioTime) {
  const st = getState();
  const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);
  const stepDur = getStepDurationSec();
  const patId = getActivePatternId();

  for (const [degreeIndex, entry] of heldDegrees.entries()) {
    if (entry.lastFiredStep === (stepIndex % 16) && (stepAudioTime - entry.lastFiredTime) < stepDur * 0.85) {
      continue;
    }
    const deg = degrees[degreeIndex];
    if (!deg) continue;
    const grid = buildPatternGrid(patId, deg);
    const ev = grid[stepIndex % 16];
    if (ev) {
      entry.lastFiredStep = stepIndex % 16;
      entry.lastFiredTime = stepAudioTime;
      fireAccompanimentEvent(degreeIndex, ev, stepAudioTime, Math.max(0.06, ev.durSteps * stepDur));
    }
  }
}

/**
 * ENGANCHE INSTANTÁNEO (Late-Press Catch-Up — REGLAS_NO_ROMPER.md #3)
 */
export function engageAccompanimentKey(degreeIndex, transportInfo = { running: false, currentStep: 0, stepElapsedSec: 0 }) {
  const ctx = ensureAudioUnlocked();
  const st = getState();
  const now = ctx.currentTime;
  const stepDur = getStepDurationSec();
  const patId = getActivePatternId();

  if (heldDegrees.has(degreeIndex)) {
    releaseAccompanimentKey(degreeIndex);
  }

  const entry = {
    lastFiredStep: -1,
    lastFiredTime: 0
  };
  heldDegrees.set(degreeIndex, entry);

  const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);
  const deg = degrees[degreeIndex] || degrees[0];
  const grid = buildPatternGrid(patId, deg);

  const isTransportRunning = transportInfo.running || standaloneTimer !== null;

  if (!isTransportRunning) {
    startStandaloneClockFromZero();
    if (st.keyStrike && st.playMode === 'chord') {
      const step0 = grid[0];
      if (step0 && step0.notes.length === 1) {
        const extraNotes = deg.triadMidi.filter(n => !step0.notes.includes(n));
        if (extraNotes.length > 0) {
          fireAccompanimentEvent(degreeIndex, {
            notes: extraNotes,
            durSteps: 2.0,
            vel: 0.76,
            spreadSec: 0.008
          }, now, stepDur * 2.0);
        }
      }
    }
    if (debugDeltaHook) debugDeltaHook(0);
    return;
  }

  const curStep = transportInfo.running ? transportInfo.currentStep : standaloneStep;
  const elapsedSec = transportInfo.running
    ? Math.max(0, transportInfo.stepElapsedSec || 0)
    : Math.max(0, now - standaloneLastStepTime);
  const stepProgress01 = Math.min(0.95, elapsedSec / stepDur);

  if (debugDeltaHook) {
    debugDeltaHook(Math.round(elapsedSec * 1000));
  }

  const resolved = resolveActiveStepEvent(grid, curStep, stepProgress01);

  if (resolved && resolved.event) {
    entry.lastFiredStep = curStep % 16;
    entry.lastFiredTime = now;
    const remSec = Math.max(0.08, resolved.remainingSteps * stepDur);
    fireAccompanimentEvent(degreeIndex, resolved.event, now, remSec);
  }

  if (st.keyStrike && st.playMode === 'chord') {
    const firedNotes = (resolved && resolved.event) ? resolved.event.notes : [];
    if (firedNotes.length < 3) {
      const extraNotes = deg.triadMidi.filter(n => !firedNotes.includes(n));
      if (extraNotes.length > 0) {
        fireAccompanimentEvent(degreeIndex, {
          notes: extraNotes,
          durSteps: 1.8,
          vel: 0.75,
          spreadSec: 0.008
        }, now, stepDur * 1.8);
      }
    }
  }
}

export function releaseAccompanimentKey(degreeIndex) {
  const entry = heldDegrees.get(degreeIndex);
  if (!entry) return;

  // Al soltar la tecla, no cortamos en seco; las voces programadas caen con su releaseGain suave
  heldDegrees.delete(degreeIndex);

  if (looperReleaseHook) {
    looperReleaseHook(degreeIndex);
  }

  if (heldDegrees.size === 0) {
    stopStandaloneClock();
  }
}

export function stopAllAccompaniment() {
  heldDegrees.clear();
  stopStandaloneClock();
}

/**
 * Preescucha de 1 solo compás (Play-once) para la pestaña ACOMPAÑAMIENTOS (50) del Configurador
 */
let previewAccompTimer = null;
let previewAccompVoices = [];
let previewAccompCallback = null;
let previewAccompId = null;

export function stopAccompanimentPreview() {
  if (previewAccompTimer) {
    clearTimeout(previewAccompTimer);
    previewAccompTimer = null;
  }
  previewAccompVoices.forEach(v => {
    try { v.stop(null, true); } catch (_) {}
  });
  previewAccompVoices = [];
  const prevId = previewAccompId;
  previewAccompId = null;
  if (previewAccompCallback) {
    const cb = previewAccompCallback;
    previewAccompCallback = null;
    cb(prevId, false);
  }
}

export function playAccompanimentPreviewOnce(patternId, onStatusChange) {
  stopAccompanimentPreview();
  const ctx = ensureAudioUnlocked();
  const st = getState();
  const preset = getActivePreset();
  const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);
  const tonicDeg = degrees[0];
  const grid = buildPatternGrid(patternId, tonicDeg);
  const stepDur = getStepDurationSec();

  previewAccompId = patternId;
  previewAccompCallback = onStatusChange;
  if (onStatusChange) onStatusChange(patternId, true);

  const startAt = ctx.currentTime + 0.025;
  for (let s = 0; s < 16; s++) {
    const ev = grid[s];
    if (!ev) continue;
    const when = startAt + s * stepDur;
    const durSec = Math.max(0.06, ev.durSteps * stepDur);
    const v = startHumanizedVoiceGroup(ev.notes, {
      preset,
      when,
      duration: durSec,
      velocity: ev.vel || 0.9,
      humanize: ev.spreadSec > 0 ? 1 : 0,
      customSpreadSec: ev.spreadSec || 0,
      strumDirection: ev.strumDirection
    });
    previewAccompVoices.push(v);
  }

  const totalBarMs = Math.ceil(16 * stepDur * 1000) + 180;
  previewAccompTimer = setTimeout(() => {
    stopAccompanimentPreview();
  }, totalBarMs);

  return true;
}
