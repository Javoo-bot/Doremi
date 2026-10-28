import type { Reference, ReferenceNote } from '../score/types.js';
import { dtw, type PitchTrack } from './dtw.js';

export interface AlignOptions {
  /** Pitch error under this many cents earns full marks. */
  pitchToleranceCents: number;
  /** Pitch error at or over this many cents earns zero. */
  pitchZeroCents: number;
  /** A note more than this many seconds off the singer's nearby offset is early or late. */
  timingToleranceSec: number;
  /** A note held for less than this fraction of its length is too short. */
  minHoldRatio: number;
  /** A bar scoring under this is flagged. */
  flagBelow: number;
}

export const defaultOptions: AlignOptions = {
  pitchToleranceCents: 10,
  pitchZeroCents: 100,
  timingToleranceSec: 0.15,
  minHoldRatio: 0.6,
  flagBelow: 90,
};

export interface NoteResult {
  index: number;
  bar: number;
  midi: number;
  lyric?: string;
  missed: boolean;
  /** Sung minus written, in cents, octaves ignored. Negative is flat. null when the note was not sung. */
  deviationCents: number | null;
  timing: 'early' | 'late' | 'on-time' | null;
  /** Seconds late (positive) or early, after removing the singer's own drift, the median offset of the nearby notes. */
  timingOffsetSec: number | null;
  /** Sung length over written length. */
  holdRatio: number | null;
  tooShort: boolean;
  score: number;
}

export interface BarResult {
  bar: number;
  score: number;
  flagged: boolean;
}

export interface TakeScore {
  notes: NoteResult[];
  bars: BarResult[];
  flaggedBars: number[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/** Cents from b up to a, folded into [-600, 600) so an octave off reads as zero. */
export const foldedCents = (a: number, b: number): number => ((((a - b) * 100 + 600) % 1200) + 1200) % 1200 - 600;

export function scoreTake(reference: Reference, take: PitchTrack, options: Partial<AlignOptions> = {}): TakeScore {
  const o = { ...defaultOptions, ...options };
  const hop = take.hop_sec;
  const notes = reference.notes;
  if (notes.length === 0) return { notes: [], bars: [], flaggedBars: [] };

  // Reference on the take's frame grid. Rests are null. Rest padding lets the take start late or end late.
  const pad = 200;
  const lastEnd = Math.max(...notes.map((n) => n.startSec + n.lengthSec));
  const refGrid: (number | null)[] = new Array(pad + Math.ceil(lastEnd / hop) + pad).fill(null);
  const range = (n: ReferenceNote): [number, number] => {
    const a = pad + Math.round(n.startSec / hop);
    return [a, Math.max(a + 1, pad + Math.round((n.startSec + n.lengthSec) / hop))];
  };
  const owner = new Int32Array(refGrid.length).fill(-1);
  notes.forEach((n, k) => {
    const [a, b] = range(n);
    for (let j = a; j < b && j < refGrid.length; j++) { refGrid[j] = n.midi; owner[j] = k; }
  });
  const takeGrid = [
    ...new Array(pad).fill(null),
    ...take.frames.map((f) => (f.voiced ? f.midi : null)),
    ...new Array(pad).fill(null),
  ];

  const path = dtw(takeGrid, refGrid);
  const sung: number[][] = notes.map(() => []);
  for (const [i, j] of path) {
    const k = owner[j];
    const fi = i - pad;
    if (k >= 0 && fi >= 0 && fi < take.frames.length && take.frames[fi].voiced && take.frames[fi].midi !== null) {
      if (sung[k][sung[k].length - 1] !== fi) sung[k].push(fi);
    }
  }

  const raw = notes.map((n, k) => {
    const idx = sung[k];
    if (idx.length === 0) return null;
    // Leave out the attack and release, where the voice is still settling.
    const trim = idx.length > 5 ? Math.floor(idx.length * 0.2) : 0;
    const core = idx.slice(trim, idx.length - Math.floor(trim / 2));
    const dev = median(core.map((fi) => foldedCents(take.frames[fi].midi as number, n.midi)));
    const first = take.frames[idx[0]].t;
    const last = take.frames[idx[idx.length - 1]].t;
    return { dev, onset: first - n.startSec, hold: (last - first + hop) / n.lengthSec };
  });
  // The singer's own tempo and start drift, taken as the median onset offset of the nearby notes.
  const localOffset = (k: number): number => {
    const near = raw.slice(Math.max(0, k - 4), k + 5).filter((r) => r !== null).map((r) => r.onset);
    return median(near);
  };

  const results: NoteResult[] = notes.map((n, k) => {
    const r = raw[k];
    const base = { index: k, bar: n.bar, midi: n.midi, ...(n.lyric !== undefined ? { lyric: n.lyric } : {}) };
    if (!r) {
      return { ...base, missed: true, deviationCents: null, timing: null, timingOffsetSec: null, holdRatio: null, tooShort: false, score: 0 };
    }
    const rel = r.onset - localOffset(k);
    const timing = Math.abs(rel) <= o.timingToleranceSec ? 'on-time' : rel < 0 ? 'early' : 'late';
    const tooShort = r.hold < o.minHoldRatio;
    const pitch = Math.min(1, Math.max(0, (o.pitchZeroCents - Math.abs(r.dev)) / (o.pitchZeroCents - o.pitchToleranceCents)));
    const slip = Math.max(0, Math.abs(rel) - o.timingToleranceSec);
    const timingFactor = Math.max(0.5, 1 - slip);
    const holdFactor = tooShort ? Math.max(0, r.hold / o.minHoldRatio) * 0.8 : 1;
    return {
      ...base, missed: false, deviationCents: round(r.dev), timing, timingOffsetSec: round(rel, 3),
      holdRatio: round(r.hold, 2), tooShort, score: round(100 * pitch * timingFactor * holdFactor, 1),
    };
  });

  const byBar = new Map<number, { sum: number; weight: number }>();
  results.forEach((r, k) => {
    const w = notes[k].lengthSec;
    const b = byBar.get(r.bar) ?? { sum: 0, weight: 0 };
    b.sum += r.score * w;
    b.weight += w;
    byBar.set(r.bar, b);
  });
  const bars = [...byBar.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bar, { sum, weight }]) => {
      const score = round(sum / weight, 1);
      return { bar, score, flagged: score < o.flagBelow };
    });
  return { notes: results, bars, flaggedBars: bars.filter((b) => b.flagged).map((b) => b.bar) };
}

function round(x: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
