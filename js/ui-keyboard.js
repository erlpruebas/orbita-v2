/**
 * ui-keyboard.js — Superficie de 7 Teclas en Zig-Zag (3 arriba: II-IV-VI / 4 abajo: I-III-V-VII)
 * - Soporte Multitouch simultáneo (PointerEvents)
 * - Expresión en Eje Y en tiempo real al deslizar el dedo (sin barrido extraño al soltar la tecla)
 * - Atajos de teclado físico PC inamovibles: Z, S, X, D, C, F, V
 */

import { ensureAudioUnlocked, applyYAxisExpression, resetYAxisExpression } from './audio-core.js';
import { getState, subscribe } from './state.js';
import { getDiatonicDegrees, getDegreeTriggerNotes } from './theory.js';
import { startHumanizedVoiceGroup, getActivePreset } from './synth-presets.js';
import { engageAccompanimentKey, releaseAccompanimentKey } from './accompaniment.js';
import { getTransportSnapshot, recordNoteStart, recordNoteEnd, toggleProgressionPlayback } from './clock-looper.js';
import { POPULAR_PROGRESSIONS, selectProgression, setProgressionVisualCallback } from './progressions.js';
import { t } from './i18n.js';

const KEY_CODE_TO_DEGREE = {
  KeyZ: 0, // I
  KeyS: 1, // II
  KeyX: 2, // III
  KeyD: 3, // IV
  KeyC: 4, // V
  KeyF: 5, // VI
  KeyV: 6  // VII
};

const activeManualVoices = new Map();  // sourceKey -> { degreeIndex, handle }
const pointerState = new Map();        // pointerId -> { degreeIndex, startY, hasSlid }
const degreeActiveSources = new Map(); // degreeIndex -> Set<sourceKey>
let progressionDegree = null;

function addSourceToDegree(degreeIndex, sourceKey) {
  if (!degreeActiveSources.has(degreeIndex)) {
    degreeActiveSources.set(degreeIndex, new Set());
  }
  degreeActiveSources.get(degreeIndex).add(sourceKey);
  updateKeyVisualState(degreeIndex);
}

function removeSourceFromDegree(degreeIndex, sourceKey) {
  const set = degreeActiveSources.get(degreeIndex);
  if (set) {
    set.delete(sourceKey);
    if (set.size === 0) {
      degreeActiveSources.delete(degreeIndex);
    }
  }
  updateKeyVisualState(degreeIndex);
}

function isDegreePressed(degreeIndex) {
  const set = degreeActiveSources.get(degreeIndex);
  return Boolean(set && set.size > 0);
}

function updateKeyVisualState(degreeIndex, yNorm = null) {
  const keyEl = document.querySelector(`.key-pad[data-degree="${degreeIndex}"]`);
  if (!keyEl) return;
  const pressed = isDegreePressed(degreeIndex);
  keyEl.classList.toggle('is-active', pressed);
  keyEl.classList.toggle('is-prog-active', progressionDegree === degreeIndex);

  const fillEl = keyEl.querySelector('.key-expr-fill');
  if (fillEl && yNorm !== null) {
    const pct = Math.round(Math.max(6, Math.min(100, yNorm * 100)));
    fillEl.style.height = `${pct}%`;
  }
}

function computeYNorm(keyEl, clientY) {
  const rect = keyEl.getBoundingClientRect();
  if (!rect.height) return 0.75;
  const rel = 1 - ((clientY - rect.top) / rect.height);
  return Math.max(0.05, Math.min(1.0, rel));
}

function triggerDegreeDown(degreeIndex, sourceKey, initialYNorm = 0.78) {
  // Desbloqueo síncrono del AudioContext en el primer gesto (REGLAS_NO_ROMPER.md #4)
  ensureAudioUnlocked();
  const st = getState();

  // Si es la primera tecla que se pulsa desde el reposo, asegurar estado neutro limpio al atacar
  // (nunca al soltar, para evitar barridos de filtro extraños durante la cola de release)
  if (degreeActiveSources.size === 0) {
    resetYAxisExpression();
  }

  const wasAlreadyPressed = isDegreePressed(degreeIndex);
  addSourceToDegree(degreeIndex, sourceKey);
  updateKeyVisualState(degreeIndex, initialYNorm);

  const isProgressionMelody = st.progressionPlaying && st.playMode === 'melody';
  if (st.accompaniment > 0 && !isProgressionMelody) {
    // Modo con Acompañamiento Automático (1..9): Enganche Instantáneo (Late-Press Catch-Up)
    if (!wasAlreadyPressed) {
      const snap = getTransportSnapshot();
      engageAccompanimentKey(degreeIndex, snap);
    }
    return;
  }

  // Melodía sobre una progresión y teclado manual comparten la ruta de voz directa.
  const notes = getDegreeTriggerNotes(degreeIndex, st);
  const preset = getActivePreset();
  const vel = 0.92;

  const handle = startHumanizedVoiceGroup(notes, {
    preset,
    humanize: st.humanize,
    velocity: vel
  });

  activeManualVoices.set(sourceKey, { degreeIndex, handle });

  // Registrar en el looper si está grabando o en ventana de downbeat snap
  recordNoteStart(sourceKey, {
    notes,
    presetId: preset.id,
    humanize: st.humanize,
    velocity: vel
  });
}

function triggerDegreeUp(degreeIndex, sourceKey) {
  removeSourceFromDegree(degreeIndex, sourceKey);

  // Cerrar voz manual suavemente con su envolvente de release (sin barridos ni clics)
  const manual = activeManualVoices.get(sourceKey);
  if (manual) {
    manual.handle.stop();
    activeManualVoices.delete(sourceKey);
  }

  // Cerrar nota en el looper si estaba grabándose
  recordNoteEnd(sourceKey);

  // Si ya no queda ninguna fuente pulsando este grado, liberar acompañamiento
  if (!isDegreePressed(degreeIndex)) {
    releaseAccompanimentKey(degreeIndex);
  }
}

export function renderKeyboardLabels() {
  const st = getState();
  const degrees = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation);

  degrees.forEach((deg) => {
    const keyEl = document.querySelector(`.key-pad[data-degree="${deg.degreeIndex}"]`);
    if (!keyEl) return;

    const noteEl = keyEl.querySelector('.key-note');
    const chordEl = keyEl.querySelector('.key-chord');
    const romanEl = keyEl.querySelector('.key-roman');

    if (romanEl) romanEl.textContent = deg.roman;
    if (noteEl) noteEl.textContent = deg.noteUpper;
    if (chordEl) {
      chordEl.textContent = st.playMode === 'melody' ? deg.melodyLabel : deg.chordLabel;
    }
  });
}

function renderProgressionWidget() {
  const { progressionIndex, progressionPlaying, lang } = getState();
  const progression = POPULAR_PROGRESSIONS[progressionIndex];
  const name = progression ? t(`progressions.${progression.id}.name`, lang) : '';
  const number = document.getElementById('prog-num');
  number.textContent = String(progressionIndex + 1);
  number.title = name || t('progressions.none', lang);
  number.classList.toggle('is-off', !progression);
  const badge = document.getElementById('prog-info-badge');
  badge.hidden = !progression;
  badge.textContent = progression?.roman.replaceAll(' - ', '-') ?? '';
  const play = document.getElementById('btn-prog-play');
  const label = t(progressionPlaying ? 'progressions.stop' : 'progressions.play', lang);
  play.title = name ? `${label} · ${name}` : label;
  play.setAttribute('aria-label', play.title);
  play.setAttribute('aria-pressed', String(progressionPlaying));
  document.getElementById('prog-play-led').classList.toggle('on-emerald', progressionPlaying);
  document.getElementById('prog-play-symbol').textContent = progressionPlaying ? '■' : '▶';
}

export function initKeyboardUI() {
  const keys = document.querySelectorAll('.key-pad[data-degree]');

  keys.forEach((keyEl) => {
    const degreeIndex = Number(keyEl.dataset.degree);

    keyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        keyEl.setPointerCapture(e.pointerId);
      } catch (_) {}

      const sourceKey = `ptr_${e.pointerId}`;
      const yNorm = computeYNorm(keyEl, e.clientY);
      pointerState.set(e.pointerId, {
        degreeIndex,
        startY: e.clientY,
        hasSlid: false
      });
      triggerDegreeDown(degreeIndex, sourceKey, yNorm);
    });

    keyEl.addEventListener('pointermove', (e) => {
      const pState = pointerState.get(e.pointerId);
      if (!pState || pState.degreeIndex !== degreeIndex) return;

      // Solo modular expresión Eje Y cuando el dedo realmente se desliza verticalmente (> 6 px)
      if (!pState.hasSlid && Math.abs(e.clientY - pState.startY) > 6) {
        pState.hasSlid = true;
      }
      if (pState.hasSlid) {
        const yNorm = computeYNorm(keyEl, e.clientY);
        updateKeyVisualState(degreeIndex, yNorm);
        applyYAxisExpression(yNorm, getState().yAxisMode);
      }
    });

    const onPointerEnd = (e) => {
      const pState = pointerState.get(e.pointerId);
      if (!pState) return;
      pointerState.delete(e.pointerId);
      const sourceKey = `ptr_${e.pointerId}`;
      triggerDegreeUp(pState.degreeIndex, sourceKey);
    };

    keyEl.addEventListener('pointerup', onPointerEnd);
    keyEl.addEventListener('pointercancel', onPointerEnd);
  });

  // Atajos de teclado físico PC: Z (I), S (II), X (III), D (IV), C (V), F (VI), V (VII)
  const heldKeyCodes = new Set();

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (document.getElementById('orbita-chassis').inert) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    const degreeIndex = KEY_CODE_TO_DEGREE[e.code];
    if (degreeIndex !== undefined) {
      e.preventDefault();
      heldKeyCodes.add(e.code);
      const sourceKey = `kbd_${e.code}`;
      triggerDegreeDown(degreeIndex, sourceKey, 0.78);
    }
  });

  window.addEventListener('keyup', (e) => {
    const degreeIndex = KEY_CODE_TO_DEGREE[e.code];
    if (degreeIndex !== undefined && heldKeyCodes.has(e.code)) {
      e.preventDefault();
      heldKeyCodes.delete(e.code);
      const sourceKey = `kbd_${e.code}`;
      triggerDegreeUp(degreeIndex, sourceKey);
    }
  });

  window.addEventListener('blur', () => {
    for (const code of Array.from(heldKeyCodes)) {
      const deg = KEY_CODE_TO_DEGREE[code];
      if (deg !== undefined) {
        triggerDegreeUp(deg, `kbd_${code}`);
      }
    }
    heldKeyCodes.clear();
  });

  setProgressionVisualCallback(degreeIndex => {
    const previous = progressionDegree;
    progressionDegree = degreeIndex;
    if (previous !== null && previous !== degreeIndex) updateKeyVisualState(previous);
    if (degreeIndex !== null) updateKeyVisualState(degreeIndex);
  });
  document.getElementById('btn-prog-up').addEventListener('click', () => selectProgression(1));
  document.getElementById('btn-prog-down').addEventListener('click', () => selectProgression(-1));
  document.getElementById('btn-prog-play').addEventListener('click', toggleProgressionPlayback);
  renderProgressionWidget();
  renderKeyboardLabels();
  subscribe((_st, changedKeys) => {
    if (changedKeys.some(k => ['rootSemitone', 'scaleMode', 'octaveOffset', 'playMode', 'customScale', 'notation', 'lang'].includes(k))) {
      renderKeyboardLabels();
    }
    if (changedKeys.some(k => ['progressionIndex', 'progressionPlaying', 'lang'].includes(k))) {
      renderProgressionWidget();
    }
  });
}
