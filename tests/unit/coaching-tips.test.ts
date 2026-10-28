import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/llm.ts', () => ({ complete: vi.fn(), llmConfig: { models: { coach: 'test-model' } } }));

import { complete } from '../../src/llm.ts';
import { scoreTake } from '../../src/align/score.js';
import { barFacts } from '../../src/coaching/facts.ts';
import { barsNamed, coachBars, fallbackTips, tipNamesOnly, tipsAreValid, userPrompt } from '../../src/coaching/tips.ts';
import { buildCases } from '../../scripts/build-evals.ts';
import { reference, synthTake, takes } from '../helpers/synth-take.ts';
import cases from '../evals/cases.json';

const checkTips = createRequire(import.meta.url)('../evals/check-tips.cjs') as (
  out: string,
  ctx: { vars: { flagged: number[] } },
) => { pass: boolean };
const llm = vi.mocked(complete);

describe('the ten generated takes', () => {
  it.each(takes)('$name: the scorer flags exactly the bars with the known mistakes', ({ sing, bad }) => {
    expect(scoreTake(reference, synthTake(sing)).flaggedBars).toEqual(bad);
  });

  it.each(takes)('$name: the facts and the prompt hold only the bad bars', ({ sing, bad }) => {
    const score = scoreTake(reference, synthTake(sing));
    const facts = barFacts(score);
    expect(facts.map((f) => f.bar)).toEqual(bad);
    expect(facts.every((f) => f.problems.length > 0)).toBe(true);
    const prompt = userPrompt(reference.title, facts);
    expect(prompt).not.toMatch(/audio|base64/i);
    for (const b of score.bars.map((b) => b.bar).filter((b) => !bad.includes(b))) expect(prompt).not.toContain(`"bar":${b},`);
  });

  it.each(takes)('$name: the fallback tips name the right bars and no others', ({ sing, bad }) => {
    const tips = fallbackTips(barFacts(scoreTake(reference, synthTake(sing))));
    expect(tips.length).toBeGreaterThanOrEqual(1);
    expect(tipsAreValid(tips, bad)).toBe(true);
    expect(new Set(tips.flatMap(barsNamed))).toEqual(new Set(bad));
    expect(checkTips(tips.join('\n'), { vars: { flagged: bad } }).pass).toBe(true);
  });

  it('keeps tests/evals/cases.json in sync with the generator', () => {
    expect(cases).toEqual(JSON.parse(JSON.stringify(buildCases())));
    expect(cases).toHaveLength(10);
  });
});

describe('facts', () => {
  it('reports cents, syllable and the kind of mistake', () => {
    const facts = barFacts(scoreTake(reference, synthTake({ off: [{ bar: 4, cents: -30 }] })));
    expect(facts).toHaveLength(1);
    const p = facts[0].problems;
    expect(p.every((x) => x.cents! < -20 && x.cents! > -40)).toBe(true);
    expect(p[0].syllable).toBe('ma');
  });

  it('marks a skipped note as missed and a short note as too short', () => {
    expect(barFacts(scoreTake(reference, synthTake({ skipNote: 13 })))[0].problems).toEqual([{ syllable: 'dal', missed: true }]);
    expect(barFacts(scoreTake(reference, synthTake({ shortNote: 10 })))[0].problems).toEqual([{ syllable: 'ti', tooShort: true }]);
  });
});

describe('bar references in Catalan', () => {
  it('reads one bar, a list and a range', () => {
    expect(barsNamed('Al compàs 4 puja el to.')).toEqual([4]);
    expect(barsNamed('Als compassos 2, 5 i 6 estàs baix.')).toEqual([2, 5, 6]);
    expect(barsNamed('Compassos 3-5: més aire.')).toEqual([3, 4, 5]);
    expect(barsNamed('Compàs 2 i compàs 7.')).toEqual([2, 7]);
  });

  it('ignores numbers that are not bars', () => {
    expect(barsNamed('Estàs 30 cents baix, gairebé un semitò.')).toEqual([]);
  });

  it('accepts only tips that name flagged bars', () => {
    expect(tipNamesOnly('Al compàs 4 puja mig to.', [4])).toBe(true);
    expect(tipNamesOnly('Al compàs 4 i al compàs 5 puja.', [4])).toBe(false);
    expect(tipNamesOnly('Puja mig to.', [4])).toBe(false);
  });

  it('agrees with the promptfoo assertion', () => {
    const out = 'Al compàs 4 puja mig to.\nAl compàs 2 entra a temps.';
    expect(checkTips(out, { vars: { flagged: [2, 4] } }).pass).toBe(true);
    expect(checkTips(out, { vars: { flagged: [4] } }).pass).toBe(false);
    expect(checkTips('Puja mig to.', { vars: { flagged: [4] } }).pass).toBe(false);
  });
});

describe('coachBars', () => {
  const score = scoreTake(reference, synthTake({ off: [{ bar: 2, cents: -35 }, { bar: 5, cents: -35 }] }));

  it('makes no model call when every bar is good', async () => {
    llm.mockReset();
    const r = await coachBars(scoreTake(reference, synthTake()), reference.title);
    expect(r.source).toBe('none');
    expect(llm).not.toHaveBeenCalled();
  });

  it('keeps the model tips when they name only bad bars, and sends no audio', async () => {
    llm.mockReset().mockResolvedValue('- Al compàs 2 puja mig to a "ta".\n- Als compassos 5 canta més alt.');
    const r = await coachBars(score, reference.title);
    expect(r.source).toBe('llm');
    expect(r.tips).toHaveLength(2);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(llm.mock.calls[0][1])).not.toContain('input_audio');
  });

  it('retries once when a tip names a good bar, then keeps the second answer', async () => {
    llm.mockReset()
      .mockResolvedValueOnce('Al compàs 3 canta més fort.')
      .mockResolvedValueOnce('Al compàs 2 puja mig to.\nAl compàs 5 puja mig to.');
    const r = await coachBars(score, reference.title);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('llm');
    expect(r.tips).toEqual(['Al compàs 2 puja mig to.', 'Al compàs 5 puja mig to.']);
  });

  it('falls back to tips from the numbers when the model keeps naming a good bar', async () => {
    llm.mockReset().mockResolvedValue('Al compàs 1 canta més fort.');
    const r = await coachBars(score, reference.title);
    expect(r.source).toBe('fallback');
    expect(tipsAreValid(r.tips, [2, 5])).toBe(true);
  });
});
