// Usage: tsx scripts/score-take.ts <reference.json> <pitch.json>
// pitch.json is the output of `python pitch/track.py take.m4a`.
import { readFileSync } from 'node:fs';
import { scoreTake } from '../src/align/score.js';

const [refPath, pitchPath] = process.argv.slice(2);
if (!refPath || !pitchPath) {
  console.error('usage: tsx scripts/score-take.ts <reference.json> <pitch.json>');
  process.exit(2);
}
const result = scoreTake(JSON.parse(readFileSync(refPath, 'utf8')), JSON.parse(readFileSync(pitchPath, 'utf8')));
console.log(JSON.stringify(result, null, 2));
