/**
 * main.js — Punto de entrada de ÓRBITA (Arquitectura Modular ES)
 */

import { ensureAudioUnlocked, getAudioContext } from './audio-core.js';
import { initDeckUI } from './ui-deck.js';
import { initKeyboardUI } from './ui-keyboard.js';
import { initModalsUI } from './ui-modals.js';
import { getDebugTelemetry } from './clock-looper.js';
import { getState } from './state.js';
import { initTutorial, startTutorial } from './tutorial.js';

function initDebugHudIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== '1') return;

  const hud = document.getElementById('debug-hud');
  if (!hud) return;
  hud.hidden = false;

  setInterval(() => {
    let ctxState = 'uninitialized';
    let latencyMs = 0;
    try {
      const ctx = getAudioContext();
      if (ctx) {
        ctxState = ctx.state;
        const baseL = ctx.baseLatency || 0;
        const outL = ctx.outputLatency || 0;
        latencyMs = Math.round((baseL + outL) * 1000);
      }
    } catch (_) {}

    const tel = getDebugTelemetry();
    hud.innerHTML = [
      `CTX: ${ctxState} (${latencyMs}ms)`,
      `BPM: ${tel.bpm} | STEP: ${tel.step} | BEAT: ${tel.beat}`,
      `LOOP: ${tel.looperState} (${tel.loopBars}B, ${tel.loopEventsCount} ev)`,
      `ΔLOOP: ${tel.lastLooperDeltaMs}ms | ΔCATCHUP: ${tel.lastCatchUpDeltaMs}ms`
    ].join('<br>');
  }, 100);
}

function bootstrapOrbita() {
  // Desbloqueo global síncrono en el primer gesto del usuario (REGLAS_NO_ROMPER.md #4)
  const unlockOnce = () => {
    try { ensureAudioUnlocked(); } catch (_) {}
  };
  window.addEventListener('pointerdown', unlockOnce, { capture: true, passive: true });
  window.addEventListener('touchstart', unlockOnce, { capture: true, passive: true });
  window.addEventListener('keydown', unlockOnce, { capture: true, passive: true });

  initDeckUI();
  initKeyboardUI();
  initModalsUI();
  initTutorial();
  initDebugHudIfRequested();

  const params = new URLSearchParams(window.location.search);
  if (!getState().tutorialDone && params.get('notutorial') !== '1') {
    const launchWhenReady = () => {
      if (getState().tutorialDone) return;
      if (document.querySelector('.hw-modal-backdrop:not([hidden])')) {
        setTimeout(launchWhenReady, 450);
      } else if (document.getElementById('tutorial-overlay').hidden) {
        startTutorial();
      }
    };
    setTimeout(launchWhenReady, 450);
  }

  // Registro opcional de Service Worker para PWA instalable en móvil
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapOrbita);
} else {
  bootstrapOrbita();
}
