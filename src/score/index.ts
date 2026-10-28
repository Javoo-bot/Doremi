import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { parseMuseScore } from './musescore.ts';
import { parseMusicXml } from './musicxml.ts';
import type { Reference, ReferenceNote, Score, Staff, TempoChange } from './types.ts';
import { isZip, readZip } from './zip.ts';

export type { Reference, ReferenceNote, Score, Staff } from './types.ts';
export { parseMuseScore, parseMusicXml };

const DEFAULT_BPM = 120;

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const BASS_WORD = /\b(bajos?|baix(?:os)?|bass(?:es)?)\b/;
const BASS_LETTER = /^b\.?$/;

const GREU_WORD = /\bgreu\b/;
const GREU_SHORT = /^gr\.?$/;
const AGUDA_WORD = /\bagud[ao]\b/;
const AGUDA_SHORT = /^ag\.?$/;
const PRINCIPAL_WORD = /\bprincipal\b/;
const PRINCIPAL_SHORT = /^(princ\.?|v\.? ?p\.?)$/;

export type StrikeVoice = 'aguda' | 'principal' | 'greu';

/** The strike arrangement voice a staff label names: Veu Aguda / Ag., Veu Principal / Princ. / V.P., Veu Greu / Gr. */
export function strikeVoice(label: string): StrikeVoice | undefined {
  const l = norm(label);
  if (GREU_WORD.test(l) || GREU_SHORT.test(l)) return 'greu';
  if (AGUDA_WORD.test(l) || AGUDA_SHORT.test(l)) return 'aguda';
  if (PRINCIPAL_WORD.test(l) || PRINCIPAL_SHORT.test(l)) return 'principal';
  return undefined;
}

export const isGreuLabel = (label: string) => strikeVoice(label) === 'greu';

export function isBassLabel(label: string): boolean {
  const l = norm(label);
  return BASS_LETTER.test(l) || BASS_WORD.test(l);
}

/**
 * The staff labelled as bass. A label shared with the tenors ("Tenors i Baixos") counts, but a bass-only label wins.
 * A strike arrangement has no bass staff: the basses sing Veu Greu, so that staff is used when no Bajo/Baix exists.
 */
export function pickBassStaff(staves: Staff[]): Staff {
  let found = staves.filter((s) => s.labels.some(isBassLabel));
  if (!found.length) found = staves.filter((s) => s.labels.some(isGreuLabel));
  if (!found.length) {
    const seen = staves.map((s) => `"${s.labels[0] ?? '?'}"`).join(', ');
    throw new Error(`No staff is labelled as bass or Greu (Bajo, Baix, Baixos, B, B., Bass, Veu Greu, Gr.). Staves found: ${seen}`);
  }
  const alone = found.filter((s) => !s.labels.some((l) => /\b(tenor|tenors|tenores)\b/.test(norm(l))));
  const pool = alone.length ? alone : found;
  return pool[pool.length - 1];
}

function secondsAt(beat: number, tempos: TempoChange[]): number {
  const map = [...tempos].sort((a, b) => a.beat - b.beat);
  if (!map.length || map[0].beat > 0) map.unshift({ beat: 0, bpm: DEFAULT_BPM });
  let sec = 0;
  for (let i = 0; i < map.length && map[i].beat < beat; i++) {
    const end = Math.min(beat, map[i + 1]?.beat ?? Infinity);
    sec += ((end - map[i].beat) * 60) / map[i].bpm;
  }
  return sec;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function bassReference(score: Score, title?: string): Reference {
  const staff = pickBassStaff(score.staves);
  const notes: ReferenceNote[] = staff.notes
    .slice()
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
    .map((n) => {
      const startSec = secondsAt(n.startBeat, score.tempos);
      const endSec = secondsAt(n.startBeat + n.lengthBeats, score.tempos);
      const out: ReferenceNote = {
        midi: n.midi,
        startBeat: round(n.startBeat),
        startSec: round(startSec),
        lengthBeats: round(n.lengthBeats),
        lengthSec: round(endSec - startSec),
        bar: n.bar,
      };
      if (n.lyric) out.lyric = n.lyric;
      return out;
    });
  const part = staff.labels.some(isBassLabel) ? 'bass' : 'greu';
  return { title: title ?? score.title ?? '', part, notes };
}

export function parseScoreFile(bytes: Uint8Array, filename = ''): Score {
  let text: string;
  if (isZip(bytes)) {
    const files = readZip(bytes);
    const container = files.get('META-INF/container.xml')?.toString('utf8');
    const root = container && /full-path="([^"]+)"/.exec(container)?.[1];
    const name = (root && files.has(root) ? root : undefined) ?? [...files.keys()].find((n) => /\.(mscx|musicxml|xml)$/i.test(n) && !n.startsWith('META-INF/'));
    if (!name) throw new Error(`${filename}: no score inside the archive`);
    text = files.get(name)!.toString('utf8');
  } else text = Buffer.from(bytes).toString('utf8');
  return /<museScore[\s>]/.test(text) ? parseMuseScore(text) : parseMusicXml(text);
}

export function readReference(path: string, title?: string): Reference {
  const score = parseScoreFile(readFileSync(path), path);
  return bassReference(score, title ?? (score.title || basename(path, extname(path))));
}
