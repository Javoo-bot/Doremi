import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bassReference, isBassLabel, parseScoreFile, pickBassStaff, readReference } from '../../src/score/index.ts';

const fx = (name: string) => `tests/fixtures/scores/${name}`;
const n = (midi: number, startBeat: number, startSec: number, lengthBeats: number, lengthSec: number, bar: number, lyric?: string) =>
  lyric === undefined ? { midi, startBeat, startSec, lengthBeats, lengthSec, bar } : { midi, startBeat, startSec, lengthBeats, lengthSec, bar, lyric };

const SATB_BASS = [
  n(48, 0, 0, 1, 0.5, 1, 'Gal'),
  n(50, 1, 0.5, 1, 0.5, 1, 'lo'),
  n(52, 2, 1, 4, 2, 1, 'ro'), // tied over the barline
  n(55, 6, 3, 1, 0.5, 2, 'jo'),
  n(48, 8, 4, 4, 4, 3, 'gro'), // tempo drops to 60 in bar 3
];

describe('bass line from MusicXML fixtures', () => {
  it('returns exactly the bass notes of the SATB score', () => {
    const ref = readReference(fx('satb.musicxml'));
    expect(ref.title).toBe('Fixture SATB');
    expect(ref.part).toBe('bass');
    expect(ref.notes).toEqual(SATB_BASS);
  });

  it('picks the "Tenors i Baixos" staff in a 3-staff score, with a pickup bar 0', () => {
    const ref = readReference(fx('three-staff.musicxml'));
    expect(ref.notes).toEqual([
      n(45, 2, 1, 1, 0.5, 0, 'ba'),
      n(52, 3, 1.5, 1, 0.5, 1, 'ix'),
      n(46, 4, 2, 1, 0.5, 1, 'os'),
      n(52, 5, 2.5, 1, 0.5, 1),
      n(45, 6, 3, 3, 1.5, 2, 'fi'),
    ]);
  });

  it('finds the bass by the short label "B."', () => {
    const ref = readReference(fx('short-labels.musicxml'));
    expect(ref.notes.map((x) => [x.midi, x.bar, x.lyric])).toEqual([
      [41, 1, 'ba'], [43, 1, 'ix'], [45, 1, 'o'], [48, 2, 'x'], [41, 3, 'y'],
    ]);
    expect(ref.notes[2]).toMatchObject({ startBeat: 2, lengthBeats: 4 });
  });

  it('lets a title override the one in the file', () => {
    expect(readReference(fx('satb.musicxml'), 'Gallo rojo').title).toBe('Gallo rojo');
  });
});

describe('bass staff label', () => {
  it.each(['Bajo', 'Baix', 'Baixos', 'B', 'B.', 'Bass', 'Bajos', 'Tenors i Baixos', 'BAIX'])('accepts %s', (l) => expect(isBassLabel(l)).toBe(true));
  it.each(['Soprano', 'Alto', 'T.', 'Tenor', 'Clarinet'])('rejects %s', (l) => expect(isBassLabel(l)).toBe(false));

  it('prefers a bass-only staff over a shared one', () => {
    const shared = { labels: ['Tenors i Baixos'], notes: [] };
    const bass = { labels: ['Baix'], notes: [] };
    expect(pickBassStaff([shared, bass])).toBe(bass);
  });

  it('names the staves it found when none is bass', () => {
    expect(() => pickBassStaff([{ labels: ['Soprano'], notes: [] }, { labels: ['Alto'], notes: [] }])).toThrow(/"Soprano", "Alto"/);
  });
});

const MSCX = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20"><Score>
<metaTag name="workTitle">Fixture mscx</metaTag>
<Part id="1"><Staff id="1"/><trackName>Soprano</trackName><Instrument id="voice"><longName>Soprano</longName><shortName>S.</shortName></Instrument></Part>
<Part id="2"><Staff id="2"/><trackName>Bass</trackName><Instrument id="voice"><longName>Baix</longName><shortName>B.</shortName></Instrument></Part>
<Staff id="1"><Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig><Tempo><tempo>2</tempo></Tempo>
<Chord><durationType>whole</durationType><Note><pitch>72</pitch></Note></Chord></voice></Measure></Staff>
<Staff id="2">
<Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>
<Chord><durationType>quarter</durationType><Lyrics><syllabic>begin</syllabic><text>Gal</text></Lyrics><Note><pitch>48</pitch></Note></Chord>
<Chord><dots>1</dots><durationType>quarter</durationType><Lyrics><no>1</no><text>verse two</text></Lyrics><Lyrics><syllabic>end</syllabic><text>lo</text></Lyrics><Note><pitch>50</pitch></Note></Chord>
<Chord><durationType>eighth</durationType><Note><pitch>52</pitch></Note></Chord>
<Chord><durationType>quarter</durationType><Note><Spanner type="Tie"><Tie/><next><location><fractions>1/2</fractions></location></next></Spanner><pitch>53</pitch></Note></Chord>
</voice></Measure>
<Measure><voice>
<Chord><durationType>quarter</durationType><Note><Spanner type="Tie"><prev><location><fractions>-1/2</fractions></location></prev></Spanner><pitch>53</pitch></Note></Chord>
<Rest><durationType>quarter</durationType></Rest>
<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes></Tuplet>
<Chord><durationType>eighth</durationType><Note><pitch>55</pitch></Note></Chord>
<Chord><durationType>eighth</durationType><Note><pitch>57</pitch></Note></Chord>
<Chord><durationType>eighth</durationType><Note><pitch>59</pitch></Note></Chord><endTuplet/>
</voice></Measure></Staff></Score></museScore>`;

// A zip with one deflated entry, as MuseScore writes it.
function zip(entries: Record<string, string>): Buffer {
  const files: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nm.length, 28);
    cd.writeUInt32LE(offset, 42);
    files.push(local, nm, data);
    central.push(cd, nm);
    offset += 30 + nm.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, cdBuf, end]);
}

describe('bass line from MuseScore', () => {
  const expected = [
    n(48, 0, 0, 1, 0.5, 1, 'Gal'),
    n(50, 1, 0.5, 1.5, 0.75, 1, 'lo'), // dotted quarter, verse 1 lyric
    n(52, 2.5, 1.25, 0.5, 0.25, 1),
    n(53, 3, 1.5, 2, 1, 1), // quarter tied to the first quarter of bar 2
  ];

  it('reads .mscx: dots, verse 1, ties, tuplets, rests and tempo from another staff', () => {
    const ref = bassReference(parseScoreFile(Buffer.from(MSCX), 'x.mscx'));
    expect(ref.title).toBe('Fixture mscx');
    // Tempo 2 quarter notes per second = 120 bpm, set on the soprano staff.
    expect(ref.notes.slice(0, 3)).toEqual(expected.slice(0, 3));
    expect(ref.notes[3]).toEqual(expected[3]);
    // Bar 2 (beat 4): the tied quarter, a quarter rest, then three eighth triplets of 1/3 beat.
    expect(ref.notes.slice(4).map((x) => [x.midi, x.bar, x.startBeat])).toEqual([[55, 2, 6], [57, 2, 6.333333], [59, 2, 6.666667]]);
    expect(ref.notes[4].lengthBeats).toBeCloseTo(1 / 3, 5);
  });

  it('reads .mscz, a zip holding the .mscx', () => {
    const bytes = zip({ 'Thumbnails/thumbnail.png': 'x', 'song.mscx': MSCX });
    expect(bassReference(parseScoreFile(bytes, 'song.mscz')).notes).toHaveLength(7);
  });

  it('reads .mxl through its container.xml', () => {
    const xml = readFileSync(fx('satb.musicxml'), 'utf8');
    const container = '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>';
    const bytes = zip({ 'META-INF/container.xml': container, 'other.xml': '<x/>', 'score.xml': xml });
    expect(bassReference(parseScoreFile(bytes, 'song.mxl')).notes).toEqual(SATB_BASS);
  });
});
