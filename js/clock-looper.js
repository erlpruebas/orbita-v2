/**
 * clock-looper.js — Reloj Maestro Lookahead, Metrónomo 100% mudo en reposo (REGLAS_NO_ROMPER.md #1)
 * y Looper Cuantizado con Precuenta 1-2-3-4 y Cero Desfase (REGLAS_NO_ROMPER.md #2).
 */

import { ensureAudioUnlocked, triggerMetronomeClick } from './audio-core.js';
import { getState, setState } from './state.js';
import { getActiveDrumPattern, triggerDrumPatternStep } from './drum-engine.js';
import { getPresetById, startHumanizedVoiceGroup } from './synth-presets.js';
import { onMasterClockStep, setAccompanimentHooks } from './accompaniment.js';
import { onProgressionClockStep, stopProgressionPlaybackEngine } from './progressions.js';

// Constantes del scheduler lookahead
const LOOKAHEAD_INTERVAL_MS = 20;
const SCHEDULE_AHEAD_SEC = 0.085;
const DOWNBEAT_SNAP_SEC = 0.085; // Ventana de tolerancia ±85 ms en el tiempo 1 (REGLAS_NO_ROMPER.md #2)

let running = false;
let schedulerTimer = null;
let rafId = null;
const scheduledMetronomeClicks = new Set();

// Estado temporal del reloj maestro
let transportOriginTime = 0; // audioCtx.currentTime exacto del paso 0
let nextStepToSchedule = 0;  // Contador absoluto de semicorcheas desde transportOriginTime
let lastStepAudioTime = 0;
let currentStepMod16 = 0;

// Precuenta de 4 clics (PRE 1-2-3-4)
let countInActive = false;
let countInTimers = [];
let recordStartTime = 0;     // audioCtx.currentTime exacto del tiempo 1 tras los 4 clics
let drumWasArmedBeforeRec = false;
let isOverdubbing = false;

// Almacén del Looper (eventos sample-accurate referenciados a recordStartTime)
// Cada evento: { id, offsetSec, durationSec, notes, presetId, humanize, velocity, lastTriggeredCycle }
let loopEvents = [];
let activePendingRecords = new Map(); // voiceKey -> { offsetSec, startTime, notes, presetId, humanize, velocity }
let activeLooperVoices = new Set();
let loopDurationSec = 0;

// Telemetría de diagnóstico (?debug=1)
let lastLooperDeltaMs = 0;
let lastCatchUpDeltaMs = 0;

export function getDebugTelemetry() {
  const st = getState();
  return {
    running,
    countInActive,
    bpm: st.bpm,
    step: currentStepMod16,
    beat: st.currentBeat,
    looperState: st.looperState,
    loopBars: st.loopBars,
    loopEventsCount: loopEvents.length,
    lastLooperDeltaMs,
    lastCatchUpDeltaMs
  };
}

// Conectar hook para que las notas del acompañamiento automático también se graben en el looper
setAccompanimentHooks({
  onRecordEvent(ev) {
    recordFixedDurationEvent(ev);
  },
  onReleaseDegree(degreeIndex, when) {
    trimAccompanimentEventsOnRelease(degreeIndex, when);
  },
  onDebugCatchUp(deltaMs) {
    lastCatchUpDeltaMs = deltaMs;
  }
});

function getBeatDurSec() {
  const bpm = getState().bpm || 92;
  return 60 / bpm;
}

function getStepDurSec() {
  return getBeatDurSec() / 4; // 1 semicorchea
}

/**
 * Devuelve el estado instantáneo del transporte para el Enganche Instantáneo (Late-Press Catch-Up)
 */
export function getTransportSnapshot() {
  if (!running) {
    return { running: false, currentStep: 0, stepElapsedSec: 0 };
  }
  const ctx = ensureAudioUnlocked();
  const elapsedSinceStep = Math.max(0, ctx.currentTime - lastStepAudioTime);
  return {
    running: true,
    currentStep: currentStepMod16,
    stepElapsedSec: elapsedSinceStep
  };
}

/**
 * Comprueba si el transporte debe seguir corriendo o pararse por completo
 * REGLA 1: Sin batería, looper ni progresión activos, running debe ser false.
 */
function evaluateTransportLifecycle() {
  const st = getState();
  const looperNeedsClock = st.looperState === 'recording' || st.looperState === 'playing';
  const shouldRun = Boolean(st.drumPlaying || looperNeedsClock || st.progressionPlaying);

  if (!shouldRun && !countInActive) {
    stopTransportInternal();
  } else if (shouldRun && !running && !countInActive) {
    startTransportAt(ensureAudioUnlocked().currentTime + 0.01);
  }
  return shouldRun || countInActive;
}

function startTransportAt(originAudioTime) {
  stopSchedulerOnly();
  if (running) {
    stopScheduledMetronomeClicks();
    stopProgressionPlaybackEngine();
  }
  const ctx = ensureAudioUnlocked();
  running = true;
  transportOriginTime = originAudioTime ?? (ctx.currentTime + 0.015);
  nextStepToSchedule = 0;
  currentStepMod16 = 0;
  lastStepAudioTime = transportOriginTime;

  schedulerTick();
  schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_INTERVAL_MS);
  startVisualLoop();
}

function stopSchedulerOnly() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function stopTransportInternal() {
  stopSchedulerOnly();
  clearCountInTimers();
  running = false;
  countInActive = false;
  currentStepMod16 = 0;
  stopScheduledMetronomeClicks();
  stopAllLooperVoices();
  stopProgressionPlaybackEngine();
  setState({ currentBeat: -1, currentStep: 0 });
  updateLoopProgressUI(0);
}

function clearCountInTimers() {
  countInTimers.forEach(id => clearTimeout(id));
  countInTimers = [];
  if (countInActive) stopScheduledMetronomeClicks();
}

function scheduleMetronomeClick(when, isDownbeat) {
  const now = ensureAudioUnlocked().currentTime;
  for (const click of scheduledMetronomeClicks) {
    if (click.endsAt <= now) scheduledMetronomeClicks.delete(click);
  }
  scheduledMetronomeClicks.add(triggerMetronomeClick(when, isDownbeat));
}

function stopScheduledMetronomeClicks() {
  for (const click of scheduledMetronomeClicks) click.stop();
  scheduledMetronomeClicks.clear();
}

function stopAllLooperVoices() {
  activeLooperVoices.forEach(v => {
    try { v.stop(null, true); } catch (_) {}
  });
  activeLooperVoices.clear();
}

/**
 * Tick del scheduler Lookahead (cada 20 ms programa eventos hasta +85 ms en audioCtx.currentTime)
 */
function schedulerTick() {
  if (!running) return;
  const ctx = ensureAudioUnlocked();
  const now = ctx.currentTime;
  const stepDur = getStepDurSec();

  while (true) {
    const stepTime = transportOriginTime + nextStepToSchedule * stepDur;
    if (stepTime > now + SCHEDULE_AHEAD_SEC) {
      break;
    }
    scheduleSingleStep(nextStepToSchedule, stepTime);
    nextStepToSchedule++;
  }
}

function scheduleSingleStep(absStepIndex, stepTime) {
  const st = getState();
  const step16 = absStepIndex % 16;
  const isBeatStart = (step16 % 4) === 0;
  const beatIndex = Math.floor(step16 / 4); // 0..3

  currentStepMod16 = step16;
  lastStepAudioTime = stepTime;

  // 1. METRÓNOMO: REGLA 1 — Solo suena si el transporte está activo Y metronomeEnabled === true
  if (isBeatStart && st.metronomeEnabled) {
    scheduleMetronomeClick(stepTime, beatIndex === 0);
  }

  // 2. BATERÍA 4/4: Solo si drumPlaying está activo
  if (st.drumPlaying) {
    const pattern = getActiveDrumPattern();
    triggerDrumPatternStep(pattern, step16, stepTime);
  }

  // 3. ACOMPAÑAMIENTO AUTOMÁTICO (1..9) en fase con el reloj maestro
  onProgressionClockStep(absStepIndex, stepTime);
  onMasterClockStep(step16, stepTime);

  // 4. REPRODUCCIÓN DEL LOOPER: Dispara eventos grabados que caen dentro de la ventana de este paso
  if ((st.looperState === 'playing' || (st.looperState === 'recording' && isOverdubbing)) && loopDurationSec > 0 && loopEvents.length > 0) {
    const stepDur = getStepDurSec();
    const relTimeStart = (absStepIndex * stepDur);
    const cycleIndex = Math.floor(relTimeStart / loopDurationSec);
    const windowStart = relTimeStart - cycleIndex * loopDurationSec;
    const windowEnd = windowStart + stepDur;

    for (const ev of loopEvents) {
      // No reproducir un evento que acaba de ser grabado hace menos de medio ciclo en overdub
      if (ev.recordedAtAudioTime && (stepTime - ev.recordedAtAudioTime) < loopDurationSec * 0.5) {
        continue;
      }
      if (ev.offsetSec >= windowStart - 0.0005 && ev.offsetSec < windowEnd - 0.0005) {
        if (ev.lastTriggeredCycle !== cycleIndex || ev.lastTriggeredStep !== absStepIndex) {
          ev.lastTriggeredCycle = cycleIndex;
          ev.lastTriggeredStep = absStepIndex;
          const exactEventTime = transportOriginTime + cycleIndex * loopDurationSec + ev.offsetSec;
          const preset = getPresetById(ev.presetId);
          const handle = startHumanizedVoiceGroup(ev.notes, {
            preset,
            when: exactEventTime,
            duration: ev.durationSec,
            humanize: ev.humanize,
            velocity: ev.velocity
          });
          activeLooperVoices.add(handle);
        }
      }
    }
  }
}

/**
 * Bucle visual (requestAnimationFrame) para actualizar los 4 LEDs de pulso y la barra de progreso
 */
let progressFillEl = null;
function updateLoopProgressUI(ratio01, isRec = false) {
  if (typeof document === 'undefined') return;
  if (!progressFillEl) {
    progressFillEl = document.getElementById('loop-progress-fill');
  }
  if (!progressFillEl) return;
  const pct = Math.max(0, Math.min(100, ratio01 * 100));
  progressFillEl.style.width = `${pct.toFixed(1)}%`;
  progressFillEl.classList.toggle('is-recording', isRec);
}

function startVisualLoop() {
  if (typeof requestAnimationFrame === 'undefined') return;
  if (rafId) cancelAnimationFrame(rafId);

  const tickUI = () => {
    if (!running && !countInActive) return;
    const ctx = ensureAudioUnlocked();
    const now = ctx.currentTime;
    const st = getState();
    const beatDur = getBeatDurSec();
    const barDur = beatDur * 4;

    if (running && now >= transportOriginTime) {
      const elapsed = now - transportOriginTime;
      const beatInBar = Math.floor((elapsed / beatDur) % 4);
      if (st.currentBeat !== beatInBar) {
        setState({ currentBeat: beatInBar });
      }

      if (st.looperState === 'recording' && !isOverdubbing) {
        const recElapsed = Math.max(0, now - recordStartTime);
        const currentBars = Math.max(1, Math.ceil(recElapsed / barDur));
        const barProgress = (recElapsed % barDur) / barDur;
        updateLoopProgressUI(barProgress, true);
        if (st.loopBars !== currentBars) {
          setState({ loopBars: currentBars });
        }
      } else if ((st.looperState === 'playing' || isOverdubbing) && loopDurationSec > 0) {
        const loopPhase = (elapsed % loopDurationSec) / loopDurationSec;
        updateLoopProgressUI(loopPhase, st.looperState === 'recording');
      } else {
        const barPhase = (elapsed % barDur) / barDur;
        updateLoopProgressUI(barPhase, false);
      }
    }

    rafId = requestAnimationFrame(tickUI);
  };

  rafId = requestAnimationFrame(tickUI);
}

/**
 * =========================================================
 * CONTROLES DE BATERÍA Y BPM
 * =========================================================
 */
export function toggleDrumPlayback() {
  ensureAudioUnlocked();
  setState({ drumPlaying: !getState().drumPlaying });
  evaluateTransportLifecycle();
}

export function toggleProgressionPlayback() {
  const st = getState();
  const progressionPlaying = !st.progressionPlaying;
  if (progressionPlaying) ensureAudioUnlocked();
  setState({
    progressionPlaying,
    progressionIndex: progressionPlaying && st.progressionIndex === -1 ? 0 : st.progressionIndex
  });
  const transportStillActive = evaluateTransportLifecycle();
  if (!progressionPlaying && transportStillActive) stopProgressionPlaybackEngine();
}

export function onBpmChanged(newBpm) {
  const clamped = Math.max(40, Math.min(220, Math.round(Number(newBpm) || 92)));
  const oldBpm = getState().bpm;
  if (clamped === oldBpm) return;

  // Escalar proporcionalmente los tiempos del bucle si había uno grabado
  if (loopDurationSec > 0 && oldBpm > 0) {
    const scale = oldBpm / clamped;
    loopDurationSec *= scale;
    loopEvents.forEach(ev => {
      ev.offsetSec *= scale;
      ev.durationSec *= scale;
    });
  }

  setState({ bpm: clamped });

  if (running) {
    const ctx = ensureAudioUnlocked();
    const stepDur = (60 / clamped) / 4;
    transportOriginTime = ctx.currentTime - (nextStepToSchedule * stepDur);
  }
}

/**
 * =========================================================
 * CONTROLES DEL LOOPER (REC, PLAY/STOP, BORRAR)
 * =========================================================
 */
export function pressLooperRec() {
  const ctx = ensureAudioUnlocked();
  const st = getState();

  // Caso 1: Si está en precuenta, cancelar precuenta
  if (st.looperState === 'countin' || countInActive) {
    clearCountInTimers();
    countInActive = false;
    setState({ looperState: 'idle', currentBeat: -1 });
    if (drumWasArmedBeforeRec) {
      setState({ drumPlaying: true });
      startTransportAt(ctx.currentTime + 0.01);
    } else {
      evaluateTransportLifecycle();
    }
    return;
  }

  // Caso 2: Si está grabando -> Cerrar grabación cuantizada al compás y pasar a PLAY continuo
  if (st.looperState === 'recording') {
    finishLooperRecordingAndPlay();
    return;
  }

  // Caso 3: Si ya está reproduciendo un bucle -> Activar Overdub en fase
  if (st.looperState === 'playing' && loopDurationSec > 0) {
    isOverdubbing = true;
    recordStartTime = transportOriginTime;
    setState({ looperState: 'recording' });
    return;
  }

  // Caso 4: Nuevo bucle desde 0 (SPEC.md §4 y REGLAS_NO_ROMPER.md #2):
  // 1) Parar transporte a 0 (esté o no encendida la batería)
  // 2) Lanzar precuenta exacta de 4 clics (1-2-3-4)
  // 3) En el pulso 5 (tiempo 1 del compás 1), arrancar grabación y batería clavadas en fase
  drumWasArmedBeforeRec = st.drumPlaying;
  stopTransportInternal();

  loopEvents = [];
  activePendingRecords.clear();
  loopDurationSec = 0;
  isOverdubbing = false;
  countInActive = true;

  const beatDur = getBeatDurSec();
  const t0 = ctx.currentTime + 0.035;
  recordStartTime = t0 + 4 * beatDur;

  setState({
    looperState: 'countin',
    loopBars: 0,
    currentBeat: 0
  });

  // Programar los 4 clics de precuenta con precisión sample-accurate en Web Audio
  for (let i = 0; i < 4; i++) {
    const clickTime = t0 + i * beatDur;
    scheduleMetronomeClick(clickTime, i === 0);

    const delayMs = Math.max(0, (clickTime - ctx.currentTime) * 1000);
    const tid = setTimeout(() => {
      if (countInActive) {
        setState({ currentBeat: i });
      }
    }, delayMs);
    countInTimers.push(tid);
  }

  // Programar entrada exacta a grabación en el tiempo 1 (recordStartTime)
  const startDelayMs = Math.max(0, (recordStartTime - ctx.currentTime - 0.025) * 1000);
  const startTid = setTimeout(() => {
    if (!countInActive) return;
    countInActive = false;
    setState({
      looperState: 'recording',
      loopBars: 1,
      drumPlaying: drumWasArmedBeforeRec
    });
    startTransportAt(recordStartTime);
  }, startDelayMs);
  countInTimers.push(startTid);
}

/**
 * Cierra la grabación cuantizando al número de compases más cercano (1, 2, 4 u 8)
 */
function finishLooperRecordingAndPlay() {
  const ctx = ensureAudioUnlocked();
  const now = ctx.currentTime;

  // Cerrar cualquier nota que el usuario aún mantenga pulsada al cerrar el bucle
  for (const key of Array.from(activePendingRecords.keys())) {
    recordNoteEnd(key);
  }

  if (isOverdubbing && loopDurationSec > 0) {
    isOverdubbing = false;
    loopEvents.forEach(ev => { ev.recordedAtAudioTime = 0; });
    setState({ looperState: 'playing' });
    return;
  }

  const beatDur = getBeatDurSec();
  const barDur = beatDur * 4;
  const rawElapsed = Math.max(0.2, now - recordStartTime);

  // Cuantizar al número de compases musicales más cercano (1, 2, 4, 8)
  const rawBars = rawElapsed / barDur;
  let quantizedBars = 1;
  if (rawBars <= 1.35) quantizedBars = 1;
  else if (rawBars <= 2.75) quantizedBars = 2;
  else if (rawBars <= 5.5) quantizedBars = 4;
  else quantizedBars = 8;

  loopDurationSec = quantizedBars * barDur;

  // Recortar o ajustar eventos para que quepan limpiamente dentro del bucle cuantizado
  loopEvents = loopEvents
    .filter(ev => ev.offsetSec < loopDurationSec - 0.02)
    .map(ev => ({
      ...ev,
      durationSec: Math.min(ev.durationSec, Math.max(0.06, loopDurationSec - ev.offsetSec - 0.008)),
      recordedAtAudioTime: 0,
      lastTriggeredCycle: -1,
      lastTriggeredStep: -1
    }));

  isOverdubbing = false;
  setState({
    looperState: 'playing',
    loopBars: quantizedBars
  });

  // Reiniciar el origen de fase del bucle exactamente en el cierre cuantizado para reproducción inmediata sin hueco
  startTransportAt(ctx.currentTime + 0.005);
}

export function pressLooperPlayStop() {
  const ctx = ensureAudioUnlocked();
  const st = getState();

  if (st.looperState === 'recording') {
    finishLooperRecordingAndPlay();
    return;
  }

  if (st.looperState === 'playing') {
    // Detener reproducción del looper pero conservar el bucle grabado
    stopAllLooperVoices();
    setState({ looperState: 'idle' });
    evaluateTransportLifecycle();
    return;
  }

  // Si está en idle y hay un bucle grabado, reproducirlo desde el principio
  if (st.looperState === 'idle' && loopDurationSec > 0 && loopEvents.length > 0) {
    loopEvents.forEach(ev => {
      ev.lastTriggeredCycle = -1;
      ev.lastTriggeredStep = -1;
    });
    setState({ looperState: 'playing' });
    if (!running) {
      startTransportAt(ctx.currentTime + 0.01);
    }
  }
}

function stopLooperActivity() {
  clearCountInTimers();
  countInActive = false;
  isOverdubbing = false;
  activePendingRecords.clear();
  stopAllLooperVoices();
}

function replaceLooperContent(events, duration, loopBars) {
  stopLooperActivity();
  loopEvents = events;
  loopDurationSec = duration;
  setState({ looperState: 'idle', loopBars });
  updateLoopProgressUI(0, false);
  evaluateTransportLifecycle();
}

export function pressLooperClear() {
  replaceLooperContent([], 0, 0);
}

function copyLooperEvent({ id, degreeIndex, offsetSec, durationSec, notes, presetId, humanize, velocity }) {
  const event = { id, offsetSec, durationSec, notes: [...notes], presetId, humanize, velocity };
  if (Number.isInteger(degreeIndex) && degreeIndex >= 0 && degreeIndex <= 6) event.degreeIndex = degreeIndex;
  return event;
}

export function exportLooperSnapshot() {
  if (loopEvents.length === 0 || loopDurationSec <= 0) return null;
  const { bpm, loopBars } = getState();
  return {
    version: 1,
    bpm,
    loopBars,
    loopDurationSec,
    events: loopEvents.map(copyLooperEvent)
  };
}

export function importLooperSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.events) ||
      ![1, 2, 4, 8].includes(snapshot.loopBars) ||
      !Number.isFinite(snapshot.bpm) || snapshot.bpm < 40 || snapshot.bpm > 220 ||
      !Number.isFinite(snapshot.loopDurationSec) || snapshot.loopDurationSec <= 0) {
    pressLooperClear();
    return;
  }

  const scale = snapshot.bpm / getState().bpm;
  const events = [];
  for (const [index, event] of snapshot.events.entries()) {
    if (!event || !Number.isFinite(event.offsetSec) || event.offsetSec < 0 ||
        event.offsetSec >= snapshot.loopDurationSec ||
        !Number.isFinite(event.durationSec) || event.durationSec <= 0 ||
        !Array.isArray(event.notes) || event.notes.length === 0 ||
        !event.notes.every(note => Number.isInteger(note) && note >= 0 && note <= 127)) continue;

    events.push({
      ...copyLooperEvent(event),
      id: event.id ?? `import-${index}`,
      offsetSec: event.offsetSec * scale,
      durationSec: event.durationSec * scale,
      presetId: Number.isInteger(event.presetId) && event.presetId >= 0 && event.presetId <= 49 ? event.presetId : 0,
      humanize: [0, 1, 2, 3].includes(event.humanize) ? event.humanize : 0,
      velocity: Number.isFinite(event.velocity) && event.velocity > 0 ? Math.min(event.velocity, 1.2) : 1,
      recordedAtAudioTime: 0,
      lastTriggeredCycle: -1,
      lastTriggeredStep: -1
    });
  }

  if (events.length === 0) {
    pressLooperClear();
    return;
  }
  replaceLooperContent(events, snapshot.loopDurationSec * scale, snapshot.loopBars);
}

/**
 * Detiene batería, progresión y looper conservando el bucle, al terminar de grabar una maqueta
 * para que el usuario pueda escucharla en silencio.
 */
export function stopAllTransportForPlayback() {
  stopLooperActivity();
  setState({ drumPlaying: false, progressionPlaying: false, looperState: 'idle' });
  evaluateTransportLifecycle();
}

/**
 * =========================================================
 * CAPTURA DE EVENTOS EN EL LOOPER (CON DOWNBEAT SNAP ±85ms)
 * =========================================================
 */
function computeSnappedOffset(eventAudioTime) {
  const st = getState();
  if (isOverdubbing && loopDurationSec > 0) {
    const rel = (eventAudioTime - transportOriginTime) % loopDurationSec;
    const wrapped = (rel + loopDurationSec) % loopDurationSec;
    // Snap al inicio del bucle si cae a menos de 75 ms del downbeat
    if (wrapped < DOWNBEAT_SNAP_SEC || (loopDurationSec - wrapped) < DOWNBEAT_SNAP_SEC) {
      lastLooperDeltaMs = Math.round((wrapped < DOWNBEAT_SNAP_SEC ? wrapped : wrapped - loopDurationSec) * 1000);
      return 0;
    }
    lastLooperDeltaMs = 0;
    return wrapped;
  }

  // En grabación inicial (o últimos 85 ms de la precuenta antes del tiempo 1)
  const deltaFromStart = eventAudioTime - recordStartTime;
  if (Math.abs(deltaFromStart) <= DOWNBEAT_SNAP_SEC) {
    lastLooperDeltaMs = Math.round(deltaFromStart * 1000);
    return 0.0;
  }
  if (deltaFromStart < 0) return null; // Aún en precuenta temprana
  lastLooperDeltaMs = 0;
  return deltaFromStart;
}

export function isRecordingActiveOrSnappable() {
  const st = getState();
  if (st.looperState === 'recording') return true;
  if (st.looperState === 'countin' && countInActive) {
    const ctx = ensureAudioUnlocked();
    return (recordStartTime - ctx.currentTime) <= DOWNBEAT_SNAP_SEC;
  }
  return false;
}

export function recordNoteStart(voiceKey, { notes, presetId, humanize, velocity = 1.0 }) {
  if (!isRecordingActiveOrSnappable()) return;
  const ctx = ensureAudioUnlocked();
  const now = ctx.currentTime;
  const offsetSec = computeSnappedOffset(now);
  if (offsetSec === null) return;

  activePendingRecords.set(voiceKey, {
    offsetSec,
    startTime: Math.max(now, recordStartTime),
    notes: [...notes],
    presetId,
    humanize,
    velocity
  });
}

export function recordNoteEnd(voiceKey) {
  const pending = activePendingRecords.get(voiceKey);
  if (!pending) return;
  activePendingRecords.delete(voiceKey);

  const ctx = ensureAudioUnlocked();
  const now = ctx.currentTime;
  const durationSec = Math.max(0.08, now - pending.startTime);

  loopEvents.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    offsetSec: pending.offsetSec,
    durationSec,
    notes: pending.notes,
    presetId: pending.presetId,
    humanize: pending.humanize,
    velocity: pending.velocity,
    recordedAtAudioTime: now,
    lastTriggeredCycle: -1,
    lastTriggeredStep: -1
  });
}

export function recordFixedDurationEvent({ degreeIndex, notes, presetId, humanize, velocity = 0.9, when, duration }) {
  if (!isRecordingActiveOrSnappable()) return;
  const ctx = ensureAudioUnlocked();
  const evTime = when ?? ctx.currentTime;
  const offsetSec = computeSnappedOffset(evTime);
  if (offsetSec === null) return;

  loopEvents.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    degreeIndex,
    offsetSec,
    durationSec: Math.max(0.06, duration || 0.25),
    notes: [...notes],
    presetId,
    humanize,
    velocity,
    recordedAtAudioTime: evTime,
    lastTriggeredCycle: -1,
    lastTriggeredStep: -1
  });
}

function trimAccompanimentEventsOnRelease(degreeIndex, when = null) {
  if (!isRecordingActiveOrSnappable()) return;
  const ctx = ensureAudioUnlocked();
  const now = when ?? ctx.currentTime;
  for (let i = loopEvents.length - 1; i >= 0; i--) {
    const ev = loopEvents[i];
    if (ev.degreeIndex === degreeIndex && ev.recordedAtAudioTime > 0) {
      const elapsedSinceEv = now - ev.recordedAtAudioTime;
      if (elapsedSinceEv >= 0 && elapsedSinceEv < ev.durationSec) {
        ev.durationSec = Math.max(0.065, elapsedSinceEv);
      }
      break;
    }
  }
}
