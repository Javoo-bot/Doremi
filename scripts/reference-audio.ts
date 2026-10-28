// Usage: tsx scripts/reference-audio.ts <track.mp3|mp4|...> --title <title> --part greu --out <dir> [--lyrics lyrics.docx]
// Runs the pitch tracker on a voice's practice track and writes <dir>/reference.json (source "audio").
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { audioReference, type PitchFrame } from '../src/reference/audio.ts';
import { attachLyrics, readDocxWords } from '../src/reference/lyrics.ts';

const usage = 'usage: npm run reference:audio -- <track> --title <title> --part greu --out <dir> [--lyrics lyrics.docx]';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { title: { type: 'string' }, part: { type: 'string', default: 'greu' }, out: { type: 'string' }, lyrics: { type: 'string' } },
});
const [track] = positionals;
if (!track || !values.title || !values.out) {
  console.error(usage);
  process.exit(2);
}

const python = process.env.PITCH_PYTHON ?? 'python3';
const run = spawnSync(python, ['pitch/track.py', track], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (run.status !== 0) {
  console.error(run.stderr.trim() || `pitch tracker failed (${python})`);
  process.exit(1);
}
const { hop_sec: hop, frames } = JSON.parse(run.stdout) as { hop_sec: number; frames: PitchFrame[] };
let ref = audioReference(values.title, values.part ?? 'greu', frames, hop);
if (values.lyrics) ref = attachLyrics(ref, readDocxWords(values.lyrics));
mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, 'reference.json'), JSON.stringify(ref, null, 2) + '\n');
console.log(`${join(values.out, 'reference.json')}: ${ref.notes.length} notes from ${track}`);
