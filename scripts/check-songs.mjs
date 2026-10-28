// Every song in songs/ must have a readable reference: title, part, and lyrics or notes.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const songsDir = 'songs';
const songs = existsSync(songsDir) ? readdirSync(songsDir, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
const errors = [];
const report = [];

for (const { name } of songs) {
  const file = join(songsDir, name, 'reference.json');
  if (!existsSync(file)) {
    errors.push(`${name}: missing reference.json`);
    continue;
  }
  let ref;
  try {
    ref = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${name}: reference.json is not valid JSON (${e.message})`);
    continue;
  }
  for (const key of ['title', 'part']) {
    if (typeof ref[key] !== 'string' || !ref[key].trim()) errors.push(`${name}: "${key}" must be a non-empty string`);
  }
  const hasLyrics = typeof ref.lyrics === 'string' && ref.lyrics.trim();
  const hasNotes = Array.isArray(ref.notes) && ref.notes.length > 0;
  if (!hasLyrics && !hasNotes) errors.push(`${name}: needs "lyrics" or a non-empty "notes" list`);
  report.push({ song: name, part: ref.part, notes: hasNotes ? ref.notes.length : 0 });
}

mkdirSync('reports/songs', { recursive: true });
writeFileSync('reports/songs/check.json', JSON.stringify({ songs: report, errors }, null, 2));

for (const e of errors) console.error(`::error::${e}`);
console.log(`${songs.length} song(s) checked, ${errors.length} problem(s)`);
process.exit(errors.length ? 1 : 0);
