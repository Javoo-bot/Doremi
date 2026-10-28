// Usage: npm run build:evals
// Writes tests/evals/cases.json: the prompts for 10 generated takes with known mistakes, for promptfoo.
import { writeFileSync } from 'node:fs';
import { scoreTake } from '../src/align/score.js';
import { barFacts } from '../src/coaching/facts.ts';
import { systemPrompt, userPrompt } from '../src/coaching/tips.ts';
import { reference, synthTake, takes } from '../tests/helpers/synth-take.ts';

export function buildCases() {
  return takes.map(({ name, sing }) => {
    const score = scoreTake(reference, synthTake(sing));
    const flagged = score.flaggedBars;
    return {
      description: name,
      vars: {
        system: systemPrompt,
        user: userPrompt(reference.title, barFacts(score)),
        flagged,
        good: score.bars.map((b) => b.bar).filter((b) => !flagged.includes(b)),
      },
    };
  });
}

if (process.argv[1]?.endsWith('build-evals.ts')) {
  writeFileSync('tests/evals/cases.json', JSON.stringify(buildCases(), null, 2) + '\n');
}
