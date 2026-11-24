/** Captura frontal sin audio y exportación vertical con la mezcla de la maqueta. */

import { ensureAudioUnlocked } from './audio-core.js';

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
const CYAN = '#22d3ee';
const AMBER = '#fbbf24';
const TITLE_FONT = '800 56px system-ui, sans-serif';
const MONO_FONT = '600 24px monospace';

function drawCameraCover(ctx, video) {
  const scale = Math.max(FRAME_WIDTH / video.videoWidth, FRAME_HEIGHT / video.videoHeight);
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

function makeFrameRenderer(ctx, video, analyser, sampleRate, meta) {
  const center = FRAME_WIDTH / 2;
  const orbitY = 600;
  const background = ctx.createRadialGradient(center, orbitY, 0, center, orbitY, 690);
  background.addColorStop(0, '#171a20');
  background.addColorStop(1, '#090a0d');
  const shade = ctx.createLinearGradient(0, 548, 0, FRAME_HEIGHT);
  shade.addColorStop(0, '#090a0d00');
  shade.addColorStop(0.72, '#090a0dd9');
  shade.addColorStop(1, '#090a0dfc');
  const oled = ctx.createLinearGradient(INSET, 0, FRAME_WIDTH - INSET, 0);
  oled.addColorStop(0, EMERALD);
  oled.addColorStop(0.52, CYAN);
  oled.addColorStop(1, AMBER);

  const grid = new Path2D();
  for (let x = 24; x < FRAME_WIDTH; x += 24) {
    grid.moveTo(x, 0);
    grid.lineTo(x, FRAME_HEIGHT);
  }
  for (let y = 24; y < FRAME_HEIGHT; y += 24) {
    grid.moveTo(0, y);
    grid.lineTo(FRAME_WIDTH, y);
  }

  const titleLines = getTitleLines(ctx, meta.title?.trim().slice(0, 40));
  const details = [meta.keyLabel, meta.bpm && `${meta.bpm} BPM`, meta.soundName].filter(Boolean).join(' · ');
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Float32Array(analyser.fftSize);
  const maxFrequency = Math.min(13000, sampleRate / 2);
  const bandEdges = Array.from({ length: BAR_COUNT + 1 }, (_, i) => {
    const hz = 45 * (maxFrequency / 45) ** (i / BAR_COUNT);
    return Math.min(spectrum.length - 1, Math.floor(hz * analyser.fftSize / sampleRate));
  });
  let pulse = 0;

  function drawBrand() {
    ctx.beginPath();
    ctx.roundRect(INSET, INSET, CONTENT_WIDTH, video ? 113 : 70, 18);
    ctx.fillStyle = video ? '#141518de' : '#141518';
    ctx.fill();
    ctx.strokeStyle = '#d8f4f426';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(INSET + 26, 84, 5, 0, Math.PI * 2);
    ctx.fillStyle = EMERALD;
    ctx.shadowColor = EMERALD;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = '800 30px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0f8f7';
    ctx.fillText('ÓRBITA', INSET + 44, 95);
    if (video) drawDetails(INSET + 20, 135, 'left');
  }

  function drawDetails(x, y, align) {
    ctx.textAlign = align;
    ctx.fillStyle = '#c3d3d8';
    ctx.font = MONO_FONT;
    ctx.fillText(details, x, y, CONTENT_WIDTH - 40);
  }

  function drawOrbit(elapsed) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.strokeStyle = '#75bbca10';
    ctx.lineWidth = 1;
    ctx.stroke(grid);
    const angle = elapsed * 0.85;
    for (let ring = 0; ring < 5; ring++) {
      const radius = 65 + ring * 32 + pulse * (24 + ring * 4);
      ctx.beginPath();
      ctx.arc(center, orbitY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(52, 211, 185, ${0.16 + pulse * 0.36})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const start = angle + ring * 1.2;
      ctx.beginPath();
      ctx.arc(center, orbitY, radius, start, start + 0.48 + pulse * 0.53);
      ctx.strokeStyle = ring < 2 ? EMERALD : ring < 4 ? CYAN : AMBER;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10 + pulse * 10;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(center, orbitY, 7 + pulse * 18, 0, Math.PI * 2);
    ctx.fillStyle = EMERALD;
    ctx.shadowColor = EMERALD;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawSpectrum(baseline) {
    const step = CONTENT_WIDTH / BAR_COUNT;
    ctx.beginPath();
    for (let i = 0; i < BAR_COUNT; i++) {
      const end = Math.max(bandEdges[i] + 1, bandEdges[i + 1]);
      let peak = 0;
      for (let bin = bandEdges[i]; bin < end; bin++) peak = Math.max(peak, spectrum[bin]);
      const strength = (peak / 255) ** 1.8;
      const height = 3 + strength * (video ? 132 : 110);
      const x = INSET + i * step + (step - 8) / 2;
      ctx.roundRect(x, baseline - height, 8, height, 3);
      if (!video) ctx.roundRect(x, baseline + 7, 8, 3 + strength * 73, 3);
    }
    ctx.fillStyle = oled;
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  return (elapsed, progress) => {
    analyser.getByteFrequencyData(spectrum);
    analyser.getFloatTimeDomainData(waveform);
    let power = 0;
    for (const sample of waveform) power += sample * sample;
    const energy = Math.min(1, Math.sqrt(power / waveform.length) * 3.6);
    pulse += (energy - pulse) * (energy > pulse ? 0.45 : 0.16);

    if (video) {
      drawCameraCover(ctx, video);
      ctx.fillStyle = shade;
      ctx.fillRect(0, 548, FRAME_WIDTH, FRAME_HEIGHT - 548);
    } else {
      drawOrbit(elapsed);
      drawDetails(center, titleLines.length ? 281 : 244, 'center');
    }
    drawBrand();
    if (titleLines.length) {
      ctx.textAlign = video ? 'left' : 'center';
      ctx.font = TITLE_FONT;
      ctx.fillStyle = '#f0f8f7';
      const lastBaseline = video ? 970 : 250;
      titleLines.forEach((line, index) => {
        const baseline = lastBaseline - 62 * (titleLines.length - 1 - index);
        ctx.fillText(line, video ? INSET : center, baseline, CONTENT_WIDTH);
      });
    }
    drawSpectrum(video ? 1168 : 988);
    ctx.fillStyle = '#b9d8e040';
    ctx.fillRect(INSET, 1218, CONTENT_WIDTH, 3);
    ctx.fillStyle = oled;
    ctx.fillRect(INSET, 1218, CONTENT_WIDTH * progress, 3);
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
