// Usage: npm run serve [-- <reference.json>]   (PORT, PITCH_PYTHON optional)
// The practice page. Defaults to the SATB fixture so it runs with nothing else set up.
import { readFileSync } from 'node:fs';
import { createApp } from '../src/web/server.ts';

const refPath = process.argv[2] ?? new URL('../tests/fixtures/scores/satb-bass.reference.json', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4173);
createApp({
  reference: JSON.parse(readFileSync(refPath, 'utf8')),
  pitchPython: process.env.PITCH_PYTHON,
  useModel: Boolean(process.env.OPENROUTER_API_KEY),
}).listen(port, () => console.log(`Doremi practice page on http://localhost:${port}`));
