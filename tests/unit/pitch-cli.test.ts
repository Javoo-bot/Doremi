import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const python = process.env.PITCH_PYTHON ?? 'python3';
const ready = spawnSync(python, ['-c', 'import torch, torchcrepe, numpy']).status === 0;
if (!ready) console.warn(`pitch CLI test skipped: ${python} has no torch/torchcrepe (pip install -r pitch/requirements.txt)`);

describe.skipIf(!ready)('pitch tracker CLI from Node', () => {
  it('prints about 100 frames a second, with unvoiced gaps and 10 cent pitch', () => {
    const r = spawnSync(python, ['pitch/track.py', 'tests/fixtures/takes/satb-bass.ogg'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { hop_sec: number; frames: { t: number; midi: number | null; voiced: boolean }[] };
    expect(out.hop_sec).toBeCloseTo(0.01);
    expect(out.frames.length).toBeGreaterThan(800);
    // First 0.2 s is the silent lead-in; the first note (bass C3, MIDI 48) starts at 0.3 s.
    expect(out.frames.filter((f) => f.t < 0.2).every((f) => !f.voiced && f.midi === null)).toBe(true);
    const first = out.frames.filter((f) => f.t > 0.4 && f.t < 0.55);
    expect(first.every((f) => f.voiced && Math.abs((f.midi as number) - 48) < 0.3)).toBe(true);
  }, 120000);

  it('fails with a message on a file that is not audio', () => {
    const r = spawnSync(python, ['pitch/track.py', 'package.json'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ffmpeg could not read');
  });
});
