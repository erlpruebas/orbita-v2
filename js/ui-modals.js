/**
 * ui-modals.js — Banco, configuración, sesiones, Clave de Sol y Estudio de Maqueta.
 */

import { ensureAudioUnlocked } from './audio-core.js';
import { INTERVAL_LABELS, SHORT_INTERVAL_LABELS, resolveLang, t } from './i18n.js';
import { getState, setState, subscribe } from './state.js';
import { CUSTOM_SCALE_PRESETS, getDiatonicDegrees, getNoteNameTitle, getNoteNameUpper, ROMAN_DEGREES } from './theory.js';
import { exportLooperSnapshot } from './clock-looper.js';
import { deleteSession, listSessions, loadSession, renameSession, saveCurrentSession } from './sessions.js';
import { renderHelpAccordion } from './help-content.js';
import { startTutorial } from './tutorial.js';
import { encodeShortVideo, VIDEO_STYLES } from './short-video.js';
import {
  SYNTH_PRESETS,
  getPresetById,
  playPresetPreviewOnce,
  stopPresetPreview,
  playTonicReferencePreview,
  startHumanizedVoiceGroup
} from './synth-presets.js';
import {
  ACCOMPANIMENT_PATTERNS,
  playAccompanimentPreviewOnce,
  stopAccompanimentPreview
} from './accompaniment.js';
import {
  DRUM_PATTERNS,
  playDrumPreviewOnce,
  stopDrumPreview
} from './drum-engine.js';
import {
  toggleMicrophoneCapture,
  stopMicrophoneCapture,
  clearTonalityBuffer,
  startChromaticReferenceNote,
  stopChromaticReferenceNote,
  simulateSingingScaleDemo,
  registerTonalityUIUpdater,
  computeTonalityAnalysis
} from './tonality-mic.js';
import {
  cancelDemoCountIn,
  isDemoCountIn,
  isDemoRecording,
  startDemoRecording,
  stopDemoRecording,
  getCurrentDemoSession,
  getCurrentPreviewPositionSec,
  getStudioVoicePeaks,
  isDemoPreviewPlaying,
  startDemoPreviewPlayback,
  stopDemoPreviewPlayback,
  updateLivePreviewMix,
  renderFinalMixBuffer,
  renderFinalMixWav,
  getSavedVoiceSyncMs,
  saveVoiceSyncMs,
  formatElapsedTime,
  formatPreciseTime
} from './demo-recorder.js';

const configTabs = {
  sounds: 'bank.sounds',
  accomp: 'bank.accompaniments',
  drums: 'bank.drums',
  settings: 'bank.config'
};
let activeConfigTab = 'sounds';
let previewingId = null;
let lastDetectedKeyInfo = null;
let lastTonalitySnapshot = null;
let customPreview = null;
let videoJob = null;
let videoUrl = null;
let videoStatus = null;
let videoStatusTimeout = null;
let generatedVideo = null;
let videoStyleId = VIDEO_STYLES[0];
let waveformPointerId = null;

// Estado del Estudio de Maqueta (2 pistas)
const studioMix = {
  musicVol: 0.90,
  voiceVol: 1.15,
  voiceEcho: 0,      // 0..3 LEDs cian
  voiceChorus: 0,    // 0..3 LEDs violeta
  voiceFilter: 0,
  voiceOffsetMs: -110, // Compensación de latencia en ms (negativo = adelanta la voz)
  trimStartSec: 0,
  trimEndSec: 0,
  playheadSec: null
};
let appliedVoiceOffsetMs = studioMix.voiceOffsetMs;

function stopAllPreviews() {
  customPreview?.stop(null, true);
  customPreview = null;
  stopPresetPreview();
  stopAccompanimentPreview();
  stopDrumPreview();
  previewingId = null;
}

const translate = (key, vars) => t(key, getState().lang, vars);

function setControlLabel(element, label) {
  element.title = label;
  element.setAttribute('aria-label', label);
}

function renderHeaderLabels() {
  const st = getState();
  const record = document.getElementById('btn-demo-rec');
  const recordAction = isDemoCountIn() ? 'header.recordCancel' : isDemoRecording() ? 'header.recordStop' : null;
  record.title = translate(recordAction ?? 'header.recordTitle');
  record.setAttribute('aria-label', translate(recordAction ?? 'header.record'));
  setControlLabel(document.getElementById('btn-open-sessions'), translate('header.sessions'));
  setControlLabel(document.getElementById('btn-open-config'), translate('header.config'));
  setControlLabel(document.getElementById('btn-open-tonality'), translate('header.tonality'));
  setControlLabel(document.getElementById('btn-yaxis'), `${translate('header.yAxis')} · ${translate(`header.yAxis.${st.yAxisMode}`)}`);
  setControlLabel(document.getElementById('btn-keystrike'), translate(st.keyStrike ? 'header.keyStrike' : 'header.pureGate'));
  const mode = st.scaleMode === 'custom' ? translate('custom.title') : translate(`custom.quality.${st.scaleMode}`);
  setControlLabel(document.getElementById('btn-scale-mode'), translate('deck.scaleMode', { mode }));
}

export function applyI18nToDOM() {
  const { lang } = getState();
  document.documentElement.lang = resolveLang(lang);
  document.title = t('header.app', lang);
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n, lang); });
  for (const [attr, dataset] of [['aria-label', 'i18nAria'], ['title', 'i18nTitle'], ['placeholder', 'i18nPlaceholder']]) {
    const suffix = attr === 'aria-label' ? 'aria' : attr;
    document.querySelectorAll(`[data-i18n-${suffix}]`).forEach(el => el.setAttribute(attr, t(el.dataset[dataset], lang)));
  }
  renderHeaderLabels();
  updateTonalityModalDOM(lastTonalitySnapshot ?? { isListening: false });
  setPreviewPlayBtnState(isDemoPreviewPlaying());
  renderStudioWarning(getCurrentDemoSession());
  renderDemoExportLabels();
  renderVideoStatus();
  updateVoiceFilterLabel();
}

function initCustomEditor() {
  const presets = document.getElementById('custom-scale-presets');
  for (const preset of CUSTOM_SCALE_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hw-btn settings-btn';
    button.addEventListener('click', () => setState({
      customScale: preset.degrees, customPresetId: preset.id, scaleMode: 'custom'
    }));
    presets.append(button);
  }

  for (const row of document.getElementById('custom-scale-editor').children) {
    for (const index of row.dataset.degrees.split(' ').map(Number)) {
      const key = document.createElement('div');
      key.className = 'custom-degree';
      key.dataset.degree = index;
      key.setAttribute('role', 'group');
      key.innerHTML = `
        <div class="custom-key-display">
          <span class="custom-roman">${ROMAN_DEGREES[index]}</span>
          <strong class="custom-chord"></strong>
          <span class="custom-interval"></span>
        </div>
        <div class="custom-key-controls">
          <button type="button" class="hw-btn settings-btn" data-interval-delta="1">▲</button>
          <button type="button" class="hw-btn settings-btn" data-interval-delta="-1">▼</button>
          <button type="button" class="hw-btn settings-btn custom-quality-btn"></button>
          <button type="button" class="hw-btn settings-btn custom-preview-btn">▶</button>
        </div>`;
      const updateDegree = patch => {
        const customScale = getState().customScale.slice();
        customScale[index] = { ...customScale[index], ...patch };
        setState({ customScale, scaleMode: 'custom' });
      };
      key.querySelectorAll('[data-interval-delta]').forEach(button => button.addEventListener('click', () => {
        const { semitones } = getState().customScale[index];
        updateDegree({ semitones: (semitones + Number(button.dataset.intervalDelta) + 12) % 12 });
      }));
      key.querySelector('.custom-quality-btn').addEventListener('click', () => {
        const { quality } = getState().customScale[index];
        updateDegree({ quality: quality === 'M' ? 'm' : 'M' });
      });
      key.querySelector('.custom-preview-btn').addEventListener('click', () => {
        stopAllPreviews();
        updateDegree();
        const st = getState();
        const degree = getDiatonicDegrees(st.rootSemitone, st.scaleMode, st.octaveOffset, st.customScale, st.notation)[index];
        customPreview = startHumanizedVoiceGroup(degree.triadMidi, { humanize: 0, duration: 0.45, velocity: 0.9 });
      });
      row.append(key);
    }
  }
}

function renderSettings(st) {
  const lang = resolveLang(st.lang);
  const active = st.scaleMode === 'custom';
  const modePill = document.getElementById('custom-mode-status');
  modePill.textContent = translate(active ? 'custom.active' : 'custom.inactive');
  modePill.classList.toggle('is-engaged', active);
  const activate = document.getElementById('btn-activate-custom-mode');
  activate.setAttribute('aria-disabled', String(active));

  const presets = document.getElementById('custom-scale-presets');
  CUSTOM_SCALE_PRESETS.forEach((preset, i) => {
    const button = presets.children[i];
    const key = `custom.presets.${preset.id}`;
    button.textContent = translate(`${key}.name`);
    button.title = translate(`${key}.description`);
    const selected = active && preset.degrees.every(({ semitones, quality }, index) =>
      st.customScale[index].semitones === semitones && st.customScale[index].quality === quality);
    button.setAttribute('aria-pressed', String(selected));
  });

  const degrees = getDiatonicDegrees(st.rootSemitone, 'custom', st.octaveOffset, st.customScale, st.notation);
  for (const key of document.querySelectorAll('#custom-scale-editor .custom-degree')) {
    const degree = degrees[key.dataset.degree];
    key.setAttribute('aria-label', translate('custom.degree', { roman: degree.roman }));
    const interval = key.querySelector('.custom-interval');
    interval.textContent = `${degree.intervalRoman} · ${SHORT_INTERVAL_LABELS[lang][degree.intervalSemitones]}`;
    interval.title = INTERVAL_LABELS[lang][degree.intervalSemitones];
    key.querySelector('.custom-chord').textContent = degree.chordLabel;
    setControlLabel(key.querySelector('[data-interval-delta="-1"]'), translate('custom.intervalDown'));
    setControlLabel(key.querySelector('[data-interval-delta="1"]'), translate('custom.intervalUp'));
    const quality = key.querySelector('.custom-quality-btn');
    quality.textContent = quality.dataset.quality = degree.quality;
    setControlLabel(quality, translate('custom.toggleQuality', { quality: translate(`custom.quality.${degree.quality}`) }));
    setControlLabel(key.querySelector('.custom-preview-btn'), translate('custom.previewDegree', { roman: degree.roman }));
  }

  const settings = document.getElementById('config-settings');
  for (const key of ['lang', 'notation']) {
    settings.querySelectorAll(`[data-${key}]`).forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset[key] === st[key]));
    });
  }
  const camera = document.getElementById('btn-config-camera');
  camera.setAttribute('aria-pressed', String(st.cameraEnabled));
  camera.title = translate(st.cameraEnabled ? 'config.camera.on' : 'config.camera.off');
  document.getElementById('config-camera-status').textContent = st.cameraEnabled ? 'ON' : 'OFF';
  document.getElementById('config-camera-led').classList.toggle('on-emerald', st.cameraEnabled);

  const help = document.getElementById('help-accordion');
  if (help.dataset.renderedLang !== lang) {
    help.dataset.renderedLang = lang;
    renderHelpAccordion(help, lang);
  }
}

function triggerBlobDownload(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 400);
}

/**
 * Renderiza la lista de 50 sonidos, 50 acompañamientos o 50 baterías con sus huecos numerados 1..9
 */
export function renderConfigModalList() {
  const listEl = document.getElementById('config-list-container');
  if (!listEl) return;

  const st = getState();
  const { lang } = st;
  const settingsOpen = activeConfigTab === 'settings';
  for (const [tab, key] of Object.entries(configTabs)) {
    const button = document.getElementById(`tab-btn-${tab}`);
    const label = t(key, lang);
    button.classList.toggle('is-active', tab === activeConfigTab);
    button.setAttribute('aria-pressed', String(tab === activeConfigTab));
    button.querySelector('span').textContent = label;
  }
  document.querySelector('#modal-config-title span').textContent = t('bank.title', lang);
  document.getElementById('btn-close-config').setAttribute('aria-label', t('common.close', lang));
  document.getElementById('config-toolbar').hidden = settingsOpen;
  document.getElementById('config-settings').hidden = !settingsOpen;
  listEl.hidden = settingsOpen;
  if (settingsOpen) {
    renderSettings(st);
    return;
  }

  let catalog = SYNTH_PRESETS;
  let selectedList = st.selectedSounds;

  if (activeConfigTab === 'accomp') {
    catalog = ACCOMPANIMENT_PATTERNS;
    selectedList = st.selectedAccompaniments;
  } else if (activeConfigTab === 'drums') {
    catalog = DRUM_PATTERNS;
    selectedList = st.selectedDrums;
  }

  document.getElementById('config-slots-hint').textContent = t('bank.slotsHint', lang);
  document.getElementById('config-slots-count').textContent = t('bank.slotCount', lang, { count: selectedList.length, max: 9 });

  listEl.innerHTML = '';

  catalog.forEach((item) => {
    const slotIdx = selectedList.indexOf(item.id);
    const isSelected = slotIdx !== -1;
    const slotNumber = isSelected ? (slotIdx + 1) : '';
    const isPreviewing = previewingId === `${activeConfigTab}_${item.id}`;

    const row = document.createElement('div');
    row.className = `bank-item${isSelected ? ' is-selected' : ''}`;

    const slotBtn = document.createElement('button');
    slotBtn.type = 'button';
    slotBtn.className = 'bank-slot-btn';
    slotBtn.textContent = isSelected ? String(slotNumber) : '·';
    slotBtn.title = isSelected ? t('bank.releaseSlot', lang, { number: slotNumber }) : t('bank.assignSlot', lang);

    const toggleSelection = () => {
      ensureAudioUnlocked();
      const stateNow = getState();
      const sourceArr = activeConfigTab === 'sounds'
        ? stateNow.selectedSounds
        : (activeConfigTab === 'accomp' ? stateNow.selectedAccompaniments : stateNow.selectedDrums);
      const curList = [...sourceArr];
      const existingIdx = curList.indexOf(item.id);

      if (existingIdx !== -1) {
        if (curList.length <= 1) return;
        curList.splice(existingIdx, 1);
      } else {
        if (curList.length >= 9) {
          curList[8] = item.id;
        } else {
          curList.push(item.id);
        }
      }

      if (activeConfigTab === 'sounds') {
        const nextActive = Math.min(stateNow.activeSoundSlot, curList.length - 1);
        setState({ selectedSounds: curList, activeSoundSlot: nextActive });
      } else if (activeConfigTab === 'accomp') {
        const nextAccomp = stateNow.accompaniment > curList.length ? curList.length : stateNow.accompaniment;
        setState({ selectedAccompaniments: curList, accompaniment: nextAccomp });
      } else {
        const nextActive = Math.min(stateNow.activeDrumSlot, curList.length - 1);
        setState({ selectedDrums: curList, activeDrumSlot: nextActive });
      }
      renderConfigModalList();
    };

    slotBtn.addEventListener('click', toggleSelection);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'bank-info';
    infoDiv.innerHTML = `
      <div class="bank-name">${String(item.id + 1).padStart(2, '0')} · ${item.name}</div>
      <div class="bank-meta">${item.category || ''}</div>
    `;
    infoDiv.addEventListener('click', toggleSelection);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = `bank-preview-btn${isPreviewing ? ' is-previewing' : ''}`;
    prevBtn.title = t('bank.preview', lang);
    prevBtn.innerHTML = `<svg viewBox="0 0 24 24"><use href="#icon-play"></use></svg>`;

    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAudioUnlocked();
      const key = `${activeConfigTab}_${item.id}`;

      stopAllPreviews();

      if (activeConfigTab === 'sounds') {
        playPresetPreviewOnce(item.id, (_id, active) => {
          previewingId = active ? key : null;
          renderConfigModalList();
        });
      } else if (activeConfigTab === 'accomp') {
        playAccompanimentPreviewOnce(item.id, (_id, active) => {
          previewingId = active ? key : null;
          renderConfigModalList();
        });
      } else {
        playDrumPreviewOnce(item.id, (_id, active) => {
          previewingId = active ? key : null;
          renderConfigModalList();
        });
      }
    });

    row.appendChild(slotBtn);
    row.appendChild(infoDiv);
    row.appendChild(prevBtn);
    listEl.appendChild(row);
  });
}

function openConfigModalToTab(tabName) {
  ensureAudioUnlocked();
  stopAllPreviews();
  activeConfigTab = tabName || 'sounds';
  renderConfigModalList();
  const modalConfig = document.getElementById('modal-config');
  if (modalConfig) modalConfig.hidden = false;
}

let sessionFeedbackTimer;

function showSessionFeedback(key, name, toast = false) {
  clearTimeout(sessionFeedbackTimer);
  const chassisToast = document.getElementById('session-toast');
  const modalFeedback = document.getElementById('sessions-feedback');
  const [element, other] = toast ? [chassisToast, modalFeedback] : [modalFeedback, chassisToast];
  other.hidden = true;
  element.textContent = translate(key, { name });
  element.hidden = false;
  sessionFeedbackTimer = setTimeout(() => { element.hidden = true; }, 2600);
}

function renderSessionLoopPill() {
  const bars = exportLooperSnapshot()?.loopBars;
  const pill = document.getElementById('session-loop-pill');
  pill.textContent = translate(bars ? 'sessions.loop' : 'sessions.noLoop', { bars });
  pill.classList.toggle('is-engaged', Boolean(bars));
}

function makeSessionButton(key, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hw-btn settings-btn';
  button.textContent = translate(key);
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function editSessionInline(actions, session, rename, trigger) {
  const form = document.createElement('form');
  form.className = 'session-inline-form';
  const field = document.createElement(rename ? 'input' : 'span');
  if (rename) {
    field.type = 'text';
    field.maxLength = 48;
    field.value = session.name;
    field.setAttribute('aria-label', translate('sessions.name'));
  } else {
    field.textContent = translate('sessions.confirmDelete', { name: session.name });
  }
  const confirm = makeSessionButton(rename ? 'common.save' : 'sessions.deleteAction');
  confirm.type = 'submit';
  const cancel = () => { form.remove(); actions.hidden = false; trigger.focus(); };
  form.append(field, confirm, makeSessionButton('common.cancel', cancel));
  form.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const result = rename ? renameSession(session.id, field.value) : deleteSession(session.id);
      if (!result) throw new Error('Session unavailable');
      renderSessionsList();
      document.getElementById('session-name-input').focus({ preventScroll: true });
    } catch (_) {
      showSessionFeedback('sessions.storageError');
    }
  });
  actions.after(form);
  actions.hidden = true;
  if (rename) {
    field.focus();
    field.select();
  } else {
    form.lastElementChild.focus();
  }
}

function renderSessionsList() {
  const list = document.getElementById('sessions-list-container');
  const sessions = listSessions();
  const { notation } = getState();
  renderSessionLoopPill();
  list.replaceChildren();
  if (!sessions.length) {
    const empty = document.createElement('p');
    empty.className = 'sessions-empty';
    empty.textContent = translate('sessions.empty');
    list.append(empty);
    return;
  }
  for (const session of sessions) {
    const card = document.createElement('article');
    card.className = 'session-item';
    const title = document.createElement('h2');
    title.textContent = session.name;
    const meta = document.createElement('p');
    meta.className = 'session-meta';
    const sound = getPresetById(session.selectedSounds?.[session.activeSoundSlot ?? 0]);
    const mode = session.scaleMode === 'custom' ? '🔧' : session.scaleMode === 'm' ? 'm' : 'M';
    meta.textContent = `${getNoteNameUpper(session.rootSemitone, notation)} ${mode} · ${session.bpm ?? 92} BPM · ${sound.name}`;
    const bars = session.looperSnapshot?.loopBars;
    if (bars) {
      const badge = document.createElement('span');
      badge.className = 'settings-pill is-engaged';
      badge.textContent = translate('sessions.loopBadge', { bars });
      meta.append(' ', badge);
    }
    const actions = document.createElement('div');
    actions.className = 'session-actions';
    const open = makeSessionButton('sessions.openAction', () => {
      ensureAudioUnlocked();
      try {
        const loaded = loadSession(session.id);
        if (!loaded) throw new Error('Session unavailable');
        closeSessions();
        showSessionFeedback('sessions.loaded', loaded.name, true);
      } catch (_) {
        showSessionFeedback('sessions.storageError');
      }
    });
    const rename = makeSessionButton('sessions.renameAction', () => editSessionInline(actions, session, true, rename));
    const remove = makeSessionButton('sessions.deleteAction', () => editSessionInline(actions, session, false, remove));
    remove.classList.add('is-danger');
    actions.append(open, rename, remove);
    card.append(title, meta, actions);
    list.append(card);
  }
}

function closeSessions() {
  document.getElementById('modal-sessions').hidden = true;
  document.getElementById('btn-open-sessions').focus({ preventScroll: true });
}

function initSessionsModal() {
  const modal = document.getElementById('modal-sessions');
  document.getElementById('btn-open-sessions').addEventListener('click', () => {
    document.getElementById('sessions-feedback').hidden = true;
    document.getElementById('session-toast').hidden = true;
    renderSessionsList();
    modal.hidden = false;
    document.getElementById('btn-close-sessions').focus({ preventScroll: true });
  });
  document.getElementById('btn-close-sessions').addEventListener('click', closeSessions);
  modal.addEventListener('click', event => { if (event.target === modal) closeSessions(); });
  document.getElementById('session-save-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('session-name-input');
    try {
      const saved = saveCurrentSession(input.value);
      if (!saved) throw new Error('Session unavailable');
      input.value = '';
      renderSessionsList();
      showSessionFeedback('sessions.saved', saved.name);
    } catch (_) {
      showSessionFeedback('sessions.storageError');
    }
  });
  subscribe((_state, keys) => {
    if (modal.hidden) return;
    if (keys.includes('lang') || keys.includes('notation')) renderSessionsList();
    else if (keys.includes('loopBars') || keys.includes('looperState')) renderSessionLoopPill();
  });
}

/**
 * Actualiza el DOM del Detector de Tonalidad (Clave de Sol)
 */
function updateTonalityModalDOM(snapshot) {
  lastTonalitySnapshot = snapshot;
  const micBtn = document.getElementById('btn-mic-toggle');
  const micLabel = document.getElementById('mic-btn-label');
  if (micBtn) micBtn.classList.toggle('is-listening', Boolean(snapshot.isListening));
  if (micLabel) micLabel.textContent = translate(snapshot.isListening ? 'tonality.micStop' : 'tonality.micOpen');

  const { notation } = getState();
  const liveBadge = document.getElementById('live-pitch-badge');
  if (liveBadge) {
    if (snapshot.errorKey) {
      liveBadge.textContent = translate(snapshot.errorKey);
    } else if (snapshot.livePitch) {
      const sign = snapshot.livePitch.centsOff >= 0 ? `+${snapshot.livePitch.centsOff}` : snapshot.livePitch.centsOff;
      const note = getNoteNameTitle(snapshot.livePitch.pitchClass, notation);
      liveBadge.textContent = `${note} · ${snapshot.livePitch.freq} Hz (${sign}c)`;
    } else {
      liveBadge.textContent = translate(snapshot.isListening ? 'tonality.listeningHint' : 'tonality.micPaused');
    }
  }

  const timeBadge = document.getElementById('buffer-time-badge');
  const progFill = document.getElementById('buffer-progress-fill');
  const sec = snapshot.elapsedWindowSec || 0;
  if (timeBadge) timeBadge.textContent = `${sec.toFixed(1)}s / 20s`;
  if (progFill) progFill.style.width = `${Math.min(100, (sec / 20) * 100).toFixed(1)}%`;

  const keys = document.querySelectorAll('.chromatic-keyboard [data-pc]');
  keys.forEach((keyEl) => {
    const pc = Number(keyEl.dataset.pc);
    const heat = snapshot.heatLevels ? (snapshot.heatLevels[pc] || 0) : 0;
    const pct = snapshot.normPercentages ? (snapshot.normPercentages[pc] || 0) : 0;
    keyEl.setAttribute('data-heat', String(heat));
    const bar = keyEl.querySelector('.chrom-heat-bar');
    if (bar) bar.style.height = `${pct}%`;
    const label = keyEl.querySelector('.chrom-key-label');
    if (label) label.textContent = getNoteNameTitle(pc, notation);
  });

  const keyValEl = document.getElementById('detected-key-value');
  const btnApplyMaj = document.getElementById('btn-apply-major');
  const btnApplyMin = document.getElementById('btn-apply-minor');

  if (snapshot.detected) {
    lastDetectedKeyInfo = snapshot.detected;
    const major = `${getNoteNameTitle(snapshot.detected.majorRoot, notation)} M`;
    const minor = `${getNoteNameTitle(snapshot.detected.minorRoot, notation)} m`;
    if (keyValEl) keyValEl.textContent = `${major} / ${minor}`;
    if (btnApplyMaj) {
      btnApplyMaj.disabled = false;
      btnApplyMaj.textContent = translate('tonality.applyKey', { key: `${getNoteNameUpper(snapshot.detected.majorRoot, notation)} M` });
    }
    if (btnApplyMin) {
      btnApplyMin.disabled = false;
      btnApplyMin.textContent = translate('tonality.applyKey', { key: `${getNoteNameUpper(snapshot.detected.minorRoot, notation)} m` });
    }
  } else {
    lastDetectedKeyInfo = null;
    if (keyValEl) keyValEl.textContent = '— / —';
    if (btnApplyMaj) {
      btnApplyMaj.disabled = true;
      btnApplyMaj.textContent = translate('tonality.applyMajor');
    }
    if (btnApplyMin) {
      btnApplyMin.disabled = true;
      btnApplyMin.textContent = translate('tonality.applyMinor');
    }
  }
}

/**
 * =====================================================================
 * SERVICIO 3: ESTUDIO DE MAQUETA (2 PISTAS: MÚSICA + VOZ, FX Y RECORTE)
 * =====================================================================
 */
function drawTwoTrackWaveform() {
  const canvas = document.getElementById('demo-waveform-canvas');
  const session = getCurrentDemoSession();
  if (!canvas || !session) return;

  const ctx2d = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);

  // Fondo OLED
  ctx2d.fillStyle = '#07080a';
  ctx2d.fillRect(0, 0, w, h);

  // Línea central sutil
  ctx2d.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx2d.beginPath();
  ctx2d.moveTo(0, h / 2);
  ctx2d.lineTo(w, h / 2);
  ctx2d.stroke();

  const bins = session.musicPeaks.length;
  const barW = w / bins;

  // Pista 1: Música (mitad superior / esmeralda)
  ctx2d.fillStyle = 'rgba(16, 185, 129, 0.78)';
  for (let i = 0; i < bins; i++) {
    const val = Math.min(1, session.musicPeaks[i] * 1.4);
    const barH = Math.max(1.5, val * (h * 0.44));
    ctx2d.fillRect(i * barW, h / 2 - barH, Math.max(1, barW - 0.6), barH);
  }

  // Pista 2: Voz (mitad inferior / ámbar), desplazada visualmente según `voiceOffsetMs`
  // para poder ver los picos vocales alineándose exactamente bajo los golpes de batería
  const voicePeaks = getStudioVoicePeaks({ voiceFilter: studioMix.voiceFilter, voiceOffsetMs: appliedVoiceOffsetMs });
  if (voicePeaks) {
    const shiftSec = (studioMix.voiceOffsetMs || 0) / 1000;
    const shiftBins = Math.round((shiftSec / Math.max(0.01, session.durationSec)) * bins);
    ctx2d.fillStyle = 'rgba(245, 158, 11, 0.85)';
    for (let i = 0; i < bins; i++) {
      // shiftBins negativo = adelantar la voz -> leemos muestras más adelante (i - shiftBins)
      const srcIdx = i - shiftBins;
      if (srcIdx < 0 || srcIdx >= bins) continue;
      const val = Math.min(1, voicePeaks[srcIdx] * 1.6);
      const barH = val * (h * 0.44);
      ctx2d.fillRect(i * barW, h / 2, Math.max(1, barW - 0.6), barH);
    }
  }

  // Cortinas oscuras en las zonas recortadas (Inicio y Final)
  const dur = Math.max(0.01, session.durationSec);
  const startX = (studioMix.trimStartSec / dur) * w;
  const endX = (studioMix.trimEndSec / dur) * w;

  ctx2d.fillStyle = 'rgba(5, 6, 8, 0.72)';
  if (startX > 0) ctx2d.fillRect(0, 0, startX, h);
  if (endX < w) ctx2d.fillRect(endX, 0, w - endX, h);

  // Marcadores de recorte Inicio y Final en cian
  ctx2d.strokeStyle = '#22d3ee';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.moveTo(startX, 0);
  ctx2d.lineTo(startX, h);
  ctx2d.moveTo(endX, 0);
  ctx2d.lineTo(endX, h);
  ctx2d.stroke();

  // Cabezal de reproducción en vivo
  const { playheadSec } = studioMix;
  const selectedSec = playheadSec ?? studioMix.trimStartSec;
  canvas.setAttribute('aria-valuenow', String(Number(selectedSec.toFixed(2))));
  const timeLabel = formatPreciseTime(selectedSec);
  canvas.setAttribute('aria-valuetext', timeLabel);
  if (playheadSec !== null) {
    const px = Math.max(1, Math.min(w - 1, (playheadSec / dur) * w));
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(px, 0);
    ctx2d.lineTo(px, h);
    ctx2d.stroke();
    ctx2d.fillStyle = '#ffffff';
    ctx2d.beginPath();
    ctx2d.moveTo(px - 6, 0);
    ctx2d.lineTo(px + 6, 0);
    ctx2d.lineTo(px, 8);
    ctx2d.fill();
    ctx2d.font = '700 14px monospace';
    const labelWidth = ctx2d.measureText(timeLabel).width + 8;
    const labelX = px + labelWidth + 8 < w ? px + 7 : px - labelWidth - 7;
    ctx2d.fillStyle = '#07080a';
    ctx2d.fillRect(labelX, 4, labelWidth, 18);
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fillText(timeLabel, labelX + 4, 17);
  }
}

function updateStudioControlsDOM() {
  const session = getCurrentDemoSession();
  if (!session) return;

  const trimReadout = document.getElementById('studio-trim-readout');
  const startValEl = document.getElementById('trim-start-val');
  const endValEl = document.getElementById('trim-end-val');
  const trimmedDur = studioMix.trimEndSec - studioMix.trimStartSec;

  if (startValEl) startValEl.textContent = formatPreciseTime(studioMix.trimStartSec);
  if (endValEl) endValEl.textContent = formatPreciseTime(studioMix.trimEndSec);
  if (trimReadout) {
    trimReadout.textContent = `${formatPreciseTime(studioMix.trimStartSec)} — ${formatPreciseTime(studioMix.trimEndSec)} (${formatPreciseTime(trimmedDur)})`;
  }

  const mVal = document.getElementById('mix-music-val');
  const vVal = document.getElementById('mix-voice-val');
  const syncVal = document.getElementById('mix-sync-val');
  const syncSlider = document.getElementById('mix-voice-sync');
  if (mVal) mVal.textContent = `${Math.round(studioMix.musicVol * 100)}%`;
  if (vVal) vVal.textContent = `${Math.round(studioMix.voiceVol * 100)}%`;
  if (syncVal) {
    const ms = Math.round(studioMix.voiceOffsetMs || 0);
    syncVal.textContent = `${ms > 0 ? '+' : ''}${ms}ms`;
  }
  if (syncSlider) {
    syncSlider.value = String(Math.round(studioMix.voiceOffsetMs || 0));
  }

  // LEDs de Eco (0..3 cian)
  for (let i = 1; i <= 3; i++) {
    const led = document.getElementById(`echo-led-${i}`);
    if (led) led.classList.toggle('on-cyan', studioMix.voiceEcho >= i);
  }
  // LEDs de Chorus (0..3 violeta)
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`chorus-led-${i}`).classList.toggle('on-violet', studioMix.voiceChorus >= i);
    document.getElementById(`filter-led-${i}`).classList.toggle('on-emerald', studioMix.voiceFilter >= i);
  }

  updateVoiceFilterLabel();
  const canvas = document.getElementById('demo-waveform-canvas');
  canvas.setAttribute('aria-valuemin', String(studioMix.trimStartSec));
  canvas.setAttribute('aria-valuemax', String(studioMix.trimEndSec));
  drawTwoTrackWaveform();
}

function updateVoiceFilterLabel() {
  document.getElementById('btn-voice-filter').setAttribute('aria-label',
    translate('studio.filterLevel', { level: studioMix.voiceFilter }));
}

function clampStudioSeek(sec) {
  const { trimStartSec: start, trimEndSec: end } = studioMix;
  return Math.max(start, Math.min(Math.max(start, end - 0.05), sec));
}

function playStudioMix(seekStartSec = null) {
  const ok = startDemoPreviewPlayback(studioMix, posSec => {
    if (waveformPointerId !== null) return;
    studioMix.playheadSec = posSec;
    drawTwoTrackWaveform();
  }, () => {
    setPreviewPlayBtnState(false);
    drawTwoTrackWaveform();
  }, seekStartSec);
  if (ok) {
    studioMix.playheadSec = clampStudioSeek(seekStartSec ?? studioMix.trimStartSec);
    drawTwoTrackWaveform();
    setPreviewPlayBtnState(true);
  }
}

function setPreviewPlayBtnState(playing) {
  const btn = document.getElementById('btn-demo-preview-play');
  const lbl = document.getElementById('demo-preview-label');
  if (btn) {
    btn.classList.toggle('is-playing', playing);
    const useEl = btn.querySelector('use');
    if (useEl) useEl.setAttribute('href', playing ? '#icon-stop' : '#icon-play');
  }
  if (lbl) lbl.textContent = translate(playing ? 'studio.stopPreview' : 'studio.preview');
}

function renderStudioWarning(session) {
  const warning = document.getElementById('demo-result-warning');
  const messages = [];
  if (session && !session.hasVoiceTrack) {
    let key = 'studio.noVoice';
    if (session.micWarning?.startsWith('Permiso')) key = 'studio.noVoiceDenied';
    if (session.micWarning?.startsWith('Sin HTTPS')) key = 'studio.noVoiceSecure';
    messages.push(translate(key));
  }
  if (session?.cameraUnavailable) messages.push(translate('studio.video.cameraError'));
  warning.hidden = messages.length === 0;
  warning.textContent = messages.join(' ');
}

function renderDemoExportLabels() {
  const exportButton = document.getElementById('btn-download-demo-wav');
  const shareButton = document.getElementById('btn-share-demo');
  exportButton.textContent = translate(exportButton.disabled ? 'studio.exporting' : 'studio.export');
  shareButton.textContent = translate(shareButton.disabled ? 'studio.sharing' : 'studio.share');
}

function renderVideoStatus() {
  const status = document.getElementById('demo-video-status');
  const progress = document.getElementById('demo-video-progress');
  status.hidden = !videoStatus;
  status.textContent = videoStatus ? translate(videoStatus.key, { percent: videoStatus.percent }) : '';
  progress.hidden = videoStatus?.key !== 'studio.video.creating';
  progress.value = videoStatus?.percent ?? 0;
}

function resetDemoVideo() {
  videoJob?.abort();
  videoJob = null;
  clearTimeout(videoStatusTimeout);
  generatedVideo = null;
  videoStatus = null;
  renderVideoStatus();
  const preview = document.getElementById('demo-video-preview');
  const download = document.getElementById('demo-video-download');
  preview.pause();
  preview.removeAttribute('src');
  preview.load();
  preview.hidden = true;
  download.removeAttribute('href');
  document.getElementById('demo-video-actions').hidden = true;
  document.getElementById('btn-create-demo-video').disabled = false;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
}

function selectVideoStyle(styleId) {
  if (!VIDEO_STYLES.includes(styleId)) return;
  videoStyleId = styleId;
  document.getElementById('video-style-grid').querySelectorAll('[data-video-style]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.videoStyle === styleId));
  });
}

async function createDemoVideo(event) {
  const session = getCurrentDemoSession();
  if (!session) return;
  resetDemoVideo();
  stopDemoPreviewPlayback();
  ensureAudioUnlocked();
  const button = event.currentTarget;
  const title = document.getElementById('demo-video-title-input').value.trim().slice(0, 40);
  const meta = { ...session.videoMetadata, title, styleId: videoStyleId, hasCamera: Boolean(session.cameraBlob) };
  const job = new AbortController();
  videoJob = job;
  button.disabled = true;
  videoStatus = { key: 'studio.video.creating', percent: 0 };
  renderVideoStatus();
  try {
    const mix = await renderFinalMixBuffer({ ...studioMix });
    job.signal.throwIfAborted();
    const trimEnd = mix.trimStart + mix.trimmedDur;
    const noteEvents = [];
    for (const event of session.noteEvents) {
      const start = Math.max(mix.trimStart, event.timeSec);
      const end = Math.min(trimEnd, event.timeSec + event.durationSec);
      if (end > start) noteEvents.push({
        ...event,
        timeSec: start - mix.trimStart,
        durationSec: end - start,
        continued: event.timeSec < mix.trimStart
      });
    }
    const output = await encodeShortVideo(mix, session.cameraBlob, percent => {
      if (videoJob === job && videoStatus?.percent !== percent) {
        videoStatus = { key: 'studio.video.creating', percent };
        renderVideoStatus();
      }
    }, job.signal, { ...meta, noteEvents, keyboardDegrees: session.keyboardDegrees });
    job.signal.throwIfAborted();
    const preview = document.getElementById('demo-video-preview');
    const download = document.getElementById('demo-video-download');
    const file = new File([output.blob], output.filename, { type: output.mimeType });
    generatedVideo = { file, title };
    videoUrl = URL.createObjectURL(output.blob);
    preview.src = videoUrl;
    download.href = videoUrl;
    download.download = output.filename;
    preview.hidden = false;
    document.getElementById('demo-video-actions').hidden = false;
    videoStatus = null;
  } catch (_) {
    if (!job.signal.aborted) videoStatus = { key: 'studio.video.error' };
  } finally {
    if (videoJob === job) {
      videoJob = null;
      button.disabled = false;
      renderVideoStatus();
    }
  }
}

async function shareDemoVideo() {
  const video = generatedVideo;
  if (!video) return;
  const files = [video.file];
  let canShare = false;
  try {
    canShare = typeof navigator.share === 'function' && navigator.canShare?.({ files });
  } catch (_) {}

  clearTimeout(videoStatusTimeout);
  videoStatus = null;
  renderVideoStatus();
  if (canShare) {
    try {
      await navigator.share({
        title: video.title || translate('studio.video.shareTitle'),
        text: translate('studio.video.shareText'),
        files
      });
      return;
    } catch (error) {
      if (generatedVideo !== video || error?.name === 'AbortError') return;
      if (error?.name !== 'NotSupportedError' && error?.name !== 'TypeError') {
        videoStatus = { key: 'studio.video.shareError' };
        renderVideoStatus();
        return;
      }
    }
  }

  document.getElementById('demo-video-download').click();
  videoStatus = { key: 'studio.video.shareDownload' };
  renderVideoStatus();
  videoStatusTimeout = setTimeout(() => {
    videoStatus = null;
    renderVideoStatus();
  }, 5000);
}

function openDemoStudioModal(session) {
  const modal = document.getElementById('modal-demo-result');
  const voiceRow = document.getElementById('mix-voice-row');
  const syncRow = document.getElementById('mix-sync-row');
  const btnEcho = document.getElementById('btn-voice-echo');
  const btnChorus = document.getElementById('btn-voice-chorus');
  const startRange = document.getElementById('trim-start-range');
  const endRange = document.getElementById('trim-end-range');
  const musicSlider = document.getElementById('mix-music-vol');
  const voiceSlider = document.getElementById('mix-voice-vol');
  const btnShare = document.getElementById('btn-share-demo');

  if (!modal || !session) return;
  resetDemoVideo();
  selectVideoStyle(VIDEO_STYLES[0]);
  document.getElementById('demo-video-title-input').value = '';

  // Inicializar parámetros del estudio usando la compensación de latencia medida o la calibración guardada
  studioMix.musicVol = 0.90;
  studioMix.voiceVol = 1.15;
  studioMix.voiceEcho = 0;
  studioMix.voiceChorus = 0;
  studioMix.voiceFilter = 0;
  studioMix.voiceOffsetMs = getSavedVoiceSyncMs(session.autoMeasuredOffsetMs ?? -110);
  appliedVoiceOffsetMs = studioMix.voiceOffsetMs;
  studioMix.trimStartSec = 0;
  studioMix.trimEndSec = session.durationSec;
  studioMix.playheadSec = null;
  waveformPointerId = null;

  if (startRange) startRange.value = '0';
  if (endRange) endRange.value = '1000';
  if (musicSlider) musicSlider.value = '90';
  if (voiceSlider) voiceSlider.value = '115';

  if (voiceRow) voiceRow.classList.toggle('is-disabled', !session.hasVoiceTrack);
  if (syncRow) syncRow.classList.toggle('is-disabled', !session.hasVoiceTrack);
  if (btnEcho) btnEcho.disabled = !session.hasVoiceTrack;
  if (btnChorus) btnChorus.disabled = !session.hasVoiceTrack;
  document.getElementById('btn-voice-filter').disabled = !session.hasVoiceTrack;

  renderStudioWarning(session);

  if (btnShare) {
    const canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    btnShare.hidden = !canShare;
  }

  setPreviewPlayBtnState(false);
  updateStudioControlsDOM();
  modal.hidden = false;
}

export function initModalsUI() {
  const modalConfig = document.getElementById('modal-config');
  const modalTonality = document.getElementById('modal-tonality');
  const modalDemo = document.getElementById('modal-demo-result');
  initCustomEditor();
  initSessionsModal();

  // --- ACCESO DIRECTO DESDE LA BARRA OLED ESTÁTICA ---
  document.getElementById('status-pill-sound')?.addEventListener('click', () => openConfigModalToTab('sounds'));
  document.getElementById('status-pill-accomp')?.addEventListener('click', () => openConfigModalToTab('accomp'));
  document.getElementById('status-pill-drum')?.addEventListener('click', () => openConfigModalToTab('drums'));

  // --- SERVICIO 1: CONFIGURACIÓN (50 -> 9) ---
  document.getElementById('btn-open-config')?.addEventListener('click', () => openConfigModalToTab(activeConfigTab));
  document.getElementById('btn-close-config')?.addEventListener('click', () => {
    stopAllPreviews();
    if (modalConfig) modalConfig.hidden = true;
  });

  for (const tab of Object.keys(configTabs)) {
    document.getElementById(`tab-btn-${tab}`)?.addEventListener('click', () => {
      stopAllPreviews();
      activeConfigTab = tab;
      renderConfigModalList();
    });
  }
  document.getElementById('btn-config-camera')?.addEventListener('click', () => {
    setState({ cameraEnabled: !getState().cameraEnabled });
  });
  document.getElementById('btn-activate-custom-mode').addEventListener('click', () => setState({ scaleMode: 'custom' }));
  const settings = document.getElementById('config-settings');
  for (const key of ['lang', 'notation']) {
    settings.querySelectorAll(`[data-${key}]`).forEach(button => {
      button.addEventListener('click', () => setState({ [key]: button.dataset[key] }));
    });
  }
  document.getElementById('btn-launch-tutorial').addEventListener('click', () => {
    stopAllPreviews();
    modalConfig.hidden = true;
    startTutorial(document.getElementById('btn-open-config'));
  });

  // --- SERVICIO 2: DETECTOR DE TONALIDAD (CLAVE DE SOL) ---
  registerTonalityUIUpdater(updateTonalityModalDOM);

  document.getElementById('btn-open-tonality')?.addEventListener('click', () => {
    ensureAudioUnlocked();
    stopAllPreviews();
    updateTonalityModalDOM({ isListening: false, livePitch: null, ...computeTonalityAnalysis() });
    if (modalTonality) modalTonality.hidden = false;
  });

  document.getElementById('btn-close-tonality')?.addEventListener('click', () => {
    stopMicrophoneCapture();
    stopChromaticReferenceNote();
    if (modalTonality) modalTonality.hidden = true;
  });

  document.getElementById('btn-mic-toggle')?.addEventListener('click', async () => {
    ensureAudioUnlocked();
    const res = await toggleMicrophoneCapture(updateTonalityModalDOM);
    if (!res.ok && res.error) {
      const errorKey = navigator.mediaDevices?.getUserMedia ? 'tonality.micError' : 'tonality.micSecure';
      updateTonalityModalDOM({ ...lastTonalitySnapshot, errorKey });
    }
  });

  document.getElementById('btn-mic-clear')?.addEventListener('click', () => clearTonalityBuffer());
  document.getElementById('btn-mic-demo')?.addEventListener('click', () => {
    const st = getState();
    simulateSingingScaleDemo(st.rootSemitone, st.scaleMode, updateTonalityModalDOM);
  });

  document.getElementById('btn-apply-major')?.addEventListener('click', () => {
    if (!lastDetectedKeyInfo) return;
    stopMicrophoneCapture();
    setState({ rootSemitone: lastDetectedKeyInfo.majorRoot, scaleMode: 'M' });
    if (modalTonality) modalTonality.hidden = true;
    playTonicReferencePreview();
  });

  document.getElementById('btn-apply-minor')?.addEventListener('click', () => {
    if (!lastDetectedKeyInfo) return;
    stopMicrophoneCapture();
    setState({ rootSemitone: lastDetectedKeyInfo.minorRoot, scaleMode: 'm' });
    if (modalTonality) modalTonality.hidden = true;
    playTonicReferencePreview();
  });

  const chromKeys = document.querySelectorAll('.chromatic-keyboard [data-pc]');
  chromKeys.forEach((keyEl) => {
    const pc = Number(keyEl.dataset.pc);
    keyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { keyEl.setPointerCapture(e.pointerId); } catch (_) {}
      keyEl.classList.add('is-playing');
      startChromaticReferenceNote(pc);
    });
    const endRef = () => {
      keyEl.classList.remove('is-playing');
      stopChromaticReferenceNote();
    };
    keyEl.addEventListener('pointerup', endRef);
    keyEl.addEventListener('pointercancel', endRef);
  });

  // --- SERVICIO 3: GRABADOR Y ESTUDIO DE MAQUETA (2 PISTAS) ---
  const btnDemoRec = document.getElementById('btn-demo-rec');
  const ledDemoRec = document.getElementById('demo-rec-led');
  const timerDemoRec = document.getElementById('demo-rec-timer');

  document.getElementById('btn-minimize-camera').addEventListener('click', () => {
    document.getElementById('camera-live-video').srcObject = null;
    document.getElementById('camera-live-pip').hidden = true;
    btnDemoRec.focus();
  });

  const updateDemoRecButtonUI = ({ recording = false, countingIn = false, countInRemaining, elapsedSec }) => {
    const modeChanged = btnDemoRec.classList.contains('is-demo-countin') !== countingIn
      || btnDemoRec.classList.contains('is-demo-rec') !== recording;
    btnDemoRec.classList.toggle('is-demo-countin', countingIn);
    btnDemoRec.classList.toggle('is-demo-rec', recording);
    if (modeChanged) renderHeaderLabels();
    ledDemoRec?.classList.toggle('on-amber', countingIn);
    ledDemoRec?.classList.toggle('on-ruby', recording);
    if (timerDemoRec) {
      timerDemoRec.hidden = !countingIn && !recording;
      if (countingIn) timerDemoRec.textContent = `-${countInRemaining}`;
      else if (recording) timerDemoRec.textContent = formatElapsedTime(elapsedSec);
    }
  };

  btnDemoRec?.addEventListener('click', async () => {
    if (isDemoCountIn()) {
      cancelDemoCountIn();
      return;
    }
    ensureAudioUnlocked();
    btnDemoRec.disabled = true;
    try {
      if (!isDemoRecording()) {
        stopAllPreviews();
        stopMicrophoneCapture();
        stopDemoPreviewPlayback();
        await startDemoRecording(updateDemoRecButtonUI);
      } else {
        const session = await stopDemoRecording();
        if (session) openDemoStudioModal(session);
      }
    } finally {
      btnDemoRec.disabled = false;
    }
  });

  // Sliders de Recorte Inicio / Final
  document.getElementById('trim-start-range')?.addEventListener('input', (e) => {
    const session = getCurrentDemoSession();
    if (!session) return;
    const rawSec = (Number(e.target.value) / 1000) * session.durationSec;
    const maxStart = Math.max(0, studioMix.trimEndSec - 0.2);
    studioMix.trimStartSec = Math.min(rawSec, maxStart);
    if (studioMix.playheadSec !== null) studioMix.playheadSec = clampStudioSeek(studioMix.playheadSec);
    if (rawSec > maxStart) {
      e.target.value = String(Math.round((maxStart / session.durationSec) * 1000));
    }
    updateStudioControlsDOM();
  });

  document.getElementById('trim-end-range')?.addEventListener('input', (e) => {
    const session = getCurrentDemoSession();
    if (!session) return;
    const rawSec = (Number(e.target.value) / 1000) * session.durationSec;
    const minEnd = Math.min(session.durationSec, studioMix.trimStartSec + 0.2);
    studioMix.trimEndSec = Math.max(rawSec, minEnd);
    if (studioMix.playheadSec !== null) studioMix.playheadSec = clampStudioSeek(studioMix.playheadSec);
    if (rawSec < minEnd) {
      e.target.value = String(Math.round((minEnd / session.durationSec) * 1000));
    }
    updateStudioControlsDOM();
  });

  // Sliders de Volumen Música y Volumen Voz (actualización EN VIVO)
  document.getElementById('mix-music-vol')?.addEventListener('input', (e) => {
    studioMix.musicVol = Number(e.target.value) / 100;
    updateStudioControlsDOM();
    updateLivePreviewMix(studioMix);
  });

  document.getElementById('mix-voice-vol')?.addEventListener('input', (e) => {
    studioMix.voiceVol = Number(e.target.value) / 100;
    updateStudioControlsDOM();
    updateLivePreviewMix(studioMix);
  });

  // Controles de Sincronización Voz vs Música (Compensación de latencia hardware en ms)
  const applyVoiceSyncOffset = (newMs, commit = true) => {
    const clamped = Math.max(-400, Math.min(150, Math.round(newMs)));
    studioMix.voiceOffsetMs = clamped;
    if (commit) {
      appliedVoiceOffsetMs = clamped;
      saveVoiceSyncMs(clamped);
    }
    updateStudioControlsDOM();
    const position = commit ? getCurrentPreviewPositionSec() : null;
    if (position !== null) playStudioMix(position);
  };

  document.getElementById('mix-voice-sync')?.addEventListener('input', (e) => {
    applyVoiceSyncOffset(Number(e.target.value), false);
  });
  document.getElementById('mix-voice-sync')?.addEventListener('change', (e) => {
    applyVoiceSyncOffset(Number(e.target.value), true);
  });
  document.getElementById('btn-sync-minus')?.addEventListener('click', () => {
    applyVoiceSyncOffset((studioMix.voiceOffsetMs || 0) - 10, true);
  });
  document.getElementById('btn-sync-plus')?.addEventListener('click', () => {
    applyVoiceSyncOffset((studioMix.voiceOffsetMs || 0) + 10, true);
  });
  document.getElementById('btn-sync-auto')?.addEventListener('click', () => {
    const session = getCurrentDemoSession();
    if (!session) return;
    applyVoiceSyncOffset(session.autoMeasuredOffsetMs ?? -110, true);
  });

  // Botones de Eco Voz (0..3) y Chorus Voz (0..3) (actualización EN VIVO)
  document.getElementById('btn-voice-echo')?.addEventListener('click', () => {
    studioMix.voiceEcho = (studioMix.voiceEcho + 1) % 4;
    updateStudioControlsDOM();
    updateLivePreviewMix(studioMix);
  });

  document.getElementById('btn-voice-chorus')?.addEventListener('click', () => {
    studioMix.voiceChorus = (studioMix.voiceChorus + 1) % 4;
    updateStudioControlsDOM();
    updateLivePreviewMix(studioMix);
  });

  document.getElementById('btn-voice-filter').addEventListener('click', () => {
    studioMix.voiceFilter = (studioMix.voiceFilter + 1) % 4;
    updateStudioControlsDOM();
    const position = getCurrentPreviewPositionSec();
    if (position !== null) playStudioMix(position);
  });

  const waveform = document.getElementById('demo-waveform-canvas');
  let pointerStartSec = null;
  const pointerPosition = event => {
    const rect = waveform.getBoundingClientRect();
    return clampStudioSeek((event.clientX - rect.left) / rect.width * getCurrentDemoSession().durationSec);
  };
  waveform.addEventListener('pointerdown', event => {
    if (event.button !== 0 || waveformPointerId !== null || !getCurrentDemoSession()) return;
    waveformPointerId = event.pointerId;
    waveform.setPointerCapture(event.pointerId);
    pointerStartSec = pointerPosition(event);
    playStudioMix(pointerStartSec);
  });
  waveform.addEventListener('pointermove', event => {
    if (event.pointerId !== waveformPointerId) return;
    studioMix.playheadSec = pointerPosition(event);
    drawTwoTrackWaveform();
  });
  waveform.addEventListener('pointerup', event => {
    if (event.pointerId !== waveformPointerId) return;
    waveformPointerId = null;
    const targetSec = pointerPosition(event);
    if (targetSec !== pointerStartSec) playStudioMix(targetSec);
  });
  waveform.addEventListener('lostpointercapture', event => {
    if (event.pointerId !== waveformPointerId) return;
    waveformPointerId = null;
    studioMix.playheadSec = getCurrentPreviewPositionSec();
    drawTwoTrackWaveform();
  });
  waveform.addEventListener('keydown', event => {
    const current = studioMix.playheadSec ?? studioMix.trimStartSec;
    const positions = {
      ArrowLeft: current - 0.1, ArrowRight: current + 0.1,
      ArrowDown: current - 0.1, ArrowUp: current + 0.1,
      Home: studioMix.trimStartSec, End: studioMix.trimEndSec
    };
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    playStudioMix(clampStudioSeek(positions[event.key]));
  });

  // Botón Escuchar Mezcla / Parar
  document.getElementById('btn-demo-preview-play')?.addEventListener('click', () => {
    ensureAudioUnlocked();
    if (isDemoPreviewPlaying()) {
      stopDemoPreviewPlayback();
      return;
    }
    playStudioMix();
  });

  // Botón Exportar Mezcla Definitiva (.MP3)
  document.getElementById('btn-download-demo-wav')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    renderDemoExportLabels();
    try {
      const rendered = await renderFinalMixWav(studioMix);
      if (rendered?.blob) {
        triggerBlobDownload(rendered.blob, rendered.filename);
      }
    } finally {
      btn.disabled = false;
      renderDemoExportLabels();
    }
  });

  // Botón Compartir Maqueta (.MP3) en móvil
  document.getElementById('btn-share-demo')?.addEventListener('click', async (e) => {
    if (typeof navigator.share !== 'function') return;
    const btn = e.currentTarget;
    btn.disabled = true;
    renderDemoExportLabels();
    try {
      const rendered = await renderFinalMixWav(studioMix);
      if (rendered?.blob) {
        const file = new File([rendered.blob], rendered.filename, { type: rendered.mimeType || 'audio/mpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: translate('studio.shareTitle'),
            text: translate('studio.shareText'),
            files: [file]
          });
        }
      }
    } catch (_) {
    } finally {
      btn.disabled = false;
      renderDemoExportLabels();
    }
  });

  document.getElementById('btn-close-demo-result')?.addEventListener('click', () => {
    stopDemoPreviewPlayback();
    setPreviewPlayBtnState(false);
    resetDemoVideo();
    if (modalDemo) modalDemo.hidden = true;
  });
  document.getElementById('btn-create-demo-video').addEventListener('click', createDemoVideo);
  document.getElementById('video-style-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-video-style]');
    if (button) selectVideoStyle(button.dataset.videoStyle);
  });
  document.getElementById('btn-share-demo-video').addEventListener('click', shareDemoVideo);

  [modalConfig, modalTonality, modalDemo].forEach((backdrop) => {
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        stopAllPreviews();
        stopMicrophoneCapture();
        stopChromaticReferenceNote();
        stopDemoPreviewPlayback();
        setPreviewPlayBtnState(false);
        if (backdrop === modalDemo) resetDemoVideo();
        backdrop.hidden = true;
      }
    });
  });

  applyI18nToDOM();
  renderConfigModalList();
  subscribe((state, keys) => {
    if (keys.includes('lang') || keys.includes('notation')) {
      applyI18nToDOM();
      renderConfigModalList();
      return;
    }
    if (keys.some(key => ['scaleMode', 'yAxisMode', 'keyStrike'].includes(key))) renderHeaderLabels();
    if (activeConfigTab === 'settings' && keys.some(key =>
      ['customScale', 'scaleMode', 'rootSemitone', 'octaveOffset', 'cameraEnabled'].includes(key)
    )) renderSettings(state);
  });
}
