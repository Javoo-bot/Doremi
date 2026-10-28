import { child, childText, childrenNamed, parseXml, type XmlNode } from './xml.ts';
import type { RawNote, Score, Staff, TempoChange } from './types.ts';

const DURATION: Record<string, number> = {
  long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
};

function fraction(s: string | undefined): number {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)/.exec(s ?? '');
  return m ? (Number(m[1]) / Number(m[2])) * 4 : 0; // beats: a whole note is 4
}

function chordBeats(el: XmlNode): number {
  const type = childText(el, 'durationType');
  if (type === 'measure') return fraction(childText(el, 'duration'));
  let beats = DURATION[type ?? ''] ?? 0;
  let dot = beats / 2;
  for (let i = 0; i < Number(childText(el, 'dots') ?? 0); i++, dot /= 2) beats += dot;
  return beats;
}

function lyricOf(chord: XmlNode): string | undefined {
  // Verse 1 is the Lyrics element without a <no> child.
  const l = childrenNamed(chord, 'Lyrics').find((x) => !child(x, 'no')) ?? child(chord, 'Lyrics');
  return childText(l, 'text') || undefined;
}

function isTieContinuation(note: XmlNode): boolean {
  return childrenNamed(note, 'Spanner').some((s) => s.attrs.type === 'Tie' && child(s, 'prev'));
}

function parseStaff(staff: XmlNode, tempos: TempoChange[], timeSig: { n: number; d: number }): RawNote[] {
  const notes: RawNote[] = [];
  const open = new Map<number, RawNote>();
  let measureStart = 0;
  let bar = 0;
  childrenNamed(staff, 'Measure').forEach((measure, index) => {
    const irregular = !!child(measure, 'irregular');
    if (!irregular) bar++;
    const barNumber = irregular && index === 0 ? 0 : bar;
    let longest = 0;
    for (const voice of childrenNamed(measure, 'voice')) {
      let t = 0;
      const tuplets: number[] = [];
      for (const el of voice.children) {
        if (el.name === 'TimeSig') {
          timeSig.n = Number(childText(el, 'sigN') ?? timeSig.n);
          timeSig.d = Number(childText(el, 'sigD') ?? timeSig.d);
        } else if (el.name === 'Tempo') {
          const tempo = Number(childText(el, 'tempo'));
          if (tempo) tempos.push({ beat: measureStart + t, bpm: tempo * 60 });
        } else if (el.name === 'Tuplet') {
          tuplets.push(Number(childText(el, 'normalNotes') ?? 1) / Number(childText(el, 'actualNotes') ?? 1));
        } else if (el.name === 'endTuplet') tuplets.pop();
        else if (el.name === 'location') t += fraction(childText(el, 'fractions'));
        else if (el.name === 'Rest') t += chordBeats(el) * tuplets.reduce((a, b) => a * b, 1);
        else if (el.name === 'Chord') {
          if (child(el, 'grace4') || child(el, 'grace8') || child(el, 'acciaccatura') || child(el, 'appoggiatura')) continue;
          const len = chordBeats(el) * tuplets.reduce((a, b) => a * b, 1);
          const first = childrenNamed(el, 'Note')[0]; // one note per chord keeps one staff one line
          const midi = Number(childText(first, 'pitch'));
          if (first && Number.isFinite(midi)) {
            const prev = isTieContinuation(first) ? open.get(midi) : undefined;
            if (prev) prev.lengthBeats += len;
            else {
              const n: RawNote = { midi, startBeat: measureStart + t, lengthBeats: len, bar: barNumber };
              const lyric = lyricOf(el);
              if (lyric) n.lyric = lyric;
              notes.push(n);
              open.set(midi, n);
            }
          }
          t += len;
        }
      }
      longest = Math.max(longest, t);
    }
    const declared = measure.attrs.len ? fraction(measure.attrs.len) : (timeSig.n / timeSig.d) * 4;
    measureStart += declared || longest;
  });
  return notes;
}

export function parseMuseScore(src: string): Score {
  const root = parseXml(src);
  const score = child(child(root, 'museScore'), 'Score');
  if (!score) throw new Error('MuseScore: no <Score> element');
  const labelsById = new Map<string, string[]>();
  for (const part of childrenNamed(score, 'Part')) {
    const inst = child(part, 'Instrument');
    const labels = [childText(inst, 'longName'), childText(inst, 'shortName'), childText(part, 'trackName'), childText(inst, 'trackName')].filter((x): x is string => !!x);
    for (const s of childrenNamed(part, 'Staff')) labelsById.set(s.attrs.id, labels);
  }
  const tempos: TempoChange[] = [];
  const staves: Staff[] = childrenNamed(score, 'Staff')
    .filter((s) => child(s, 'Measure'))
    .map((s) => ({
      labels: labelsById.get(s.attrs.id) ?? [],
      notes: parseStaff(s, tempos, { n: 4, d: 4 }),
    }));
  const title = childrenNamed(score, 'metaTag').find((m) => m.attrs.name === 'workTitle')?.text.trim() || undefined;
  return { title, staves, tempos };
}
