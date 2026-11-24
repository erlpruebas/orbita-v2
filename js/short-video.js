/** Captura frontal sin audio y exportación vertical con la mezcla de la maqueta. */

import { ensureAudioUnlocked } from './audio-core.js';
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
          recorder.start(250);
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

const FRAME_WIDTH = 720;
const FRAME_HEIGHT = 1280;
const FRAME_RATE = 30;
const FRAME_INTERVAL_MS = 1000 / FRAME_RATE;
const BAR_COUNT = 36;
const INSET = 48;
const CONTENT_WIDTH = FRAME_WIDTH - 2 * INSET;
const EMERALD = '#34d399';
const AMBER = '#fbbf24';
const CHASSIS = '#141518';
const TAU = 2 * Math.PI;
const CENTER_X = FRAME_WIDTH / 2;
const TITLE_FONT = '800 56px system-ui, sans-serif';
const MONO_FONT = '600 24px monospace';
const KEY_ROWS = [[1, 3, 5], [0, 2, 4, 6]];
const ROOT_HUES = [155, 338, 199, 283, 47, 315, 179, 223, 14, 265, 94, 354];

function drawCameraCover(ctx, video, zoom = 1) {
  const scale = Math.max(FRAME_WIDTH / video.videoWidth, FRAME_HEIGHT / video.videoHeight) * zoom;
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  ctx.save();
  ctx.translate(FRAME_WIDTH / 2, FRAME_HEIGHT / 2);
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

function pitchAngle(pc) {
  return (pc / 12 - 0.25) * TAU;
}

function pointOnRing(angle, radius, cy) {
  return [CENTER_X + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function makeFrameRenderer(ctx, video, analyser, sampleRate, meta) {
  const style = VIDEO_STYLES.includes(meta.styleId) ? meta.styleId : VIDEO_STYLES[0];
  const titleLines = getTitleLines(ctx, meta.title?.trim().slice(0, 40));
  const keyboardDegrees = meta.keyboardDegrees ?? [];
  const chromaticLabels = Array.from({ length: 12 }, (_, pc) => getNoteNameTitle(pc, meta.notation));
  const events = (meta.noteEvents ?? []).map(event => ({ ...event, endSec: event.timeSec + event.durationSec }));
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Float32Array(analyser.fftSize);
  const bands = new Float32Array(BAR_COUNT);
  const maxFrequency = Math.min(13000, sampleRate / 2);
  const bandEdges = Array.from({ length: BAR_COUNT + 1 }, (_, i) => {
    const hz = 45 * (maxFrequency / 45) ** (i / BAR_COUNT);
    return Math.min(spectrum.length - 1, Math.floor(hz * analyser.fftSize / sampleRate));
  });

  const shade = ctx.createLinearGradient(0, 590, 0, FRAME_HEIGHT);
  shade.addColorStop(0, '#07090c00');
  shade.addColorStop(0.68, '#07090cc9');
  shade.addColorStop(1, '#07090cf5');
  const metal = ctx.createLinearGradient(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  metal.addColorStop(0, '#22252a');
  metal.addColorStop(0.48, CHASSIS);
  metal.addColorStop(1, '#101114');
  const oled = ctx.createLinearGradient(INSET, 0, FRAME_WIDTH - INSET, 0);
  oled.addColorStop(0, EMERALD);
  oled.addColorStop(1, AMBER);

  let pulse = 0;
  let eventIndex = 0;
  let active = [];
  let bursts = [];
  let hue = ROOT_HUES[0];
  const stars = Array.from({ length: 96 }, (_, index) => ({
    angle: index * 2.399963,
    depth: ((index * 73) % 97) / 97,
    speed: 0.15 + (index % 7) * 0.025
  }));

  function readAudio() {
    analyser.getFloatTimeDomainData(waveform);
    let power = 0;
    for (const sample of waveform) power += sample * sample;
    const energy = Math.min(1, Math.sqrt(power / waveform.length) * 3.6);
    pulse += (energy - pulse) * (energy > pulse ? 0.45 : 0.16);
    if (style === 'pure') return;

    analyser.getByteFrequencyData(spectrum);
    for (let i = 0; i < bands.length; i++) {
      const end = Math.max(bandEdges[i] + 1, bandEdges[i + 1]);
      let peak = 0;
      for (let bin = bandEdges[i]; bin < end; bin++) peak = Math.max(peak, spectrum[bin]);
      bands[i] = (peak / 255) ** 1.6;
    }
  }

  function readTimeline(elapsed) {
    while (eventIndex < events.length && events[eventIndex].timeSec <= elapsed) {
      const event = events[eventIndex++];
      active.push(event);
      if (style === 'cosmos') {
        hue = ROOT_HUES[event.rootPc] ?? ROOT_HUES[0];
        if (!event.continued) bursts.push({ ...event, hue, index: eventIndex });
      }
    }
    active = active.filter(event => elapsed < event.endSec);
    bursts = bursts.filter(event => elapsed - event.timeSec < 1.15);
    return active.at(-1)?.label ?? '';
  }

  function drawTitle(lastBaseline) {
    titleLines.forEach((line, index) => {
      const baseline = lastBaseline - 62 * (titleLines.length - 1 - index);
      text(ctx, line, CENTER_X, baseline, TITLE_FONT, '#f0f8f7');
    });
  }

  function drawBrand() {
    panel(ctx, INSET, 51, 121, 40, 9, '#111419c7');
    text(ctx, 'ÓRBITA', INSET + 60, 78, '800 19px monospace', '#f0f8f7');
  }

  function drawSpectrum(x, y, width, height, color) {
    const step = width / bands.length;
    ctx.fillStyle = color;
    for (let i = 0; i < bands.length; i++) {
      const bar = 2 + bands[i] * height;
      ctx.fillRect(x + i * step, y - bar, step * 0.52, bar);
    }
  }

  function drawPure(label) {
    if (video) return;
    drawTitle(495);
    text(ctx, label, CENTER_X, 570, '500 32px monospace', '#a4baaf');
    ctx.beginPath();
    for (let i = 0; i <= 256; i++) {
      const x = INSET + CONTENT_WIDTH * i / 256;
      const sample = waveform[Math.round((waveform.length - 1) * i / 256)];
      const y = 671 + sample * 58 * Math.sin(Math.PI * i / 256);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#78c6ab';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  function drawKeys(label) {
    const y = video ? 842 : 601;
    if (!video) drawTitle(493);
    else drawTitle(y - 28);
    panel(ctx, INSET, y, CONTENT_WIDTH, 355, 23, CHASSIS, '#536067');
    panel(ctx, INSET + 18, y + 18, CONTENT_WIDTH - 36, 109, 10, '#071410', '#2c5445');
    text(ctx, label, INSET + 42, y + 86, TITLE_FONT, EMERALD, 'left', 236);
    drawSpectrum(347, y + 105, 268, 64, oled);

    const sounding = new Set(active.flatMap(event => event.pitchClasses));
    const activeDegrees = new Set(active.map(event => event.degreeIndex));
    KEY_ROWS.forEach((row, rowIndex) => row.forEach((index, column) => {
      const degree = keyboardDegrees[index];
      const lit = activeDegrees.has(index) || sounding.has(degree?.pitchClass);
      const x = INSET + 26 + column * 146 + (rowIndex === 0 ? 73 : 0);
      const top = y + 145 + rowIndex * 101;
      const color = sounding.has(degree?.pitchClass) ? EMERALD : AMBER;
      if (lit) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
      }
      panel(ctx, x, top, 134, 82, 11, lit ? '#123b2b' : '#1b1d22', lit ? color : '#42464d');
      ctx.shadowBlur = 0;
      panel(ctx, x + 49, top + 10, 35, 3, 2, lit ? color : '#494c50');
      text(ctx, degree?.chordLabel ?? '', x + 67, top + 57, MONO_FONT, lit ? color : '#c3c8cd');
    }));
  }

  function drawOrbit(label) {
    const cy = video ? 898 : 699;
    const radius = video ? 196 : 245;
    if (!video) drawTitle(315);
    else text(ctx, titleLines.join(' '), CENTER_X, 1212, '700 32px system-ui, sans-serif', '#f0f8f7');
    const halo = ctx.createRadialGradient(CENTER_X, cy, 32, CENTER_X, cy, radius + 95);
    halo.addColorStop(0, video ? '#07100e92' : '#102822');
    halo.addColorStop(0.68, '#226c4b31');
    halo.addColorStop(0.84, '#cc7a182c');
    halo.addColorStop(1, '#14151800');
    ctx.fillStyle = halo;
    ctx.fillRect(CENTER_X - radius - 95, cy - radius - 95, (radius + 95) * 2, (radius + 95) * 2);

    for (let ring = 1; ring <= 5; ring++) {
      circle(ctx, CENTER_X, cy, radius * ring / 5);
      ctx.strokeStyle = ring % 2 === 0 ? '#fbbf2466' : '#34d39971';
      ctx.lineWidth = ring === 5 ? 1.8 : 1;
      ctx.stroke();
    }

    for (const event of active) {
      if (event.pitchClasses.length < 2) continue;
      ctx.beginPath();
      event.pitchClasses.forEach((pc, i) => {
        const [x, y] = pointOnRing(pitchAngle(pc), radius, cy);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (event.pitchClasses.length > 2) ctx.closePath();
      ctx.strokeStyle = '#a1ffcf';
      ctx.lineWidth = 2.5 + pulse * 2;
      ctx.shadowColor = EMERALD;
      ctx.shadowBlur = 15;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    const sounding = new Set(active.flatMap(event => event.pitchClasses));
    chromaticLabels.forEach((name, pc) => {
      const angle = pitchAngle(pc);
      const [x, y] = pointOnRing(angle, radius, cy);
      const [lx, ly] = pointOnRing(angle, radius + 29, cy);
      const lit = sounding.has(pc);
      circle(ctx, x, y, lit ? 8 + pulse * 7 : 3.5);
      ctx.fillStyle = lit ? (pc === active.at(-1)?.rootPc ? AMBER : EMERALD) : '#548777';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = lit ? 23 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      text(ctx, name, lx, ly + 7, '600 20px monospace', lit ? '#ffffff' : '#baccc5');
    });

    ctx.strokeStyle = oled;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    bands.forEach((value, i) => {
      const angle = Math.PI * (0.16 + 0.68 * i / (bands.length - 1));
      const [x1, y1] = pointOnRing(angle, radius + 56, cy);
      const [x2, y2] = pointOnRing(angle, radius + 58 + value * 35, cy);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    });
    ctx.stroke();
    panel(ctx, CENTER_X - 116, cy - 34, 232, 68, 10, '#071410e5', '#447362');
    text(ctx, label, CENTER_X, cy + 17, '800 48px monospace', '#d6fff3', 'center', 209);
  }

  function drawTunnel(elapsed, cy) {
    const centerGlow = ctx.createRadialGradient(CENTER_X, cy, 0, CENTER_X, cy, 690);
    centerGlow.addColorStop(0, hueColor(hue, 26, 0.8));
    centerGlow.addColorStop(0.6, hueColor(hue + 80, 12, 0.64));
    centerGlow.addColorStop(1, '#070711');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    for (const star of stars) {
      const depth = (star.depth + elapsed * star.speed) % 1;
      const angle = star.angle + elapsed * 0.18;
      const r = depth ** 2 * 850;
      const [x, y] = pointOnRing(angle, r, cy);
      const length = 4 + depth * (10 + pulse * 37);
      ctx.strokeStyle = hueColor(hue + star.angle * 8, 75, depth * 0.7);
      ctx.lineWidth = 1 + depth * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
      ctx.stroke();
    }
  }

  function drawMandala(elapsed, cy) {
    for (let ring = 0; ring < 4; ring++) {
      const spin = elapsed * (ring % 2 === 0 ? 0.26 : -0.21) + ring * 0.31;
      ctx.strokeStyle = hueColor(hue + ring * 43, 66, 0.25 + pulse * 0.42);
      ctx.lineWidth = 1.5 + pulse * 2;
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const angle = i / 72 * TAU;
        const radius = 54 + ring * 68 + (35 + pulse * 53) * Math.cos(12 * angle);
        const [x, y] = pointOnRing(angle + spin, radius, cy);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawBurst(event, elapsed, cy) {
    const age = elapsed - event.timeSec;
    const velocity = Math.max(0.2, Math.min(1, event.velocity));
    const fade = 1 - age / 1.15;
    const [originX, originY] = video
      ? [event.rootPc % 2 ? FRAME_WIDTH - 46 : 46, 530 + (event.rootPc % 6) * 85]
      : pointOnRing(pitchAngle(event.rootPc), 105, cy);
    const radius = 12 + age * (215 + pulse * 120);
    ctx.lineWidth = 2 + 6 * fade * velocity;
    for (let ring = 0; ring < 3; ring++) {
      circle(ctx, originX, originY, radius * (1 + ring * 0.32));
      ctx.strokeStyle = hueColor(event.hue + ring * 34, 65, fade * velocity * 0.71 / (ring + 1));
      ctx.stroke();
    }

    ctx.beginPath();
    const rayLength = 36 + pulse * 82 + velocity * 45;
    for (let ray = 0; ray < 12; ray++) {
      const angle = pitchAngle(event.rootPc) + ray * TAU / 12 + age * 0.35;
      const reach = radius * 0.68;
      const length = reach + rayLength * fade * (ray % 2 === 0 ? 1 : 0.44);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      ctx.moveTo(originX + dx * reach, originY + dy * reach);
      ctx.lineTo(originX + dx * length, originY + dy * length);
    }
    ctx.strokeStyle = hueColor(event.hue + 42, 74, fade * velocity * 0.65);
    ctx.lineWidth = 2 + velocity * 2;
    ctx.stroke();

    for (let i = 0; i < 24; i++) {
      const angle = (i / 24 + event.index * 0.381966) * TAU;
      const speed = 70 + (i * 71 % 185);
      const travel = age * speed * (0.8 + velocity + pulse * 0.3);
      const x = originX + Math.cos(angle) * travel;
      const y = originY + Math.sin(angle) * travel - 22 * age;
      ctx.fillStyle = hueColor(event.hue + (i % 3) * 44, 72, fade);
      const size = (2 + i % 4) * fade;
      if (i % 4 === 0) {
        ctx.fillRect(x - size * 2, y - 1, size * 4, 2);
        ctx.fillRect(x - 1, y - size * 2, 2, size * 4);
      } else {
        circle(ctx, x, y, size);
        ctx.fill();
      }
    }
  }

  function drawCosmos(label, elapsed) {
    const cy = video ? 755 : 650;
    if (!video) drawTunnel(elapsed, cy);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (video) {
      const aura = ctx.createRadialGradient(CENTER_X, 620, 270, CENTER_X, 620, 690);
      aura.addColorStop(0, hueColor(hue, 60, 0));
      aura.addColorStop(0.78, hueColor(hue, 57, 0.36 + pulse * 0.30));
      aura.addColorStop(1, hueColor(hue + 72, 66, 0.59 + pulse * 0.36));
      ctx.strokeStyle = aura;
      ctx.lineWidth = 9 + pulse * 21;
      ctx.strokeRect(7, 7, FRAME_WIDTH - 14, FRAME_HEIGHT - 14);
    } else {
      drawMandala(elapsed, cy);
    }
    bursts.forEach(event => drawBurst(event, elapsed, cy));
    ctx.restore();

    ctx.shadowColor = hueColor(hue, 58);
    ctx.shadowBlur = 20 + 28 * pulse;
    text(ctx, label, CENTER_X, video ? 1005 : 722, '900 103px system-ui, sans-serif', '#f8f4ff');
    ctx.shadowBlur = 0;
    drawTitle(video ? 1091 : 294);
    drawSpectrum(INSET, 1200, CONTENT_WIDTH, 140, hueColor(hue + 26, 67));
  }

  return (elapsed, progress) => {
    let label = '';
    if (!(video && style === 'pure')) {
      readAudio();
      label = readTimeline(elapsed);
    }
    if (video) {
      drawCameraCover(ctx, video, style === 'cosmos' ? 1 + pulse * 0.023 : 1);
      if (style !== 'pure') {
        ctx.fillStyle = shade;
        ctx.fillRect(0, 590, FRAME_WIDTH, FRAME_HEIGHT - 590);
      }
    } else {
      ctx.fillStyle = style === 'keys' ? metal : CHASSIS;
      ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    }

    if (style === 'keys') drawKeys(label);
    else if (style === 'orbit') drawOrbit(label);
    else if (style === 'cosmos') drawCosmos(label, elapsed);
    else drawPure(label);

    drawBrand();
    ctx.fillStyle = '#d7eee347';
    ctx.fillRect(INSET, 1230, CONTENT_WIDTH, 2);
    ctx.fillStyle = style === 'cosmos' ? hueColor(hue, 65) : EMERALD;
    ctx.fillRect(INSET, 1230, CONTENT_WIDTH * progress, 2);
  };
}

export async function encodeShortVideo(mix, cameraBlob, onProgress, signal, meta = {}) {
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
        const ready = waitForVideo(video, 'loadeddata', signal);
        video.src = cameraUrl;
        await ready;
        if (trimStart > 0) {
          const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.01) : trimStart;
          const offset = Math.min(trimStart, end);
          if (offset > 0) {
            const seek = waitForVideo(video, 'seeked', signal);
            video.currentTime = offset;
            await seek;
          }
        }
        await video.play();
        cameraReady = Boolean(video.videoWidth && video.videoHeight);
      } catch (_) {
        signal.throwIfAborted();
      }
    }

    signal.throwIfAborted();
    const drawFrame = makeFrameRenderer(ctx, cameraReady ? video : null, analyser, audioContext.sampleRate, meta);
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
    return { blob, mimeType: `video/${extension}`, filename: `orbita-maqueta-9x16.${extension}` };
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
