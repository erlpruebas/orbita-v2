/**
 * ui-deck.js — Controles del panel hardware de ÓRBITA, LEDs, Tap Tempo,
 * pulsación prolongada en BPM y preview sonoro inmediato al cambiar Octava/Sonido.
 */

import { ensureAudioUnlocked, setReverbLevel } from './audio-core.js';
import { getState, setState, subscribe } from './state.js';
import { getNoteNameUpper } from './theory.js';
import { resolveLang, t } from './i18n.js';
import { playTonicReferencePreview, getActivePreset } from './synth-presets.js';
import { getActiveDrumPattern } from './drum-engine.js';
import { getActiveAccompanimentPattern } from './accompaniment.js';
import { POPULAR_PROGRESSIONS, selectProgression } from './progressions.js';
import { isDemoCountIn } from './demo-recorder.js';
import { showSessionToast } from './ui-modals.js';
import {
  toggleDrumPlayback,
  toggleProgressionPlayback,
  onBpmChanged,
  loadLooperAudioFile,
  pressLooperRec,
  pressLooperPlayStop,
  pressLooperClear
} from './clock-looper.js';

const Y_AXIS_MODES = ['filter', 'volume', 'drive'];
const SCALE_MODES = ['M', 'm', 'custom'];

// Tap Tempo buffer
let tapTimes = [];

function handleTapTempo() {
  const now = performance.now();
  // Si pasaron más de 2.2 segundos desde el último toque, reiniciar serie
  if (tapTimes.length > 0 && (now - tapTimes[tapTimes.length - 1]) > 2200) {
    tapTimes = [];
  }
  tapTimes.push(now);
  if (tapTimes.length > 5) {
    tapTimes.shift();
  }
  if (tapTimes.length >= 2) {
    let sumIntervals = 0;
    for (let i = 1; i < tapTimes.length; i++) {
      sumIntervals += (tapTimes[i] - tapTimes[i - 1]);
    }
    const avgMs = sumIntervals / (tapTimes.length - 1);
    const computedBpm = Math.round(60000 / avgMs);
    if (computedBpm >= 40 && computedBpm <= 220) {
      onBpmChanged(computedBpm);
    }
  }
}

/**
 * Helper para soporte de pulsación prolongada (long-press repeat) en flechas de BPM
 */
function bindRepeatButton(btnEl, stepFn) {
  if (!btnEl) return;
  let holdTimeout = null;
  let repeatInterval = null;

  const clearTimers = () => {
    if (holdTimeout) { clearTimeout(holdTimeout); holdTimeout = null; }
    if (repeatInterval) { clearInterval(repeatInterval); repeatInterval = null; }
    btnEl.classList.remove('is-pressed');
  };

  btnEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    btnEl.classList.add('is-pressed');
    stepFn(1);

    holdTimeout = setTimeout(() => {
      let ticks = 0;
      repeatInterval = setInterval(() => {
        ticks++;
        stepFn(ticks > 12 ? 5 : 1);
      }, 75);
    }, 340);
  });

  btnEl.addEventListener('pointerup', clearTimers);
  btnEl.addEventListener('pointercancel', clearTimers);
  btnEl.addEventListener('pointerleave', clearTimers);
}

export function renderDeckUI() {
  const st = getState();

  // 1. Header: Selector Eje Y y Key-Strike (⚡)
  const yAxisBtn = document.getElementById('btn-yaxis');
  if (yAxisBtn) {
    yAxisBtn.dataset.mode = st.yAxisMode;
    const iconUse = yAxisBtn.querySelector('use');
    if (iconUse) {
      const iconMap = {
        filter: '#icon-yaxis-filter',
        volume: '#icon-yaxis-volume',
        drive: '#icon-yaxis-drive'
      };
      iconUse.setAttribute('href', iconMap[st.yAxisMode] || '#icon-yaxis-filter');
    }
  }

  const keyStrikeBtn = document.getElementById('btn-keystrike');
  if (keyStrikeBtn) {
    keyStrikeBtn.classList.toggle('is-on-amber', Boolean(st.keyStrike));
    const led = keyStrikeBtn.querySelector('.led-dot');
    if (led) led.classList.toggle('on-amber', Boolean(st.keyStrike));
  }

  // 2. Bloque Izquierdo: Modo (Melodía / Acordes)
  const modeBtn = document.getElementById('btn-play-mode');
  if (modeBtn) {
    const isChord = st.playMode === 'chord';
    const led = modeBtn.querySelector('.led-dot');
    const useEl = modeBtn.querySelector('use');
    if (led) {
      led.className = `led-dot ${isChord ? 'on-amber' : 'on-emerald'}`;
    }
    if (useEl) {
      useEl.setAttribute('href', isChord ? '#icon-mode-chord' : '#icon-mode-melody');
    }
  }

  // Humanizador (0 a 3 LEDs cian)
  for (let i = 1; i <= 3; i++) {
    const led = document.getElementById(`hum-led-${i}`);
    if (led) {
      led.classList.toggle('on-cyan', st.humanize >= i);
    }
  }

  // Reverb (0 a 3 LEDs violeta)
  for (let i = 1; i <= 3; i++) {
    const led = document.getElementById(`rev-led-${i}`);
    if (led) {
      led.classList.toggle('on-violet', st.reverbLevel >= i);
    }
  }

  // Acompañamiento Automático (0 a 9)
  const accompScreen = document.getElementById('accomp-screen');
  const accompVal = document.getElementById('accomp-val');
  if (accompVal) accompVal.textContent = String(st.accompaniment);
  if (accompScreen) accompScreen.classList.toggle('is-active', st.accompaniment > 0);

  // 3. Bloque Tonalidad (Cuadrícula 2x2)
  const tonicEl = document.getElementById('tonic-display');
  if (tonicEl) {
    tonicEl.textContent = getNoteNameUpper(st.rootSemitone, st.notation);
  }
  const scaleModeBtn = document.getElementById('btn-scale-mode');
  if (scaleModeBtn && scaleModeBtn.dataset.mode !== st.scaleMode) {
    scaleModeBtn.dataset.mode = st.scaleMode;
    if (st.scaleMode === 'custom') {
      scaleModeBtn.innerHTML = '<svg class="wrench-mode-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-wrench"></use></svg>';
    } else {
      scaleModeBtn.textContent = st.scaleMode;
    }
    scaleModeBtn.classList.toggle('is-major', st.scaleMode === 'M');
    scaleModeBtn.classList.toggle('is-minor', st.scaleMode === 'm');
    scaleModeBtn.classList.toggle('is-custom', st.scaleMode === 'custom');
  }

  // 4. Bloque Combinado Octava + Sonido
  const octVal = document.getElementById('octave-val');
  if (octVal) {
    octVal.textContent = st.octaveOffset > 0 ? `+${st.octaveOffset}` : String(st.octaveOffset);
  }
  const soundVal = document.getElementById('sound-val');
  if (soundVal) {
    soundVal.textContent = String((st.activeSoundSlot || 0) + 1);
  }

  // 5. Bloque Combinado Tempo/Metrónomo + Batería
  const bpmVal = document.getElementById('bpm-val');
  if (bpmVal) {
    bpmVal.textContent = String(st.bpm);
  }
  const metroLed = document.getElementById('metro-led');
  if (metroLed) {
    metroLed.classList.toggle('on-cyan', Boolean(st.metronomeEnabled));
  }
  const metroBtn = document.getElementById('btn-metro-toggle');
  if (metroBtn) {
    metroBtn.classList.toggle('metro-on', Boolean(st.metronomeEnabled));
  }

  const drumVal = document.getElementById('drum-val');
  if (drumVal) {
    drumVal.textContent = String((st.activeDrumSlot || 0) + 1);
  }
  const drumPlayBtn = document.getElementById('btn-drum-toggle');
  if (drumPlayBtn) {
    drumPlayBtn.classList.toggle('is-playing', Boolean(st.drumPlaying));
    const useEl = drumPlayBtn.querySelector('use');
    if (useEl) {
      useEl.setAttribute('href', st.drumPlaying ? '#icon-stop' : '#icon-play');
    }
  }

  // 6. Barra de Looper
  const isCountIn = st.looperState === 'countin' || isDemoCountIn();
  const hasTrack = st.loadedTrackDuration > 0;
  for (let b = 0; b < 4; b++) {
    const bLed = document.getElementById(`beat-led-${b}`);
    if (!bLed) continue;
    bLed.className = 'led-dot';
    if (st.currentBeat === b) {
      if (isCountIn) {
        bLed.classList.add('on-ruby');
      } else if (b === 0) {
        bLed.classList.add('on-amber');
      } else {
        bLed.classList.add('on-emerald');
      }
    }
  }

  const barsBadge = document.getElementById('loop-bars-badge');
  if (barsBadge) {
    if (isCountIn) {
      barsBadge.textContent = `-${4 - Math.max(0, st.currentBeat)}`;
    } else if (hasTrack) {
      if (st.loopBars) {
        barsBadge.textContent = `${st.loopBars}B+`;
      } else {
        const seconds = Math.floor(st.loadedTrackDuration);
        barsBadge.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      }
    } else {
      barsBadge.textContent = `${st.loopBars || 0}B`;
    }
  }

  const recBtn = document.getElementById('btn-looper-rec');
  const recLed = document.getElementById('looper-rec-led');
  if (recBtn) {
    recBtn.classList.toggle('is-rec-active', st.looperState === 'recording');
    recBtn.classList.toggle('is-countin', st.looperState === 'countin');
  }
  if (recLed) {
    recLed.classList.toggle('on-ruby', st.looperState === 'recording' || st.looperState === 'countin');
  }

  const playBtn = document.getElementById('btn-looper-play');
  const playLed = document.getElementById('looper-play-led');
  const isPlaying = st.looperState === 'playing' || st.backingTrackPlaying;
  if (playBtn) {
    playBtn.classList.toggle('is-play-active', isPlaying);
    const useEl = playBtn.querySelector('use');
    if (useEl) {
      useEl.setAttribute('href', isPlaying ? '#icon-stop' : '#icon-play');
    }
  }
  if (playLed) {
    playLed.classList.toggle('on-emerald', isPlaying);
  }

  const loadBtn = document.getElementById('btn-looper-load');
  if (loadBtn) loadBtn.title = st.loadedTrackName || t('deck.loopLoad', st.lang);
  document.getElementById('looper-load-led')?.classList.toggle('on-cyan', hasTrack);

  // 7. Barra OLED (Sonido · Acompañamiento · Batería · Progresión)
  const soundPreset = getActivePreset();
  const accompPat = getActiveAccompanimentPattern();
  const drumPat = getActiveDrumPattern();

  const soundNameEl = document.getElementById('status-sound-name');
  const accompNameEl = document.getElementById('status-accomp-name');
  const accompPillEl = document.getElementById('status-pill-accomp');
  const drumNameEl = document.getElementById('status-drum-name');

  if (soundNameEl) {
    soundNameEl.textContent = soundPreset ? soundPreset.name : 'Bruma';
  }
  if (accompNameEl) {
    accompNameEl.textContent = st.accompaniment === 0
      ? t('deck.manual', st.lang)
      : (accompPat ? accompPat.name : t('deck.pattern', st.lang, { number: st.accompaniment }));
  }
  if (accompPillEl) {
    accompPillEl.classList.toggle('is-off', st.accompaniment === 0);
  }
  if (drumNameEl) {
    drumNameEl.textContent = drumPat ? drumPat.name : 'Lo-Fi';
  }
  const progPill = document.getElementById('status-pill-prog');
  const progName = document.getElementById('status-prog-name');
  if (progPill && progName) {
    const progression = POPULAR_PROGRESSIONS[st.progressionIndex];
    const name = resolveLang(st.lang) === 'es' ? progression?.nameEs : progression?.nameEn;
    const action = !progression ? 'select' : st.progressionPlaying ? 'stop' : 'play';
    const label = t(`progressions.${action}`, st.lang);
    progName.textContent = name ?? '—';
    progPill.classList.toggle('is-off', !progression);
    progPill.classList.toggle('is-playing', Boolean(progression && st.progressionPlaying));
    progPill.setAttribute('aria-pressed', String(st.progressionPlaying));
    progPill.title = name ? `${label} · ${name}` : label;
    progPill.setAttribute('aria-label', progPill.title);
  }
}

export function initDeckUI() {
  document.getElementById('status-pill-prog')?.addEventListener('click', () => {
    if (getState().progressionIndex === -1) selectProgression(0, true);
    else toggleProgressionPlayback();
  });

  // Selector Eje Y (Filtro / Volumen / Distorsión)
  document.getElementById('btn-yaxis')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const cur = getState().yAxisMode;
    const next = Y_AXIS_MODES[(Y_AXIS_MODES.indexOf(cur) + 1) % Y_AXIS_MODES.length];
    setState({ yAxisMode: next });
  });

  // Interruptor Key-Strike (⚡)
  document.getElementById('btn-keystrike')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    setState({ keyStrike: !getState().keyStrike });
  });

  // 1. Modo (Melodía / Acordes)
  document.getElementById('btn-play-mode')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const next = getState().playMode === 'chord' ? 'melody' : 'chord';
    setState({ playMode: next });
  });

  // 2. Humanizador (0..3 LEDs cian)
  document.getElementById('btn-humanize')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const next = (getState().humanize + 1) % 4;
    setState({ humanize: next });
  });

  // 3. Reverb (0..3 LEDs violeta)
  document.getElementById('btn-reverb')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const next = (getState().reverbLevel + 1) % 4;
    setReverbLevel(next);
    setState({ reverbLevel: next });
  });

  // 4. Acompañamiento Automático (0..N con ◀ y ▶)
  document.getElementById('btn-accomp-prev')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const st = getState();
    const total = (st.selectedAccompaniments?.length || 9) + 1;
    const next = (st.accompaniment - 1 + total) % total;
    setState({ accompaniment: next });
  });

  document.getElementById('btn-accomp-next')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const st = getState();
    const total = (st.selectedAccompaniments?.length || 9) + 1;
    const next = (st.accompaniment + 1) % total;
    setState({ accompaniment: next });
  });

  document.getElementById('accomp-screen')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const cur = getState().accompaniment;
    setState({ accompaniment: cur === 0 ? 1 : 0 });
  });

  // 5. Bloque Tonalidad 2x2
  document.getElementById('btn-tonic-up')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    setState({ rootSemitone: (getState().rootSemitone + 1) % 12 });
    playTonicReferencePreview();
  });

  document.getElementById('btn-tonic-down')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    setState({ rootSemitone: (getState().rootSemitone - 1 + 12) % 12 });
    playTonicReferencePreview();
  });

  document.getElementById('btn-scale-mode')?.addEventListener('click', () => {
    ensureAudioUnlocked();
    const next = SCALE_MODES[(SCALE_MODES.indexOf(getState().scaleMode) + 1) % SCALE_MODES.length];
    setState({ scaleMode: next });
    playTonicReferencePreview();
  });

  // 6. Bloque Octava + Sonido (Con preview sonoro inmediato — SPEC.md §4)
  document.getElementById('btn-oct-up')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const cur = getState().octaveOffset;
    if (cur < 2) {
      setState({ octaveOffset: cur + 1 });
    }
    playTonicReferencePreview();
  });

  document.getElementById('btn-oct-down')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const cur = getState().octaveOffset;
    if (cur > -2) {
      setState({ octaveOffset: cur - 1 });
    }
    playTonicReferencePreview();
  });

  document.getElementById('btn-sound-up')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const st = getState();
    const count = st.selectedSounds.length || 9;
    const next = (st.activeSoundSlot + 1) % count;
    setState({ activeSoundSlot: next });
    playTonicReferencePreview();
  });

  document.getElementById('btn-sound-down')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const st = getState();
    const count = st.selectedSounds.length || 9;
    const next = (st.activeSoundSlot - 1 + count) % count;
    setState({ activeSoundSlot: next });
    playTonicReferencePreview();
  });

  // 7. Bloque Tempo/Metrónomo + Batería
  // Tap Tempo al tocar repetidamente la pantalla de BPM
  document.getElementById('tempo-screen')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    handleTapTempo();
  });

  // Toggle Metrónomo (solo suena cuando el transporte corre o en precuenta — REGLAS_NO_ROMPER.md #1)
  document.getElementById('btn-metro-toggle')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    handleTapTempo();
    setState({ metronomeEnabled: !getState().metronomeEnabled });
  });

  // Flechas BPM con soporte de pulsación prolongada
  bindRepeatButton(document.getElementById('btn-bpm-up'), (step) => {
    onBpmChanged(getState().bpm + step);
  });

  bindRepeatButton(document.getElementById('btn-bpm-down'), (step) => {
    onBpmChanged(getState().bpm - step);
  });

  // Batería Play/Stop y flechas ▲ / ▼
  document.getElementById('btn-drum-toggle')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    toggleDrumPlayback();
  });

  document.getElementById('btn-drum-up')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const st = getState();
    const count = st.selectedDrums.length || 9;
    setState({ activeDrumSlot: (st.activeDrumSlot + 1) % count });
  });

  document.getElementById('btn-drum-down')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    const st = getState();
    const count = st.selectedDrums.length || 9;
    setState({ activeDrumSlot: (st.activeDrumSlot - 1 + count) % count });
  });

  // 8. Barra de Looper (REC, PLAY/STOP, CARGAR, BORRAR)
  document.getElementById('btn-looper-rec')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pressLooperRec();
  });

  document.getElementById('btn-looper-play')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!isDemoCountIn()) pressLooperPlayStop();
  });

  const audioFileInput = document.getElementById('looper-audio-file-input');
  document.getElementById('btn-looper-load')?.addEventListener('click', () => audioFileInput?.click());
  audioFileInput?.addEventListener('change', async () => {
    const file = audioFileInput.files[0];
    audioFileInput.value = '';
    if (!file) return;
    try {
      const result = await loadLooperAudioFile(file);
      if (!result.ok) return;
      const { detectedBpm } = result;
      showSessionToast(detectedBpm === null ? 'deck.trackLoaded' : 'deck.trackLoadedTempo', { bpm: detectedBpm });
    } catch (_) {
      showSessionToast('deck.trackLoadError');
    }
  });

  document.getElementById('btn-looper-clear')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudioUnlocked();
    pressLooperClear();
  });

  renderDeckUI();
  subscribe(() => {
    renderDeckUI();
  });
}
