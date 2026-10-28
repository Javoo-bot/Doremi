import { readFileSync } from 'node:fs';

interface Note { midi: number; startSec: number; lengthSec: number; bar: number }

/** A mono 16-bit WAV of a sine voice singing the fixture bass line, with one bar sung `cents` off. */
export function flatTakeWav(bar: number, cents: number, sampleRate = 16000): Buffer {
  const ref = JSON.parse(readFileSync('tests/fixtures/scores/satb-bass.reference.json', 'utf8')) as { notes: Note[] };
  const lead = 0.3;
  const end = Math.max(...ref.notes.map((n) => n.startSec + n.lengthSec)) + lead + 0.5;
  const pcm = new Int16Array(Math.ceil(end * sampleRate));
  for (const n of ref.notes) {
    const hz = 440 * 2 ** ((n.midi + (n.bar === bar ? cents / 100 : 0) - 69) / 12);
    const a = Math.round((n.startSec + lead + 0.03) * sampleRate);
    const b = Math.round((n.startSec + n.lengthSec + lead - 0.03) * sampleRate);
    for (let i = a; i < b; i++) {
      const env = Math.min(1, (i - a) / 160, (b - i) / 160);
      pcm[i] = Math.round(8000 * env * Math.sin((2 * Math.PI * hz * (i - a)) / sampleRate));
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length * 2, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length * 2, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}
