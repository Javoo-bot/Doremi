// Usage: npm run coach:bars -- <reference.json> <pitch.json>
// pitch.json is the output of `python pitch/track.py take.m4a`.
import { sdk } from '../src/instrumentation.ts';
import { readFileSync } from 'node:fs';
import { scoreTake } from '../src/align/score.js';
import { coachBars } from '../src/coaching/tips.ts';

const [refPath, pitchPath] = process.argv.slice(2);
if (!refPath || !pitchPath) {
  console.error('Usage: npm run coach:bars -- <reference.json> <pitch.json>');
  process.exit(1);
}
const reference = JSON.parse(readFileSync(refPath, 'utf8'));
const score = scoreTake(reference, JSON.parse(readFileSync(pitchPath, 'utf8')));

try {
  console.log(JSON.stringify({ flaggedBars: score.flaggedBars, ...(await coachBars(score, reference.title)) }, null, 2));
} finally {
  await sdk.shutdown();
}
