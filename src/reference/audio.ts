import type { AudioReference, AudioReferenceNote } from '../score/types.ts';

/** One frame of the phase 2 pitch tracker (`python pitch/track.py`). */
export interface PitchFrame {
  t: number;
  midi: number | null;
  confidence: number;
  voiced: boolean;
}

export interface NoteOptions {
  /** A stretch of steady pitch shorter than this is not a note (a glitch or a slide). */
  minNoteSec: number;
  /** Two notes on the same semitone with less silence than this between them are one note. */
  mergeGapSec: number;
  /** A frame this many semitones from the note's median starts a new note. */
  splitSemitones: number;
}

export const defaultNoteOptions: NoteOptions = { minNoteSec: 0.08, mergeGapSec: 0.08, splitSemitones: 0.75 };

interface Run {
  frames: PitchFrame[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Split the voiced frames into runs of steady pitch. Silence and big pitch jumps end a run. */
function steadyRuns(frames: PitchFrame[], hop: number, splitSemitones: number): Run[] {
  const runs: Run[] = [];
  let current: PitchFrame[] = [];
  let mids: number[] = [];
  const close = () => {
    if (current.length) runs.push({ frames: current });
    current = [];
    mids = [];
  };
  let prevT = -Infinity;
  for (const f of frames) {
    if (!f.voiced || f.midi === null) {
      close();
      continue;
    }
    if (f.t - prevT > hop * 1.5) close(); // frames are missing, so the voice was not tracked
    prevT = f.t;
    if (mids.length && Math.abs(f.midi - median(mids)) > splitSemitones) close();
    current.push(f);
    mids.push(f.midi);
  }
  close();
  return runs;
}

/**
 * Turn the pitch curve into notes: steady stretches of at least minNoteSec, each rounded to the nearest
 * semitone, with same-pitch neighbours split only by a short gap merged. The octave is kept as heard.
 */
export function notesFromFrames(frames: PitchFrame[], hop = 0.01, options: Partial<NoteOptions> = {}): AudioReferenceNote[] {
  const o = { ...defaultNoteOptions, ...options };
  type Seg = { midi: number; start: number; end: number; conf: number[]; frames: number };
  const segs: Seg[] = steadyRuns(frames, hop, o.splitSemitones)
    .map(({ frames: fs }) => ({
      midi: Math.round(median(fs.map((f) => f.midi as number))),
      start: fs[0].t - hop / 2, // frame times are window centres
      end: fs[fs.length - 1].t + hop / 2,
      conf: fs.map((f) => f.confidence),
      frames: fs.length,
    }))
    .filter((s) => s.end - s.start >= o.minNoteSec - 1e-9);

  const merged: Seg[] = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === s.midi && s.start - prev.end <= o.mergeGapSec + 1e-9) {
      prev.end = s.end;
      prev.conf.push(...s.conf);
      prev.frames += s.frames;
    } else merged.push({ ...s });
  }
  return merged.map((s) => {
    // Confidence: how sure the tracker was, times how much of the note it actually heard (merged gaps count against it).
    const heard = Math.min(1, s.frames / Math.max(1, (s.end - s.start) / hop));
    const mean = s.conf.reduce((a, b) => a + b, 0) / s.conf.length;
    return {
      midi: s.midi,
      startSec: round3(Math.max(0, s.start)),
      lengthSec: round3(s.end - s.start),
      confidence: round3(Math.min(1, mean * heard)),
    };
  });
}

export function audioReference(title: string, part: string, frames: PitchFrame[], hop = 0.01): AudioReference {
  return { title, part, source: 'audio', notes: notesFromFrames(frames, hop) };
}

export interface Match {
  matched: number;
  total: number;
  ratio: number;
}

/** How many of the expected notes the reference has: pitch within a semitone and onset within 100 ms, each note used once. */
export function matchNotes(
  expected: { midi: number; startSec: number }[],
  got: { midi: number; startSec: number }[],
  toleranceSemitones = 1,
  onsetSec = 0.1,
): Match {
  const used = new Set<number>();
  let matched = 0;
  for (const e of expected) {
    let best = -1;
    let bestDt = Infinity;
    got.forEach((g, i) => {
      const dt = Math.abs(g.startSec - e.startSec);
      if (!used.has(i) && dt <= onsetSec && Math.abs(g.midi - e.midi) <= toleranceSemitones && dt < bestDt) {
        best = i;
        bestDt = dt;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return { matched, total: expected.length, ratio: expected.length ? matched / expected.length : 1 };
}
