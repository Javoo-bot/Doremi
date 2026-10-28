import { describe, expect, it } from 'vitest';
import { foldedSemitones } from '../../src/align/dtw.js';
import { scoreTake } from '../../src/align/score.js';
import type { PitchTrack } from '../../src/align/dtw.js';
import type { Reference, ReferenceNote } from '../../src/score/types.js';

// Six bars of 2 s: three notes of 0.5 s, then a 0.5 s rest.
const tones = [48, 50, 52, 55, 53, 52, 50, 48, 55, 57, 55, 52, 50, 52, 53, 55, 53, 50];
const notes: ReferenceNote[] = tones.map((midi, i) => {
  const bar = Math.floor(i / 3) + 1;
  const startSec = (bar - 1) * 2 + (i % 3) * 0.5;
  return { midi, startBeat: startSec * 2, startSec, lengthBeats: 1, lengthSec: 0.5, bar };
});
const reference: Reference = { title: 'Generated', part: 'bass', notes };

interface Sing {
  flatBar?: { bar: number; cents: number };
  octaveBar?: number;
  lateNote?: { index: number; sec: number };
  shortNote?: number;
  skipNote?: number;
  stretch?: number;
  leadIn?: number;
}

/** A synthetic pitch track, one frame every 10 ms, with vibrato and a little wobble. */
function take(s: Sing = {}): PitchTrack {
  const stretch = s.stretch ?? 1;
  const leadIn = s.leadIn ?? 0.3;
  const end = (notes[notes.length - 1].startSec + 1.5) * stretch + leadIn + 0.5;
  const frames = [];
  for (let i = 0; i * 0.01 < end; i++) {
    const t = i * 0.01;
    let midi: number | null = null;
    notes.forEach((n, k) => {
      if (k === s.skipNote) return;
      let a = n.startSec * stretch + leadIn + 0.03;
      let b = (n.startSec + n.lengthSec) * stretch + leadIn - 0.03;
      if (k === s.lateNote?.index) { a += s.lateNote.sec; b += s.lateNote.sec; }
      if (k === s.shortNote) b = a + 0.15;
      if (t < a || t >= b) return;
      let cents = 8 * Math.sin(t * 2 * Math.PI * 5.5) + 4 * Math.sin(t * 91);
      if (s.flatBar?.bar === n.bar) cents += s.flatBar.cents;
      midi = n.midi + cents / 100 - (s.octaveBar === n.bar ? 12 : 0);
    });
    frames.push({ t: Math.round(t * 1000) / 1000, midi, voiced: midi !== null });
  }
  return { hop_sec: 0.01, frames };
}

describe('choir-part-accuracy', () => {
  it('flags bar 4 and nothing else when the singer is 30 cents flat in bar 4 only', () => {
    const r = scoreTake(reference, take({ flatBar: { bar: 4, cents: -30 } }));
    expect(r.flaggedBars).toEqual([4]);
    const bar4 = r.notes.filter((n) => n.bar === 4);
    for (const n of bar4) expect(n.deviationCents).toBeGreaterThan(-36), expect(n.deviationCents).toBeLessThan(-24);
    for (const b of r.bars.filter((b) => b.bar !== 4)) expect(b.score).toBeGreaterThanOrEqual(95);
    expect(r.bars.find((b) => b.bar === 4)!.score).toBeLessThan(90);
  });

  it('flags sharp the same way, with a positive deviation', () => {
    const r = scoreTake(reference, take({ flatBar: { bar: 2, cents: 40 } }));
    expect(r.flaggedBars).toEqual([2]);
    expect(r.notes.find((n) => n.bar === 2)!.deviationCents).toBeGreaterThan(30);
  });

  it('flags nothing on a clean take', () => {
    const r = scoreTake(reference, take());
    expect(r.flaggedBars).toEqual([]);
    expect(r.bars).toHaveLength(6);
    expect(r.bars.every((b) => b.score >= 95)).toBe(true);
  });
});

describe('forgiving rules', () => {
  it('does not penalise a take that starts late and is 8% slower', () => {
    const r = scoreTake(reference, take({ stretch: 1.08, leadIn: 0.9 }));
    expect(r.flaggedBars).toEqual([]);
    expect(r.notes.every((n) => n.deviationCents !== null && Math.abs(n.deviationCents) < 15)).toBe(true);
  });

  it('counts an octave off as correct', () => {
    const r = scoreTake(reference, take({ octaveBar: 3 }));
    expect(r.flaggedBars).toEqual([]);
    for (const n of r.notes.filter((n) => n.bar === 3)) expect(Math.abs(n.deviationCents!)).toBeLessThan(15);
  });

  it('does not penalise a small timing slip, and still reports it as late', () => {
    const r = scoreTake(reference, take({ lateNote: { index: 7, sec: 0.12 } }));
    expect(r.flaggedBars).toEqual([]);
    expect(r.notes[7].timing).toBe('on-time');
    expect(r.notes[7].score).toBeGreaterThanOrEqual(95);
  });

  it('reports a clear slip as late without moving the neighbours', () => {
    const late = scoreTake(reference, take({ lateNote: { index: 8, sec: 0.35 } }));
    expect(late.notes[8].timing).toBe('late');
    expect(late.notes[8].timingOffsetSec).toBeGreaterThan(0.25);
    expect(late.notes.filter((n) => n.index !== 8).every((n) => n.timing === 'on-time')).toBe(true);
    const same = scoreTake(reference, take({ lateNote: { index: 8, sec: 0 } }));
    expect(same.notes[8].timing).toBe('on-time');
  });
});

describe('what is wrong', () => {
  it('flags a note held too short', () => {
    const r = scoreTake(reference, take({ shortNote: 10 }));
    expect(r.notes[10].tooShort).toBe(true);
    expect(r.notes.filter((n) => n.tooShort)).toHaveLength(1);
    expect(r.flaggedBars).toEqual([4]);
  });

  it('flags a note that was not sung', () => {
    const r = scoreTake(reference, take({ skipNote: 13 }));
    expect(r.notes[13].missed).toBe(true);
    expect(r.notes[13].deviationCents).toBeNull();
    expect(r.flaggedBars).toEqual([5]);
  });

  it('gives an empty result for an empty reference', () => {
    expect(scoreTake({ ...reference, notes: [] }, take())).toEqual({ notes: [], bars: [], flaggedBars: [] });
  });
});

describe('foldedSemitones', () => {
  it('ignores octaves', () => {
    expect(foldedSemitones(48, 60)).toBe(0);
    expect(foldedSemitones(48, 49)).toBe(1);
    expect(foldedSemitones(48, 59)).toBe(1);
  });
});
