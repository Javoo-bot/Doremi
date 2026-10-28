import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { matchNotes, notesFromFrames, type PitchFrame } from '../../src/reference/audio.ts';
import { attachLyrics, docxWords } from '../../src/reference/lyrics.ts';
import { readReference } from '../../src/score/index.ts';
import type { AudioReference } from '../../src/score/types.ts';

/** Frames every 10 ms from [midi, seconds] pieces; midi null is silence. */
function frames(pieces: [number | null, number][], jitter = 0): PitchFrame[] {
  const out: PitchFrame[] = [];
  let i = 0;
  for (const [midi, sec] of pieces) {
    for (let k = 0; k < Math.round(sec * 100); k++, i++) {
      const wobble = midi === null ? 0 : jitter * Math.sin(i * 0.9);
      out.push({ t: Math.round(i * 10) / 1000, midi: midi === null ? null : midi + wobble, confidence: midi === null ? 0.1 : 0.9, voiced: midi !== null });
    }
  }
  return out;
}

describe('notes from a pitch curve', () => {
  it('rounds each steady stretch to the nearest semitone and keeps the octave as heard', () => {
    const notes = notesFromFrames(frames([[null, 0.2], [48.3, 0.5], [null, 0.1], [36.4, 0.4]]));
    expect(notes.map((n) => n.midi)).toEqual([48, 36]);
    expect(Math.abs(notes[0].startSec - 0.2)).toBeLessThan(0.01);
    expect(notes[0].lengthSec).toBeCloseTo(0.5, 2);
    expect(Math.abs(notes[1].startSec - 0.8)).toBeLessThan(0.01);
  });

  it('survives vibrato around a pitch without splitting the note', () => {
    const notes = notesFromFrames(frames([[45, 1]], 0.3));
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(45);
  });

  it('drops stretches shorter than 80 ms and keeps ones of 80 ms', () => {
    expect(notesFromFrames(frames([[50, 0.06], [null, 0.2]]))).toHaveLength(0);
    expect(notesFromFrames(frames([[50, 0.08], [null, 0.2]]))).toHaveLength(1);
  });

  it('splits a change of pitch with no silence between', () => {
    const notes = notesFromFrames(frames([[45, 0.4], [47, 0.4]]));
    expect(notes.map((n) => n.midi)).toEqual([45, 47]);
  });

  it('merges a repeat split by a short gap, but not by a breath', () => {
    expect(notesFromFrames(frames([[45, 0.3], [null, 0.05], [45, 0.3]]))).toHaveLength(1);
    expect(notesFromFrames(frames([[45, 0.3], [null, 0.15], [45, 0.3]]))).toHaveLength(2);
  });

  it('does not merge different pitches across a short gap', () => {
    expect(notesFromFrames(frames([[45, 0.3], [null, 0.05], [47, 0.3]])).map((n) => n.midi)).toEqual([45, 47]);
  });

  it('ignores a one-frame octave glitch inside a note', () => {
    const f = frames([[45, 0.6]]);
    f[30] = { ...f[30], midi: 57 };
    const notes = notesFromFrames(f);
    expect(notes.map((n) => n.midi)).toEqual([45]);
  });

  it('gives a confidence that is lower when the note is only partly heard', () => {
    const clean = notesFromFrames(frames([[45, 0.5]]))[0];
    const gappy = notesFromFrames(frames([[45, 0.25], [null, 0.07], [45, 0.25]]))[0];
    expect(clean.confidence).toBeGreaterThan(0.85);
    expect(gappy.confidence).toBeLessThan(clean.confidence);
  });
});

describe('matching a reference to the expected notes', () => {
  const expected = [{ midi: 45, startSec: 0 }, { midi: 47, startSec: 1 }];
  it('needs pitch within a semitone and onset within 100 ms', () => {
    expect(matchNotes(expected, [{ midi: 46, startSec: 0.09 }, { midi: 47, startSec: 1 }]).matched).toBe(2);
    expect(matchNotes(expected, [{ midi: 47, startSec: 0 }, { midi: 47, startSec: 1 }]).matched).toBe(1);
    expect(matchNotes(expected, [{ midi: 45, startSec: 0.2 }, { midi: 47, startSec: 1 }]).matched).toBe(1);
  });
  it('uses each note once', () => {
    expect(matchNotes([{ midi: 45, startSec: 0 }, { midi: 45, startSec: 0.05 }], [{ midi: 45, startSec: 0 }]).matched).toBe(1);
  });
});

function docx(xml: string): Buffer {
  const raw = Buffer.from(xml);
  const data = deflateRawSync(raw);
  const name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(raw.length, 24);
  cd.writeUInt16LE(name.length, 28);
  const body = Buffer.concat([local, name, data]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, name, end]);
}

describe('lyrics from a .docx', () => {
  const bytes = docx(
    '<w:document><w:body><w:p><w:r><w:t>A la</w:t></w:r><w:r><w:t xml:space="preserve"> va</w:t></w:r><w:r><w:t>ga</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Vaga &amp; llum</w:t></w:r></w:p></w:body></w:document>',
  );
  it('reads the words in order, joining runs and decoding entities', () => {
    expect(docxWords(bytes)).toEqual(['A', 'la', 'vaga', 'Vaga', '&', 'llum']);
  });

  const ref = (n: number): AudioReference => ({
    title: 't', part: 'greu', source: 'audio',
    notes: Array.from({ length: n }, (_, i) => ({ midi: 45, startSec: i, lengthSec: 0.5, confidence: 0.9 })),
  });
  it('attaches one word per note in order and marks the pairing approximate', () => {
    const out = attachLyrics(ref(3), ['a', 'b', 'c']);
    expect(out.lyrics).toBe('approximate');
    expect(out.notes.map((n) => n.lyric)).toEqual(['a', 'b', 'c']);
  });
  it('spreads extra words and leaves notes bare when words run short', () => {
    expect(attachLyrics(ref(2), ['a', 'b', 'c', 'd']).notes.map((n) => n.lyric)).toEqual(['a b', 'c d']);
    expect(attachLyrics(ref(4), ['a', 'b']).notes.map((n) => n.lyric)).toEqual(['a', undefined, 'b', undefined]);
  });
  it('rejects a file that is not a .docx', () => {
    expect(() => docxWords(readFileSync('tests/fixtures/takes/satb-bass.ogg'))).toThrow();
  });
});

/** Async, so a slow tracker run does not block vitest's worker heartbeat. */
function run(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn('npx', ['tsx', ...args], { env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const python = process.env.PITCH_PYTHON ?? 'python3';
const ready = spawnSync(python, ['-c', 'import torch, torchcrepe, numpy']).status === 0;
if (!ready) console.warn(`reference:audio exit check skipped: ${python} has no torch/torchcrepe (pip install -r pitch/requirements.txt)`);

describe.skipIf(!ready)('exit check: a practice track becomes a reference', () => {
  const LEAD = 0.3; // pitch/synth.py starts the audio this long after the score's first beat
  const greu = readReference('tests/fixtures/scores/three-voice.musicxml');
  const expected = greu.notes.map((n) => ({ midi: n.midi, startSec: n.startSec + LEAD }));

  it('matches at least 95% of the Greu notes from a generated track', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ref-audio-'));
    const r = await run(['scripts/reference-audio.ts', 'tests/fixtures/takes/three-voice-greu.m4a', '--title', 'Fixture', '--part', 'greu', '--out', out], { ...process.env, PITCH_PYTHON: python });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const ref = JSON.parse(readFileSync(join(out, 'reference.json'), 'utf8')) as AudioReference;
    expect(ref).toMatchObject({ title: 'Fixture', part: 'greu', source: 'audio' });
    expect(ref.lyrics).toBeUndefined();
    for (const n of ref.notes) expect(n.confidence).toBeGreaterThan(0.5);
    const m = matchNotes(expected, ref.notes);
    console.log(`reference matches ${m.matched}/${m.total} notes (${(m.ratio * 100).toFixed(1)}%), ${ref.notes.length} notes found`);
    expect(m.ratio).toBeGreaterThanOrEqual(0.95);
    expect(ref.notes.length).toBe(expected.length); // no extra notes either
  }, 180000);

  it('would fail if the reference were the Aguda line: the check is real', () => {
    const wrong = expected.map((n) => ({ ...n, midi: n.midi + 12 + 3 }));
    expect(matchNotes(wrong, expected).ratio).toBeLessThan(0.95);
  });

  it('fails plainly on a file that is not audio', async () => {
    const r = await run(['scripts/reference-audio.ts', 'package.json', '--title', 'x', '--out', mkdtempSync(join(tmpdir(), 'ref-audio-'))], { ...process.env, PITCH_PYTHON: python });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ffmpeg could not read');
  });

  it('tells the user the usage when arguments are missing', async () => {
    const r = await run(['scripts/reference-audio.ts']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
});
