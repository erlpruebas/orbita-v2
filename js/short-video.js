/** Captura frontal sin audio y exportación vertical con la mezcla de la maqueta. */

import { ensureAudioUnlocked } from './audio-core.js';
import { getState } from './state.js';
import { getNoteNameTitle } from './theory.js';

export const VIDEO_STYLES = Object.freeze(['pure', 'keys', 'orbit', 'cosmos']);

const VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

function makeRecorder(stream, mimeTypes, options = {}) {
  for (const mimeType of mimeTypes) {
    if (!MediaRecorder.isTypeSupported?.(mimeType)) continue;
    try {
      return new MediaRecorder(stream, { ...options, mimeType });
    } catch (error) {
      if (error.name !== 'NotSupportedError') throw error;
    }
  }
  return new MediaRecorder(stream, options);
}

function collectVideo(recorder) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', event => reject(event.error ?? new Error('Video recording failed')), { once: true });
    recorder.addEventListener('stop', () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'video/webm' }));
    }, { once: true });
  });
}

export async function prepareFrontCamera() {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    const recorder = makeRecorder(stream, ['video/webm;codecs=vp8', 'video/mp4']);
    const stopped = collectVideo(recorder);
    stopped.catch(() => {});
    const release = () => stream.getTracks().forEach(track => track.stop());
    return {
      stream,
      start() {
        try {
          // Una sola entrega al parar permite al contenedor incluir la duración para el recorte.
          recorder.start();
          return true;
        } catch (_) {
          release();
          return false;
        }
      },
      async stop() {
        try {
          if (recorder.state !== 'inactive') recorder.stop();
          const blob = await stopped;
          return blob.size ? blob : null;
        } catch (_) {
          return null;
        } finally {
          release();
        }
      }
    };
  } catch (_) {
    stream?.getTracks().forEach(track => track.stop());
    return null;
  }
}

function waitForVideo(video, event, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(signal.reason ?? new Error('Video frame unavailable')); };
    const timer = setTimeout(failed, 5000);
    video.addEventListener(event, ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', failed);
    if (signal.aborted) failed();
  });
}

async function loadCamera(video, url, trimStart, signal) {
  const ready = waitForVideo(video, 'loadeddata', signal);
  video.src = url;
  await ready;
  if (!(trimStart > 0)) return;
  const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.01) : trimStart;
  const offset = Math.min(trimStart, end);
  if (offset <= 0) return;

  const seek = waitForVideo(video, 'seeked', signal);
  video.currentTime = offset;
  try {
    await seek;
  } catch (error) {
    signal.throwIfAborted();
    if (video.readyState < 2 || Math.abs(video.currentTime - offset) > 0.05) throw error;
  }
}

const FRAME_WIDTH = 720;
const FRAME_HEIGHT = 1280;
const FRAME_RATE = 30;
const FRAME_INTERVAL_MS = 1000 / FRAME_RATE;
const BAR_COUNT = 36;
const INSET = 48;
const CONTENT_WIDTH = FRAME_WIDTH - 2 * INSET;
const EMERALD = '#34d399';
const CHASSIS = '#141518';
const TAU = 2 * Math.PI;
const CENTER_X = FRAME_WIDTH / 2;
const TITLE_FONT = '800 56px system-ui, sans-serif';
const MONO_FONT = '600 24px monospace';
const ROOT_HUES = [155, 338, 199, 283, 47, 315, 179, 223, 14, 265, 94, 354];
const PETALS_BY_ROOT = [6, 3, 8, 5, 3, 6, 8, 5, 6, 3, 8, 5];

function drawCameraCover(ctx, video, zoom = 1) {
  const { width: frameWidth, height: frameHeight } = ctx.canvas;
  const scale = Math.max(frameWidth / video.videoWidth, frameHeight / video.videoHeight) * zoom;
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  ctx.save();
  ctx.translate(frameWidth / 2, frameHeight / 2);
  ctx.scale(-1, 1);
  ctx.drawImage(video, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function getTitleLines(ctx, title) {
  if (!title) return [];
  ctx.font = TITLE_FONT;
  if (ctx.measureText(title).width <= CONTENT_WIDTH) return [title];
  const words = title.split(/\s+/);
  if (words.length < 2) return [title];
  const firstLine = [words.shift()];
  while (words.length > 1 && ctx.measureText([...firstLine, words[0]].join(' ')).width <= CONTENT_WIDTH) {
    firstLine.push(words.shift());
  }
  return [firstLine.join(' '), words.join(' ')];
}

function panel(ctx, x, y, w, h, radius, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function text(ctx, label, x, y, font, color, align = 'center', maxWidth = CONTENT_WIDTH) {
  if (!label) return;
  ctx.textAlign = align;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(label, x, y, maxWidth);
}

function circle(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
}

function hueColor(hue, lightness, alpha = 1) {
  return `hsla(${hue}, 94%, ${lightness}%, ${alpha})`;
}

function canvasSurface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

// Las luces se rasterizan una vez por exportación y se reusan con distintas escalas.
function makeLightSprites(includeBokeh) {
  return ROOT_HUES.map(hue => {
    const softLight = canvasSurface(128, 128);
    const glow = softLight.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, hueColor(hue, 85, 0.95));
    glow.addColorStop(0.17, hueColor(hue, 70, 0.66));
    glow.addColorStop(0.48, hueColor(hue, 57, 0.23));
    glow.addColorStop(1, hueColor(hue, 50, 0));
    softLight.fillStyle = glow;
    softLight.fillRect(0, 0, 128, 128);

    const beam = canvasSurface(128, 256);
    const length = beam.createLinearGradient(0, 0, 0, 256);
    length.addColorStop(0, hueColor(hue, 52, 0));
    length.addColorStop(0.4, hueColor(hue, 55, 0.18));
    length.addColorStop(0.84, hueColor(hue, 68, 0.62));
    length.addColorStop(1, hueColor(hue, 90, 0.94));
    beam.fillStyle = length;
    beam.fillRect(0, 0, 128, 256);
    beam.globalCompositeOperation = 'destination-in';
    const width = beam.createLinearGradient(0, 0, 128, 0);
    width.addColorStop(0, 'transparent');
    width.addColorStop(0.38, '#0009');
    width.addColorStop(0.5, '#000');
    width.addColorStop(0.62, '#0009');
    width.addColorStop(1, 'transparent');
    beam.fillStyle = width;
    beam.fillRect(0, 0, 128, 256);
    const sprite = { glow: softLight.canvas, beam: beam.canvas };
    if (includeBokeh) {
      const disc = canvasSurface(96, 96);
      const rim = disc.createRadialGradient(48, 48, 0, 48, 48, 48);
      rim.addColorStop(0, hueColor(hue, 78, 0.48));
      rim.addColorStop(0.57, hueColor(hue, 73, 0.34));
      rim.addColorStop(0.72, hueColor(hue, 79, 0.42));
      rim.addColorStop(1, hueColor(hue, 68, 0));
      disc.fillStyle = rim;
      disc.fillRect(0, 0, 96, 96);
      sprite.bokeh = disc.canvas;
    }
    return sprite;
  });
}

function makeCameraEffects(ctx, video, style) {
  if (!video || (style !== 'orbit' && style !== 'cosmos')) return null;
  const width = 252;
  const height = 448;
  const camera = canvasSurface(width, height);
  const layer = canvasSurface(width, height);

  function tint(color, image) {
    layer.globalCompositeOperation = 'source-over';
    layer.drawImage(image, 0, 0);
    layer.globalCompositeOperation = 'multiply';
    layer.fillStyle = color;
    layer.fillRect(0, 0, width, height);
  }

  function rgbSplit(amount) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.52 * amount;
    const shift = 3 + 22 * amount;
    tint('#18e6ff', camera.canvas);
    ctx.drawImage(layer.canvas, -shift, 1, FRAME_WIDTH, FRAME_HEIGHT);
    tint('#ff1eb8', camera.canvas);
    ctx.drawImage(layer.canvas, shift, -1, FRAME_WIDTH, FRAME_HEIGHT);
  }

  function prism(hue, amount, elapsed) {
    // El modo diferencia extrae los contornos del propio fotograma sin leer píxeles.
    layer.globalCompositeOperation = 'source-over';
    layer.drawImage(camera.canvas, 0, 0);
    layer.globalCompositeOperation = 'difference';
    layer.drawImage(camera.canvas, 2, 1);
    layer.globalCompositeOperation = 'source-over';
    layer.fillStyle = '#000';
    layer.fillRect(0, 0, 2, height);
    layer.fillRect(0, 0, width, 1);

    camera.globalCompositeOperation = 'saturation';
    camera.fillStyle = '#808080';
    camera.fillRect(0, 0, width, height);
    camera.globalCompositeOperation = 'multiply';
    camera.fillStyle = hueColor(hue, 76);
    camera.fillRect(0, 0, width, height);
    camera.globalCompositeOperation = 'screen';
    camera.fillStyle = hueColor(hue + 65, 12);
    camera.fillRect(0, 0, width, height);
    camera.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.61 + 0.17 * amount;
    ctx.drawImage(camera.canvas, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    // Dos ecos de esos contornos, con tintes y desplazamientos opuestos.
    camera.drawImage(layer.canvas, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.37 + 0.50 * amount;
    const shift = 12 + 49 * amount + 9 * Math.sin(elapsed * 2.4);
    tint(hueColor(hue + 28, 71), camera.canvas);
    ctx.drawImage(layer.canvas, -shift, -shift * 0.25, FRAME_WIDTH, FRAME_HEIGHT);
    tint(hueColor(hue + 168, 70), camera.canvas);
    ctx.drawImage(layer.canvas, shift, shift * 0.25, FRAME_WIDTH, FRAME_HEIGHT);
  }

  return (zoom, hue, amount, elapsed) => {
    if (style === 'orbit' && amount < 0.045) return;
    drawCameraCover(camera, video, zoom);
    ctx.save();
    if (style === 'orbit') rgbSplit(amount);
    else prism(hue, amount, elapsed);
    ctx.restore();
  };
}

function pitchAngle(pc) {
  return (pc / 12 - 0.25) * TAU;
}

function pointOnRing(angle, radius, cy) {
  return [CENTER_X + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function makeFrameRenderer(ctx, video, analyser, sampleRate, meta) {
  const style = VIDEO_STYLES.includes(meta.styleId) ? meta.styleId : VIDEO_STYLES[0];
  const titleLines = getTitleLines(ctx, meta.title?.trim().slice(0, 40));
  const events = (meta.noteEvents ?? []).map(event => ({ ...event, endSec: event.timeSec + event.durationSec }));
  const pitchLabels = Array.from({ length: 12 }, (_, pc) => getNoteNameTitle(pc, meta.notation));
  const positions = Array.from({ length: 7 }, (_, index) => ({
    x: 147 + index * 71,
    upper: index % 2 === 1,
    degree: meta.keyboardDegrees?.[index],
    level: 0,
    struckAt: -Infinity
  }));

  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Float32Array(analyser.fftSize);
  const bands = new Float32Array(BAR_COUNT);
  const maxFrequency = Math.min(13000, sampleRate / 2);
  const bandEdges = Array.from({ length: BAR_COUNT + 1 }, (_, i) => {
    const hz = 45 * (maxFrequency / 45) ** (i / BAR_COUNT);
    return Math.min(spectrum.length - 1, Math.floor(hz * analyser.fftSize / sampleRate));
  });

  const sprites = style === 'pure' ? [] : makeLightSprites(style === 'orbit');
  const cameraEffects = makeCameraEffects(ctx, video, style);
  const vignette = video && ctx.createRadialGradient(CENTER_X, 595, 350, CENTER_X, 595, 744);
  if (vignette) {
    vignette.addColorStop(0, '#08090b00');
    vignette.addColorStop(0.8, '#08090b18');
    vignette.addColorStop(1, '#08090b86');
  }
  const lowerShade = ctx.createLinearGradient(0, 665, 0, FRAME_HEIGHT);
  lowerShade.addColorStop(0, '#08091300');
  lowerShade.addColorStop(1, '#080913c8');
  const oled = ctx.createLinearGradient(INSET, 0, FRAME_WIDTH - INSET, 0);
  oled.addColorStop(0, '#49ffe4');
  oled.addColorStop(0.54, '#8e88ff');
  oled.addColorStop(1, '#ff7ac9');
  const stars = Array.from({ length: 84 }, (_, i) => ({
    angle: i * 2.399963,
    depth: (i * 73 % 89) / 89,
    speed: 0.75 + i % 7 * 0.09
  }));

  let lastElapsed = 0;
  let pulse = 0;
  let bass = 0;
  let attack = 0;
  let travel = 0;
  let eventIndex = 0;
  let active = [];
  let bursts = [];
  let chord = null;
  let root = 0;
  let label = '';
  let previousLabel = '';
  let labelAt = -Infinity;
  let flashAt = -Infinity;
  let flashRoot = 0;

  function readAudio(dt) {
    analyser.getFloatTimeDomainData(waveform);
    if (style === 'pure') return;
    analyser.getByteFrequencyData(spectrum);
    let power = 0;
    for (const sample of waveform) power += sample * sample;
    const energy = Math.min(1, Math.sqrt(power / waveform.length) * 4.1);
    for (let i = 0; i < bands.length; i++) {
      const end = Math.max(bandEdges[i] + 1, bandEdges[i + 1]);
      let peak = 0;
      for (let bin = bandEdges[i]; bin < end; bin++) peak = Math.max(peak, spectrum[bin]);
      bands[i] = (peak / 255) ** 1.6;
    }
    const low = (bands[0] + bands[3] + bands[6]) / 3;
    const onset = Math.max(0, (energy - pulse) * 3.5, (low - bass) * 2.1);
    attack = Math.min(1, Math.max(onset, attack * Math.exp(-9 * dt)));
    pulse += (energy - pulse) * (1 - Math.exp(-dt * (energy > pulse ? 18 : 6)));
    bass += (low - bass) * (1 - Math.exp(-dt * 11));
    travel += dt * (0.14 + pulse * 0.53 + attack * 0.28);
  }

  function matchesKey(event, position, index) {
    const pc = position.degree?.pitchClass;
    if (pc === undefined) return event.degreeIndex === index;
    return event.pitchClasses.includes(pc);
  }

  function readTimeline(elapsed, dt) {
    active = active.filter(event => elapsed < event.endSec);
    while (eventIndex < events.length && events[eventIndex].timeSec <= elapsed) {
      const event = events[eventIndex++];
      if (elapsed < event.endSec) active.push(event);
      if (event.continued || elapsed - event.timeSec > 0.22 || style === 'pure') continue;
      const isChord = event.pitchClasses.length >= 3;
      if (isChord) attack = Math.max(attack, 0.96);
      if (style === 'keys') {
        positions.forEach((position, index) => {
          if (matchesKey(event, position, index)) position.struckAt = event.timeSec;
        });
      }
      if (style === 'cosmos') {
        if (bursts.length === 18) bursts.shift();
        bursts.push(event);
      }
    }
    bursts = bursts.filter(event => elapsed - event.timeSec < 1.35);
    chord = active.findLast(event => event.pitchClasses.length >= 3) ?? active.at(-1);
    const nextLabel = chord?.label ?? '';
    if (nextLabel !== label) {
      previousLabel = label;
      label = nextLabel;
      labelAt = elapsed;
      if (chord) {
        flashRoot = chord.rootPc;
        if (!chord.continued) flashAt = elapsed;
      }
    }
    root = chord?.rootPc ?? root;
    if (style === 'keys' || (style === 'cosmos' && video)) {
      positions.forEach((position, index) => {
        const sounding = active.some(event => matchesKey(event, position, index));
        position.level = sounding ? Math.min(1, position.level + dt * 16)
          : position.level * Math.exp(-dt * 7);
      });
    }
  }

  function drawTitle(lastBaseline) {
    titleLines.forEach((line, index) => {
      const baseline = lastBaseline - 62 * (titleLines.length - 1 - index);
      text(ctx, line, CENTER_X, baseline, TITLE_FONT, '#f0f8f7');
    });
  }

  function drawBrand() {
    panel(ctx, INSET, 51, 114, 35, 8, '#10121785');
    text(ctx, 'ÓRBITA', INSET + 57, 75, '800 18px monospace', '#f0f8f7');
  }

  function drawSpectrum(x, y, width, height) {
    const step = width / bands.length;
    ctx.beginPath();
    for (let i = 0; i < bands.length; i++) {
      const bar = 1 + bands[i] * height;
      ctx.rect(x + i * step, y - bar, step * 0.53, bar);
    }
    ctx.fillStyle = oled;
    ctx.fill();
  }

  function softLight(pc, x, y, width, height, opacity = 1) {
    ctx.globalAlpha = opacity;
    ctx.drawImage(sprites[pc].glow, x - width / 2, y - height / 2, width, height);
  }

  function lightBeam(pc, x, y, angle, length, width, opacity) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(sprites[pc].beam, -width / 2, -length, width, length);
    ctx.restore();
  }

  function lensFlare(elapsed, y) {
    const age = elapsed - flashAt;
    if (age > 0.65) return;
    const strength = (1 - age / 0.65) ** 2;
    const x = CENTER_X + (flashRoot % 2 ? -1 : 1) * (age * 860 - 130);
    softLight(flashRoot, x, y, 1130 + age * 520, 38, strength);
    softLight((flashRoot + 4) % 12, FRAME_WIDTH - x, y + 17, 422, 12, strength * 0.75);
    softLight(flashRoot, x, y, 332, 6, strength);
    softLight(flashRoot, x, y, 81, 81, strength * 0.79);
  }

  function neonChord(y, size) {
    if (!label) return;
    const font = '800 ' + size + 'px system-ui, sans-serif';
    const hue = ROOT_HUES[root];
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.strokeStyle = hueColor(hue, 22, 0.92);
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, CENTER_X, y, CONTENT_WIDTH);
    text(ctx, label, CENTER_X, y, font, hueColor(hue, 94));
    ctx.restore();
  }

  function drawPure(elapsed) {
    if (video) return;
    drawTitle(498);
    const age = elapsed - labelAt;
    ctx.globalAlpha = Math.max(0, 1 - age / 0.10);
    text(ctx, previousLabel, CENTER_X, 582, '500 40px monospace', '#d4e4df');
    ctx.globalAlpha = Math.min(1, Math.max(0, (age - 0.06) / 0.18));
    text(ctx, label, CENTER_X, 582, '500 40px monospace', '#d4e4df');
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i <= 220; i++) {
      const x = INSET + CONTENT_WIDTH * i / 220;
      const sample = waveform[Math.round((waveform.length - 1) * i / 220)];
      const y = 672 + sample * 72 * Math.sin(Math.PI * i / 220);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#87c9b1';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function drawKeyboard(top, height, rowSpacing) {
    for (const position of positions) {
      const { x, upper, degree, level } = position;
      const y = top + (upper ? 0 : rowSpacing);
      const hue = ROOT_HUES[degree?.pitchClass ?? root];
      panel(ctx, x - 65, y, 130, height, 11, hueColor(hue, 12 + level * 17, 0.73),
        hueColor(hue, 53 + level * 34, 0.40 + level * 0.58));
      panel(ctx, x - 19, y + 7, 38, 2.5, 1, hueColor(hue, 47 + level * 48, 0.4 + level * 0.6));
      text(ctx, degree?.chordLabel, x, y + height * 0.68, MONO_FONT, hueColor(hue, 76 + level * 18));
    }
  }

  function drawKeyLights(elapsed, top, rowSpacing) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const { x, upper, degree, level, struckAt } of positions) {
      const age = elapsed - struckAt;
      const kick = Math.max(0, 1 - age / 0.75) ** 2;
      if (level + kick < 0.025) continue;
      const pc = degree?.pitchClass ?? root;
      const y = top + 2 + (upper ? 0 : rowSpacing);
      const angle = (x - CENTER_X) / 790 + Math.sin(elapsed * 2 + x) * 0.076;
      lightBeam(pc, x, y, angle, 420 + level * 135 + pulse * 380, 92 + kick * 91,
        Math.min(1, level * 0.67 + kick * 0.56));
      softLight(pc, x, y, 139 + kick * 63, 96 + kick * 42, Math.min(1, level * 0.75 + kick));
      for (let i = 0; i < 9; i++) {
        const t = age - i * 0.037;
        if (t < 0 || t >= 0.8) continue;
        const rise = t * (140 + i * 39) + t * t * 85;
        const px = x + Math.sin(angle) * rise + Math.sin(i * 5.17) * t * 92;
        const py = y - rise;
        const size = 8 + i % 4 * 4;
        softLight(pc, px, py, size, size * 1.85, 0.85 * (1 - t / 0.8));
      }
    }
    ctx.restore();
  }

  function drawStage(elapsed) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    softLight(root, CENTER_X, 1040, 1020, video ? 450 : 760, 0.26 + pulse * 0.32);
    if (!video) {
      softLight((root + 3) % 12, 124, 670, 610, 940, 0.32);
      softLight((root + 7) % 12, 635, 555, 630, 1020, 0.27);
    }
    ctx.restore();
    drawKeyLights(elapsed, 1040, 96);
    drawTitle(video ? 179 : 402);
    neonChord(961, 98);
    drawSpectrum(INSET + 34, 1018, CONTENT_WIDTH - 68, 31);
    drawKeyboard(1040, 81, 96);
  }

  function drawBokeh(elapsed) {
    for (let i = 0; i < 17; i++) {
      const phase = (i / 17 + elapsed * (0.026 + i % 4 * 0.011)) % 1;
      const x = (i * 151 % 810) - 45 + 61 * Math.sin(i + elapsed * 0.41);
      const y = FRAME_HEIGHT + 125 - phase * (FRAME_HEIGHT + 250);
      const size = 52 + (i * 73 % 156) + bass * 39;
      ctx.globalAlpha = (0.38 + pulse * 0.40) * Math.sin(phase * Math.PI);
      ctx.drawImage(sprites[(i * 5 + root) % 12].bokeh, x - size / 2, y - size / 2, size, size);
    }
  }

  function drawHorizon(elapsed) {
    const y = 681;
    softLight((root + 4) % 12, CENTER_X, y, 1040, 540, 0.69);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = -7; i <= 7; i++) {
      ctx.moveTo(CENTER_X + i * 10, y);
      ctx.lineTo(CENTER_X + i * 189, FRAME_HEIGHT);
    }
    for (let i = 0; i <= 12; i++) {
      const yy = y + ((i + travel * 2 % 1) / 12) ** 2 * (FRAME_HEIGHT - y);
      ctx.moveTo(0, yy);
      ctx.lineTo(FRAME_WIDTH, yy);
    }
    ctx.strokeStyle = hueColor(ROOT_HUES[root] + 61, 64, 0.32 + pulse * 0.26);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= BAR_COUNT * 2; i++) {
      const value = bands[Math.min(i, BAR_COUNT * 2 - i, BAR_COUNT - 1)];
      const x = i * FRAME_WIDTH / (BAR_COUNT * 2);
      const yy = y - value * (32 + pulse * 112);
      if (i === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = oled;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const x = 26 + i * 167;
      const angle = Math.PI + Math.sin(elapsed * 0.87 + i * 1.8) * 0.61;
      lightBeam((root + i * 3) % 12, x, -37, angle, 1010, 240, 0.57 + bass * 0.32);
    }
  }

  function drawConstellation(elapsed) {
    const cy = video ? 914 : 823;
    const radius = video ? 152 : 186;
    const pitchClasses = chord?.pitchClasses ?? [];
    const spin = 0.15 * Math.sin(elapsed * 0.55);
    softLight(root, CENTER_X, cy, 486, 441, video ? 0.24 : 0.51);
    ctx.globalAlpha = 1;
    for (const r of [radius - 12, radius, radius + 12]) {
      circle(ctx, CENTER_X, cy, r);
      ctx.lineWidth = 1;
      ctx.strokeStyle = hueColor(ROOT_HUES[root], 63, r === radius ? 0.66 : 0.22);
      ctx.stroke();
    }
    if (pitchClasses.length >= 2) {
      ctx.beginPath();
      [...pitchClasses].sort((a, b) => a - b).forEach((pc, i) => {
        const [x, y] = pointOnRing(pitchAngle(pc) + spin, radius, cy);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (pitchClasses.length > 2) ctx.closePath();
      ctx.strokeStyle = hueColor(ROOT_HUES[root], 53, 0.33);
      ctx.lineWidth = 12 + attack * 20;
      ctx.stroke();
      ctx.strokeStyle = hueColor(ROOT_HUES[root], 90, 0.96);
      ctx.lineWidth = 2.5 + pulse * 2;
      ctx.stroke();
    }
    pitchLabels.forEach((name, pc) => {
      const angle = pitchAngle(pc) + spin;
      const [x, y] = pointOnRing(angle, radius, cy);
      const [lx, ly] = pointOnRing(angle, radius + 28, cy);
      const lit = pitchClasses.includes(pc);
      if (lit) softLight(pc, x, y, 62 + attack * 30, 62 + attack * 30);
      ctx.globalAlpha = 1;
      circle(ctx, x, y, lit ? 4 : 2);
      ctx.fillStyle = lit ? '#fff' : '#d0e4f5a0';
      ctx.fill();
      text(ctx, name, lx, ly + 6, '600 18px monospace', lit ? '#fff' : '#c2d9ee');
    });
  }

  function drawClub(elapsed) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (!video) drawHorizon(elapsed);
    drawBokeh(elapsed);
    lensFlare(elapsed, video ? 711 : 660);
    drawConstellation(elapsed);
    ctx.restore();
    drawTitle(video ? 179 : 312);
    neonChord(video ? 1154 : 1115, 66);
  }

  function drawTunnel(elapsed, cy) {
    softLight(root, CENTER_X, cy, 1180, 1060, 0.34 + pulse * 0.23);
    softLight((root + 5) % 12, CENTER_X, cy, 561, 581, 0.30 + attack * 0.21);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 13; i++) {
      const z = (i / 13 + travel) % 1;
      const radius = 16 + z ** 2.55 * 1050;
      ctx.beginPath();
      ctx.ellipse(CENTER_X, cy + z ** 3 * 83, radius, radius * 0.66, -elapsed * 0.20 + z * 0.8, 0, TAU);
      ctx.strokeStyle = hueColor(ROOT_HUES[root] + i * 13, 70, (0.25 + pulse * 0.43) * Math.sin(z * Math.PI));
      ctx.lineWidth = 1 + z * 4;
      ctx.stroke();
    }
    for (let lane = 0; lane < 4; lane++) {
      ctx.beginPath();
      for (let i = lane; i < stars.length; i += 4) {
        const star = stars[i];
        const z = (star.depth + travel * star.speed) % 1;
        const angle = star.angle + elapsed * 0.17;
        const distance = z ** 2 * 920;
        const [x, y] = pointOnRing(angle, distance, cy);
        const tail = z * (13 + pulse * 89 + attack * 58);
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(angle) * tail, y - Math.sin(angle) * tail);
      }
      ctx.lineWidth = 1.1 + lane * 0.48;
      ctx.strokeStyle = hueColor(ROOT_HUES[root] + lane * 43, 77, 0.51 + pulse * 0.22);
      ctx.stroke();
    }
  }

  function drawMandala(elapsed, cy) {
    const petals = PETALS_BY_ROOT[root];
    for (let layer = 0; layer < 4; layer++) {
      const spin = elapsed * (layer % 2 === 0 ? 0.24 : -0.29) + layer * 0.31;
      const reach = 106 + layer * 34 + pulse * 53;
      const hue = ROOT_HUES[root] + layer * 37;
      ctx.beginPath();
      for (let i = 0; i <= 144; i++) {
        const angle = i / 144 * TAU;
        const radius = reach * (0.71 + 0.29 * Math.cos(petals * angle));
        const [x, y] = pointOnRing(angle + spin, radius, cy);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = hueColor(hue, 52, 0.035 + pulse * 0.05);
      ctx.fill();
      ctx.strokeStyle = hueColor(hue, 64, 0.21);
      ctx.lineWidth = 9 + attack * 9;
      ctx.stroke();
      ctx.strokeStyle = hueColor(hue, 82, 0.58 + pulse * 0.29);
      ctx.lineWidth = 1.6 + layer * 0.28;
      ctx.stroke();
    }
  }

  function drawStarRain(elapsed) {
    for (let i = 0; i < 48; i++) {
      const star = stars[i];
      const phase = (star.depth + elapsed * 0.45 + travel * 0.17 * star.speed) % 1;
      const x = (i * 131 % 792) - 36 + phase * Math.sin(star.angle) * 79;
      const y = -95 + phase ** 1.6 * 1460;
      const size = 10 + i % 6 * 4;
      softLight((root + i * 5) % 12, x, y, size, size * (1.3 + phase * 2.3), Math.sin(phase * Math.PI) * 0.75);
    }
  }

  function drawBurst(event, elapsed, cy) {
    const age = elapsed - event.timeSec;
    const fade = Math.max(0, 1 - age / 1.35);
    const pc = event.rootPc;
    const hue = ROOT_HUES[pc];
    const velocity = Math.min(1, Math.max(0.25, event.velocity ?? 0.8));
    const isChord = event.pitchClasses.length >= 3;
    if (isChord) {
      const wave = age * (310 + velocity * 155);
      ctx.globalAlpha = 1;
      for (let ring = 0; ring < 3; ring++) {
        circle(ctx, CENTER_X, cy, 25 + wave * (0.86 + ring * 0.21));
        ctx.lineWidth = 1.3 + fade * (5 - ring);
        ctx.strokeStyle = hueColor(hue + ring * 31, 80, fade ** 2 * (0.53 - ring * 0.11));
        ctx.stroke();
      }
    }
    const [x, y] = pointOnRing(pitchAngle(pc), video ? 226 : 113, cy);
    softLight(pc, x, y, 130, 118, fade ** 3 * velocity);
    ctx.globalAlpha = 1;
    for (const note of event.pitchClasses) {
      const [noteX, noteY] = pointOnRing(pitchAngle(note), video ? 226 : 113, cy);
      const count = note === pc ? 8 : 4;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const angle = pitchAngle(note) + i * 2.399963 + event.timeSec;
        const speed = (64 + i * 71 % 213) * (0.68 + velocity * 0.62);
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 99;
        const t = Math.max(0, age - 0.075 - i % 4 * 0.02);
        ctx.moveTo(noteX + vx * t, noteY + vy * t + 117 * t * t);
        ctx.lineTo(noteX + vx * age, noteY + vy * age + 117 * age * age);
      }
      ctx.lineWidth = 1.1 + velocity * 1.7;
      ctx.strokeStyle = hueColor(ROOT_HUES[note] + 19, 80, fade * velocity);
      ctx.stroke();
    }
    if (video && isChord) {
      ctx.globalAlpha = Math.min(1, age * 14, fade * 2) * 0.9;
      const lx = Math.max(103, Math.min(FRAME_WIDTH - 103, x + 63 * Math.sin(age * 3 + pc)));
      text(ctx, event.label, lx, y - 37 - age * 167, '800 36px monospace', hueColor(hue, 89), 195);
    }
  }

  function drawMusicVideo(elapsed) {
    const cy = video ? 630 : 664;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (video) {
      drawStarRain(elapsed);
    } else {
      drawTunnel(elapsed, cy);
      drawMandala(elapsed, cy);
    }
    lensFlare(elapsed, cy - 87);
    bursts.forEach(event => drawBurst(event, elapsed, cy));
    ctx.restore();
    if (video) {
      drawTitle(179);
      neonChord(984, 76);
      drawSpectrum(INSET + 31, 1049, CONTENT_WIDTH - 62, 43);
      drawKeyboard(1074, 66, 74);
    } else {
      drawTitle(331);
      neonChord(1011, 96);
      drawSpectrum(INSET, 1193, CONTENT_WIDTH, 128);
    }
  }

  return (elapsed, progress) => {
    if (!(video && style === 'pure')) {
      const dt = Math.min(0.12, Math.max(1 / FRAME_RATE, elapsed - lastElapsed));
      readAudio(dt);
      readTimeline(elapsed, dt);
      lastElapsed = elapsed;
    }
    if (video) {
      const impact = Math.min(1, attack + bass * 0.15);
      const zoom = style === 'orbit' ? 1 + 0.055 * impact : 1;
      drawCameraCover(ctx, video, zoom);
      cameraEffects?.(zoom, ROOT_HUES[root], impact, elapsed);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      if (style !== 'pure') {
        ctx.fillStyle = lowerShade;
        ctx.fillRect(0, 665, FRAME_WIDTH, FRAME_HEIGHT - 665);
      }
    } else {
      ctx.fillStyle = CHASSIS;
      ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    }

    if (style === 'keys') drawStage(elapsed);
    else if (style === 'orbit') drawClub(elapsed);
    else if (style === 'cosmos') drawMusicVideo(elapsed);
    else drawPure(elapsed);

    drawBrand();
    ctx.fillStyle = '#d7eee347';
    ctx.fillRect(INSET, 1243, CONTENT_WIDTH, 2);
    ctx.fillStyle = style === 'pure' ? EMERALD : oled;
    ctx.fillRect(INSET, 1243, CONTENT_WIDTH * progress, 2);
  };
}

export async function encodeShortVideo(mix, cameraBlob, onProgress, signal, meta = {}) {
  const bpm = meta.bpm ?? getState().bpm;
  const { audio, trimStart, trimmedDur } = mix;
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  const ctx = canvas.getContext('2d');
  const audioContext = ensureAudioUnlocked();
  const audioDestination = audioContext.createMediaStreamDestination();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.minDecibels = -86;
  analyser.maxDecibels = -22;
  analyser.smoothingTimeConstant = 0.7;
  const source = audioContext.createBufferSource();
  source.buffer = audio;
  source.connect(analyser);
  analyser.connect(audioDestination);

  let cameraUrl;
  let video;
  let cameraReady = false;
  let output;
  let recorder;
  let frame;
  let nextFrameTime;
  const stop = () => {
    cancelAnimationFrame(frame);
    video?.pause();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    if (meta.hasCamera !== false && cameraBlob?.size) {
      cameraUrl = URL.createObjectURL(cameraBlob);
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      try {
        await loadCamera(video, cameraUrl, trimStart, signal);
        cameraReady = Boolean(video.videoWidth && video.videoHeight);
      } catch (_) {
        signal.throwIfAborted();
      }
    }

    signal.throwIfAborted();
    let drawFrame = makeFrameRenderer(ctx, cameraReady ? video : null, analyser, audioContext.sampleRate, meta);
    if (cameraReady) {
      try {
        await video.play();
      } catch (_) {
        signal.throwIfAborted();
        cameraReady = false;
        drawFrame = makeFrameRenderer(ctx, null, analyser, audioContext.sampleRate, meta);
      }
    }
    signal.throwIfAborted();
    drawFrame(0, 0);
    output = canvas.captureStream(FRAME_RATE);
    output.addTrack(audioDestination.stream.getAudioTracks()[0]);
    recorder = makeRecorder(output, VIDEO_MIME_TYPES, { videoBitsPerSecond: 3500000, audioBitsPerSecond: 160000 });
    const stopped = collectVideo(recorder);
    stopped.catch(() => {});
    recorder.start();
    const startTime = audioContext.currentTime;
    source.addEventListener('ended', stop, { once: true });
    source.start(startTime);
    const animate = now => {
      nextFrameTime ??= now;
      if (now + 1 >= nextFrameTime) {
        nextFrameTime += FRAME_INTERVAL_MS;
        if (nextFrameTime <= now) nextFrameTime = now + FRAME_INTERVAL_MS;
        const elapsed = audioContext.currentTime - startTime;
        if (cameraReady && elapsed >= trimmedDur && !video.paused) video.pause();
        const progress = Math.min(1, elapsed / audio.duration);
        drawFrame(elapsed, progress);
        onProgress(Math.floor(progress * 100));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const blob = await stopped;
    signal.throwIfAborted();
    if (!blob.size) throw new Error('Empty short video');
    onProgress(100);
    const extension = blob.type.startsWith('video/mp4') ? 'mp4' : 'webm';
    return { blob, mimeType: `video/${extension}`, filename: `orbita-maqueta-T${bpm}-9x16.${extension}` };
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
    try { source.stop(); } catch (_) {}
    source.disconnect();
    analyser.disconnect();
    output?.getTracks().forEach(track => track.stop());
    audioDestination.stream.getTracks().forEach(track => track.stop());
    if (cameraUrl) {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(cameraUrl);
    }
  }
}
