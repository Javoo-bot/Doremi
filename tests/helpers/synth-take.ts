import type { PitchTrack } from '../../src/align/dtw.js';
import type { Reference, ReferenceNote } from '../../src/score/types.js';

// Six bars of 2 s: three notes of 0.5 s, then a 0.5 s rest. Each note has a syllable.
const tones = [48, 50, 52, 55, 53, 52, 50, 48, 55, 57, 55, 52, 50, 52, 53, 55, 53, 50];
const syllables = ['Can', 'ta', 'el', 'ga', 'llo', 'ne', 'gre', 'a', 'la', 'ma', 'ti', 'nat', 'a', 'dal', 'la', 'ro', 'ig', 'ge'];
export const notes: ReferenceNote[] = tones.map((midi, i) => {
  const bar = Math.floor(i / 3) + 1;
  const startSec = (bar - 1) * 2 + (i % 3) * 0.5;
  return { midi, startBeat: startSec * 2, startSec, lengthBeats: 1, lengthSec: 0.5, bar, lyric: syllables[i] };
});
export const reference: Reference = { title: 'Cançó de prova', part: 'bass', notes };

export interface Sing {
  /** Cents off for every note in a bar. Negative is flat. */
  off?: { bar: number; cents: number }[];
  /** Index of a note that starts this many seconds late. */
  lateNote?: { index: number; sec: number };
  shortNote?: number;
  skipNote?: number;
}

/** A synthetic pitch track, one frame every 10 ms, with vibrato and a little wobble. */
export function synthTake(s: Sing = {}): PitchTrack {
  const leadIn = 0.3;
  const end = notes[notes.length - 1].startSec + 1.5 + leadIn + 0.5;
  const frames = [];
  for (let i = 0; i * 0.01 < end; i++) {
    const t = i * 0.01;
    let midi: number | null = null;
    notes.forEach((n, k) => {
      if (k === s.skipNote) return;
      let a = n.startSec + leadIn + 0.03;
      let b = n.startSec + n.lengthSec + leadIn - 0.03;
      if (k === s.lateNote?.index) { a += s.lateNote.sec; b += s.lateNote.sec; }
      if (k === s.shortNote) b = a + 0.15;
      if (t < a || t >= b) return;
      let cents = 8 * Math.sin(t * 2 * Math.PI * 5.5) + 4 * Math.sin(t * 91);
      for (const o of s.off ?? []) if (o.bar === n.bar) cents += o.cents;
      midi = n.midi + cents / 100;
    });
    frames.push({ t: Math.round(t * 1000) / 1000, midi, voiced: midi !== null });
  }
  return { hop_sec: 0.01, frames };
}

/** Ten takes, each with known mistakes. `bad` is what the singer was told is wrong, checked against the scorer in the tests. */
export const takes: { name: string; sing: Sing; bad: number[] }[] = [
  { name: 'flat in bar 4', sing: { off: [{ bar: 4, cents: -30 }] }, bad: [4] },
  { name: 'sharp in bar 2', sing: { off: [{ bar: 2, cents: 40 }] }, bad: [2] },
  { name: 'very flat in bar 1', sing: { off: [{ bar: 1, cents: -50 }] }, bad: [1] },
  { name: 'sharp in bar 6', sing: { off: [{ bar: 6, cents: 35 }] }, bad: [6] },
  { name: 'flat in bars 2 and 5', sing: { off: [{ bar: 2, cents: -35 }, { bar: 5, cents: -35 }] }, bad: [2, 5] },
  { name: 'flat in bar 3, sharp in bar 6', sing: { off: [{ bar: 3, cents: -40 }, { bar: 6, cents: 40 }] }, bad: [3, 6] },
  { name: 'note held too short in bar 4', sing: { shortNote: 10 }, bad: [4] },
  { name: 'note not sung in bar 5', sing: { skipNote: 13 }, bad: [5] },
  { name: 'flat in bar 1, note not sung in bar 3', sing: { off: [{ bar: 1, cents: -30 }], skipNote: 7 }, bad: [1, 3] },
  { name: 'flat in bars 2, 4 and 6', sing: { off: [{ bar: 2, cents: -30 }, { bar: 4, cents: -30 }, { bar: 6, cents: -30 }] }, bad: [2, 4, 6] },
];
