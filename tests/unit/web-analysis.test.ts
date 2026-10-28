import { describe, expect, it } from 'vitest';
import { analyse } from '../../src/web/analysis.ts';
import { barFacts } from '../../src/coaching/facts.ts';
import { fallbackTips } from '../../src/coaching/tips.ts';
import { scoreTake } from '../../src/align/score.js';
import { reference, synthTake } from '../helpers/synth-take.ts';

const run = (sing: Parameters<typeof synthTake>[0]) => {
  const pitch = synthTake(sing);
  const score = scoreTake(reference, pitch);
  return analyse(reference, pitch, { tips: fallbackTips(barFacts(score)), source: 'fallback' }, score);
};

describe('practice page data', () => {
  it('marks only the stretch that is over 50 cents off, in the right bar', () => {
    const a = run({ off: [{ bar: 4, cents: -70 }] });
    expect(a.offPitch.length).toBeGreaterThan(0);
    expect(a.offPitch.every((s) => s.bar === 4 && s.cents < -50)).toBe(true);
    const bar = a.bars.find((b) => b.bar === 4)!;
    expect(a.offPitch.every((s) => s.start >= bar.start && s.end <= bar.end + 0.02)).toBe(true);
  });

  it('marks nothing when the take is clean', () => {
    const a = run({});
    expect(a.offPitch).toEqual([]);
    expect(a.bars.every((b) => !b.flagged)).toBe(true);
  });

  it('lines the score up with where the singer started, and gives bars with times', () => {
    const a = run({});
    expect(a.shift).toBeCloseTo(0.33, 1);
    expect(a.reference[0].start).toBeCloseTo(a.shift, 5);
    expect(a.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.bars[1].start).toBeCloseTo(2 + a.shift, 5);
  });

  it('draws a take sung an octave up next to the score, not far above it', () => {
    const pitch = synthTake({});
    pitch.frames.forEach((f) => { if (f.midi !== null) f.midi += 12; });
    const a = analyse(reference, pitch, { tips: [], source: 'none' });
    // Frames on the exact edge of two touching notes could belong to either, so leave them out.
    const sung = a.take.filter((f) => f.midi !== null && a.reference.every((n) => Math.abs(f.t - n.start) > 0.02 && Math.abs(f.t - n.end) > 0.02));
    expect(sung.length).toBeGreaterThan(100);
    expect(sung.every((f) => a.reference.some((n) => f.t >= n.start && f.t < n.end && Math.abs((f.midi as number) - n.midi) < 0.5))).toBe(true);
  });

  it('links each tip to the bars it names, all of them flagged', () => {
    const a = run({ off: [{ bar: 2, cents: -35 }, { bar: 5, cents: -35 }] });
    expect(a.tips.length).toBeGreaterThan(0);
    for (const t of a.tips) {
      expect(t.bars.length).toBeGreaterThan(0);
      for (const b of t.bars) expect(a.bars.find((x) => x.bar === b)?.flagged).toBe(true);
    }
  });
});
