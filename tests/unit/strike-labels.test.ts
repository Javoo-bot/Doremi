import { describe, expect, it } from 'vitest';
import { bassReference, isBassLabel, isGreuLabel, parseScoreFile, pickBassStaff, readReference, strikeVoice } from '../../src/score/index.ts';
import { readFileSync } from 'node:fs';

describe('strike voice labels', () => {
  it.each([
    ['Veu Greu', 'greu'], ['Greu', 'greu'], ['Gr.', 'greu'], ['GR', 'greu'],
    ['Veu Aguda', 'aguda'], ['Aguda', 'aguda'], ['Ag.', 'aguda'],
    ['Veu Principal', 'principal'], ['Principal', 'principal'], ['Princ.', 'principal'], ['V.P.', 'principal'], ['VP', 'principal'],
  ])('%s is %s', (label, voice) => expect(strikeVoice(label)).toBe(voice));

  it.each(['Soprano', 'Baix', 'B.', 'Tenors i Baixos', 'Gran', 'Agut', 'Piano'])('%s is not a strike voice', (l) => expect(strikeVoice(l)).toBeUndefined());

  it('keeps Bajo/Baix as bass and Greu as not bass', () => {
    expect(isGreuLabel('Gr.')).toBe(true);
    expect(isBassLabel('Gr.')).toBe(false);
    expect(isBassLabel('Greu')).toBe(false);
  });
});

describe('the Greu staff is the bass part when there is no Bajo/Baix', () => {
  const fixture = 'tests/fixtures/scores/three-voice.musicxml';

  it('picks the third staff of the three-voice fixture', () => {
    const score = parseScoreFile(readFileSync(fixture), fixture);
    expect(score.staves.map((s) => s.labels[0])).toEqual(['Aguda', 'Princ.', 'Greu']);
    expect(score.staves[2].labels).toContain('Gr.');
    expect(pickBassStaff(score.staves)).toBe(score.staves[2]);
  });

  it('returns exactly the Greu notes, tagged part greu', () => {
    const ref = readReference(fixture);
    expect(ref.part).toBe('greu');
    expect(ref.notes.map((n) => n.midi)).toEqual([45, 45, 43, 41, 40, 41, 43, 48, 48, 47, 45, 45, 41, 41, 43, 45, 43, 45]);
    expect(ref.notes[0]).toMatchObject({ bar: 1, startSec: 0, lyric: 'A' });
    expect(ref.notes.at(-1)).toMatchObject({ bar: 6, midi: 45, lengthBeats: 4 });
  });

  it('finds Greu by its short label alone', () => {
    const staves = [
      { labels: ['Veu Aguda', 'Ag.'], notes: [] },
      { labels: ['Veu Principal', 'V.P.'], notes: [] },
      { labels: ['Gr.'], notes: [] },
    ];
    expect(pickBassStaff(staves)).toBe(staves[2]);
  });

  it('still prefers a real bass staff over Greu, and says part bass', () => {
    const greu = { labels: ['Greu'], notes: [] };
    const baix = { labels: ['Baix'], notes: [{ midi: 40, startBeat: 0, lengthBeats: 1, bar: 1 }] };
    expect(pickBassStaff([greu, baix])).toBe(baix);
    expect(bassReference({ staves: [greu, baix], tempos: [] }).part).toBe('bass');
  });

  it('names the labels it accepts when there is neither', () => {
    expect(() => pickBassStaff([{ labels: ['Aguda'], notes: [] }, { labels: ['Princ.'], notes: [] }])).toThrow(/Veu Greu.*"Aguda", "Princ\."/);
  });

  it('reads Greu from a MuseScore file too', () => {
    const mscx = `<museScore version="4.20"><Score>
<Part id="1"><Staff id="1"/><Instrument id="voice"><longName>Veu Aguda</longName><shortName>Ag.</shortName></Instrument></Part>
<Part id="2"><Staff id="2"/><Instrument id="voice"><longName>Veu Greu</longName><shortName>Gr.</shortName></Instrument></Part>
<Staff id="1"><Measure><voice><Chord><durationType>whole</durationType><Note><pitch>72</pitch></Note></Chord></voice></Measure></Staff>
<Staff id="2"><Measure><voice><Chord><durationType>whole</durationType><Note><pitch>45</pitch></Note></Chord></voice></Measure></Staff>
</Score></museScore>`;
    const ref = bassReference(parseScoreFile(Buffer.from(mscx), 'x.mscx'));
    expect(ref.part).toBe('greu');
    expect(ref.notes.map((n) => n.midi)).toEqual([45]);
  });
});
