import { describe, expect, it } from 'vitest';
import { compareLyrics } from '../../src/coach.ts';

describe('compareLyrics', () => {
  it('scores an exact take as fully accurate', () => {
    expect(compareLyrics('Canta el gallo negro', 'canta el gallo negro')).toEqual({ accuracy: 1, missed: [], extra: [] });
  });

  it('reports a substituted word as one missed and one extra', () => {
    const r = compareLyrics('now am found', "now I'm found");
    expect(r.missed).toEqual(['am']);
    expect(r.extra).toEqual(["i'm"]);
    expect(r.accuracy).toBeCloseTo(2 / 3);
  });

  it('counts repeated words, so a dropped repeat is missed', () => {
    const r = compareLyrics('gallo gallo rojo', 'gallo rojo');
    expect(r.missed).toEqual(['gallo']);
    expect(r.extra).toEqual([]);
  });

  it('keeps accented Catalan words intact', () => {
    expect(compareLyrics('Què volen aquesta gent', 'que volen aquesta gent').missed).toEqual(['què']);
  });

  it('treats empty expected lyrics as nothing to miss', () => {
    expect(compareLyrics('', 'la la').accuracy).toBe(1);
  });
});
