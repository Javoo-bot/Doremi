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
  part: 'bass' | 'greu';
  notes: ReferenceNote[];
}

export interface AudioReferenceNote {
  midi: number;
  startSec: number;
  lengthSec: number;
  /** 0 to 1: how steady and how clearly voiced the tracker found this note. */
  confidence: number;
  lyric?: string;
}

/** A reference made from a voice's practice track, so it has seconds but no beats or bars. */
export interface AudioReference {
  title: string;
  part: string;
  source: 'audio';
  lyrics?: 'approximate';
  notes: AudioReferenceNote[];
}
