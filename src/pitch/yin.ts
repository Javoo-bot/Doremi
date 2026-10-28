import { spawnSync } from 'node:child_process';
import type { PitchTrack } from '../align/dtw.js';

const SAMPLE_RATE = 16000;
const HOP = 160; // 10 ms, same grid as pitch/track.py
const WINDOW = 1024;
const FMIN = 50;
const FMAX = 1000;
const THRESHOLD = 0.15;
const MIN_RMS = 0.003; // about -50 dB, quieter is silence

/** Mono float32 at 16 kHz through ffmpeg. Reads any format ffmpeg reads. */
export function decode(input: Buffer): Float32Array {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], {
    input,
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`ffmpeg could not read the audio: ${r.stderr?.toString().trim() ?? 'not found'}`);
  const out = r.stdout;
  if (out.length < 4) throw new Error('the file has no audio');
  return new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length - (out.length % 4)));
}

/** YIN on one window. Returns Hz or null when the frame is not clearly pitched. */
function yin(x: Float32Array, start: number): number | null {
  const maxTau = Math.floor(SAMPLE_RATE / FMIN);
  const minTau = Math.floor(SAMPLE_RATE / FMAX);
  const half = WINDOW - maxTau;
  let energy = 0;
  for (let i = 0; i < WINDOW; i++) energy += x[start + i] ** 2;
  if (Math.sqrt(energy / WINDOW) < MIN_RMS) return null;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) {
      const diff = x[start + i] - x[start + i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  const cm = new Float32Array(maxTau + 1);
  cm[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cm[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }
  let tau = -1;
  for (let t = minTau; t < maxTau; t++) {
    if (cm[t] < THRESHOLD) {
      while (t + 1 < maxTau && cm[t + 1] < cm[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation around the minimum.
  const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1];
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (a - c) / (2 * denom);
  return SAMPLE_RATE / (tau + shift);
}

/** Median of five, so a stray octave jump in one frame does not draw a spike. */
function smooth(midis: (number | null)[]): (number | null)[] {
  return midis.map((m, i) => {
    if (m === null) return null;
    const near = midis.slice(Math.max(0, i - 2), i + 3).filter((v): v is number => v !== null).sort((p, q) => p - q);
    return near[near.length >> 1];
  });
}

/** Same shape as the output of `python pitch/track.py`, one frame every 10 ms. */
export function trackPitch(audio: Float32Array): PitchTrack {
  const n = Math.floor(audio.length / HOP) + 1;
  const padded = new Float32Array(audio.length + 2 * WINDOW);
  padded.set(audio, WINDOW / 2);
  const raw: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const hz = yin(padded, i * HOP);
    raw.push(hz === null ? null : 69 + 12 * Math.log2(hz / 440));
  }
  const midis = smooth(raw);
  return {
    hop_sec: HOP / SAMPLE_RATE,
    frames: midis.map((midi, i) => ({
      t: Math.round(i * HOP / SAMPLE_RATE * 1000) / 1000,
      midi: midi === null ? null : Math.round(midi * 100) / 100,
      voiced: midi !== null,
    })),
  };
}

export function trackBuffer(input: Buffer): PitchTrack {
  return trackPitch(decode(input));
}
