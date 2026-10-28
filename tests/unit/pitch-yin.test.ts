import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { trackBuffer } from '../../src/pitch/yin.ts';

const truth = JSON.parse(readFileSync('tests/fixtures/takes/satb-bass.truth.json', 'utf8')) as { start: number; end: number; midi: number }[];

describe('built-in pitch tracker', () => {
  it('finds each sung note within 30 cents and leaves the gaps unvoiced', () => {
    const track = trackBuffer(readFileSync('tests/fixtures/takes/satb-bass.wav'));
    expect(track.hop_sec).toBeCloseTo(0.01);
    for (const n of truth) {
      const mid = track.frames.filter((f) => f.t > n.start + 0.08 && f.t < n.end - 0.08);
      expect(mid.length).toBeGreaterThan(3);
      for (const f of mid) {
        expect(f.voiced).toBe(true);
        expect(Math.abs((f.midi as number) - n.midi)).toBeLessThan(0.3);
      }
    }
    expect(track.frames.filter((f) => f.t < 0.2).every((f) => !f.voiced && f.midi === null)).toBe(true);
  });

  it('refuses a file that is not audio', () => {
    expect(() => trackBuffer(readFileSync('package.json'))).toThrow(/ffmpeg could not read/);
  });
});
