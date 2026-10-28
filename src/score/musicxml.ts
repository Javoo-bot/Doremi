import { child, childText, childrenNamed, parseXml, type XmlNode } from './xml.ts';
import type { RawNote, Score, Staff, TempoChange } from './types.ts';

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const UNIT_BEATS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };

function midiOf(pitch: XmlNode): number {
  const step = STEP[childText(pitch, 'step') ?? ''];
  if (step === undefined) throw new Error('MusicXML: note has no valid step');
  const alter = Number(childText(pitch, 'alter') ?? 0);
  return 12 * (Number(childText(pitch, 'octave')) + 1) + step + alter;
}

function lyricOf(note: XmlNode): string | undefined {
  const lyric = child(note, 'lyric');
  if (!lyric) return undefined;
  const text = lyric.children.filter((c) => c.name === 'text').map((c) => c.text.trim()).join('');
  return text || undefined;
}

function tempoOf(dir: XmlNode): number | undefined {
  const sound = childrenNamed(dir, 'sound').find((s) => s.attrs.tempo);
  if (sound) return Number(sound.attrs.tempo);
  const metro = child(child(dir, 'direction-type'), 'metronome');
  const perMinute = Number(childText(metro, 'per-minute'));
  const unit = UNIT_BEATS[childText(metro, 'beat-unit') ?? ''];
  if (!metro || !perMinute || !unit) return undefined;
  return perMinute * unit * (child(metro, 'beat-unit-dot') ? 1.5 : 1);
}

function parsePart(part: XmlNode, tempos: TempoChange[]): RawNote[] {
  const notes: RawNote[] = [];
  const open = new Map<number, RawNote>(); // pitch -> note waiting for its tie to end
  let divisions = 1;
  let measureStart = 0;
  childrenNamed(part, 'measure').forEach((measure, index) => {
    const num = parseInt(measure.attrs.number ?? '', 10);
    const bar = measure.attrs.implicit === 'yes' && index === 0 ? 0 : Number.isFinite(num) ? num : index + 1;
    let t = 0; // beats since the start of the measure
    let longest = 0;
    let last = 0; // start of the previous non-chord note, for <chord/>
    for (const el of measure.children) {
      if (el.name === 'attributes') divisions = Number(childText(el, 'divisions') ?? divisions);
      else if (el.name === 'direction') {
        const bpm = tempoOf(el);
        if (bpm) tempos.push({ beat: measureStart + t, bpm });
      } else if (el.name === 'backup') t -= Number(childText(el, 'duration')) / divisions;
      else if (el.name === 'forward') t += Number(childText(el, 'duration')) / divisions;
      else if (el.name === 'note') {
        if (child(el, 'grace')) continue;
        const len = Number(childText(el, 'duration') ?? 0) / divisions;
        const isChord = !!child(el, 'chord');
        const start = isChord ? last : t;
        const pitch = child(el, 'pitch');
        // Only the first note of a chord is kept, so one staff stays one line.
        if (pitch && !isChord && !child(el, 'rest')) {
          const midi = midiOf(pitch);
          const ties = childrenNamed(el, 'tie').map((x) => x.attrs.type);
          const prev = ties.includes('stop') ? open.get(midi) : undefined;
          if (prev) {
            prev.lengthBeats += len;
            if (!ties.includes('start')) open.delete(midi);
          } else {
            const n: RawNote = { midi, startBeat: measureStart + start, lengthBeats: len, bar };
            const lyric = lyricOf(el);
            if (lyric) n.lyric = lyric;
            notes.push(n);
            if (ties.includes('start')) open.set(midi, n);
          }
        }
        if (!isChord) {
          last = t;
          t += len;
        }
      }
      longest = Math.max(longest, t);
    }
    measureStart += longest;
  });
  return notes;
}

export function parseMusicXml(src: string): Score {
  const root = parseXml(src);
  const score = root.children.find((c) => c.name === 'score-partwise');
  if (!score) throw new Error('MusicXML: only score-partwise files are supported');
  const labels = new Map<string, string[]>();
  for (const sp of childrenNamed(child(score, 'part-list'), 'score-part')) {
    labels.set(
      sp.attrs.id,
      ['part-name', 'part-abbreviation', 'instrument-name'].map((n) => childText(sp, n) ?? childText(child(sp, 'score-instrument'), n) ?? '').filter(Boolean),
    );
  }
  const tempos: TempoChange[] = [];
  const staves: Staff[] = childrenNamed(score, 'part').map((p) => ({
    labels: labels.get(p.attrs.id) ?? [],
    notes: parsePart(p, tempos),
  }));
  const title = childText(child(score, 'work'), 'work-title') || childText(score, 'movement-title') || undefined;
  return { title, staves, tempos };
}
