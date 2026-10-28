// Usage: tsx scripts/score-to-reference.ts <score.mscz|.mscx|.musicxml|.mxl> <song-slug> [title]
// Writes songs/<song-slug>/reference.json with the bass notes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { readReference } from '../src/score/index.ts';

const [file, slug, title] = process.argv.slice(2);
if (!file || !slug) {
  console.error('Usage: tsx scripts/score-to-reference.ts <score> <song-slug> [title]');
  process.exit(2);
}
const ref = readReference(file, title);
mkdirSync(`songs/${slug}`, { recursive: true });
writeFileSync(`songs/${slug}/reference.json`, JSON.stringify(ref, null, 2) + '\n');
console.log(`songs/${slug}/reference.json: ${ref.notes.length} bass notes`);
