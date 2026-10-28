import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { complete, llmConfig } from '../llm.ts';
import type { TakeScore } from '../align/score.js';
import { barFacts, type BarFacts } from './facts.ts';

export const MAX_TIPS = 3;

export const systemPrompt =
  'Ets un professor de cant coral que ajuda un baix després de gravar una veu. Escrius en català.\n' +
  'Rebràs només els compassos on el cantant ha fallat, amb les dades mesurades: desviació en cents ' +
  '(negatiu = baix, positiu = alt; 100 cents és un semitò), si ha entrat d\'hora o tard, si ha tallat la nota, ' +
  'si no l\'ha cantada, i la síl·laba de cada nota.\n' +
  'Regles:\n' +
  '- Escriu dos o tres consells curts i concrets, un per línia, sense numerar.\n' +
  '- Cada consell parla d\'un o més compassos de la llista i els anomena així: "compàs 4" o "compassos 4 i 7". ' +
  'No facis servir intervals com "4-6".\n' +
  '- No esmentis cap compàs que no sigui a la llista.\n' +
  '- Fes servir el vocabulari del cor: to, semitò, mig to, compàs.\n' +
  '- No inventis notes, lletra ni dades. No parlis de dinàmica (piano, forte): no s\'ha mesurat.\n' +
  '- Si dones la síl·laba, que sigui una de les dades.';

export function userPrompt(title: string, facts: BarFacts[]): string {
  return `Cançó: ${title}\nCompassos amb errors:\n${JSON.stringify(facts)}`;
}

/** Bar numbers a tip names, from "compàs 4", "compassos 4 i 7" or "compassos 4, 5 i 6". */
export function barsNamed(tip: string): number[] {
  const bars = new Set<number>();
  const re = /\bcomp(?:àsos|assos|às|as)\s+(\d+(?:\s*(?:,|i|-|–|a)\s*\d+)*)/giu;
  for (const m of tip.matchAll(re)) {
    const nums = m[1].split(/\s*(?:,|i|-|–|a)\s*/u).map(Number);
    if (/[-–]|\ba\b/u.test(m[1]) && nums.length === 2) {
      for (let b = nums[0]; b <= nums[1]; b++) bars.add(b);
    } else for (const b of nums) bars.add(b);
  }
  return [...bars];
}

/** A tip passes when it names at least one bar and every bar it names is a flagged one. */
export function tipNamesOnly(tip: string, flagged: number[]): boolean {
  const named = barsNamed(tip);
  return named.length > 0 && named.every((b) => flagged.includes(b));
}

export function tipsAreValid(tips: string[], flagged: number[]): boolean {
  return tips.length >= 1 && tips.length <= MAX_TIPS && tips.every((t) => tipNamesOnly(t, flagged));
}

const list = (bars: number[]) => (bars.length === 1 ? `compàs ${bars[0]}` : `compassos ${bars.slice(0, -1).join(', ')} i ${bars[bars.length - 1]}`);

function describe(f: BarFacts): string {
  const missed = f.problems.filter((p) => p.missed);
  const off = f.problems.filter((p) => p.cents !== undefined);
  const short = f.problems.filter((p) => p.tooShort);
  const timing = f.problems.filter((p) => p.timing);
  const at = (ps: typeof f.problems) => {
    const s = ps.map((p) => p.syllable).filter(Boolean);
    return s.length ? ` (a "${s.join(' ')}")` : '';
  };
  const parts: string[] = [];
  if (missed.length) parts.push(`hi ha notes que no has cantat${at(missed)}`);
  if (off.length) {
    const avg = off.reduce((s, p) => s + (p.cents as number), 0) / off.length;
    const semitones = Math.abs(avg) / 100;
    const size = semitones >= 0.75 ? 'quasi un semitò' : semitones >= 0.35 ? 'mig semitò' : 'una mica';
    parts.push(`cantes ${size} ${avg < 0 ? 'baix' : 'alt'}${at(off)}`);
  }
  if (short.length) parts.push(`talles les notes massa aviat${at(short)}`);
  if (timing.length) parts.push(`entres ${timing[0].timing === 'early' ? 'abans d\'hora' : 'tard'}${at(timing)}`);
  return parts.join(', ');
}

/** Plain tips straight from the numbers, used when the model's answer cannot be trusted. */
export function fallbackTips(facts: BarFacts[]): string[] {
  return [...facts]
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_TIPS)
    .map((f) => `Al ${list([f.bar])}: ${describe(f)}. Repassa'l a poc a poc.`);
}

export function parseTips(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/^[-*•\d.)\s]+(?=\S)/u, '').trim()).filter(Boolean);
}

export interface TipsResult {
  tips: string[];
  source: 'llm' | 'fallback' | 'none';
}

const ALL_GOOD = ['Tots els compassos han sortit bé. Continua així.'];

export async function coachBars(
  score: TakeScore,
  title: string,
  context: { songId: string; recordedAt?: Date } = { songId: 'unknown' },
): Promise<TipsResult & { traceId?: string }> {
  const facts = barFacts(score);
  if (facts.length === 0) return { tips: ALL_GOOD, source: 'none' };
  const flagged = facts.map((f) => f.bar);
  const day = (context.recordedAt ?? new Date()).toISOString().slice(0, 10);

  return propagateAttributes(
    {
      traceName: 'coach-bars',
      sessionId: `${context.songId}:${day}`,
      userId: 'owner',
      tags: ['coach-bars'],
      metadata: { songId: context.songId },
    },
    () =>
      startActiveObservation('coach-bars', async (root) => {
        root.update({ input: { song: title, facts } });
        let tips: string[] = [];
        let source: TipsResult['source'] = 'llm';
        // One retry: a second sample often fixes a stray bar number.
        for (let attempt = 0; attempt < 2; attempt++) {
          tips = parseTips(
            await complete(
              'write-bar-coaching',
              {
                model: llmConfig.models.coach,
                temperature: attempt === 0 ? 0.3 : 0,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt(title, facts) },
                ],
              },
              { songId: context.songId, flaggedBars: flagged, attempt },
            ),
          );
          if (tipsAreValid(tips, flagged)) break;
          tips = [];
        }
        if (tips.length === 0) {
          tips = fallbackTips(facts);
          source = 'fallback';
        }
        root.update({ output: tips.join('\n'), metadata: { source, flaggedBars: flagged } });
        return { tips, source, traceId: root.traceId };
      }),
  );
}
