const VOICE_FILTER_PRESETS = [
  { bleedStrength: 0, noiseStrength: 0, minGain: 1, roomDecay: 0, highpassHz: 40, deMudDb: 0, presenceDb: 0, lowpassHz: 20000 },
  { bleedStrength: 0.75, noiseStrength: 0.55, minGain: 0.28, roomDecay: 0.45, highpassHz: 95, deMudDb: -2, presenceDb: 1.5, lowpassHz: 15000 },
  { bleedStrength: 1.35, noiseStrength: 0.90, minGain: 0.11, roomDecay: 0.55, highpassHz: 135, deMudDb: -3.5, presenceDb: 2.8, lowpassHz: 12000 },
  { bleedStrength: 2.15, noiseStrength: 1.25, minGain: 0.035, roomDecay: 0.65, highpassHz: 175, deMudDb: -5, presenceDb: 4, lowpassHz: 9500 }
];

export function getVoiceFilterPreset(level) {
  const preset = Number.isInteger(level) ? VOICE_FILTER_PRESETS[level] : null;
  return { ...(preset ?? VOICE_FILTER_PRESETS[0]) };
}

export const COUNT_IN_MAX_LAG_MS = 340;

export function measureAcousticLagFromCountIn(countInVoiceSamples, clickOffsetsSamples, sampleRate) {
  const missed = confidence => ({ detected: false, lagMs: null, offsetMs: null, bleedDetected: false, confidence });
  if (!countInVoiceSamples || clickOffsetsSamples?.length !== 4 || !Number.isFinite(sampleRate) || sampleRate <= 0) return missed(0);
  for (const offset of clickOffsetsSamples) {
    if (!Number.isInteger(offset) || offset < 0) return missed(0);
  }

  const firstLagMs = 15;
  const scores = new Float64Array(COUNT_IN_MAX_LAG_MS - firstLagMs + 1);
  const halfWindow = sampleRate / 2000;
  let length = 0;
  let peak = 0;
  let peakIndex = 0;
  let weakestClick = 0;
  let lagMs = null;
  for (let lag = firstLagMs; lag <= COUNT_IN_MAX_LAG_MS; lag++) {
    const lagSamples = lag * sampleRate / 1000;
    let score = 0;
    let weakest = Infinity;
    for (const offset of clickOffsetsSamples) {
      const start = Math.round(offset + lagSamples - halfWindow);
      const end = Math.round(offset + lagSamples + halfWindow);
      if (start < 1 || end <= start || end > countInVoiceSamples.length) {
        score = -1;
        break;
      }
      let attack = 0;
      for (let i = start; i < end; i++) attack += Math.abs(countInVoiceSamples[i] - countInVoiceSamples[i - 1]);
      attack /= end - start;
      score += attack;
      weakest = Math.min(weakest, attack);
    }
    if (score < 0) continue;
    scores[length++] = score;
    if (score > peak) {
      peak = score;
      peakIndex = length - 1;
      weakestClick = weakest;
      lagMs = lag;
    }
  }
  const ranked = scores.slice(0, length).sort();
  const background = ranked[Math.floor(ranked.length / 2)] ?? 0;
  const confidence = peak / Math.max(1e-9, background);
  if (lagMs === null || peak < 0.001 || confidence < 3.2 || weakestClick < Math.max(0.0001, background * 0.375)) {
    return missed(confidence);
  }
  // El clic de la claqueta sube durante 2 ms. Buscar el ataque junto al máximo evita sumar esa rampa a la latencia.
  const onset = background + 0.28 * (peak - background);
  for (let i = peakIndex - 1; i >= Math.max(0, peakIndex - 2) && scores[i] >= onset; i--) lagMs--;
  return { detected: true, lagMs, offsetMs: -lagMs, bleedDetected: true, confidence };
}

function createFft(size) {
  const reversed = new Uint16Array(size);
  for (let i = 1; i < size; i++) reversed[i] = (reversed[i >> 1] >> 1) | ((i & 1) * (size >> 1));
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let k = 0; k < cos.length; k++) {
    const phase = 2 * Math.PI * k / size;
    cos[k] = Math.cos(phase);
    sin[k] = Math.sin(phase);
  }

  return (real, imag, inverse = false) => {
    for (let i = 0; i < size; i++) {
      const j = reversed[i];
      if (j <= i) continue;
      const r = real[i];
      const q = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = r;
      imag[j] = q;
    }
    const sign = inverse ? 1 : -1;
    for (let span = 2; span <= size; span *= 2) {
      const half = span / 2;
      const stride = size / span;
      for (let start = 0; start < size; start += span) {
        for (let j = 0; j < half; j++) {
          const k = j * stride;
          const a = start + j;
          const b = a + half;
          const s = sign * sin[k];
          const r = cos[k] * real[b] - s * imag[b];
          const q = cos[k] * imag[b] + s * real[b];
          real[b] = real[a] - r;
          imag[b] = imag[a] - q;
          real[a] += r;
          imag[a] += q;
        }
      }
    }
  };
}

// Los histogramas logarítmicos estiman percentiles sin guardar la STFT de toda la toma.
const HISTOGRAM_BINS = 256;
const HISTOGRAM_ZERO = 192;
const HISTOGRAM_STEPS_PER_OCTAVE = 6;

function addPower(histogram, bin, power) {
  const step = Math.floor(Math.log2(power) * HISTOGRAM_STEPS_PER_OCTAVE + HISTOGRAM_ZERO);
  histogram[bin * HISTOGRAM_BINS + Math.max(0, Math.min(HISTOGRAM_BINS - 1, step))]++;
}

function readPowerPercentile(histogram, bin, count, percentile) {
  if (!count) return 0;
  let remaining = Math.ceil(count * percentile);
  const offset = bin * HISTOGRAM_BINS;
  for (let step = 0; step < HISTOGRAM_BINS; step++) {
    remaining -= histogram[offset + step];
    if (remaining <= 0) return step === 0 ? 0 : 2 ** ((step + 0.5 - HISTOGRAM_ZERO) / HISTOGRAM_STEPS_PER_OCTAVE);
  }
  return 0;
}

function smoothBand(values, k, lastBin) {
  return 0.125 * values[Math.max(0, k - 1)] + 0.75 * values[k] + 0.125 * values[Math.min(lastBin, k + 1)];
}

export function buildFilteredVoiceSamples(rawVoiceSamples, musicSamples, sampleRate, level, voiceOffsetMs = 0) {
  const preset = getVoiceFilterPreset(level);
  if (!preset.noiseStrength || !rawVoiceSamples.length) return rawVoiceSamples.slice();

  const length = rawVoiceSamples.length;
  const size = sampleRate >= 32000 ? 2048 : 1024;
  const hop = size / 4;
  const lastBin = size / 2;
  const bins = lastBin + 1;
  const shift = Math.round((Number(voiceOffsetMs) || 0) * sampleRate / 1000);
  const fft = createFft(size);
  const hann = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const voiceReal = new Float64Array(size);
  const voiceImag = new Float64Array(size);
  const musicReal = new Float64Array(size);
  const musicImag = new Float64Array(size);
  const musicRoom = new Float64Array(bins);
  const voicePower = new Float64Array(bins);
  const ratioHistogram = new Uint32Array(bins * HISTOGRAM_BINS);
  const noiseHistogram = new Uint32Array(bins * HISTOGRAM_BINS);
  const ratioCounts = new Uint32Array(bins);
  // La referencia de la sesión puede leer música y base sin materializar otra pista completa.
  const readMusic = typeof musicSamples === 'function' ? musicSamples : i => musicSamples?.[i] ?? 0;

  function analyse(start) {
    for (let i = 0; i < size; i++) {
      voiceReal[i] = (rawVoiceSamples[start + i] ?? 0) * hann[i];
      musicReal[i] = readMusic(start + i + shift) * hann[i];
    }
    voiceImag.fill(0);
    musicImag.fill(0);
    fft(voiceReal, voiceImag);
    fft(musicReal, musicImag);
    let musicPeak = 0;
    for (let k = 0; k < bins; k++) {
      voicePower[k] = voiceReal[k] ** 2 + voiceImag[k] ** 2;
      musicRoom[k] = musicReal[k] ** 2 + musicImag[k] ** 2 + preset.roomDecay * musicRoom[k];
      musicPeak = Math.max(musicPeak, musicRoom[k]);
    }
    return musicPeak;
  }

  const firstFrame = hop - size;
  let noiseCount = 0;
  for (let start = firstFrame; start < length; start += hop) {
    const musicFloor = Math.max(1e-8, analyse(start) * 1e-5);
    // El relleno de los bordes reduciría artificialmente los percentiles.
    if (length >= size && (start < 0 || start + size > length)) continue;
    for (let k = 0; k < bins; k++) {
      addPower(noiseHistogram, k, voicePower[k]);
      if (musicRoom[k] <= musicFloor) continue;
      addPower(ratioHistogram, k, voicePower[k] / musicRoom[k]);
      ratioCounts[k]++;
    }
    noiseCount++;
  }

  const transfer = new Float64Array(bins);
  const noise = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    transfer[k] = readPowerPercentile(ratioHistogram, k, ratioCounts[k], 0.20);
    noise[k] = readPowerPercentile(noiseHistogram, k, noiseCount, 0.15);
  }
  const bleed = transfer.map((power, k) => {
    if (!ratioCounts[k]) return 0;
    const prev = Math.max(0, k - 1);
    const next = Math.min(lastBin, k + 1);
    return 0.125 * (ratioCounts[prev] ? transfer[prev] : power)
      + 0.75 * power + 0.125 * (ratioCounts[next] ? transfer[next] : power);
  });

  const gains = new Float64Array(bins);
  const previousGains = new Float64Array(bins).fill(1);
  const result = new Float32Array(length);
  musicRoom.fill(0);
  // Cuatro Hann periódicas al cuadrado suman 1.5. La IFFT sin escalar aporta el factor size.
  const scale = 1 / (size * 1.5);
  for (let start = firstFrame; start < length; start += hop) {
    analyse(start);
    for (let k = 0; k < bins; k++) {
      const unwanted = preset.bleedStrength * bleed[k] * musicRoom[k] + preset.noiseStrength * noise[k];
      const cleanPower = Math.max(0, voicePower[k] - unwanted);
      gains[k] = cleanPower / (cleanPower + unwanted + 1e-12);
    }
    for (let k = 0; k < bins; k++) {
      const smoothed = smoothBand(gains, k, lastBin);
      const gain = Math.max(preset.minGain, Math.min(1, 0.8 * smoothed + 0.2 * previousGains[k]));
      previousGains[k] = gain;
      voiceReal[k] *= gain;
      voiceImag[k] *= gain;
      if (k > 0 && k < lastBin) {
        voiceReal[size - k] *= gain;
        voiceImag[size - k] *= gain;
      }
    }
    fft(voiceReal, voiceImag, true);
    const end = Math.min(size, length - start);
    for (let i = Math.max(0, -start); i < end; i++) result[start + i] += voiceReal[i] * hann[i] * scale;
  }
  return result;
}
