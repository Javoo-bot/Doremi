import type { TakeScore } from '../align/score.js';

/** Deviation under this many cents is not worth a tip. */
const NOTABLE_CENTS = 20;

export interface NoteProblem {
  syllable?: string;
  /** Sung minus written, in cents. Negative is flat. Absent when the note was not sung. */
  cents?: number;
  timing?: 'early' | 'late';
  tooShort?: boolean;
  missed?: boolean;
}

export interface BarFacts {
  bar: number;
  score: number;
  problems: NoteProblem[];
}

/** Facts for the flagged bars only. Bars sung well are left out, so the model has nothing to say about them. */
export function barFacts(result: TakeScore): BarFacts[] {
  const scores = new Map(result.bars.map((b) => [b.bar, b.score]));
  return result.flaggedBars.map((bar) => {
    const problems: NoteProblem[] = [];
    for (const n of result.notes.filter((n) => n.bar === bar)) {
      const p: NoteProblem = {};
      if (n.lyric) p.syllable = n.lyric;
      if (n.missed) p.missed = true;
      else {
        if (n.deviationCents !== null && Math.abs(n.deviationCents) >= NOTABLE_CENTS) p.cents = Math.round(n.deviationCents);
        if (n.timing === 'early' || n.timing === 'late') p.timing = n.timing;
        if (n.tooShort) p.tooShort = true;
      }
      if (p.missed || p.cents !== undefined || p.timing || p.tooShort) problems.push(p);
    }
    return { bar, score: scores.get(bar) ?? 0, problems };
  });
}
