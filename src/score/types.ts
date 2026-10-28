export interface RawNote {
  midi: number;
  startBeat: number;
  lengthBeats: number;
  bar: number;
  lyric?: string;
}

export interface Staff {
  /** Every label the score gives this staff: full name, short name, track name. */
  labels: string[];
  notes: RawNote[];
}

export interface TempoChange {
  beat: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface Score {
  title?: string;
  staves: Staff[];
  tempos: TempoChange[];
}

export interface ReferenceNote {
  midi: number;
  startBeat: number;
  startSec: number;
  lengthBeats: number;
  lengthSec: number;
  bar: number;
  lyric?: string;
}

export interface Reference {
  title: string;
  part: 'bass';
  notes: ReferenceNote[];
}
