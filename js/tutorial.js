/** Tutorial guiado sobre los controles del chasis. */

import { t } from './i18n.js';
import { getState, setState, subscribe } from './state.js';

export const TUTORIAL_STEPS = Object.freeze([
  '#keyboard-surface',
  '.module-tonality',
  '#progression-widget',
  '#control-deck',
  '#btn-open-sessions, #btn-open-config',
  '#btn-demo-rec'
].map((target, index) => ({
  target,
  title: `tutorial.${index + 1}.title`,
  body: `tutorial.${index + 1}.body`
})));

let stepIndex = 0;
let returnFocus = null;

function positionTutorial() {
  const overlay = document.getElementById('tutorial-overlay');
  if (overlay.hidden) return;
  const bounds = overlay.getBoundingClientRect();
  const targets = Array.from(document.querySelectorAll(TUTORIAL_STEPS[stepIndex].target), el => el.getBoundingClientRect());
  const edge = 8;
  const gap = 8;
  const left = Math.max(2, Math.min(...targets.map(rect => rect.left)) - 3);
  const right = Math.min(bounds.width - 2, Math.max(...targets.map(rect => rect.right)) + 3);
  const top = Math.max(2, Math.min(...targets.map(rect => rect.top)) - 3);
  const bottom = Math.min(bounds.height - 2, Math.max(...targets.map(rect => rect.bottom)) + 3);
  const spotlight = overlay.querySelector('.tutorial-spotlight');
  Object.assign(spotlight.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });

  const card = overlay.querySelector('.tutorial-card');
  card.style.maxHeight = '';
  card.style.width = '';
  const above = top - gap - edge;
  const below = bounds.height - bottom - gap - edge;
  const height = card.offsetHeight;
  const showBelow = below >= height || (above < height && below >= above);
  const available = showBelow ? below : above;
  let desiredTop = showBelow ? bottom + gap : top - height - gap;
  let desiredLeft = (left + right - card.offsetWidth) / 2;
  if (available < height) {
    // La fila de teclas y el panel pueden ocupar casi todo el alto en horizontal.
    const before = left - gap - edge;
    const after = bounds.width - right - gap - edge;
    const sideSpace = Math.max(before, after);
    if (sideSpace >= 210) {
      card.style.width = `${Math.min(sideSpace, card.offsetWidth)}px`;
      desiredLeft = before >= after ? left - gap - card.offsetWidth : right + gap;
      desiredTop = showBelow ? bottom - card.offsetHeight : top;
    } else if (available >= 120) {
      card.style.maxHeight = `${available}px`;
      if (!showBelow) desiredTop = top - card.offsetHeight - gap;
    }
  }
  card.style.top = `${Math.max(edge, Math.min(desiredTop, bounds.height - card.offsetHeight - edge))}px`;
  card.style.left = `${Math.max(edge, Math.min(desiredLeft, bounds.width - card.offsetWidth - edge))}px`;
}

function renderTutorial() {
  const { lang } = getState();
  const step = TUTORIAL_STEPS[stepIndex];
  document.getElementById('tutorial-step-count').textContent = t('tutorial.progress', lang, { step: stepIndex + 1, total: TUTORIAL_STEPS.length });
  document.getElementById('tutorial-step-title').textContent = t(step.title, lang);
  document.getElementById('tutorial-step-body').textContent = t(step.body, lang);
  document.getElementById('btn-tutorial-prev').disabled = stepIndex === 0;
  document.getElementById('btn-tutorial-next').textContent = t(stepIndex === TUTORIAL_STEPS.length - 1 ? 'tutorial.finish' : 'tutorial.next', lang);
  positionTutorial();
}

export function startTutorial(focusTarget = document.activeElement) {
  const overlay = document.getElementById('tutorial-overlay');
  if (overlay.hidden) returnFocus = focusTarget;
  stepIndex = 0;
  document.getElementById('orbita-chassis').inert = true;
  overlay.hidden = false;
  renderTutorial();
  document.getElementById('btn-tutorial-next').focus({ preventScroll: true });
}

function finishTutorial() {
  document.getElementById('tutorial-overlay').hidden = true;
  document.getElementById('orbita-chassis').inert = false;
  setState({ tutorialDone: true });
  returnFocus?.focus({ preventScroll: true });
  returnFocus = null;
}

export function initTutorial() {
  const overlay = document.getElementById('tutorial-overlay');
  const next = document.getElementById('btn-tutorial-next');
  document.getElementById('btn-tutorial-skip').addEventListener('click', finishTutorial);
  document.getElementById('btn-tutorial-prev').addEventListener('click', () => {
    stepIndex -= 1;
    renderTutorial();
    if (stepIndex === 0) next.focus();
  });
  next.addEventListener('click', () => {
    if (stepIndex === TUTORIAL_STEPS.length - 1) {
      finishTutorial();
      return;
    }
    stepIndex += 1;
    renderTutorial();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') finishTutorial();
    if (event.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button:enabled')];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey ? event.target === first : event.target === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
  window.addEventListener('resize', positionTutorial);
  window.visualViewport?.addEventListener('resize', positionTutorial);
  subscribe((_st, keys) => {
    if (!overlay.hidden && keys.includes('lang')) renderTutorial();
  });
}
