import type { PitchTrack } from '../align/dtw.js';
import { foldedCents, scoreTake, type TakeScore } from '../align/score.js';
import { barsNamed } from '../coaching/tips.ts';
import type { Reference } from '../score/types.js';

/** A stretch this far off the written note, in cents, is marked on the graph. */
export const OFF_PITCH_CENTS = 50;
/** Shortest stretch worth marking, in seconds. */
const MIN_STRETCH_SEC = 0.1;

export interface Analysis {
  title: string;
  duration: number;
  /** Seconds the score's line is moved right to line up with where the singer started. */
  shift: number;
  take: { t: number; midi: number | null }[];
  reference: { start: number; end: number; midi: number; bar: number; lyric?: string }[];
  bars: { bar: number; start: number; end: number; score: number; flagged: boolean }[];
  offPitch: { start: number; end: number; cents: number; bar: number }[];
  tips: { text: string; bars: number[] }[];
  tipSource: string;
}

/** The take's pitch moved by whole octaves to sit next to the note it should match. */
const foldTo = (midi: number, ref: number): number => ref + foldedCents(midi, ref) / 100;

export function analyse(
  reference: Reference,
  pitch: PitchTrack,
  tips: { tips: string[]; source: string },
  score: TakeScore = scoreTake(reference, pitch),
): Analysis {
  const firstSung = pitch.frames.find((f) => f.voiced);
  const firstNote = reference.notes[0];
  const shift = firstSung && firstNote ? Math.round((firstSung.t - firstNote.startSec) * 100) / 100 : 0;
  const notes = reference.notes.map((n) => ({ start: n.startSec + shift, end: n.startSec + n.lengthSec + shift, midi: n.midi, bar: n.bar, ...(n.lyric ? { lyric: n.lyric } : {}) }));
  const noteAt = (t: number) => notes.find((n) => t >= n.start && t < n.end);

  const take = pitch.frames.map((f) => {
    const n = f.voiced && f.midi !== null ? noteAt(f.t) : undefined;
    const midi = f.voiced && f.midi !== null ? (n ? foldTo(f.midi, n.midi) : f.midi) : null;
    return { t: f.t, midi: midi === null ? null : Math.round(midi * 100) / 100 };
  });

  // Off-pitch stretches: runs of frames inside a note that are over the limit on the same side.
  const offPitch: Analysis['offPitch'] = [];
  let run: { start: number; end: number; sum: number; count: number; bar: number; sign: number } | null = null;
  const close = () => {
    if (run && run.end - run.start >= MIN_STRETCH_SEC) {
      offPitch.push({ start: run.start, end: run.end, cents: Math.round(run.sum / run.count), bar: run.bar });
    }
    run = null;
  };
  for (const f of pitch.frames) {
    const n = f.voiced && f.midi !== null ? noteAt(f.t) : undefined;
    const cents = n && f.midi !== null ? foldedCents(f.midi, n.midi) : 0;
    if (n && Math.abs(cents) > OFF_PITCH_CENTS) {
      const sign = Math.sign(cents);
      if (run && (run.sign !== sign || run.bar !== n.bar || f.t - run.end > pitch.hop_sec * 3)) close();
      run = run ?? { start: f.t, end: f.t, sum: 0, count: 0, bar: n.bar, sign };
      run.end = f.t + pitch.hop_sec;
      run.sum += cents;
      run.count++;
    } else close();
  }
  close();

  const bars = score.bars.map((b) => {
    const inBar = notes.filter((n) => n.bar === b.bar);
    return { bar: b.bar, start: Math.min(...inBar.map((n) => n.start)), end: Math.max(...inBar.map((n) => n.end)), score: b.score, flagged: b.flagged };
  });
  const last = pitch.frames[pitch.frames.length - 1]?.t ?? 0;
  return {
    title: reference.title,
    duration: Math.max(last, ...notes.map((n) => n.end)),
    shift,
    take,
    reference: notes,
    bars,
    offPitch,
    tips: tips.tips.map((text) => ({ text, bars: barsNamed(text) })),
    tipSource: tips.source,
  };
}
